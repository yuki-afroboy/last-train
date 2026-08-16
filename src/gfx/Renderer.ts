import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import type { QualityProfile } from '../core/Settings';
import { setMaxAnisotropy, setTextureScale } from './Textures';

/**
 * Final grade: vignette, film grain, a touch of chromatic aberration at the
 * edges, and a "distortion" amount the game raises during strong anomalies and
 * the game-over sequence. Runs after OutputPass, i.e. on display-referred sRGB.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 1.0 },
    uGrain: { value: 0.05 },
    uAberration: { value: 0.0005 },
    uDistort: { value: 0.0 },
    uDesat: { value: 0.0 },
    uFade: { value: 0.0 },
    uTint: { value: new THREE.Color(0x0a0f16) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uAberration, uDistort, uDesat, uFade;
    uniform vec3 uTint;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);

      // gentle barrel warp that intensifies with uDistort
      uv = 0.5 + c * (1.0 + uDistort * r2 * 2.2);

      // horizontal wobble on heavy distortion only
      if (uDistort > 0.001) {
        uv.x += sin(uv.y * 42.0 + uTime * 5.0) * uDistort * 0.012;
      }

      float ab = uAberration + uDistort * 0.01;
      vec2 dir = c * ab;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir).b;

      // vignette
      float vig = smoothstep(1.15, 0.16, r2 * uVignette * 2.3);
      col *= mix(1.0, vig, 0.62);

      // filmic grain, slightly stronger in the shadows where it reads as noise
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      float g = hash(uv * 1024.0 + fract(uTime) * 91.7) - 0.5;
      col += g * uGrain * (1.25 - lum);

      // subtle cool tint in the deep shadows
      col = mix(col, uTint, clamp((0.16 - lum) * 1.6, 0.0, 0.35));

      col = mix(col, vec3(lum), uDesat);
      col = mix(col, vec3(0.0), uFade);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class RendererSystem {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  composer!: EffectComposer;

  private renderPass!: RenderPass;
  private bloomPass: UnrealBloomPass | null = null;
  private gtaoPass: GTAOPass | null = null;
  private gradePass!: ShaderPass;
  private profile!: QualityProfile;
  private clock = new THREE.Clock();
  private usePost = true;

  /** rolling FPS estimate, surfaced to the debug overlay and adaptive quality */
  fps = 60;
  private fpsAccum = 0;
  private fpsFrames = 0;

  constructor(canvas: HTMLCanvasElement, profile: QualityProfile, fov: number) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // reset once per frame instead of once per pass, so drawCalls reports the
    // whole frame including every post-processing pass
    this.renderer.info.autoReset = false;

    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.06, 320);
    this.scene.background = new THREE.Color(0x05070b);

    setMaxAnisotropy(Math.min(profile.anisotropy, this.renderer.capabilities.getMaxAnisotropy()));
    setTextureScale(profile.textureScale);

    this.applyProfile(profile);
    addEventListener('resize', this.resize);
    this.resize();
  }

  /** Rebuild the post chain for a quality level. Safe to call at runtime. */
  applyProfile(profile: QualityProfile): void {
    this.profile = profile;
    this.renderer.shadowMap.enabled = profile.shadows;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, profile.pixelRatioCap));

    this.composer?.dispose();
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(devicePixelRatio || 1, profile.pixelRatioCap));

    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.gtaoPass = null;
    if (profile.ao) {
      const g = new GTAOPass(this.scene, this.camera, innerWidth, innerHeight);
      g.updateGtaoMaterial({
        radius: 0.42,
        distanceExponent: 1.2,
        thickness: 0.6,
        scale: 1.0,
        samples: 12,
        screenSpaceRadius: false,
      });
      g.blendIntensity = 0.85;
      this.composer.addPass(g);
      this.gtaoPass = g;
    }

    // Tone-map first, then bloom.
    //
    // Bloom on raw HDR radiance is unusable here: a point light 0.5 m from the
    // roof produces radiance in the tens, so any threshold low enough to catch
    // the lamp tubes also catches every surface near a lamp, and the whole
    // frame turns into haze. Running the bloom on display-referred values makes
    // the threshold mean "reads as near-white on screen", which is exactly the
    // set of things that should glow: the tubes, the vending fronts, signage.
    this.composer.addPass(new OutputPass());

    this.bloomPass = null;
    if (profile.bloom) {
      const b = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.42, 0.5, 0.78);
      this.composer.addPass(b);
      this.bloomPass = b;
    }

    this.gradePass = new ShaderPass(GradeShader);
    this.gradePass.uniforms.uGrain.value = profile.grain ? 0.042 : 0.0;
    this.gradePass.renderToScreen = true;
    this.composer.addPass(this.gradePass);

    this.usePost = true;
    this.resize();
  }

  setFov(fov: number): void {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  /** Post-process hooks used by anomalies / game states. */
  setDistortion(v: number): void {
    this.gradePass.uniforms.uDistort.value = v;
  }
  setDesaturation(v: number): void {
    this.gradePass.uniforms.uDesat.value = v;
  }
  setFade(v: number): void {
    this.gradePass.uniforms.uFade.value = v;
  }
  setBloomStrength(v: number): void {
    if (this.bloomPass) this.bloomPass.strength = v;
  }
  setExposure(v: number): void {
    this.renderer.toneMappingExposure = v;
  }

  private resize = (): void => {
    const w = innerWidth;
    const h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.gtaoPass?.setSize(w, h);
    this.bloomPass?.setSize(w, h);
    this.onResize?.(w, h);
  };

  render(): number {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.lastDrawCalls = this.renderer.info.render.calls;
    this.renderer.info.reset();
    this.gradePass.uniforms.uTime.value += dt;

    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    if (this.usePost) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    return dt;
  }

  private lastDrawCalls = 0;

  get drawCalls(): number {
    return this.lastDrawCalls;
  }

  /** Extra per-frame work the renderer owner wants tied to the resize event. */
  onResize: ((width: number, height: number) => void) | null = null;

  get qualityProfile(): QualityProfile {
    return this.profile;
  }

  dispose(): void {
    removeEventListener('resize', this.resize);
    this.composer?.dispose();
    this.renderer.dispose();
  }
}
