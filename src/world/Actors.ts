import * as THREE from 'three';
import { MaterialLibrary } from '../gfx/Materials';
import { box, mesh } from './Props';
import * as T from '../gfx/Textures';

/**
 * The only two "living" things the game ever shows: a human figure and a train.
 * Both are deliberately low-detail — at this light level a silhouette reads as
 * more unsettling than a detailed model ever would, and it keeps the promise
 * that the station is empty.
 */

export interface FigureProp {
  group: THREE.Group;
  head: THREE.Object3D;
  material: THREE.MeshStandardMaterial;
}

export function buildFigure(
  opts: { color?: number; roughness?: number; eyes?: boolean; scale?: number } = {},
): FigureProp {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: opts.color ?? 0x14171d,
    roughness: opts.roughness ?? 0.86,
    metalness: 0.04,
  });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.44, 4, 10), material);
  torso.position.y = 1.16;
  torso.scale.set(1, 1, 0.66);
  group.add(torso);

  const hips = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.1, 3, 8), material);
  hips.position.y = 0.86;
  hips.scale.set(1, 1, 0.7);
  group.add(hips);

  const head = new THREE.Group();
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 12), material);
  skull.scale.set(1, 1.16, 1.02);
  head.add(skull);
  head.position.y = 1.58;
  group.add(head);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.06, 0.12, 8), material);
  neck.position.y = 1.45;
  group.add(neck);

  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.058, 0.5, 3, 8), material);
    arm.position.set(s * 0.235, 1.14, 0);
    arm.rotation.z = s * 0.06;
    group.add(arm);

    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.078, 0.6, 3, 8), material);
    leg.position.set(s * 0.1, 0.47, 0);
    group.add(leg);
  }

  if (opts.eyes) {
    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0xdfe9f7,
      emissiveIntensity: 1.6,
      roughness: 0.4,
    });
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), eyeMat);
      e.position.set(s * 0.042, 0.018, 0.105);
      head.add(e);
    }
  }

  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = false;
    }
  });

  const s = opts.scale ?? 1;
  group.scale.setScalar(s);
  return { group, head, material };
}

/* ------------------------------------------------------------------ train */

export interface TrainProp {
  group: THREE.Group;
  windows: THREE.MeshStandardMaterial;
  headlights: THREE.PointLight;
  /** doors slide open when this goes 0 -> 1 */
  doorOpen: number;
  doorLeft: THREE.Object3D[];
  doorRight: THREE.Object3D[];
  length: number;
}

/**
 * A commuter EMU: stainless body, a coloured band, lit windows and working
 * doors. Three cars is enough — the far end disappears into fog anyway.
 */
export function buildTrain(mats: MaterialLibrary, cars = 3, bandColor = 0x2f6fb5): TrainProp {
  const group = new THREE.Group();
  const CAR_LEN = 19.5;
  const W = 2.86;
  const H = 3.3;
  const FLOOR = 1.05;

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x9aa1a8,
    roughness: 0.34,
    metalness: 0.88,
    envMapIntensity: 1.1,
  });
  if (mats.envMap) bodyMat.envMap = mats.envMap;

  const windowMat = new THREE.MeshStandardMaterial({
    color: 0xdfe9f5,
    emissive: 0xd8e6f7,
    emissiveIntensity: 1.0,
    roughness: 0.18,
    metalness: 0.0,
  });
  const bandMat = new THREE.MeshStandardMaterial({ color: bandColor, roughness: 0.42, metalness: 0.5 });
  const doorLeft: THREE.Object3D[] = [];
  const doorRight: THREE.Object3D[] = [];

  for (let c = 0; c < cars; c++) {
    const cx = c * (CAR_LEN + 0.6);
    const car = new THREE.Group();
    car.position.x = cx;

    car.add(mesh(box(CAR_LEN, H, W), bodyMat, 0, FLOOR + H / 2, 0));
    car.add(mesh(box(CAR_LEN, 0.26, W + 0.03), bandMat, 0, FLOOR + 0.72, 0, false, false));
    car.add(mesh(box(CAR_LEN, 0.1, W + 0.03), bandMat, 0, FLOOR + 2.34, 0, false, false));

    // continuous window band on the platform side (+Z faces the platform)
    for (let i = 0; i < 6; i++) {
      const wx = -CAR_LEN / 2 + 2.4 + i * 2.85;
      for (const zz of [W / 2 + 0.015, -W / 2 - 0.015]) {
        const win = mesh(new THREE.PlaneGeometry(1.85, 0.95), windowMat, wx, FLOOR + 1.62, zz, false, false);
        if (zz < 0) win.rotation.y = Math.PI;
        car.add(win);
      }
    }

    // doors: two pairs per car
    for (const dxi of [-1, 1]) {
      const dx = dxi * 4.6;
      for (const zz of [W / 2 + 0.03, -W / 2 - 0.03]) {
        for (const side of [-1, 1]) {
          const leaf = new THREE.Group();
          const panel = mesh(box(0.68, 1.95, 0.06), bodyMat, 0, FLOOR + 1.05, 0, false, false);
          leaf.add(panel);
          const gw = mesh(new THREE.PlaneGeometry(0.5, 0.8), windowMat, 0, FLOOR + 1.52, zz > 0 ? 0.04 : -0.04, false, false);
          if (zz < 0) gw.rotation.y = Math.PI;
          leaf.add(gw);
          leaf.position.set(dx + side * 0.35, 0, zz);
          leaf.userData.closedX = leaf.position.x;
          leaf.userData.openX = leaf.position.x + side * 0.66;
          car.add(leaf);
          (side < 0 ? doorLeft : doorRight).push(leaf);
        }
      }
    }

    // bogies
    for (const bx of [-CAR_LEN / 2 + 3.2, CAR_LEN / 2 - 3.2]) {
      car.add(mesh(box(3.2, 0.55, 2.3), mats.darkSteel, bx, 0.72, 0, false, false));
      for (const wz of [-1.05, 1.05]) {
        for (const wx2 of [-1.05, 1.05]) {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.11, 12), mats.railSteel);
          wheel.rotation.x = Math.PI / 2;
          wheel.position.set(bx + wx2, 0.43, wz);
          car.add(wheel);
        }
      }
    }

    // roof aircon
    car.add(mesh(box(CAR_LEN * 0.8, 0.28, 1.6), mats.darkSteel, 0, FLOOR + H + 0.1, 0, false, false));

    // destination indicator
    const destTex = T.labelPlate(c === 0 ? '回送' : '各駅停車', {
      bg: '#0a0c10',
      fg: '#ffb84d',
      w: 256,
      h: 96,
    });
    const dest = mesh(new THREE.PlaneGeometry(1.1, 0.34), mats.emissive(`dest${c}`, 0xffffff, 0.8, destTex), -CAR_LEN / 2 + 1.6, FLOOR + 2.6, W / 2 + 0.02, false, false);
    car.add(dest);

    group.add(car);
  }

  const headlights = new THREE.PointLight(0xfff0d8, 0, 40, 2);
  headlights.position.set(-CAR_LEN / 2 - 0.4, FLOOR + 2.4, 0);
  group.add(headlights);

  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.material === bodyMat) m.castShadow = true;
  });

  return {
    group,
    windows: windowMat,
    headlights,
    doorOpen: 0,
    doorLeft,
    doorRight,
    length: cars * (CAR_LEN + 0.6),
  };
}

export function setTrainDoors(train: TrainProp, t: number): void {
  train.doorOpen = t;
  const e = t * t * (3 - 2 * t);
  for (const leaf of [...train.doorLeft, ...train.doorRight]) {
    const a = leaf.userData.closedX as number;
    const b = leaf.userData.openX as number;
    leaf.position.x = a + (b - a) * e;
  }
}
