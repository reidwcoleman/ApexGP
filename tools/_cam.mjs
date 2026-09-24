// usage: node tools/_cam.mjs s lat h aheadS aheadLat aheadH
import { Track } from '../src/world/Track.ts';
import { MONZA } from '../src/world/Circuits.ts';
const t = new Track(MONZA);
const [s, lat, h, s2, lat2, h2] = process.argv.slice(2).map(Number);
const a = t.point(s, lat, h), b = t.point(s2, lat2, h2);
console.log(`cam=${a.x.toFixed(1)},${a.y.toFixed(1)},${a.z.toFixed(1)}&look=${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)}`);
