// Flies the Christmas Eve run with no player, a clumsy player and a sharp one, to check the star lines.
//   node --experimental-transform-types --no-warnings tools/pineeve.mjs
import { EveRun, EVE_U } from '../src/pine/eve.ts';
function fly(seed, year, sold, lag, noise) {
  const r = new EveRun(seed, year, sold), dt = 1 / 60; let n = 0, tgtU = 0, tgtA = 48, look = 0;
  while (r.phase === 'run' && n++ < 20000) {
    let ix = 0, iy = 0, toss = false;
    if (noise >= 0) {
      look -= dt;
      if (look <= 0) { look = lag;
        const near = r.objs.find((o) => !o.st && o.s > r.s + 4 && o.k !== 'cloud'), wall = r.objs.filter((o) => o.k === 'cloud' && o.s > r.s && o.s < r.s + 150);
        if (near) { const home = near.k === 'home'; const e = (Math.random() - 0.5) * noise; tgtU = near.u + e; tgtA = home ? 44 : near.h + e * 0.6; }
        for (const c of wall) if (Math.abs(c.u - tgtU) < 17 && Math.abs(c.h - tgtA) < 17) { tgtA = 49; }
      }
      const du = tgtU - r.u, da = tgtA - r.a; ix = Math.abs(du) > 2 ? Math.sign(du) : du / 2; iy = Math.abs(da) > 2 ? -Math.sign(da) : -da / 2;
      const L = r.landing(), h = r.objs.find((o) => o.k === 'home' && !o.st && o.s > L.s - 6);
      if (h && h.s - L.s < 3 + Math.random() * noise * 0.4 && Math.abs(h.u - r.u) < 16) toss = true;
    }
    r.step(dt, ix, iy, toss); r.fx.length = 0;
  }
  return r;
}
const rows = [['none', 0, -1], ['clumsy', 0.35, 26], ['average', 0.22, 14], ['sharp', 0.12, 5]];
for (const [year, sold] of [[1, 30], [4, 500], [15, 4000]]) {
  console.log(`year ${year}, sold ${sold}`);
  for (const [name, lag, noise] of rows) {
    const R = []; for (let k = 1; k <= 12; k++) R.push(fly(k * 13, year, sold, lag, noise));
    const avg = (f) => R.reduce((a, r) => a + f(r), 0) / R.length, r0 = R[0];
    console.log(`  ${name.padEnd(8)} pct ${(avg((r) => r.pct) * 100).toFixed(0).padStart(3)}%  stars ${avg((r) => r.stars).toFixed(1)}  homes ${avg((r) => r.delivered).toFixed(1)}/${r0.homes}  rings ${avg((r) => r.ringsHit).toFixed(0)}/${r0.rings}  bumps ${avg((r) => r.bumps).toFixed(1)}  secs ${(r0.end / r0.speed).toFixed(0)}`);
  }
}
