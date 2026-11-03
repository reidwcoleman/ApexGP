import { buildDSL, type TrackData } from './track.ts';

/**
 * The campaign. Every layout is written in the turtle DSL (track.ts) and timed by the autopilot
 * (tools/tsbot.mjs prints the author times the medals come from).
 */
/** author = the autopilot's time less 2% (tools/tsbot.mjs); the other medals scale from it */
interface Spec { id: string; name: string; theme: number; dsl: string; author: number }

export const THEMES = ['Mesa', 'Pinewood', 'Lagoon', 'Dusk'] as const;

const SPECS: Spec[] = [
  { id: 'ts01', name: 'First Gear', theme: 0, author: 7540, dsl: 'S3 R2 S2 C S2 L2 S3 F' },
  { id: 'ts02', name: 'Switchback', theme: 1, author: 9190, dsl: 'S2 R1 L1 S2 C R2 S3 R2 S B S2 F' },
  { id: 'ts03', name: 'Hilltop', theme: 0, author: 12140, dsl: 'S2 U S2 U2 S C R2 S3 D2 S2 D S4 L3 S2 B S F' },
  { id: 'ts04', name: 'Long Jump', theme: 2, author: 11310, dsl: 'S2 B S2 J G3 S8 C S3 L3 S3 J G2 S6 F' },
  { id: 'ts05', name: 'Loopback', theme: 3, author: 13530, dsl: 'S2 B S O S3 C R2 S2 R2 S B OR S3 F' },
  { id: 'ts06', name: 'Canyon Run', theme: 0, author: 20070, dsl: 'S3 L3 S2 R1 S R1 L2 S2 C U2 S3 J G2 S7 R3 S C D2 S3 L1 R1 S2 B S2 F' },
  { id: 'ts07', name: 'Overpass', theme: 1, author: 16750, dsl: 'S2 U U2 S2 C R2 S R2 B S7 R2 S DD D S2 R3 C S3 L2 S2 F' },
  { id: 'ts08', name: 'Island Hop', theme: 2, author: 20030, dsl: 'S B S J G3 S7 C R2 S2 B S J G3 S7 R2 S3 J G2 S6 C L3 S2 B S J G3 S8 F' },
  { id: 'ts09', name: 'Night Shift', theme: 3, author: 20560, dsl: 'S2 R1 R1 L1 L1 S2 C B S O S2 R3 S C L1 S R1 S2 B S OR S C R2 S2 F' },
  { id: 'ts10', name: 'Grand Tour', theme: 1, author: 27740, dsl: 'S3 B S4 R3 S2 U2 S C L2 S3 J G2 S7 R2 S3 C B S2 O S2 R2 S2 D2 S3 C R1 L1 S2 B S3 L3 S3 F' },
];

export function builtinTracks(): TrackData[] {
  return SPECS.map((s) => {
    const { pieces, route } = buildDSL(s.dsl);
    const a = s.author;
    return {
      id: s.id,
      name: s.name,
      author: 'Tracksmith',
      theme: s.theme,
      pieces,
      route,
      medals: a ? [a, Math.round(a * 1.05 / 10) * 10, Math.round(a * 1.18 / 10) * 10, Math.round(a * 1.4 / 10) * 10] : undefined,
    };
  });
}

export const SPEC_LIST = SPECS;
