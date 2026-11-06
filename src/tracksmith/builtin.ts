import { buildDSL, type TrackData } from './track.ts';

/**
 * The campaign. Every layout is written in the turtle DSL (track.ts) and timed by the autopilot
 * (tools/tsbot.mjs prints the author times the medals come from).
 */
/** author = the autopilot's time less 2% (tools/tsbot.mjs); the other medals scale from it */
interface Spec { id: string; name: string; theme: number; dsl: string; author: number; base?: number }

export const THEMES = ['Mesa', 'Pinewood', 'Lagoon', 'Dusk'] as const;

const SPECS: Spec[] = [
  { id: 'ts01', name: 'First Gear', theme: 0, author: 7070, dsl: 'S3 R2 S2 C S2 L2 S3 F S3' },
  { id: 'ts02', name: 'Switchback', theme: 1, author: 8780, dsl: 'S2 R1 L1 S2 C R2 S3 R2 S B S2 F S3' },
  { id: 'ts11', name: 'Rollercoast', theme: 2, author: 9520, dsl: 'S2 W U2 S KR2 S W C S KL2 B S2 W S D2 S2 F S3' },
  { id: 'ts04', name: 'Long Jump', theme: 2, author: 10930, dsl: 'S2 B S2 J G3 S10 C S3 L3 S3 J G2 S8 F S3' },
  { id: 'ts05', name: 'Loopback', theme: 3, author: 12930, dsl: 'S2 B S O S4 C R2 S2 R2 S B OR S4 F S3' },
  { id: 'ts13', name: 'Big Air', theme: 0, author: 17290, dsl: 'S3 B S JJ G6 S15 C S2 L2 S3 B S JJ G6 S15 S2 R2 S2 F S3' },
  { id: 'ts21', name: 'Sky Ribbon', theme: 2, base: 4, author: 19580, dsl: 'S4 KL5 S2 KR5 S3 C Q S4 XR3 S6 SL S4 XL3 S3 B S4 C KR5 S2 KL5 S4 F S3' },
  { id: 'ts22', name: 'Hairpin Hollow', theme: 1, base: 3, author: 22190, dsl: 'S3 R1 L1 S2 L2 R2 S2 C R1 S R1 S2 L1 S L1 S3 B S2 C L2 S R2 S2 L1 R1 S3 R2 S2 F S3' },
  { id: 'ts23', name: 'Slalom Ridge', theme: 0, base: 6, author: 25100, dsl: 'S4 B S2 XL3 S2 XR3 S2 XR3 S2 XL3 S3 C Q S3 XL5 S2 XR5 S3 SL S3 C KR3 S2 KL3 S2 KL3 S2 KR3 S4 F S3' },
  { id: 'ts24', name: 'Corkscrew Bay', theme: 2, base: 3, author: 23720, dsl: 'S6 CL S5 KR3 S4 C Q S3 KL3 S6 CR S5 C XR5 S4 J G3 S11 KL5 S4 F S3' },
  { id: 'ts25', name: 'Knot Garden', theme: 1, base: 4, author: 24170, dsl: 'S3 KL3 S2 KL3 S2 KL3 S9 UP S6 C XR3 S3 XR3 UU S7 XR3 S14 DN S6 C B S3 F S3' },
  { id: 'ts26', name: 'Foundry Line', theme: 3, base: 4, author: 25420, dsl: 'S3 T5 S2 KR3 S4 T3 SL T3 C S3 XL3 S6 CR S4 KR5 T6 C S2 JJ G6 S15 KL3 S3 F S3' },
  { id: 'ts27', name: 'Stepping Stones', theme: 2, base: 12, author: 24280, dsl: 'S3 B S3 J G3 v2 S11 C S2 KR3 S3 B S2 J G3 v2 S11 S2 KL3 S3 C B S3 J G3 v2 S11 KR5 S3 B S2 JJ G6 v2 S15 C S3 F S3' },
  { id: 'ts28', name: 'The Spiral', theme: 1, base: 2, author: 27820, dsl: 'S4 HL S8 C KR5 S5 DN S8 XL3 S3 C B S3 HR S6 XR5 S6 DN S8 C S3 F S3' },
  { id: 'ts29', name: 'Double Back', theme: 3, base: 3, author: 26720, dsl: 'S3 B S4 O S4 R3 S3 UP S7 C XL5 S4 SR S3 XR3 S5 CL S5 C KL5 S3 DN S7 B S3 F S3' },
  { id: 'ts30', name: 'Afterburner', theme: 0, base: 5, author: 21700, dsl: 'S6 B2 S6 KL5 S4 B S8 KR5 S3 C S4 Q S8 XL5 S6 B S8 C XR5 S4 Q S8 B2 S8 F S4' },
  { id: 'ts31', name: 'Long Way Down', theme: 3, base: 20, author: 26240, dsl: 'S4 B S3 DN S6 KL5 S3 DN S6 XR5 S3 C DN S5 Q S3 KR3 S4 J G3 S11 C KL5 S3 DHR S6 F S3' },
  { id: 'ts32', name: 'Grand Circuit', theme: 1, base: 4, author: 39930, dsl: 'S4 B S4 KL5 S3 Q S3 XL3 S4 C CL S4 KR5 S2 HR S7 C XR5 S5 DN S7 J G3 S11 KL3 S3 O S4 C DN S6 XL5 S3 B S5 KR3 S3 F S3' },
];

export function builtinTracks(): TrackData[] {
  return SPECS.map((s) => {
    const { pieces, route } = buildDSL(s.dsl, s.base);
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
