import type { Match } from './match.ts';
import type { Node } from './nav.ts';
import type { Opening } from './fort.ts';
import { barPassable } from './fort.ts';
import { BOARDS_ALL, isUp } from './shared.ts';
import { siteMid, siteOut, sitesAround, type Site } from './walls.ts';

/**
 * What a side's computer players have been told to do. A bot in a fight fights; the rest of the time it does this.
 *
 *   hold     stand at a spot and watch a point (a doorway, a corridor), low if told to
 *   go       walk to a spot and wait there
 *   build    nail a barricade across a doorway
 *   breach   get a barricade out of a doorway: a charge if it has one, its boot if not
 *   secure   into the room and stay in it
 *   hunt     nothing in particular: go and find them
 */
export type Order =
  | { kind: 'hold'; node: Node; look: { x: number; z: number }; crouch?: boolean }
  | { kind: 'go'; node: Node; look?: { x: number; z: number }; fast?: boolean }
  | { kind: 'build'; bar: number; node: Node }
  | { kind: 'breach'; bar: number; node: Node }
  | { kind: 'secure'; node: Node }
  /** get one of the side's own off the floor */
  | { kind: 'revive'; slot: number }
  /** a steel sheet over a piece of wall, from this side of it */
  | { kind: 'sheet'; site: Site; node: Node; side: number }
  /** a tripwire across a doorway */
  | { kind: 'trip'; bar: number; node: Node }
  /** a look through a barricade with the scope before anyone goes in */
  | { kind: 'scope'; bar: number; node: Node; done?: boolean }
  /** a charge on a piece of wall */
  | { kind: 'wbreach'; site: Site; node: Node; side: number; failed?: boolean }
  | { kind: 'hunt' };

interface Group {
  /** the way in: a doorway, or a piece of wall standing in for one */
  entry: Opening;
  wall?: Site;
  /** the doorway to fall back on if the wall turns out to be sheeted */
  alt: Opening;
  scoped?: number;
  /** where it forms up first, out of sight of the room, and when it left there */
  rally: Node | null;
  rallied?: number;
  leftAt: number;
  /** when its way in came open */
  openAt: number;
  door: number;
  slots: number[];
  stage: Map<number, Node>;
  /** when it was first all there */
  readyAt: number;
  /** told to go in */
  entered: boolean;
  flashed: boolean;
  /** not before the bang */
  enterAt: number;
  breacher: number;
}

/**
 * The commander of each side's bots in the attack-and-defend game. Defenders: most of them board the room up and then
 * anchor in it, each watching a different doorway from a corner the doorway doesn't see first; one or two roam, out on
 * the way the attackers will come, and fall back when it gets late. Attackers: two groups to two doorways as far apart
 * as the room has, a stack beside each, the boards out (a charge, or a boot), a flash through, and in together.
 */
export class Tactics {
  private orders = new Map<number, Order>();
  private sitesDone = false;
  private tick = 0;
  private planned = [false, false];
  /** live seconds */
  private liveT = 0;
  private role = new Map<number, 'anchor' | 'roam'>();
  private buildList = new Map<number, number[]>();
  private spot = new Map<number, { node: Node; look: { x: number; z: number } }>();
  private groups: Group[] = [];
  private retake = false;
  /** both sides in the room and neither seeing the other: how long, and when each one next moves */
  private contestT = 0;
  private sweepAt = new Map<number, number>();

  constructor(private M: Match) {}

  orderFor(slot: number): Order | null {
    return this.orders.get(slot) ?? null;
  }

  /** a person has taken this one's place: nothing it was told applies to them */
  forget(slot: number) {
    this.orders.delete(slot);
    this.role.delete(slot);
    this.spot.delete(slot);
    this.buildList.delete(slot);
  }

  newRound() {
    this.orders.clear();
    this.peekPts = null;
    this.sitesDone = false;
    this.planned = [false, false];
    this.liveT = 0;
    this.role.clear();
    this.buildList.clear();
    this.spot.clear();
    this.groups = [];
    this.retake = false;
    this.contestT = 0;
    this.sweepAt.clear();
    this.reviving.clear();
    this.flankAt.clear();
    this.sites = [];
    this.sheetJob.clear();
    this.tripJob.clear();
  }

  update(dt: number) {
    const M = this.M;
    if (M.cfg.mode !== 'siege' || !M.obj) return;
    if (M.phase === 'live') this.liveT += dt;
    this.tick -= dt;
    if (this.tick > 0 || (M.phase !== 'prep' && M.phase !== 'live')) return;
    this.tick = 0.35;
    this.contestT = M.secureN[0] > 0 && M.secureN[1] > 0 ? this.contestT + 0.35 : 0;
    if (!this.sites.length && !this.sitesDone) {
      this.sitesDone = true;
      this.sites = sitesAround(M.world, M.obj.box, M.obj.doors.map((d) => this.door(d)));
    }
    if (M.phase === 'live') this.pickUps();
    this.defend();
    if (M.phase === 'live') this.attack();
  }

  private bots(team: number) {
    const M = this.M;
    return M.players.filter((p) => p.bot && isUp(p) && p.team === team).map((p) => p.slot);
  }

  private give(slot: number, o: Order) {
    if (!this.reviving.has(slot)) this.orders.set(slot, o);
  }

  /** someone of the side is on the floor: the nearest one who is not in a fight goes to them */
  private pickUps() {
    const M = this.M;
    for (const [by, to] of this.reviving) {
      const p = M.players.find((q) => q.slot === to);
      const fb = M.bodies[to];
      const watched = !!p && M.players.some((q) => isUp(q) && q.team !== p.team && q.team < 2 && Math.hypot(M.bodies[q.slot].x - fb.x, M.bodies[q.slot].z - fb.z) < 30 && M.world.sees({ x: M.bodies[q.slot].x, y: M.bodies[q.slot].y + 1.5, z: M.bodies[q.slot].z }, { x: fb.x, y: fb.y + 0.4, z: fb.z }));
      if (!p?.alive || !p.down || !M.up(by) || (watched && Math.hypot(M.bodies[by].x - fb.x, M.bodies[by].z - fb.z) > 2.5)) {
        this.reviving.delete(by);
        this.orders.delete(by);
      }
    }
    for (const p of M.players) {
      if (!p.alive || !p.down || p.team > 1 || [...this.reviving.values()].includes(p.slot)) continue;
      const b = M.bodies[p.slot];
      // lying where the other side can see them: whoever went would lie down beside them. Not yet
      if (M.players.some((q) => isUp(q) && q.team !== p.team && q.team < 2 && Math.hypot(M.bodies[q.slot].x - b.x, M.bodies[q.slot].z - b.z) < 30 && M.world.sees({ x: M.bodies[q.slot].x, y: M.bodies[q.slot].y + 1.5, z: M.bodies[q.slot].z }, { x: b.x, y: b.y + 0.4, z: b.z }))) continue;
      let best = -1, bd = 11;
      for (const q of M.players) {
        if (!q.bot || !isUp(q) || q.team !== p.team || this.reviving.has(q.slot) || (M.bots.get(q.slot)?.target ?? -1) >= 0) continue;
        const c = M.bodies[q.slot];
        const d = Math.hypot(c.x - b.x, c.z - b.z) + Math.abs(c.y - b.y) * 6 - (M.kitOf(q.slot) === 'medic' ? 5 : 0);
        if (d < bd) {
          bd = d;
          best = q.slot;
        }
      }
      if (best < 0) continue;
      this.reviving.set(best, p.slot);
      this.orders.set(best, { kind: 'revive', slot: p.slot });
      M.say(best, pick([`Coming, ${p.name}.`, 'Hold on, I have you.', `Picking ${p.name} up. Cover me.`]), 0.9);
    }
  }
  private reviving = new Map<number, number>();
  /** when each roamer stops waiting and goes looking */
  private flankAt = new Map<number, number>();
  /** this round's places a wall could be gone through, and which the defenders have someone sheeting */
  private sites: Site[] = [];
  private sheetJob = new Map<number, Site>();
  private tripJob = new Map<number, number>();

  /** the inside of a piece of the room's wall: +1 / -1 along its normal */
  private siteIn(st: Site) {
    const b = this.M.obj!.box;
    const mid = st.ax ? (b[2] + b[5]) / 2 : (b[0] + b[3]) / 2;
    return Math.sign(mid - st.c) || 1;
  }
  private siteNode(st: Site, side: number): Node | null {
    const p = siteOut(st, side, 0.75);
    let best: Node | null = null, bd = 1.8;
    for (const n of this.M.nav.nodes) {
      if (Math.abs(n.y - st.y0) > 0.6 || ((st.ax ? n.z : n.x) - st.c) * side < 0.3) continue;
      const d = Math.hypot(n.x - p.x, n.z - p.z);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }
  /** a wall as a doorway, for the code that stacks up on doorways */
  private asDoor(st: Site): Opening {
    const m = siteMid(st);
    return { i: -1, x: m.x, y: st.y0, z: m.z, w: st.u1 - st.u0, alongX: st.ax === 1, h: st.y1 - st.y0 };
  }

  private door(i: number): Opening {
    return this.M.openings[i];
  }

  /** which way is into the room through this doorway: +1 or -1 along its normal (z if the wall runs along x) */
  private inward(o: Opening) {
    const b = this.M.obj!.box;
    const mid = o.alongX ? (b[2] + b[5]) / 2 : (b[0] + b[3]) / 2;
    return Math.sign(mid - (o.alongX ? o.z : o.x)) || 1;
  }

  /** a spot in the room that watches a doorway without standing in front of it */
  private watchSpot(o: Opening, taken: Node[]): Node | null {
    const M = this.M, box = M.obj!.box;
    let best: Node | null = null, bs = -1e9;
    for (const n of M.nav.nodes) {
      if (!M.inBox(box, n.x, n.y, n.z, -0.35)) continue;
      const dx = n.x - o.x, dz = n.z - o.z, d = Math.hypot(dx, dz);
      if (d < 2.2) continue;
      let s = -Math.abs(d - 5.5) * 0.8 + (n.cover ? 2.5 : 0) + Math.random() * 1.5;
      // off the line the doorway looks down: the first round through it should not find anyone
      const across = Math.abs(o.alongX ? dx : dz);
      s += Math.min(across, 3) * 1.4;
      if (M.world.open(n.x, n.y + 1.4, n.z, o.x, o.y + 1.2, o.z)) s += 9;
      // and out of sight of the corridors: whoever wants a shot at this corner has to come to the doorway for it
      for (const q of this.peeks()) if (M.world.open(q.x, q.y, q.z, n.x, n.y + 1.2, n.z)) s -= 3.5;
      // and not in the eye of another doorway either
      for (const k of M.obj!.doors) {
        const q = this.door(k);
        if (q !== o && Math.abs(q.alongX ? n.x - q.x : n.z - q.z) < 0.9) s -= 3;
      }
      for (const t of taken) if (Math.hypot(t.x - n.x, t.z - n.z) < 1.6) s -= 12;
      if (s > bs) {
        bs = s;
        best = n;
      }
    }
    return best;
  }

  /** where the room can be looked into from, standing back from each of its doorways */
  private peeks() {
    if (this.peekPts) return this.peekPts;
    const M = this.M, obj = M.obj!;
    const pts: { x: number; y: number; z: number }[] = [];
    for (const d of obj.doors) {
      const o = this.door(d), out = -this.inward(o);
      for (const back of [2.5, 5, 9]) for (const lat of [-1.3, 0, 1.3]) {
        const x = o.x + (o.alongX ? lat : out * back), z = o.z + (o.alongX ? out * back : lat), y = o.y + 1.5;
        if (M.world.open(x, y, z, o.x, o.y + 1.3, o.z)) pts.push({ x, y, z });
      }
    }
    return (this.peekPts = pts);
  }
  private peekPts: { x: number; y: number; z: number }[] | null = null;

  /** the node just this side of a doorway, to build from or to break in from. side: +1/-1 along the doorway's normal */
  private doorNode(o: Opening, side: number, back = 1.1): Node | null {
    const key = `${o.x}|${o.z}|${o.y}|${side}|${back}`;
    const hit = this.doorNodes.get(key);
    if (hit !== undefined) return hit;
    const M = this.M;
    const x = o.x + (o.alongX ? 0 : side * back), z = o.z + (o.alongX ? side * back : 0);
    // on that side of the wall, and with the doorway in plain view: never the nearest point through the wall
    let best: Node | null = null, bd = 2.2;
    for (const n of M.nav.nodes) {
      if (Math.abs(n.y - o.y) > 0.8) continue;
      const d = Math.hypot(n.x - x, n.z - z);
      if (d >= bd || ((o.alongX ? n.z - o.z : n.x - o.x) * side) < 0.45) continue;
      if (!M.world.open(n.x, n.y + 1.2, n.z, o.x, o.y + 1.2, o.z)) continue;
      bd = d;
      best = n;
    }
    this.doorNodes.set(key, best);
    return best;
  }
  private doorNodes = new Map<string, Node | null>();
  /** the boards wait until the ones who are leaving have left */
  holdBuild = false;

  private defend() {
    const M = this.M, obj = M.obj!;
    const team = 1 - M.atk;
    const bots = this.bots(team);
    if (!bots.length) return;
    if (!this.planned[team]) {
      this.planned[team] = true;
      // the bold ones roam
      const by = [...bots].sort((a, b) => (M.bots.get(b)?.nerve ?? 0) - (M.bots.get(a)?.nerve ?? 0));
      const nRoam = bots.length >= 6 ? 2 : bots.length >= 3 ? 1 : 0;
      by.forEach((s, k) => this.role.set(s, k < nRoam ? 'roam' : 'anchor'));
      this.doorNodes.clear();
      const anchors = by.slice(nRoam), roamers = by.slice(0, nRoam);
      // doorways to board, shared out among the anchors, nearest first
      const doors = [...obj.doors];
      anchors.forEach((s) => this.buildList.set(s, []));
      doors.forEach((d, k) => {
        if (!anchors.length) return;
        this.buildList.get(anchors[k % anchors.length])!.push(d);
      });
      // and where each will stand after: a different doorway each, as far as they go round
      const taken: Node[] = [];
      anchors.forEach((s, k) => {
        const o = this.door(doors[k % doors.length]);
        const n = this.watchSpot(o, taken) ?? obj.c;
        taken.push(n);
        this.spot.set(s, { node: n, look: { x: o.x, z: o.z } });
      });
      // the roamers: somewhere off the way the attackers will come, out of sight of it, to come at their backs once
      // they are busy with the room
      const from = M.nav.nearest(...this.anchorOf(M.atk));
      const way = from ? M.nav.path(from, obj.c) : [];
      roamers.forEach((s) => {
        let pick: Node | null = null, bs = -1e9;
        for (let t = 0; t < 260; t++) {
          const n = M.nav.nodes[Math.floor(Math.random() * M.nav.nodes.length)];
          const d = Math.hypot(n.x - obj.c.x, n.z - obj.c.z) + Math.abs(n.y - obj.c.y) * 2.5;
          if (d < 8 || d > 24 || M.inBox(obj.box, n.x, n.y, n.z, 0.5) || n.next.length < 3) continue;
          let near = 1e9, seen = false;
          for (let w = 0; w < way.length; w += 2) {
            const q = way[w];
            const dd = Math.hypot(q.x - n.x, q.z - n.z) + Math.abs(q.y - n.y) * 3;
            if (dd < near) near = dd;
            if (!seen && dd < 22 && M.world.open(n.x, n.y + 1.4, n.z, q.x, q.y + 1.4, q.z)) seen = true;
          }
          if (near < 5 || seen) continue;
          const sc = (n.cover ? 3 : 0) + Math.random() * 3 - Math.abs(d - 14) * 0.4 + Math.min(near, 14) * 0.2;
          if (sc > bs) {
            bs = sc;
            pick = n;
          }
        }
        if (pick) {
          const look = way.length ? way[Math.floor(way.length * 0.7)] : obj.c;
          this.spot.set(s, { node: pick, look: { x: look.x, z: look.z } });
          this.give(s, { kind: 'go', node: pick, look: { x: look.x, z: look.z }, fast: true });
          // the bold come as soon as the room is being worked on; the patient wait until they are inside it
          this.flankAt.set(s, M.bots.get(s)!.nerve > 0.5 ? 28 + Math.random() * 16 : 70 + Math.random() * 30);
        } else this.role.set(s, 'anchor');
      });
      const who = M.players.find((p) => p.slot === anchors[0]);
      if (who) M.say(who.slot, pick([`Board up the ${M.objName()}.`, 'Get those doors shut.', 'Barricades up, then find a corner.']));
    }
    // a roamer still in the room: nobody nails it in
    this.holdBuild = M.phase === 'prep' && M.clock > 16 && bots.some((s) => this.role.get(s) === 'roam' && M.inObj(M.bodies[s].x, M.bodies[s].y, M.bodies[s].z));
    const attackersIn = M.secureN[0] > 0;
    const anchorsUp = bots.filter((s) => this.role.get(s) === 'anchor').length;
    const late = M.phase === 'live' && (M.clock < 45 || anchorsUp <= 1);
    for (const s of bots) {
      const role = this.role.get(s) ?? 'anchor';
      const spot = this.spot.get(s);
      const b = M.bodies[s];
      if (attackersIn && this.contestT > 4 && M.inObj(b.x, b.y, b.z)) {
        // in the room with them and nobody has a shot: it is their room, they know where the noise is. Go and look
        if (this.liveT >= (this.sweepAt.get(s) ?? 0)) {
          this.sweepAt.set(s, this.liveT + 3 + Math.random() * 2);
          let near: Node | null = null, nd = 1e9;
          for (const p of M.players) {
            if (!p.alive || p.team !== M.atk) continue;
            const q = M.bodies[p.slot];
            const d = Math.hypot(q.x - b.x, q.z - b.z);
            if (M.inObj(q.x, q.y, q.z) && d < nd) {
              nd = d;
              near = M.nav.nearest(q.x + (Math.random() - 0.5) * 2, q.y, q.z + (Math.random() - 0.5) * 2);
            }
          }
          if (near) this.give(s, { kind: 'go', node: near });
        }
        continue;
      }
      // the last one standing, outside, with the room full of them: the careful ones don't walk back into that
      if (attackersIn && !M.inObj(b.x, b.y, b.z) && M.secureN[0] >= 2 && M.players.filter((q) => isUp(q) && q.team === team).length === 1 && M.bots.get(s)!.nerve < LONE_STAYS_OUT) {
        const cur = this.orders.get(s);
        if (cur?.kind !== 'hold') {
          const n = M.nav.nearest(b.x, b.y, b.z);
          if (n) this.give(s, { kind: 'hold', node: n, look: { x: obj.c.x, z: obj.c.z }, crouch: true });
        }
        continue;
      }
      if (attackersIn && !M.inObj(b.x, b.y, b.z)) {
        // they are in the room: everyone back to it
        const cur = this.orders.get(s);
        if (cur?.kind !== 'secure') this.give(s, { kind: 'secure', node: this.insideNode(s) });
        if (!this.retake) {
          this.retake = true;
          M.say(s, pick(["They're in the room!", 'Get them off the objective!', 'Back to the room, now!']));
        }
        continue;
      }
      if (role === 'anchor') {
        const list = this.buildList.get(s) ?? [];
        // boards first: the next doorway on its list that has none (and nobody already at it)
        while (list.length && (M.bars[list[0]] === BOARDS_ALL || (M.bars[list[0]] && M.phase === 'live'))) list.shift();
        // a doorway that's been opened up again gets boarded again, if nobody is shooting through it
        if (!list.length && M.phase === 'prep') for (const d of obj.doors) if (!M.bars[d] && ![...this.buildList.values()].some((l) => l.includes(d))) list.push(d);
        if (list.length && (M.phase === 'prep' || this.liveT < 8)) {
          const o = this.door(list[0]);
          const n = this.doorNode(o, this.inward(o));
          if (n) {
            const cur = this.orders.get(s);
            if (cur?.kind !== 'build' || cur.bar !== list[0]) this.give(s, { kind: 'build', bar: list[0], node: n });
            continue;
          }
          list.shift();
        }
        if (M.phase === 'prep' || this.liveT < 6) {
          // then a wire across a doorway, from the ones who carry wire
          if (M.tripsOf(s) > 0) {
            let d = this.tripJob.get(s);
            if (d === undefined || M.trips.has(d)) {
              d = obj.doors.find((q) => !M.trips.has(q) && ![...this.tripJob.values()].includes(q));
              if (d !== undefined && this.tripJob.size < 2) this.tripJob.set(s, d);
              else d = undefined;
            }
            const n = d !== undefined ? this.doorNode(this.door(d), this.inward(this.door(d))) : null;
            if (d !== undefined && n) {
              const cur = this.orders.get(s);
              if (cur?.kind !== 'trip' || cur.bar !== d) this.give(s, { kind: 'trip', bar: d, node: n });
              continue;
            }
          }
          // and steel over the walls a charge would come through: half of them, the rest there is no time for
          if (M.sheetsOf(s) > 0) {
            let st = this.sheetJob.get(s);
            if (!st || M.sheeted(st) || M.holed(st)) {
              st = M.sheets.length + this.sheetJob.size - (st ? 1 : 0) < Math.ceil(this.sites.length / 2) ? this.sites.find((q) => !M.sheeted(q) && !M.holed(q) && ![...this.sheetJob.values()].includes(q)) : undefined;
              if (st) this.sheetJob.set(s, st);
              else this.sheetJob.delete(s);
            }
            const side = st ? this.siteIn(st) : 1;
            const n = st ? this.siteNode(st, side) : null;
            if (st && n) {
              const cur = this.orders.get(s);
              if (cur?.kind !== 'sheet' || cur.site !== st) this.give(s, { kind: 'sheet', site: st, node: n, side });
              continue;
            }
            if (st) this.sheetJob.delete(s);
          }
        }
        if (spot) {
          const cur = this.orders.get(s);
          if (cur?.kind !== 'hold' || cur.node !== spot.node) this.give(s, { kind: 'hold', node: spot.node, look: spot.look, crouch: M.bots.get(s)!.nerve < 0.55 });
          // the doorway they are coming through is the one to watch
          const hot = this.hotDoor();
          if (hot && cur?.kind === 'hold' && Math.random() < 0.3) cur.look = { x: hot.x, z: hot.z };
        }
      } else {
        if (late) {
          const cur = this.orders.get(s);
          if (cur?.kind !== 'secure') {
            this.give(s, { kind: 'secure', node: this.insideNode(s) });
            M.say(s, pick(['Falling back to the room.', 'Coming back in. Hold fire.', 'Roamer coming home.']), 0.8);
          }
          continue;
        }
        // an attacker known close by, or the room being worked on: the roamer goes for them, from where they aren't looking
        const near = this.knownNear(team, b, 12, 5) || (M.phase === 'live' && (this.liveT > (this.flankAt.get(s) ?? 1e9) || (this.liveT > 15 && (this.flankAt.get(s) ?? 0) < 60 && !!this.hotDoor())));
        if (near && M.phase === 'live') {
          if (this.orders.get(s)?.kind !== 'hunt') this.give(s, { kind: 'hunt' });
        } else if (spot) {
          const cur = this.orders.get(s);
          if (cur?.kind === 'hunt' || !cur) this.give(s, { kind: 'hold', node: spot.node, look: spot.look, crouch: true });
          else if (cur.kind === 'go' && Math.hypot(b.x - spot.node.x, b.z - spot.node.z) < 1) this.give(s, { kind: 'hold', node: spot.node, look: spot.look, crouch: true });
        }
      }
    }
  }

  private anchorOf(team: number): [number, number, number] {
    // where that side started: the middle of whoever is alive on it
    const M = this.M;
    const ps = M.players.filter((p) => p.team === team && p.alive);
    if (!ps.length) return [M.obj!.c.x, M.obj!.c.y, M.obj!.c.z];
    let x = 0, y = 0, z = 0;
    for (const p of ps) {
      const b = M.bodies[p.slot];
      x += b.x; y += b.y; z += b.z;
    }
    return [x / ps.length, y / ps.length, z / ps.length];
  }

  /** a doorway of the room with its boards coming off, or an attacker seen at it */
  private hotDoor(): Opening | null {
    const M = this.M;
    for (const d of M.obj!.doors) {
      const o = this.door(d);
      if (M.bars[d] && M.bars[d] !== BOARDS_ALL) return o;
      if (M.chargeOn(d)) return o;
    }
    const team = 1 - M.atk;
    for (const [, k] of M.intel[team]) {
      if (M.elapsed - k.t > 6) continue;
      let best: Opening | null = null, bd = 7;
      for (const d of M.obj!.doors) {
        const o = this.door(d);
        const dist = Math.hypot(o.x - k.x, o.z - k.z);
        if (dist < bd && Math.abs(o.y - k.y) < 1.5) {
          bd = dist;
          best = o;
        }
      }
      if (best) return best;
    }
    return null;
  }

  private knownNear(team: number, b: { x: number; y: number; z: number }, reach: number, age: number) {
    const M = this.M;
    for (const [slot, k] of M.intel[team]) {
      if (M.elapsed - k.t > age || !M.players.find((p) => p.slot === slot)?.alive) continue;
      if (Math.hypot(k.x - b.x, k.z - b.z) < reach && Math.abs(k.y - b.y) < 3) return k;
    }
    return null;
  }

  /** somewhere in the room for this one: its own each time it is asked, well in from the doorways */
  private insideNode(slot: number): Node {
    const M = this.M, obj = M.obj!;
    const inside = M.nav.nodes.filter((n) => M.inBox(obj.box, n.x, n.y, n.z, -0.5));
    if (!inside.length) return obj.c;
    let best = inside[0], bs = -1e9;
    for (let k = 0; k < 14; k++) {
      const n = inside[Math.floor(Math.random() * inside.length)];
      let s = (n.cover ? 2 : 0) + Math.random() * 2;
      for (const d of obj.doors) {
        const o = this.door(d);
        s += Math.min(4, Math.hypot(o.x - n.x, o.z - n.z)) * 0.5;
      }
      for (const [other, ord] of this.orders) if (other !== slot && ord.kind === 'secure' && Math.hypot(ord.node.x - n.x, ord.node.z - n.z) < 1.5) s -= 6;
      if (s > bs) {
        bs = s;
        best = n;
      }
    }
    return best;
  }

  /** places to stand beside a doorway, outside the room, out of its line */
  private stageNodes(o: Opening, n: number): Node[] {
    const M = this.M, obj = M.obj!;
    const out = -this.inward(o);
    const cands: [number, Node][] = [];
    for (const q of M.nav.nodes) {
      if (Math.abs(q.y - o.y) > 0.8 || M.inBox(obj.box, q.x, q.y, q.z, 0.1)) continue;
      const along = o.alongX ? q.x - o.x : q.z - o.z, across = (o.alongX ? q.z - o.z : q.x - o.x) * out;
      const d = Math.hypot(along, across);
      if (across < 0.4 || d > 6.5 || d < 1.3) continue;
      // beside the doorway, not in front of it
      const beside = Math.abs(along) > o.w / 2 + 0.3;
      cands.push([-Math.abs(d - 3) + (beside ? 4 : 0) + (q.cover ? 1.5 : 0) + Math.random(), q]);
    }
    cands.sort((a, b) => b[0] - a[0]);
    const pickd: Node[] = [];
    for (const [, q] of cands) {
      if (pickd.every((p) => Math.hypot(p.x - q.x, p.z - q.z) >= 1)) pickd.push(q);
      if (pickd.length >= n) break;
    }
    return pickd;
  }

  /** the first step outside the room on the way out of it toward where the attackers started: outside its door, whatever
   *  shape the room and its landing are */
  private wayOut(o: Opening): Node | null {
    const M = this.M, obj = M.obj!;
    const near = this.doorNode(o, -this.inward(o), 1.15) ?? this.doorNode(o, -this.inward(o), 2);
    if (near) return near;
    const to = M.nav.nearest(...this.anchorOf(M.atk));
    const path = to ? M.nav.path(obj.c, to) : [];
    return path.find((n) => !M.inBox(obj.box, n.x, n.y, n.z, 0.3)) ?? null;
  }

  /** on the way from where this one stands to a way in: the last place the room cannot see, a little way short of it */
  private rallyFor(o: Opening, slot: number): Node | null {
    const M = this.M, obj = M.obj!;
    const b = M.bodies[slot];
    const from = M.nav.nearest(b.x, b.y, b.z), to = this.wayOut(o) ?? M.nav.nearest(o.x, o.y, o.z);
    if (!from || !to) return null;
    const path = M.nav.path(from, to);
    let run = 0;
    for (let k = path.length - 2; k > 0; k--) {
      const n = path[k];
      run += Math.hypot(path[k + 1].x - n.x, path[k + 1].z - n.z);
      if (run < 9) continue;
      const seen = obj.doors.some((d) => M.world.open(n.x, n.y + 1.5, n.z, this.door(d).x, this.door(d).y + 1.3, this.door(d).z)) || M.world.open(n.x, n.y + 1.5, n.z, o.x, o.y + 1.3, o.z);
      if (!seen || run > 20) return n;
    }
    return path.length > 6 ? path[Math.max(1, path.length - 16)] : null;
  }

  private attack() {
    const M = this.M, obj = M.obj!;
    const team = M.atk;
    const bots = this.bots(team);
    if (!bots.length) return;
    if (!this.planned[team]) {
      this.planned[team] = true;
      const [ax, ay, az] = this.anchorOf(team);
      const doors = obj.doors.map((d) => this.door(d));
      // the nearest doorway, and the one farthest round the room from it
      const d1 = doors.reduce((b, o) => (Math.hypot(o.x - ax, o.z - az) + Math.abs(o.y - ay) * 4 < Math.hypot(b.x - ax, b.z - az) + Math.abs(b.y - ay) * 4 ? o : b), doors[0]);
      const d2 = doors.reduce((b, o) => (Math.hypot(o.x - d1.x, o.z - d1.z) > Math.hypot(b.x - d1.x, b.z - d1.z) ? o : b), d1);
      const two = d2 !== d1 && bots.length >= 3;
      const n1 = two ? Math.ceil(bots.length * 0.6) : bots.length;
      const mk = (o: Opening, slots: number[]): Group => {
        const st = this.stageNodes(o, slots.length);
        const stage = new Map<number, Node>();
        slots.forEach((s, k) => stage.set(s, st[k % Math.max(1, st.length)] ?? this.wayOut(o) ?? obj.c));
        return { entry: o, alt: o, door: o.i, slots, stage, readyAt: -1, entered: false, flashed: false, enterAt: 0, breacher: -1, rally: this.rallyFor(o, slots[0]), leftAt: -1, openAt: -1 };
      };
      this.groups = [mk(d1, bots.slice(0, n1))];
      if (two) this.groups.push(mk(d2, bots.slice(n1)));
      // one of the groups may come through a wall instead: the piece of it farthest from the other group's door
      const g2 = this.groups[this.groups.length - 1], other = this.groups[0].entry;
      if (this.sites.length && Math.random() < 0.8) {
        const st = this.sites.reduce((b, q) => (Math.hypot(siteMid(q).x - other.x, siteMid(q).z - other.z) > Math.hypot(siteMid(b).x - other.x, siteMid(b).z - other.z) ? q : b), this.sites[0]);
        const asd = this.asDoor(st);
        if (this.siteNode(st, -this.siteIn(st))) {
          const ng = mk(asd, g2.slots);
          ng.wall = st;
          ng.alt = g2.entry;
          this.groups[this.groups.length - 1] = ng;
        }
      }
      // first to somewhere near it that the room cannot see, and together from there
      for (const g of this.groups) for (const s of g.slots) this.give(s, { kind: 'go', node: g.rally ?? g.stage.get(s)!, look: { x: g.entry.x, z: g.entry.z } });
      M.say(bots[0], pick([`Two ways in. Stack up on the ${M.objName()}.`, `Moving on the ${M.objName()}.`, 'On me. Quiet until we breach.']));
    }
    const rush = M.clock < 38;
    const anyEntered = this.groups.some((g) => g.entered);
    for (const g of this.groups) {
      g.slots = g.slots.filter((s) => bots.includes(s));
      if (!g.slots.length) continue;
      const o = g.entry;
      if (g.entered) {
        // in: anyone still outside follows; anyone in stays in
        for (const s of g.slots) {
          const sweep = this.contestT > 4 && this.liveT >= (this.sweepAt.get(s) ?? 0);
          if (sweep) this.sweepAt.set(s, this.liveT + 4 + Math.random() * 3);
          if (this.orders.get(s)?.kind !== 'secure' || sweep) this.give(s, { kind: 'secure', node: this.insideNode(s) });
        }
        continue;
      }
      if (g.leftAt < 0 && !rush) {
        // formed up? then to the wall beside the way in. Nobody waits for ever for someone who is not coming
        const r = g.rally;
        const near = r ? g.slots.filter((s) => Math.hypot(M.bodies[s].x - r.x, M.bodies[s].z - r.z) < 4 && Math.abs(M.bodies[s].y - r.y) < 1.5).length : g.slots.length;
        if (!g.rallied && near >= g.slots.length) g.rallied = this.liveT;
        if ((g.rallied !== undefined && this.liveT - g.rallied > 5 && this.liveT > 30) || this.liveT > 45) {
          g.leftAt = this.liveT;
          for (const s of g.slots) this.give(s, { kind: 'go', node: g.stage.get(s)!, look: { x: o.x, z: o.z } });
          M.say(g.slots[0], pick(['Moving up. Stack on the wall.', 'On the door. Quiet.', 'Up to it. Slow.']), 0.8);
        }
        continue;
      }
      if (rush) {
        g.entered = true;
        M.say(g.slots[0], pick(['No time. Go, go, go!', 'Clock is running out. Push!', 'Everybody in, now!']));
        continue;
      }
      // there?
      const there = g.slots.filter((s) => {
        const b = M.bodies[s], n = g.stage.get(s)!;
        return Math.hypot(b.x - n.x, b.z - n.z) < 2.2 && Math.abs(b.y - n.y) < 1;
      }).length;
      if (g.readyAt < 0 && (there >= Math.ceil(g.slots.length * 0.6) || this.liveT > 55)) g.readyAt = this.liveT;
      if (g.readyAt < 0) continue;
      // wait a little for the other group, not for ever
      const others = this.groups.filter((q) => q !== g && q.slots.length);
      const wait = others.some((q) => q.readyAt < 0) && this.liveT - g.readyAt < 14 && !anyEntered;
      // a breath at the door first: everyone in place, a word on the radio
      if (!g.wall && (wait || this.liveT - g.readyAt < 4)) continue;
      if (g.wall && !M.holed(g.wall)) {
        const cur = g.slots.includes(g.breacher) ? this.orders.get(g.breacher) : undefined;
        if (M.sheeted(g.wall) || (cur?.kind === 'wbreach' && cur.failed) || this.liveT - g.readyAt > 22) {
          // steel on the other side of it, or no way to set the thing: the door after all
          M.say(g.slots[0], pick(['Wall is no good. Take the door.', "It's sheeted. Door, go."]), 0.9);
          g.wall = undefined;
          g.entry = g.alt;
          g.door = g.alt.i;
          g.breacher = -1;
          const st2 = this.stageNodes(g.alt, g.slots.length);
          g.slots.forEach((s, k) => {
            const n = st2[k % Math.max(1, st2.length)] ?? this.wayOut(g.alt) ?? M.obj!.c;
            g.stage.set(s, n);
            this.give(s, { kind: 'go', node: n, look: { x: g.alt.x, z: g.alt.z }, fast: true });
          });
          g.readyAt = this.liveT;
          continue;
        }
        if (!g.slots.includes(g.breacher)) {
          const side = -this.siteIn(g.wall);
          const n = this.siteNode(g.wall, side);
          g.breacher = g.slots.reduce((b, s) => (M.chargesOf(s) > M.chargesOf(b) ? s : b), g.slots[0]);
          if (n && M.chargesOf(g.breacher) > 0) this.give(g.breacher, { kind: 'wbreach', site: g.wall, node: n, side });
          else g.readyAt = -99;
        }
        continue;
      }
      if (g.door >= 0 && !barPassable(M.bars[g.door])) {
        // a look inside first, if anyone here carries the scope
        if (g.scoped === undefined) {
          g.scoped = this.liveT;
          const sc = g.slots.find((s) => M.kitOf(s) === 'scout');
          const n = sc !== undefined ? this.wayOut(o) : null;
          if (sc !== undefined && n) this.give(sc, { kind: 'scope', bar: g.door, node: n });
          else g.scoped = -99;
        }
        if (g.scoped > 0 && this.liveT - g.scoped < 6 && g.slots.some((s) => { const c = this.orders.get(s); return c?.kind === 'scope' && !c.done; })) continue;
        // the boards have to come out first
        if (!g.slots.includes(g.breacher)) {
          g.breacher = g.slots.reduce((b, s) => (Math.hypot(M.bodies[s].x - o.x, M.bodies[s].z - o.z) < Math.hypot(M.bodies[b].x - o.x, M.bodies[b].z - o.z) ? s : b), g.slots[0]);
          const n = this.wayOut(o);
          if (n) this.give(g.breacher, { kind: 'breach', bar: g.door, node: n });
          M.say(g.breacher, pick(['Breaching!', 'Setting the charge.', 'Taking the door.']));
        }
        // boards that will not come out are not a reason to stand there all day: through them, boots first
        if (this.liveT - g.readyAt > 26) g.entered = true;
        continue;
      }
      // open. A while at the edge of it first, shooting at whatever shows itself, before anyone goes through
      if (g.openAt < 0) g.openAt = this.liveT + 4 + Math.random() * 5;
      if (this.liveT < g.openAt && !anyEntered) continue;
      // then something bright through it, and in
      if (!g.flashed) {
        g.flashed = true;
        // whoever is nearest the frame tosses one round it; the rest go on the bang
        const inw = this.inward(o);
        const by = [...g.slots].sort((a, b) => Math.hypot(M.bodies[a].x - o.x, M.bodies[a].z - o.z) - Math.hypot(M.bodies[b].x - o.x, M.bodies[b].z - o.z));
        for (const s of by) {
          const q = M.bodies[s];
          if (Math.hypot(q.x - o.x, q.z - o.z) > 7 || !M.bots.get(s)?.spend('flash')) continue;
          const ox = o.x - (o.alongX ? 0 : inw * 0.25), oz = o.z - (o.alongX ? inw * 0.25 : 0);
          const side = (Math.random() - 0.5) * 2.4;
          M.toss(s, 'flash', [ox, o.y + 1.3, oz], [o.alongX ? side : inw * 6.5, 1.6, o.alongX ? inw * 6.5 : side]);
          g.enterAt = this.liveT + 1.85;
          break;
        }
        continue;
      }
      if (this.liveT < g.enterAt) continue;
      g.entered = true;
      M.say(g.slots[0], pick(['Going in!', 'Move, move!', 'Entry!']));
    }
  }
}

/** how careful the last defender has to be to leave a taken room to them (0: nobody does) */
const LONE_STAYS_OUT = 0.5;

function pick<T>(a: T[]): T {
  return a[Math.floor(Math.random() * a.length)];
}
