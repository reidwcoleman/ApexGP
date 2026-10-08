// The trackside brands of one circuit: the start gantry, the main straight's boards, the first
// corner's run-off from above, and every board atlas / LED reel dumped as a PNG (to read the
// lockups at full size). node tools/_brandshots.mjs <out> <track> [--atlases]   (PORT, W, H)
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const [out, track] = process.argv.slice(2);
const atlases = process.argv.includes('--atlases');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 720) } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.text().includes('[partners]')) console.log(`[${m.type()}]`, m.text().slice(0, 300)); });
await page.goto(`http://localhost:${process.env.PORT ?? 5196}/?track=${track}&demo=race&skip=20&weather=clear&time=afternoon&settle=500`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 400000 });
const info = await page.evaluate(() => {
  document.querySelectorAll('#ui, #menu, .hud').forEach((e) => (e.style.display = 'none'));
  const g = window.__game; g.adaptQuality = () => {}; g.gfx.setDynamicScale(1);
  const t = g.track;
  const c1 = t.corners[0];
  return { start: t.startS, L: t.length, pitSide: t.pit.side, t1: c1 ? c1.sApex : 800, t1dir: c1 ? c1.dir : 1 };
});
const W = (s) => ((s % info.L) + info.L) % info.L;
const stand = -info.pitSide;
const views = [
  ['gantry', W(info.start - 70), 0, 2.2, W(info.start), 0, 7.5, 40],
  ['straight', W(info.start + 120), stand * 2, 2.5, W(info.start + 260), stand * 16, 1.6, 38],
  ['t1', W(info.t1 - 90), -info.t1dir * 4, 30, W(info.t1 + 10), info.t1dir * 20, 0, 50],
];
for (const [name, s, lat, h, ls, ll, lh, fov] of views) {
  await page.evaluate(([s, lat, h, ls, ll, lh, fov]) => {
    const g = window.__game;
    g.freeCam = { pos: g.trackPoint(s, lat, h), look: g.trackPoint(ls, ll, lh), fov };
  }, [s, lat, h, ls, ll, lh, fov]);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/${track}_${name}.jpg`, quality: 88 });
}
if (atlases) {
  const dumps = await page.evaluate(() => {
    const seen = new Map();
    window.__game.scene.traverse((o) => {
      const m = o.material;
      if (!m || Array.isArray(m)) return;
      for (const tex of [m.map, m.emissiveMap]) {
        const img = tex?.image;
        if (!img || !(img instanceof HTMLCanvasElement) || img.width < 512 || seen.has(img) || !/print|decal|board|dress|ads|led|banner|paint|runoff/.test(o.name)) continue;
        seen.set(img, o.name || 'mesh');
      }
    });
    const out = [];
    for (const [img, name] of seen) {
      const k = Math.min(1, 1600 / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      out.push([name, c.toDataURL('image/png')]);
    }
    return out;
  });
  dumps.forEach(([name, url], i) => writeFileSync(`${out}/${track}_atlas${i}_${name.replace(/[^\w]/g, '_')}.png`, Buffer.from(url.split(',')[1], 'base64')));
  console.log('atlases', dumps.map((d) => d[0]).join(', '));
}
console.log('done', track);
await browser.close();
