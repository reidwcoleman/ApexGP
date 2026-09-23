import { CarPhysics } from '../sim/CarPhysics.ts';
import type { Race } from '../race/Race.ts';

/**
 * Records every car's visual state at 30 Hz into a ring buffer (the last
 * ~2 minutes) and plays it back through stand-in CarPhysics objects, so the
 * normal CarView/Cameras code renders a replay without knowing it's one.
 */

const F = 16; // floats per car per frame
const HZ = 30;
const SECONDS = 120;

export class ReplayBuffer {
  private cars = 0;
  private data: Float32Array = new Float32Array(0);
  private times = new Float32Array(HZ * SECONDS);
  private head = 0;
  private count = 0;
  private acc = 0;
  /** stand-ins the views read from during playback */
  readonly ghosts: CarPhysics[] = [];

  reset(race: Race) {
    this.cars = race.cars.length;
    this.data = new Float32Array(HZ * SECONDS * this.cars * F);
    this.head = 0;
    this.count = 0;
    this.acc = 0;
    this.ghosts.length = 0;
    for (const c of race.cars) this.ghosts.push(new CarPhysics(c.car.spec));
  }

  get duration(): number {
    if (this.count < 2) return 0;
    return this.times[(this.head - 1 + this.times.length) % this.times.length] - this.times[this.oldest()];
  }

  get startTime(): number {
    return this.count ? this.times[this.oldest()] : 0;
  }

  private oldest() {
    return (this.head - this.count + this.times.length) % this.times.length;
  }

  record(dt: number, race: Race) {
    if (!this.cars) return;
    this.acc += dt;
    if (this.acc < 1 / HZ) return;
    this.acc -= 1 / HZ;
    const cap = this.times.length;
    const base = this.head * this.cars * F;
    this.times[this.head] = race.time;
    race.cars.forEach((c, i) => {
      const k = c.car;
      const o = base + i * F;
      const d = this.data;
      d[o] = k.x;
      d[o + 1] = k.z;
      d[o + 2] = k.yaw;
      d[o + 3] = k.s;
      d[o + 4] = k.lateral;
      d[o + 5] = k.pitch;
      d[o + 6] = k.roll;
      d[o + 7] = k.heave;
      d[o + 8] = k.steer;
      d[o + 9] = k.wheelAngleF;
      d[o + 10] = k.wheelAngleR;
      d[o + 11] = k.vx;
      d[o + 12] = k.brakeHeat;
      d[o + 13] = k.drsAnim;
      d[o + 14] = k.rpm;
      d[o + 15] = k.throttle;
    });
    this.head = (this.head + 1) % cap;
    this.count = Math.min(cap, this.count + 1);
  }

  /** set the ghosts to the recorded state at absolute session time t */
  apply(t: number, trackLength: number) {
    if (this.count < 2) return;
    const cap = this.times.length;
    // binary search over the ring (times are monotonic in ring order)
    let lo = 0;
    let hi = this.count - 1;
    const at = (i: number) => this.times[(this.oldest() + i) % cap];
    if (t <= at(0)) hi = 0;
    else if (t >= at(hi)) lo = hi;
    else {
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (at(mid) <= t) lo = mid;
        else hi = mid;
      }
    }
    const ia = (this.oldest() + lo) % cap;
    const ib = (this.oldest() + hi) % cap;
    const ta = this.times[ia];
    const tb = this.times[ib];
    const f = tb > ta ? Math.min(1, Math.max(0, (t - ta) / (tb - ta))) : 0;
    const d = this.data;
    const lerp = (a: number, b: number) => a + (b - a) * f;
    const lerpAngle = (a: number, b: number) => {
      let dd = b - a;
      while (dd > Math.PI) dd -= Math.PI * 2;
      while (dd < -Math.PI) dd += Math.PI * 2;
      return a + dd * f;
    };
    for (let i = 0; i < this.cars; i++) {
      const a = ia * this.cars * F + i * F;
      const b = ib * this.cars * F + i * F;
      const g = this.ghosts[i];
      g.x = lerp(d[a], d[b]);
      g.z = lerp(d[a + 1], d[b + 1]);
      g.yaw = lerpAngle(d[a + 2], d[b + 2]);
      let ds = d[b + 3] - d[a + 3];
      if (ds < -trackLength / 2) ds += trackLength;
      if (ds > trackLength / 2) ds -= trackLength;
      g.s = (d[a + 3] + ds * f + trackLength) % trackLength;
      g.hint = Math.floor(g.s);
      g.lateral = lerp(d[a + 4], d[b + 4]);
      g.pitch = lerp(d[a + 5], d[b + 5]);
      g.roll = lerp(d[a + 6], d[b + 6]);
      g.heave = lerp(d[a + 7], d[b + 7]);
      g.steer = lerp(d[a + 8], d[b + 8]);
      g.wheelAngleF = lerp(d[a + 9], d[b + 9]);
      g.wheelAngleR = lerp(d[a + 10], d[b + 10]);
      g.vx = lerp(d[a + 11], d[b + 11]);
      g.vy = 0;
      g.brakeHeat = lerp(d[a + 12], d[b + 12]);
      g.drsAnim = lerp(d[a + 13], d[b + 13]);
      g.rpm = lerp(d[a + 14], d[b + 14]);
      g.throttle = lerp(d[a + 15], d[b + 15]);
    }
  }
}
