/**
 * Gameplay integration test.
 *
 * Drives the game through every anomaly in the catalogue, then through a win
 * and a loss, asserting that state transitions land where they should and that
 * nothing throws. Runs headlessly so it can gate a deploy.
 *
 * Usage: node tools/playthrough.mjs [url]
 */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/?debug=1';
const errors = [];
let failures = 0;

const ok = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failures++;
};

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
});
// Small viewport + LOW quality: the software rasteriser is the bottleneck, and
// the renderer clamps dt to 0.1 s per frame, so a slow frame rate makes game
// time crawl. Keeping the frame cheap keeps the test near real time.
const page = await browser.newPage({ viewport: { width: 420, height: 260 } });
await page.addInitScript(() => {
  localStorage.setItem(
    'shuden0013.settings.v1',
    JSON.stringify({ quality: 'low', sensitivity: 1, volume: 0, fov: 75, bob: 0.5, invertY: false }),
  );
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(url, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => !!window.__shuden, null, { timeout: 90000 });
await page.click('#btn-start');
await page.waitForFunction(() => window.__shuden.game.fade < 0.01, null, { timeout: 60000 });

const ids = await page.evaluate(() => window.__shuden.anomalies.registry.map((a) => a.id));
console.log(`\n— exercising ${ids.length} anomalies —`);

for (const id of ids) {
  const before = errors.length;
  // fire-and-poll: beginLoop's promise can also wait out an ambient
  // announcement, which is irrelevant to what this test asserts
  await page.evaluate((id) => {
    const g = window.__shuden;
    g.anomalies.forcedId = id;
    void g.game.beginLoop(false);
  }, id);
  await page.waitForFunction(() => window.__shuden.game.fade < 0.01, null, { timeout: 30000 });
  // let update() hooks run for a while, and move the player so position-driven
  // anomalies (stalker, hider, announcement trigger) actually fire
  await page.evaluate(() => {
    window.__shuden.player.position.x = 4;
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    window.__shuden.player.position.x = -8;
  });
  await page.waitForTimeout(400);
  const applied = await page.evaluate(() => window.__shuden.anomalies.current?.id ?? null);
  const newErrors = errors.slice(before);
  if (applied !== id || newErrors.length) {
    console.log(`✗ ${id}  applied=${applied}  errors=${newErrors.join(' | ').slice(0, 160)}`);
    failures++;
  }
}
console.log(`(${failures} anomaly failures)`);

// reset back to a clean loop
await page.evaluate(() => {
  const g = window.__shuden;
  g.anomalies.forcedId = 'none';
  void g.game.beginLoop(false);
});
await page.waitForFunction(() => window.__shuden.game.fade < 0.01, null, { timeout: 30000 });

console.log('\n— judgement rules —');

const judge = async (dir) => {
  await page.evaluate((d) => window.__shuden.game.judge(d), dir);
  await page
    .waitForFunction(() => window.__shuden.game.fade < 0.01, null, { timeout: 30000 })
    .catch(() => {});
  return page.evaluate(() => ({
    progress: window.__shuden.game.progress,
    strikes: window.__shuden.game.strikes,
    phase: window.__shuden.game.phase,
  }));
};

// clean loop + walk forward = correct
await page.evaluate(() => {
  const g = window.__shuden;
  g.game.progress = 0;
  g.game.strikes = 0;
  g.anomalies.forcedId = 'none';
  void g.game.beginLoop(false);
});
await page.waitForFunction(() => window.__shuden.game.fade < 0.01, null, { timeout: 30000 });
let s = await judge('forward');
ok(s.progress === 1 && s.strikes === 0, `clean loop + forward -> progress 1 (got ${s.progress}/${s.strikes})`);

// clean loop + turn back = wrong
await page.evaluate(() => {
  const g = window.__shuden;
  g.anomalies.forcedId = 'none';
  void g.game.beginLoop(false);
});
await page.waitForFunction(() => window.__shuden.game.fade < 0.01, null, { timeout: 30000 });
s = await judge('back');
ok(s.progress === 0 && s.strikes === 1, `clean loop + back -> reset + 1 strike (got ${s.progress}/${s.strikes})`);

// anomalous loop + turn back = correct
await page.evaluate(() => {
  const g = window.__shuden;
  g.anomalies.forcedId = 'lamp-out';
  void g.game.beginLoop(false);
});
await page.waitForFunction(() => window.__shuden.game.fade < 0.01, null, { timeout: 30000 });
s = await judge('back');
ok(s.progress === 1 && s.strikes === 1, `anomaly + back -> progress 1 (got ${s.progress}/${s.strikes})`);

// anomalous loop + walk forward = wrong
await page.evaluate(() => {
  const g = window.__shuden;
  g.anomalies.forcedId = 'clock-0012';
  void g.game.beginLoop(false);
});
await page.waitForFunction(() => window.__shuden.game.fade < 0.01, null, { timeout: 30000 });
s = await judge('forward');
ok(s.progress === 0 && s.strikes === 2, `anomaly + forward -> reset + strike (got ${s.progress}/${s.strikes})`);

console.log('\n— game over —');
await page.evaluate(() => {
  const g = window.__shuden;
  g.game.strikes = 2;
  g.anomalies.forcedId = 'none';
  void g.game.beginLoop(false);
});
await page.waitForFunction(() => window.__shuden.game.fade < 0.01, null, { timeout: 30000 });
await page.evaluate(() => window.__shuden.game.judge('back'));
await page.waitForFunction(
  () => !document.getElementById('result')?.classList.contains('hidden'),
  null,
  { timeout: 60000 },
);
const overText = await page.textContent('#result-title');
const overClock = await page.textContent('#result-clock');
ok(overText === 'GAME OVER', `game over screen shown (title="${overText}")`);
ok(overClock === '0:13', `game over clock still 0:13 (got ${overClock})`);
await page.screenshot({ path: '/tmp/pt-gameover.png' });

console.log('\n— clear / ending —');
await page.click('#btn-retry');
await page.waitForFunction(() => window.__shuden.game.fade < 0.01, null, { timeout: 60000 });
await page.evaluate(() => {
  const g = window.__shuden;
  g.game.progress = 7;
  g.anomalies.forcedId = 'none';
  void g.game.beginLoop(false);
});
await page.waitForFunction(() => window.__shuden.game.fade < 0.01, null, { timeout: 30000 });
await page.evaluate(() => window.__shuden.game.judge('forward'));

// the ending waits for the player to board; drive that once the doors open
await page.waitForFunction(() => window.__shuden.game.phase === 'ending', null, { timeout: 30000 });
console.log('  ending sequence started, waiting for the train…');
await page.waitForFunction(
  () => {
    const t = window.__shuden.station.train;
    return t && t.doorOpen > 0.99;
  },
  null,
  { timeout: 180000 },
);
console.log('  doors open');
await page.screenshot({ path: '/tmp/pt-train.png' });

// stand at the doorway and press the interact key
await page.evaluate(() => {
  const g = window.__shuden;
  const stopX = g.station.train.group.position.x;
  g.player.position.x = stopX + 15.5;
  g.player.position.z = 3.4;
});
await page.waitForTimeout(700);
for (let i = 0; i < 12; i++) {
  await page.evaluate(() => window.__shuden.game.input?.queueInteract?.());
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(400);
  const done = await page.evaluate(() => window.__shuden.game.phase);
  if (done !== 'ending') break;
}

await page.waitForFunction(
  () => !document.getElementById('result')?.classList.contains('hidden'),
  null,
  { timeout: 60000 },
);
const clearTitle = await page.textContent('#result-title');
const clearClock = await page.textContent('#result-clock');
ok(clearTitle === 'ESCAPED', `clear screen shown (title="${clearTitle}")`);
ok(clearClock === '0:14', `clock finally reads 0:14 (got ${clearClock})`);
await page.screenshot({ path: '/tmp/pt-clear.png' });

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log('  ! ' + e.slice(0, 220));

await browser.close();
process.exit(failures > 0 || errors.length > 0 ? 1 : 0);
