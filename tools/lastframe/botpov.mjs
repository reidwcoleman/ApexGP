// Through a bot's eyes: the player falls at once, the game's own camera for the fallen rides with one of their side, and
// a frame is kept every quarter second. For judging by eye whether it looks about like a person.
//   node tools/lastframe/botpov.mjs PORT map OUTDIR [frames]        (WAIT=ms into the round before the first frame)
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
import fs from 'node:fs';
const [port, map = 'ward', out = 'pov', frames = '16', side = 'atk'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 640, height: 360 } })).newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message, (e.stack ?? '').slice(0, 300)));
await p.goto(`http://localhost:${port}/lastframe.html?dev=1&map=${map}`);
await p.waitForFunction(() => window.__lf, null, { timeout: 400000 });
await p.evaluate(([seed, side]) => {
  const g = __lf.g;
  g.startSolo({ mode: 'siege', bots: 5, skill: 0.5, time: 8, limit: 99, seed }, 'Tester', 0, 'carbine');
  // the game's own camera for the fallen follows someone of your side: fall at once, every round
  void side;
  setInterval(() => {
    const m = g.match, me = m?.players.find((q) => !q.bot);
    if (me?.alive && (m.phase === 'prep' || m.phase === 'live')) m.damage(me.slot, me.slot, 999, 0, 0, [0, 0, 1], 0);
  }, 200);
}, [+(process.env.SEED ?? 5), side]);
await p.waitForFunction(() => __lf.g.match.phase === 'live', null, { timeout: 120000 });
await p.waitForTimeout(+(process.env.WAIT ?? 9000));
for (let k = 0; k < +frames; k++) {
  await p.screenshot({ path: `${out}/f${String(k).padStart(2, '0')}.png` });
  await p.waitForTimeout(250);
}
console.log('wrote', frames, 'frames to', out);
await b.close();
