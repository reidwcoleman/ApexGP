// Bluebird Peak economy check: a greedy bot plays N real minutes (cheapest affordable buy, claims goals).
//   node --experimental-transform-types --no-warnings tools/bbbalance.mjs [minutes]
import { Mountain } from '../src/bluebird/mountain.ts';
import { Sim } from '../src/bluebird/sim.ts';
import { ITEMS, EVENTS } from '../src/bluebird/data.ts';

const mins = +(process.argv[2] ?? 60);
const m = new Mountain();
const sim = new Sim(m, null);
const seen = new Set();
const clock = (t) => `${String(Math.floor(t / 60)).padStart(3)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const log = (t, s) => console.log(`${clock(t)}  day ${sim.day}  ${s}`);
for (let t = 0; t < mins * 60; t++) {
  sim.update(1);
  for (const e of sim.events.splice(0)) {
    if (e.k === 'levelup') log(t, `resort level ${e.lv} (+$${e.reward})`);
    if (e.k === 'event' && e.phase === 'done') log(t, `event done +$${e.payout}`);
    if (e.k === 'dayend' && sim.day % 3 === 0) {
      const p = sim.plan;
      const groom = Object.entries(sim.runGroom).filter(([k]) => sim.runBuilt(k)).map(([k, v]) => k + ':' + v.toFixed(2)).join(' ');
      log(t, `day end: ${e.visitors} guests, $${Math.round(e.income)}, ${e.stars.toFixed(2)} stars, price $${sim.s.price}, limit ${p.limit} (dem ${Math.round(p.demand)} park ${Math.round(p.parking)} lifts ${Math.round(p.lifts)}) groom ${groom}`);
    }
  }
  for (const g of sim.activeGoals()) if (g.p >= 1) { const r = sim.claim(g.g.id); log(t, `goal "${g.g.text}" +$${r}`); }
  // hosts the best event it can afford with a third of its cash
  if (!sim.s.event) for (const e of EVENTS.filter((e) => !sim.eventLock(e)).sort((a, b) => sim.eventPrize(b) - sim.eventPrize(a))) { if (sim.eventCost(e) < sim.s.cash / 3) { sim.hostEvent(e.id); log(t, `EVENT ${e.name} for $${sim.eventCost(e)} (prize ~$${sim.eventPrize(e)})`); break; } }
  for (let k = 0; k < 20; k++) {
    const opts = ITEMS.filter((it) => !sim.lockReason(it.id) && sim.lv(it.id) < it.max).map((it) => ({ it, p: sim.quote(it.id, 1).total })).sort((a, b) => a.p - b.p);
    const o = opts[0];
    if (!o || o.p > sim.s.cash) break;
    sim.buy(o.it.id, 1);
    if (sim.lv(o.it.id) === 1 && !seen.has(o.it.id)) { seen.add(o.it.id); log(t, `BUILT ${o.it.name} for $${o.p}`); }
  }
}
const items = Object.fromEntries(Object.entries(sim.s.lv).filter(([, v]) => v > 0));
if (sim.legendReady) console.log('legend ready: +' + sim.legendGain);
console.log('final', { cash: Math.round(sim.s.cash), lv: sim.s.resortLv, stars: sim.s.stars.toFixed(2), best: sim.s.best, perMin: Math.round(sim.perMinute), items });
