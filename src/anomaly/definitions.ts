import * as THREE from 'three';
import type { AnomalyDefinition, AnomalyContext } from './types';
import * as T from '../gfx/Textures';
import * as P from '../world/Props';
import { STATION, DEFAULT_BOARD } from '../world/Station';
import { L } from '../world/Layout';

/**
 * The anomaly catalogue.
 *
 * Each entry is pure data + a small mutation function. Nothing here knows about
 * the game loop, scoring or the UI; adding a new anomaly means appending one
 * object to this array and never touching the core.
 *
 * Undo is handled centrally by Station.resetToNormal(), so an anomaly only ever
 * describes the *broken* state.
 */

const dirty = (m: THREE.Material): void => {
  m.userData.dirty = true;
};

function repaintPoster(ctx: AnomalyContext, index: number, spec: T.PosterSpec): void {
  const p = ctx.station.posters[index];
  P.setPosterTexture(p, T.poster(spec));
  dirty(p.material);
}

function setPillarNumber(ctx: AnomalyContext, index: number, label: string): void {
  const plate = ctx.station.pillars[index].plate;
  const mat = plate.material as THREE.MeshStandardMaterial;
  mat.map?.dispose();
  mat.map = T.labelPlate(label, { bg: '#f0efe9', fg: '#23262a', w: 192, h: 112, font: T.MONO_FONT });
  mat.needsUpdate = true;
  dirty(mat);
}

function killLamp(ctx: AnomalyContext, index: number): void {
  const l = ctx.station.lamps[index];
  if (!l) return;
  l.on = false;
  l.material.emissiveIntensity = 0;
  if (l.light) l.light.intensity = 0;
}

/** Place a figure on the opposite platform, facing our platform. */
function figureOnOppositePlatform(ctx: AnomalyContext, x: number, opts = {}): THREE.Group {
  const f = ctx.station.spawnFigure(opts);
  f.group.position.set(x, L.DECK_Y, L.OPP_Z_NEAR + 1.4);
  f.group.rotation.y = Math.PI;
  return f.group;
}

export const ANOMALIES: AnomalyDefinition[] = [
  /* ============================================================= subtle */
  {
    id: 'clock-0012',
    name: '時計が0:12',
    tier: 'subtle',
    weight: 10,
    reveal: 'ホーム時計が 0:12 を指していた。',
    apply: (ctx) => {
      ctx.station.clock.time = 12 * 60;
      P.applyClockTime(ctx.station.clock);
    },
  },
  {
    id: 'poster-typo',
    name: 'ポスターの一文字',
    tier: 'subtle',
    weight: 9,
    reveal: '注意ポスターの文字が「駆け込み降車」になっていた。',
    apply: (ctx) => {
      const base = ctx.station.posters[3].spec;
      repaintPoster(ctx, 3, {
        ...base,
        lines: base.lines.map((l) => (l === '駆け込み乗車は' ? '駆け込み降車は' : l)),
      });
    },
  },
  {
    id: 'bench-shifted',
    name: 'ベンチの位置',
    tier: 'subtle',
    weight: 8,
    reveal: '中央のベンチが、壁から少し離れていた。',
    apply: (ctx) => {
      const b = ctx.station.benches[1];
      b.position.z += 0.42;
      b.position.x += 0.18;
      b.rotation.y += 0.09;
    },
  },
  {
    id: 'vending-product',
    name: '自販機の商品',
    tier: 'subtle',
    weight: 8,
    reveal: '自動販売機の商品が一種類だけ入れ替わっていた。',
    apply: (ctx) => {
      const v = ctx.station.vending[ctx.rng.int(0, 1)];
      const products = v.products.map((row) => [...row]);
      products[1][2] = '#7de0c8';
      const tex = T.vendingFront(products, v.variant);
      v.frontMat.map?.dispose();
      v.frontMat.map = tex;
      v.frontMat.emissiveMap = tex;
      v.frontMat.needsUpdate = true;
      dirty(v.frontMat);
    },
    cleanup: (ctx) => {
      for (const v of ctx.station.vending) {
        if (!v.frontMat.userData.dirty) continue;
        const tex = T.vendingFront(v.products, v.variant);
        v.frontMat.map?.dispose();
        v.frontMat.map = tex;
        v.frontMat.emissiveMap = tex;
        v.frontMat.needsUpdate = true;
        v.frontMat.userData.dirty = false;
      }
    },
  },
  {
    id: 'pillar-number',
    name: '柱の番号',
    tier: 'subtle',
    weight: 8,
    reveal: '柱の番号が飛んでいた（4番のはずが7番）。',
    apply: (ctx) => setPillarNumber(ctx, 3, '7'),
  },
  {
    id: 'sign-next',
    name: '次駅名',
    tier: 'subtle',
    weight: 9,
    reveal: '駅名標の次駅が「夜見」ではなくなっていた。',
    apply: (ctx) => {
      for (const s of ctx.station.signs) P.setSignSpec(s, { ...STATION, next: '夜視' });
    },
  },
  {
    id: 'lamp-out',
    name: '蛍光灯が1本消灯',
    tier: 'subtle',
    weight: 9,
    reveal: '蛍光灯が一本、消えていた。',
    apply: (ctx) => killLamp(ctx, ctx.rng.int(2, 6)),
  },
  {
    id: 'bin-missing',
    name: 'ゴミ箱がない',
    tier: 'subtle',
    weight: 8,
    reveal: 'ゴミ箱が一つ、無くなっていた。',
    apply: (ctx) => {
      ctx.station.bins[ctx.rng.int(0, 1)].visible = false;
    },
  },
  {
    id: 'camera-turned',
    name: '防犯カメラの向き',
    tier: 'subtle',
    weight: 7,
    reveal: '防犯カメラが、線路ではなくホームの奥を向いていた。',
    apply: (ctx) => {
      const c = ctx.station.cameras[0];
      c.head.rotation.y = c.baseYaw + 2.35;
      c.head.rotation.x = -0.05;
    },
  },
  {
    id: 'umbrella-gone',
    name: '傘が消える',
    tier: 'subtle',
    weight: 7,
    reveal: 'ベンチの忘れ物の傘が無くなっていた。',
    apply: (ctx) => {
      ctx.station.umbrella.visible = false;
    },
  },
  {
    id: 'lamp-flicker',
    name: '蛍光灯のちらつき',
    tier: 'subtle',
    weight: 7,
    reveal: '蛍光灯が一本、激しくちらついていた。',
    apply: (ctx) => {
      const l = ctx.station.lamps[ctx.rng.int(1, 7)];
      l.flicker = 0.85;
    },
  },

  /* ============================================================= medium */
  {
    id: 'clock-reverse',
    name: '秒針の逆回転',
    tier: 'medium',
    weight: 8,
    reveal: '時計の秒針が逆に回っていた。',
    apply: (ctx) => {
      ctx.station.clock.rate = -1;
    },
  },
  {
    id: 'vending-extra',
    name: '自販機が増える',
    tier: 'medium',
    weight: 8,
    reveal: '自動販売機が一台、増えていた。',
    apply: (ctx) => {
      ctx.station.spareVending.group.visible = true;
    },
  },
  {
    id: 'bench-extra',
    name: 'ベンチが増える',
    tier: 'medium',
    weight: 7,
    reveal: 'ベンチが一脚、増えていた。',
    apply: (ctx) => {
      ctx.station.spareBench.visible = true;
    },
  },
  {
    id: 'board-ghost-train',
    name: '存在しない列車',
    tier: 'medium',
    weight: 8,
    reveal: '電光掲示板に、来ないはずの列車が表示されていた。',
    apply: (ctx) => {
      P.setBoardRows(ctx.station.board, [
        { time: '00:13', type: '各駅停車', dest: '夜見', cars: '4両' },
        { time: '00:13', type: '回送', dest: '　　　', cars: '０両' },
      ]);
      dirty(ctx.station.board.material);
    },
  },
  {
    id: 'poster-looking',
    name: 'ポスターの視線',
    tier: 'medium',
    weight: 8,
    reveal: '広告の人物が、こちらを見ていた。',
    apply: (ctx) => {
      const i = ctx.rng.bool() ? 1 : 4;
      repaintPoster(ctx, i, { ...ctx.station.posters[i].spec, figure: 'personLooking' });
    },
  },
  {
    id: 'figure-opposite',
    name: '向かいのホームの人影',
    tier: 'medium',
    weight: 9,
    reveal: '向かいのホームに、誰かが立っていた。',
    apply: (ctx) => {
      figureOnOppositePlatform(ctx, ctx.rng.range(-8, 8));
    },
  },
  {
    id: 'station-renamed',
    name: '駅名が違う',
    tier: 'medium',
    weight: 8,
    reveal: '駅名標の駅名が「霧崎」ではなかった。',
    apply: (ctx) => {
      for (const s of ctx.station.signs) {
        P.setSignSpec(s, {
          ...STATION,
          name: '終崎',
          kana: 'しゅうさき',
          romaji: 'SHUSAKI',
        });
      }
    },
  },
  {
    id: 'camera-tracking',
    name: 'カメラが追尾',
    tier: 'medium',
    weight: 8,
    minProgress: 1,
    reveal: '防犯カメラが、あなたを追いかけていた。',
    apply: (ctx) => {
      for (const c of ctx.station.cameras) c.tracking = true;
    },
  },
  {
    id: 'rail-gauge',
    name: '線路の幅',
    tier: 'medium',
    weight: 6,
    reveal: '線路の幅が、わずかに広がっていた。',
    apply: (ctx) => {
      const mid = (L.RAIL_Z_A + L.RAIL_Z_B) / 2;
      for (const r of ctx.station.rails) {
        r.position.z = mid + (r.position.z - mid) * 1.55;
      }
    },
  },
  {
    id: 'lamp-cold',
    name: '光の色が違う',
    tier: 'medium',
    weight: 7,
    reveal: '蛍光灯の色が、数本だけ違っていた。',
    apply: (ctx) => {
      for (const i of [2, 3, 4]) {
        const l = ctx.station.lamps[i];
        if (!l) continue;
        l.material.emissive.setHex(0x9fe6d6);
        l.light?.color.setHex(0x9fe6d6);
      }
    },
  },
  {
    id: 'tactile-break',
    name: '点字ブロックの断絶',
    tier: 'medium',
    weight: 6,
    reveal: '点字ブロックが途中で途切れていた。',
    apply: (ctx) => {
      const patch = P.mesh(
        new THREE.PlaneGeometry(4.5, 0.64),
        ctx.station.deckMesh.material as THREE.Material,
        2.2,
        L.DECK_Y + 0.02,
        L.TACTILE_Z,
        false,
        false,
      );
      patch.rotation.x = -Math.PI / 2;
      patch.name = 'anomaly-temp';
      ctx.station.group.add(patch);
    },
    cleanup: (ctx) => {
      const p = ctx.station.group.getObjectByName('anomaly-temp');
      if (p) ctx.station.group.remove(p);
    },
  },

  /* ============================================================= strong */
  {
    id: 'doppelganger',
    name: '向かいのホームの自分',
    tier: 'strong',
    weight: 7,
    minProgress: 2,
    reveal: '向かいのホームに、あなたと同じ動きをする人影がいた。',
    apply: (ctx) => {
      const f = ctx.station.spawnFigure({ color: 0x0f1216 });
      f.group.name = 'doppel';
      f.group.position.set(ctx.player.position.x, L.DECK_Y, L.OPP_Z_NEAR + 1.6);
    },
    update: (_dt, ctx) => {
      const f = ctx.station.figures.find((x) => x.group.name === 'doppel');
      if (!f) return;
      // mirrors the player across the track, always facing back at them
      f.group.position.x += (ctx.player.position.x - f.group.position.x) * 0.12;
      f.group.rotation.y = Math.PI;
    },
  },
  {
    id: 'giant-figure',
    name: '線路の奥の巨大な影',
    tier: 'strong',
    weight: 6,
    minProgress: 2,
    reveal: '線路の奥に、見上げるほど大きな影が立っていた。',
    apply: (ctx) => {
      const f = ctx.station.spawnFigure({ color: 0x07090c, scale: 4.6, roughness: 0.95 });
      f.group.position.set(52, 0, (L.RAIL_Z_A + L.RAIL_Z_B) / 2);
      f.group.rotation.y = -Math.PI / 2;
    },
  },
  {
    id: 'opposite-gone',
    name: '向かいのホームが無い',
    tier: 'strong',
    weight: 6,
    minProgress: 1,
    reveal: '向かいのホームが、丸ごと無くなっていた。',
    apply: (ctx) => {
      ctx.station.oppositePlatform.visible = false;
      ctx.station.fogRef.density *= 1.5;
    },
  },
  {
    id: 'platform-stretch',
    name: 'ホームが伸びる',
    tier: 'strong',
    weight: 5,
    minProgress: 2,
    reveal: 'ホームの長さが、いつもより伸びていた。',
    apply: (ctx) => {
      ctx.station.stretch = 1.22;
      ctx.station.group.scale.x = 1.22;
    },
  },
  {
    id: 'end-vanishes',
    name: 'ホームの端が見えない',
    tier: 'strong',
    weight: 6,
    minProgress: 1,
    reveal: 'ホームの北側が、霧に飲まれて見えなくなっていた。',
    apply: (ctx) => {
      ctx.station.fogRef.density = 0.058;
      ctx.station.fogRef.color.setHex(0x0a0c10);
      for (const i of [6, 7, 8]) killLamp(ctx, i);
    },
  },
  {
    id: 'clock-zero',
    name: '時計が0:00',
    tier: 'strong',
    weight: 6,
    minProgress: 2,
    reveal: 'すべての時計が 0:00 で止まっていた。',
    apply: (ctx) => {
      ctx.station.clock.time = 0;
      ctx.station.clock.rate = 0;
      P.applyClockTime(ctx.station.clock);
      P.setBoardRows(ctx.station.board, [
        { time: '00:00', type: '　', dest: '　', cars: '' },
        { time: '00:00', type: '　', dest: '　', cars: '' },
      ]);
      dirty(ctx.station.board.material);
    },
  },
  {
    id: 'silent-train',
    name: '無音の列車',
    tier: 'strong',
    weight: 6,
    minProgress: 2,
    reveal: '音のない列車が、目の前を通過していった。',
    apply: (ctx) => {
      const t = ctx.station.spawnTrain(3);
      t.group.position.set(-120, 0, (L.RAIL_Z_A + L.RAIL_Z_B) / 2);
      t.windows.emissiveIntensity = 0.9;
      t.headlights.intensity = 0;
    },
    update: (dt, ctx) => {
      const t = ctx.station.train;
      if (!t) return;
      t.group.position.x += dt * 21;
      if (t.group.position.x > 140) t.group.position.x = -140;
    },
  },
  {
    id: 'daylight-outside',
    name: '駅の外だけ昼',
    tier: 'strong',
    weight: 5,
    minProgress: 3,
    reveal: '駅の外だけが、昼間だった。',
    apply: (ctx) => {
      ctx.station.fogRef.color.setHex(0xb9c6d4);
      ctx.station.fogRef.density = 0.016;
      ctx.station.hemi.color.setHex(0xcfe0f0);
      ctx.station.hemi.intensity = 1.5;
      ctx.station.fillLight.color.setHex(0xfff4e0);
      ctx.station.fillLight.intensity = 1.9;
      (ctx.gfx.scene.background as THREE.Color).setHex(0xb9c6d4);
      ctx.station.rain.setIntensity(0.25);
    },
  },
  {
    id: 'ad-empty',
    name: '広告から人が消える',
    tier: 'strong',
    weight: 6,
    minProgress: 1,
    reveal: '広告の中から、人物だけが消えていた。',
    apply: (ctx) => {
      repaintPoster(ctx, 1, { ...ctx.station.posters[1].spec, figure: 'empty' });
      repaintPoster(ctx, 4, { ...ctx.station.posters[4].spec, figure: 'empty' });
    },
  },

  /* ============================================================ special */
  {
    id: 'approaching-figure',
    name: '振り返るたび近づく影',
    tier: 'special',
    weight: 7,
    minProgress: 1,
    reveal: '振り返るたびに、後ろの人影が近づいていた。',
    apply: (ctx) => {
      const f = ctx.station.spawnFigure({ color: 0x0c0f13 });
      f.group.name = 'stalker';
      f.group.position.set(-L.HALF_LEN + 1.2, L.DECK_Y, 0.6);
      f.group.userData.dist = 20;
    },
    update: (_dt, ctx) => {
      const f = ctx.station.figures.find((x) => x.group.name === 'stalker');
      if (!f) return;
      const seen = ctx.station.isLookedAt(ctx.camera, f.group, 0.72);
      if (!seen) {
        // only closes the gap while unobserved — the classic "it moved" beat
        f.group.userData.dist = Math.max(3.0, (f.group.userData.dist as number) - 0.055);
      }
      const behind = ctx.player.position.x - (f.group.userData.dist as number);
      f.group.position.x = THREE.MathUtils.clamp(behind, -L.HALF_LEN + 0.8, L.HALF_LEN - 0.8);
      const dir = ctx.player.position.clone().sub(f.group.position);
      f.group.rotation.y = Math.atan2(dir.x, dir.z);
    },
  },
  {
    id: 'clock-watched',
    name: '見ている間だけ止まる時計',
    tier: 'special',
    weight: 7,
    minProgress: 1,
    reveal: '時計は、見ている間だけ止まっていた。',
    apply: (ctx) => {
      ctx.station.clock.freezeWhenObserved = true;
      ctx.station.clock.rate = 3.5;
    },
  },
  {
    id: 'phantom-steps',
    name: '背後の足音',
    tier: 'special',
    weight: 7,
    reveal: '背後から足音がしていた。誰もいないのに。',
    apply: (ctx) => {
      ctx.station.group.userData.stepTimer = 1.4;
    },
    update: (dt, ctx) => {
      const ud = ctx.station.group.userData;
      ud.stepTimer = (ud.stepTimer ?? 1.4) - dt;
      if (ud.stepTimer > 0) return;
      ud.stepTimer = ctx.rng.range(0.42, 0.66);
      const back = ctx.player.forward().multiplyScalar(-ctx.rng.range(2.2, 4.0));
      const at = ctx.player.position.clone().add(back);
      at.y = L.DECK_Y + 0.1;
      ctx.audio.play(`step${ctx.rng.int(0, 3)}`, 0.5, at, ctx.station.group);
    },
  },
  {
    id: 'wrong-announcement',
    name: '違うアナウンス',
    tier: 'special',
    weight: 7,
    minProgress: 1,
    reveal: '構内アナウンスの内容が、この駅のものではなかった。',
    apply: (ctx) => {
      ctx.station.group.userData.announced = false;
    },
    update: (_dt, ctx) => {
      const ud = ctx.station.group.userData;
      if (ud.announced) return;
      if (ctx.player.position.x < 2) return;
      ud.announced = true;
      ctx.audio.announce(
        'まもなく、０番線に、電車がまいります。\n白線の内側まで、お下がりください。\nこの電車は、どこにも、まいりません。',
        { at: ctx.station.speakers[2] },
      );
    },
  },
  {
    id: 'hiding-figure',
    name: '柱の陰に隠れる何か',
    tier: 'special',
    weight: 6,
    minProgress: 2,
    reveal: '柱の陰に、ずっと隠れているものがいた。',
    apply: (ctx) => {
      const f = ctx.station.spawnFigure({ color: 0x0a0d11 });
      f.group.name = 'hider';
      f.group.position.set(0, L.DECK_Y, 2.0);
    },
    update: (_dt, ctx) => {
      const f = ctx.station.figures.find((x) => x.group.name === 'hider');
      if (!f) return;
      // pick the pillar nearest the player and stay on its far side
      let best = ctx.station.pillars[0];
      let bestD = Infinity;
      for (const p of ctx.station.pillars) {
        const d = Math.abs(p.group.position.x - ctx.player.position.x);
        if (d > 3 && d < bestD) {
          bestD = d;
          best = p;
        }
      }
      const px = best.group.position.x;
      const pz = best.group.position.z;
      const dir = new THREE.Vector2(px - ctx.player.position.x, pz - ctx.player.position.z).normalize();
      const target = new THREE.Vector3(px + dir.x * 0.36, L.DECK_Y, pz + dir.y * 0.36);
      f.group.position.lerp(target, 0.09);
      const look = ctx.player.position.clone().sub(f.group.position);
      f.group.rotation.y = Math.atan2(look.x, look.z);
    },
  },
  {
    id: 'breath-on-glass',
    name: '窓のない場所の呼吸',
    tier: 'special',
    weight: 6,
    minProgress: 2,
    reveal: '自販機のガラスに、内側から手のあとがついていた。',
    apply: (ctx) => {
      const v = ctx.station.vending[0];
      const products = v.products.map((r) => [...r]);
      const tex = T.vendingFront(products, v.variant);
      // draw a smeared handprint over the generated front
      const img = tex.image as HTMLCanvasElement;
      const x = img.getContext('2d')!;
      x.globalAlpha = 0.3;
      x.fillStyle = '#dfe8f2';
      const cx = img.width * 0.42;
      const cy = img.height * 0.3;
      x.beginPath();
      x.ellipse(cx, cy, img.width * 0.07, img.height * 0.055, 0, 0, 7);
      x.fill();
      for (let i = 0; i < 5; i++) {
        x.beginPath();
        x.ellipse(
          cx - img.width * 0.055 + i * img.width * 0.028,
          cy - img.height * 0.055,
          img.width * 0.011,
          img.height * 0.024,
          0,
          0,
          7,
        );
        x.fill();
      }
      x.globalAlpha = 1;
      tex.needsUpdate = true;
      v.frontMat.map?.dispose();
      v.frontMat.map = tex;
      v.frontMat.emissiveMap = tex;
      v.frontMat.needsUpdate = true;
      dirty(v.frontMat);
    },
    cleanup: (ctx) => {
      for (const v of ctx.station.vending) {
        if (!v.frontMat.userData.dirty) continue;
        const tex = T.vendingFront(v.products, v.variant);
        v.frontMat.map?.dispose();
        v.frontMat.map = tex;
        v.frontMat.emissiveMap = tex;
        v.frontMat.needsUpdate = true;
        v.frontMat.userData.dirty = false;
      }
    },
  },
  {
    id: 'board-counts-down',
    name: '掲示板のカウントダウン',
    tier: 'special',
    weight: 6,
    minProgress: 1,
    reveal: '電光掲示板の時刻が、近づくほど減っていた。',
    apply: (ctx) => {
      ctx.station.group.userData.countdown = 13;
      ctx.station.group.userData.countTimer = 0;
    },
    update: (dt, ctx) => {
      const ud = ctx.station.group.userData;
      const dist = Math.abs(ctx.player.position.x - ctx.station.board.group.position.x);
      ud.countTimer = (ud.countTimer ?? 0) + dt;
      if (ud.countTimer < 0.5) return;
      ud.countTimer = 0;
      const n = THREE.MathUtils.clamp(Math.round(dist * 0.62), 0, 13);
      if (n === ud.countdown) return;
      ud.countdown = n;
      P.setBoardRows(ctx.station.board, [
        { time: `00:${String(n).padStart(2, '0')}`, type: '各駅停車', dest: '夜見', cars: '4両' },
        DEFAULT_BOARD[1],
      ]);
      dirty(ctx.station.board.material);
    },
  },
];

export const ANOMALY_BY_ID = new Map(ANOMALIES.map((a) => [a.id, a]));
