/**
 * Non-cumulative render bisect: reloads the page for every variant so each
 * measurement is independent, then reports mean screen luminance from a fixed
 * camera pose. Used to find which layer is washing the image out.
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/?debug=1';
const out = process.argv[3] ?? '/tmp/bisect';
mkdirSync(out, { recursive: true });

function lum(file) {
  const png = PNG.sync.read(readFileSync(file));
  let s = 0;
  let n = 0;
  for (let y = Math.floor(png.height * 0.3); y < png.height; y++) {
    for (let x = 0; x < png.width; x += 3) {
      const i = (png.width * y + x) << 2;
      s += 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
      n++;
    }
  }
  return (s / n).toFixed(1);
}

const variants = {
  baseline: () => {},
  'no-rain': () => {
    window.__shuden.station.rain.group.visible = false;
  },
  'no-bloom': () => {
    window.__shuden.gfx.setBloomStrength(0);
  },
  'no-grade': () => {
    const g = window.__shuden.gfx;
    g.composer.passes[g.composer.passes.length - 1].enabled = false;
  },
  'no-fog': () => {
    window.__shuden.scene.fog = null;
  },
  'no-emissive': () => {
    window.__shuden.scene.traverse((o) => {
      if (o.material && o.material.emissiveIntensity !== undefined) o.material.emissiveIntensity = 0;
    });
  },
};

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
});

for (const [name, fn] of Object.entries(variants)) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => !!window.__shuden, null, { timeout: 90000 });
  await page.click('#btn-start');
  // wait until the fade-in has actually finished before measuring
  await page.waitForFunction(() => window.__shuden.game.fade < 0.01, null, { timeout: 60000 });
  await page.evaluate(() => {
    const g = window.__shuden;
    g.game.phase = 'frozen';
    document.getElementById('debug').style.display = 'none';
    const cam = g.gfx.camera;
    cam.position.set(-2, 2.76, 0.6);
    cam.rotation.set(0, 0, 0);
    cam.rotateY(-Math.PI / 2);
  });
  await page.evaluate(`(${fn.toString()})()`);
  await page.waitForTimeout(700);
  const f = `${out}/${name}.png`;
  await page.screenshot({ path: f });
  console.log(name.padEnd(14), lum(f));
  await page.close();
}

await browser.close();
