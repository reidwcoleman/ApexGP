import type { Game } from './game.ts';
import { soft } from './walls.ts';

/**
 * The plan of the floor the room is on, drawn from the building's own colliders: what the side breaking in studies while
 * it waits to go, and what anyone can pull up with M. North is up. It shows only what a side would know: the walls, which
 * of them are thin enough to go through, the doorways and whether there are boards across them (as last seen by anyone,
 * which here is always), its own people, and whoever the scope has marked. The defenders' own steel, cameras and wires are
 * drawn for the defenders alone.
 */
const SIZE = 380, PAD = 13;

export class TacMap {
  readonly el = document.createElement('div');
  private cv = document.createElement('canvas');
  private base = document.createElement('canvas');
  private head = document.createElement('b');
  private foot = document.createElement('span');
  private open = false;
  private key = '';
  private dpr = Math.min(2, window.devicePixelRatio || 1);

  constructor() {
    this.el.className = 'tmap';
    for (const c of [this.cv, this.base]) {
      c.width = c.height = SIZE * this.dpr;
    }
    this.el.append(this.head, this.cv, this.foot);
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !e.repeat && !(e.target instanceof HTMLInputElement)) this.open = !this.open;
    });
  }

  /** the walls of this floor, once a round (and again when one of them changes) */
  private bake(g: Game, cx: number, cz: number, span: number, y0: number, stamp: string) {
    this.key = stamp;
    const c = this.base.getContext('2d')!;
    const S = SIZE * this.dpr, k = S / span;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, S, S);
    c.fillStyle = 'rgba(8,10,12,.82)';
    c.fillRect(0, 0, S, S);
    const o = g.obj!;
    c.fillStyle = 'rgba(231,165,91,.16)';
    c.fillRect((o[0] - cx) * k + S / 2, (o[2] - cz) * k + S / 2, (o[3] - o[0]) * k, (o[5] - o[2]) * k);
    for (const b of g.L.world.boxes) {
      if (b.off || b.slab || (b.tag !== 'int' && b.tag !== 'ext' && b.tag !== 'wall')) continue;
      if (b.max[1] < y0 + 1.5 || b.min[1] > y0 + 0.6) continue;
      if (b.max[0] < cx - span / 2 || b.min[0] > cx + span / 2 || b.max[2] < cz - span / 2 || b.min[2] > cz + span / 2) continue;
      c.fillStyle = soft(b) ? '#a89a7c' : '#62676c';
      const w = Math.max(1.5 * this.dpr, (b.max[0] - b.min[0]) * k), h = Math.max(1.5 * this.dpr, (b.max[2] - b.min[2]) * k);
      c.fillRect((b.min[0] - cx) * k + S / 2, (b.min[2] - cz) * k + S / 2, w, h);
    }
  }

  draw(g: Game) {
    const show = g.cfg?.mode === 'siege' && !!g.obj && g.inMatch && (this.open || (g.phase === 'prep' && g.attacking())) && (g.phase === 'prep' || g.phase === 'live') && g.camView < 0 && g.scopeView < 0;
    this.el.classList.toggle('on', show);
    if (!show) {
      if (g.phase !== 'prep' && g.phase !== 'live') this.open = false;
      return;
    }
    const o = g.obj!;
    const brief = g.phase === 'prep' && g.attacking();
    this.el.classList.toggle('brief', brief);
    const cx = (o[0] + o[3]) / 2, cz = (o[2] + o[5]) / 2, y0 = o[1];
    const span = Math.max(o[3] - o[0], o[5] - o[2]) + PAD * 2;
    const stamp = `${o.join()}|${g.walls.holes.length}|${g.round}`;
    if (stamp !== this.key) this.bake(g, cx, cz, span, y0, stamp);
    const c = this.cv.getContext('2d')!;
    const S = SIZE * this.dpr, k = S / span, d = this.dpr;
    const X = (x: number) => (x - cx) * k + S / 2, Z = (z: number) => (z - cz) * k + S / 2;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, S, S);
    c.drawImage(this.base, 0, 0);
    const mine = !g.attacking();
    // doorways: a bar across each that is boarded
    for (const f of g.forts) {
      if (Math.abs(f.o.y - y0) > 0.8 || !f.boards) continue;
      c.strokeStyle = '#c9a26b';
      c.lineWidth = 3 * d;
      c.beginPath();
      if (f.o.alongX) { c.moveTo(X(f.o.x - f.o.w / 2), Z(f.o.z)); c.lineTo(X(f.o.x + f.o.w / 2), Z(f.o.z)); }
      else { c.moveTo(X(f.o.x), Z(f.o.z - f.o.w / 2)); c.lineTo(X(f.o.x), Z(f.o.z + f.o.w / 2)); }
      c.stroke();
    }
    if (mine) {
      // the defenders' own work: steel, cameras, wires
      c.strokeStyle = '#dfe4e8';
      c.lineWidth = 4 * d;
      for (const h of g.walls.sheets) {
        const s = h.s;
        if (Math.abs(s.y0 - y0) > 0.8) continue;
        c.beginPath();
        if (s.ax) { c.moveTo(X(s.u0), Z(s.c)); c.lineTo(X(s.u1), Z(s.c)); }
        else { c.moveTo(X(s.c), Z(s.u0)); c.lineTo(X(s.c), Z(s.u1)); }
        c.stroke();
      }
      for (const cam of g.gear.cams) {
        if (Math.abs(cam.pos.y - y0 - 2.3) > 1.2) continue;
        c.fillStyle = cam.dead ? 'rgba(231,231,226,.3)' : '#e7e7e2';
        const x = X(cam.pos.x), z = Z(cam.pos.z), fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
        c.beginPath();
        c.moveTo(x, z);
        c.lineTo(x + (fx * 14 - fz * 7) * d, z + (fz * 14 + fx * 7) * d);
        c.lineTo(x + (fx * 14 + fz * 7) * d, z + (fz * 14 - fx * 7) * d);
        c.closePath();
        c.globalAlpha = 0.35;
        c.fill();
        c.globalAlpha = 1;
        c.fillRect(x - 2.5 * d, z - 2.5 * d, 5 * d, 5 * d);
      }
      c.strokeStyle = '#e5392c';
      c.lineWidth = 1.5 * d;
      for (const t of g.gear.trips.values()) {
        if (Math.abs(t.o.y - y0) > 0.8) continue;
        c.beginPath();
        if (t.o.alongX) { c.moveTo(X(t.o.x - t.o.w / 2), Z(t.o.z) + 3 * d); c.lineTo(X(t.o.x + t.o.w / 2), Z(t.o.z) + 3 * d); }
        else { c.moveTo(X(t.o.x) + 3 * d, Z(t.o.z - t.o.w / 2)); c.lineTo(X(t.o.x) + 3 * d, Z(t.o.z + t.o.w / 2)); }
        c.stroke();
      }
    }
    // the other side, where the scope saw them
    for (const q of g.spots) {
      const x = X(q.x), z = Z(q.z);
      c.strokeStyle = '#e5392c';
      c.lineWidth = 1.5 * d;
      c.strokeRect(x - 4 * d, z - 4 * d, 8 * d, 8 * d);
    }
    // my own side
    const my = g.player(g.mySlot)?.team ?? 0;
    for (const a of g.actors.values()) {
      if (!a.info.alive || a.info.team !== my || a.info.slot === g.mySlot || Math.abs(a.y - y0) > 2.2) continue;
      const x = X(a.x), z = Z(a.z);
      if (x < 0 || z < 0 || x > S || z > S) continue;
      c.fillStyle = a.info.down ? '#e5392c' : my === 0 ? '#8db4e8' : '#e7a55b';
      c.beginPath();
      c.arc(x, z, 3.5 * d, 0, 6.3);
      c.fill();
    }
    const m = g.me.m;
    const mx = Math.min(S - 8 * d, Math.max(8 * d, X(m.x))), mz = Math.min(S - 8 * d, Math.max(8 * d, Z(m.z)));
    const fx = -Math.sin(g.me.yaw), fz = -Math.cos(g.me.yaw);
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(mx + fx * 8 * d, mz + fz * 8 * d);
    c.lineTo(mx + (-fx * 5 - fz * 5) * d, mz + (-fz * 5 + fx * 5) * d);
    c.lineTo(mx + (-fx * 5 + fz * 5) * d, mz + (-fz * 5 - fx * 5) * d);
    c.closePath();
    c.fill();
    const off = Math.abs(m.y - y0) > 2.2;
    const head = `${brief ? 'BRIEFING' : 'PLAN'}   ${g.objName.toUpperCase()}`;
    if (this.head.textContent !== head) this.head.textContent = head;
    const foot = (off ? 'You are on another floor.   ' : '') + (mine ? 'Pale walls can be breached: steel them.   M closes' : brief ? 'Pale walls are thin: a charge goes through them. Bars are boarded doorways.' : 'Pale walls are thin: a charge goes through.   M closes');
    if (this.foot.textContent !== foot) this.foot.textContent = foot;
  }
}
