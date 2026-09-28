// Check the engineer's recorded lines load, decode and play through the radio chain. node tools/voicetest.mjs
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[error]', m.text().slice(0, 200)); });
await page.goto('http://localhost:5191/?track=monza');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
const r = await page.evaluate(async () => {
  const g = window.__game;
  await g.audio.init?.();
  g.audioReady = true;
  const ids = ['wing_damage', 'box_box', 'win'];
  const out = {};
  for (const id of ids) { const b = await g.audio['voiceBuffer'](id); out[id] = b ? +b.duration.toFixed(2) : null; }
  g.audio.radioVoice('box_box');
  await new Promise((r) => setTimeout(r, 400));
  out.playing = !!g.audio['voiceNow'];
  out.ctx = g.audio.context?.state ?? g.audio['ctx']?.state;
  return out;
});
console.log(JSON.stringify(r));
await browser.close();
