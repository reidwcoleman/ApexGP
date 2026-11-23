// A late joiner alone, with the host's and the joiner's network chatter printed.   node tools/lastframe/netjoin.mjs PORT [map]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
const port = process.argv[2] ?? '5281', map = process.argv[3] ?? 'ward';
const base = `http://localhost:${port}/lastframe.html`;
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', ...a);
const page = async (name) => {
  const p = await (await b.newContext({ viewport: { width: 480, height: 270 } })).newPage();
  p.on('pageerror', (e) => log(`[${name}] pageerror`, e.message, (e.stack ?? '').slice(0, 400)));
  p.on('console', (m) => { if (/\[net\]|\[dbg\]/.test(m.text())) log(`[${name}]`, m.text().slice(0, 300)); });
  return p;
};
const H = await page('host');
await H.goto(`${base}?dev=1&map=${map}`);
await H.waitForFunction(() => window.__lf, null, { timeout: 300000 });
await H.evaluate(() => { const h = __lf.g.hud; h.name = 'Hosty'; h.mode = 'tdm'; h.bots = 3; h.openRoom(); });
await H.waitForFunction(() => __lf.g.hud.host?.peer.open, null, { timeout: 40000 });
const code = await H.evaluate(() => __lf.g.hud.code);
await H.evaluate(() => __lf.g.hud.startHosted());
await H.waitForFunction(() => __lf.g.match.phase === 'live', null, { timeout: 90000 });
await H.evaluate(() => {
  const h = __lf.g.host, drop = h.drop.bind(h);
  h.drop = (id) => { console.log('[dbg] drop', id, new Error().stack.split('\n').slice(1, 5).join(' | ')); drop(id); };
});
log('host live', code);
const G = await page('guest');
await G.goto(`${base}?dev=1&map=${map}&join=${code}${process.env.NET ? '&net=' + process.env.NET : ''}`);
await G.waitForFunction(() => window.__lf?.g.inMatch && __lf.g.mySlot >= 0, null, { timeout: 300000 });
log('guest in', await G.evaluate(() => ({ slot: __lf.g.mySlot, phase: __lf.g.phase, alive: __lf.g.me.alive })));
for (let k = 0; k < 6; k++) {
  await new Promise((r) => setTimeout(r, 2000));
  log('host', JSON.stringify(await H.evaluate(() => ({ people: __lf.g.match.players.filter((p) => !p.bot).map((p) => p.slot + ':' + p.name), guests: [...__lf.g.host.guests.values()].map((g) => ({ ctl: g.ctl?.open, st: g.st?.open, ping: Math.round(g.ping), quiet: Math.round(performance.now() - g.heard) })) }))),
    'guest', JSON.stringify(await G.evaluate(() => ({ in: __lf.g.inMatch, phase: __lf.g.phase, alive: __lf.g.me.alive, clock: __lf.g.clock.toFixed(1), score: __lf.g.score.join('-') }))));
}
await b.close();
