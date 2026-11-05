import * as THREE from 'three';
import { CourseBuilder, Path } from './builder.ts';
import { Kin } from './physics.ts';
import { setFoamTheme, useFoamTheme } from './shaders.ts';
import { ROUND_BIOME, setBiome } from './biome.ts';
import { timber } from './course-timber.ts';
import { paintmill } from './course-paintmill.ts';
import { jumpclub } from './course-jumpclub.ts';
import { ridge } from './course-ridge.ts';
import { tiptop } from './course-tiptop.ts';
import { summit } from './course-summit.ts';
import { crownKeep, type KeepArena } from './course-crown.ts';
import { paintparty, type TeamArena } from './course-paintparty.ts';
import { GEN, genCourse } from './course-gen.ts';
import { crumble, type CrumbleArena } from './course-crumble.ts';
import { storm, type StormArena } from './course-storm.ts';
import { tide, type TideArena } from './course-tide.ts';
import { beltRush, colourCall, hotSpud, type BeltArena, type CallArena, type SpudArena } from './course-modes.ts';
import { bounceHouse, type BounceArena } from './course-bounce.ts';

export { makeCrown } from './course-kit.ts';

/**
 * The show's rounds. Races are one long downhill chute built from set pieces (each round in its
 * own course-*.ts); the survival rounds are a painted plate the field has to stay on. The final is
 * a race where only the first across the line counts.
 */

export type RoundKind = 'race' | 'survival' | 'team' | 'score' | 'final';

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
  /** Cookie Crumble's floors of tiles */
  crumble?: CrumbleArena;
  /** Storm Deck's lightning */
  storm?: StormArena;
  /** High Tide's columns and its sea */
  tide?: TideArena;
  /** the party games (course-modes.ts) */
  call?: CallArena;
  spud?: SpudArena;
  bounce?: BounceArena;
  belt?: BeltArena;
  /** the Crown Keeper final */
  keep?: KeepArena;
  /** Lava Rush: the lava's height and how far along the course it has come, at a time */
  lava?: { y(t: number): number; s(t: number): number };
  /** the team round's painted floor */
  team?: TeamArena;
  /** the crown on its pedestal (the final) */
  crown?: THREE.Object3D;
  /** for the flyover */
  intro: THREE.Vector3[];
}

export type GenId = 'discodash' | 'bigtop' | 'treasuretrail' | 'blockparty' | 'petalpass' | 'ticktock' | 'moonrun' | 'sliprink' | 'lavarush' | 'hopscotch' | 'bonkbay' | 'knockknock' | 'whirligig' | 'bonkalley' | 'wobblewalk' | 'skystairs' | 'jellyjunction' | 'crownpeak' | 'punchline' | 'rumblehill';
export type RoundId = 'timber' | 'paintmill' | 'jumpclub' | 'ridge' | 'tiptop' | 'paintparty' | 'splatring' | 'summit' | 'crumble' | 'meltdown' | 'stormdeck' | 'hightide' | 'colourcall' | 'hotspud' | 'bouncehouse' | 'beltrush' | 'crownkeep' | GenId;
export interface RoundInfo {
  id: RoundId;
  name: string;
  kind: RoundKind;
  blurb: string;
  /** the share of the field that goes through (a race: the first that many across the line;
   * survival: the last that many standing; team: everyone but the losing team). The final keeps one. */
  keep: number;
}
/** every round there is */
export const ROUNDS: Record<RoundId, RoundInfo> = {
  timber: { id: 'timber', name: 'Timber Tumble', kind: 'race', blurb: 'Pegs, rolling logs, the big jump, a shortcut beam and the great spiral', keep: 0.8 },
  paintmill: { id: 'paintmill', name: 'Paint Mill', kind: 'race', blurb: 'Hammers, flippers, a conveyor running back at you, the spinners and the axes', keep: 0.75 },
  ridge: { id: 'ridge', name: 'Rickety Ridge', kind: 'race', blurb: 'Seesaws, boulders, sliding bridges, wrecking balls, a trampoline pit: nothing holds still', keep: 0.75 },
  jumpclub: { id: 'jumpclub', name: 'Bar Hop', kind: 'survival', blurb: 'Jump the low bar. Never jump into the high one. Mind the edge: it crumbles.', keep: 0.65 },
  tiptop: { id: 'tiptop', name: 'Tilt-a-Dish', kind: 'survival', blurb: 'The dish tips more and more. Hop the bar, dodge the bumpers, stay on.', keep: 0.65 },
  crumble: { id: 'crumble', name: 'Cookie Crumble', kind: 'survival', blurb: 'Four floors of cookies. Each one crumbles a moment after you step on it. Keep moving, last ones standing win.', keep: 0.6 },
  meltdown: { id: 'meltdown', name: 'Meltdown', kind: 'survival', blurb: 'An ice floe melting in from the edge, holes opening in it. Hold your spot, push the others in.', keep: 0.6 },
  lavarush: { id: 'lavarush', name: 'Lava Rush', kind: 'race', blurb: 'Climb! The lava rises up the course behind you. Get caught and you are out.', keep: 0.7 },
  paintparty: { id: 'paintparty', name: 'Paint Party', kind: 'team', blurb: 'Run over the tiles to paint them your team colour. Steal theirs. Least floor goes home.', keep: 0.67 },
  splatring: { id: 'splatring', name: 'Splat Ring', kind: 'team', blurb: 'Paint the ring your colour. A long bar sweeps round faster and faster: hop it.', keep: 0.67 },
  summit: { id: 'summit', name: 'Crown Summit', kind: 'final', blurb: 'Everything at once. First across the line takes the crown', keep: 0 },
  // the platform courses (course-gen.ts): open decks in the sky
  hopscotch: { id: 'hopscotch', name: 'Hop Scotch', kind: 'race', blurb: 'Pins, island hops, sweeping bars and rocking planks. Mind the edges.', keep: 0.75 },
  bonkbay: { id: 'bonkbay', name: 'Bonk Bay', kind: 'race', blurb: 'Bumpers everywhere, wrecking balls, a spinning floor and the hammers', keep: 0.75 },
  knockknock: { id: 'knockknock', name: 'Knock Knock', kind: 'race', blurb: 'Pick a door. Some open, some are solid. Then sliders and an uphill belt.', keep: 0.75 },
  whirligig: { id: 'whirligig', name: 'Whirligig', kind: 'race', blurb: 'Everything spins: turnstiles, windmills, sweepers and two spinning floors', keep: 0.75 },
  bonkalley: { id: 'bonkalley', name: 'Bonk Alley', kind: 'race', blurb: 'Hammers, rolling logs, axes, the bounce pit and the wrecking balls', keep: 0.75 },
  wobblewalk: { id: 'wobblewalk', name: 'Wobble Walk', kind: 'race', blurb: 'Seesaws, sliding bridges, rocking planks: nothing under you holds still', keep: 0.75 },
  skystairs: { id: 'skystairs', name: 'Sky Stairs', kind: 'race', blurb: 'Up, up and up: climbs, a belt running back at you, a big jump', keep: 0.75 },
  jellyjunction: { id: 'jellyjunction', name: 'Jelly Junction', kind: 'race', blurb: 'A bit of everything: logs, bars, doors, a spinner, seesaws', keep: 0.75 },
  punchline: { id: 'punchline', name: 'Punch Line', kind: 'race', blurb: 'Fists punch out across open decks, gates swing shut, balls come rolling down at you', keep: 0.75 },
  rumblehill: { id: 'rumblehill', name: 'Rumble Hill', kind: 'race', blurb: 'Two hills of balls rolling down, gates, a wrecking ball and the fists', keep: 0.75 },
  petalpass: { id: 'petalpass', name: 'Petal Pass', kind: 'race', blurb: 'Blossom islands. Big fans blow you sideways in gusts, jelly bounces you over the gaps.', keep: 0.75 },
  ticktock: { id: 'ticktock', name: 'Tick Tock', kind: 'race', blurb: 'Inside the clockwork: pistons slam down on a beat, gears turn, belts run back at you.', keep: 0.75 },
  moonrun: { id: 'moonrun', name: 'Moon Run', kind: 'race', blurb: 'Low gravity all the way: floaty jumps, huge gaps, laser gates. Mind where you land.', keep: 0.75 },
  sliprink: { id: 'sliprink', name: 'Slip Rink', kind: 'race', blurb: 'Every floor is ice. Slide round the corners, dive to go faster, snowballs rolling down.', keep: 0.75 },
  stormdeck: { id: 'stormdeck', name: 'Storm Deck', kind: 'survival', blurb: 'A raft in a thunderstorm. A ring of light marks where the lightning strikes next: get out of it, or get blasted overboard.', keep: 0.6 },
  hightide: { id: 'hightide', name: 'High Tide', kind: 'survival', blurb: 'Coral columns in the sea. The tide rises a step at a time: climb higher, keep your spot, push the others in.', keep: 0.6 },
  colourcall: { id: 'colourcall', name: 'Colour Call', kind: 'survival', blurb: 'A colour is called. Get on it: every other tile drops out from under you.', keep: 0.6 },
  hotspud: { id: 'hotspud', name: 'Hot Spud', kind: 'survival', blurb: 'A few spuds with lit fuses. Touch someone to pass yours on. Whoever holds one when it blows is out.', keep: 0.6 },
  bouncehouse: { id: 'bouncehouse', name: 'Bounce House', kind: 'score', blurb: 'The floor never stops bouncing. Pop balloons in the air, chain them for a combo, jump as you land to super bounce. Dodge the thunder ones.', keep: 0.6 },
  beltrush: { id: 'beltrush', name: 'Belt Rush', kind: 'survival', blurb: 'A giant belt brings toy blocks at you, faster and faster. Dodge, hop, keep running. Off the back and you are out.', keep: 0.6 },
  discodash: { id: 'discodash', name: 'Disco Dash', kind: 'race', blurb: 'Down the dance floors: laser gates, spinning floors and sweeping bars, all on the beat.', keep: 0.75 },
  bigtop: { id: 'bigtop', name: 'Big Top', kind: 'race', blurb: 'Under the tents: bounce pits, swinging hammers, seesaws and wrecking balls.', keep: 0.75 },
  treasuretrail: { id: 'treasuretrail', name: 'Treasure Trail', kind: 'race', blurb: 'Island to island past the cannons, along the planks and over the rapids.', keep: 0.75 },
  blockparty: { id: 'blockparty', name: 'Block Party', kind: 'race', blurb: 'Through the toy box: stampers, rolling balls, sliders and a jelly bounce.', keep: 0.75 },
  crownpeak: { id: 'crownpeak', name: 'Crown Peak', kind: 'final', blurb: 'The longest course in the show, all the way up. First across takes the crown', keep: 0 },
  crownkeep: { id: 'crownkeep', name: 'Crown Keeper', kind: 'final', blurb: 'A castle in the sky and one crown. Hold it for 30 seconds to win. When the throne goes hot your clock runs double, until it blows.', keep: 0 },
};
/**
 * The running order of this show (a live list: a new show deals a new one, a guest takes the
 * host's). The default is every round once, for the test links (?round=N).
 */
// (the old running order keeps its indexes for the test tools; the team round is 6)
export const DEFAULT_SHOW: RoundId[] = ['timber', 'paintmill', 'jumpclub', 'ridge', 'tiptop', 'summit', 'paintparty', 'hopscotch', 'bonkbay', 'knockknock', 'whirligig', 'bonkalley', 'wobblewalk', 'skystairs', 'jellyjunction', 'crownpeak', 'splatring', 'punchline', 'rumblehill', 'crumble', 'lavarush', 'meltdown', 'petalpass', 'ticktock', 'moonrun', 'sliprink', 'stormdeck', 'hightide', 'colourcall', 'hotspud', 'bouncehouse', 'beltrush', 'discodash', 'bigtop', 'treasuretrail', 'blockparty', 'crownkeep'];
export const SHOW: RoundInfo[] = DEFAULT_SHOW.map((id) => ROUNDS[id]);
/** the rounds a show is dealt from (the old chute races are kept for the test links only) */
export const RACE_POOL: RoundId[] = ['hopscotch', 'bonkbay', 'knockknock', 'whirligig', 'bonkalley', 'wobblewalk', 'skystairs', 'jellyjunction', 'punchline', 'rumblehill', 'lavarush', 'petalpass', 'ticktock', 'moonrun', 'sliprink', 'discodash', 'bigtop', 'treasuretrail', 'blockparty'];
export const SURVIVAL_POOL: RoundId[] = ['jumpclub', 'tiptop', 'crumble', 'meltdown', 'stormdeck', 'hightide', 'colourcall', 'beltrush'];
/** the games that are neither: each show has at least one */
export const PARTY_POOL: RoundId[] = ['paintparty', 'splatring', 'hotspud', 'bouncehouse'];
export const POOL: RoundId[] = [...RACE_POOL, ...SURVIVAL_POOL, ...PARTY_POOL, 'crownpeak', 'crownkeep'];

/**
 * The kinds of game a show is dealt from. A show never plays the same one twice: each of its six
 * rounds comes from a different family here, and the final differs from them all (a show with an
 * obstacle race ends in Crown Keeper; one without it ends in the race up Crown Peak).
 */
export const MODES = {
  race: RACE_POOL.filter((id) => id !== 'lavarush'),
  chase: ['lavarush', 'beltrush', 'hightide'],
  floor: ['crumble', 'meltdown', 'colourcall'],
  dodge: ['jumpclub', 'tiptop', 'stormdeck'],
  team: ['paintparty', 'splatring'],
  grab: ['hotspud', 'bouncehouse'],
} satisfies Record<string, RoundId[]>;
export type ModeId = keyof typeof MODES;
/** what the round card calls it */
const MODE_NAME: Record<ModeId, string> = { race: 'OBSTACLE RACE', chase: 'OUTRUN IT', floor: 'VANISHING FLOOR', dodge: 'DODGE IT', team: 'TEAM GAME', grab: 'GRAB GAME' };
export function modeOf(id: RoundId): ModeId | 'final' {
  for (const k in MODES) if ((MODES[k as ModeId] as RoundId[]).includes(id)) return k as ModeId;
  return 'final';
}
export function modeName(id: RoundId) {
  if (id === 'crownkeep') return 'FINAL · CROWN KEEPER';
  if (ROUNDS[id].kind === 'final') return 'FINAL · CROWN RACE';
  if (id === 'hotspud') return 'TAG GAME';
  if (id === 'bouncehouse') return 'BOUNCE GAME';
  const m = modeOf(id);
  return m === 'final' ? 'RACE' : MODE_NAME[m];
}

/** the last show's rounds: the next one steers clear of them where it can */
let lastShow: RoundId[] = [];
export function dealShow(rnd = Math.random) {
  const shuffle = <T,>(a: readonly T[]) => a.map((x) => [rnd(), x] as const).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
  const pick = (k: ModeId) => {
    const all = shuffle<RoundId>(MODES[k]);
    return all.find((id) => !lastShow.includes(id)) ?? all[0];
  };
  const others = shuffle<ModeId>(['chase', 'floor', 'dodge', 'team', 'grab']);
  const withRace = rnd() < 0.6;
  // (five families and a final that's none of them)
  const fams: ModeId[] = shuffle<ModeId>(withRace ? ['race', ...others.slice(0, 4)] : others);
  // (the team game needs a field to split: never the last round before the final)
  if (fams[4] === 'team') [fams[4], fams[3]] = [fams[3], fams[4]];
  const ids: RoundId[] = [...fams.map(pick), withRace ? 'crownkeep' : 'crownpeak'];
  setShow(ids);
  lastShow = ids;
  return ids;
}
export function setShow(ids: RoundId[]) {
  SHOW.splice(0, SHOW.length, ...ids.map((id) => ROUNDS[id]));
}

export function buildRound(id: RoundId): Course {
  setFoamTheme(id === 'jumpclub' || id === 'tiptop' || id === 'paintparty' ? 'arena' : id);
  const bi = setBiome(ROUND_BIOME[id] ?? 'candy');
  // (the platform courses take their world's colours: tiles, rails, posts)
  if (id in GEN) {
    const d = bi.deck;
    useFoamTheme({ floorA: d.tiles[0][0], floorB: d.tiles[0][1], wall: d.wall, rail: d.rail, railB: d.railB, post: d.post, base: d.base });
  }
  const info = ROUNDS[id];
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
    case 'paintparty':
      return paintparty(info);
    case 'splatring':
      return paintparty(info, 'ring');
    case 'summit':
      return summit(info);
    case 'crumble':
      return crumble(info);
    case 'meltdown':
      return crumble(info, 'melt');
    case 'stormdeck':
      return storm(info);
    case 'hightide':
      return tide(info);
    case 'colourcall':
      return colourCall(info);
    case 'hotspud':
      return hotSpud(info);
    case 'bouncehouse':
      return bounceHouse(info);
    case 'beltrush':
      return beltRush(info);
    case 'crownkeep':
      return crownKeep(info);
    default:
      return genCourse(GEN[id], info);
  }
}

