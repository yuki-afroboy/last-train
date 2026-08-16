/**
 * Visual diagnostic harness: opens the game with ?debug=1, poses the camera at
 * fixed vantage points and writes screenshots so lighting changes can be
 * compared between iterations without a human in the loop.
 *
 * Usage: node tools/diag.mjs <url> <outDir>
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

/** Mean / percentile luminance of a shot, so brightness tuning is measurable. */
function luminance(file) {
  const png = PNG.sync.read(readFileSync(file));
  const lums = [];
  // skip the debug overlay strip at the top
  for (let y = Math.floor(png.height * 0.25); y < png.height; y++) {
    for (let x = 0; x < png.width; x += 2) {
      const i = (png.width * y + x) << 2;
      lums.push(0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2]);
    }
  }
  lums.sort((a, b) => a - b);
  const at = (p) => lums[Math.floor(lums.length * p)] | 0;
  const mean = (lums.reduce((a, b) => a + b, 0) / lums.length).toFixed(1);
  return `mean ${mean}  p10 ${at(0.1)}  p50 ${at(0.5)}  p90 ${at(0.9)}  p99 ${at(0.99)}`;
}

const url = process.argv[2] ?? 'http://127.0.0.1:4173/?debug=1';
const out = process.argv[3] ?? '/tmp/diag';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
page.on('pageerror', (e) => console.log('! ' + e.message));
page.on('console', (m) => m.type() === 'error' && console.log('! ' + m.text().slice(0, 200)));

await page.goto(url, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => !!window.__shuden, null, { timeout: 90000 });
await page.click('#btn-start');
await page.waitForFunction(() => window.__shuden.game.fade < 0.01, null, { timeout: 90000 });
await page.waitForTimeout(1200);

// Freeze the game loop so poses are deterministic
await page.evaluate(() => {
  const g = window.__shuden;
  g.game.phase = 'frozen';
  window.__pose = (x, z, yaw, pitch = 0) => {
    const cam = g.gfx.camera;
    cam.position.set(x, 1.1 + 1.66, z);
    cam.rotation.set(0, 0, 0);
    cam.rotateY(yaw);
    cam.rotateX(pitch);
  };
});

const poses = {
  'a-spawn-forward': [-15, 0.4, -Math.PI / 2, -0.03],
  'b-mid-forward': [-2, 0.6, -Math.PI / 2, 0],
  'c-mid-wall': [-2, 1.6, Math.PI, -0.05],
  'd-edge-track': [0, 2.6, 0, -0.06],
  'e-north-end': [14, 0.4, -Math.PI / 2, 0.05],
  'e2-exit-sign': [9, 0.4, -Math.PI / 2, 0.16],
  'f-look-back': [8, 0.6, Math.PI / 2, 0],
  'g-clock': [-4, 1.4, -Math.PI / 2, 0.42],
  'h-vending': [7.8, 1.2, Math.PI, 0.06],
};

for (const [name, p] of Object.entries(poses)) {
  await page.evaluate((p) => window.__pose(...p), p);
  await page.waitForTimeout(450);
  const file = `${out}/${name}.png`;
  await page.screenshot({ path: file });
  console.log(name.padEnd(18), luminance(file));
}

console.log('screenshots ->', out);
await browser.close();
