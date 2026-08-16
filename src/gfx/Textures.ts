import * as THREE from 'three';

/**
 * Every texture in the game is generated at runtime on a 2D canvas.
 *
 * Reasons this beats shipping image files for this project:
 *  - zero asset 404s after deployment (a whole class of "works locally only" bugs)
 *  - the initial download stays ~1 file, which matters on mobile data
 *  - anomalies can regenerate a sign or a poster with one character changed,
 *    which is exactly the kind of anomaly this game is built around.
 */

export const JP_FONT =
  '"Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic", "Noto Sans JP", "Meiryo", sans-serif';
export const MONO_FONT = '"DejaVu Sans Mono", "SF Mono", Menlo, monospace';

let textureScale = 1;
export function setTextureScale(s: number): void {
  textureScale = s;
}
function px(n: number): number {
  return Math.max(32, Math.round(n * textureScale));
}

export function makeCanvas(w: number, h = w): { c: HTMLCanvasElement; x: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  return { c, x };
}

/* ------------------------------------------------------------------ noise */

function hash2(x: number, y: number, seed: number): number {
  let h = x * 374761393 + y * 668265263 + seed * 1274126177;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a + (b - a) * xf) * (1 - yf) + (c + (d - c) * xf) * yf;
}

export function fbm(x: number, y: number, octaves = 4, seed = 1, lacunarity = 2, gain = 0.5): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 97);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Fill a canvas with fbm; `shade` maps noise (0..1) + uv to an rgb triple. */
function fillNoise(
  x: CanvasRenderingContext2D,
  w: number,
  h: number,
  scale: number,
  octaves: number,
  seed: number,
  shade: (n: number, u: number, v: number) => [number, number, number],
): void {
  const img = x.createImageData(w, h);
  const d = img.data;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const n = fbm((i / w) * scale, (j / h) * scale, octaves, seed);
      const [r, g, b] = shade(n, i / w, j / h);
      const o = (j * w + i) * 4;
      d[o] = r;
      d[o + 1] = g;
      d[o + 2] = b;
      d[o + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
}

/** Sobel a greyscale height canvas into a tangent-space normal map. */
export function heightToNormal(src: HTMLCanvasElement, strength = 2): THREE.CanvasTexture {
  const w = src.width;
  const h = src.height;
  const sx = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const { c, x } = makeCanvas(w, h);
  const out = x.createImageData(w, h);
  const at = (i: number, j: number): number => {
    const ii = (i + w) % w;
    const jj = (j + h) % h;
    return sx[(jj * w + ii) * 4] / 255;
  };
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const dx =
        at(i - 1, j - 1) + 2 * at(i - 1, j) + at(i - 1, j + 1) -
        (at(i + 1, j - 1) + 2 * at(i + 1, j) + at(i + 1, j + 1));
      const dy =
        at(i - 1, j - 1) + 2 * at(i, j - 1) + at(i + 1, j - 1) -
        (at(i - 1, j + 1) + 2 * at(i, j + 1) + at(i + 1, j + 1));
      const nx = dx * strength;
      const ny = dy * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const o = (j * w + i) * 4;
      out.data[o] = ((nx / len) * 0.5 + 0.5) * 255;
      out.data[o + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      out.data[o + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      out.data[o + 3] = 255;
    }
  }
  x.putImageData(out, 0, 0);
  return canvasTexture(c, false);
}

/* --------------------------------------------------------------- wrappers */

let maxAniso = 4;
export function setMaxAnisotropy(v: number): void {
  maxAniso = v;
}

export function canvasTexture(c: HTMLCanvasElement, srgb = true, repeat = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = maxAniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

export interface PBRSet {
  map: THREE.CanvasTexture;
  roughnessMap?: THREE.CanvasTexture;
  normalMap?: THREE.CanvasTexture;
}

/* ------------------------------------------------------------- generators */

/** Cast concrete platform deck: aggregate speckle, expansion grooves, grime. */
export function concreteDeck(): PBRSet {
  const S = px(512);
  const { c, x } = makeCanvas(S);
  fillNoise(x, S, S, 34, 5, 11, (n) => {
    const v = 96 + n * 46;
    const t = 0.03 * (n - 0.5) * 255;
    return [v + t * 0.4, v + t * 0.1, v * 0.98 + 2];
  });
  // aggregate specks
  for (let i = 0; i < S * 2.2; i++) {
    const r = Math.random() * 1.9 + 0.35;
    const a = Math.random() * 0.22;
    x.fillStyle = Math.random() > 0.5 ? `rgba(200,198,190,${a})` : `rgba(40,42,46,${a})`;
    x.beginPath();
    x.arc(Math.random() * S, Math.random() * S, r, 0, 7);
    x.fill();
  }
  // expansion joints
  x.strokeStyle = 'rgba(28,30,34,0.55)';
  x.lineWidth = Math.max(1, S / 220);
  for (const p of [0.25, 0.75]) {
    x.beginPath();
    x.moveTo(0, p * S);
    x.lineTo(S, p * S);
    x.stroke();
    x.beginPath();
    x.moveTo(p * S, 0);
    x.lineTo(p * S, S);
    x.stroke();
  }
  // grime patches
  const { c: gc, x: gx } = makeCanvas(S);
  fillNoise(gx, S, S, 5, 4, 71, (n) => {
    const v = n * 255;
    return [v, v, v];
  });
  x.globalAlpha = 0.22;
  x.globalCompositeOperation = 'multiply';
  x.drawImage(gc, 0, 0);
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';

  // roughness: concrete is rough, joints/grime are rougher, polished spots less
  const { c: rc, x: rx } = makeCanvas(S);
  fillNoise(rx, S, S, 9, 4, 23, (n) => {
    const v = 150 + n * 80;
    return [v, v, v];
  });

  // height for the normal map
  const { c: hc, x: hx } = makeCanvas(S);
  fillNoise(hx, S, S, 40, 4, 11, (n) => {
    const v = n * 255;
    return [v, v, v];
  });
  hx.strokeStyle = '#000';
  hx.lineWidth = Math.max(1, S / 200);
  for (const p of [0.25, 0.75]) {
    hx.beginPath();
    hx.moveTo(0, p * S);
    hx.lineTo(S, p * S);
    hx.stroke();
    hx.beginPath();
    hx.moveTo(p * S, 0);
    hx.lineTo(p * S, S);
    hx.stroke();
  }

  return {
    map: canvasTexture(c),
    roughnessMap: canvasTexture(rc, false),
    normalMap: heightToNormal(hc, 1.6),
  };
}

/** 点字ブロック — yellow tactile paving, dot type. */
export function tactilePaving(): PBRSet {
  const S = px(256);
  const { c, x } = makeCanvas(S);
  x.fillStyle = '#c9a418';
  x.fillRect(0, 0, S, S);
  const { c: nc, x: nx } = makeCanvas(S);
  fillNoise(nx, S, S, 26, 4, 5, (n) => {
    const v = 190 + n * 65;
    return [v, v, v];
  });
  x.globalAlpha = 0.4;
  x.globalCompositeOperation = 'multiply';
  x.drawImage(nc, 0, 0);
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';

  const { c: hc, x: hx } = makeCanvas(S);
  hx.fillStyle = '#202020';
  hx.fillRect(0, 0, S, S);
  const n = 5;
  const step = S / n;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const cx = (i + 0.5) * step;
      const cy = (j + 0.5) * step;
      const r = step * 0.27;
      const g = hx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.72, '#e8e8e8');
      g.addColorStop(1, '#202020');
      hx.fillStyle = g;
      hx.beginPath();
      hx.arc(cx, cy, r, 0, 7);
      hx.fill();

      const g2 = x.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
      g2.addColorStop(0, 'rgba(255,236,150,0.95)');
      g2.addColorStop(1, 'rgba(178,142,20,0.9)');
      x.fillStyle = g2;
      x.beginPath();
      x.arc(cx, cy, r, 0, 7);
      x.fill();
    }
  }
  const { c: rc, x: rx } = makeCanvas(S);
  fillNoise(rx, S, S, 12, 3, 9, (v) => {
    const g = 110 + v * 70;
    return [g, g, g];
  });
  return { map: canvasTexture(c), roughnessMap: canvasTexture(rc, false), normalMap: heightToNormal(hc, 2.6) };
}

/** Enamel wall panel with tile grid, used for the platform's back wall. */
export function wallTile(): PBRSet {
  const S = px(512);
  const { c, x } = makeCanvas(S);
  fillNoise(x, S, S, 12, 4, 31, (n) => {
    const v = 148 + n * 26;
    return [v * 0.99, v, v * 0.96];
  });
  const cols = 8;
  const rows = 4;
  x.strokeStyle = 'rgba(70,72,76,0.6)';
  x.lineWidth = Math.max(1, S / 300);
  for (let i = 0; i <= cols; i++) {
    x.beginPath();
    x.moveTo((i * S) / cols, 0);
    x.lineTo((i * S) / cols, S);
    x.stroke();
  }
  for (let j = 0; j <= rows; j++) {
    x.beginPath();
    x.moveTo(0, (j * S) / rows);
    x.lineTo(S, (j * S) / rows);
    x.stroke();
  }
  // vertical grime running down from the top
  const g = x.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, 'rgba(38,40,44,0.42)');
  g.addColorStop(0.45, 'rgba(38,40,44,0.05)');
  g.addColorStop(1, 'rgba(30,32,36,0.3)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  for (let i = 0; i < 60; i++) {
    x.fillStyle = `rgba(48,50,54,${Math.random() * 0.14})`;
    const w = Math.random() * 6 + 1;
    x.fillRect(Math.random() * S, 0, w, Math.random() * S * 0.7);
  }

  const { c: hc, x: hx } = makeCanvas(S);
  hx.fillStyle = '#c8c8c8';
  hx.fillRect(0, 0, S, S);
  hx.strokeStyle = '#101010';
  hx.lineWidth = Math.max(2, S / 200);
  for (let i = 0; i <= cols; i++) {
    hx.beginPath();
    hx.moveTo((i * S) / cols, 0);
    hx.lineTo((i * S) / cols, S);
    hx.stroke();
  }
  for (let j = 0; j <= rows; j++) {
    hx.beginPath();
    hx.moveTo(0, (j * S) / rows);
    hx.lineTo(S, (j * S) / rows);
    hx.stroke();
  }

  const { c: rc, x: rx } = makeCanvas(S);
  fillNoise(rx, S, S, 8, 3, 45, (n) => {
    const v = 70 + n * 60;
    return [v, v, v];
  });
  rx.strokeStyle = '#c0c0c0';
  rx.lineWidth = Math.max(2, S / 200);
  for (let i = 0; i <= cols; i++) {
    rx.beginPath();
    rx.moveTo((i * S) / cols, 0);
    rx.lineTo((i * S) / cols, S);
    rx.stroke();
  }

  return { map: canvasTexture(c), roughnessMap: canvasTexture(rc, false), normalMap: heightToNormal(hc, 1.2) };
}

/** Track ballast — crushed stone. */
export function ballast(): PBRSet {
  const S = px(512);
  const { c, x } = makeCanvas(S);
  x.fillStyle = '#1b1d20';
  x.fillRect(0, 0, S, S);
  for (let i = 0; i < S * 6; i++) {
    const r = Math.random() * (S / 90) + S / 300;
    const cx = Math.random() * S;
    const cy = Math.random() * S;
    const v = 28 + Math.random() * 58;
    x.fillStyle = `rgb(${v},${v * 0.99},${v * 0.95})`;
    x.beginPath();
    const sides = 5 + ((i % 3) | 0);
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2 + Math.random() * 0.4;
      const rr = r * (0.7 + Math.random() * 0.6);
      const px2 = cx + Math.cos(a) * rr;
      const py2 = cy + Math.sin(a) * rr;
      if (s === 0) x.moveTo(px2, py2);
      else x.lineTo(px2, py2);
    }
    x.closePath();
    x.fill();
  }
  const { c: rc, x: rx } = makeCanvas(S);
  fillNoise(rx, S, S, 30, 3, 61, (n) => {
    const v = 165 + n * 60;
    return [v, v, v];
  });
  const { c: hc } = { c };
  return { map: canvasTexture(c), roughnessMap: canvasTexture(rc, false), normalMap: heightToNormal(hc, 1.1) };
}

/** Wet asphalt for the area beyond the platform. */
export function wetAsphalt(): PBRSet {
  const S = px(512);
  const { c, x } = makeCanvas(S);
  fillNoise(x, S, S, 42, 5, 77, (n) => {
    const v = 26 + n * 24;
    return [v, v * 1.02, v * 1.08];
  });
  const { c: rc, x: rx } = makeCanvas(S);
  // large soft blotches = puddles (low roughness -> mirror-ish)
  fillNoise(rx, S, S, 3.4, 4, 88, (n) => {
    const v = n < 0.46 ? 22 + n * 60 : 130 + n * 90;
    return [v, v, v];
  });
  return { map: canvasTexture(c), roughnessMap: canvasTexture(rc, false) };
}

/** Painted steel / metal panel base. */
export function paintedMetal(hex: string, dirt = 0.3): PBRSet {
  const S = px(256);
  const { c, x } = makeCanvas(S);
  x.fillStyle = hex;
  x.fillRect(0, 0, S, S);
  const { c: nc, x: nx } = makeCanvas(S);
  fillNoise(nx, S, S, 22, 4, 13, (n) => {
    const v = 190 + n * 70;
    return [v, v, v];
  });
  x.globalCompositeOperation = 'multiply';
  x.globalAlpha = dirt;
  x.drawImage(nc, 0, 0);
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 26; i++) {
    x.fillStyle = `rgba(30,26,20,${Math.random() * 0.16})`;
    x.fillRect(Math.random() * S, Math.random() * S, Math.random() * 30 + 2, Math.random() * 4 + 1);
  }
  const { c: rc, x: rx } = makeCanvas(S);
  fillNoise(rx, S, S, 16, 3, 37, (n) => {
    const v = 60 + n * 70;
    return [v, v, v];
  });
  return { map: canvasTexture(c), roughnessMap: canvasTexture(rc, false) };
}

/* ------------------------------------------------------- signage & panels */

export function roundRect(
  x: CanvasRenderingContext2D,
  rx: number,
  ry: number,
  w: number,
  h: number,
  r: number,
): void {
  x.beginPath();
  x.moveTo(rx + r, ry);
  x.arcTo(rx + w, ry, rx + w, ry + h, r);
  x.arcTo(rx + w, ry + h, rx, ry + h, r);
  x.arcTo(rx, ry + h, rx, ry, r);
  x.arcTo(rx, ry, rx + w, ry, r);
  x.closePath();
}

export function fitText(
  x: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  maxW: number,
  size: number,
  font = JP_FONT,
  weight = '500',
): void {
  let s = size;
  x.font = `${weight} ${s}px ${font}`;
  while (x.measureText(text).width > maxW && s > 6) {
    s -= 1;
    x.font = `${weight} ${s}px ${font}`;
  }
  x.fillText(text, cx, cy);
}

export interface StationSignSpec {
  name: string;
  kana: string;
  romaji: string;
  prev: string;
  next: string;
  lineColor: string;
}

/** 駅名標 — the classic Japanese platform name board. */
export function stationSign(spec: StationSignSpec): THREE.CanvasTexture {
  const W = px(1024);
  const H = px(320);
  const { c, x } = makeCanvas(W, H);
  x.fillStyle = '#f2f3f0';
  x.fillRect(0, 0, W, H);
  // subtle enamel dirt
  const { c: nc, x: nx } = makeCanvas(256);
  fillNoise(nx, 256, 256, 8, 4, 19, (n) => {
    const v = 214 + n * 41;
    return [v, v, v];
  });
  x.globalCompositeOperation = 'multiply';
  x.globalAlpha = 0.5;
  x.drawImage(nc, 0, 0, W, H);
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';

  x.fillStyle = spec.lineColor;
  x.fillRect(0, H - H * 0.115, W, H * 0.115);
  x.fillStyle = '#2b2f33';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  fitText(x, spec.kana, W / 2, H * 0.19, W * 0.62, Math.round(H * 0.13), JP_FONT, '400');
  fitText(x, spec.name, W / 2, H * 0.46, W * 0.66, Math.round(H * 0.34), JP_FONT, '600');
  x.fillStyle = '#4a5057';
  fitText(x, spec.romaji, W / 2, H * 0.72, W * 0.6, Math.round(H * 0.115), MONO_FONT, '400');

  // neighbouring stations with arrows
  x.textAlign = 'left';
  x.fillStyle = '#3a4046';
  fitText(x, `← ${spec.prev}`, W * 0.035, H * 0.5, W * 0.18, Math.round(H * 0.1), JP_FONT, '400');
  x.textAlign = 'right';
  fitText(x, `${spec.next} →`, W * 0.965, H * 0.5, W * 0.18, Math.round(H * 0.1), JP_FONT, '400');

  return canvasTexture(c);
}

/** 出口 sign above the stairs; doubles as the diegetic progress counter. */
export function exitSign(numberLabel: string, caption = '出口 / EXIT'): THREE.CanvasTexture {
  const W = px(512);
  const H = px(256);
  const { c, x } = makeCanvas(W, H);
  x.fillStyle = '#0d3f22';
  x.fillRect(0, 0, W, H);
  x.strokeStyle = 'rgba(255,255,255,0.55)';
  x.lineWidth = Math.max(2, W / 140);
  x.strokeRect(x.lineWidth, x.lineWidth, W - x.lineWidth * 2, H - x.lineWidth * 2);
  x.fillStyle = '#f4fff7';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  fitText(x, numberLabel, W / 2, H * 0.42, W * 0.7, Math.round(H * 0.52), MONO_FONT, '600');
  fitText(x, caption, W / 2, H * 0.8, W * 0.8, Math.round(H * 0.13), JP_FONT, '400');
  return canvasTexture(c);
}

export interface PosterSpec {
  kind: 'rule' | 'ad' | 'notice' | 'safety' | 'lost';
  lines: string[];
  accent?: string;
  figure?: 'none' | 'person' | 'personLooking' | 'empty';
}

/** Wall posters: rules board, ads, notices. */
export function poster(spec: PosterSpec): THREE.CanvasTexture {
  const W = px(512);
  const H = px(724);
  const { c, x } = makeCanvas(W, H);
  const accent = spec.accent ?? '#1f4f8f';

  if (spec.kind === 'ad') {
    const g = x.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#12283f');
    g.addColorStop(0.55, '#25506f');
    g.addColorStop(1, '#0d1a28');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    // abstract "photo" — a figure silhouette under a warm light
    const lg = x.createRadialGradient(W * 0.5, H * 0.34, 0, W * 0.5, H * 0.34, W * 0.72);
    lg.addColorStop(0, 'rgba(255,214,160,0.5)');
    lg.addColorStop(1, 'rgba(255,214,160,0)');
    x.fillStyle = lg;
    x.fillRect(0, 0, W, H);
    if (spec.figure !== 'empty' && spec.figure !== 'none') {
      drawFigureSilhouette(x, W * 0.5, H * 0.62, H * 0.44, spec.figure === 'personLooking');
    }
    x.fillStyle = '#ffffff';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    spec.lines.forEach((l, i) => {
      fitText(x, l, W / 2, H * (0.78 + i * 0.075), W * 0.86, Math.round(H * (i === 0 ? 0.062 : 0.04)), JP_FONT, i === 0 ? '600' : '400');
    });
  } else {
    x.fillStyle = '#f6f5f1';
    x.fillRect(0, 0, W, H);
    x.fillStyle = accent;
    x.fillRect(0, 0, W, H * 0.16);
    x.fillStyle = '#ffffff';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    fitText(x, spec.lines[0] ?? '', W / 2, H * 0.08, W * 0.88, Math.round(H * 0.062), JP_FONT, '600');

    x.fillStyle = '#22262a';
    x.textAlign = 'left';
    let y = H * 0.24;
    for (let i = 1; i < spec.lines.length; i++) {
      const line = spec.lines[i];
      if (line === '') {
        y += H * 0.035;
        continue;
      }
      const bullet = line.startsWith('・');
      x.fillStyle = bullet ? '#22262a' : '#3a3f45';
      fitText(x, line, W * 0.08, y, W * 0.84, Math.round(H * 0.041), JP_FONT, bullet ? '500' : '400');
      y += H * 0.062;
    }
    x.strokeStyle = 'rgba(0,0,0,0.18)';
    x.lineWidth = 2;
    x.strokeRect(1, 1, W - 2, H - 2);
  }

  // paper aging / dampness
  const { c: nc, x: nx } = makeCanvas(256);
  fillNoise(nx, 256, 256, 6, 4, 53, (n) => {
    const v = 196 + n * 59;
    return [v, v * 0.995, v * 0.97];
  });
  x.globalCompositeOperation = 'multiply';
  x.globalAlpha = 0.42;
  x.drawImage(nc, 0, 0, W, H);
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';

  return canvasTexture(c);
}

function drawFigureSilhouette(
  x: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  h: number,
  looking: boolean,
): void {
  x.save();
  x.fillStyle = 'rgba(8,12,18,0.86)';
  const headR = h * 0.115;
  x.beginPath();
  x.arc(cx, baseY - h * 0.86, headR, 0, 7);
  x.fill();
  x.beginPath();
  x.moveTo(cx - h * 0.17, baseY);
  x.quadraticCurveTo(cx - h * 0.2, baseY - h * 0.55, cx - h * 0.11, baseY - h * 0.72);
  x.lineTo(cx + h * 0.11, baseY - h * 0.72);
  x.quadraticCurveTo(cx + h * 0.2, baseY - h * 0.55, cx + h * 0.17, baseY);
  x.closePath();
  x.fill();
  if (looking) {
    // two faint highlights where eyes would be — reads as "it is facing you"
    x.fillStyle = 'rgba(226,238,255,0.82)';
    x.beginPath();
    x.arc(cx - headR * 0.36, baseY - h * 0.875, headR * 0.115, 0, 7);
    x.fill();
    x.beginPath();
    x.arc(cx + headR * 0.36, baseY - h * 0.875, headR * 0.115, 0, 7);
    x.fill();
  }
  x.restore();
}

/** Analogue clock face (hands are real geometry so they catch the light). */
export function clockFace(): THREE.CanvasTexture {
  const S = px(512);
  const { c, x } = makeCanvas(S);
  x.fillStyle = '#f0efe9';
  x.beginPath();
  x.arc(S / 2, S / 2, S / 2 - 2, 0, 7);
  x.fill();
  x.strokeStyle = '#2a2d31';
  x.lineWidth = S * 0.012;
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const major = i % 5 === 0;
    const r1 = S * (major ? 0.375 : 0.405);
    const r2 = S * 0.435;
    x.lineWidth = major ? S * 0.016 : S * 0.006;
    x.beginPath();
    x.moveTo(S / 2 + Math.cos(a) * r1, S / 2 + Math.sin(a) * r1);
    x.lineTo(S / 2 + Math.cos(a) * r2, S / 2 + Math.sin(a) * r2);
    x.stroke();
  }
  x.fillStyle = '#2a2d31';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = `600 ${Math.round(S * 0.085)}px ${MONO_FONT}`;
  for (let i = 1; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    x.fillText(String(i), S / 2 + Math.cos(a) * S * 0.315, S / 2 + Math.sin(a) * S * 0.315);
  }
  const { c: nc, x: nx } = makeCanvas(128);
  fillNoise(nx, 128, 128, 5, 3, 91, (n) => {
    const v = 210 + n * 45;
    return [v, v, v];
  });
  x.globalCompositeOperation = 'multiply';
  x.globalAlpha = 0.35;
  x.drawImage(nc, 0, 0, S, S);
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
  return canvasTexture(c);
}

/** Vending machine front: illuminated product shelves. */
export function vendingFront(products: string[][], variant = 0): THREE.CanvasTexture {
  const W = px(512);
  const H = px(768);
  const { c, x } = makeCanvas(W, H);
  x.fillStyle = variant === 1 ? '#0e2c46' : '#a8151d';
  x.fillRect(0, 0, W, H);

  // upper display window with backlit shelves
  const winX = W * 0.06;
  const winY = H * 0.07;
  const winW = W * 0.88;
  const winH = H * 0.5;
  const wg = x.createLinearGradient(0, winY, 0, winY + winH);
  wg.addColorStop(0, '#fdfbf2');
  wg.addColorStop(1, '#dfe6ee');
  x.fillStyle = wg;
  x.fillRect(winX, winY, winW, winH);

  const rows = products.length;
  for (let r = 0; r < rows; r++) {
    const row = products[r];
    const rowY = winY + (r + 0.5) * (winH / rows);
    for (let i = 0; i < row.length; i++) {
      const cw = winW / row.length;
      const cx = winX + (i + 0.5) * cw;
      const bw = cw * 0.52;
      const bh = (winH / rows) * 0.62;
      x.fillStyle = row[i];
      roundRect(x, cx - bw / 2, rowY - bh / 2, bw, bh, bw * 0.22);
      x.fill();
      x.fillStyle = 'rgba(255,255,255,0.35)';
      x.fillRect(cx - bw / 2 + bw * 0.12, rowY - bh / 2 + bh * 0.08, bw * 0.14, bh * 0.8);
      x.fillStyle = '#1e2126';
      x.fillRect(cx - bw / 2, rowY + bh / 2 + bh * 0.09, bw, bh * 0.1);
    }
    x.fillStyle = 'rgba(120,130,140,0.5)';
    x.fillRect(winX, rowY + winH / rows / 2 - 2, winW, 2);
  }

  // lower panel: coin slot, buttons, warning label
  x.fillStyle = 'rgba(0,0,0,0.22)';
  x.fillRect(winX, H * 0.6, winW, H * 0.34);
  x.fillStyle = '#d8dade';
  x.fillRect(W * 0.63, H * 0.63, W * 0.28, H * 0.2);
  x.fillStyle = '#25282c';
  x.fillRect(W * 0.68, H * 0.66, W * 0.06, H * 0.02);
  x.fillRect(W * 0.68, H * 0.72, W * 0.18, H * 0.055);
  x.fillStyle = '#ffd34d';
  x.fillRect(W * 0.1, H * 0.63, W * 0.42, H * 0.055);
  x.fillStyle = '#1c1f22';
  x.textAlign = 'left';
  x.textBaseline = 'middle';
  fitText(x, 'つめたい / あたたかい', W * 0.12, H * 0.657, W * 0.38, Math.round(H * 0.03), JP_FONT, '600');
  x.fillStyle = '#e9ecef';
  fitText(x, '販売機番号 KT-0413', W * 0.1, H * 0.9, W * 0.5, Math.round(H * 0.022), MONO_FONT, '400');
  return canvasTexture(c);
}

/** LED departure board (redrawn whenever its content changes). */
export function departureBoard(rows: { time: string; type: string; dest: string; cars: string }[]): THREE.CanvasTexture {
  const W = px(1024);
  const H = px(320);
  const { c, x } = makeCanvas(W, H);
  x.fillStyle = '#05070a';
  x.fillRect(0, 0, W, H);

  const header = ['時刻', '種別', '行先', '両数'];
  const colX = [0.05, 0.26, 0.46, 0.86];
  x.textBaseline = 'middle';
  x.textAlign = 'left';
  x.fillStyle = '#5f6a76';
  header.forEach((h, i) => {
    x.font = `500 ${Math.round(H * 0.085)}px ${JP_FONT}`;
    x.fillText(h, W * colX[i], H * 0.14);
  });

  rows.forEach((r, i) => {
    const y = H * (0.36 + i * 0.28);
    x.fillStyle = i === 0 ? '#ffb02e' : '#ff8c1a';
    x.font = `600 ${Math.round(H * 0.15)}px ${MONO_FONT}`;
    x.fillText(r.time, W * colX[0], y);
    x.fillStyle = r.type.includes('回送') || r.type.includes('通過') ? '#7fd0ff' : '#5ee27a';
    x.font = `600 ${Math.round(H * 0.13)}px ${JP_FONT}`;
    x.fillText(r.type, W * colX[1], y);
    x.fillStyle = '#ffd9a0';
    x.font = `600 ${Math.round(H * 0.145)}px ${JP_FONT}`;
    x.fillText(r.dest, W * colX[2], y);
    x.fillStyle = '#c9d3dd';
    x.font = `500 ${Math.round(H * 0.11)}px ${MONO_FONT}`;
    x.fillText(r.cars, W * colX[3], y);
  });

  // LED dot-grid overlay so it reads as a real matrix display
  x.globalCompositeOperation = 'destination-out';
  x.fillStyle = '#000';
  const step = Math.max(2, Math.round(H / 90));
  for (let y = 0; y < H; y += step) x.fillRect(0, y, W, 1);
  x.globalCompositeOperation = 'source-over';
  return canvasTexture(c);
}

/** Small rectangular sign with a single line of text (pillar numbers, notices). */
export function labelPlate(
  text: string,
  opts: { bg?: string; fg?: string; w?: number; h?: number; font?: string; weight?: string } = {},
): THREE.CanvasTexture {
  const W = px(opts.w ?? 256);
  const H = px(opts.h ?? 128);
  const { c, x } = makeCanvas(W, H);
  x.fillStyle = opts.bg ?? '#e8e9e5';
  x.fillRect(0, 0, W, H);
  x.strokeStyle = 'rgba(0,0,0,0.25)';
  x.lineWidth = 2;
  x.strokeRect(1, 1, W - 2, H - 2);
  x.fillStyle = opts.fg ?? '#23262a';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  fitText(x, text, W / 2, H / 2, W * 0.88, Math.round(H * 0.5), opts.font ?? JP_FONT, opts.weight ?? '600');
  return canvasTexture(c);
}

/** Soft radial sprite used for rain splashes, lamp glow and dust motes. */
export function glowSprite(inner = 'rgba(255,255,255,0.9)', outer = 'rgba(255,255,255,0)'): THREE.CanvasTexture {
  const S = 128;
  const { c, x } = makeCanvas(S);
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.35)'));
  g.addColorStop(1, outer);
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  return canvasTexture(c);
}

/** Thin vertical streak used for rain line sprites. */
export function rainStreak(): THREE.CanvasTexture {
  const W = 16;
  const H = 128;
  const { c, x } = makeCanvas(W, H);
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(190,215,255,0)');
  g.addColorStop(0.35, 'rgba(200,222,255,0.55)');
  g.addColorStop(0.75, 'rgba(215,232,255,0.75)');
  g.addColorStop(1, 'rgba(190,215,255,0)');
  x.fillStyle = g;
  x.fillRect(W * 0.34, 0, W * 0.32, H);
  return canvasTexture(c);
}

/** Distant townscape strip: rooftops, windows, a red aircraft-warning light. */
export function distantTown(): THREE.CanvasTexture {
  const W = 2048;
  const H = 256;
  const { c, x } = makeCanvas(W, H);
  x.clearRect(0, 0, W, H);
  let cursor = 0;
  while (cursor < W) {
    const bw = 40 + Math.random() * 150;
    const bh = 40 + Math.random() * 150;
    const top = H - bh;
    x.fillStyle = `rgba(${8 + Math.random() * 8},${10 + Math.random() * 8},${16 + Math.random() * 10},1)`;
    x.fillRect(cursor, top, bw, bh);
    // lit windows
    const cols = Math.max(1, Math.floor(bw / 16));
    const rows = Math.max(1, Math.floor(bh / 18));
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        if (Math.random() > 0.11) continue;
        const warm = Math.random() > 0.35;
        x.fillStyle = warm ? 'rgba(255,206,140,0.85)' : 'rgba(190,220,255,0.7)';
        x.fillRect(cursor + 5 + i * 16, top + 6 + j * 18, 6, 8);
      }
    }
    if (bh > 150 && Math.random() > 0.5) {
      x.fillStyle = 'rgba(255,60,50,0.95)';
      x.beginPath();
      x.arc(cursor + bw / 2, top - 3, 3.2, 0, 7);
      x.fill();
    }
    cursor += bw + Math.random() * 26;
  }
  const t = canvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
