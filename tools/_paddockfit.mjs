// The paddock's levelled reach against what's built in it, per circuit: npx tsx tools/_paddockfit.mjs
import { Track } from '../src/world/Track.ts';
import { ALL_CIRCUITS } from '../src/world/Circuits.ts';
for (const c of ALL_CIRCUITS) {
  const t = new Track(c);
  console.log(c.id.padEnd(12), 'paddock', t.pit.paddock, 'side', t.pit.side, 'building', JSON.stringify(t.pit.building ?? null));
}
