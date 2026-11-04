// Tracksmith: writes what Blender needs to model the track kit and render the cards: every piece's
// centre line (the same frames the collision mesh is swept along), the built-in tracks and the themes.
//   node --experimental-transform-types --no-warnings tools/tsexport.mjs
import fs from 'node:fs';
import { PIECES, frames, ROAD_W, SLAB, T, H, ROAD_Y } from '../src/tracksmith/pieces.ts';
import { builtinTracks } from '../src/tracksmith/builtin.ts';
import { THEMES } from '../src/tracksmith/theme.ts';

const pieces = PIECES.map((d) => ({
  id: d.id,
  feature: d.feature,
  width: d.width ?? ROAD_W,
  box: d.box ?? null,
  frames: d.path ? frames(d) : null,
}));
const tracks = builtinTracks().map((t) => ({ id: t.id, name: t.name, theme: t.theme, pieces: t.pieces.map((p) => ({ id: PIECES[p.t].id, x: p.x, z: p.z, l: p.l, r: p.r })) }));
fs.writeFileSync('blender/tracksmith/data.json', JSON.stringify({ T, H, ROAD_Y, SLAB, pieces, tracks, themes: THEMES }));
console.log('pieces', pieces.length, 'tracks', tracks.length);
