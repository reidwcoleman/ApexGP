// Headless checks of the control layer (no browser): wheel / pedal mapping and calibration, the
// binding state machine, the pad's 1€ filter against the old fixed low-pass, PlayerControl's wheel
// path, device switching in Input (with a stubbed Gamepad API) and the rumble mix.
//   node tools/controlstest.mjs
import { Binder, DEFAULT_CONTROLS, OneEuro, controlPrefs, isWheelId, padSteer, pedal, wheelSteer, deviceName } from '../src/core/controllers.ts';
import { RumbleMix } from '../src/core/rumble.ts';
import { PlayerControl } from '../src/sim/PlayerControl.ts';
import { CarPhysics, F1_SPEC } from '../src/sim/CarPhysics.ts';
import { RacingProfile } from '../src/sim/RacingProfile.ts';
import { Track } from '../src/world/Track.ts';
import { CIRCUITS } from '../src/world/Circuits.ts';

let fails = 0;
const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;
function check(name, ok, info = '') {
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? `  (${info})` : ''}`);
}
const P = controlPrefs();

// ---- mapping
check('pad: inside the deadzone is 0', padSteer(0.07, P) === 0);
check('pad: full right stick is full right lock', near(padSteer(1, P), -1));
check('pad: half stick, gamma 1.2', near(padSteer(-0.54, P), Math.pow(0.5, 1.2)), padSteer(-0.54, P).toFixed(3));
const cal = { dev: 'w', axis: 0, center: 0, sign: -1 };
check('wheel 900°: 180° right is full lock right', near(wheelSteer(0.4, cal, P), -1));
check('wheel 900°: 90° left is half lock left', near(wheelSteer(-0.2, cal, P), 0.5));
check('wheel 900°: past the car lock clamps', near(wheelSteer(-0.9, cal, P), 1));
check('wheel 270° base stretches over the car lock', near(wheelSteer(-1, cal, { ...P, wheelRotation: 270 }), 1) && near(wheelSteer(-0.5, cal, { ...P, wheelRotation: 270 }), 0.5));
check('wheel off-centre rest scales each side to its end', near(wheelSteer(1, { ...cal, center: 0.2, sign: 1 }, { ...P, wheelRotation: 360 }), 1) && near(wheelSteer(-1, { ...cal, center: 0.2, sign: 1 }, { ...P, wheelRotation: 360 }), -1));
const inv = { dev: 'p', axis: 2, rest: 1, full: -1 };
check('inverted pedal: rest 0, floor 1, half 0.5', pedal(1, inv, 0.03) === 0 && pedal(-1, inv, 0.03) === 1 && near(pedal(0, inv, 0.03), 0.5));
check('pedal deadzone: 2 % travel reads 0, 98 % reads 1', pedal(0.96, inv, 0.03) === 0 && pedal(-0.96, inv, 0.03) === 1);
check('brake gamma 2: half travel → 25 %', near(pedal(0, inv, 0, 2), 0.25));
check('wheel names recognised', ['Logitech G29 Driving Force Racing Wheel (Vendor: 046d Product: c24f)', 'FANATEC CSL Elite Wheel Base', 'MOZA R9 Base (Vendor: 346e Product: 0002)', 'Thrustmaster T300RS Racing wheel'].every(isWheelId) && !isWheelId('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)') && !isWheelId('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'));
check('device name trimmed', deviceName('Logitech G29 Driving Force Racing Wheel (Vendor: 046d Product: c24f)') === 'Logitech G29 Driving Force Racing Wheel');

// ---- binding: a wheel base and a separate pedal set (throttle rests at +1, brake at −1)
{
  const base = { id: 'Logitech G29 Driving Force Racing Wheel', axes: [0.003, 0, 0, 0], buttons: Array.from({ length: 24 }, () => ({ pressed: false })) };
  const peds = { id: 'Heusinkveld Sprint Pedals', axes: [0, -1, 1, 0], buttons: [] };
  const b = new Binder();
  const frame = (f) => { f(); return b.update([base, null, peds]); };
  frame(() => {});
  for (let k = 0; k <= 10; k++) frame(() => (base.axes[0] = -0.04 * k)); // turn left (axis goes −)
  for (let k = 10; k >= 0; k--) frame(() => (base.axes[0] = -0.04 * k));
  check('bind steering: axis 0, left = −axis, centre snapped to 0', b.step === 'throttle' && b.result.steer.axis === 0 && b.result.steer.sign === -1 && b.result.steer.center === 0, JSON.stringify(b.result.steer));
  for (let k = 0; k <= 10; k++) frame(() => (peds.axes[2] = 1 - 0.2 * k));
  check('throttle not bound while held', b.step === 'throttle');
  for (let k = 10; k >= 0; k--) frame(() => (peds.axes[2] = 1 - 0.2 * k));
  check('bind throttle: pedal device axis 2, rest 1 → full −1', b.step === 'brake' && b.result.throttle.dev === peds.id && b.result.throttle.axis === 2 && near(b.result.throttle.rest, 1) && near(b.result.throttle.full, -1), JSON.stringify(b.result.throttle));
  for (let k = 0; k <= 10; k++) frame(() => (peds.axes[1] = -1 + 0.18 * k));
  for (let k = 10; k >= 0; k--) frame(() => (peds.axes[1] = -1 + 0.18 * k));
  check('bind brake: axis 1, rest −1 → full 0.8 (a pedal that never reaches the end)', b.step === 'shiftUp' && b.result.brake.axis === 1 && near(b.result.brake.full, 0.8), JSON.stringify(b.result.brake));
  check('calibrated brake reads 1 at its own floor', near(pedal(0.8, b.result.brake, 0.03), 1));
  frame(() => (base.buttons[4].pressed = true));
  frame(() => (base.buttons[4].pressed = false));
  check('bind paddle up: button 4', b.step === 'shiftDown' && b.result.shiftUp.button === 4);
  frame(() => (base.buttons[4].pressed = true));
  check('the other paddle can\'t reuse it', b.step === 'shiftDown');
  frame(() => (base.buttons[5].pressed = true));
  check('bind paddle down: button 5, done', b.step === 'done' && b.result.shiftDown.button === 5);
  check('binding complete', b.binding() !== null && b.binding().brake.axis === 1);
  const b2 = new Binder();
  check('steering can\'t be skipped', b2.skip() === false && b2.step === 'steer');
}

// ---- the pad filter: step response and tremor, against the old fixed 22/s low-pass
{
  const dt = 1 / 60;
  const run = (filt, input, n) => { const out = []; for (let i = 0; i < n; i++) out.push(filt(input(i))); return out; };
  const lowpass = () => { let u = 0; return (x) => (u += (x - u) * Math.min(1, dt * 22)); };
  // (the same parameters as PlayerControl's pad path)
  const euro = (f, v) => { const e = new OneEuro(); e.filter(0, dt, 1, 1); const hi = Math.min(1, v / 80); return (x) => e.filter(x, dt, (1 - 0.75 * f) * (10 - 6 * hi), 6 * (1.2 - f)); };
  const t90 = (o, target) => o.findIndex((y) => y >= 0.9 * target) * dt * 1000;
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  // a thumb at rest: ~9 Hz physiological tremor plus sensor noise
  const tremor = (i) => 0.012 * Math.sin(i * dt * 2 * Math.PI * 9) + 0.03 * rnd();
  const rms = (o) => Math.sqrt(o.slice(30).reduce((a, y) => a + y * y, 0) / (o.length - 30));
  const stepIn = (i) => (i >= 1 ? 0.6 : 0);
  const old = run(lowpass(), stepIn, 60);
  const oldN = rms(run(lowpass(), tremor, 300));
  console.log(`     old low-pass   step t90 ${t90(old, 0.6).toFixed(0)} ms   tremor rms ${(oldN * 1000).toFixed(1)}e-3`);
  for (const v of [15, 80]) {
    const st = run(euro(DEFAULT_CONTROLS.padFilter, v), stepIn, 60);
    const n = rms(run(euro(DEFAULT_CONTROLS.padFilter, v), tremor, 300));
    console.log(`     1€ @${String(v).padStart(2)} m/s     step t90 ${t90(st, 0.6).toFixed(0)} ms   tremor rms ${(n * 1000).toFixed(1)}e-3`);
    check(`1€ at ${v} m/s: a flick lands faster than the old filter`, t90(st, 0.6) < t90(old, 0.6));
    if (v === 80) check('1€ at speed: a thumb\'s tremor is smoothed at least as well', n <= oldN);
    // a slow, steady turn-in (0 → 0.3 over a second): lag behind the stick after 1 s
    const ramp = (i) => Math.min(0.3, i * dt * 0.3);
    const lag = (o) => ((0.3 * (59 * dt) - o[59]) / 0.3) * 1000;
    const lagNew = lag(run(euro(DEFAULT_CONTROLS.padFilter, v), ramp, 61));
    const lagOld = lag(run(lowpass(), ramp, 61));
    if (v === 80) check('1€ at speed: within ~5 ms of the old lag on a slow turn-in', lagNew <= lagOld + 6, `${lagNew.toFixed(0)} vs ${lagOld.toFixed(0)} ms`);
  }
}

// ---- PlayerControl: the wheel is 1:1, the pad's speed sensitivity narrows its range
{
  const track = new Track(CIRCUITS[0]);
  const profile = new RacingProfile(track, F1_SPEC);
  const car = new CarPhysics(F1_SPEC);
  car.placeOnTrack(track, track.startS + 200, 0);
  car.setSpeed(60);
  const pc = new PlayerControl();
  pc.aids = { brakingAssist: 'off', steeringMode: 'direct' };
  const raw = { steer: 0.5, throttle: 0, brake: 0, usingPad: true, device: 'wheel', ers: false, shiftUp: false, shiftDown: false };
  let o;
  for (let i = 0; i < 30; i++) o = pc.update(1 / 60, raw, car, track, profile);
  check('wheel: half lock at 216 km/h is half the car\'s lock', near(o.steer, 0.5 * F1_SPEC.maxSteer, 1e-4), o.steer.toFixed(4));
  raw.steer = -0.5;
  o = pc.update(1 / 60, raw, car, track, profile);
  check('wheel: no 85°/s rack limit (a flick lands in ~2 frames)', o.steer < 0.5 * F1_SPEC.maxSteer - 0.1, o.steer.toFixed(3));
  const padAt = (sens) => {
    const q = new PlayerControl();
    q.aids = { brakingAssist: 'off', steeringMode: 'direct' };
    q.prefs = { ...DEFAULT_CONTROLS, padSpeedSens: sens };
    const r = { ...raw, steer: 1, device: 'pad' };
    let x;
    for (let i = 0; i < 120; i++) x = q.update(1 / 60, r, car, track, profile);
    return x.steer;
  };
  const lo = padAt(0), mid = padAt(0.5), hi = padAt(1);
  check('pad: speed sensitivity 0.5 keeps the old 1.75× peak-grip range', near(mid, Math.min(F1_SPEC.maxSteer, Math.max(0.3, car.gripSteerLimit(car.vx) * 1.75)), 2e-3), `${mid.toFixed(3)} rad`);
  check('pad: more speed sensitivity = less lock at speed', lo > mid && mid > hi, `${lo.toFixed(3)} > ${mid.toFixed(3)} > ${hi.toFixed(3)}`);
}

// ---- Input: device switching with a stubbed Gamepad API, and the rumble reaching the actuator
{
  globalThis.addEventListener ??= () => {};
  let pads = [];
  Object.defineProperty(globalThis.navigator, 'getGamepads', { value: () => pads, configurable: true });
  const { Input } = await import('../src/core/Input.ts');
  const inp = new Input();
  const effects = [];
  const actuator = { effects: ['dual-rumble', 'trigger-rumble'], playEffect: (t, p) => (effects.push([t, p]), Promise.resolve('complete')), reset: () => (effects.push(['reset']), Promise.resolve('complete')) };
  const btns = (n) => Array.from({ length: n }, () => ({ pressed: false, value: 0 }));
  const xpad = { id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', connected: true, mapping: 'standard', axes: [0.04, 0, 0, 0], buttons: btns(17), vibrationActuator: actuator };
  const wheel = { id: 'Logitech G29 Driving Force Racing Wheel (Vendor: 046d Product: c24f)', connected: true, mapping: '', axes: [0, 0, 1, 0, 0, -1], buttons: btns(24) };
  const pedals = { id: 'Generic USB Joystick', connected: true, mapping: '', axes: [-1, -1, 0, 0], buttons: btns(4) };
  pads = [xpad, wheel];
  inp.update(1 / 60);
  check('idle pad (stick inside the takeover threshold) leaves the keyboard driving', inp.state.device === 'keyboard');
  xpad.axes[0] = 0.6;
  inp.update(1 / 60);
  check('stick pushed: the pad drives', inp.state.device === 'pad' && inp.state.steer < -0.4, inp.state.steer.toFixed(3));
  xpad.axes[0] = 0.02;
  wheel.axes[0] = -0.1;
  inp.update(1 / 60);
  check('unbound recognised wheel steers on axis 0 (45° left = quarter lock)', inp.state.device === 'wheel' && near(inp.state.steer, 0.25), inp.state.steer.toFixed(3));
  inp.setPrefs({ wheel: { name: wheel.id, steer: { dev: wheel.id, axis: 0, center: 0, sign: -1 }, throttle: { dev: wheel.id, axis: 2, rest: 1, full: -1 }, brake: { dev: wheel.id, axis: 5, rest: -1, full: 1 }, shiftUp: { dev: wheel.id, button: 4 } } });
  wheel.axes[2] = -1;
  inp.update(1 / 60);
  check('bound pedals: throttle floored reads 1', near(inp.state.throttle, 1));
  wheel.buttons[4].pressed = true;
  inp.update(1 / 60);
  const e1 = inp.state.shiftUp;
  inp.update(1 / 60);
  check('bound paddle: one edge per pull', e1 && !inp.state.shiftUp);
  // keyboard: pressing a non-driving key mid-corner must not drop the wheel
  wheel.axes[0] = -0.1;
  inp.update(1 / 60);
  check('the wheel keeps the car while held at an angle', inp.state.device === 'wheel');
  // an unknown pedal set resting at −1 on axis 0 must not read as a stick at full lock
  pads = [pedals];
  const inp2 = new Input();
  inp2.update(1 / 60);
  inp2.update(1 / 60);
  check('unknown device resting at ±1 never steers', inp2.state.steer === 0 && inp2.state.device === 'keyboard', `${inp2.state.device} ${inp2.state.steer}`);
  // rumble: a pad driving over a kerb with a lock-up gets effects; menus stop them
  pads = [xpad];
  const inp3 = new Input();
  xpad.axes[0] = 0.5;
  inp3.update(1 / 60);
  const fake = { vx: 50, impacts: [], contact: { wallHit: 0 }, surface: [1, 0, 0, 0], onKerb: true, roadVel: 0.2, slipFront: 0.9, lockup: 0.6, wheelspin: 0, absActive: false, tcActive: false };
  effects.length = 0;
  for (let i = 0; i < 12; i++) {
    inp3.update(1 / 60);
    inp3.feedback(1 / 60, fake);
  }
  const trig = effects.filter(([t]) => t === 'trigger-rumble');
  check('rumble: ~20 Hz refresh, trigger rumble on the brake trigger for a lock-up', effects.length >= 3 && effects.length <= 6 && trig.length > 0 && trig[0][1].leftTrigger > 0.4 && trig[0][1].weakMagnitude > 0.3, `${effects.length} effects, ${JSON.stringify(trig[0]?.[1])}`);
  effects.length = 0;
  inp3.update(1 / 60);
  inp3.update(1 / 60);
  check('rumble stops when the game stops feeding it (menu / pause)', effects.length === 1 && effects[0][0] === 'reset');
  inp3.setPrefs({ vibration: 0 });
  effects.length = 0;
  for (let i = 0; i < 6; i++) {
    inp3.update(1 / 60);
    inp3.feedback(1 / 60, fake);
  }
  check('vibration Off sends nothing', effects.length === 0);
}

// ---- rumble mix
{
  const m = new RumbleMix();
  const car = { vx: 60, impacts: [], contact: { wallHit: 0 }, surface: [0, 0, 0, 0], onKerb: false, roadVel: 0.02, slipFront: 0.8, lockup: 0, wheelspin: 0, absActive: false, tcActive: false };
  let o = m.update(1 / 60, car);
  check('rumble: a clean straight is silent', o.strong === 0 && o.weak === 0 && o.left === 0 && o.right === 0);
  car.impacts.push({ speed: 12 });
  o = m.update(1 / 60, car);
  check('rumble: a 12 m/s hit is a big jolt', o.strong > 0.9, o.strong.toFixed(2));
  car.impacts.length = 0;
  for (let i = 0; i < 40; i++) o = m.update(1 / 60, car);
  check('rumble: the jolt dies away in well under a second', o.strong < 0.02, o.strong.toFixed(3));
  car.surface = [4, 4, 0, 0];
  for (let i = 0; i < 20; i++) o = m.update(1 / 60, car);
  check('rumble: gravel rumbles the big motor', o.strong > 0.3, o.strong.toFixed(2));
  car.surface = [0, 0, 0, 0];
  car.wheelspin = 0.7;
  o = m.update(1 / 60, car);
  check('rumble: wheelspin on the throttle trigger', o.right > 0.5 && o.left === 0);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
