import * as THREE from 'three';
import { CourseBuilder } from './builder.ts';
import { Kin, Mat } from './physics.ts';
import type { Course } from './courses.ts';
import { dressArena } from './course-dress.ts';
import { glowMat } from './obs-world.ts';
import { title } from './course-modes.ts';
import type { GateRing } from './course-gates.ts';

/**
 * Bean Cup: two teams, two goals and a ball as big as you are. Run into it to dribble, DIVE into it
 * for a real shot, JUMP for a header. A shot in the face knocks you over. With a little time left a
 * second ball drops in. Level at the whistle is golden goal. The losing team goes home.
 *
 * The walls and floor here are simple on purpose: the ball is the host's, moved by soccer.ts against
 * the same outline the beans run into.
 */
export const CUP = {
  /** the pitch: half its width and length, the corners cut off so a ball can't sit in one */
  HW: 21,
  HL: 32,
  cut: 7,
  /** the goal: half its mouth, its height, how deep */
  goalHalf: 7.5,
  goalH: 6.2,
  goalD: 5.5,
  /** the ball */
  R: 1.35,
  g: 20,
  ceil: 11,
  /** the clock, the wait after a goal, when the second ball comes (seconds left), golden goal's limit */
  T: 100,
  restart: 2.8,
  second: 32,
  over: 45,
};
export type CupRule = 'cup' | 'push' | 'fence' | 'volley' | 'hoops' | 'gates' | 'bowl';
/**
 * Bean Bowl, football by the downs. The side with the ball has four downs to make ten yards
 * (a yard is half a metre here: the field's fifty metres are its hundred yards); make them and
 * it's first down again, don't and the other side takes over where the ball lies.
 */
export interface BowlDrive {
  /** the side with the ball (0 pink, which attacks +z; 1 blue) */
  off: number;
  down: number;
  /** the line of scrimmage and the line to gain: z, from the middle of the field */
  los: number;
  first: number;
  /** 'set': lined up, waiting for the snap; 'live': the play's on; 'dead': the whistle's gone */
  phase: 'set' | 'live' | 'dead';
  /** when the ball's snapped (world time), when the play went live, when the next one's set up */
  snapAt: number;
  liveAt: number;
  deadAt: number;
  /** the quarterback (a bean's id), the play called (PLAYS' index) and whether it's a run */
  qb: number;
  play: number;
  run: boolean;
  /** the play's number in the game (every browser lines up afresh when it changes) */
  seq: number;
  /** this play: a forward pass has been thrown; the other side has taken the ball (an interception) */
  passed: boolean;
  turned: boolean;
}
export type BowlRole = 'QB' | 'OL' | 'RB' | 'WR' | 'DL' | 'LB' | 'CB' | 'S';
export interface BowlSpot {
  x: number;
  z: number;
  yaw: number;
  role: BowlRole;
  /** the route: points on the field to run to, in order (none: it blocks, or plays its position) */
  route: [number, number][];
  /** what the route's called (for a person who's running it) */
  call: string;
  /** a cornerback's man (a bean's id; -1: none) */
  man: number;
}

/** one pitch's numbers: Bean Cup's, or a variant's */
export interface CupCfg {
  rule: CupRule;
  HW: number;
  HL: number;
  cut: number;
  /** 0: no goals (the ends are walls) */
  goalHalf: number;
  goalH: number;
  goalD: number;
  R: number;
  g: number;
  ceil: number;
  T: number;
  restart: number;
  /** seconds left when the second ball drops in (0: never) */
  second: number;
  over: number;
  /** how many balls there are */
  balls: number;
  /** a dive's shot speed, its lift, and the dribble's push (1: Bean Cup's) */
  kick: number;
  loft: number;
  push: number;
  /** Over the Fence: the fence's height (the ball has to clear it) */
  fenceH: number;
  /** the fastest the ball ever goes (m/s), and how long after a touch a goal is still that side's (s) */
  top: number;
  credit: number;
  /** Bean Hoops: how high the rim is, its radius, how far in from the end wall it hangs, and how far out a shot is worth three */
  hoopY: number;
  hoopR: number;
  hoopIn: number;
  three: number;
  /** Bean Bowl: how deep an end zone is (m in from the end wall) */
  endZone: number;
  /** the words */
  call: string;
  goalLine: string;
  goalWord: string;
  extra: string;
}
const NOHOOP = { hoopY: 0, hoopR: 0, hoopIn: 0, three: 0, endZone: 0 };
export const CUP_CFG: Record<CupRule, CupCfg> = {
  cup: { rule: 'cup', ...CUP, ...NOHOOP, balls: 2, kick: 1, loft: 6.5, push: 1, fenceH: 0, top: 34, credit: 5, call: 'RUN INTO THE BALL · DIVE TO SHOOT', goalLine: 'The team with the most goals stays in the show', goalWord: 'GOAL!', extra: 'GOLDEN GOAL' },
  // one ball as tall as three of you: nobody kicks it, everybody shoves it
  push: { rule: 'push', ...CUP, ...NOHOOP, HW: 22, HL: 30, goalHalf: 15, goalH: 9.5, goalD: 9, R: 3.4, ceil: 13, second: 0, balls: 1, kick: 0.42, loft: 2.5, push: 0.55, fenceH: 0, top: 12.5, credit: 9, call: 'PUSH THE BALL OVER THEIR LINE · DIVE TO SHOVE', goalLine: 'Push the giant ball over their line. Most points stays in', goalWord: 'OVER THE LINE!', extra: 'NEXT POINT WINS' },
  // eight small balls and a fence down the middle: lob them over
  fence: { rule: 'fence', ...CUP, ...NOHOOP, HW: 20, HL: 27, cut: 6, goalHalf: 0, goalH: 0, goalD: 0, R: 1.05, T: 90, second: 0, over: 20, balls: 8, kick: 0.8, loft: 11.5, push: 1, fenceH: 1.5, top: 34, credit: 5, call: 'DIVE INTO A BALL TO LOB IT OVER THE FENCE', goalLine: 'When the clock runs out, the yard with more balls goes home', goalWord: '', extra: 'SUDDEN DEATH' },
  // one big floaty beach ball and a net: it mustn't land in your yard
  volley: { rule: 'volley', ...CUP, ...NOHOOP, HW: 17, HL: 21, cut: 5, goalHalf: 0, goalH: 0, goalD: 0, R: 1.7, g: 12, ceil: 15, T: 90, restart: 2, second: 0, over: 40, balls: 1, kick: 1, loft: 0, push: 1, fenceH: 2.3, top: 30, credit: 8, call: 'KEEP IT UP · JUMP OR DIVE INTO IT TO SEND IT OVER', goalLine: 'The ball lands in your yard: a point to them. Most points stays in', goalWord: 'POINT!', extra: 'NEXT POINT WINS' },
  // basketball: a hoop high at each end; a dive into the ball is a shot at it
  hoops: { rule: 'hoops', ...CUP, HW: 17, HL: 25, cut: 5, goalHalf: 0, goalH: 0, goalD: 0, R: 1.15, ceil: 15, T: 100, restart: 2.6, second: 0, over: 45, balls: 1, kick: 1, loft: 6.5, push: 0.55, fenceH: 0, top: 24, credit: 7, hoopY: 5.4, hoopR: 2.3, hoopIn: 3.3, three: 15, endZone: 0, call: 'DRIBBLE IT UP THE COURT · DIVE INTO IT TO SHOOT', goalLine: 'Most points stays in the show. A shot from outside the arc is worth three', goalWord: 'BASKET!', extra: 'NEXT BASKET WINS' },
  // football: a ball you carry. Run it into their end zone for a touchdown; a tackle knocks it loose; throw it to a team-mate
  bowl: { rule: 'bowl', ...CUP, ...NOHOOP, HW: 16, HL: 31, cut: 3, goalHalf: 0, goalH: 0, goalD: 0, R: 0.72, ceil: 16, T: 170, restart: 3, second: 0, over: 45, balls: 1, kick: 1, loft: 6, push: 1, fenceH: 0, top: 30, credit: 8, endZone: 6, call: 'FOUR DOWNS TO MAKE TEN YARDS · GET IT TO THEIR END ZONE', goalLine: 'Real football: four downs to make ten yards. A touchdown is 7. Most points stays in the show', goalWord: 'TOUCHDOWN!', extra: 'NEXT SCORE WINS' },
  // the final: a ring, a gate each, and every bean for itself (course-gates.ts)
  gates: { rule: 'gates', ...CUP, ...NOHOOP, HW: 17, HL: 17, cut: 0, goalHalf: 0, goalH: 0, goalD: 0, R: 1.3, ceil: 12, T: 150, restart: 1.5, second: 0, over: 0, balls: 3, kick: 0.82, loft: 4.2, push: 0.9, fenceH: 0, top: 30, credit: 6, call: 'GUARD YOUR GATE · KNOCK IT THROUGH THEIRS', goalLine: 'A ball through your gate and you are out. Last bean standing takes the crown', goalWord: '', extra: '' },
};
export const CUP_COLORS = [0xff4f9a, 0x2f9bff];
export const CUP_NAMES = ['PINK', 'BLUE'];

export interface CupBall {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  quat: THREE.Quaternion;
  /** in play (false: not on yet, or just scored) */
  live: boolean;
  /** when it comes back (world time; 0: not waiting) */
  backAt: number;
  /** who touched it last and before that (bean ids) */
  last: number;
  prev: number;
  /** when a bean last kicked it (no double hits) */
  kickT: number;
  /** each side's last bean to touch it, and when (world time) */
  by: [number, number];
  byT: [number, number];
  /**
   * Bean Bowl: who's carrying it (a bean's id; -1: it's loose), who threw it last and when, is it
   * still in the air from that throw (a catch), who dropped it last and when (they can't snatch it
   * straight back), and how long the carrier's been held by someone (long enough and it's stripped)
   */
  held: number;
  thrower: number;
  passT: number;
  inAir: boolean;
  fumbler: number;
  dropT: number;
  gripT: number;
  /** Bean Hoops: what it's worth if it goes in (two, or three from outside the arc), and how high it was a moment ago */
  worth: number;
  py: number;
}
export interface CupArena {
  center: THREE.Vector3;
  cfg: CupCfg;
  /** each bean's team */
  of: Map<number, number>;
  balls: CupBall[];
  /** the outline as segments, x0 z0 x1 z1 (world), and the posts of everything round */
  segs: [number, number, number, number][];
  rounds: { x: number; z: number; r: number; kick: number }[];
  /** the net shakes */
  shake(team: number, t: number): void;
  /** the goal at whichever end the camera's behind goes see-through */
  view(cam: THREE.Vector3): void;
  /** the middle of the goal a team shoots at */
  goal(team: number, o: THREE.Vector3): THREE.Vector3;
  /** Bean Hoops: the middle of the rim each team shoots at */
  hoops: THREE.Vector3[];
  /** Bean Bowl: the bean with the ball throws it toward a spot, or hands it to a team-mate beside it (set by the game's ball rules: a bot calls them) */
  pass?: (id: number, tx: number, tz: number) => void;
  handoff?: (from: number, to: number) => void;
  /** Bean Bowl: the drive as it stands, and where each bean lines up and what its job is this play */
  bowl?: { D: BowlDrive; spot(id: number): BowlSpot | undefined; meet(id: number, fx: number, fz: number): [number, number] };
  /** Gate Crashers (the final): the ring and its gates, and a colour for every bean's own "team" */
  gates?: GateRing;
  colors?: number[];
}

/** Bean Bowl's gridiron: mown stripes, a line every five yards with its number, hash marks, an end zone each */
function gridironArt(C: CupCfg) {
  const { HW, HL } = C;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 2048;
  const x = c.getContext('2d')!;
  const sx = 1024 / (HW * 2), sz = 2048 / (HL * 2);
  const X = (u: number) => (u + HW) * sx, Z = (v: number) => (v + HL) * sz;
  const play = HL - C.endZone, step = play / 10;
  for (let k = 0; k < 20; k++) {
    x.fillStyle = k % 2 ? '#2f9e4b' : '#38b257';
    x.fillRect(0, Z(-play + k * step), 1024, step * sz + 1);
  }
  // the end zones: pink's at -z (it defends it), blue's at +z, each with its name across it
  const zone = (s: number, col: string, dark: string, name: string) => {
    const z0 = s < 0 ? -HL : play;
    x.fillStyle = col;
    x.fillRect(0, Z(z0), 1024, C.endZone * sz);
    x.fillStyle = dark;
    for (let k = -12; k < 24; k += 2) {
      x.beginPath();
      x.moveTo(k * 60, Z(z0));
      x.lineTo(k * 60 + 60, Z(z0));
      x.lineTo(k * 60 + 60 - C.endZone * sz, Z(z0) + C.endZone * sz);
      x.lineTo(k * 60 - C.endZone * sz, Z(z0) + C.endZone * sz);
      x.closePath();
      x.fill();
    }
    x.save();
    x.translate(512, Z(z0 + C.endZone / 2));
    if (s > 0) x.rotate(Math.PI);
    x.fillStyle = '#ffffff';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.font = `900 ${Math.round(C.endZone * sz * 0.62)}px "Lilita One", "Arial Black", sans-serif`;
    x.lineWidth = 12;
    x.strokeStyle = 'rgba(0,0,0,0.35)';
    x.strokeText(name, 0, 6);
    x.fillText(name, 0, 6);
    x.restore();
  };
  zone(-1, '#ff4f9a', 'rgba(255,255,255,0.14)', 'P I N K');
  zone(1, '#2f9bff', 'rgba(255,255,255,0.14)', 'B L U E');
  // the lines
  x.strokeStyle = '#fbfff6';
  x.fillStyle = '#fbfff6';
  x.lineWidth = 8;
  x.strokeRect(X(-HW + 0.6), Z(-HL + 0.6), (HW * 2 - 1.2) * sx, (HL * 2 - 1.2) * sz);
  for (let k = 0; k <= 10; k++) {
    const z = -play + k * step;
    x.lineWidth = k === 0 || k === 10 ? 14 : k === 5 ? 10 : 6;
    x.beginPath();
    x.moveTo(X(-HW + 0.6), Z(z));
    x.lineTo(X(HW - 0.6), Z(z));
    x.stroke();
    // (the numbers count up to the middle from each goal line, and read from the sideline they're on)
    const n = (k <= 5 ? k : 10 - k) * 10;
    if (!n) continue;
    for (const side of [-1, 1]) {
      x.save();
      x.translate(X(side * (HW - 3.6)), Z(z));
      x.rotate(side * Math.PI * 0.5);
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.font = `900 ${Math.round(1.7 * sx)}px "Lilita One", "Arial Black", sans-serif`;
      x.fillText(String(n), 0, 0);
      x.restore();
    }
  }
  // hash marks every yard, in two rows
  x.lineWidth = 4;
  for (let k = 1; k < 50; k++) {
    if (k % 5 === 0) continue;
    const z = -play + (k * play * 2) / 50;
    for (const u of [-HW * 0.32, HW * 0.32, -HW + 1.1, HW - 1.9]) {
      x.beginPath();
      x.moveTo(X(u), Z(z));
      x.lineTo(X(u + 0.8), Z(z));
      x.stroke();
    }
  }
  // the middle: a ball on a badge
  x.beginPath();
  x.fillStyle = 'rgba(255,255,255,0.9)';
  x.arc(512, Z(0), 3.2 * sx, 0, 7);
  x.fill();
  x.fillStyle = '#8a4a1c';
  x.beginPath();
  x.ellipse(512, Z(0), 2.2 * sx, 1.3 * sx, 0, 0, 7);
  x.fill();
  x.strokeStyle = '#ffffff';
  x.lineWidth = 6;
  x.beginPath();
  x.moveTo(512 - 1.1 * sx, Z(0));
  x.lineTo(512 + 1.1 * sx, Z(0));
  for (let k = -2; k <= 2; k++) {
    x.moveTo(512 + k * 0.42 * sx, Z(0) - 0.35 * sx);
    x.lineTo(512 + k * 0.42 * sx, Z(0) + 0.35 * sx);
  }
  x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** a football: brown leather, a white band at each end, the laces down one side */
export function bowlBallArt() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = '#9a5424';
  x.fillRect(0, 0, 512, 256);
  for (let k = 0; k < 900; k++) {
    x.fillStyle = k % 2 ? 'rgba(60,24,6,0.12)' : 'rgba(255,200,150,0.07)';
    x.fillRect(Math.random() * 512, Math.random() * 256, 3, 3);
  }
  // (u runs round the ball's long axis, v from tip to tip: the bands are near the tips)
  x.fillStyle = '#ffffff';
  x.fillRect(0, 34, 512, 16);
  x.fillRect(0, 206, 512, 16);
  x.fillRect(248, 84, 16, 88);
  for (let k = 0; k < 6; k++) x.fillRect(232, 90 + k * 15, 48, 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function pitchArt(C: CupCfg) {
  if (C.rule === 'bowl') return gridironArt(C);
  const { HW, HL, goalHalf } = C;
  const fence = C.rule === 'fence' || C.rule === 'volley';
  const hoops = C.rule === 'hoops';
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1536;
  const x = c.getContext('2d')!;
  const sx = 1024 / (HW * 2), sz = 1536 / (HL * 2);
  const X = (u: number) => (u + HW) * sx, Z = (v: number) => (v + HL) * sz;
  if (hoops) {
    // a wooden court: boards running its length
    for (let k = 0; k < 34; k++) {
      x.fillStyle = ['#e9b572', '#e2a964', '#edbc7c', '#dfa55e'][(k * 7) % 4];
      x.fillRect((k * 1024) / 34, 0, 1024 / 34 + 1, 1536);
    }
    x.strokeStyle = 'rgba(120,70,20,0.16)';
    x.lineWidth = 2;
    for (let k = 0; k < 34; k++) {
      x.beginPath();
      x.moveTo((k * 1024) / 34, 0);
      x.lineTo((k * 1024) / 34, 1536);
      x.stroke();
    }
  } else
    for (let k = 0; k < 16; k++) {
      x.fillStyle = k % 2 ? '#39c45e' : '#2fb352';
      x.fillRect(0, (k * 1536) / 16, 1024, 1536 / 16 + 1);
    }
  // each end in its team's colour
  const end = (z0: number, z1: number, col: string) => {
    const g = x.createLinearGradient(0, Z(z0), 0, Z(z1));
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, Math.min(Z(z0), Z(z1)), 1024, Math.abs(Z(z1) - Z(z0)));
  };
  // (Over the Fence: each yard is its team's; Big Push: a fat end zone each)
  const deep = fence ? HL : C.rule === 'push' ? 14 : hoops ? 9 : 20;
  end(-HL, -HL + deep, 'rgba(255,79,154,0.55)');
  end(HL, HL - deep, 'rgba(47,155,255,0.55)');
  x.strokeStyle = '#fffdf2';
  x.lineWidth = 9;
  x.strokeRect(X(-HW + 0.7), Z(-HL + 0.7), (HW * 2 - 1.4) * sx, (HL * 2 - 1.4) * sz);
  x.beginPath();
  x.moveTo(0, Z(0));
  x.lineTo(1024, Z(0));
  x.stroke();
  if (fence) {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }
  x.beginPath();
  x.arc(X(0), Z(0), (hoops ? 5 : 8) * sx, 0, 7);
  x.stroke();
  x.fillStyle = '#fffdf2';
  x.beginPath();
  x.arc(X(0), Z(0), 12, 0, 7);
  x.fill();
  if (hoops) {
    // each end: the arc a three is shot from outside of, the key under the hoop, and a ring where the hoop hangs
    for (const s of [-1, 1]) {
      const hz = s * (HL - C.hoopIn);
      x.beginPath();
      x.ellipse(X(0), Z(hz), C.three * sx, C.three * sz, 0, s < 0 ? 0 : Math.PI, s < 0 ? Math.PI : Math.PI * 2);
      x.stroke();
      x.fillStyle = s < 0 ? 'rgba(255,79,154,0.5)' : 'rgba(47,155,255,0.5)';
      x.fillRect(X(-4.5), Z(s < 0 ? -HL : HL - 9), 9 * sx, 9 * sz);
      x.strokeRect(X(-4.5), Z(s < 0 ? -HL : HL - 9), 9 * sx, 9 * sz);
      x.beginPath();
      x.ellipse(X(0), Z(hz), C.hoopR * sx, C.hoopR * sz, 0, 0, 7);
      x.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }
  if (C.rule === 'push') {
    // the two lines to get it over, fat and checked
    for (const s of [-1, 1]) {
      for (let k = 0; k < 16; k++) {
        x.fillStyle = k % 2 ? '#ffffff' : '#1d1d2b';
        x.fillRect((k * 1024) / 16, Z(s * HL) - (s < 0 ? 0 : 24), 1024 / 16 + 1, 24);
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }
  for (const s of [-1, 1]) {
    const w = goalHalf + 5, d = 11;
    x.strokeRect(X(-w), Z(s < 0 ? -HL : HL - d), w * 2 * sx, d * sz);
    x.beginPath();
    x.arc(X(0), Z(s * (HL - d)), 5 * sx, s < 0 ? 0 : Math.PI, s < 0 ? Math.PI : Math.PI * 2);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function netArt() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  x.strokeStyle = 'rgba(255,255,255,0.92)';
  x.lineWidth = 7;
  x.beginPath();
  x.moveTo(64, 0);
  x.lineTo(128, 64);
  x.lineTo(64, 128);
  x.lineTo(0, 64);
  x.closePath();
  x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export function cupBallArt() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const x = c.getContext('2d')!;
  x.fillStyle = '#fffaf0';
  x.fillRect(0, 0, 1024, 512);
  // fat stars in the two teams' colours, and a gold band: easy to see it turning
  const star = (px: number, py: number, r: number, col: string) => {
    x.fillStyle = col;
    x.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 - Math.PI / 2, q = k % 2 ? r * 0.5 : r;
      x.lineTo(px + Math.cos(a) * q, py + Math.sin(a) * q);
    }
    x.closePath();
    x.fill();
  };
  for (let k = 0; k < 6; k++) {
    star(k * 171 + 60, 130, 62, k % 2 ? '#2f9bff' : '#ff4f9a');
    star(k * 171 + 145, 382, 62, k % 2 ? '#ff4f9a' : '#2f9bff');
  }
  x.fillStyle = '#ffc21f';
  x.fillRect(0, 238, 1024, 36);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Big Push's ball: a giant beach ball, six gores round it */
export function pushBallArt() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const x = c.getContext('2d')!;
  const cols = ['#ff4f9a', '#fffaf0', '#2f9bff', '#ffc21f', '#fffaf0', '#37c25a'];
  for (let k = 0; k < 6; k++) {
    x.fillStyle = cols[k];
    x.fillRect((k * 1024) / 6, 0, 1024 / 6 + 1, 512);
  }
  x.fillStyle = '#fffaf0';
  x.fillRect(0, 0, 1024, 40);
  x.fillRect(0, 472, 1024, 40);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
/** Over the Fence's balls: bright yellow, a white seam round them */
export function fenceBallArt() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = '#d8f53a';
  x.fillRect(0, 0, 512, 256);
  x.strokeStyle = '#ffffff';
  x.lineWidth = 16;
  x.beginPath();
  for (let i = 0; i <= 64; i++) {
    const u = (i / 64) * 512, v = 128 + Math.sin((i / 64) * Math.PI * 4) * 60;
    if (i) x.lineTo(u, v);
    else x.moveTo(u, v);
  }
  x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Volley Folly's ball: a beach ball in fat swirls, easy to follow against the sky */
export function volleyBallArt() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const x = c.getContext('2d')!;
  const cols = ['#ff4f9a', '#fffaf0', '#2f9bff', '#fffaf0', '#ffc21f', '#fffaf0'];
  for (let k = 0; k < 12; k++) {
    x.fillStyle = cols[k % 6];
    x.beginPath();
    x.moveTo((k * 1024) / 12 - 90, 0);
    x.lineTo(((k + 1) * 1024) / 12 - 90, 0);
    x.lineTo(((k + 1) * 1024) / 12 + 90, 512);
    x.lineTo((k * 1024) / 12 + 90, 512);
    x.closePath();
    x.fill();
  }
  x.fillStyle = '#ff4f9a';
  x.fillRect(0, 0, 90, 512);
  x.fillStyle = '#fffaf0';
  x.fillRect(0, 0, 1024, 30);
  x.fillRect(0, 482, 1024, 30);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Bean Hoops' ball: orange, with the black seams */
export function hoopBallArt() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const x = c.getContext('2d')!;
  x.fillStyle = '#f07a1c';
  x.fillRect(0, 0, 1024, 512);
  x.strokeStyle = '#2a1608';
  x.lineWidth = 14;
  x.beginPath();
  x.moveTo(0, 256);
  x.lineTo(1024, 256);
  for (const u of [0, 512, 1024]) {
    x.moveTo(u, 0);
    x.lineTo(u, 512);
  }
  for (const u of [256, 768])
    for (let i = 0; i <= 48; i++) {
      const v = (i / 48) * 512, w = u + Math.sin((i / 48) * Math.PI) * 120 * (u < 512 ? 1 : -1);
      if (i) x.lineTo(w, v);
      else x.moveTo(w, v);
    }
  x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function beanCup(info: { name: string; blurb: string }, rule: CupRule = 'cup'): Course {
  const b = new CourseBuilder();
  const center = new THREE.Vector3(0, 118, 0);
  const C = CUP_CFG[rule];
  const { HW, HL, cut, goalHalf: gh, goalH, goalD, ceil } = C;
  const fence = rule === 'fence' || rule === 'volley';
  const y0 = center.y;
  b.lakeY = y0 - 30;
  const state = { go: 1e9 };

  // ---- the pitch
  {
    const g = new THREE.BoxGeometry(HW * 2 + 4, 1, (HL + goalD) * 2 + 4).translate(center.x, y0 - 0.5, center.z);
    b.world.statics.addGeometry(g, Mat.Felt);
    const art = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, HL * 2).rotateX(-Math.PI / 2).translate(center.x, y0 + 0.01, center.z), new THREE.MeshStandardMaterial({ map: pitchArt(C), roughness: 0.82 }));
    art.receiveShadow = true;
    b.group.add(art);
    const base = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 + 5, 3, (HL + goalD) * 2 + 5).translate(center.x, y0 - 1.52, center.z), new THREE.MeshPhysicalMaterial({ color: 0x2a6ae0, roughness: 0.4, clearcoat: 0.7 }));
    base.receiveShadow = true;
    b.group.add(base);
    const keel = new THREE.Mesh(new THREE.CylinderGeometry(HL * 0.8, 6, 18, 8).scale(0.72, 1, 1.05).translate(center.x, y0 - 12, center.z), new THREE.MeshPhysicalMaterial({ color: 0x2452b8, roughness: 0.55 }));
    b.group.add(keel);
  }

  // ---- the walls: the same outline for beans and for the ball
  const segs: CupArena['segs'] = [];
  const pad = [new THREE.MeshPhysicalMaterial({ color: CUP_COLORS[0], roughness: 0.3, clearcoat: 1 }), new THREE.MeshPhysicalMaterial({ color: CUP_COLORS[1], roughness: 0.3, clearcoat: 1 })];
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xd8f2ff, transparent: true, opacity: 0.1, roughness: 0.1, depthWrite: false, side: THREE.DoubleSide });
  const topLine = glowMat(0xfff4c0, 1.6);
  const wall = (x0: number, z0: number, x1: number, z1: number, o: { ball?: boolean; h?: number; low?: number; pad?: boolean } = {}) => {
    const len = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(-(z1 - z0), x1 - x0);
    if (len < 0.05) return;
    const mx = center.x + (x0 + x1) / 2, mz = center.z + (z0 + z1) / 2;
    const low = o.low ?? 0, h = (o.h ?? ceil + 1) - low;
    b.world.statics.addGeometry(new THREE.BoxGeometry(len + 0.5, h, 0.5).rotateY(a).translate(mx, y0 + low + h / 2, mz), Mat.Bumper);
    if (o.ball !== false) segs.push([center.x + x0, center.z + z0, center.x + x1, center.z + z1]);
    if (o.pad !== false) {
      const col = (z0 + z1) / 2 < 0 ? 0 : 1;
      const tube = new THREE.Mesh(new THREE.CapsuleGeometry(0.75, len, 8, 16).rotateZ(Math.PI / 2).rotateY(a).translate(mx, y0 + 0.7, mz), pad[col]);
      tube.castShadow = true;
      b.group.add(tube);
    }
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(len, h).rotateY(a).translate(mx, y0 + low + h / 2, mz), glass);
    b.group.add(pane);
    const top = new THREE.Mesh(new THREE.BoxGeometry(len + 0.3, 0.16, 0.16).rotateY(a).translate(mx, y0 + low + h, mz), topLine);
    b.group.add(top);
  };
  for (const s of [-1, 1]) {
    // the long sides, the cut corners, and each end up to the goal
    wall(s * HW, -HL + cut, s * HW, HL - cut);
    wall(s * HW, HL - cut, s * (HW - cut), HL);
    wall(s * HW, -HL + cut, s * (HW - cut), -HL);
    wall(s * (HW - cut), HL, s * gh, HL);
    wall(s * (HW - cut), -HL, s * gh, -HL);
  }

  // ---- Over the Fence: the fence down the middle. A low net the ball has to clear, and above it
  // glass all the way up for the beans (nobody climbs over into their yard)
  if (fence) {
    b.world.statics.addGeometry(new THREE.BoxGeometry(HW * 2, ceil + 1, 0.5).translate(center.x, y0 + (ceil + 1) / 2, center.z), Mat.Bumper);
    const net = netArt();
    net.repeat.set((HW * 2) / 1.1, C.fenceH / 1.1);
    const fenceMat = new THREE.MeshBasicMaterial({ map: net, transparent: true, side: THREE.DoubleSide, depthWrite: false, color: 0xffffff });
    b.group.add(new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, C.fenceH).translate(center.x, y0 + C.fenceH / 2, center.z), fenceMat));
    const rail = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, HW * 2, 6, 12).rotateZ(Math.PI / 2).translate(center.x, y0 + C.fenceH, center.z), new THREE.MeshPhysicalMaterial({ color: 0xffc21f, roughness: 0.3, clearcoat: 1 }));
    rail.castShadow = true;
    b.group.add(rail);
    const postM = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.3, clearcoat: 1 });
    for (let k = -3; k <= 3; k++) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, C.fenceH, 12).translate(center.x + (k / 3) * (HW - 0.4), y0 + C.fenceH / 2, center.z), postM);
      p.castShadow = true;
      b.group.add(p);
    }
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, ceil + 1 - C.fenceH).translate(center.x, y0 + C.fenceH + (ceil + 1 - C.fenceH) / 2, center.z), glass);
    b.group.add(pane);
    b.group.add(new THREE.Mesh(new THREE.BoxGeometry(HW * 2, 0.12, 0.12).translate(center.x, y0 + ceil + 1, center.z), topLine));
  }

  // ---- the goals
  const nets: THREE.Group[] = [];
  const see: THREE.Material[][] = [[], []];
  const hit = [-9, -9];
  const netTex = netArt();
  for (const team of gh > 0 ? [0, 1] : []) {
    // (team 0 defends the -z end)
    const s = team === 0 ? -1 : 1;
    const z = s * HL, zb = s * (HL + goalD);
    // over the bar is still a wall; inside, the sides, the back and the roof hold the ball
    wall(-gh, z, gh, z, { low: goalH, pad: false, ball: false });
    wall(-gh, z, -gh, zb, { h: goalH, pad: false });
    wall(gh, z, gh, zb, { h: goalH, pad: false });
    wall(-gh, zb, gh, zb, { h: goalH, pad: false });
    b.world.statics.addGeometry(new THREE.BoxGeometry(gh * 2 + 0.5, 0.4, goalD).translate(center.x, y0 + goalH + 0.2, center.z + s * (HL + goalD / 2)), Mat.Bumper);
    const frame = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.25, clearcoat: 1, transparent: true });
    see[team].push(frame);
    const trim = glowMat(CUP_COLORS[team], 2);
    const g = new THREE.Group();
    g.position.set(center.x, y0, center.z + z);
    for (const px of [-gh, gh]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, goalH, 16).translate(px, goalH / 2, 0), frame);
      post.castShadow = true;
      g.add(post);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, gh * 2 + 0.68, 16).rotateZ(Math.PI / 2).translate(0, goalH, 0), frame);
    bar.castShadow = true;
    g.add(bar);
    g.add(new THREE.Mesh(new THREE.BoxGeometry(gh * 2, 0.1, 0.4).translate(0, 0.05, 0), trim));
    b.group.add(g);
    const net = new THREE.Group();
    net.position.copy(g.position);
    const nm = (w: number, h: number) => {
      const t = netTex.clone();
      t.repeat.set(w / 1.4, h / 1.4);
      t.needsUpdate = true;
      const q = new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide, depthWrite: false, color: 0xffffff });
      see[team].push(q);
      return q;
    };
    const back = new THREE.Mesh(new THREE.PlaneGeometry(gh * 2, goalH).translate(0, goalH / 2, s * goalD), nm(gh * 2, goalH));
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(gh * 2, goalD).rotateX(Math.PI / 2).translate(0, goalH, (s * goalD) / 2), nm(gh * 2, goalD));
    net.add(back, roof);
    for (const px of [-gh, gh]) net.add(new THREE.Mesh(new THREE.PlaneGeometry(goalD, goalH).rotateY(Math.PI / 2).translate(px, goalH / 2, (s * goalD) / 2), nm(goalD, goalH)));
    b.group.add(net);
    nets.push(net);
    // a hot strip of the team's colour inside the goal
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(gh * 2, goalD).rotateX(-Math.PI / 2).translate(center.x, y0 + 0.03, center.z + s * (HL + goalD / 2)), new THREE.MeshBasicMaterial({ color: CUP_COLORS[team], transparent: true, opacity: 0.4, toneMapped: false }));
    b.group.add(glow);
  }

  // ---- Bean Hoops: a hoop high at each end, on a backboard on the end wall (the wall is the board:
  // a shot can come in off it). The +z one is what team 0 shoots at
  const hoops: THREE.Vector3[] = [];
  if (rule === 'hoops') {
    const rimM = new THREE.MeshPhysicalMaterial({ color: 0xff5a1f, roughness: 0.3, clearcoat: 1, emissive: 0xff3a00, emissiveIntensity: 0.35 });
    const cord = netArt();
    cord.repeat.set(9, 2);
    for (const team of [0, 1]) {
      const s = team === 0 ? 1 : -1, at = new THREE.Vector3(center.x, y0 + C.hoopY, center.z + s * (HL - C.hoopIn));
      hoops.push(at);
      // (in the colour of the side defending it)
      const col = CUP_COLORS[team === 0 ? 1 : 0];
      // (a camera at this end sees through the board and the net: they fade as it comes near, like a goal's)
      const boardM = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.25, clearcoat: 1, transparent: true, opacity: 0.86 });
      const netM = new THREE.MeshBasicMaterial({ map: cord, transparent: true, side: THREE.DoubleSide, depthWrite: false, color: 0xffffff });
      see[s > 0 ? 1 : 0].push(boardM, netM);
      const g = new THREE.Group();
      g.position.copy(at);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(C.hoopR, 0.16, 12, 56).rotateX(Math.PI / 2), rimM);
      rim.castShadow = true;
      g.add(rim);
      const net = new THREE.Mesh(new THREE.CylinderGeometry(C.hoopR, C.hoopR * 0.62, 2.4, 28, 1, true).translate(0, -1.2, 0), netM);
      g.add(net);
      const back = s * (C.hoopIn - 0.4);
      const board = new THREE.Mesh(new THREE.BoxGeometry(8.4, 5.6, 0.3).translate(0, 2, back), boardM);
      board.castShadow = true;
      g.add(board);
      g.add(new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.3, 0.36).translate(0, 4.8, back), glowMat(col, 1.6)));
      g.add(new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.3, 0.36).translate(0, -0.8, back), glowMat(col, 1.6)));
      for (const px of [-4.2, 4.2]) g.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 5.9, 0.36).translate(px, 2, back), glowMat(col, 1.6)));
      // the square over the rim, and the arm it hangs from
      for (const [w, h, px, py] of [[3.4, 0.2, 0, 2.6], [3.4, 0.2, 0, 0.3], [0.2, 2.5, -1.7, 1.45], [0.2, 2.5, 1.7, 1.45]]) g.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.1).translate(px, py, back - s * 0.18), glowMat(col, 1.2)));
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, C.hoopIn - C.hoopR - 0.4).translate(0, -0.05, s * (C.hoopR + (C.hoopIn - C.hoopR - 0.4) / 2)), rimM));
      b.group.add(g);
    }
  }

  // ---- the two big bumpers on the halfway line: a wall that throws it back
  const rounds: CupArena['rounds'] = [];
  for (const s of fence || rule === 'hoops' || rule === 'bowl' ? [] : [-1, 1]) {
    const px = center.x + s * (HW + 0.2), pz = center.z, r = 2.6, H = 2.2;
    rounds.push({ x: px, z: pz, r, kick: 6 });
    const k = new Kin({ type: 'cyl', r, hh: H / 2 }, Mat.Bumper, (_t, p, q) => {
      p.set(px, y0 + H / 2, pz);
      q.identity();
    });
    k.kick = 7;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.2, H, 36), new THREE.MeshPhysicalMaterial({ color: 0xffc21f, roughness: 0.25, clearcoat: 1 })));
    const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 30, 12, 0, 6.3, 0, 1.57).scale(1, 0.42, 1).translate(0, H / 2, 0), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.2, clearcoat: 1 }));
    g.add(cap);
    b.obstacle(k, g, false);
    b.animators.push((t) => {
      const f = Math.max(0, 1 - (t - k.lastHit) * 5);
      g.scale.set(1 + f * 0.16, 1 - f * 0.12, 1 + f * 0.16);
    });
  }

  // ---- Bean Bowl: the uprights behind each end zone, and an orange pylon on each of its corners
  if (rule === 'bowl') {
    const gold = new THREE.MeshPhysicalMaterial({ color: 0xffd21f, roughness: 0.25, clearcoat: 1, emissive: 0x6a4a00, emissiveIntensity: 0.35 });
    const cone = new THREE.MeshPhysicalMaterial({ color: 0xff6a1f, roughness: 0.4, clearcoat: 0.6, emissive: 0x802a00, emissiveIntensity: 0.3 });
    for (const s of [-1, 1]) {
      const z = center.z + s * (HL + 1.6);
      const g = new THREE.Group();
      g.position.set(center.x, y0, z);
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 4.6, 14).translate(0, 2.3, 0), gold));
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 9, 12).rotateZ(Math.PI / 2).translate(0, 4.6, 0), gold));
      for (const px of [-4.5, 4.5]) g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 8.5, 12).translate(px, 8.85, 0), gold));
      g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      b.group.add(g);
      for (const px of [-1, 1])
        for (const pz of [HL - 0.8, HL - C.endZone])
          b.group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.34, 1.1, 10).translate(center.x + px * (HW - 0.9), y0 + 0.55, center.z + s * pz), cone));
    }
  }

  // ---- floodlights on the corners
  {
    const pole = new THREE.MeshPhysicalMaterial({ color: 0xeaf0ff, roughness: 0.35, clearcoat: 0.8 });
    const lamp = glowMat(0xfff6d0, 2.8);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = center.x + sx * (HW + 3.5), z = center.z + sz * (HL + 2);
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.5, 21, 12).translate(x, y0 + 10, z), pole);
        p.castShadow = true;
        const head = new THREE.Mesh(new THREE.BoxGeometry(5, 2.4, 0.6), lamp);
        head.position.set(x, y0 + 21, z);
        head.lookAt(center.x, y0, center.z);
        b.group.add(p, head);
      }
  }

  const balls: CupBall[] = Array.from({ length: C.balls }, () => ({ pos: new THREE.Vector3(center.x, y0 + C.R, center.z), vel: new THREE.Vector3(), quat: new THREE.Quaternion(), live: false, backAt: 0, last: -1, prev: -1, kickT: -9, by: [-1, -1] as [number, number], byT: [-99, -99] as [number, number], worth: 2, py: 0, held: -1, thrower: -1, passT: -9, inAir: false, fumbler: -1, dropT: -9, gripT: 0 }));
  b.animators.push((t) => {
    nets.forEach((n, i) => {
      const f = Math.max(0, 1 - (t - hit[i]) * 1.4);
      const s = i === 0 ? -1 : 1;
      n.scale.z = 1 + Math.sin((t - hit[i]) * 18) * f * 0.09;
      n.position.z = center.z + s * HL;
    });
  });
  const arena: CupArena = {
    center,
    cfg: C,
    of: new Map(),
    balls,
    segs,
    rounds,
    shake(team, t) {
      hit[team] = t;
    },
    view(cam) {
      see.forEach((list, i) => {
        const past = ((i === 0 ? -1 : 1) * (cam.z - center.z) - (HL - 7)) / 5;
        const o = 1 - 0.9 * THREE.MathUtils.clamp(past, 0, 1);
        for (const m of list) m.opacity = o;
      });
    },
    goal(team, o) {
      return o.set(center.x, y0, center.z + (team === 0 ? 1 : -1) * (HL - C.hoopIn));
    },
    hoops,
  };
  title(b, info, rule === 'cup' ? 'Most goals stays in the show' : rule === 'push' ? 'Push it over their line' : rule === 'volley' ? 'Never let it land' : rule === 'hoops' ? 'Most points stays in the show' : rule === 'bowl' ? 'Touchdowns win it' : 'Keep your yard clear', 0xff4f9a, new THREE.Vector3(center.x, y0 + 15, center.z - HL - goalD - 3));
  dressArena(b, new THREE.Vector3(center.x, y0 - 3, center.z), HL + 10, 29);
  b.finish();
  return {
    id: rule === 'cup' ? 'beancup' : rule === 'push' ? 'bigpush' : rule === 'volley' ? 'volleyfolly' : rule === 'hoops' ? 'beanhoops' : rule === 'bowl' ? 'beanbowl' : 'overfence',
    name: info.name,
    kind: 'team',
    blurb: info.blurb,
    b,
    path: null,
    finishS: 0,
    gaps: [],
    checkpoints: [],
    killY: y0 - 8,
    lakeY: b.lakeY,
    state,
    // (even places on the pink end, odd on the blue: everyone in their own half, facing the ball)
    grid: (n) => {
      const out: { pos: THREE.Vector3; yaw: number }[] = [];
      for (let k = 0; k < n; k++) {
        const s = k % 2 ? 1 : -1, i = Math.floor(k / 2), col = i % 6, row = Math.floor(i / 6);
        const near = rule === 'push' ? 9 : fence ? 7 : rule === 'hoops' ? 8 : rule === 'bowl' ? 7 : 11;
        const pos = new THREE.Vector3(center.x + (col - 2.5) * (fence ? 5.6 : rule === 'hoops' ? 5 : rule === 'bowl' ? 4.7 : 6.2) + row * 2.4, y0 + 0.6, center.z + s * (near + row * (fence ? 6 : 7)));
        out.push({ pos, yaw: s > 0 ? Math.PI : 0 });
      }
      return out;
    },
    plate: { center, radius: HW, bars: [] },
    cup: arena,
    intro: [],
  };
}
