import { chromium } from '/Users/reidcoleman/ApexGP/node_modules/playwright-core/index.mjs';
import { CHROME, ANGLE } from '/Users/reidcoleman/ApexGP/tools/chrome.mjs';
const [port, out, map, x, y, z, yaw, pitch, js] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(`http://localhost:${port}/lastframe.html?dev=1&map=${map}`);
await p.waitForFunction(() => window.__lf, null, { timeout: 180000 });
await p.evaluate(() => { const g = __lf.g; g.startSolo({ mode: 'tdm', bots: 0, skill: 0.5, time: 8, limit: 40, seed: 3 }, 'Tester', 0, 'carbine'); g.match.bots.clear(); });
await p.waitForTimeout(1200);
await p.evaluate(([x, y, z, yaw, pitch]) => { const g = __lf.g; Object.assign(g.me.m, { x, y, z, vx: 0, vz: 0, vy: 0 }); g.me.yaw = yaw; g.me.pitch = pitch; g.post.cutExposure = true; }, [+x, +y, +z, +yaw, +pitch]);
await p.waitForTimeout(900);
await p.screenshot({ path: out + '_a.png' });
if (js) { console.log(await p.evaluate(js)); await p.waitForTimeout(900); await p.screenshot({ path: out + '_b.png' }); }
await b.close();
