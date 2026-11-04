import { buildDSL, type TrackData } from './track.ts';

/**
 * The campaign. Every layout is written in the turtle DSL (track.ts) and timed by the autopilot
 * (tools/tsbot.mjs prints the author times the medals come from).
 */
/** author = the autopilot's time less 2% (tools/tsbot.mjs); the other medals scale from it */
interface Spec { id: string; name: string; theme: number; dsl: string; author: number }

export const THEMES = ['Mesa', 'Pinewood', 'Lagoon', 'Dusk'] as const;

const SPECS: Spec[] = [
  { id: 'ts01', name: 'First Gear', theme: 0, author: 7070, dsl: 'S3 R2 S2 C S2 L2 S3 F' },
  { id: 'ts02', name: 'Switchback', theme: 1, author: 8780, dsl: 'S2 R1 L1 S2 C R2 S3 R2 S B S2 F' },
  { id: 'ts11', name: 'Rollercoast', theme: 2, author: 9610, dsl: 'S2 W U2 S KR2 S W C S KL2 B S2 W S D2 S2 F' },
  { id: 'ts03', name: 'Hilltop', theme: 0, author: 10920, dsl: 'S2 U S2 U2 S C R2 S3 D2 S2 D S4 L3 S2 B S F' },
  { id: 'ts04', name: 'Long Jump', theme: 2, author: 10930, dsl: 'S2 B S2 J G3 S10 C S3 L3 S3 J G2 S8 F' },
  { id: 'ts12', name: 'Sidewinder', theme: 1, author: 17410, dsl: 'S2 U2 S4 KR3 S3 KL3 S3 C S2 KR2 S4 KL2 S3 B S3 KL3 S3 D2 S3 F' },
  { id: 'ts05', name: 'Loopback', theme: 3, author: 12990, dsl: 'S2 B S O S4 C R2 S2 R2 S B OR S4 F' },
  { id: 'ts13', name: 'Big Air', theme: 0, author: 17290, dsl: 'S3 B S JJ G6 S15 C S2 L2 S3 B S JJ G6 S15 S2 R2 S2 F' },
  { id: 'ts06', name: 'Canyon Run', theme: 0, author: 19000, dsl: 'S3 L3 S2 R1 S R1 L2 S2 C U2 S3 J G2 S9 R3 S C D2 S3 L1 R1 S2 B S2 F' },
  { id: 'ts14', name: 'Paper Lanterns', theme: 3, author: 22960, dsl: 'S W U2 S3 KR2 S2 O S5 C KL3 S2 W S2 KR2 S3 D2 S2 JJ G6 S15 C S L2 S2 F' },
  { id: 'ts07', name: 'Overpass', theme: 1, author: 15880, dsl: 'S2 U U2 S2 C R2 S R2 B S7 R2 S DD S4 R3 C S3 L2 S2 F' },
  { id: 'ts08', name: 'Island Hop', theme: 2, author: 20930, dsl: 'S B S J G3 S11 C R2 S2 B S J G3 S11 R2 S3 J G2 S9 C L3 S2 B S J G3 S10 F' },
  { id: 'ts15', name: 'Tailwind', theme: 2, author: 22910, dsl: 'S2 U2 S3 KR3 S2 W S5 KL3 S2 C S2 D2 S2 J G3 S13 R2 S3 U2 S3 KL2 S3 D2 S3 C B S2 W S3 F' },
  { id: 'ts09', name: 'Night Shift', theme: 3, author: 19980, dsl: 'S2 R1 R1 L1 L1 S2 C B S O S3 R3 S C L1 S R1 S2 B S OR S2 C R2 S2 F' },
  { id: 'ts16', name: 'Foundry', theme: 3, author: 24540, dsl: 'S2 UU S4 KR2 S3 C D S3 W S2 KL3 S3 D S2 JJ G6 S15 C S R3 B S O S5 L2 S2 B S3 F' },
  { id: 'ts10', name: 'Grand Tour', theme: 1, author: 26240, dsl: 'S3 B S4 R3 S2 U2 S C L2 S3 J G2 S9 R2 S3 C B S2 O S3 R2 S2 D2 S3 C R1 L1 S2 B S3 L3 S3 F' },
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
