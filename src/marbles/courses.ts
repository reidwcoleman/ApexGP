import * as THREE from 'three';
import { CourseBuilder, Path } from './builder.ts';
import { Kin } from './physics.ts';
import { timber } from './course-timber.ts';
import { paintmill } from './course-paintmill.ts';
import { jumpclub } from './course-jumpclub.ts';
import { ridge } from './course-ridge.ts';
import { tiptop } from './course-tiptop.ts';
import { summit } from './course-summit.ts';

export { makeCrown } from './course-kit.ts';

/**
 * The show's rounds. Races are one long downhill chute built from set pieces (each round in its
 * own course-*.ts); the survival rounds are a painted plate the field has to stay on. The final is
 * a race where only the first across the line counts.
 */

export type RoundKind = 'race' | 'survival' | 'final';

export interface Course {
  id: string;
  name: string;
  kind: RoundKind;
  blurb: string;
  b: CourseBuilder;
  path: Path | null;
  finishS: number;
  /** jumps the AI has to make: [takeoff s, landing s] (full-width gaps only) */
  gaps: [number, number][];
  /** respawn points (s), in order; none in a jump, on a beam or among the hammers */
  checkpoints: number[];
  /** below this a bean is out (a fall) */
  killY: number;
  lakeY: number;
  state: { go: number };
  grid(n: number): { pos: THREE.Vector3; yaw: number }[];
  /**
   * The survival plate. `radius` can shrink during the round (a getter: Jump Club's rings crumble
   * away); bars[0] is the low bar to hop, bars[1] (if there is one) the high one never to hop into.
   */
  plate?: { center: THREE.Vector3; radius: number; bars: { angle: (t: number) => number; height: number; kin: Kin; on: (t: number) => boolean }[] };
  /** the crown on its pedestal (the final) */
  crown?: THREE.Object3D;
  /** for the flyover */
  intro: THREE.Vector3[];
}

export type RoundId = 'timber' | 'paintmill' | 'jumpclub' | 'ridge' | 'tiptop' | 'summit';
/**
 * The running order. `keep`: the share of the field that goes through (a race: the first that many
 * across the line; survival: the last that many standing). The final keeps one.
 */
export const SHOW: { id: RoundId; name: string; kind: RoundKind; blurb: string; keep: number }[] = [
  { id: 'timber', name: 'Timber Tumble', kind: 'race', blurb: 'Pegs, rolling logs, the big jump, a shortcut beam and the great spiral', keep: 0.8 },
  { id: 'paintmill', name: 'Paint Mill', kind: 'race', blurb: 'Hammers, flippers, a conveyor running back at you, the spinners and the axes', keep: 0.75 },
  { id: 'jumpclub', name: 'Bar Hop', kind: 'survival', blurb: 'Jump the low bar. Never jump into the high one. Mind the edge: it crumbles.', keep: 0.65 },
  { id: 'ridge', name: 'Rickety Ridge', kind: 'race', blurb: 'Seesaws, boulders, sliding bridges, wrecking balls, a trampoline pit: nothing holds still', keep: 0.75 },
  { id: 'tiptop', name: 'Tilt-a-Dish', kind: 'survival', blurb: 'The dish tips more and more. Hop the bar, dodge the bumpers, stay on.', keep: 0.65 },
  { id: 'summit', name: 'Crown Summit', kind: 'final', blurb: 'Everything at once. First across the line takes the crown', keep: 0 },
];

export function buildRound(id: RoundId): Course {
  const info = SHOW.find((x) => x.id === id)!;
  switch (id) {
    case 'timber':
      return timber(info);
    case 'paintmill':
      return paintmill(info);
    case 'jumpclub':
      return jumpclub(info);
    case 'ridge':
      return ridge(info);
    case 'tiptop':
      return tiptop(info);
    default:
      return summit(info);
  }
}

