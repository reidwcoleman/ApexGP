// A simulated keyboard player: binary keys, ~0.12 s reaction delay, imperfect
// braking points. Drives laps through PlayerControl → CarPhysics on the real
// circuit for each assist preset and reports how controllable it is.
//   node tools/kbbot.mjs [laps]
//   GAME=1   — the game's own presets (Assists.ts: Casual / Standard / Expert, arcade handling included)
//   PAD=1    — an analog pad instead of keys (proportional stick, direct steering, as the game does for pads)
//   TRACK=id — another circuit (default Monza); WET=0.6 — water on the track (0 … 1) on the tyre type the conditions call for
import { Track } from '../src/world/Track.ts';
import { ASSIST_PRESETS } from '../src/game/Assists.ts';
import { CIRCUITS } from '../src/world/Circuits.ts';
import { CarPhysics, F1_SPEC } from '../src/sim/CarPhysics.ts';
import { RacingProfile } from '../src/sim/RacingProfile.ts';
import { PlayerControl } from '../src/sim/PlayerControl.ts';

const LAPS = Number(process.argv[2] ?? 2);
const track = new Track(process.env.TRACK ? CIRCUITS.find((c) => c.id === process.env.TRACK) : CIRCUITS[0]);
const PAD = !!process.env.PAD;
const WET = Number(process.env.WET ?? 0);
const profile = new RacingProfile(track, F1_SPEC);
const DT = 1 / 300;

const base = { assists: { traction: 'full', abs: true, stability: true, autoGear: true }, aids: { brakingAssist: 'medium', steeringMode: 'rate' } };
const variant = (a, b) => ({ assists: { ...base.assists, ...a }, aids: { ...base.aids, ...b } });
const fromGame = (g) => ({ assists: { traction: g.traction, abs: g.abs, stability: g.stability, autoGear: true, arcade: g.arcade }, aids: { brakingAssist: g.braking, steeringMode: PAD ? 'direct' : g.keyboard } });
const PRESETS = process.env.GAME ? Object.fromEntries(Object.entries(ASSIST_PRESETS).map(([k, g]) => [k, fromGame(g)])) : process.env.MATRIX ? {
  casual: base,
  noSteerAssist: variant({}, {}),
  noStability: variant({ stability: false }, {}),
  noBrakeAssist: variant({}, { brakingAssist: 'off' }),
  tcMedium: variant({ traction: 'medium' }, {}),
  noSA_noBA: variant({}, { brakingAssist: 'off' }),
} : {
  casual: base,
  standard: { assists: { traction: 'medium', abs: true, stability: false, autoGear: true }, aids: { brakingAssist: 'off', steeringMode: 'rate' } },
  pro: { assists: { traction: 'off', abs: false, stability: false, autoGear: true }, aids: { brakingAssist: 'off', steeringMode: 'rate' } },
};

const cornerOf = (s) => { let b = track.corners[0], bd = 1e9; for (const c of track.corners) { const d = Math.abs(track.delta(c.sApex, s)); if (d < bd) { bd = d; b = c; } } return b.name; };
function run(name, preset, seed) {
  let rnd = seed;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  const car = new CarPhysics(F1_SPEC);
  const s0 = track.startS - 300;
  car.placeOnTrack(track, s0, track.racingLineAt(s0));
  car.setSpeed(45);
  car.gear = 5;
  car.assists = { ...preset.assists };
  if (WET > 0) {
    // a uniform wet track (no drier line) and the tyre the conditions call for
    car.weather = { wetnessAt: () => WET, state: { airTemp: 18, trackTemp: 20 } };
    car.tyreType = WET > 0.72 ? 2 : WET > 0.2 ? 1 : 0;
  }
  const pc = new PlayerControl();
  pc.aids = { ...preset.aids };
  const raw = { steer: 0, throttle: 0, brake: 0, usingPad: PAD, ers: false, shiftUp: false, shiftDown: false };
  const queue = [];
  let t = 0, laps = 0, lastLd = track.lapDistance(car.s), lapStart = 0;
  const times = [];
  let offs = 0, wasOff = false, walls = 0, spins = 0, spinning = false, maxBeta = 0, keyFlips = 0, lastKey = 0;
  let decisionT = 0;
  const hist = [];
  let brakeMargin = 1;
  const where = {}, whereOff = {};
  let wallTraced = false;
  while (times.length < LAPS && t < LAPS * 140 + 20) {
    // human decisions every ~50 ms, applied after a reaction delay
    decisionT -= DT;
    if (decisionT <= 0) {
      decisionT = 0.05;
      const v = Math.max(0, car.vx);
      const look = 10 + v * 0.55;
      const lat = track.racingLineAt(car.s + look);
      const p = track.point(car.s + look, lat);
      const dx = p.x - car.x, dz = p.z - car.z;
      const sy = Math.sin(car.yaw), cy = Math.cos(car.yaw);
      const fwd = dx * sy + dz * cy;
      const lft = dx * cy - dz * sy;
      // the yaw rate that would carry the car onto the target point (pure pursuit)
      const kappa = (2 * lft) / Math.max(25, fwd * fwd + lft * lft);
      const want = kappa * v;
      const err = want - car.r; // + → should be turning more to the left
      const dead = 0.025 + 0.02 * rand();
      // a pad: the stick goes proportionally (a thumb isn't precise: a little noise on it)
      const padLimit = Math.min(car.spec.maxSteer, Math.max(0.3, car.gripSteerLimit(v) * 1.75));
      const key = PAD ? Math.max(-1, Math.min(1, (Math.atan(((car.spec.a + car.spec.b) * want) / Math.max(v, 5)) * 1.2 + err * 0.08) / padLimit + (rand() - 0.5) * 0.06)) : err > dead ? 1 : err < -dead ? -1 : 0;
      if (Math.sign(key) !== Math.sign(lastKey)) keyFlips++;
      lastKey = key;
      if (rand() < 0.02) brakeMargin = (process.env.MARGIN ? Number(process.env.MARGIN) : 0.93) + rand() * 0.05;
      const vt = Math.min(profile.atGrip(car.s + v * 0.2, car.gripFactor), profile.atGrip(car.s + v * 0.45, car.gripFactor)) * brakeMargin;
      const brake = v > vt + 1 ? 1 : 0;
      // lift when the rear steps out (a human reacts to the slide)
      const sliding = Math.abs(Math.atan2(car.vy, Math.max(3, car.vx))) > 0.09;
      const throttle = brake || sliding ? 0 : v < vt - 1 ? 1 : 0.0;
      queue.push({ at: t + 0.1 + rand() * 0.06, key, brake, throttle });
    }
    while (queue.length && queue[0].at <= t) {
      const q = queue.shift();
      raw.steer = q.key;
      raw.brake = q.brake;
      raw.throttle = q.throttle;
    }
    const inp = pc.update(DT, raw, car, track, profile);
    car.step(DT, inp, track, false);
    t += DT;
    if (car.contact.wallHit > 1 && process.env.WALLTRACE && !wallTraced) { wallTraced = true; console.log('  WALL at', cornerOf(car.s), 's', car.s.toFixed(0), 'lat', car.lateral.toFixed(1)); for (const h of hist) console.log('     ', h.join(' ')); }
    if (car.contact.wallHit > 1) { walls++; if (process.env.WHERE) where[cornerOf(car.s)] = (where[cornerOf(car.s)] ?? 0) + 1; }
    if (car.offTrack && !wasOff) { offs++; if (process.env.WHERE) whereOff[cornerOf(car.s)] = (whereOff[cornerOf(car.s)] ?? 0) + 1; }
    wasOff = car.offTrack;
    const beta = Math.abs(Math.atan2(car.vy, Math.max(1, Math.abs(car.vx))));
    maxBeta = Math.max(maxBeta, beta);
    if (beta > 0.6 && !spinning) { spins++; if (process.env.TRACE && name === process.env.TRACE) { console.log('  spin at s', car.s.toFixed(0)); for (const h of hist) console.log('     ', h.join(' ')); } }
    if (Math.round(t / DT) % 15 === 0) hist.push(['s' + car.s.toFixed(0), 'lat' + car.lateral.toFixed(1), 'rl' + track.racingLineAt(car.s).toFixed(1), (car.vx * 3.6).toFixed(0), 'T' + raw.throttle, 'B' + raw.brake, 'S' + raw.steer, 'δ' + inp.steer.toFixed(3), 'β' + (Math.atan2(car.vy, Math.max(1, car.vx)) * 57.3).toFixed(0), 'r' + car.r.toFixed(2), 'sF' + car.slipFront.toFixed(1), 'sR' + car.slipRear.toFixed(1), 'g' + car.gear, car.surface.join('')]);
    if (hist.length > 18) hist.shift();
    spinning = beta > 0.6;
    // recover like a player would after a spin: reset onto the line
    if (spinning && car.speed < 3) {
      car.placeOnTrack(track, car.s, track.racingLineAt(car.s));
      car.setSpeed(15);
      car.gear = 2;
      spinning = false;
    }
    const ld = track.lapDistance(car.s);
    if (ld < 100 && lastLd > track.length - 100) {
      if (laps >= 0 && t > 5) times.push(t - lapStart);
      lapStart = t;
      laps++;
    }
    lastLd = ld;
  }
  if (process.env.WHERE) console.log('   walls', JSON.stringify(where), 'offs', JSON.stringify(whereOff));
  console.log(`${name.padEnd(15)} laps ${times.length}  times ${times.map((x) => x.toFixed(1)).join(' ').padEnd(12)} offTrack ${offs}  wallHits ${walls}  spins ${spins}  max β ${(maxBeta * 57.3).toFixed(0)}°  key flips/s ${(keyFlips / t).toFixed(1)}`);
}

for (const [name, p] of Object.entries(PRESETS)) for (const seed of [7, 99]) run(name, p, seed);
