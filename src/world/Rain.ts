import * as THREE from 'three';
import { L } from './Layout';

/**
 * GPU-animated rain.
 *
 * Each drop is a two-vertex line segment; the whole field falls, wraps and
 * fades entirely in the vertex shader, so CPU cost per frame is one uniform
 * write regardless of drop count. Drops are only spawned where the platform
 * roof does not cover the sky, which is what sells the roof as a real object.
 */
export class Rain {
  readonly group = new THREE.Group();
  private mat: THREE.ShaderMaterial;
  private splashMat: THREE.ShaderMaterial | null = null;
  private time = 0;

  constructor(count: number, splashCount: number) {
    const positions = new Float32Array(count * 2 * 3);
    const seeds = new Float32Array(count * 2);
    const sides = new Float32Array(count * 2);
    const lengths = new Float32Array(count * 2);

    const TOP = 22;
    const BOT = -2;
    let w = 0;
    for (let i = 0; i < count; i++) {
      // Choose a spawn column that is NOT under the platform roof.
      let x = 0;
      let z = 0;
      for (let tries = 0; tries < 8; tries++) {
        x = THREE.MathUtils.randFloat(-46, 46);
        z = THREE.MathUtils.randFloat(-16, 46);
        const underRoof = Math.abs(x) < L.ROOF_X && z > L.WALL_Z - 0.6 && z < L.ROOF_Z_FAR;
        if (!underRoof) break;
      }
      const y = THREE.MathUtils.randFloat(BOT, TOP);
      const len = THREE.MathUtils.randFloat(0.28, 0.75);
      for (let v = 0; v < 2; v++) {
        positions[w * 3 + 0] = x;
        positions[w * 3 + 1] = y;
        positions[w * 3 + 2] = z;
        seeds[w] = Math.random();
        sides[w] = v;
        lengths[w] = len;
        w++;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute('aSide', new THREE.BufferAttribute(sides, 1));
    geo.setAttribute('aLen', new THREE.BufferAttribute(lengths, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 8, 12), 90);

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uTop: { value: TOP },
        uSpan: { value: TOP - BOT },
        uWind: { value: new THREE.Vector2(0.18, 0.05) },
        uOpacity: { value: 0.34 },
        uColor: { value: new THREE.Color(0xaebfd2) },
        // Sheltered volumes: x = |x| extent of a roof, y/z = its z range.
        uRoof: { value: new THREE.Vector3(L.ROOF_X, L.WALL_Z - 0.8, L.ROOF_Z_FAR) },
        uRoof2: { value: new THREE.Vector3(15, L.OPP_Z_NEAR + 0.2, L.OPP_Z_FAR + 0.4) },
      },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        attribute float aSide;
        attribute float aLen;
        uniform float uTime, uTop, uSpan;
        uniform vec2 uWind;
        uniform vec3 uRoof;
        uniform vec3 uRoof2;
        varying float vFade;

        float shelter(vec3 p, vec3 roof) {
          return step(abs(p.x), roof.x) * step(roof.y, p.z) * step(p.z, roof.z);
        }
        void main() {
          float speed = 11.0 + aSeed * 9.0;
          vec3 p = position;
          float fall = mod(uTop - p.y + uTime * speed, uSpan);
          p.y = uTop - fall;
          p.x += fall * uWind.x;
          p.z += fall * uWind.y;
          p.y += aSide * aLen;
          p.x -= aSide * aLen * uWind.x;

          // Wind drift can carry a drop under the platform roof; reject by the
          // drop's *current* position rather than its spawn column.
          float sheltered = max(shelter(p, uRoof), shelter(p, uRoof2));

          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          vFade = smoothstep(42.0, 5.0, d) * smoothstep(-1.5, 1.5, p.y) * (1.0 - sheltered);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vFade;
        void main() {
          gl_FragColor = vec4(uColor, uOpacity * vFade);
        }
      `,
      transparent: true,
      depthWrite: false,
    });

    const lines = new THREE.LineSegments(geo, this.mat);
    lines.frustumCulled = false;
    this.group.add(lines);

    if (splashCount > 0) this.buildSplashes(splashCount);
  }

  /** Expanding ring impacts on the track bed and the uncovered platform ends. */
  private buildSplashes(count: number): void {
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      let x: number;
      let z: number;
      let y: number;
      if (Math.random() < 0.62) {
        x = THREE.MathUtils.randFloat(-30, 30);
        z = THREE.MathUtils.randFloat(L.TRACK_Z_NEAR, L.TRACK_Z_FAR);
        y = 0.06;
      } else {
        const north = Math.random() > 0.5;
        x = north
          ? THREE.MathUtils.randFloat(L.ROOF_X, L.HALF_LEN)
          : THREE.MathUtils.randFloat(-L.HALF_LEN, -L.ROOF_X);
        z = THREE.MathUtils.randFloat(L.WALL_Z + 0.3, L.EDGE_Z - 0.2);
        y = L.DECK_Y + 0.02;
      }
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 8), 70);

    this.splashMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x8ea8c4) },
        // pixels per world unit at 1 m for the current viewport height
        uScale: { value: innerHeight * 0.5 },
      },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime, uScale;
        varying float vA;
        void main() {
          float t = fract(uTime * (0.8 + aSeed * 0.7) + aSeed * 13.7);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float d = -mv.z;
          // ring grows to ~9 cm across — a raindrop impact, not a puddle
          float world = 0.02 + t * 0.075;
          vA = (1.0 - t) * smoothstep(26.0, 2.0, d);
          gl_PointSize = clamp(world * uScale / max(d, 0.6), 1.0, 26.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float r = length(c) * 2.0;
          float ring = smoothstep(1.0, 0.7, r) * smoothstep(0.3, 0.8, r);
          gl_FragColor = vec4(uColor, ring * vA * 0.3);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    const pts = new THREE.Points(geo, this.splashMat);
    pts.frustumCulled = false;
    this.group.add(pts);
  }

  setIntensity(v: number): void {
    this.mat.uniforms.uOpacity.value = 0.34 * v;
  }

  /** Keep splash sprites the right size when the window is resized. */
  onResize(height: number): void {
    if (this.splashMat) this.splashMat.uniforms.uScale.value = height * 0.5;
  }

  setWind(x: number, z: number): void {
    this.mat.uniforms.uWind.value.set(x, z);
  }

  update(dt: number): void {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
    if (this.splashMat) this.splashMat.uniforms.uTime.value = this.time;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
    });
    this.mat.dispose();
    this.splashMat?.dispose();
  }
}
