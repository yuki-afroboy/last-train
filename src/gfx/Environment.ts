import * as THREE from 'three';
import { makeCanvas } from './Textures';

/**
 * Procedural night-sky environment map.
 *
 * PBR materials need *something* in the environment or metals read as flat
 * black. A real HDRI would be a multi-MB download; a hand-painted equirect
 * gradient (overcast sky + sodium-orange town glow at the horizon) gives the
 * right reflections for a rainy suburban night at ~0 cost.
 */
export function buildNightEnvironment(renderer: THREE.WebGLRenderer): {
  envMap: THREE.Texture;
  skyTexture: THREE.Texture;
  dispose: () => void;
} {
  const W = 512;
  const H = 256;
  const { c, x } = makeCanvas(W, H);

  // sky: heavy overcast, lit from below by the town
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0.0, '#05070d');
  g.addColorStop(0.42, '#0a1019');
  g.addColorStop(0.5, '#141d28');
  g.addColorStop(0.54, '#1d2029');
  g.addColorStop(0.62, '#0d1016');
  g.addColorStop(1.0, '#05070a');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);

  // low cloud belly catching sodium light
  for (let i = 0; i < 26; i++) {
    const cx = Math.random() * W;
    const cy = H * (0.34 + Math.random() * 0.16);
    const r = 30 + Math.random() * 90;
    const cg = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    const warm = Math.random() > 0.45;
    cg.addColorStop(0, warm ? 'rgba(120,84,52,0.16)' : 'rgba(70,88,112,0.14)');
    cg.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = cg;
    x.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  // horizon glow band (town lights bouncing off the cloud base)
  const hg = x.createLinearGradient(0, H * 0.44, 0, H * 0.56);
  hg.addColorStop(0, 'rgba(90,64,38,0)');
  hg.addColorStop(0.5, 'rgba(118,84,46,0.42)');
  hg.addColorStop(1, 'rgba(20,24,32,0)');
  x.fillStyle = hg;
  x.fillRect(0, H * 0.44, W, H * 0.12);

  const equirect = new THREE.CanvasTexture(c);
  equirect.mapping = THREE.EquirectangularReflectionMapping;
  equirect.colorSpace = THREE.SRGBColorSpace;
  equirect.needsUpdate = true;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const rt = pmrem.fromEquirectangular(equirect);
  pmrem.dispose();

  return {
    envMap: rt.texture,
    skyTexture: equirect,
    dispose: () => {
      rt.dispose();
      equirect.dispose();
    },
  };
}
