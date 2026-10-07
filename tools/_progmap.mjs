// Which materials own which shader programs in a live race (counts programs per material family).
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto(`http://localhost:${process.env.PORT ?? 5218}/?track=monza&demo=race&cam=chase&skip=5`);
await p.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
const r = await p.evaluate(() => {
  const g = window.__game, R = g.gfx.renderer;
  const byProg = new Map();
  g.scene.traverse((o) => {
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) {
      const pr = R.properties.get(m);
      const progs = pr.programs ? [...pr.programs.values()] : pr.currentProgram ? [pr.currentProgram] : [];
      for (const q of progs) {
        const k = q.id;
        if (!byProg.has(k)) byProg.set(k, { id: k, mats: new Set(), types: new Set(), keys: new Set() });
        const e = byProg.get(k);
        e.mats.add(m.name || '(' + m.type + ')');
        e.types.add(m.type);
        e.keys.add(m.customProgramCacheKey ? m.customProgramCacheKey() : '');
      }
    }
  });
  return { total: R.info.programs.length, owned: [...byProg.values()].map((e) => ({ id: e.id, mats: [...e.mats].slice(0, 4).join('|') + (e.mats.size > 4 ? ` +${e.mats.size - 4}` : ''), type: [...e.types].join(','), key: [...e.keys].join(',').slice(0, 40) })) };
});
console.log('total programs', r.total, 'owned by scene materials', r.owned.length);
const fam = {};
for (const e of r.owned) { const k = e.type + ' ' + e.key; fam[k] = (fam[k] ?? 0) + 1; }
console.log(Object.entries(fam).sort((a, b) => b[1] - a[1]).map(([k, v]) => v + '  ' + k).join('\n'));
if (process.env.ALL) console.log(r.owned.map((e) => `${e.id} ${e.type} [${e.key}] ${e.mats}`).join('\n'));
await b.close();
