import * as THREE from 'three';
import * as T from './Textures';

/**
 * Shared PBR material library. Built once per session; anomalies mutate clones
 * or swap maps rather than rebuilding, so texture generation cost is paid only
 * during the loading screen.
 */
export class MaterialLibrary {
  private cache = new Map<string, THREE.Material>();
  envMap: THREE.Texture | null = null;

  private mem<M extends THREE.Material>(key: string, make: () => M): M {
    const hit = this.cache.get(key);
    if (hit) return hit as M;
    const m = make();
    this.cache.set(key, m);
    return m;
  }

  private std(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial(params);
    if (this.envMap) {
      m.envMap = this.envMap;
      m.envMapIntensity = params.envMapIntensity ?? 0.55;
    }
    return m;
  }

  /** Platform deck. Wetness is folded into the roughness map + a metalness lift. */
  get concrete(): THREE.MeshStandardMaterial {
    return this.mem('concrete', () => {
      const s = T.concreteDeck();
      s.map.repeat.set(9, 2);
      s.roughnessMap!.repeat.set(9, 2);
      s.normalMap!.repeat.set(18, 4);
      return this.std({
        map: s.map,
        roughnessMap: s.roughnessMap,
        normalMap: s.normalMap,
        normalScale: new THREE.Vector2(0.55, 0.55),
        roughness: 0.88,
        metalness: 0.06,
        color: 0x767b81,
        envMapIntensity: 0.4,
      });
    });
  }

  /** Same deck but wetter — used for the uncovered ends of the platform. */
  get concreteWet(): THREE.MeshStandardMaterial {
    return this.mem('concreteWet', () => {
      const m = this.concrete.clone();
      m.roughness = 0.36;
      m.metalness = 0.34;
      m.color = new THREE.Color(0x60666d);
      m.envMapIntensity = 1.1;
      return m;
    });
  }

  get tactile(): THREE.MeshStandardMaterial {
    return this.mem('tactile', () => {
      const s = T.tactilePaving();
      s.map.repeat.set(46, 1);
      s.roughnessMap!.repeat.set(46, 1);
      s.normalMap!.repeat.set(46, 1);
      return this.std({
        map: s.map,
        roughnessMap: s.roughnessMap,
        normalMap: s.normalMap,
        normalScale: new THREE.Vector2(0.8, 0.8),
        roughness: 0.62,
        metalness: 0.05,
        envMapIntensity: 0.5,
      });
    });
  }

  get wall(): THREE.MeshStandardMaterial {
    return this.mem('wall', () => {
      const s = T.wallTile();
      s.map.repeat.set(10, 1.2);
      s.roughnessMap!.repeat.set(10, 1.2);
      s.normalMap!.repeat.set(10, 1.2);
      return this.std({
        map: s.map,
        roughnessMap: s.roughnessMap,
        normalMap: s.normalMap,
        normalScale: new THREE.Vector2(0.4, 0.4),
        roughness: 0.6,
        metalness: 0.05,
        color: 0x7a7f83,
        envMapIntensity: 0.35,
      });
    });
  }

  get ballast(): THREE.MeshStandardMaterial {
    return this.mem('ballast', () => {
      const s = T.ballast();
      s.map.repeat.set(14, 2);
      s.roughnessMap!.repeat.set(14, 2);
      s.normalMap!.repeat.set(14, 2);
      return this.std({
        map: s.map,
        roughnessMap: s.roughnessMap,
        normalMap: s.normalMap,
        normalScale: new THREE.Vector2(1.1, 1.1),
        roughness: 0.94,
        metalness: 0.02,
        color: 0x585d63,
        envMapIntensity: 0.25,
      });
    });
  }

  get wetGround(): THREE.MeshStandardMaterial {
    return this.mem('wetGround', () => {
      const s = T.wetAsphalt();
      s.map.repeat.set(10, 10);
      s.roughnessMap!.repeat.set(10, 10);
      return this.std({
        map: s.map,
        roughnessMap: s.roughnessMap,
        roughness: 0.3,
        metalness: 0.5,
        color: 0x51585f,
        envMapIntensity: 1.4,
      });
    });
  }

  get steel(): THREE.MeshStandardMaterial {
    return this.mem('steel', () =>
      this.std({ color: 0x8d949c, roughness: 0.42, metalness: 0.92, envMapIntensity: 1.0 }),
    );
  }

  get railSteel(): THREE.MeshStandardMaterial {
    return this.mem('railSteel', () =>
      this.std({ color: 0xb9c0c8, roughness: 0.2, metalness: 1.0, envMapIntensity: 1.5 }),
    );
  }

  get darkSteel(): THREE.MeshStandardMaterial {
    return this.mem('darkSteel', () =>
      this.std({ color: 0x3a3f45, roughness: 0.55, metalness: 0.85, envMapIntensity: 0.7 }),
    );
  }

  paintedMetal(key: string, hex: number, roughness = 0.5): THREE.MeshStandardMaterial {
    return this.mem(`paint:${key}`, () => {
      const s = T.paintedMetal('#' + hex.toString(16).padStart(6, '0'));
      s.map.repeat.set(2, 2);
      s.roughnessMap!.repeat.set(2, 2);
      return this.std({
        map: s.map,
        roughnessMap: s.roughnessMap,
        roughness,
        metalness: 0.55,
        envMapIntensity: 0.7,
      });
    });
  }

  get roofMetal(): THREE.MeshStandardMaterial {
    return this.mem('roofMetal', () =>
      this.std({ color: 0x373d45, roughness: 0.78, metalness: 0.5, envMapIntensity: 0.3, side: THREE.DoubleSide }),
    );
  }

  get wood(): THREE.MeshStandardMaterial {
    return this.mem('wood', () =>
      this.std({ color: 0x6b5a45, roughness: 0.78, metalness: 0.0, envMapIntensity: 0.3 }),
    );
  }

  get glass(): THREE.MeshPhysicalMaterial {
    return this.mem('glass', () => {
      const m = new THREE.MeshPhysicalMaterial({
        color: 0xcdd9e6,
        roughness: 0.05,
        metalness: 0.0,
        transmission: 0.0,
        transparent: true,
        opacity: 0.18,
        envMapIntensity: 2.2,
        side: THREE.FrontSide,
      });
      if (this.envMap) m.envMap = this.envMap;
      return m;
    });
  }

  get rubber(): THREE.MeshStandardMaterial {
    return this.mem('rubber', () =>
      this.std({ color: 0x1a1c20, roughness: 0.92, metalness: 0.0, envMapIntensity: 0.15 }),
    );
  }

  /** Emissive surface for lamp tubes, signs and screens. */
  emissive(key: string, color: number, intensity = 2.2, mapTex?: THREE.Texture): THREE.MeshStandardMaterial {
    return this.mem(`emis:${key}`, () => {
      const m = new THREE.MeshStandardMaterial({
        color: mapTex ? 0xffffff : color,
        map: mapTex ?? null,
        emissive: new THREE.Color(color),
        emissiveMap: mapTex ?? null,
        emissiveIntensity: intensity,
        roughness: 0.35,
        metalness: 0.0,
        toneMapped: true,
      });
      return m;
    });
  }

  /**
   * Unlit signage: canvas texture lit only by the scene. The albedo multiplier
   * keeps near-white plates from clipping when they sit close under a lamp.
   */
  signage(tex: THREE.Texture, roughness = 0.66): THREE.MeshStandardMaterial {
    return this.std({
      map: tex,
      color: 0xa8a8a3,
      roughness,
      metalness: 0.04,
      envMapIntensity: 0.4,
    });
  }

  applyEnv(env: THREE.Texture): void {
    this.envMap = env;
    for (const m of this.cache.values()) {
      const mm = m as THREE.MeshStandardMaterial;
      if ('envMap' in mm) {
        mm.envMap = env;
        mm.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
  }
}
