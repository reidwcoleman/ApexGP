// Pine & Dandy balance bot: plays the sim in Node with a scripted farmer and prints a line per year.
//   node --experimental-transform-types --no-warnings tools/pinebot.mjs [years] [seed] [lazy|good]
import { Sim, MW, PS, PW, PH, TOOL_SAW, TOOL_PLANT, TOOL_SHEAR, F_DEAD, T_GRASS } from '../src/pine/sim.ts';
import { VEHICLES, CREW, SPECIES, BUILDINGS, TIERS } from '../src/pine/data.ts';
const years = +(process.argv[2] ?? 25), seed = +(process.argv[3] ?? 12345), style = process.argv[4] ?? 'good';
const g = new Sim(); g.newGame(seed); let lastRev = 6000;
const dt = 1 / 20;
function field() {
  // the bot walks the nearest cuttable tree, like a player mowing rows
  const s = g.s, p = s.p; let bi = -1, bd = 1e9;
  for (let r = 0; r < 80 && bi < 0; r += 4) {}
  for (let i = 0; i < g.N; i += 1) { if (g.sp[i] && !(g.flag[i] & F_DEAD) && g.h[i] >= 4.5 && g.ownedTile(i)) { const d = Math.hypot(i % MW - p.x, ((i / MW) | 0) - p.y); if (d < bd) { bd = d; bi = i; } } }
  return bi;
}
let target = -1, retarget = 0;
function plan() {
  const s = g.s, money = s.money, m = s.month;
  // buy vehicles when flush, then crews, then land, then blocks cover the land
  const nv = s.veh + 1; if (nv < VEHICLES.length && g.tier >= VEHICLES[nv].tier && money > VEHICLES[nv].price * 1.6) g.buyVehicle(nv);
  if (m === 1) {
    if (s.debt > 0 && s.money > s.debt * 1.5) g.repay(s.debt);
    for (let k = 0; k < 40; k++) {
      let best = null, bp = 1e18;
      for (let py = 0; py < PH; py++) for (let px = 0; px < PW; px++) if (g.canBuyParcel(px, py) && g.parcelClear(px, py) > 0.7) { const c = g.landPrice(px, py) / g.parcelFert(px, py); if (c < bp) { bp = c; best = [px, py]; } }
      if (!best) break; const c = g.landPrice(best[0], best[1]); if (s.money * 0.4 < c + 900 || s.money < lastRev * 0.35) break;
      if (!g.buyParcel(best[0], best[1])) break;
      const b = g.addBlock(best[0] * PS, best[1] * PS, PS, PS); b.sp = bestSpecies();
    }
    if (!s.blocks.length) { const b = g.addBlock(128, 64, 16, 16); b.sp = 1; const b2 = g.addBlock(112, 64, 14, 2); }
    const want = Math.ceil(g.parcels * 0.55), rank = g.tier >= 3 ? 2 : g.tier >= 2 ? 1 : 0;
    const wageBill = () => s.crew.reduce((a, c) => a + g.wage(c), 0) * 12;
    while (s.crew.length < want && s.money > CREW[rank].hire * 3 + 2000 && wageBill() + CREW[rank].wage * 12 < lastRev * 0.3) g.hire(rank);
    for (const c of s.crew) if (g.tier >= CREW[c.rank + 1]?.tier && s.money > (CREW[c.rank + 1]?.hire ?? 1e12) * 5 && wageBill() < lastRev * 0.25) g.promote(c.id);
    while (g.tier >= 1 && s.money > 4000 && g.bcount('lot') * 22 < TIERS[g.tier].demand * 1.6) { if (!tryBuild('lot')) break; }
    if (s.money > 9000 && g.capacity < g.standing / 3 && g.tier >= 1) tryBuild('barn');
    if (s.money > 2000 && g.bcount('cocoa') < 1) tryBuild('cocoa');
    if (s.money > 3000 && g.bcount('depot') < g.parcels / 5) depotNearEdge();
    if (s.money > 12000 && g.bcount('santa') < 1 && g.tier >= 2) tryBuild('santa');
    if (s.money > 60000 && g.bcount('sleigh') < 1 && g.tier >= 3) tryBuild('sleigh');
    if (s.money > 15000 && g.bcount('greenhouse') < 1 && g.tier >= 1) tryBuild('greenhouse');
    for (let i = 0; i < SPECIES.length; i++) if (!s.unlocked[i] && g.tier >= SPECIES[i].tier && s.money > SPECIES[i].unlock * 2) g.unlockSpecies(i);
  }
}
function bestSpecies() { const l = []; g.s.unlocked.forEach((u, i) => { if (u && i < 5) l.push(i); }); return l[(Math.random() * l.length) | 0]; }
function depotNearEdge() { const b = s0(); for (let k = 0; k < 400; k++) { const x = 4 + (Math.random() * 248 | 0), y = 4 + (Math.random() * 150 | 0); if (g.ownedAt(x, y) && Math.hypot(x - 122, y - 72) > 18 && g.canBuild('depot', x, y)) return g.build('depot', x, y); } }
function s0() { return g.s; }
function tryBuild(k) { const d = BUILDINGS[k]; for (let y = 2; y < 158; y += 1) for (let x = 2; x < 250; x += 1) if (g.ownedAt(x, y) && g.canBuild(k, x, y)) return g.build(k, x, y); }
let last = 0, lastX = 0, lastY = 0, stuck = 0, side = 0;
while (g.s.year <= years) {
  const s = g.s;
  if (s.phase === 'eve') {
    const r = g.makeReport(), y = r.y;
    console.log(`Y${String(r.year).padStart(2)} sold ${String(y.sold).padStart(6)} rev ${String(Math.round(y.revenue)).padStart(9)} retail ${String(y.retailN).padStart(5)} orders ${String(y.ordersN).padStart(3)}/${String(y.ordersN + y.missed).padStart(3)} whole ${String(y.wholesaleN).padStart(5)} lost ${String(y.lostSales).padStart(5)} streak ${String(y.bestStreak).padStart(2)} | cash ${String(Math.round(s.money)).padStart(10)} stand ${String(g.standing).padStart(6)} parcels ${String(g.parcels).padStart(3)} crew ${String(s.crew.length).padStart(3)} veh ${s.veh} tier ${g.tier} rank ${r.rank} goal ${s.goal}`);
    lastRev = (lastRev + y.revenue) / 2; const c = g.perkChoices(); g.startNewYear(c[0].id); s.p.cutAt = 6; continue;
  }
  // scripted farmer: pests come first, like they do for a person
  let ix = 0, iy = 0, act = false; const p = s.p;
  if (g.infected.length) {
    s.p.tool = 3; let bd = 1e9, bi = -1; for (const i of g.infected) { const d = Math.hypot(i % MW - p.x, ((i / MW) | 0) - p.y); if (d < bd) { bd = d; bi = i; } }
    if (bi >= 0) { ix = bi % MW + 0.5 - p.x; iy = ((bi / MW) | 0) + 0.5 - p.y; act = true; }
  } else if (g.harvestOpen()) {
    s.p.tool = TOOL_SAW;
    if (p.hop.n >= g.hopCap() * 0.95 || (target < 0 && p.hop.n > 0)) { const b = g.nearestUnload(p.x, p.y), d = BUILDINGS[b.k]; ix = b.x + d.w / 2 - p.x; iy = b.y + d.h + 1 - p.y; act = false; }
    else { if (retarget-- <= 0 || target < 0 || !g.sp[target]) { target = field(); retarget = 20; } if (target >= 0) { ix = target % MW + 0.5 - p.x; iy = ((target / MW) | 0) + 0.5 - p.y; act = true; } }
  } else if (s.month >= 2 && s.month <= 4) {
    s.p.tool = TOOL_PLANT; s.p.sel = bestSpecies();
    if (retarget-- <= 0 || target < 0 || g.sp[target]) { retarget = 30; let bd = 1e9; target = -1; for (let i = 0; i < g.N; i++) if (!g.sp[i] && g.terr[i] === T_GRASS && !g.bld[i] && g.ownedTile(i)) { const d = Math.hypot(i % MW - p.x, ((i / MW) | 0) - p.y); if (d < bd) { bd = d; target = i; } } }
    if (target >= 0) { ix = target % MW + 0.5 - p.x; iy = ((target / MW) | 0) + 0.5 - p.y; act = true; }
  } else if (s.month >= 5 && s.month <= 8 && style === 'good') { s.p.tool = TOOL_SHEAR; }
  const L = Math.hypot(ix, iy); if (L > 0) { ix /= L; iy /= L; }
  // a person steers round the barn; the bot sidesteps when it stops making progress
  if (L > 1 && Math.hypot(p.x - lastX, p.y - lastY) < 0.02) stuck += dt; else stuck = Math.max(0, stuck - dt);
  lastX = p.x; lastY = p.y;
  if (stuck > 0.3) side = 0.9;
  if (stuck > 2) { p.x += ix * 12; p.y += iy * 12; stuck = 0; }
  if (side > 0) { side -= dt; const t2 = ix; ix = -iy; iy = t2; }
  g.step(dt, ix, iy, act);
  g.fx.length = 0;
  if (s.month !== last) { last = s.month; if (s.month === 1) plan(); }
}
