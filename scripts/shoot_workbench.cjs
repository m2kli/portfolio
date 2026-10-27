// Screenshots of the portfolio workbench build for the work page (cover + gallery).
// Uses the Playwright install in the LevelWorkbench repo and the local Edge/Chrome.
//   node scripts/shoot_workbench.cjs [path/to/LevelWorkbench]
const path = require('path');
const { pathToFileURL } = require('url');

const workbenchRepo = process.argv[2] || 'C:/Users/m2k/Documents/LevelWorkbench';
const { chromium } = require(require.resolve('playwright', { paths: [workbenchRepo] }));

const root = path.resolve(__dirname, '..');
const page_ = pathToFileURL(path.join(root, 'public/demos/level-workbench/index.html')).href;
const out = path.join(root, 'public/works/level-workbench');

// name, hash, needs 3D
const shots = [
  ['01-jinci-3d', 'map=jinci&view=3d', true],
  ['02-jinci-plan', 'map=jinci&style=plan', false],
  ['03-china-heat', 'map=china&layers=heat', false],
  ['04-egypt-exits', 'map=egypt&layers=exits', false],
  ['05-multifloor-3d', 'map=sample-multifloor&view=3d', true],
  ['06-ai-sample-issues', 'map=ai-sample&layers=clearance', false],
];

async function launch() {
  for (const channel of ['msedge', 'chrome', undefined]) {
    try {
      return await chromium.launch({ channel, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    } catch (e) { /* try next */ }
  }
  throw new Error('no browser available');
}

(async () => {
  const browser = await launch();
  for (const [name, hash, is3d] of shots) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 });
    await page.goto(`${page_}#${hash}`, { waitUntil: 'load' });
    if (is3d) {
      await page.waitForFunction(() => window.__workbench?.view3d?.ready || window.__workbench?.view3d?.error, null, { timeout: 20000 });
    }
    await page.waitForTimeout(is3d ? 1200 : 700);
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    console.log('shot', name);
    await page.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
