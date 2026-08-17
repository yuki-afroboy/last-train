/**
 * Headless play-through smoke test.
 *
 * Loads a built (or dev) URL in Chromium with a real GPU-less WebGL context,
 * walks the platform end to end using synthetic input, and reports console
 * errors, failed requests, FPS and the state the game reached.
 *
 * Usage: node tools/smoke.mjs [url] [--shots=dir] [--mobile]
 */
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:4173/';
const shotDir = (process.argv.find((a) => a.startsWith('--shots=')) ?? '--shots=').slice(8);
const mobile = process.argv.includes('--mobile');
if (shotDir) mkdirSync(shotDir, { recursive: true });

const errors = [];
const failedRequests = [];

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: [
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--disable-gpu-sandbox',
    '--no-sandbox',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const context = await browser.newContext(
  mobile
    ? { ...devices['iPhone 13'], hasTouch: true, isMobile: true }
    : { viewport: { width: 1280, height: 720 } },
);
const page = await context.newPage();

page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => failedRequests.push(`${r.url()} :: ${r.failure()?.errorText}`));
page.on('response', (r) => {
  if (r.status() >= 400) failedRequests.push(`${r.url()} :: HTTP ${r.status()}`);
});

const shot = async (name) => {
  if (!shotDir) return;
  await page.screenshot({ path: `${shotDir}/${name}.png` });
};

console.log(`▶ ${url} (${mobile ? 'mobile' : 'desktop'})`);
await page.goto(url, { waitUntil: 'load', timeout: 60000 });

// wait for the boot sequence to hand over to the title screen
await page.waitForFunction(
  () => !document.getElementById('title')?.classList.contains('hidden'),
  null,
  { timeout: 90000 },
);
console.log('✓ title screen reached');
await page.waitForTimeout(2500);
await shot('01-title');

await page.click('#btn-start');
await page.waitForTimeout(4000);
await shot('02-platform');

// Verify the in-game HUD is live and the exit counter exists
const hudVisible = await page.evaluate(
  () => !document.getElementById('hud')?.classList.contains('hidden'),
);
console.log(hudVisible ? '✓ HUD active' : '✗ HUD missing');

const walk = async (key, ms) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
};

// Pointer lock does not engage headlessly, so drive movement with keys only.
await walk('KeyW', 6000);
await shot('03-mid-platform');
await walk('KeyW', 9000);
await shot('04-far-end');

const state = await page.evaluate(() => ({
  x: window.__debugPos?.x ?? null,
  fps: window.__debugFps ?? null,
}));

// Measure frame rate over 3 s
const fps = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let n = 0;
      const t0 = performance.now();
      const tick = () => {
        n++;
        if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
        else resolve((n / (performance.now() - t0)) * 1000);
      };
      requestAnimationFrame(tick);
    }),
);
console.log(`✓ ~${fps.toFixed(1)} fps (software rasteriser)`);

await page.keyboard.press('Escape');
await page.waitForTimeout(600);
const paused = await page.evaluate(
  () => !document.getElementById('pause')?.classList.contains('hidden'),
);
console.log(paused ? '✓ pause menu opens' : '✗ pause menu did not open');
await shot('05-pause');

// reload resilience
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(
  () => !document.getElementById('title')?.classList.contains('hidden'),
  null,
  { timeout: 90000 },
);
console.log('✓ reload returns to a working title screen');

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 12)) console.log('  ! ' + e.slice(0, 300));
console.log(`failed requests: ${failedRequests.length}`);
for (const f of failedRequests.slice(0, 12)) console.log('  ! ' + f);
if (state.x !== null) console.log('player x:', state.x);

await browser.close();
process.exit(errors.length > 0 || failedRequests.length > 0 ? 1 : 0);
