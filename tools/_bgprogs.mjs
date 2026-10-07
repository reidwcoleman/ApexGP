// Which shader programs are linked synchronously by a garage frame while the circuit grows behind it:
// every frame after the garage is up that linked a program in a draw (SYNC: it blocked that frame)
// or ran over MIN ms, with the programs made in it (SYNC or q = queued by a compile) and the
// materials and objects that own them (dev server: readable names).
//   PORT=5311 [TRACK=monza] [MIN=150] node tools/_bgprogs.mjs
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const port = process.env.PORT ?? 5311;
const MIN = Number(process.env.MIN ?? 150);
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.addInitScript(() => {
  window.__frames = [];
  // program ids made in each frame, and where the links came from (stack)
  let made = [];
  const P = WebGL2RenderingContext.prototype;
  const link = P.linkProgram;
  P.linkProgram = function (pr) {
    // a link made by a draw (setProgram) blocks that frame; one made by compile() is queued
    made.push(/setProgram|renderBufferDirect/.test(new Error().stack) ? 'SYNC' : 'q');
    return link.call(this, pr);
  };
  let last = performance.now();
  const f = (t) => {
    const g = window.__game;
    const progs = g?.gfx?.renderer?.info?.programs ?? [];
    window.__frames.push([Math.round(t), Math.round(t - last), g ? +g.worldProgress.toFixed(3) : -1, progs.length ? progs[progs.length - 1].id : 0, made]);
    made = [];
    last = t;
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
});
await p.goto(`http://localhost:${port}/?track=${process.env.TRACK ?? 'monza'}&settle=0`);
await p.waitForFunction(() => performance.getEntriesByName('apex:world').length > 0, null, { timeout: 600000, polling: 250 });
const r = await p.evaluate((MIN) => {
  const g = window.__game, R = g.gfx.renderer;
  const garage = performance.getEntriesByName('apex:garage')[0].startTime;
  // owners of every live program
  const own = new Map();
  g.scene.traverse((o) => {
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of [...ms, o.customDepthMaterial, o.customDistanceMaterial].filter(Boolean)) {
      const pr = R.properties.get(m);
      for (const q of pr.programs ? pr.programs.values() : []) {
        if (!own.has(q.id)) own.set(q.id, new Set());
        let path = o.name || o.type;
        for (let a = o.parent, k = 0; a && k < 3; a = a.parent, k++) path = (a.name || a.type) + '/' + path;
        own.get(q.id).add(`${m.name || m.type} @ ${path}`);
      }
    }
  });
  const byId = new Map(R.info.programs.map((q) => [q.id, q]));
  const out = [];
  let prevId = 0;
  for (const [t, dt, wp, maxId, made] of window.__frames) {
    if (t > garage && (dt >= MIN || made.includes('SYNC'))) {
      const ids = [];
      for (let id = prevId + 1; id <= maxId; id++) ids.push(id);
      out.push({ t, dt, wp, made: made.length, sync: made.filter((m) => m === 'SYNC').length, stacks: [], progs: ids.map((id, k) => `${made[k] ?? '?'} ${id} ${byId.get(id)?.name ?? '(gone)'} :: ${[...(own.get(id) ?? [])].slice(0, 3).join(' | ')}`) });
    }
    prevId = Math.max(prevId, maxId);
  }
  return out;
}, MIN);
for (const f of r) {
  console.log(`t=${f.t} dt=${f.dt} world=${f.wp} links=${f.made} sync=${f.sync}`);
  for (const s of f.progs) console.log('   ', s);
  for (const s of f.stacks) console.log('    @', s);
}
await b.close();
