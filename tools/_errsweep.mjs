// Boots races in several conditions with three's shader error check on and prints any console errors.
//   PORT=5190 node tools/_errsweep.mjs monza:clear:midday,monza:fog:night,...
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const list = (process.argv[2] ?? 'monza:clear:midday').split(',');
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const item of list) {
  const [track, weather, time] = item.split(':');
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
  await p.goto(`http://localhost:${process.env.PORT ?? 5190}/?track=${track}&demo=race&cam=chase&skip=15&weather=${weather}&time=${time}&shadercheck`);
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 300000 }).catch(() => errs.push('timeout'));
  for (const c of ['tcam', 'cockpit', 'tv', 'heli', 'grandstand']) { await p.evaluate((x) => window.__game.cams.set(x), c); await p.waitForTimeout(900); }
  console.log(item, errs.length ? `${errs.length} errors:\n  ` + [...new Set(errs)].slice(0, 5).join('\n  ') : 'OK');
  await p.close();
}
await b.close();
