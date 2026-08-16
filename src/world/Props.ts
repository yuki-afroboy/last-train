import * as THREE from 'three';
import { MaterialLibrary } from '../gfx/Materials';
import * as T from '../gfx/Textures';
import { cosmeticRNG as R } from '../core/RNG';

/**
 * Geometry builders for everything that stands on the platform.
 *
 * All props are built from primitives + PBR materials rather than downloaded
 * models: it keeps the payload tiny, and it means an anomaly can rebuild or
 * re-texture any of them at runtime without a loading hitch.
 */

const boxGeoCache = new Map<string, THREE.BoxGeometry>();
export function box(w: number, h: number, d: number): THREE.BoxGeometry {
  const k = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`;
  let g = boxGeoCache.get(k);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    boxGeoCache.set(k, g);
  }
  return g;
}

export function mesh(
  g: THREE.BufferGeometry,
  m: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  castShadow = true,
  receiveShadow = true,
): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = castShadow;
  o.receiveShadow = receiveShadow;
  return o;
}

/* ------------------------------------------------------------------ lamp */

export interface LampProp {
  group: THREE.Group;
  tube: THREE.Mesh;
  housing: THREE.Mesh;
  light: THREE.PointLight | null;
  material: THREE.MeshStandardMaterial;
  baseIntensity: number;
  baseEmissive: number;
  colorTemp: number;
  /** 0 = steady. Higher = more unstable. */
  flicker: number;
  on: boolean;
  phase: number;
  index: number;
}

/** Recessed fluorescent batten with a diffuser, hung from the roof. */
export function buildLamp(
  mats: MaterialLibrary,
  index: number,
  colorHex: number,
  withLight: boolean,
  castShadow: boolean,
): LampProp {
  const group = new THREE.Group();

  const housing = mesh(box(1.5, 0.14, 0.44), mats.paintedMetal('lamp', 0xd8dade, 0.55), 0, 0.09, 0, false, false);
  group.add(housing);

  const tubeMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: new THREE.Color(colorHex),
    emissiveIntensity: 2.4,
    roughness: 0.9,
    metalness: 0,
  });
  const tube = mesh(box(1.38, 0.055, 0.3), tubeMat, 0, 0.005, 0, false, false);
  group.add(tube);

  let light: THREE.PointLight | null = null;
  if (withLight) {
    light = new THREE.PointLight(colorHex, 14, 20, 2);
    light.position.set(0, -0.16, 0);
    if (castShadow) {
      light.castShadow = true;
      light.shadow.bias = -0.0016;
      light.shadow.normalBias = 0.028;
      light.shadow.camera.near = 0.2;
      light.shadow.camera.far = 9;
    }
    group.add(light);
  }

  // small hanging rods
  for (const dx of [-0.55, 0.55]) {
    group.add(mesh(box(0.03, 0.28, 0.03), mats.darkSteel, dx, 0.29, 0, false, false));
  }

  return {
    group,
    tube,
    housing,
    light,
    material: tubeMat,
    baseIntensity: light?.intensity ?? 0,
    baseEmissive: 2.4,
    colorTemp: colorHex,
    flicker: 0,
    on: true,
    phase: R.range(0, 100),
    index,
  };
}

/* ----------------------------------------------------------------- bench */

export function buildBench(mats: MaterialLibrary): THREE.Group {
  const g = new THREE.Group();
  const frame = mats.darkSteel;
  const seat = mats.paintedMetal('bench', 0x2f4e6e, 0.55);

  for (let i = 0; i < 4; i++) {
    g.add(mesh(box(1.72, 0.045, 0.09), seat, 0, 0.44, -0.165 + i * 0.11, true, false));
  }
  for (let i = 0; i < 4; i++) {
    g.add(mesh(box(1.72, 0.09, 0.045), seat, 0, 0.62 + i * 0.105, -0.24, true, false));
  }
  for (const dx of [-0.72, 0.72]) {
    g.add(mesh(box(0.06, 0.44, 0.5), frame, dx, 0.22, -0.02));
    g.add(mesh(box(0.06, 0.42, 0.06), frame, dx, 0.66, -0.25, true, false));
  }
  g.add(mesh(box(1.5, 0.05, 0.06), frame, 0, 0.06, -0.02, false, false));
  return g;
}

/* -------------------------------------------------------- vending machine */

export interface VendingProp {
  group: THREE.Group;
  front: THREE.Mesh;
  frontMat: THREE.MeshStandardMaterial;
  light: THREE.PointLight;
  products: string[][];
  variant: number;
}

const PRODUCT_PALETTES = [
  ['#d8362a', '#f0a020', '#2e7d5b', '#2360a8', '#e8e2d2'],
  ['#1f4fa8', '#c9302c', '#e0d64a', '#3aa06c', '#7a4ba8'],
  ['#f2f0e6', '#c2392b', '#2a7f4f', '#e08a1e', '#28527a'],
];

export function buildVending(mats: MaterialLibrary, variant = 0): VendingProp {
  const group = new THREE.Group();
  const bodyMat = mats.paintedMetal(`vend${variant}`, variant === 1 ? 0x123048 : 0x8e1218, 0.45);

  const W = 1.12;
  const H = 1.95;
  const D = 0.78;
  group.add(mesh(box(W, H, D), bodyMat, 0, H / 2, 0));
  group.add(mesh(box(W + 0.06, 0.08, D + 0.04), mats.darkSteel, 0, 0.04, 0));

  const products = [
    [R.pick(PRODUCT_PALETTES[0]), R.pick(PRODUCT_PALETTES[1]), R.pick(PRODUCT_PALETTES[2]), R.pick(PRODUCT_PALETTES[0]), R.pick(PRODUCT_PALETTES[1])],
    [R.pick(PRODUCT_PALETTES[1]), R.pick(PRODUCT_PALETTES[2]), R.pick(PRODUCT_PALETTES[0]), R.pick(PRODUCT_PALETTES[1]), R.pick(PRODUCT_PALETTES[2])],
    [R.pick(PRODUCT_PALETTES[2]), R.pick(PRODUCT_PALETTES[0]), R.pick(PRODUCT_PALETTES[1]), R.pick(PRODUCT_PALETTES[2]), R.pick(PRODUCT_PALETTES[0])],
  ];

  const tex = T.vendingFront(products, variant);
  const frontMat = new THREE.MeshStandardMaterial({
    map: tex,
    emissive: 0xffffff,
    emissiveMap: tex,
    emissiveIntensity: 0.7,
    roughness: 0.28,
    metalness: 0.1,
  });
  const front = mesh(new THREE.PlaneGeometry(W * 0.98, H * 0.96), frontMat, 0, H / 2, D / 2 + 0.008, false, false);
  group.add(front);

  const light = new THREE.PointLight(0xffe7c4, 10, 9, 2);
  light.position.set(0, H * 0.62, D / 2 + 0.7);
  group.add(light);

  return { group, front, frontMat, light, products, variant };
}

/* -------------------------------------------------------------- trash bin */

export function buildBin(mats: MaterialLibrary): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = mats.paintedMetal('bin', 0x39424c, 0.6);
  const body = mesh(new THREE.CylinderGeometry(0.26, 0.23, 0.86, 14), bodyMat, 0, 0.43, 0);
  g.add(body);
  g.add(mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 14), mats.darkSteel, 0, 0.89, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.05, 12), mats.rubber, 0, 0.925, 0, false, false));
  const plate = mesh(
    new THREE.PlaneGeometry(0.3, 0.12),
    mats.signage(T.labelPlate('もえるごみ', { bg: '#1d5aa8', fg: '#ffffff', w: 256, h: 96 })),
    0,
    0.62,
    0.262,
    false,
    false,
  );
  g.add(plate);
  return g;
}

/* -------------------------------------------------------- security camera */

export interface CameraProp {
  group: THREE.Group;
  head: THREE.Group;
  baseYaw: number;
  basePitch: number;
  tracking: boolean;
  led: THREE.Mesh;
}

export function buildSecurityCamera(mats: MaterialLibrary, baseYaw: number): CameraProp {
  const group = new THREE.Group();
  group.add(mesh(box(0.07, 0.3, 0.07), mats.darkSteel, 0, -0.15, 0, false, false));
  const arm = mesh(box(0.05, 0.05, 0.24), mats.darkSteel, 0, -0.3, 0.1, false, false);
  group.add(arm);

  const head = new THREE.Group();
  head.position.set(0, -0.3, 0.2);
  const bodyMat = mats.paintedMetal('cam', 0xd7d9dc, 0.5);
  head.add(mesh(box(0.15, 0.14, 0.36), bodyMat, 0, 0, 0, false, false));
  head.add(mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.06, 12), mats.rubber, 0, 0, 0.2, false, false));
  const lens = mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.02, 12), mats.glass, 0, 0, 0.225, false, false);
  head.add(lens);
  head.children.forEach((c) => {
    if (c !== lens) c.rotation.x = Math.PI / 2;
  });
  lens.rotation.x = Math.PI / 2;
  // sunshade
  head.add(mesh(box(0.17, 0.02, 0.34), bodyMat, 0, 0.085, 0.01, false, false));

  const ledMat = new THREE.MeshStandardMaterial({
    color: 0x220000,
    emissive: 0xff2a1a,
    emissiveIntensity: 1.4,
    roughness: 0.5,
  });
  const led = mesh(new THREE.SphereGeometry(0.012, 8, 6), ledMat, 0.05, 0.02, 0.19, false, false);
  head.add(led);

  head.rotation.y = baseYaw;
  head.rotation.x = -0.22;
  group.add(head);

  return { group, head, baseYaw, basePitch: -0.22, tracking: false, led };
}

/* ------------------------------------------------------------- speaker */

export function buildSpeaker(mats: MaterialLibrary): THREE.Group {
  const g = new THREE.Group();
  const m = mats.paintedMetal('speaker', 0xb9bcc0, 0.6);
  const cone = mesh(new THREE.CylinderGeometry(0.17, 0.1, 0.24, 14, 1, true), m, 0, 0, 0, false, false);
  cone.rotation.x = Math.PI / 2;
  g.add(cone);
  g.add(mesh(new THREE.CircleGeometry(0.1, 14), mats.rubber, 0, 0, -0.11, false, false));
  g.add(mesh(box(0.05, 0.16, 0.05), mats.darkSteel, 0, 0.16, -0.02, false, false));
  return g;
}

/* --------------------------------------------------------------- clock */

export interface ClockProp {
  group: THREE.Group;
  hour: THREE.Object3D;
  minute: THREE.Object3D;
  second: THREE.Object3D;
  faceMat: THREE.MeshStandardMaterial;
  /** displayed time in seconds since 0:00 */
  time: number;
  /** multiplier on the second hand: 1 normal, -1 reversed, 0 stopped */
  rate: number;
  freezeWhenObserved: boolean;
  hidden: boolean;
}

/** Double-sided round platform clock hung under the roof. */
export function buildClock(mats: MaterialLibrary): ClockProp {
  const group = new THREE.Group();
  const R2 = 0.42;

  const caseMat = mats.paintedMetal('clockcase', 0x2b2f33, 0.55);
  group.add(mesh(new THREE.CylinderGeometry(R2 + 0.04, R2 + 0.04, 0.13, 28), caseMat, 0, 0, 0));
  group.children[0].rotation.x = Math.PI / 2;

  const faceTex = T.clockFace();
  const faceMat = new THREE.MeshStandardMaterial({
    map: faceTex,
    emissive: 0xffffff,
    emissiveMap: faceTex,
    emissiveIntensity: 0.22,
    roughness: 0.42,
    metalness: 0.0,
  });

  const hands = new THREE.Group();
  const makeFace = (dir: number): THREE.Group => {
    const f = new THREE.Group();
    const face = mesh(new THREE.CircleGeometry(R2, 32), faceMat, 0, 0, 0.068 * dir, false, false);
    if (dir < 0) face.rotation.y = Math.PI;
    f.add(face);

    const handMat = new THREE.MeshStandardMaterial({ color: 0x1a1d20, roughness: 0.5, metalness: 0.2 });
    const secMat = new THREE.MeshStandardMaterial({ color: 0xb4231d, roughness: 0.5, metalness: 0.2 });

    const mk = (len: number, w: number, mat: THREE.Material, back: number): THREE.Object3D => {
      const pivot = new THREE.Object3D();
      const bar = mesh(box(w, len, 0.012), mat, 0, len / 2 - back, 0.075 * dir, false, false);
      pivot.add(bar);
      f.add(pivot);
      return pivot;
    };
    const h = mk(R2 * 0.52, 0.032, handMat, 0.04);
    const m = mk(R2 * 0.78, 0.022, handMat, 0.05);
    const s = mk(R2 * 0.84, 0.009, secMat, 0.08);
    f.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 10), handMat, 0, 0, 0.082 * dir, false, false));
    (f.children[f.children.length - 1] as THREE.Mesh).rotation.x = Math.PI / 2;
    f.userData.hands = { h, m, s };
    return f;
  };

  const front = makeFace(1);
  const back = makeFace(-1);
  back.rotation.y = Math.PI;
  hands.add(front, back);
  group.add(hands);

  // hanging bracket
  group.add(mesh(box(0.05, 0.5, 0.05), mats.darkSteel, 0, 0.66, 0, false, false));

  const hf = front.userData.hands as { h: THREE.Object3D; m: THREE.Object3D; s: THREE.Object3D };
  const hb = back.userData.hands as { h: THREE.Object3D; m: THREE.Object3D; s: THREE.Object3D };

  // proxy objects that drive both faces at once
  const proxy = (a: THREE.Object3D, b: THREE.Object3D): THREE.Object3D => {
    const p = new THREE.Object3D();
    p.userData.link = [a, b];
    return p;
  };

  const prop: ClockProp = {
    group,
    hour: proxy(hf.h, hb.h),
    minute: proxy(hf.m, hb.m),
    second: proxy(hf.s, hb.s),
    faceMat,
    time: 13 * 60,
    rate: 1,
    freezeWhenObserved: false,
    hidden: false,
  };
  return prop;
}

export function applyClockTime(c: ClockProp): void {
  const t = c.time;
  const sec = ((t % 60) + 60) % 60;
  const min = (Math.floor(t / 60) % 60 + 60) % 60;
  const hr = (Math.floor(t / 3600) % 12 + 12) % 12;
  const set = (p: THREE.Object3D, angle: number): void => {
    for (const o of p.userData.link as THREE.Object3D[]) o.rotation.z = -angle;
  };
  set(c.second, (sec / 60) * Math.PI * 2);
  set(c.minute, ((min + sec / 60) / 60) * Math.PI * 2);
  set(c.hour, ((hr + min / 60) / 12) * Math.PI * 2);
}

/* ------------------------------------------------------------- pillar */

export interface PillarProp {
  group: THREE.Group;
  plate: THREE.Mesh;
  number: number;
}

export function buildPillar(mats: MaterialLibrary, height: number, num: number): PillarProp {
  const group = new THREE.Group();
  const m = mats.paintedMetal('pillar', 0xb2afa5, 0.6);
  const col = mesh(box(0.34, height, 0.34), m, 0, height / 2, 0);
  group.add(col);
  group.add(mesh(box(0.5, 0.1, 0.5), mats.darkSteel, 0, 0.05, 0));
  group.add(mesh(box(0.5, 0.08, 0.5), mats.darkSteel, 0, height - 0.04, 0, false, false));

  const plate = mesh(
    new THREE.PlaneGeometry(0.26, 0.14),
    mats.signage(T.labelPlate(String(num), { bg: '#f0efe9', fg: '#23262a', w: 192, h: 112, font: T.MONO_FONT })),
    0,
    1.62,
    -0.176,
    false,
    false,
  );
  plate.rotation.y = Math.PI;
  group.add(plate);
  return { group, plate, number: num };
}

/* -------------------------------------------------------- station sign */

export interface SignProp {
  group: THREE.Group;
  panelA: THREE.Mesh;
  panelB: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  spec: T.StationSignSpec;
}

export function buildStationSign(mats: MaterialLibrary, spec: T.StationSignSpec): SignProp {
  const group = new THREE.Group();
  const tex = T.stationSign(spec);
  const material = new THREE.MeshStandardMaterial({
    map: tex,
    emissive: 0xffffff,
    emissiveMap: tex,
    emissiveIntensity: 0.3,
    roughness: 0.42,
    metalness: 0.05,
  });

  const W = 1.86;
  const H = 0.58;
  const frame = mesh(box(W + 0.06, H + 0.06, 0.09), mats.darkSteel, 0, 2.05, 0);
  group.add(frame);
  const panelA = mesh(new THREE.PlaneGeometry(W, H), material, 0, 2.05, 0.048, false, false);
  const panelB = mesh(new THREE.PlaneGeometry(W, H), material, 0, 2.05, -0.048, false, false);
  panelB.rotation.y = Math.PI;
  group.add(panelA, panelB);

  group.add(mesh(box(0.08, 2.05, 0.08), mats.darkSteel, 0, 1.02, 0));
  group.add(mesh(box(0.26, 0.06, 0.26), mats.darkSteel, 0, 0.03, 0));
  return { group, panelA, panelB, material, spec };
}

export function setSignSpec(sign: SignProp, spec: T.StationSignSpec): void {
  sign.spec = spec;
  const tex = T.stationSign(spec);
  sign.material.map?.dispose();
  sign.material.map = tex;
  sign.material.emissiveMap = tex;
  sign.material.needsUpdate = true;
}

/* ------------------------------------------------------ departure board */

export interface BoardRow {
  time: string;
  type: string;
  dest: string;
  cars: string;
}

export interface BoardProp {
  group: THREE.Group;
  material: THREE.MeshStandardMaterial;
  rows: BoardRow[];
}

export function buildBoard(mats: MaterialLibrary, rows: BoardRow[]): BoardProp {
  const group = new THREE.Group();
  const tex = T.departureBoard(rows);
  const material = new THREE.MeshStandardMaterial({
    map: tex,
    emissive: 0xffffff,
    emissiveMap: tex,
    emissiveIntensity: 1.3,
    roughness: 0.3,
    metalness: 0.0,
  });
  const W = 2.6;
  const H = 0.82;
  group.add(mesh(box(W + 0.1, H + 0.1, 0.14), mats.darkSteel, 0, 0, 0, true, false));
  const a = mesh(new THREE.PlaneGeometry(W, H), material, 0, 0, 0.072, false, false);
  const b = mesh(new THREE.PlaneGeometry(W, H), material, 0, 0, -0.072, false, false);
  b.rotation.y = Math.PI;
  group.add(a, b);
  for (const dx of [-0.9, 0.9]) {
    group.add(mesh(box(0.04, 0.42, 0.04), mats.darkSteel, dx, 0.62, 0, false, false));
  }
  return { group, material, rows };
}

export function setBoardRows(board: BoardProp, rows: BoardRow[]): void {
  board.rows = rows;
  const tex = T.departureBoard(rows);
  board.material.map?.dispose();
  board.material.map = tex;
  board.material.emissiveMap = tex;
  board.material.needsUpdate = true;
}

/* ------------------------------------------------------ misc fixtures */

export function buildEmergencyButton(mats: MaterialLibrary): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(box(0.08, 1.15, 0.08), mats.darkSteel, 0, 0.575, 0));
  const boxMat = mats.paintedMetal('estop', 0xd9c21c, 0.55);
  g.add(mesh(box(0.3, 0.36, 0.18), boxMat, 0, 1.28, 0));
  const btn = new THREE.MeshStandardMaterial({
    color: 0xd11a1a,
    emissive: 0x7a0d0d,
    emissiveIntensity: 0.9,
    roughness: 0.4,
    metalness: 0.1,
  });
  const b = mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.05, 14), btn, 0, 1.3, 0.1, false, false);
  b.rotation.x = Math.PI / 2;
  g.add(b);
  const plate = mesh(
    new THREE.PlaneGeometry(0.26, 0.09),
    mats.signage(T.labelPlate('非常停止', { bg: '#d9c21c', fg: '#1a1a1a', w: 256, h: 96 })),
    0,
    1.42,
    0.092,
    false,
    false,
  );
  g.add(plate);
  return g;
}

export function buildUmbrella(mats: MaterialLibrary): THREE.Group {
  const g = new THREE.Group();
  const fabric = new THREE.MeshStandardMaterial({
    color: 0x2a3d5c,
    roughness: 0.6,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  const body = mesh(new THREE.CylinderGeometry(0.045, 0.075, 0.7, 10), fabric, 0, 0.35, 0);
  g.add(body);
  g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.28, 8), mats.darkSteel, 0, 0.82, 0));
  const handle = mesh(new THREE.TorusGeometry(0.055, 0.012, 6, 12, Math.PI), mats.wood, 0, 0.96, 0);
  handle.rotation.y = Math.PI / 2;
  g.add(handle);
  g.rotation.z = 0.16;
  return g;
}

/** Wall-mounted framed poster / notice. */
export function buildPoster(
  mats: MaterialLibrary,
  tex: THREE.Texture,
  w: number,
  h: number,
  framed = true,
): { group: THREE.Group; mesh: THREE.Mesh; material: THREE.MeshStandardMaterial } {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.66,
    metalness: 0.02,
  });
  if (framed) {
    group.add(mesh(box(w + 0.07, h + 0.07, 0.035), mats.paintedMetal('frame', 0x8d9297, 0.5), 0, 0, 0, true, false));
  }
  const m = mesh(new THREE.PlaneGeometry(w, h), material, 0, 0, framed ? 0.02 : 0.006, false, false);
  group.add(m);
  return { group, mesh: m, material };
}

export function setPosterTexture(
  entry: { material: THREE.MeshStandardMaterial },
  tex: THREE.Texture,
): void {
  entry.material.map?.dispose();
  entry.material.map = tex;
  entry.material.needsUpdate = true;
}

/** Stair flight with side walls and a handrail. */
export function buildStairs(
  mats: MaterialLibrary,
  steps: number,
  rise: number,
  run: number,
  width: number,
  dir: 1 | -1,
): THREE.Group {
  const g = new THREE.Group();
  const stepH = rise / steps;
  const stepD = run / steps;
  const tread = mats.concrete;
  for (let i = 0; i < steps; i++) {
    const y = (i + 0.5) * stepH;
    const x = dir * (i + 0.5) * stepD;
    g.add(mesh(box(stepD, stepH, width), tread, x, y, 0));
  }
  // nosing strips (anti-slip)
  const nose = mats.paintedMetal('nose', 0xc8a92a, 0.6);
  for (let i = 0; i < steps; i++) {
    g.add(mesh(box(0.05, 0.012, width * 0.94), nose, dir * ((i + 1) * stepD - 0.03), (i + 1) * stepH + 0.007, 0, false, false));
  }
  // handrail
  for (const side of [-1, 1]) {
    const railGeo = new THREE.CylinderGeometry(0.028, 0.028, Math.hypot(run, rise) + 0.2, 8);
    const rail = new THREE.Mesh(railGeo, mats.steel);
    rail.position.set((dir * run) / 2, rise / 2 + 0.95, (side * width) / 2 - side * 0.1);
    rail.rotation.z = dir * (Math.PI / 2 - Math.atan2(rise, run));
    rail.castShadow = true;
    g.add(rail);
    for (let i = 0; i <= 3; i++) {
      const t = i / 3;
      g.add(
        mesh(
          box(0.035, 0.95, 0.035),
          mats.steel,
          dir * run * t,
          rise * t + 0.48,
          (side * width) / 2 - side * 0.1,
          false,
          false,
        ),
      );
    }
  }
  return g;
}

/** Chain-link style fence built from thin bars (cheap, reads correctly at night). */
export function buildFence(mats: MaterialLibrary, length: number, height: number): THREE.Group {
  const g = new THREE.Group();
  const m = mats.darkSteel;
  const posts = Math.max(2, Math.round(length / 2.4));
  for (let i = 0; i <= posts; i++) {
    g.add(mesh(box(0.06, height, 0.06), m, -length / 2 + (i * length) / posts, height / 2, 0, false, false));
  }
  for (const y of [height * 0.32, height * 0.66, height - 0.03]) {
    g.add(mesh(box(length, 0.035, 0.035), m, 0, y, 0, false, false));
  }
  return g;
}
