// High-res top-down maps, plan drawings and pacing curves for the work pages, rendered by the
// portfolio workbench build (public/demos/level-workbench). Map JSON is pasted in, so maps that
// aren't in the public build (e.g. the Jinci POI) can be rendered too.
//   node scripts/shoot_maps.cjs
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const WB = 'C:/Users/m2k/Documents/LevelWorkbench';
const JINCI = 'C:/Users/m2k/Documents/JinciLevelTest';
const { chromium } = require(require.resolve('playwright', { paths: [WB] }));
const root = path.resolve(__dirname, '..');
const pageUrl = pathToFileURL(path.join(root, 'public/demos/level-workbench/index.html')).href;

// [work slug, file prefix, map JSON]
const targets = [
  ['zhenshui', 'full', path.join(JINCI, 'maps/jinci-full-detail.json')],  // POI detail in place of zones 13 / 14
  ['zhenshui', 'poi', path.join(JINCI, 'maps/jinci-poi.json')],
  ['after-the-9', 'egypt', path.join(WB, 'maps/egypt.json')],
  ['after-the-9', 'china', path.join(WB, 'maps/china.json')],
];

async function launch() {
  const args = ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  for (const channel of ['msedge', 'chrome', undefined]) {
    try { return await chromium.launch({ channel, headless: true, args }); } catch { /* next */ }
  }
  throw new Error('no browser');
}

(async () => {
  const browser = await launch();
  // 2× pixel density: the map canvas comes out ~3000+ px on its long side
  const page = await browser.newPage({ viewport: { width: 1700, height: 1400 }, deviceScaleFactor: 2 });
  await page.goto(pageUrl, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  // keep transient UI out of the shots: toast, 3D controls hint, minimap, camera-speed readout
  await page.addStyleTag({ content: '#toast,.wb-gl-hint,.wb-gl-mini,.wb-gl-speed{display:none!important}' });
  // collapse both side panels so the map gets the whole width
  await page.keyboard.press('[');
  await page.keyboard.press(']');

  // add the map to the workbench's in-memory list and open it (works for maps outside the public build)
  const load = async (tag, file) => {
    const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    await page.evaluate(([key, map]) => { window.__workbench.maps[key] = map; window.__workbench.loadMap(key); }, [`shot-${tag}`, data]);
    await page.waitForTimeout(800);
  };
  const fit = async () => { await page.click('#fitBtn'); await page.waitForTimeout(500); };
  const shot = async (selector, slug, name) => {
    const dir = path.join(root, 'public/works', slug);
    fs.mkdirSync(dir, { recursive: true });
    await page.locator(selector).screenshot({ path: path.join(dir, name) });
    console.log('saved', `${slug}/${name}`);
  };

  for (const [slug, tag, file] of targets) {
    await load(tag, file);
    await page.click('#styleSchemaBtn');   // schematic: rooms, routes (flow), enemies
    await fit();
    await shot('#canvasWrap', slug, `map-${tag}-flow.png`);
    await page.click('#stylePlanBtn');     // architectural plan drawing
    await fit();
    await shot('#canvasWrap', slug, `map-${tag}-plan.png`);
    await page.click('#styleSchemaBtn');
    await shot('#pacingPanel', slug, `map-${tag}-pacing.png`);
    // 3D block-out from the same map data
    await page.click('#view3dBtn');
    await page.waitForFunction(() => window.__workbench.view3d.ready || window.__workbench.view3d.error, null, { timeout: 30000 });
    await page.waitForTimeout(800);
    await page.click('#viewIsoBtn');       // 2.5D orthographic: always frames the whole map
    await page.waitForTimeout(800);
    await fit();
    await page.waitForTimeout(1500);
    await shot('#canvasWrap', slug, `map-${tag}-3d.png`);
    await page.click('#view2dBtn');
    await page.waitForTimeout(400);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
