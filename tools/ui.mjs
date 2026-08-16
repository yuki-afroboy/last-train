/**
 * UI screen sweep.
 *
 * Visits every overlay the player can reach and screenshots it, at desktop and
 * phone sizes. Also asserts the invariant that let two layering bugs ship: at
 * most one "screen" layer may be visible at a time, and whatever is on top must
 * actually receive clicks at the position of its own buttons.
 *
 * Usage: node tools/ui.mjs <url> <outDir> [--mobile]
 */
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:4190/last-train/?debug=1';
const out = process.argv[3] ?? '/tmp/ui';
const mobile = process.argv.includes('--mobile');
mkdirSync(out, { recursive: true });

let failures = 0;
const errors = [];
const ok = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failures++;
};

/** Screen-sized layers that must never be visible simultaneously. */
const SCREENS = ['boot', 'title', 'settings', 'pause', 'result'];

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
});
const context = await browser.newContext(
  mobile
    ? { ...devices['iPhone 13 landscape'], hasTouch: true, isMobile: true }
    : { viewport: { width: 1280, height: 720 } },
);
const page = await context.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const visible = () =>
  page.evaluate(
    (ids) => ids.filter((id) => !document.getElementById(id)?.classList.contains('hidden')),
    SCREENS,
  );

/**
 * Verifies the element is not just visible but actually the topmost thing at
 * its own centre — this is what catches a layer being drawn over by another.
 */
const clickable = (sel) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return 'missing';
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return 'zero-size';
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit) return 'nothing-at-point';
    return el.contains(hit) || hit.contains(el) ? 'ok' : `covered by <${hit.tagName.toLowerCase()} id=${hit.id || '-'} class=${hit.className || '-'}>`;
  }, sel);

const shot = async (name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}.png` });
};

const label = mobile ? 'mobile' : 'desktop';
console.log(`▶ ${label}  ${url}`);

await page.goto(url, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => !!window.__shuden, null, { timeout: 90000 });

/* ---------------------------------------------------------------- title */
await shot('01-title');
ok((await visible()).join() === 'title', `title alone (${(await visible()).join() || 'none'})`);
ok((await clickable('#btn-start')) === 'ok', `START clickable: ${await clickable('#btn-start')}`);

/* ------------------------------------------------- settings, from title */
await page.click('#btn-settings');
await shot('02-settings-from-title');
let vis = await visible();
ok(vis.join() === 'settings', `settings alone, title hidden (${vis.join() || 'none'})`);
for (const sel of ['#seg-quality', '#in-sens', '#in-vol', '#in-fov', '#in-bob', '#seg-invert', '#btn-settings-back']) {
  const r = await clickable(sel);
  ok(r === 'ok', `${sel} reachable: ${r}`);
}

// every control actually changes the stored setting
await page.click('#seg-quality button[data-v="low"]');
await page.click('#seg-invert button[data-v="on"]');
await page.$eval('#in-fov', (el) => {
  el.value = '90';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('shuden0013.settings.v1')));
ok(saved.quality === 'low', `quality persisted (${saved.quality})`);
ok(saved.invertY === true, `invertY persisted (${saved.invertY})`);
ok(saved.fov === 90, `fov persisted (${saved.fov})`);
const readouts = await page.evaluate(() =>
  ['v-sens', 'v-vol', 'v-fov', 'v-bob'].map((id) => document.getElementById(id)?.textContent),
);
ok(readouts.every((t) => t && t.length > 0), `value readouts filled (${readouts.join(' ')})`);
await shot('03-settings-changed');

// restore something sane for the rest of the run
await page.click('#seg-quality button[data-v="medium"]');
await page.click('#seg-invert button[data-v="off"]');

/* ------------------------------------------------------------ back out */
await page.click('#btn-settings-back');
await shot('04-back-to-title');
vis = await visible();
ok(vis.join() === 'title', `BACK returns to title alone (${vis.join() || 'none'})`);

/* --------------------------------------------------------------- game */
await page.click('#btn-start');
await page.waitForFunction(() => window.__shuden.game.fade < 0.01, null, { timeout: 90000 });
await shot('05-hud');
vis = await visible();
ok(vis.length === 0, `no screen layer during play (${vis.join() || 'none'})`);

/* ------------------------------------------------------------- inspect */
await page.evaluate(() => window.__shuden.ui ?? null);
await page.evaluate(() => {
  const g = window.__shuden;
  g.player.position.x = -16.4;
  g.player.position.z = -2.6;
  g.player.yaw = Math.PI;
});
await page.waitForTimeout(900);
await page.evaluate(() => window.__shuden.game.ui.openInspect('ご利用のお客様へ', 'ホームに異変を見つけた場合は、引き返してください。\n異変が見つからない場合は、そのままお進みください。\n\n８回進むと、出口です。'));
await shot('06-inspect');
ok((await clickable('.inspect-card')) === 'ok', `inspect card on top: ${await clickable('.inspect-card')}`);
await page.evaluate(() => window.__shuden.game.ui.closeInspect());

/* --------------------------------------------------------------- pause */
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
await shot('07-pause');
vis = await visible();
ok(vis.join() === 'pause', `pause alone (${vis.join() || 'none'})`);
for (const sel of ['#btn-resume', '#btn-settings2', '#btn-quit']) {
  const r = await clickable(sel);
  ok(r === 'ok', `${sel} reachable: ${r}`);
}

/* ------------------------------------------------- settings, from pause */
await page.click('#btn-settings2');
await shot('08-settings-from-pause');
vis = await visible();
ok(vis.join() === 'settings', `settings alone from pause (${vis.join() || 'none'})`);
ok((await clickable('#btn-settings-back')) === 'ok', 'BACK reachable from pause settings');

// ESC must back out of settings, not resume the game underneath
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
vis = await visible();
ok(vis.join() === 'pause', `ESC in settings returns to pause (${vis.join() || 'none'})`);
await shot('09-esc-back-to-pause');

await page.click('#btn-resume');
await page.waitForTimeout(600);
vis = await visible();
ok(vis.length === 0, `RESUME clears every screen (${vis.join() || 'none'})`);

/* -------------------------------------------------------------- result */
await page.evaluate(() =>
  window.__shuden.game.ui.showResult('over', '0:13', 'GAME OVER', '時計は、０時１３分のまま。\n\nもう一度、同じホームで目を覚ます。\n\n何度目かは、思い出せない。'),
);
await shot('10-result-gameover');
vis = await visible();
ok(vis.join() === 'result', `result alone (${vis.join() || 'none'})`);
ok((await clickable('#btn-retry')) === 'ok', 'RETRY reachable');
ok((await clickable('#btn-result-title')) === 'ok', 'TITLE reachable');

await page.evaluate(() =>
  window.__shuden.game.ui.showResult('clear', '0:14', 'ESCAPED', '霧崎駅、０時１４分。\n\nドアが閉まる。\n窓の外を、誰もいないホームが流れていく。\n\nベンチの傘は、まだそこにある。'),
);
await shot('11-result-clear');

await page.click('#btn-result-title');
await page.waitForTimeout(700);
vis = await visible();
ok(vis.join() === 'title', `result -> title (${vis.join() || 'none'})`);
await shot('12-title-with-record');

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log('  ! ' + e.slice(0, 200));
console.log(`${failures} failures`);

await browser.close();
process.exit(failures > 0 || errors.length > 0 ? 1 : 0);
