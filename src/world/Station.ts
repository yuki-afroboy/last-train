import * as THREE from 'three';
import { MaterialLibrary } from '../gfx/Materials';
import * as T from '../gfx/Textures';
import { L, LAMP_XS, PILLAR_XS } from './Layout';
import * as P from './Props';
import { buildFigure, buildTrain, type FigureProp, type TrainProp } from './Actors';
import { Rain } from './Rain';
import type { QualityProfile } from '../core/Settings';
import { cosmeticRNG as R } from '../core/RNG';

export interface AABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Interactable {
  id: string;
  object: THREE.Object3D;
  /** world-space point the player must be near / look at */
  point: THREE.Vector3;
  radius: number;
  title: string;
  body: () => string;
}

export const STATION = {
  name: '霧崎',
  kana: 'きりさき',
  romaji: 'KIRISAKI',
  prev: '白岩',
  next: '夜見',
  lineColor: '#2f6fb5',
};

export const DEFAULT_BOARD: P.BoardRow[] = [
  { time: '00:13', type: '各駅停車', dest: '夜見', cars: '4両' },
  { time: '--:--', type: '本日の運転は終了しました', dest: '', cars: '' },
];

const RULES_POSTER: T.PosterSpec = {
  kind: 'rule',
  accent: '#1f4f8f',
  lines: [
    'ご利用のお客様へ',
    '・ホームに異変を見つけた場合は',
    '　引き返してください。',
    '',
    '・異変が見つからない場合は',
    '　そのままお進みください。',
    '',
    '・８回進むと、出口です。',
    '',
    '霧崎駅',
  ],
};

/**
 * The platform. Owns every object in the world, a baseline snapshot of the
 * "normal" state, and the per-frame animation of lamps, clock and cameras.
 *
 * AnomalyManager mutates this object freely; Station.resetToNormal() puts
 * everything back, so no anomaly needs to write an undo path.
 */
export class Station {
  readonly group = new THREE.Group();
  readonly colliders: AABB[] = [];
  readonly interactables: Interactable[] = [];

  // ---- named handles used by anomalies -------------------------------
  lamps: P.LampProp[] = [];
  pillars: P.PillarProp[] = [];
  benches: THREE.Group[] = [];
  vending: P.VendingProp[] = [];
  bins: THREE.Group[] = [];
  cameras: P.CameraProp[] = [];
  signs: P.SignProp[] = [];
  posters: { group: THREE.Group; mesh: THREE.Mesh; material: THREE.MeshStandardMaterial; spec: T.PosterSpec }[] = [];
  clock!: P.ClockProp;
  board!: P.BoardProp;
  exitSigns: { mesh: THREE.Mesh; material: THREE.MeshStandardMaterial }[] = [];
  speakers: THREE.Group[] = [];
  umbrella!: THREE.Group;
  oppositePlatform = new THREE.Group();
  oppositeLamps: P.LampProp[] = [];
  trackGroup = new THREE.Group();
  rails: THREE.Group[] = [];
  stairGroups: THREE.Group[] = [];
  farFigureAnchor = new THREE.Object3D();
  rain!: Rain;
  train: TrainProp | null = null;
  deckMesh!: THREE.Mesh;
  tactileMesh!: THREE.Mesh;
  fogRef!: THREE.FogExp2;

  /** spare props parked off-scene, borrowed by anomalies */
  spareVending!: P.VendingProp;
  spareBench!: THREE.Group;
  figures: FigureProp[] = [];

  // ---- mutable per-loop state ----------------------------------------
  /** extra scale applied along the platform (the "dimensions creep" anomaly) */
  stretch = 1;
  /** driven by AnomalyManager; consumed by cameras + special anomalies */
  playerPos = new THREE.Vector3();
  playerYaw = 0;
  /** progress 0..8, used for the tension curve */
  tension = 0;

  private snapshots: {
    obj: THREE.Object3D;
    p: THREE.Vector3;
    q: THREE.Quaternion;
    s: THREE.Vector3;
    v: boolean;
  }[] = [];
  private time = 0;
  private baseFogDensity = 0.0155;

  constructor(
    private mats: MaterialLibrary,
    private profile: QualityProfile,
    private scene: THREE.Scene,
  ) {}

  /* =============================================================== build */

  build(): void {
    this.scene.fog = this.fogRef = new THREE.FogExp2(0x0b1119, this.baseFogDensity);

    this.buildGround();
    this.buildDeck();
    this.buildBackWall();
    this.buildRoof();
    this.buildLamps();
    this.buildPillars();
    this.buildTrack();
    this.buildOppositePlatform();
    this.buildFurniture();
    this.buildSignage();
    this.buildStairwells();
    this.buildDistance();
    this.buildAmbientLights();

    this.rain = new Rain(this.profile.rainCount, this.profile.splashCount);
    this.group.add(this.rain.group);

    this.group.add(this.farFigureAnchor);
    this.scene.add(this.group);
    this.captureBaseline();
  }

  private add(o: THREE.Object3D): void {
    this.group.add(o);
  }

  private collide(minX: number, maxX: number, minZ: number, maxZ: number): void {
    this.colliders.push({ minX, maxX, minZ, maxZ });
  }

  // ------------------------------------------------------------- ground
  private buildGround(): void {
    const g = P.mesh(new THREE.PlaneGeometry(260, 260), this.mats.wetGround, 0, -0.62, 10, false, true);
    g.rotation.x = -Math.PI / 2;
    this.add(g);
  }

  // --------------------------------------------------------------- deck
  private buildDeck(): void {
    const len = L.HALF_LEN * 2;
    const width = L.EDGE_Z - L.WALL_Z;

    const deck = P.mesh(P.box(len, L.DECK_Y, width), this.mats.concrete, 0, L.DECK_Y / 2, (L.WALL_Z + L.EDGE_Z) / 2, false, true);
    this.deckMesh = deck;
    this.add(deck);

    // uncovered ends read as wet
    for (const sx of [-1, 1]) {
      const wet = P.mesh(
        new THREE.PlaneGeometry(L.HALF_LEN - L.ROOF_X, width - 0.1),
        this.mats.concreteWet,
        (sx * (L.HALF_LEN + L.ROOF_X)) / 2,
        L.DECK_Y + 0.004,
        (L.WALL_Z + L.EDGE_Z) / 2,
        false,
        true,
      );
      wet.rotation.x = -Math.PI / 2;
      this.add(wet);
    }

    // puddles under the open sky
    for (let i = 0; i < 12; i++) {
      const sx = R.bool() ? 1 : -1;
      const puddle = P.mesh(
        new THREE.CircleGeometry(R.range(0.35, 0.95), 16),
        this.puddleMaterial(),
        sx * R.range(L.ROOF_X, L.HALF_LEN - 0.6),
        L.DECK_Y + 0.008,
        R.range(L.WALL_Z + 0.6, L.EDGE_Z - 0.6),
        false,
        false,
      );
      puddle.rotation.x = -Math.PI / 2;
      puddle.scale.set(1, R.range(0.5, 1.4), 1);
      this.add(puddle);
    }

    // tactile paving strip
    const tactile = P.mesh(new THREE.PlaneGeometry(len, 0.6), this.mats.tactile, 0, L.DECK_Y + 0.012, L.TACTILE_Z, false, true);
    tactile.rotation.x = -Math.PI / 2;
    this.tactileMesh = tactile;
    this.add(tactile);

    // white platform-edge line + edge nosing
    const line = P.mesh(
      new THREE.PlaneGeometry(len, 0.12),
      new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.55, metalness: 0.05 }),
      0,
      L.DECK_Y + 0.014,
      L.EDGE_Z - 0.22,
      false,
      false,
    );
    line.rotation.x = -Math.PI / 2;
    this.add(line);
    this.add(P.mesh(P.box(len, 0.1, 0.14), this.mats.paintedMetal('edge', 0xd8d5c8, 0.6), 0, L.DECK_Y - 0.05, L.EDGE_Z - 0.07, false, false));

    // invisible barrier at the platform edge — the player never falls
    this.collide(-L.HALF_LEN - 1, L.HALF_LEN + 1, L.EDGE_Z - 0.12, L.EDGE_Z + 1);
  }

  private puddleMaterial(): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({
      color: 0x2a3038,
      roughness: 0.045,
      metalness: 0.85,
      envMapIntensity: 2.0,
      transparent: true,
      opacity: 0.85,
    });
    if (this.mats.envMap) m.envMap = this.mats.envMap;
    return m;
  }

  // ----------------------------------------------------------- back wall
  private buildBackWall(): void {
    const len = L.HALF_LEN * 2;
    const h = L.ROOF_Y - 0.1;
    const wall = P.mesh(P.box(len, h, 0.6), this.mats.wall, 0, h / 2, L.WALL_Z - 0.3, false, true);
    this.add(wall);
    this.collide(-L.HALF_LEN, L.HALF_LEN, L.WALL_Z - 0.62, L.WALL_Z + 0.06);

    // dado band
    this.add(P.mesh(P.box(len, 0.14, 0.64), this.mats.paintedMetal('dado', 0x4a5560, 0.6), 0, L.DECK_Y + 0.95, L.WALL_Z - 0.3, false, false));

    // drain pipes
    for (const x of [-13, -3, 8, 17]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, h, 8), this.mats.paintedMetal('pipe', 0x6f7378, 0.6));
      pipe.position.set(x, h / 2, L.WALL_Z + 0.08);
      pipe.castShadow = true;
      this.add(pipe);
    }
  }

  // --------------------------------------------------------------- roof
  private buildRoof(): void {
    const w = L.ROOF_Z_FAR - L.WALL_Z;
    const cz = (L.WALL_Z + L.ROOF_Z_FAR) / 2;

    const slab = P.mesh(P.box(L.ROOF_X * 2, 0.16, w), this.mats.roofMetal, 0, L.ROOF_Y + 0.08, cz, true, true);
    this.add(slab);

    // Corrugation ribs and main beams are dozens of identical boxes; instancing
    // them keeps the roof detailed without paying a draw call each.
    const ribMat = this.mats.paintedMetal('rib', 0x5a6068, 0.7);
    const ribXs: number[] = [];
    for (let x = -L.ROOF_X + 0.5; x < L.ROOF_X; x += 1.0) ribXs.push(x);
    this.add(instancedRow(P.box(0.06, 0.06, w), ribMat, ribXs, L.ROOF_Y - 0.03, cz));

    const beams = instancedRow(P.box(0.22, 0.34, w), this.mats.darkSteel, [...PILLAR_XS], L.ROOF_Y - 0.2, cz);
    beams.castShadow = true;
    this.add(beams);
    // longitudinal purlins
    for (const z of [L.WALL_Z + 0.6, 0.4, L.ROOF_Z_FAR - 0.9]) {
      this.add(P.mesh(P.box(L.ROOF_X * 2, 0.16, 0.14), this.mats.darkSteel, 0, L.ROOF_Y - 0.42, z, false, false));
    }
    // gutter + drips at the outer roof edge
    this.add(P.mesh(P.box(L.ROOF_X * 2, 0.18, 0.22), this.mats.darkSteel, 0, L.ROOF_Y - 0.02, L.ROOF_Z_FAR, false, false));
  }

  // -------------------------------------------------------------- lamps
  private buildLamps(): void {
    // Slightly different colour temperatures per fitting: real platforms are
    // never uniform, and the variation is what makes the light feel observed.
    const temps = [0xfdf6e6, 0xe9f2ff, 0xfff3dd, 0xf2f6ff, 0xfdf3e2, 0xe6efff, 0xfff0d6, 0xeef4ff, 0xfaf4e8];
    const step = this.profile.shadowCasters > 0 ? Math.ceil(LAMP_XS.length / this.profile.shadowCasters) : 999;
    const lightEvery = this.profile.pixelRatioCap <= 1 ? 2 : 1;

    LAMP_XS.forEach((x, i) => {
      const lamp = P.buildLamp(
        this.mats,
        i,
        temps[i % temps.length],
        i % lightEvery === 0,
        this.profile.shadows && i % step === 0,
      );
      lamp.group.position.set(x, L.ROOF_Y - 0.78, -0.35);
      if (lamp.light?.castShadow) {
        lamp.light.shadow.mapSize.set(this.profile.shadowMapSize, this.profile.shadowMapSize);
      }
      this.lamps.push(lamp);
      this.add(lamp.group);
    });
  }

  // ------------------------------------------------------------ pillars
  private buildPillars(): void {
    PILLAR_XS.forEach((x, i) => {
      const p = P.buildPillar(this.mats, L.ROOF_Y - L.DECK_Y - 0.36, i + 1);
      p.group.position.set(x, L.DECK_Y, 2.0);
      this.pillars.push(p);
      this.add(p.group);
      this.collide(x - 0.24, x + 0.24, 2.0 - 0.24, 2.0 + 0.24);
    });
  }

  // -------------------------------------------------------------- track
  private buildTrack(): void {
    const len = 150;
    const bedW = L.TRACK_Z_FAR - L.TRACK_Z_NEAR;
    const bed = P.mesh(new THREE.PlaneGeometry(len, bedW), this.mats.ballast, 0, -0.02, (L.TRACK_Z_NEAR + L.TRACK_Z_FAR) / 2, false, true);
    bed.rotation.x = -Math.PI / 2;
    this.trackGroup.add(bed);

    // sleepers (instanced — there are a lot of them)
    const sleeperGeo = P.box(0.24, 0.16, 2.4);
    const sleeperCount = 190;
    const inst = new THREE.InstancedMesh(sleeperGeo, this.mats.wood, sleeperCount);
    inst.castShadow = false;
    inst.receiveShadow = true;
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < sleeperCount; i++) {
      m4.makeTranslation(-len / 2 + i * (len / sleeperCount), 0.06, (L.RAIL_Z_A + L.RAIL_Z_B) / 2);
      inst.setMatrixAt(i, m4);
    }
    inst.instanceMatrix.needsUpdate = true;
    this.trackGroup.add(inst);

    // rails (kept as handles — one anomaly quietly changes the gauge)
    for (const z of [L.RAIL_Z_A, L.RAIL_Z_B]) {
      const railGroup = new THREE.Group();
      railGroup.position.z = z;
      railGroup.add(P.mesh(P.box(len, 0.09, 0.075), this.mats.railSteel, 0, L.RAIL_Y, 0, false, false));
      railGroup.add(P.mesh(P.box(len, 0.14, 0.028), this.mats.darkSteel, 0, L.RAIL_Y - 0.11, 0, false, false));
      this.rails.push(railGroup);
      this.trackGroup.add(railGroup);
    }

    // catenary masts + wire
    const wirePts: THREE.Vector3[] = [];
    const mastXs: number[] = [];
    for (let x = -70; x <= 70; x += 10) {
      mastXs.push(x);
      wirePts.push(new THREE.Vector3(x, 5.6, (L.RAIL_Z_A + L.RAIL_Z_B) / 2));
      wirePts.push(new THREE.Vector3(x + 10, 5.6, (L.RAIL_Z_A + L.RAIL_Z_B) / 2));
    }
    this.trackGroup.add(instancedRow(P.box(0.16, 6.2, 0.16), this.mats.darkSteel, mastXs, 3.1, L.TRACK_Z_FAR + 0.4));
    this.trackGroup.add(instancedRow(P.box(0.1, 0.1, 3.6), this.mats.darkSteel, mastXs, 5.9, L.TRACK_Z_FAR - 1.3));
    const wireGeo = new THREE.BufferGeometry().setFromPoints(wirePts);
    this.trackGroup.add(new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: 0x1a1e24 })));

    // signal mast down the line
    const sigGroup = new THREE.Group();
    sigGroup.position.set(46, 0, L.TRACK_Z_FAR + 0.9);
    sigGroup.add(P.mesh(P.box(0.14, 5.4, 0.14), this.mats.darkSteel, 0, 2.7, 0, false, false));
    const sigBody = P.mesh(P.box(0.4, 1.1, 0.3), this.mats.darkSteel, 0, 5.0, 0, false, false);
    sigGroup.add(sigBody);
    const redMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2a18, emissiveIntensity: 2.4, roughness: 0.4 });
    const red = P.mesh(new THREE.SphereGeometry(0.1, 10, 8), redMat, 0, 5.32, -0.17, false, false);
    sigGroup.add(red);
    const sigLight = new THREE.PointLight(0xff3a20, 2.4, 9, 2);
    sigLight.position.set(0, 5.32, -0.5);
    sigGroup.add(sigLight);
    this.trackGroup.add(sigGroup);

    this.add(this.trackGroup);
  }

  // --------------------------------------------------- opposite platform
  private buildOppositePlatform(): void {
    const g = this.oppositePlatform;
    const len = L.HALF_LEN * 2 + 6;
    const w = L.OPP_Z_FAR - L.OPP_Z_NEAR;
    const cz = (L.OPP_Z_NEAR + L.OPP_Z_FAR) / 2;

    g.add(P.mesh(P.box(len, L.DECK_Y, w), this.mats.concrete, 0, L.DECK_Y / 2, cz, false, true));
    const tac = P.mesh(new THREE.PlaneGeometry(len, 0.6), this.mats.tactile, 0, L.DECK_Y + 0.012, L.OPP_Z_NEAR + 0.95, false, true);
    tac.rotation.x = -Math.PI / 2;
    g.add(tac);
    g.add(P.mesh(P.box(len, 0.1, 0.14), this.mats.paintedMetal('edge', 0xd8d5c8, 0.6), 0, L.DECK_Y - 0.05, L.OPP_Z_NEAR + 0.07, false, false));

    // back wall + roof
    g.add(P.mesh(P.box(len, 3.9, 0.5), this.mats.wall, 0, 1.95, L.OPP_WALL_Z, false, true));
    g.add(P.mesh(P.box(30, 0.16, w - 0.4), this.mats.roofMetal, 0, L.ROOF_Y + 0.08, cz + 0.2, false, false));
    for (const x of [-13, -6.5, 0, 6.5, 13]) {
      g.add(P.mesh(P.box(0.3, L.ROOF_Y - L.DECK_Y, 0.3), this.mats.paintedMetal('pillar', 0xb2afa5, 0.6), x, L.DECK_Y + (L.ROOF_Y - L.DECK_Y) / 2, L.OPP_Z_NEAR + 1.9, true, false));
    }

    // a colder, sparser row of lamps so the far side always looks a bit worse
    for (const x of [-12, -6, 0, 6, 12]) {
      const lamp = P.buildLamp(this.mats, 0, 0xdfeaff, x % 12 === 0, false);
      lamp.group.position.set(x, L.ROOF_Y - 0.55, cz);
      lamp.light && (lamp.light.intensity = 13);
      lamp.baseIntensity = lamp.light?.intensity ?? 0;
      this.oppositeLamps.push(lamp);
      g.add(lamp.group);
    }

    const bench = P.buildBench(this.mats);
    bench.position.set(4.5, L.DECK_Y, L.OPP_Z_FAR - 0.9);
    bench.rotation.y = Math.PI;
    g.add(bench);

    const sign = P.buildStationSign(this.mats, { ...STATION });
    sign.group.position.set(-3, L.DECK_Y, L.OPP_Z_NEAR + 1.6);
    sign.group.rotation.y = Math.PI;
    g.add(sign.group);
    this.signs.push(sign);

    g.add(P.buildFence(this.mats, len, 1.8).translateY(L.DECK_Y).translateZ(L.OPP_WALL_Z - 0.4));
    this.add(g);
  }

  // ---------------------------------------------------------- furniture
  private buildFurniture(): void {
    const wallZ = L.WALL_Z + 0.55;

    // benches
    for (const x of [-11.5, 1.5, 12.5]) {
      const b = P.buildBench(this.mats);
      b.position.set(x, L.DECK_Y, wallZ);
      this.benches.push(b);
      this.add(b);
      this.collide(x - 0.9, x + 0.9, wallZ - 0.4, wallZ + 0.4);
    }

    // vending machines
    for (const [i, x] of [-6.6, 7.8].entries()) {
      const v = P.buildVending(this.mats, i);
      v.group.position.set(x, L.DECK_Y, wallZ - 0.1);
      this.vending.push(v);
      this.add(v.group);
      this.collide(x - 0.62, x + 0.62, wallZ - 0.55, wallZ + 0.35);
    }
    // a third machine kept off-stage for the "one more vending machine" anomaly
    this.spareVending = P.buildVending(this.mats, 0);
    this.spareVending.group.position.set(-8.0, L.DECK_Y, wallZ - 0.1);
    this.spareVending.group.visible = false;
    this.add(this.spareVending.group);

    this.spareBench = P.buildBench(this.mats);
    this.spareBench.position.set(-3.0, L.DECK_Y, wallZ);
    this.spareBench.visible = false;
    this.add(this.spareBench);

    // bins
    for (const x of [-9.2, 5.2]) {
      const b = P.buildBin(this.mats);
      b.position.set(x, L.DECK_Y, wallZ - 0.15);
      this.bins.push(b);
      this.add(b);
      this.collide(x - 0.3, x + 0.3, wallZ - 0.45, wallZ + 0.15);
    }

    // security cameras on the roof beams
    for (const [x, yaw] of [
      [-10, -0.6],
      [10, 2.5],
    ] as const) {
      const c = P.buildSecurityCamera(this.mats, yaw);
      c.group.position.set(x, L.ROOF_Y - 0.25, 1.0);
      this.cameras.push(c);
      this.add(c.group);
    }

    // speakers
    for (const x of [-13, -4, 5, 14]) {
      const s = P.buildSpeaker(this.mats);
      s.position.set(x, L.ROOF_Y - 0.62, -0.9);
      s.rotation.y = Math.PI;
      this.speakers.push(s);
      this.add(s);
    }

    // emergency stop button near the platform edge
    for (const x of [-14, 6]) {
      const e = P.buildEmergencyButton(this.mats);
      e.position.set(x, L.DECK_Y, L.EDGE_Z - 0.75);
      e.rotation.y = Math.PI;
      this.add(e);
      this.collide(x - 0.2, x + 0.2, L.EDGE_Z - 0.95, L.EDGE_Z - 0.55);
    }

    // forgotten umbrella beside the middle bench
    this.umbrella = P.buildUmbrella(this.mats);
    this.umbrella.position.set(2.55, L.DECK_Y, wallZ + 0.15);
    this.add(this.umbrella);

    // clock, hung mid-platform
    this.clock = P.buildClock(this.mats);
    this.clock.group.position.set(-1.2, L.ROOF_Y - 0.72, 1.75);
    this.clock.time = 13 * 60;
    P.applyClockTime(this.clock);
    this.add(this.clock.group);

    // departure board near the north end
    this.board = P.buildBoard(this.mats, DEFAULT_BOARD.map((r) => ({ ...r })));
    this.board.group.position.set(11.5, L.ROOF_Y - 0.78, 1.55);
    this.add(this.board.group);
  }

  // ------------------------------------------------------------ signage
  private buildSignage(): void {
    // 駅名標 on posts near the platform edge
    for (const x of [-8.5, 9.5]) {
      const s = P.buildStationSign(this.mats, { ...STATION });
      s.group.position.set(x, L.DECK_Y, 2.45);
      this.signs.push(s);
      this.add(s.group);
      this.collide(x - 0.12, x + 0.12, 2.33, 2.57);
    }

    // wall posters
    const wallZ = L.WALL_Z + 0.03;
    const specs: { spec: T.PosterSpec; x: number; y: number; w: number; h: number }[] = [
      { spec: RULES_POSTER, x: -16.4, y: 2.05, w: 0.86, h: 1.22 },
      {
        spec: {
          kind: 'ad',
          figure: 'person',
          lines: ['やさしい灯りの', 'ある暮らし', '― 霧崎ハウジング ―'],
        },
        x: -12.8,
        y: 2.1,
        w: 0.82,
        h: 1.16,
      },
      {
        spec: {
          kind: 'notice',
          accent: '#8a2b2b',
          lines: [
            'お知らせ',
            '・１月１３日 未明、当駅構内にて',
            '　発生した事故のため',
            '・一部列車に遅れが出ております',
            '',
            'ご迷惑をおかけいたします',
            '',
            '霧崎駅長',
          ],
        },
        x: -0.4,
        y: 2.05,
        w: 0.8,
        h: 1.14,
      },
      {
        spec: {
          kind: 'safety',
          accent: '#1c6b46',
          lines: [
            '駆け込み乗車は',
            '・おやめください',
            '・白線の内側でお待ちください',
            '・非常時は非常停止ボタンを',
            '',
            '安全は、ひとりひとりの',
            'こころがけから。',
          ],
        },
        x: 4.4,
        y: 2.05,
        w: 0.8,
        h: 1.14,
      },
      {
        spec: {
          kind: 'ad',
          figure: 'person',
          lines: ['最終電車のあとに', 'ひとつだけ、', '灯りが残る'],
        },
        x: 14.2,
        y: 2.1,
        w: 0.82,
        h: 1.16,
      },
    ];

    for (const s of specs) {
      const tex = T.poster(s.spec);
      const p = P.buildPoster(this.mats, tex, s.w, s.h);
      p.group.position.set(s.x, s.y, wallZ);
      this.posters.push({ ...p, spec: s.spec });
      this.add(p.group);
    }

    // small directional plate near each stairwell
    for (const sx of [-1, 1]) {
      const plate = P.mesh(
        new THREE.PlaneGeometry(1.0, 0.26),
        this.mats.signage(T.labelPlate('↑ かいさつ・出口', { bg: '#1d5aa8', fg: '#ffffff', w: 512, h: 128 })),
        sx * 17.4,
        2.6,
        L.WALL_Z + 0.03,
        false,
        false,
      );
      this.add(plate);
    }

    this.registerInteractables();
  }

  // --------------------------------------------------------- stairwells
  private buildStairwells(): void {
    for (const sx of [-1, 1] as const) {
      const g = new THREE.Group();
      const mouth = L.STAIR_MOUTH;
      const end = L.STAIR_END;
      const hw = L.STAIR_HALF_W;

      // end wall of the platform, with the stair opening cut out by using two panels
      for (const [z0, z1] of [
        [L.WALL_Z, -hw],
        [hw, L.EDGE_Z],
      ]) {
        const w = z1 - z0;
        g.add(P.mesh(P.box(0.4, L.ROOF_Y - 0.1, w), this.mats.wall, sx * mouth, (L.ROOF_Y - 0.1) / 2, z0 + w / 2, true, true));
        this.collide(
          sx > 0 ? mouth - 0.2 : -mouth - 0.2,
          sx > 0 ? mouth + 0.2 : -mouth + 0.2,
          z0,
          z1,
        );
      }
      // lintel above the opening
      g.add(P.mesh(P.box(0.4, 1.1, hw * 2), this.mats.wall, sx * mouth, L.ROOF_Y - 0.65, 0, true, false));

      // corridor walls
      for (const s of [-1, 1]) {
        g.add(P.mesh(P.box(end - mouth, 3.2, 0.3), this.mats.wall, (sx * (mouth + end)) / 2, 1.6 + L.DECK_Y, s * (hw + 0.15), true, true));
        this.collide(
          Math.min(sx * mouth, sx * end),
          Math.max(sx * mouth, sx * end),
          s * (hw + 0.3),
          s * hw,
        );
      }
      // far wall (the passage "continues" but the player never gets there)
      g.add(P.mesh(P.box(0.4, 5, hw * 2 + 0.6), this.mats.wall, sx * (end + 0.2), 2.5 + L.DECK_Y, 0, true, true));
      this.collide(
        sx > 0 ? end : -end - 0.4,
        sx > 0 ? end + 0.4 : -end,
        -hw - 0.3,
        hw + 0.3,
      );

      // landing then stairs
      g.add(P.mesh(P.box(0.9, L.DECK_Y, hw * 2), this.mats.concrete, sx * (mouth + 0.45), L.DECK_Y / 2, 0, false, true));
      const stairs = P.buildStairs(this.mats, 12, L.STAIR_RISE, 3.2, hw * 2, sx as 1 | -1);
      stairs.position.set(sx * 19.8, L.DECK_Y, 0);
      g.add(stairs);

      // sloped ceiling over the flight
      const ceil = P.mesh(P.box(4.6, 0.2, hw * 2 + 0.4), this.mats.wall, sx * 21.2, L.DECK_Y + 3.0, 0, false, false);
      ceil.rotation.z = sx * -0.34;
      g.add(ceil);

      // exit sign above the mouth — this is the progress counter
      const tex = T.exitSign('0');
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        emissive: 0xffffff,
        emissiveMap: tex,
        emissiveIntensity: 1.2,
        roughness: 0.4,
      });
      const sign = P.mesh(new THREE.PlaneGeometry(1.15, 0.58), mat, sx * (mouth - 0.22), L.ROOF_Y - 0.75, 0, false, false);
      sign.rotation.y = sx > 0 ? Math.PI : 0;
      g.add(sign);
      this.exitSigns.push({ mesh: sign, material: mat });

      // one lamp inside the stairwell
      const lamp = P.buildLamp(this.mats, 99, 0xfff2df, true, false);
      lamp.group.position.set(sx * 20.6, L.DECK_Y + 3.2, 0);
      lamp.light && (lamp.light.intensity = 18);
      lamp.baseIntensity = lamp.light?.intensity ?? 0;
      this.lamps.push(lamp);
      g.add(lamp.group);

      this.stairGroups.push(g);
      this.add(g);
    }
  }

  // ---------------------------------------------------------- distance
  private buildDistance(): void {
    // town silhouette strips beyond the tracks and behind the platform
    const tex = T.distantTown();
    const townMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: true });
    for (const [z, rotY, dist] of [
      [78, 0, 200],
      [-62, Math.PI, 170],
    ] as const) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(dist, 24), townMat);
      plane.position.set(0, 8, z);
      plane.rotation.y = rotY;
      plane.renderOrder = -1;
      this.add(plane);
    }

    // street lamps along an unseen road behind the far platform
    const poles = new THREE.InstancedMesh(P.box(0.16, 7, 0.16), this.mats.darkSteel, 8);
    const heads = new THREE.InstancedMesh(
      P.box(0.7, 0.16, 0.3),
      this.mats.emissive('street', 0xffb761, 1.4),
      8,
    );
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 8; i++) {
      const x = -60 + i * 16 + R.range(-3, 3);
      const z = 34 + R.range(-6, 6);
      poles.setMatrixAt(i, m4.makeTranslation(x, 3.5, z));
      heads.setMatrixAt(i, m4.makeTranslation(x, 7.0, z - 0.4));
    }
    poles.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    this.add(poles);
    this.add(heads);

    // blinking aircraft-warning light on something tall and far away
    const warn = P.mesh(
      new THREE.SphereGeometry(0.5, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
      -34,
      27,
      92,
      false,
      false,
    );
    warn.name = 'warnLight';
    this.add(warn);
  }

  hemi!: THREE.HemisphereLight;
  fillLight!: THREE.DirectionalLight;

  private buildAmbientLights(): void {
    this.hemi = new THREE.HemisphereLight(0x2a3a4e, 0x0a0d12, 0.42);
    this.scene.add(this.hemi);
    // a very soft fill from the town so nothing is ever pure black
    this.fillLight = new THREE.DirectionalLight(0x4a5a72, 0.22);
    this.fillLight.position.set(-20, 24, 60);
    this.scene.add(this.fillLight);
  }

  /* ======================================================= interactables */

  private registerInteractables(): void {
    const push = (
      id: string,
      obj: THREE.Object3D,
      point: THREE.Vector3,
      radius: number,
      title: string,
      body: () => string,
    ): void => {
      this.interactables.push({ id, object: obj, point, radius, title, body });
    };

    push(
      'rules',
      this.posters[0].group,
      new THREE.Vector3(-16.4, 2.05, L.WALL_Z + 0.03),
      2.4,
      'ご利用のお客様へ',
      () =>
        'ホームに異変を見つけた場合は、引き返してください。\n異変が見つからない場合は、そのままお進みください。\n\n８回進むと、出口です。\n\n霧崎駅',
    );

    push(
      'notice',
      this.posters[2].group,
      new THREE.Vector3(-0.4, 2.05, L.WALL_Z + 0.03),
      2.2,
      'お知らせ',
      () =>
        '一月十三日 未明、当駅構内にて発生した事故のため、\n一部列車に遅れが出ております。\n\n（掲示の日付だけが、真新しい）',
    );

    push(
      'umbrella',
      this.umbrella,
      new THREE.Vector3(2.55, L.DECK_Y + 0.5, L.WALL_Z + 0.7),
      2.0,
      '忘れ物',
      () => '紺色の傘が一本、ベンチに立てかけられている。\n\nまだ、濡れている。',
    );

    push(
      'clock',
      this.clock.group,
      new THREE.Vector3(-1.2, L.ROOF_Y - 0.72, 1.75),
      3.6,
      'ホーム時計',
      () => {
        const t = this.clock.time;
        const h = Math.floor(t / 3600) % 24;
        const m = Math.floor(t / 60) % 60;
        return `${h}:${String(m).padStart(2, '0')}\n\n秒針の音は、聞こえない。`;
      },
    );

    push(
      'bench',
      this.benches[1],
      new THREE.Vector3(1.5, L.DECK_Y + 0.5, L.WALL_Z + 0.55),
      2.0,
      'ベンチ',
      () => '木目のプリントが剥がれかけている。\n\n座面が、わずかに温かい。',
    );

    push(
      'vending',
      this.vending[1].group,
      new THREE.Vector3(7.8, L.DECK_Y + 1.0, L.WALL_Z + 0.9),
      2.2,
      '自動販売機',
      () => '「つり銭切れ」のランプが点いている。\n\n販売機番号 KT-0413。\n最終補充日の欄は、空白のまま。',
    );

    push(
      'sign',
      this.signs[1].group,
      new THREE.Vector3(-8.5, L.DECK_Y + 2.05, 2.45),
      3.0,
      '駅名標',
      () => {
        const s = this.signs[1].spec;
        return `${s.name}（${s.kana}）\n\n前：${s.prev}　次：${s.next}`;
      },
    );
  }

  /* ============================================================ baseline */

  /** Record the "normal" transform of everything an anomaly might touch. */
  private captureBaseline(): void {
    const targets: THREE.Object3D[] = [
      ...this.lamps.map((l) => l.group),
      ...this.pillars.map((p) => p.group),
      ...this.benches,
      ...this.vending.map((v) => v.group),
      ...this.bins,
      ...this.cameras.map((c) => c.group),
      ...this.cameras.map((c) => c.head),
      ...this.signs.map((s) => s.group),
      ...this.posters.map((p) => p.group),
      ...this.speakers,
      this.clock.group,
      this.board.group,
      this.umbrella,
      this.oppositePlatform,
      this.trackGroup,
      this.deckMesh,
      this.tactileMesh,
      this.spareVending.group,
      this.spareBench,
      ...this.rails,
      ...this.stairGroups,
      ...this.pillars.map((p) => p.plate),
      this.group,
    ];
    for (const obj of targets) {
      this.snapshots.push({
        obj,
        p: obj.position.clone(),
        q: obj.quaternion.clone(),
        s: obj.scale.clone(),
        v: obj.visible,
      });
    }
  }

  /** Undo every anomaly mutation and restore the ordinary platform. */
  resetToNormal(): void {
    for (const s of this.snapshots) {
      s.obj.position.copy(s.p);
      s.obj.quaternion.copy(s.q);
      s.obj.scale.copy(s.s);
      s.obj.visible = s.v;
    }

    for (const l of [...this.lamps, ...this.oppositeLamps]) {
      l.on = true;
      l.flicker = 0;
      l.material.emissiveIntensity = l.baseEmissive;
      l.material.emissive.setHex(l.colorTemp);
      if (l.light) {
        l.light.intensity = l.baseIntensity;
        l.light.color.setHex(l.colorTemp);
      }
    }

    for (const c of this.cameras) {
      c.tracking = false;
      c.head.rotation.set(c.basePitch, c.baseYaw, 0);
    }

    for (const s of this.signs) {
      if (s.spec.name !== STATION.name || s.spec.next !== STATION.next || s.spec.prev !== STATION.prev) {
        P.setSignSpec(s, { ...STATION });
      }
    }

    for (const p of this.posters) {
      if (p.material.userData.dirty) {
        P.setPosterTexture(p, T.poster(p.spec));
        p.material.userData.dirty = false;
      }
    }

    if (this.board.material.userData.dirty) {
      P.setBoardRows(this.board, DEFAULT_BOARD.map((r) => ({ ...r })));
      this.board.material.userData.dirty = false;
    }

    for (const v of this.vending) {
      v.frontMat.emissiveIntensity = 1.5;
      v.light.intensity = 6.5;
      v.light.color.setHex(0xffe7c4);
    }

    for (const f of this.figures) {
      f.group.parent?.remove(f.group);
    }
    this.figures.length = 0;

    if (this.train) {
      this.group.remove(this.train.group);
      this.train = null;
    }

    this.clock.time = 13 * 60;
    this.clock.rate = 1;
    this.clock.freezeWhenObserved = false;
    this.clock.hidden = false;
    P.applyClockTime(this.clock);

    for (const p of this.pillars) {
      const mat = p.plate.material as THREE.MeshStandardMaterial;
      if (mat.userData.dirty) {
        mat.map?.dispose();
        mat.map = T.labelPlate(String(p.number), {
          bg: '#f0efe9',
          fg: '#23262a',
          w: 192,
          h: 112,
          font: T.MONO_FONT,
        });
        mat.needsUpdate = true;
        mat.userData.dirty = false;
      }
    }

    this.stretch = 1;
    this.group.scale.x = 1;
    this.rain.setIntensity(1);
    this.rain.setWind(0.18, 0.05);
    this.fogRef.density = this.baseFogDensity;
    this.fogRef.color.setHex(0x0b1119);
    this.hemi.intensity = 0.42;
    this.hemi.color.setHex(0x2a3a4e);
    this.fillLight.intensity = 0.22;
    this.fillLight.color.setHex(0x4a5a72);
    (this.scene.background as THREE.Color)?.setHex?.(0x05070b);
  }

  /* ============================================================== helpers */

  setExitNumber(n: number): void {
    for (const s of this.exitSigns) {
      s.material.map?.dispose();
      const tex = T.exitSign(String(n));
      s.material.map = tex;
      s.material.emissiveMap = tex;
      s.material.needsUpdate = true;
    }
  }

  /** Apply the slow degradation of the world as the player gets closer out. */
  setTension(t: number): void {
    this.tension = t;
    const k = Math.min(1, t / 8);
    this.fogRef.density = this.baseFogDensity * (1 + k * 0.9);
    this.fogRef.color.setHex(k > 0.6 ? 0x0a0d13 : 0x0b1119);
    for (const l of this.lamps) {
      l.material.emissiveIntensity = l.baseEmissive * (1 - k * 0.16);
      if (l.light) l.light.intensity = l.baseIntensity * (1 - k * 0.2);
    }
    this.rain.setIntensity(1 + k * 0.5);
  }

  /** Ground height under the player, including the two stair flights. */
  floorHeightAt(worldX: number, z: number): number {
    // the station group may be scaled along X by an anomaly; work in local space
    const ax = Math.abs(worldX / this.stretch);
    if (ax > 19.4 && Math.abs(z) <= L.STAIR_HALF_W + 0.05) {
      const t = THREE.MathUtils.clamp((ax - 19.8) / 3.2, 0, 1);
      return L.DECK_Y + t * L.STAIR_RISE;
    }
    return L.DECK_Y;
  }

  spawnFigure(opts: Parameters<typeof buildFigure>[0] = {}): FigureProp {
    const f = buildFigure(opts);
    this.figures.push(f);
    this.group.add(f.group);
    return f;
  }

  spawnTrain(cars = 3): TrainProp {
    if (this.train) this.group.remove(this.train.group);
    this.train = buildTrain(this.mats, cars);
    this.group.add(this.train.group);
    return this.train;
  }

  /* =============================================================== update */

  update(dt: number, camera: THREE.Camera): void {
    this.time += dt;

    // ---- fluorescent behaviour
    for (const l of [...this.lamps, ...this.oppositeLamps]) {
      if (!l.on) continue;
      let k = 1;
      if (l.flicker > 0) {
        const t = this.time * 14 + l.phase;
        const n = Math.sin(t) * Math.sin(t * 2.31) * Math.sin(t * 0.73);
        const dip = n > 0.35 ? 0 : 1;
        k = 1 - l.flicker * (1 - dip) * (0.55 + 0.45 * Math.sin(t * 37));
      } else {
        // every fitting breathes very slightly — kills the "CG" flatness
        k = 1 + Math.sin(this.time * 2.1 + l.phase) * 0.012;
      }
      l.material.emissiveIntensity = l.baseEmissive * k;
      if (l.light) l.light.intensity = l.baseIntensity * k;
    }

    // ---- clock
    if (!(this.clock.freezeWhenObserved && this.isLookedAt(camera, this.clock.group, 0.94))) {
      this.clock.time += dt * this.clock.rate;
      P.applyClockTime(this.clock);
    }

    // ---- security cameras
    for (const c of this.cameras) {
      if (c.tracking) {
        const world = new THREE.Vector3();
        c.head.getWorldPosition(world);
        const dir = this.playerPos.clone().sub(world);
        const targetYaw = Math.atan2(dir.x, dir.z);
        const targetPitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
        // head's parent is rotated with the group; work in local space
        const localYaw = targetYaw - c.group.rotation.y;
        c.head.rotation.y += THREE.MathUtils.clamp(
          shortestAngle(c.head.rotation.y, localYaw),
          -dt * 1.6,
          dt * 1.6,
        );
        c.head.rotation.x += THREE.MathUtils.clamp(targetPitch - c.head.rotation.x, -dt * 1.2, dt * 1.2);
        (c.led.material as THREE.MeshStandardMaterial).emissiveIntensity =
          2.4 + Math.sin(this.time * 8) * 1.6;
      } else {
        c.head.rotation.y += Math.sin(this.time * 0.28 + c.baseYaw) * dt * 0.06;
        (c.led.material as THREE.MeshStandardMaterial).emissiveIntensity =
          this.time % 3 < 0.1 ? 3.6 : 1.4;
      }
    }

    // ---- blinking aircraft warning light
    const warn = this.group.getObjectByName('warnLight') as THREE.Mesh | undefined;
    if (warn) {
      const on = this.time % 2.6 < 0.9;
      (warn.material as THREE.MeshBasicMaterial).color.setHex(on ? 0xff2a1a : 0x2a0604);
    }

    this.rain.update(dt);
  }

  /** True when `obj` is within `threshold` of the camera's forward axis. */
  isLookedAt(camera: THREE.Camera, obj: THREE.Object3D, threshold = 0.9): boolean {
    const target = new THREE.Vector3();
    obj.getWorldPosition(target);
    const camPos = new THREE.Vector3();
    camera.getWorldPosition(camPos);
    const toObj = target.sub(camPos).normalize();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    return toObj.dot(fwd) > threshold;
  }

  dispose(): void {
    this.rain.dispose();
    this.scene.remove(this.group);
  }
}

/** One InstancedMesh for a row of identical boxes spaced along X. */
function instancedRow(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  xs: number[],
  y: number,
  z: number,
): THREE.InstancedMesh {
  const inst = new THREE.InstancedMesh(geo, mat, xs.length);
  const m = new THREE.Matrix4();
  xs.forEach((x, i) => {
    m.makeTranslation(x, y, z);
    inst.setMatrixAt(i, m);
  });
  inst.instanceMatrix.needsUpdate = true;
  inst.castShadow = false;
  inst.receiveShadow = true;
  return inst;
}

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
