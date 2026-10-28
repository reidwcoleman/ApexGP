// Headless bot-vs-bot matches: goals, shots, saves, touches per minute (checks the bots and the rules).
//   node --experimental-transform-types --no-warnings tools/boostsim.mjs [size=2] [skill=0.6] [minutes=2]
import { World, TICK } from '../src/boost/sim/world.ts';
import { Bot } from '../src/boost/sim/bot.ts';
import { loadRocketSim } from '../src/boost/sim/rocketsim.ts';
await loadRocketSim();
const size = Number(process.argv[2] ?? 2), skill = Number(process.argv[3] ?? 0.6), minutes = Number(process.argv[4] ?? 2);
const w = new World();
for (const team of [0, 1]) for (let k = 0; k < size; k++) w.addCar({ name: `${team ? 'O' : 'B'}${k}`, team, bot: true, skill, color: 0, owner: 'bot' });
const bots = w.cars.map((_, i) => new Bot(i, skill));
w.start({ minutes });
const t0 = Date.now();
let ticks = 0, goals = [], air = 0, stuck = 0, crowd = 0, gapSum = 0, gapN = 0;
while (w.phase !== 'end' && ticks < 120 * 60 * (minutes + 3)) {
  w.step(bots.map((b) => b.step(w)));
  for (const e of w.events) if (e.t === 'goal') goals.push(`${(ticks / 120).toFixed(0)}s ${e.team ? 'O' : 'B'} by ${e.scorer >= 0 ? w.players[e.scorer].name : 'own'}`);
  w.events = [];
  for (const c of w.cars) { if (!c.onGround) air++; if (c.rot.u.z < -0.5 && c.pos.z < 80) stuck++; }
  // clumping: teammates within 1000 of the ball at once, and each car's distance to its nearest teammate
  if (w.phase === 'play' && size > 1) {
    for (const team of [0, 1]) {
      const mine = w.cars.filter((_, i) => w.players[i].team === team);
      if (mine.filter((c) => Math.hypot(c.pos.x - w.ball.pos.x, c.pos.y - w.ball.pos.y) < 1000).length >= 2) crowd++;
      for (const c of mine) { gapSum += Math.min(...mine.filter((o) => o !== c).map((o) => Math.hypot(o.pos.x - c.pos.x, o.pos.y - c.pos.y))); gapN++; }
    }
  }
  ticks++;
}
const s = w.stats;
console.log(`${size}v${size} skill ${skill}: ${w.score.join('-')} in ${(ticks / 120).toFixed(0)} s sim (${Date.now() - t0} ms real)${w.overtime ? ' OT' : ''}`);
console.log('goals:', goals.join(' | '));
console.log('touches', s.map((x) => x.touches).join(','), 'shots', s.map((x) => x.shots).join(','), 'saves', s.map((x) => x.saves).join(','), 'demos', s.map((x) => x.demos).join(','));
if (size > 1) console.log(`clumping: 2+ teammates near the ball ${(crowd / ticks / 2 * 100).toFixed(0)}% of the time, mean gap to nearest teammate ${(gapSum / Math.max(1, gapN)).toFixed(0)} uu`);
console.log(`air ${(air / ticks / w.cars.length * 100).toFixed(0)}%  upside-down-on-floor ${(stuck / ticks / w.cars.length * 100).toFixed(1)}%`);
