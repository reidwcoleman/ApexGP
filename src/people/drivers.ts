import * as THREE from 'three';
import { Person, printTexture, type HairId, type Look, type PeopleKit } from './Humans.ts';
import { naturalStance, turnHead, lean } from './poses.ts';
import type { Driver, Team } from '../race/Teams.ts';

/**
 * The drivers on the real bodies: each one's skin, hair and beard from their look,
 * in their team's race suit (side panels, collar and belt in the team's colours,
 * sponsor and number on the chest, name and number across the back) and team cap.
 */

function lum(hex: number) {
  const c = new THREE.Color(hex);
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

export function driverLook(team: Team, d: Driver, opts: { cap?: boolean; gloves?: boolean } = {}): Look {
  const L = d.look;
  // fair skins read ~0.8 luminance, dark ~0.35: onto the light↔dark texture blend
  const tone = THREE.MathUtils.clamp((0.78 - lum(L.skin)) / 0.42, 0, 1);
  const hair: HairId = L.style === 'buzz' ? 'buzzed' : L.style === 'braids' || L.style === 'long' ? 'long' : L.style === 'curly' ? 'buzzed' : 'simpleparted';
  const ink = team.ink;
  return {
    female: false,
    driver: true,
    tone,
    hair,
    hairColor: L.hair,
    skin: L.skin,
    beard: !!L.beard,
    // a racing driver's shave: a shadow at least, real stubble where they have it
    stubble: Math.max(0.12, L.stubble ?? 0),
    top: 'suit',
    topColor: team.primary,
    top2: team.secondary,
    accent: team.accent,
    bottom: 'suit',
    bottomColor: team.primary,
    shoeColor: 0x121214,
    // (the suit's body is a work jacket over gloved hands: racing gloves in the team's second colour)
    gloves: opts.gloves === false ? null : team.secondary,
    cap: opts.cap === false ? null : team.primary,
    logo: printTexture({ text: team.sponsor, color: ink, sub: team.short, num: String(d.number) }, { text: d.last.toUpperCase(), color: ink, num: String(d.number) }),
    height: 0.97 + ((d.number * 37) % 7) * 0.01,
    face: { width: 0.94 + ((L.face?.width ?? 1) - 0.94) * 1.4, jaw: L.face?.jaw ?? 1, length: L.face?.length ?? 1 },
    build: 0.98,
    // drivers are lean and fit
    weight: -0.35 + ((d.number * 13) % 5) * 0.06,
    muscle: 0.45,
  };
}

/** the old podium rig's arm angles → directions in the person's frame */
const m1 = new THREE.Matrix4(), m2 = new THREE.Matrix4(), m3 = new THREE.Matrix4();
const e1 = new THREE.Euler(), e2 = new THREE.Euler();
function armDirs(sx: number, sz: number, ex: number, ez: number): [[number, number, number], [number, number, number]] {
  m1.makeRotationFromEuler(e1.set(sx, 0, sz));
  m2.makeRotationFromEuler(e2.set(ex, 0, ez));
  const u = new THREE.Vector3(0, -1, 0).applyMatrix4(m1);
  const f = new THREE.Vector3(0, -1, 0).applyMatrix4(m3.multiplyMatrices(m1, m2));
  return [[u.x, u.y, u.z], [f.x, f.y, f.z]];
}

export interface PodiumPose {
  /** shoulder (x forward-, z out+) and elbow angles per side, as the old rig had them */
  lx: number; lz: number; lex: number; le: number;
  rx: number; rz: number; rex: number; re: number;
  headX: number; headY: number;
  lean: number;
  jump: number;
}

export class PodiumDriver {
  readonly person: Person;
  readonly root: THREE.Group;
  baseY = 0;
  readonly trophy: THREE.Object3D;
  readonly bottle: THREE.Object3D;
  private readonly v = new THREE.Vector3();
  private readonly w = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(kit: PeopleKit, team: Team, d: Driver, readonly place: number, readonly phase: number, trophy: THREE.Object3D, bottle: THREE.Object3D) {
    this.person = new Person(kit, driverLook(team, d));
    this.root = this.person.root;
    this.person.play('Idle_Loop', { offset: place * 0.3 });
    this.trophy = trophy;
    this.bottle = bottle;
    trophy.rotation.set(0, 0, 0);
    bottle.rotation.set(0, 0, 0);
    trophy.position.set(0, 0, 0);
    bottle.position.set(0, 0, 0);
  }

  /** advance the idle clip, then lay the podium's body language over it */
  apply(dt: number, p: PodiumPose) {
    const P = this.person;
    this.root.position.y = this.baseY + p.jump;
    P.update(dt);
    naturalStance(P, 0.85);
    const [lu, lf] = armDirs(p.lx, p.lz, p.lex, p.le);
    const [ru, rf] = armDirs(p.rx, p.rz, p.rex, p.re);
    P.aim('upperarm_l', 'lowerarm_l', P.dir(lu[0], lu[1], lu[2], this.v));
    P.aim('lowerarm_l', 'hand_l', P.dir(lf[0], lf[1], lf[2], this.v));
    P.aim('upperarm_r', 'lowerarm_r', P.dir(ru[0], ru[1], ru[2], this.v));
    P.aim('lowerarm_r', 'hand_r', P.dir(rf[0], rf[1], rf[2], this.v));
    turnHead(P, p.headY, p.headX);
    lean(P, p.lean);
    this.root.updateMatrixWorld(true);
    // trophy in the right hand, bottle in the left: standing along the forearm, past the fist
    this.hold(this.trophy, 'r', 0.05, true);
    this.hold(this.bottle, 'l', 0.03, false);
  }

  /** a prop in the fist, along the forearm; `upright` keeps it standing unless the arm is raised */
  private hold(o: THREE.Object3D, side: 'l' | 'r', out: number, upright: boolean) {
    const hand = this.person.worldOf(`hand_${side}`, this.v);
    const dir = hand.clone().sub(this.person.worldOf(`lowerarm_${side}`, this.w)).normalize();
    if (upright) dir.lerp(this.up, 1 - THREE.MathUtils.clamp(dir.y * 1.6, 0, 1)).normalize();
    this.q.setFromUnitVectors(this.up, dir);
    const world = hand.addScaledVector(dir, out);
    const parent = o.parent;
    if (!parent) return;
    parent.updateMatrixWorld(true);
    o.position.copy(parent.worldToLocal(world));
    const pq = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    o.quaternion.copy(pq.multiply(this.q));
  }

  headWorld(out: THREE.Vector3) {
    return this.person.worldOf('Head', out).add(this.w.set(0, 0.1, 0));
  }

  dispose() {
    this.person.dispose();
  }
}
