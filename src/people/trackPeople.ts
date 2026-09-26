import * as THREE from 'three';
import { peopleKit, type PeopleKit } from './Humans.ts';
import { Extras, EX, extraBodies, type ExtraSpec } from './Extras.ts';
import { crowdReactions } from './reactions.ts';

/**
 * The people out on the circuit: marshals at their posts (the one at the fence waves the
 * yellow flag toward an incident ahead, the blue one to a car about to be lapped; the post's
 * LED panel shows the same), and photographers at the fences on the outside of the tight
 * corners. Built once the avatars are in; instanced (Extras), drawn only near the camera.
 */

export interface MarshalPlace {
  pos: THREE.Vector3;
  yaw: number;
  post: number;
  s: number;
  side: -1 | 1;
  lead: boolean;
}

export interface PhotographerPlace {
  pos: THREE.Vector3;
  yaw: number;
}

export type PostFlag = 'off' | 'yellow' | 'blue';

interface TrackLike {
  length: number;
  delta(a: number, b: number): number;
}

const ORANGE = 0xf06a1c;
const YELLOW = 0xffd200;
const BLUE = 0x1f63e0;

export class TrackPeople {
  readonly group = new THREE.Group();
  private extras: Extras | null = null;
  private failed = false;
  private t = 0;
  private readonly postState: PostFlag[] = [];
  private readonly posts: { s: number; lead: number; others: number[]; next: number }[] = [];

  constructor(
    private readonly track: TrackLike,
    private readonly marshals: MarshalPlace[],
    private readonly photographers: PhotographerPlace[],
    /** the post's LED panel */
    private readonly setPanel?: (state: 'off' | 'yellow' | 'blue', post: number) => void,
  ) {
    this.group.name = 'track_people';
    // (for tools and debugging)
    this.group.userData.people = this;
  }

  private build(kit: PeopleKit) {
    const B = extraBodies(kit);
    let seed = 4242;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const specs: ExtraSpec[] = [];
    const byPost = new Map<number, { s: number; lead: number; others: number[]; next: number }>();
    for (const m of this.marshals) {
      const i = specs.length;
      specs.push({
        body: B.crew,
        x: m.pos.x,
        y: m.pos.y,
        z: m.pos.z,
        yaw: m.yaw,
        act: m.lead ? EX.IDLE : rand() < 0.5 ? EX.LOOK : EX.WAIT,
        tint: ORANGE,
        tintAmount: 0.95,
        dyeAll: true,
        cap: rand() < 0.6 ? (rand() < 0.5 ? ORANGE : 0xf2f2f2) : null,
        prop: m.lead ? 'flag' : null,
        propColor: YELLOW,
        scale: 0.95 + rand() * 0.1,
        pace: 0.9 + rand() * 0.2,
      });
      let p = byPost.get(m.post);
      if (!p) byPost.set(m.post, (p = { s: m.s, lead: -1, others: [], next: 4 + rand() * 8 }));
      if (m.lead) p.lead = i;
      else p.others.push(i);
    }
    for (const [post, p] of byPost) {
      this.posts[post] = p;
      this.postState[post] = 'off';
    }
    const cams = [0x1b1c1f, 0x3a3f36, 0x2a2d33, 0x6b6456, 0xe8e6e0];
    for (const ph of this.photographers) {
      const male = rand() < 0.8;
      const pool = male ? B.casualM : B.casualF;
      specs.push({
        body: pool[Math.floor(rand() * pool.length)] ?? B.casualM[0],
        x: ph.pos.x,
        y: ph.pos.y,
        z: ph.pos.z,
        yaw: ph.yaw,
        act: EX.PHOTO,
        // the photographer's tabard / dark kit
        tint: cams[Math.floor(rand() * cams.length)],
        tintAmount: 0.85,
        cap: rand() < 0.4 ? 0x202226 : null,
        prop: 'camera',
        propColor: 0x141518,
        pace: 0.8 + rand() * 0.4,
      });
    }
    // flags and people show well from far away: the marshals out to 450 m
    this.extras = new Extras(kit, specs, { name: 'track_people_extras', near: 26, far: 450, propFar: 300, shadows: true });
    // the lead marshals start with the flag furled (hidden)
    for (const p of this.posts) if (p && p.lead >= 0) this.extras.setProp(p.lead, false);
    this.group.add(this.extras.group);
  }

  /** the flag the post at `s` should show */
  private flagAt(s: number): PostFlag {
    const tr = this.track;
    if (crowdReactions.vsc) return 'yellow';
    for (const y of crowdReactions.yellow) {
      // an incident up to 300 m ahead of the post (or just past it)
      const d = tr.delta(s, y);
      if (d > -25 && d < 300) return 'yellow';
    }
    for (const b of crowdReactions.blue) {
      // a car about to be lapped, coming up to the post
      const d = tr.delta(b, s);
      if (d > 0 && d < 220) return 'blue';
    }
    return 'off';
  }

  update(dt: number, camera: THREE.Camera) {
    this.t += dt;
    if (!this.extras) {
      const kit = peopleKit();
      // (built once every avatar is in: the bake is made once)
      if (!kit || !kit.complete || this.failed) return;
      try {
        this.build(kit);
      } catch (e) {
        this.failed = true;
        console.warn('[people] track people failed', e);
        return;
      }
    }
    const ex = this.extras!;
    this.posts.forEach((p, post) => {
      if (!p) return;
      const want = crowdReactions.live ? this.flagAt(p.s) : 'off';
      if (want !== this.postState[post]) {
        this.postState[post] = want;
        this.setPanel?.(want, post);
        if (p.lead >= 0) {
          if (want === 'off') {
            ex.setAct(p.lead, EX.IDLE);
            ex.setProp(p.lead, false);
          } else {
            ex.setAct(p.lead, EX.WAVE, 0);
            ex.setProp(p.lead, true, want === 'yellow' ? YELLOW : BLUE);
          }
        }
        // the others at the post look on
        for (const o of p.others) ex.setAct(o, want === 'off' ? EX.LOOK : EX.IDLE);
      }
      // a quiet post: now and then they turn to talk
      if (want === 'off' && p.others.length) {
        p.next -= dt;
        if (p.next <= 0) {
          p.next = 6 + Math.random() * 14;
          const o = p.others[Math.floor(Math.random() * p.others.length)];
          const r = Math.random();
          ex.setAct(o, r < 0.3 ? EX.TALK : r < 0.55 ? EX.LISTEN : r < 0.8 ? EX.LOOK : EX.WAIT);
        }
      }
    });
    ex.update(this.t, camera);
  }

  dispose() {
    this.extras?.dispose();
    this.group.removeFromParent();
  }
}
