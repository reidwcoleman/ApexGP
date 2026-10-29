// Bakes src/boost/sim/rs/arena.snap: RocketSim's memory with the arena already built and stepped once,
// which the page copies in instead of spending seconds building it. Run it after rebuilding rs.wasm or
// arena.bin (tools/boost_rsmesh.mjs); the node tools refuse a stale snapshot.
//   node --experimental-transform-types --no-warnings tools/boost_rssnap.mjs
import { writeFileSync } from 'node:fs';
import { bakeRocketSim } from '../src/boost/sim/rocketsim.ts';
const t = performance.now();
const snap = await bakeRocketSim();
const out = new URL('../src/boost/sim/rs/arena.snap', import.meta.url);
writeFileSync(out, snap);
console.log(`arena.snap: ${(snap.length / 1024).toFixed(0)} KB in ${Math.round(performance.now() - t)} ms`);
