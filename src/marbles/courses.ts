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
import { beanCup, type CupArena } from './course-soccer.ts';
import { GEN, genCourse } from './course-gen.ts';
import { crumble, type CrumbleArena } from './course-crumble.ts';
import { storm, type StormArena } from './course-storm.ts';
import { rocketRumble, type RocketArena } from './course-rocket.ts';
import { beanBayGP, type KartArena } from './course-kart.ts';
import { SUNDAE_SPEEDWAY } from './kart-layout.ts';
import { colourCall, type CallArena } from './course-modes.ts';
import { gateCrashers } from './course-gates.ts';

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
  /** Meltdown's ice floe */
  crumble?: CrumbleArena;
  /** Storm Deck's lightning */
  storm?: StormArena;
  /** the party games (course-modes.ts) */
  call?: CallArena;
  /** the ones that change how you move: the go-karts, the jetpacks */
  kart?: KartArena;
  rocket?: RocketArena;
  /** the Crown Keeper final */
  keep?: KeepArena;
  /** Lava Rush: the lava's height and how far along the course it has come, at a time */
  lava?: { y(t: number): number; s(t: number): number };
  /** the team round's painted floor */
  team?: TeamArena;
  /** the ball games' pitch: Bean Cup, Big Push, Over the Fence */
  cup?: CupArena;
  /** the crown on its pedestal (the final) */
  crown?: THREE.Object3D;
  /** for the flyover */
  intro: THREE.Vector3[];
}

export type GenId = 'discodash' | 'bigtop' | 'treasuretrail' | 'blockparty' | 'petalpass' | 'ticktock' | 'moonrun' | 'sliprink' | 'lavarush' | 'hopscotch' | 'bonkbay' | 'knockknock' | 'whirligig' | 'bonkalley' | 'wobblewalk' | 'skystairs' | 'jellyjunction' | 'crownpeak' | 'punchline' | 'rumblehill';
export type RoundId = 'timber' | 'paintmill' | 'jumpclub' | 'ridge' | 'tiptop' | 'paintparty' | 'splatring' | 'summit' | 'meltdown' | 'stormdeck' | 'rocketrumble' | 'colourcall' | 'beanbaygp' | 'beancup' | 'bigpush' | 'overfence' | 'volleyfolly' | 'beanbowl' | 'beanhoops' | 'sundaespeedway' | 'crownkeep' | 'gatecrashers' | 'crowngp' | GenId;
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
  meltdown: { id: 'meltdown', name: 'Meltdown', kind: 'survival', blurb: 'An ice floe melting in from the edge, holes opening in it. Hold your spot, push the others in.', keep: 0.6 },
  lavarush: { id: 'lavarush', name: 'Lava Rush', kind: 'race', blurb: 'Climb! The lava rises up the course behind you. Get caught and you are out.', keep: 0.7 },
  paintparty: { id: 'paintparty', name: 'Paint Party', kind: 'team', blurb: 'Run over the tiles to paint them your team colour. Steal theirs. Least floor goes home.', keep: 0.67 },
  splatring: { id: 'splatring', name: 'Splat Ring', kind: 'team', blurb: 'Paint the ring your colour. A long bar sweeps round faster and faster: hop it.', keep: 0.67 },
  beanbowl: { id: 'beanbowl', name: 'Bean Bowl', kind: 'team', blurb: 'Football! Run into the ball to pick it up and carry it into THEIR end zone: a touchdown is 7. DIVE into whoever has it to knock it loose. Press GRAB to throw it to a team-mate up the field. Most points stays in.', keep: 0.5 },
  beancup: { id: 'beancup', name: 'Bean Cup', kind: 'team', blurb: 'Two teams, one big ball. Run into it to dribble, dive through it to shoot, jump for a header. Losers go home.', keep: 0.5 },
  bigpush: { id: 'bigpush', name: 'Big Push', kind: 'team', blurb: 'One giant ball, two teams. Everyone shoves: push it over their end line to score. DIVE into it to give it a real shove.', keep: 0.5 },
  overfence: { id: 'overfence', name: 'Over the Fence', kind: 'team', blurb: 'Two yards, a fence, eight balls. DIVE into a ball to lob it over into their yard. When the clock runs out, the yard with more balls in it goes home.', keep: 0.5 },
  beanhoops: { id: 'beanhoops', name: 'Bean Hoops', kind: 'team', blurb: 'Basketball! A hoop high at each end. Run into the ball to dribble it up the court, then DIVE into it to shoot. From outside the arc it is worth THREE. Most points stays in.', keep: 0.5 },
  volleyfolly: { id: 'volleyfolly', name: 'Volley Folly', kind: 'team', blurb: 'A net, two teams and one big floaty beach ball. Run under it to keep it up, JUMP or DIVE into it to send it over. It lands in your yard: a point to them.', keep: 0.5 },
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
  rocketrumble: { id: 'rocketrumble', name: 'Rocket Rumble', kind: 'survival', blurb: 'Everyone has a jetpack. Hold jump to fly, dive to ram, fly through the rings to refuel. The platforms are going. The sea is not your friend.', keep: 0.6 },
  colourcall: { id: 'colourcall', name: 'Colour Call', kind: 'survival', blurb: 'A colour is called. Get on it: every other tile drops out from under you.', keep: 0.6 },
  beanbaygp: { id: 'beanbaygp', name: 'Bean Bay GP', kind: 'race', blurb: 'Go-karts! Two laps of a figure-of-eight circuit: the hairpin, the Big Bowl, over the Hump and through the Light Tunnel. Hold SPACE or SHIFT to drift, and let go for a boost.', keep: 0.7 },
  sundaespeedway: { id: 'sundaespeedway', name: 'Sundae Speedway', kind: 'race', blurb: 'Go-karts on the fast one! Two laps: flat out round the banked Scoop, off the ground over the Cherry, through the Candy Tunnel and the Sprinkles, and brake for the Cone. Hold SPACE or SHIFT to drift, and let go for a boost.', keep: 0.7 },
  discodash: { id: 'discodash', name: 'Disco Dash', kind: 'race', blurb: 'Down the dance floors: laser gates, spinning floors and sweeping bars, all on the beat.', keep: 0.75 },
  bigtop: { id: 'bigtop', name: 'Big Top', kind: 'race', blurb: 'Under the tents: bounce pits, swinging hammers, seesaws and wrecking balls.', keep: 0.75 },
  treasuretrail: { id: 'treasuretrail', name: 'Treasure Trail', kind: 'race', blurb: 'Island to island past the cannons, along the planks and over the rapids.', keep: 0.75 },
  blockparty: { id: 'blockparty', name: 'Block Party', kind: 'race', blurb: 'Through the toy box: stampers, rolling balls, sliders and a jelly bounce.', keep: 0.75 },
  crownpeak: { id: 'crownpeak', name: 'Crown Peak', kind: 'final', blurb: 'The longest course in the show, all the way up. First across takes the crown', keep: 0 },
  gatecrashers: { id: 'gatecrashers', name: 'Gate Crashers', kind: 'final', blurb: 'The final! Every bean has a gate in the wall. A ball through YOUR gate and you are out. Stand in front of it, DIVE into a ball to shoot it at someone else\'s. More balls drop in, the gates grow. Last bean standing takes the crown.', keep: 0 },
  crowngp: { id: 'crowngp', name: 'Crown Grand Prix', kind: 'final', blurb: 'The final, in go-karts! Two laps, everyone who is left, no second place: the first kart across the line takes the crown. Hold SPACE to drift, let go for a boost.', keep: 0 },
  crownkeep: { id: 'crownkeep', name: 'Crown Keeper', kind: 'final', blurb: 'A castle in the sky and one crown. Hold it for 30 seconds to win. When the throne goes hot your clock runs double, until it blows.', keep: 0 },
};
/**
 * The running order of this show (a live list: a new show deals a new one, a guest takes the
 * host's). The default is every round once, for the test links (?round=N).
 */
// (the old running order keeps its indexes for the test tools; the team round is 6)
export const DEFAULT_SHOW: RoundId[] = ['timber', 'paintmill', 'jumpclub', 'ridge', 'tiptop', 'summit', 'paintparty', 'hopscotch', 'bonkbay', 'knockknock', 'whirligig', 'bonkalley', 'wobblewalk', 'skystairs', 'jellyjunction', 'crownpeak', 'splatring', 'punchline', 'rumblehill', 'lavarush', 'meltdown', 'petalpass', 'ticktock', 'moonrun', 'sliprink', 'stormdeck', 'rocketrumble', 'colourcall', 'discodash', 'bigtop', 'treasuretrail', 'blockparty', 'crownkeep', 'beanbaygp', 'beancup', 'bigpush', 'overfence', 'volleyfolly', 'beanbowl', 'beanhoops', 'sundaespeedway', 'gatecrashers', 'crowngp'];
export const SHOW: RoundInfo[] = DEFAULT_SHOW.map((id) => ROUNDS[id]);
/** the rounds a show is dealt from (the old chute races are kept for the test links only) */
export const RACE_POOL: RoundId[] = ['hopscotch', 'bonkbay', 'knockknock', 'whirligig', 'bonkalley', 'wobblewalk', 'skystairs', 'jellyjunction', 'punchline', 'rumblehill', 'lavarush', 'petalpass', 'ticktock', 'moonrun', 'sliprink', 'discodash', 'bigtop', 'treasuretrail', 'blockparty'];
export const SURVIVAL_POOL: RoundId[] = ['jumpclub', 'tiptop', 'meltdown', 'stormdeck', 'rocketrumble', 'colourcall'];
/** the games that are neither: each show has at least one */
export const PARTY_POOL: RoundId[] = ['paintparty', 'splatring', 'beanbowl', 'beancup', 'bigpush', 'overfence', 'volleyfolly', 'beanhoops', 'beanbaygp', 'sundaespeedway'];
/** the team games played with a ball on a pitch (half the field goes home) */
export const BALL_ROUNDS: RoundId[] = ['beancup', 'bigpush', 'overfence', 'volleyfolly', 'beanhoops', 'beanbowl'];
/**
 * The finals. A show ends in one of them, and they're dealt like cards: none comes round again
 * until the others have all had their turn. Gate Crashers (a gate each, balls, lives), Crown
 * Keeper (hold the crown), the Crown Grand Prix (karts) and Crown Peak (the long race).
 */
export const FINALS: RoundId[] = ['gatecrashers', 'crownkeep', 'crowngp', 'crownpeak'];
export const POOL: RoundId[] = [...RACE_POOL, ...SURVIVAL_POOL, ...PARTY_POOL, ...FINALS];

/**
 * The kinds of game a show is dealt from: five of these seven, a different five from the last
 * show's (the two that sat out are in), and no kind twice, except that there are so many more
 * obstacle races than anything else that now and then a show has two of them.
 */
export const MODES = {
  race: RACE_POOL.filter((id) => id !== 'lavarush'),
  chase: ['lavarush', 'rocketrumble'],
  kart: ['beanbaygp', 'sundaespeedway'],
  floor: ['meltdown', 'colourcall'],
  dodge: ['jumpclub', 'tiptop', 'stormdeck'],
  team: ['paintparty', 'splatring'],
  ball: ['beancup', 'bigpush', 'overfence', 'volleyfolly', 'beanhoops', 'beanbowl'],
} satisfies Record<string, RoundId[]>;
export type ModeId = keyof typeof MODES;
/** what the round card calls it */
const MODE_NAME: Record<ModeId, string> = { race: 'OBSTACLE RACE', chase: 'OUTRUN IT', kart: 'GO-KART RACE', floor: 'VANISHING FLOOR', dodge: 'DODGE IT', team: 'TEAM GAME', ball: 'TEAM BALL GAME' };
export function modeOf(id: RoundId): ModeId | 'final' {
  for (const k in MODES) if ((MODES[k as ModeId] as RoundId[]).includes(id)) return k as ModeId;
  return 'final';
}
export function modeName(id: RoundId) {
  if (id === 'gatecrashers') return 'THE FINAL · LAST BEAN STANDING';
  if (id === 'crowngp') return 'THE FINAL · GO-KART GRAND PRIX';
  if (id === 'crownkeep') return 'FINAL · CROWN KEEPER';
  if (ROUNDS[id].kind === 'final') return 'FINAL · CROWN RACE';
  if (id === 'beancup') return 'TEAM SOCCER';
  if (id === 'bigpush') return 'TEAM PUSH';
  if (id === 'overfence') return 'TEAM THROW';
  if (id === 'volleyfolly') return 'TEAM VOLLEYBALL';
  if (id === 'beanhoops') return 'TEAM BASKETBALL';
  if (id === 'beanbowl') return 'TEAM FOOTBALL';
  if (id === 'rocketrumble') return 'JETPACK BATTLE';
  const m = modeOf(id);
  return m === 'final' ? 'RACE' : MODE_NAME[m];
}

/**
 * What's been dealt, so shows keep changing. Every kind of game has a bag of its rounds, and so
 * do the finals: a round drawn isn't seen again until the bag's empty, which is every other one
 * of its kind played. The bags are kept between visits (a reload doesn't start the same way).
 */
interface Dealt {
  bags: Record<string, RoundId[]>;
  last: Record<string, RoundId>;
  /** the kinds the last show left out: they're in the next one */
  out: ModeId[];
  /** the last show's rounds: none of them is in the next one */
  prev: RoundId[];
}
const DEAL_KEY = 'wobble-deal-2';
function loadDealt(): Dealt {
  try {
    const d = JSON.parse(localStorage.getItem(DEAL_KEY) ?? 'null') as Dealt | null;
    if (d && typeof d.bags === 'object' && typeof d.last === 'object' && Array.isArray(d.out) && Array.isArray(d.prev)) return d;
  } catch {
    // (no storage: every visit starts with full bags)
  }
  return { bags: {}, last: {}, out: [], prev: [] };
}
const dealt = loadDealt();
export function dealShow(rnd = Math.random) {
  const shuffle = <T,>(a: readonly T[]) => a.map((x) => [rnd(), x] as const).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
  const got: RoundId[] = [];
  const draw = (key: string, all: readonly RoundId[]) => {
    let bag = (dealt.bags[key] ?? []).filter((id) => all.includes(id));
    if (!bag.length) {
      // (a new bag has the round the old one ended on at the bottom)
      bag = shuffle(all);
      const k = bag.indexOf(dealt.last[key]);
      if (k >= 0 && bag.length > 1) bag.push(...bag.splice(k, 1));
    }
    // (the first that wasn't in the last show, and isn't in this one already)
    let i = bag.findIndex((id) => !got.includes(id) && !dealt.prev.includes(id));
    if (i < 0) i = Math.max(0, bag.findIndex((id) => !got.includes(id)));
    const [id] = bag.splice(i, 1);
    dealt.bags[key] = bag;
    dealt.last[key] = id;
    got.push(id);
    return id;
  };
  const final = draw('final', FINALS);
  // five kinds of the seven: the two that sat out last time, then any three of the rest
  const kinds = Object.keys(MODES) as ModeId[];
  const owed = shuffle(dealt.out.filter((k) => kinds.includes(k)));
  const fams: ModeId[] = [...owed, ...shuffle(kinds.filter((k) => !owed.includes(k)))].slice(0, 5);
  // (now and then a second obstacle race in place of one of them; never when the final's a race too)
  if (rnd() < 0.3 && final !== 'crownpeak' && fams.includes('race') && fams[4] !== 'race') fams[4] = 'race';
  dealt.out = kinds.filter((k) => !fams.includes(k));
  // (a team game needs a field to split: they're in the first three rounds, never the two before
  // the final; and two races are never one after the other. Any order that does both)
  const teamy = (f: ModeId) => f === 'team' || f === 'ball';
  const fine = (o: ModeId[]) => !teamy(o[3]) && !teamy(o[4]) && !o.some((f, k) => f === 'race' && o[k + 1] === 'race');
  let order = shuffle(fams);
  for (let tries = 0; tries < 200 && !fine(order); tries++) order = shuffle(fams);
  const ids: RoundId[] = [...order.map((k) => draw(k, MODES[k])), final];
  dealt.prev = ids;
  setShow(ids);
  try {
    localStorage.setItem(DEAL_KEY, JSON.stringify(dealt));
  } catch {
    // (no storage)
  }
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
    case 'beanbowl':
      return beanCup(info, 'bowl');
    case 'beancup':
      return beanCup(info);
    case 'bigpush':
      return beanCup(info, 'push');
    case 'overfence':
      return beanCup(info, 'fence');
    case 'volleyfolly':
      return beanCup(info, 'volley');
    case 'beanhoops':
      return beanCup(info, 'hoops');
    case 'summit':
      return summit(info);
    case 'meltdown':
      return crumble(info, 'melt');
    case 'stormdeck':
      return storm(info);
    case 'rocketrumble':
      return rocketRumble(info);
    case 'colourcall':
      return colourCall(info);
    case 'beanbaygp':
      return beanBayGP(info);
    case 'sundaespeedway':
      return beanBayGP(info, SUNDAE_SPEEDWAY);
    case 'crowngp':
      // (the circuit this show hasn't raced on; every browser has the same show, so the same one)
      return beanBayGP(info, SHOW.some((x) => x.id === 'sundaespeedway') ? undefined : SUNDAE_SPEEDWAY, true);
    case 'crownkeep':
      return crownKeep(info);
    case 'gatecrashers':
      return gateCrashers(info);
    default:
      return genCourse(GEN[id], info);
  }
}

