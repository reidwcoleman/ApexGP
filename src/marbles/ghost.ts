import * as THREE from 'three';

/**
 * Out of the show isn't out of the fun. A person who's been knocked out flies on through the
 * rounds that are left as a ghost: it goes through everything, it can't be hit and it can't get
 * in anyone's way, but it can still pick up stars. Enough stars (the ones from before count too:
 * they're kept all through a show) and it's revived: back in as a bean from the next round.
 *
 * Each browser flies its own ghost and says where it is a few times a second, so the friends
 * you're playing with see you (and your BOO!) haunting the round.
 */
export const REVIVE = { cost: 50, more: 25 };
export const GHOST = { speed: 15, kartSpeed: 34, reach: 2.3, leash: 70, send: 1 / 7 };

function ghostMesh(color: number) {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(0.62, 28, 20);
  const P = geo.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    if (y >= 0) {
      P.setY(i, y * 1.15);
      continue;
    }
    // below the middle it's a sheet: straight down, flaring a little, with a wavy hem
    const a = Math.atan2(z, x), k = -y / 0.62;
    const r = 0.62 * (1 + k * 0.12) * (1 + Math.sin(a * 6) * 0.07 * k);
    P.setXYZ(i, Math.cos(a) * r, -k * (0.95 + Math.sin(a * 6 + 1.6) * 0.13), Math.sin(a) * r);
  }
  geo.computeVertexNormals();
  const tint = new THREE.Color(0xffffff).lerp(new THREE.Color(color), 0.4);
  const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: 0.55, roughness: 0.5, transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide }));
  body.renderOrder = 3;
  g.add(body);
  const dark = new THREE.MeshBasicMaterial({ color: 0x1b1c2e, transparent: true, opacity: 0.85, depthWrite: false });
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10).scale(1, 1.35, 0.5), dark);
    eye.position.set(sx * 0.22, 0.22, 0.56);
    eye.renderOrder = 4;
    g.add(eye);
  }
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10).scale(1.2, 1, 0.5), dark);
  mouth.position.set(0, -0.06, 0.6);
  mouth.renderOrder = 4;
  g.add(mouth);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.045, 8, 28).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe27a, toneMapped: false }));
  halo.position.y = 0.98;
  g.add(halo);
  return { g, mouth };
}

export interface Spook {
  id: number;
  name: string;
  g: THREE.Group;
  mouth: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  /** someone else's: where it was last said to be */
  to: THREE.Vector3;
  toYaw: number;
  boo: number;
  seen: number;
}

const V = new THREE.Vector3();

export class Ghosts {
  /** mine (null: I'm in the round, or not in the show) */
  me: Spook | null = null;
  readonly others = new Map<number, Spook>();
  private sentT = 0;
  private booOut = false;
  constructor(private scene: THREE.Scene) {}

  private make(id: number, name: string, color: number, at: THREE.Vector3): Spook {
    const { g, mouth } = ghostMesh(color);
    g.position.copy(at);
    this.scene.add(g);
    return { id, name, g, mouth, pos: at.clone(), vel: new THREE.Vector3(), yaw: 0, to: at.clone(), toYaw: 0, boo: -9, seen: 0 };
  }
  private drop(s: Spook) {
    this.scene.remove(s.g);
    s.g.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
  /** a new round: nobody's haunting it yet */
  clear() {
    if (this.me) this.drop(this.me);
    this.me = null;
    for (const s of this.others.values()) this.drop(s);
    this.others.clear();
  }
  /** I'm out: my ghost goes into this round */
  haunt(id: number, name: string, color: number, at: THREE.Vector3) {
    if (this.me) this.drop(this.me);
    this.me = this.make(id, name, color, at);
  }
  /** a friend's ghost is here (said over the net) */
  heard(id: number, name: string, color: number, p: number[], boo: boolean, now: number) {
    if (this.me?.id === id) return false;
    let s = this.others.get(id);
    if (!s) this.others.set(id, (s = this.make(id, name, color, new THREE.Vector3(p[0], p[1], p[2]))));
    s.to.set(p[0], p[1], p[2]);
    s.toYaw = p[3];
    s.seen = now;
    if (boo) s.boo = now;
    return boo;
  }
  /** BOO! (a puff and a shout; it says so to the others) */
  boo(now: number) {
    if (!this.me || now - this.me.boo < 0.9) return false;
    this.me.boo = now;
    this.booOut = true;
    return true;
  }
  /**
   * Mine flies where it's pointed (`ix`, `iz`: the world direction, 0..1), at the height of
   * whatever it's near (`y`), and is never left behind by the round (`home`: the bean it's by).
   */
  fly(dt: number, ix: number, iz: number, speed: number, y: number, home: THREE.Vector3 | null) {
    const s = this.me;
    if (!s) return;
    const k = 1 - Math.exp(-dt * 7);
    s.vel.x += (ix * speed - s.vel.x) * k;
    s.vel.z += (iz * speed - s.vel.z) * k;
    s.pos.x += s.vel.x * dt;
    s.pos.z += s.vel.z * dt;
    s.pos.y += (y - s.pos.y) * (1 - Math.exp(-dt * 3.5));
    if (home && Math.hypot(home.x - s.pos.x, home.z - s.pos.z) > GHOST.leash) this.zip(home);
    if (Math.hypot(s.vel.x, s.vel.z) > 1) s.yaw = lerpAngle(s.yaw, Math.atan2(s.vel.x, s.vel.z), 1 - Math.exp(-dt * 10));
  }
  /** mine, straight to somewhere (beside a bean) */
  zip(at: THREE.Vector3) {
    const s = this.me;
    if (!s) return;
    s.pos.set(at.x + 2.2, at.y + 1.6, at.z + 2.2);
    s.vel.set(0, 0, 0);
  }
  /** what to say about mine now (null: nothing yet) */
  packet(now: number): { p: [number, number, number, number]; boo: boolean } | null {
    const s = this.me;
    if (!s || (now < this.sentT && !this.booOut)) return null;
    this.sentT = now + GHOST.send;
    const boo = this.booOut;
    this.booOut = false;
    return { p: [+s.pos.x.toFixed(2), +s.pos.y.toFixed(2), +s.pos.z.toFixed(2), +s.yaw.toFixed(2)], boo };
  }
  /** everyone's drawn: bobbing, leaning the way it's going, its mouth wide for a BOO */
  sync(dt: number, now: number) {
    for (const [id, s] of this.others) {
      // (one that's stopped saying where it is has gone: revived, or left)
      if (now - s.seen > 3) {
        this.drop(s);
        this.others.delete(id);
        continue;
      }
      V.copy(s.to).sub(s.pos);
      s.vel.copy(V).multiplyScalar(4);
      s.pos.addScaledVector(V, 1 - Math.exp(-dt * 8));
      s.yaw = lerpAngle(s.yaw, s.toYaw, 1 - Math.exp(-dt * 8));
      this.pose(s, now);
    }
    if (this.me) this.pose(this.me, now);
  }
  private pose(s: Spook, now: number) {
    const b = Math.max(0, 1 - (now - s.boo) / 0.5);
    s.g.position.set(s.pos.x, s.pos.y + Math.sin(now * 3 + s.id) * 0.13, s.pos.z);
    const sp = Math.min(1, Math.hypot(s.vel.x, s.vel.z) / 15);
    s.g.rotation.set(sp * 0.35, s.yaw, 0, 'YXZ');
    s.g.scale.setScalar(1 + b * 0.55);
    s.mouth.scale.set(1 + b * 1.6, 1 + b * 2.4, 1);
  }
}

function lerpAngle(a: number, b: number, k: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
