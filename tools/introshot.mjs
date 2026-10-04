// The race intro (IntroDirector), a frame from each shot: the clock is held (Game.introHold) at the
// start and the middle of every shot, then the drop and the race camera.
//
//   node tools/introshot.mjs [track=monza] [times=auto|1.5,4.8,…] [outdir=shots/intro] [time=afternoon] [weather=clear] [--port 5191]
//
// `--seq fps,dur,start` saves a frame sequence instead (intro time start … start+dur at 1/fps steps).
import { chromium } from 'playwright-core';
const args = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !(all[i - 1] ?? '').startsWith('--'));
const opt = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const [track = 'monza', times = 'auto', out = 'shots/intro', tod = 'afternoon', wx = 'clear'] = args;
const port = opt('port', '5191');
const seq = opt('seq', null)?.split(',').map(Number);
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => m.text().startsWith('[intro]') && console.log(m.text()));
await page.goto(`http://localhost:${port}/?track=${track}`, { timeout: 400000 });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 400000, polling: 500 });
await page.evaluate(([tod, wx]) => {
  const g = window.__game;
  g.adaptQuality = () => {};
  g.menu.setup.grid = 1;
  g.menu.setup.time = tod;
  g.menu.setup.weather = wx;
  g.introHold = 0.05;
  g['startRace']('race', g['sessionSetup'](g.menu.setup));
}, [tod, wx]);
await page.waitForTimeout(1500);
const shots = await page.evaluate(() => window.__game['introDirector']?.shots.map((s) => [s.name, s.dur]) ?? []);
console.log('shots', JSON.stringify(shots));
const hold = (t) => page.evaluate((t) => ((window.__game.introHold = t), (window.__game['stateTime'] = t)), t);
if (seq) {
  const [fps, dur, start] = seq;
  for (let i = 0; i / fps <= dur + 1e-6; i++) {
    await hold(start + i / fps);
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${out}/${track}_seq_${String(i).padStart(3, '0')}.png` });
  }
} else {
  let list;
  if (times === 'auto') {
    list = [];
    let t = 0;
    for (const [, d] of shots) {
      list.push(+(t + 0.12).toFixed(2), +(t + d * 0.55).toFixed(2));
      t += d;
    }
    list.push(+(t + 0.55).toFixed(2), +(t + 2.5).toFixed(2));
  } else list = times.split(',').map(Number);
  for (const t of list) {
    await hold(t);
    await page.waitForTimeout(1300);
    await page.screenshot({ path: `${out}/${track}_${tod}_${wx}_${String(t).padStart(5, '0')}.png` });
  }
  console.log('saved', list.join(','));
}
await browser.close();
