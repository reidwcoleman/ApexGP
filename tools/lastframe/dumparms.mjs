// The avatar's arms and hands as the game holds them (bind pose, weights, bone positions), for arms.py to build the
// first-person sleeves and gloves from.   node tools/lastframe/dumparms.mjs PORT OUT.json
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
import fs from 'node:fs';
const [port, out] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 640, height: 360 } })).newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(`http://localhost:${port}/lastframe.html?dev=1&nodraw=1`);
await p.waitForFunction(() => window.__lf, null, { timeout: 180000 });
await p.evaluate(() => { const g = __lf.g; g.startSolo({ mode: 'tdm', bots: 0, skill: 0.5, time: 8, limit: 40, seed: 3 }, 'Tester', 0, 'carbine'); });
await p.waitForFunction(() => __lf.g.mySoldier, null, { timeout: 30000 });
const data = await p.evaluate(() => {
  const s = __lf.g.mySoldier, P = s.person, geo = s.geo0;
  const A = (n, k) => { const a = geo.getAttribute(n); return a ? Array.from(a.array).map((v) => +v.toFixed(k)) : null; };
  const bones = P.skeleton.bones.map((bn, i) => {
    const m = P.skeleton.boneInverses[i].clone().invert();
    return { name: bn.name, parent: P.skeleton.bones.indexOf(bn.parent), m: Array.from(m.elements).map((v) => +v.toFixed(6)) };
  });
  return {
    position: A('position', 6), normal: A('normal', 5), uv: A('uv', 5), skinIndex: A('skinIndex', 0), skinWeight: A('skinWeight', 5), part: A('aPart', 0),
    index: geo.index ? Array.from(geo.index.array) : null, bones,
    bind: Array.from(P.body.bindMatrix.elements), marks: s.marks, attrs: Object.keys(geo.attributes),
  };
});
fs.writeFileSync(out, JSON.stringify(data));
const parts = {};
for (const q of data.part) parts[q] = (parts[q] ?? 0) + 1;
console.log('verts', data.position.length / 3, 'tris', data.index ? data.index.length / 3 : data.position.length / 9, 'bones', data.bones.length, 'parts', JSON.stringify(parts), 'attrs', data.attrs.join(','));
console.log('hand bones', data.bones.filter((q) => /L_(Hand|Finger|Forearm|UpperArm|Clavicle)/.test(q.name)).map((q) => q.name + '@' + [q.m[12], q.m[13], q.m[14]].map((v) => v.toFixed(3)).join(',')).join('  '));
await b.close();
