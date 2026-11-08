// Real-time battle simulation. Every soldier is simulated: formations, melee
// duels, cavalry charges with impact, flanking, missiles with ballistic arcs,
// shields, morale, routing and rallying. DOM-free.
import { UNITS } from '../data/units.js';
import { mulberry32, fbm, noise2, smooth } from '../util/noise.js';

export const FIELD = 360;      // half-size of the playable field (m)
export const TERRAIN = 900;    // half-size of the terrain drawn
const CELL = 4, HG = Math.ceil((FIELD * 2 + 120) / CELL), HOFF = FIELD + 60;
const G = 9.8;

const RADIUS = { inf: 0.42, spear: 0.42, pike: 0.42, missile: 0.4, cav: 1.0, harcher: 1.0, elephant: 2.4 };
const MASS = { inf: 1, spear: 1.1, pike: 1.1, missile: 0.9, cav: 5, harcher: 4, elephant: 22 };
const REACH = { gladius: 0.75, sword: 0.85, falx: 0.95, spear: 1.6, pike: 3.4, lance: 1.6, javelin: 0.8, bow: 0.6, sling: 0.6, none: 0.6 };
const SPACING = { inf: [1.25, 1.5], spear: [1.15, 1.4], pike: [1.0, 1.25], missile: [1.5, 1.6], cav: [2.5, 3.6], harcher: [3.0, 3.8], elephant: [7, 8] };

// Activated abilities. dur/cd in seconds of battle time.
export const ABIL = {
  pila:    { name: 'Hurl Pila',   key: 'Z', dur: 0,  cd: 0,  desc: 'Throw a volley of heavy javelins at the nearest enemy (once per battle).' },
  testudo: { name: 'Testudo',     key: 'T', toggle: true, desc: 'Lock shields on every side. Arrows glance off; slow and weaker in melee.' },
  phalanx: { name: 'Shield Wall', key: 'T', toggle: true, desc: 'Close ranks and brace spears. Murderous to the front, cavalry break on it.' },
  charge:  { name: 'Charge!',     key: 'X', dur: 10, cd: 50, desc: 'A furious charge: faster, harder hitting, double charge impact.' },
  wedge:   { name: 'Wedge',       key: 'X', dur: 12, cd: 45, desc: 'Form a wedge: the charge smashes through twice as many men.' },
  warcry:  { name: 'War Cry',     key: 'C', dur: 15, cd: 70, desc: 'A terrifying howl. Nearby enemies lose heart, your men fight harder.' },
  fire:    { name: 'Fire Arrows', key: 'C', dur: 25, cd: 60, desc: 'Burning missiles: more damage and they shake morale.' },
  rally:   { name: 'Rally',       key: 'G', dur: 15, cd: 45, desc: 'Rally routing and wavering units around the general.' },
  inspire: { name: 'Inspire',     key: 'V', dur: 20, cd: 75, desc: 'The general fires up every unit near him: +attack, +morale.' },
};

export function isCav(t) { return t.cls === 'cav' || t.cls === 'harcher' || t.cls === 'elephant'; }

export function makeTerrain(seed, biome) {
  const amp = { temperate: 9, med: 11, arid: 7, desert: 8, steppe: 4, boreal: 12 }[biome] ?? 8;
  const N = 301, step = (TERRAIN * 2) / (N - 1);
  const h = new Float32Array(N * N);
  const rng = mulberry32(seed);
  const hills = Array.from({ length: 3 }, () => ({ x: (rng() - 0.5) * 500, z: (rng() - 0.5) * 300, r: 60 + rng() * 80, a: (rng() * 0.8 + 0.3) * amp }));
  const sd = Math.floor(rng() * 1000);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -TERRAIN + i * step, z = -TERRAIN + j * step;
    let v = fbm(x / 260, z / 260, 4, sd) * amp + fbm(x / 70, z / 70, 3, sd + 9) * amp * 0.18;
    if (biome === 'desert') v += Math.abs(noise2(x / 90 + z / 300, z / 140, sd + 3)) * amp * 0.5;
    for (const hl of hills) { const d = Math.hypot(x - hl.x, z - hl.z); v += hl.a * Math.exp(-((d / hl.r) ** 2)); }
    const edge = Math.max(Math.abs(x), Math.abs(z));
    v += smooth(FIELD + 60, TERRAIN, edge) * amp * 4 * (0.6 + 0.4 * fbm(x / 120, z / 120, 3, sd + 5));
    // keep the deployment zones fairly even
    const dz = Math.min(Math.abs(z - 170), Math.abs(z + 170));
    v *= 0.55 + 0.45 * smooth(20, 90, dz);
    h[j * N + i] = v;
  }
  return {
    N, step, h, biome, amp,
    at(x, z) {
      let fx = (x + TERRAIN) / step, fz = (z + TERRAIN) / step;
      fx = Math.max(0, Math.min(N - 1.001, fx)); fz = Math.max(0, Math.min(N - 1.001, fz));
      const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * N + i;
      return (h[k] * (1 - tx) + h[k + 1] * tx) * (1 - tz) + (h[k + N] * (1 - tx) + h[k + N + 1] * tx) * tz;
    },
  };
}

export class BattleSim {
  // cfg: { sides:[{owner,color,name,units:[{t,n,xp}],gen:{name,stars},player:bool}], biome, seed, walls, attacker }
  constructor(cfg) {
    this.cfg = cfg;
    this.rng = mulberry32(cfg.seed || 7);
    this.terrain = makeTerrain(cfg.seed || 7, cfg.biome || 'temperate');
    this.time = 0;
    this.phase = 'deploy';
    this.winner = -1;
    this.events = [];
    this.timeLimit = 60 * 22;
    let total = 0;
    for (const s of cfg.sides) for (const u of s.units) total += Math.max(1, Math.round(u.n));
    const N = total;
    this.N = N;
    this.sx = new Float32Array(N); this.sz = new Float32Array(N); this.svx = new Float32Array(N); this.svz = new Float32Array(N);
    this.sface = new Float32Array(N); this.shp = new Float32Array(N); this.scd = new Float32Array(N); this.satk = new Float32Array(N).fill(9);
    this.sphase = new Float32Array(N); this.sspd = new Float32Array(N); this.sunit = new Int16Array(N); this.salive = new Uint8Array(N);
    this.sdeadT = new Float32Array(N); this.sfall = new Float32Array(N); this.starget = new Int32Array(N).fill(-1); this.sstag = new Float32Array(N);
    this.scharge = new Uint8Array(N); this.sammo = new Uint8Array(N); this.sseek = new Float32Array(N); this.simpacts = new Uint8Array(N);
    this.sslot = new Int32Array(N); this.sjit = new Float32Array(N * 2);
    this.head = new Int32Array(HG * HG); this.next = new Int32Array(N);
    // projectiles
    const PM = 4000;
    this.PM = PM;
    this.px = new Float32Array(PM); this.py = new Float32Array(PM); this.pz = new Float32Array(PM);
    this.pvx = new Float32Array(PM); this.pvy = new Float32Array(PM); this.pvz = new Float32Array(PM);
    this.pdelay = new Float32Array(PM); this.pkind = new Uint8Array(PM); this.pfire = new Uint8Array(PM); this.pside = new Uint8Array(PM); this.pdmg = new Float32Array(PM); this.pon = new Uint8Array(PM); this.punit = new Int16Array(PM);
    this.pnext = 0;
    this.stuck = []; // landed missiles for the renderer: {x,y,z,dx,dy,dz,kind}
    this.units = [];
    this.history = [];
    this.histT = 0;
    this.sides = cfg.sides.map((s, si) => ({ ...s, idx: si, genUnit: -1, genDead: false, strength0: 0, routed: 0 }));
    let k = 0;
    cfg.sides.forEach((s, si) => {
      s.units.forEach((cu, ci) => {
        const t = UNITS[cu.t];
        const n = Math.max(1, Math.round(cu.n));
        const sp = SPACING[t.cls];
        const cols = t.cls === 'elephant' ? Math.min(n, 8) : t.cls === 'cav' || t.cls === 'harcher' ? Math.min(n, Math.max(8, Math.ceil(n / 2))) : Math.min(n, Math.max(8, Math.round(Math.sqrt(n * 3.6))));
        const u = {
          id: this.units.length, side: si, t, ci, n0: n, alive: n, escaped: 0, slots: [], cols, spX: sp[0], spZ: sp[1],
          ax: 0, az: 0, fx: 0, cx: 0, cz: 0, run: false, order: { kind: 'hold' }, mstate: 0, morale: t.morale, mTarget: t.morale,
          routT: 0, routCount: 0, kills: 0, losses: [], flankT: -99, rearT: -99, ability: false, rallyCD: 0, rallyUntil: 0,
          xp: cu.xp || 0, up: cu.up || 0, general: !!t.general, pilaDone: false, fireTarget: -1, engaged: false, lastFight: -99, skirmish: !!t.range,
          reach: REACH[t.look.weapon] ?? 0.8, rad: RADIUS[t.cls], mass: MASS[t.cls], hp: t.hp, selected: false, mtick: this.rng() * 0.25,
          ammo0: t.ammo || 0, chargeT: -99,
          fatigue: 0, abil: {}, abilList: abilitiesFor(t), warcryT: -99, burnT: -99, inspireUntil: 0, chargeHitT: -99, flankEvT: -99,
        };
        if (u.general) this.sides[si].genUnit = u.id;
        for (let i = 0; i < n; i++) {
          const id = k++;
          this.sunit[id] = u.id; this.salive[id] = 1; this.shp[id] = t.hp; this.sammo[id] = t.ammo || 0;
          this.sslot[id] = i; u.slots.push(id);
          this.sjit[id * 2] = (this.rng() - 0.5) * 0.35; this.sjit[id * 2 + 1] = (this.rng() - 0.5) * 0.35;
          this.sphase[id] = this.rng() * 6.28; this.scd[id] = this.rng() * 1.5;
        }
        this.units.push(u);
      });
    });
    this.N = k;
    this.deployAll();
    for (const s of this.sides) s.strength0 = this.sideStrength(s.idx);
  }

  height(x, z) { return this.terrain.at(x, z); }

  // ------------------------------------------------------------ deployment
  zoneOf(side) { const z0 = side === this.cfg.attacker ? 170 : -170; return { zMin: z0 - 70, zMax: z0 + 70, xMin: -200, xMax: 200, z0 }; }
  sideFacing(side) { return side === this.cfg.attacker ? Math.PI : 0; } // attacker at +z faces -z

  deployAll() {
    for (let si = 0; si < this.sides.length; si++) {
      const us = this.units.filter((u) => u.side === si);
      const zone = this.zoneOf(si);
      const fa = this.sideFacing(si);
      const fwd = Math.cos(fa); // +1 → faces +z
      const groups = { line: [], missile: [], cav: [], gen: [], ele: [] };
      for (const u of us) {
        if (u.general) groups.gen.push(u);
        else if (u.t.cls === 'elephant') groups.ele.push(u);
        else if (u.t.cls === 'cav' || u.t.cls === 'harcher') groups.cav.push(u);
        else if (u.t.cls === 'missile') groups.missile.push(u);
        else groups.line.push(u);
      }
      const place = (list, z, gap) => {
        const widths = list.map((u) => Math.min(u.cols, u.alive) * u.spX);
        const total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, list.length - 1);
        let x = -total / 2;
        list.forEach((u, i) => { this.placeUnit(u, (x + widths[i] / 2) * (fwd > 0 ? -1 : 1), z, fa); x += widths[i] + gap; });
        return total;
      };
      const lineW = place(groups.line, zone.z0 - fwd * 5, 6);
      place(groups.missile, zone.z0 - fwd * 28, 8);
      place(groups.ele, zone.z0 - fwd * 45, 12);
      const half = Math.max(lineW / 2, 60);
      groups.cav.forEach((u, i) => {
        const sideSign = i % 2 === 0 ? -1 : 1, rank = Math.floor(i / 2);
        this.placeUnit(u, sideSign * (half + 30 + rank * 40), zone.z0 - fwd * 2, fa);
      });
      groups.gen.forEach((u) => this.placeUnit(u, 0, zone.z0 + fwd * 35, fa));
    }
  }

  placeUnit(u, x, z, face) {
    u.ax = x; u.az = z; u.fx = face; u.order = { kind: 'hold' };
    const s = this.slotFrame(u);
    for (let k = 0; k < u.slots.length; k++) {
      const i = u.slots[k];
      const p = this.slotPos(u, s, k, i);
      this.sx[i] = p[0]; this.sz[i] = p[1]; this.sface[i] = face; this.svx[i] = 0; this.svz[i] = 0;
    }
    u.cx = x; u.cz = z;
  }

  canDeploy(side, x, z) { const zn = this.zoneOf(side); return z > zn.zMin && z < zn.zMax && x > zn.xMin - 120 && x < zn.xMax + 120; }

  // ------------------------------------------------------------ formation geometry
  slotFrame(u) {
    const n = u.slots.length;
    let cols = Math.max(1, Math.min(u.cols, n));
    let spX = u.spX, spZ = u.spZ;
    if (u.ability && u.t.ability === 'testudo') { cols = Math.max(4, Math.round(Math.sqrt(n * 1.3))); spX = 0.95; spZ = 0.95; }
    else if (u.ability && u.t.ability === 'phalanx') { spX *= 0.82; spZ *= 0.85; }
    const fx = Math.sin(u.fx), fz = Math.cos(u.fx); // forward
    const rx = Math.cos(u.fx), rz = -Math.sin(u.fx); // right
    return { n, cols, spX, spZ, fx, fz, rx, rz, rows: Math.ceil(n / cols) };
  }
  slotPos(u, f, k, i) {
    const row = Math.floor(k / f.cols), col = k % f.cols;
    const inRow = row === f.rows - 1 ? f.n - row * f.cols : f.cols;
    const ox = (col - (inRow - 1) / 2) * f.spX + this.sjit[i * 2];
    const oz = -row * f.spZ + this.sjit[i * 2 + 1];
    return [u.ax + f.rx * ox + f.fx * oz, u.az + f.rz * ox + f.fz * oz];
  }
  unitDepth(u) { const f = this.slotFrame(u); return f.rows * f.spZ; }
  unitWidth(u) { const f = this.slotFrame(u); return Math.min(f.cols, f.n) * f.spX; }

  // ------------------------------------------------------------ orders
  orderMove(id, x, z, face, run = false) {
    const u = this.units[id]; if (!u || u.mstate >= 2 || u.alive <= 0) return;
    x = Math.max(-FIELD, Math.min(FIELD, x)); z = Math.max(-FIELD, Math.min(FIELD, z));
    if (this.phase === 'deploy') {
      if (!this.canDeploy(u.side, x, z)) { const zn = this.zoneOf(u.side); z = Math.max(zn.zMin + 2, Math.min(zn.zMax - 2, z)); x = Math.max(zn.xMin - 118, Math.min(zn.xMax + 118, x)); }
      this.placeUnit(u, x, z, face ?? u.fx); return;
    }
    u.order = { kind: 'move', x, z, face: face ?? Math.atan2(x - u.cx, z - u.cz) };
    u.run = run; u.fireTarget = -1;
  }
  orderWidth(id, cols) { const u = this.units[id]; if (u) u.cols = Math.max(2, Math.min(u.alive, Math.round(cols))); }
  orderAttack(id, target, run = false) {
    const u = this.units[id], t = this.units[target];
    if (!u || !t || u.side === t.side || u.mstate >= 2 || this.phase === 'deploy') return;
    u.order = { kind: 'attack', target };
    u.run = run;
    if (u.t.range && u.ammo0 > 0) u.fireTarget = target;
  }
  orderHalt(id) { const u = this.units[id]; if (!u || u.mstate >= 2) return; u.order = { kind: 'hold' }; u.ax = u.cx; u.az = u.cz; u.fireTarget = -1; }
  setRun(id, on) { const u = this.units[id]; if (u) u.run = on; }
  setAbility(id, on) {
    const u = this.units[id]; if (!u || !u.t.ability) return;
    u.ability = on;
    if (on && u.t.ability === 'testudo') u.run = false;
  }
  rally(id) {
    const g = this.units[id];
    if (!g || !g.general || g.rallyCD > this.time || g.alive <= 0) return false;
    g.rallyCD = this.time + 45;
    for (const u of this.units) if (u.side === g.side && u.alive > 0 && Math.hypot(u.cx - g.cx, u.cz - g.cz) < 90) {
      u.rallyUntil = this.time + 15; u.morale = Math.max(u.morale, 45);
      if (u.mstate === 2 && u.routCount < 2) { u.mstate = 0; u.order = { kind: 'hold' }; u.ax = u.cx; u.az = u.cz; }
    }
    this.events.push({ type: 'rally', x: g.cx, z: g.cz, side: g.side });
    return true;
  }

  start() { this.phase = 'battle'; this.events.push({ type: 'start' }); }

  active(u, key) { const a = u.abil[key]; return !!a && this.time < a.until; }
  cooldown(u, key) {
    if (key === 'rally') return Math.max(0, u.rallyCD - this.time);
    if (key === 'pila') return u.pilaDone ? Infinity : 0;
    const a = u.abil[key]; return a ? Math.max(0, a.ready - this.time) : 0;
  }
  useAbility(id, key) {
    const u = this.units[id];
    if (!u || u.alive <= 0 || u.mstate >= 2 || this.phase !== 'battle' || !u.abilList.includes(key)) return false;
    if (key === 'testudo' || key === 'phalanx') { this.setAbility(id, !u.ability); return true; }
    if (key === 'rally') return this.rally(id);
    if (key === 'pila') {
      if (u.pilaDone) return false;
      let best = null, bd = 40;
      for (const e of this.units) { if (e.side === u.side || e.alive <= 0 || e.mstate >= 2) continue; const d = Math.hypot(e.cx - u.cx, e.cz - u.cz); if (d < bd) { bd = d; best = e; } }
      if (!best) return false;
      this.throwPila(u, best); return true;
    }
    const a = u.abil[key] || (u.abil[key] = { until: 0, ready: 0 });
    if (this.time < a.ready) return false;
    const M = ABIL[key];
    a.until = this.time + M.dur; a.ready = this.time + M.cd;
    if (key === 'charge') { u.run = true; u.chargeT = this.time; u.chargeStarted = false; }
    if (key === 'warcry') for (const e of this.units) if (e.side !== u.side && e.alive > 0 && Math.hypot(e.cx - u.cx, e.cz - u.cz) < 50) e.warcryT = this.time;
    if (key === 'inspire') for (const f of this.units) if (f.side === u.side && f.alive > 0 && Math.hypot(f.cx - u.cx, f.cz - u.cz) < 80) f.inspireUntil = this.time + M.dur;
    this.events.push({ type: 'ability', key, unit: id, side: u.side, x: u.cx, z: u.cz });
    return true;
  }

  // ------------------------------------------------------------ helpers
  sideStrength(side) {
    let s = 0;
    for (const u of this.units) if (u.side === side && u.mstate < 2) s += u.alive * (u.t.hp / 10) * (u.t.atk + u.t.def + u.t.armor) * (u.t.cls === 'elephant' ? 3 : 1);
    return s;
  }
  activeUnits(side) { return this.units.filter((u) => u.side === side && u.alive > 0 && u.mstate < 2); }

  buildHash() {
    this.head.fill(-1);
    for (let i = 0; i < this.N; i++) {
      if (this.salive[i] !== 1) continue;
      const cx = Math.max(0, Math.min(HG - 1, ((this.sx[i] + HOFF) / CELL) | 0));
      const cz = Math.max(0, Math.min(HG - 1, ((this.sz[i] + HOFF) / CELL) | 0));
      const c = cz * HG + cx;
      this.next[i] = this.head[c]; this.head[c] = i;
    }
  }

  // nearest living enemy soldier within r of (x,z); prefer a unit if given
  nearestEnemy(x, z, side, r, prefer = -1) {
    const c0x = ((x + HOFF) / CELL) | 0, c0z = ((z + HOFF) / CELL) | 0;
    const cr = Math.ceil(r / CELL);
    let best = -1, bd = r * r, bestP = -1, bdP = r * r;
    for (let dz = -cr; dz <= cr; dz++) {
      const cz = c0z + dz; if (cz < 0 || cz >= HG) continue;
      for (let dx = -cr; dx <= cr; dx++) {
        const cx = c0x + dx; if (cx < 0 || cx >= HG) continue;
        for (let j = this.head[cz * HG + cx]; j >= 0; j = this.next[j]) {
          const uj = this.units[this.sunit[j]];
          if (uj.side === side) continue;
          const d = (this.sx[j] - x) ** 2 + (this.sz[j] - z) ** 2;
          if (d < bd) { bd = d; best = j; }
          if (prefer >= 0 && uj.id === prefer && d < bdP) { bdP = d; bestP = j; }
        }
      }
    }
    return bestP >= 0 && bdP < bd * 4 ? bestP : best;
  }

  // ------------------------------------------------------------ main step
  step(dt) {
    if (this.winner >= 0 && this.phase === 'over') return;
    this.buildHash();
    if (this.phase === 'battle') this.time += dt;
    for (const u of this.units) this.updateUnit(u, dt);
    if (this.phase === 'battle') { this.histT -= dt; if (this.histT <= 0) { this.histT = 2; this.history.push([this.sideStrength(0), this.sideStrength(1)]); } }
    for (let i = 0; i < this.N; i++) this.updateSoldier(i, dt);
    this.updateProjectiles(dt);
    if (this.phase === 'battle') this.checkEnd();
  }

  updateUnit(u, dt) {
    // centroid
    let sx = 0, sz = 0, n = 0;
    for (const i of u.slots) { sx += this.sx[i]; sz += this.sz[i]; n++; }
    u.alive = n;
    if (n === 0) { u.mstate = Math.max(u.mstate, 3); return; }
    u.cx = sx / n; u.cz = sz / n;
    if (this.phase !== 'battle') return;
    {
      const far = Math.hypot(u.ax - u.cx, u.az - u.cz) > 5 && u.order.kind !== 'hold';
      const cav = isCav(u.t);
      let df;
      if (u.engaged) df = cav ? 0.004 : 0.0055;
      else if (u.run && far) df = cav ? 0.006 : 0.011;
      else if (far) df = 0.0005;
      else df = -0.012;
      if (u.ability && u.t.ability === 'testudo') df += 0.002;
      u.fatigue = Math.max(0, Math.min(1, u.fatigue + df * dt));
    }
    u.mtick -= dt;
    if (u.mtick <= 0) { u.mtick = 0.25; this.updateMorale(u); }
    if (u.mstate >= 2) return;
    const o = u.order;
    u.engaged = this.time - u.lastFight < 1.5;
    if (o.kind === 'move') {
      u.ax = o.x; u.az = o.z; u.fx = o.face;
    } else if (o.kind === 'attack') {
      const T = this.units[o.target];
      if (!T || T.alive <= 0 || (T.mstate >= 2 && Math.hypot(T.cx - u.cx, T.cz - u.cz) > 120) || T.mstate === 4) { u.order = { kind: 'hold' }; u.ax = u.cx; u.az = u.cz; u.fireTarget = -1; }
      else {
        const dx = T.cx - u.cx, dz = T.cz - u.cz, d = Math.hypot(dx, dz) || 1;
        const nx = dx / d, nz = dz / d;
        const missile = u.t.range && this.unitAmmo(u) > 0;
        if (missile) {
          u.fireTarget = T.id;
          const want = u.t.range * 0.85;
          if (d > want) { u.ax = T.cx - nx * want * 0.95; u.az = T.cz - nz * want * 0.95; }
          else if (!u.inRange) { u.ax = u.cx + nx * this.unitDepth(u) * 0.5; u.az = u.cz + nz * this.unitDepth(u) * 0.5; }
          u.inRange = d <= want;
          u.fx = Math.atan2(nx, nz);
        } else {
          u.fireTarget = -1;
          const tDepth = T.mstate >= 2 ? 0 : this.unitDepth(T) * 0.5;
          const push = isCav(u.t) ? 6 : 0.6;
          u.ax = T.cx - nx * tDepth + nx * push;
          u.az = T.cz - nz * tDepth + nz * push;
          // the anchor is the centre of our front rank
          u.fx = Math.atan2(nx, nz);
          if (d < 45 && !u.chargeStarted && u.run) { u.chargeStarted = true; u.chargeT = this.time; if (isCav(u.t) || u.t.charge >= 12) this.events.push({ type: 'charge', x: u.cx, z: u.cz, side: u.side, cav: isCav(u.t) }); }
          // throw pila before contact
          if (u.t.pila && !u.pilaDone && d < 34 && d > 12) this.throwPila(u, T);
        }
      }
    } else {
      // hold: missile units fire at will at the nearest enemy in range
      if (u.t.range && this.unitAmmo(u) > 0 && !u.holdFire) {
        let best = -1, bd = u.t.range * 1.02;
        for (const e of this.units) {
          if (e.side === u.side || e.alive <= 0 || e.mstate >= 2) continue;
          if (e.engaged && this.friendlyNear(u.side, e) && !isCav(u.t)) continue;
          const d = Math.hypot(e.cx - u.cx, e.cz - u.cz);
          if (d < bd) { bd = d; best = e.id; }
        }
        u.fireTarget = best;
        if (best >= 0 && !isCav(u.t)) { const e = this.units[best]; const want = Math.atan2(e.cx - u.cx, e.cz - u.cz); if (Math.abs(angDiff(want, u.fx)) > 0.5 && !u.engaged) u.fx = want; }
      }
      // defensive pila
      if (u.t.pila && !u.pilaDone) {
        for (const e of this.units) {
          if (e.side === u.side || e.alive <= 0 || e.mstate >= 2) continue;
          const d = Math.hypot(e.cx - u.cx, e.cz - u.cz);
          if (d < 28 && d > 10) { this.throwPila(u, e); break; }
        }
      }
    }
    if (o.kind !== 'attack') u.chargeStarted = false;
    // skirmishers fall back from approaching melee
    if (u.skirmish && u.t.range && this.unitAmmo(u) > 0 && !u.engaged) {
      const danger = isCav(u.t) ? 45 : 32;
      for (const e of this.units) {
        if (e.side === u.side || e.alive <= 0 || e.mstate >= 2 || (e.t.range && this.unitAmmo(e) > 0)) continue;
        const dx = u.cx - e.cx, dz = u.cz - e.cz, d = Math.hypot(dx, dz);
        if (d < danger && (e.order.kind === 'attack' || d < danger * 0.6)) {
          const back = isCav(u.t) ? 55 : 35;
          let tx = u.cx + (dx / d) * back, tz = u.cz + (dz / d) * back;
          tx = Math.max(-FIELD, Math.min(FIELD, tx)); tz = Math.max(-FIELD, Math.min(FIELD, tz));
          u.order = { kind: 'move', x: tx, z: tz, face: Math.atan2(-dx, -dz) };
          u.run = true;
          break;
        }
      }
    }
  }

  friendlyNear(side, e) {
    for (const f of this.units) if (f.side === side && f.alive > 0 && f.mstate < 2 && Math.hypot(f.cx - e.cx, f.cz - e.cz) < 14) return true;
    return false;
  }
  unitAmmo(u) { if (!u.t.range) return 0; let a = 0; for (const i of u.slots) a += this.sammo[i]; return a; }

  throwPila(u, T) {
    u.pilaDone = true;
    const f = this.slotFrame(u);
    for (let k = 0; k < u.slots.length; k++) {
      if (Math.floor(k / f.cols) > 1) break;
      const i = u.slots[k];
      if (T.slots.length === 0) break;
      const j = T.slots[Math.floor(this.rng() * T.slots.length)];
      this.launch(i, this.sx[j], this.sz[j], 3, 11, u.side, u.id, this.rng() * 0.25);
      this.satk[i] = 0;
    }
    this.events.push({ type: 'volley', x: u.cx, z: u.cz, kind: 3 });
  }

  updateMorale(u) {
    const s = this.sides[u.side];
    if (u.alive <= 0) return;
    let mod = -u.fatigue * 10;
    if (this.time - u.warcryT < 15) mod -= 14;
    if (this.time < u.inspireUntil) mod += 10;
    if (this.time - u.burnT < 4) mod -= 9;
    let m = u.t.morale + u.xp * 4 + (s.gen ? s.gen.stars * 3 : 0);
    const lossFrac = 1 - (u.alive + u.escaped) / u.n0;
    m -= lossFrac * 48;
    while (u.losses.length && this.time - u.losses[0] > 10) u.losses.shift();
    m -= (u.losses.length / u.n0) * 95;
    if (this.time - u.rearT < 3) m -= 24; else if (this.time - u.flankT < 3) m -= 12;
    const g = this.units[s.genUnit];
    if (g && g.alive > 0 && g !== u && Math.hypot(g.cx - u.cx, g.cz - u.cz) < 70) m += 12;
    if (s.genDead) m -= 12;
    let routNear = 0;
    for (const f of this.units) {
      if (f === u || f.alive <= 0) continue;
      const d = Math.hypot(f.cx - u.cx, f.cz - u.cz);
      if (f.side === u.side && f.mstate === 2 && d < 50) routNear++;
      if (f.side !== u.side && f.t.cls === 'elephant' && f.mstate < 2 && d < 30 && u.t.cls !== 'elephant') m -= 9;
      if (f.side !== u.side && f.mstate >= 2 && d < 60) m += 3;
    }
    m -= Math.min(24, routNear * 8);
    const mine = this.sideStrength(u.side), theirs = this.sideStrength(1 - u.side);
    m += (mine / (mine + theirs + 1) - 0.5) * 22;
    if (u.ability) m += 6;
    if (this.time < u.rallyUntil) m += 22;
    if (u.mstate >= 2) m = Math.min(m, 70) + 10;
    m += mod;
    u.mTarget = m;
    u.morale += (m - u.morale) * (m < u.morale ? 0.28 : 0.07);
    if (u.mstate < 2) {
      if (u.morale < 6 || (u.alive <= Math.max(2, u.n0 * 0.08) && u.n0 > 6)) this.rout(u);
      else u.mstate = u.morale < 26 ? 1 : 0;
    } else if (u.mstate === 2) {
      // rally if no longer pursued
      if (this.time - u.routT > 12 && u.morale > 34 && u.routCount < 2 && !this.enemyNear(u, 30)) {
        u.mstate = 0; u.order = { kind: 'hold' }; u.ax = u.cx; u.az = u.cz;
        u.fx = this.sideFacing(u.side); u.losses.length = 0;
        this.events.push({ type: 'rallied', x: u.cx, z: u.cz, side: u.side, unit: u.id });
      }
    }
  }

  enemyNear(u, r) {
    for (const e of this.units) if (e.side !== u.side && e.alive > 0 && e.mstate < 2 && Math.hypot(e.cx - u.cx, e.cz - u.cz) < r) return true;
    return false;
  }

  rout(u) {
    u.routCount++;
    u.mstate = u.routCount >= 2 ? 3 : 2;
    u.routT = this.time; u.order = { kind: 'hold' }; u.ability = false; u.fireTarget = -1;
    this.events.push({ type: 'rout', x: u.cx, z: u.cz, side: u.side, unit: u.id });
  }

  // ------------------------------------------------------------ soldiers
  updateSoldier(i, dt) {
    const alive = this.salive[i];
    if (alive !== 1) { if (alive === 0) this.sdeadT[i] += dt; return; }
    const u = this.units[this.sunit[i]];
    const t = u.t;
    let x = this.sx[i], z = this.sz[i];
    if (this.scd[i] > 0) this.scd[i] -= dt;
    if (this.sstag[i] > 0) this.sstag[i] -= dt;
    this.satk[i] += dt;
    let gx, gz, speed = u.run ? t.run : t.walk, face = null;
    const tired = Math.max(0, u.fatigue - 0.45) / 0.55;
    const spdMul = this.active(u, 'charge') ? 1.15 : 1 - 0.3 * tired;
    if (this.phase === 'deploy') {
      const f = this.slotFrame(u);
      const p = this.slotPos(u, f, this.sslot[i], i);
      gx = p[0]; gz = p[1]; speed = t.run;
    } else if (u.mstate >= 2) {
      // flee toward our own edge, spreading out
      const dir = this.sideFacing(u.side) === 0 ? -1 : 1;
      gx = x + this.sjit[i * 2] * 60; gz = dir * (FIELD + 80);
      speed = t.run * 0.92;
      if (Math.abs(z) > FIELD + 30 || Math.abs(x) > FIELD + 30) { this.escape(i); return; }
    } else {
      let tgt = this.starget[i];
      if (tgt >= 0) {
        if (this.salive[tgt] !== 1) tgt = -1;
        else { const d2 = (this.sx[tgt] - x) ** 2 + (this.sz[tgt] - z) ** 2; if (d2 > 100) tgt = -1; }
      }
      const fireMode = u.fireTarget >= 0 && this.sammo[i] > 0;
      this.sseek[i] -= dt;
      if (this.sseek[i] <= 0) {
        this.sseek[i] = 0.35 + this.rng() * 0.3;
        const attacking = u.order.kind === 'attack' && !fireMode;
        const seekR = attacking ? (Math.hypot(u.cx - this.units[u.order.target].cx, u.cz - this.units[u.order.target].cz) < 40 ? 7.5 : 3.5) : 2.8 + u.reach;
        const nt = this.nearestEnemy(x, z, u.side, seekR + t.run * 0.2, attacking ? u.order.target : -1);
        if (nt >= 0) tgt = nt; else if (tgt >= 0 && !attacking) tgt = -1;
        // do not let skirmishers wander off chasing in fire mode
        if (fireMode && tgt >= 0 && (this.sx[tgt] - x) ** 2 + (this.sz[tgt] - z) ** 2 > 9) tgt = -1;
      }
      this.starget[i] = tgt;
      if (tgt >= 0) {
        const tu = this.units[this.sunit[tgt]];
        const dx = this.sx[tgt] - x, dz = this.sz[tgt] - z, d = Math.hypot(dx, dz) || 0.01;
        const contact = u.rad + tu.rad + u.reach;
        face = Math.atan2(dx, dz);
        if (d > contact * 0.9) { gx = this.sx[tgt] - (dx / d) * contact * 0.85; gz = this.sz[tgt] - (dz / d) * contact * 0.85; }
        else { gx = x; gz = z; }
        if (u.order.kind === 'attack' && u.run) speed = t.run; else speed = Math.max(t.walk, d > 4 ? t.run * 0.7 : t.walk);
        if (d <= contact && this.scd[i] <= 0 && this.sstag[i] <= 0) this.strike(i, tgt, d);
        u.lastFight = this.time;
      } else {
        const f = this.slotFrame(u);
        const k = this.sslot[i];
        const p = this.slotPos(u, f, k, i);
        gx = p[0]; gz = p[1];
        const d2 = (gx - x) ** 2 + (gz - z) ** 2;
        if (d2 < 2) face = u.fx;
        if (!u.run && d2 > 400) speed = t.walk * 1.6; // catch up
        if (fireMode && this.scd[i] <= 0 && d2 < 16) this.fire(i, u);
      }
    }
    // steering
    let dx = gx - x, dz = gz - z;
    const dist = Math.hypot(dx, dz);
    let desX = 0, desZ = 0;
    if (dist > 0.05) {
      const sp = Math.min(speed, dist * 2.5);
      desX = (dx / dist) * sp; desZ = (dz / dist) * sp;
    }
    if (this.sstag[i] > 0) { desX *= 0.2; desZ *= 0.2; }
    speed *= spdMul;
    const acc = isCav(t) ? 2.2 : 7;
    const k = Math.min(1, dt * acc);
    let vx = this.svx[i] + (desX - this.svx[i]) * k, vz = this.svz[i] + (desZ - this.svz[i]) * k;
    // separation (and cavalry impact)
    let pxs = 0, pzs = 0;
    const r0 = u.rad;
    const c0x = ((x + HOFF) / CELL) | 0, c0z = ((z + HOFF) / CELL) | 0;
    const cr = u.rad > 1.5 ? 2 : 1;
    const spd = Math.hypot(vx, vz);
    const charging = this.scharge[i] === 1 && spd > t.run * 0.55;
    for (let ddz = -cr; ddz <= cr; ddz++) {
      const cz = c0z + ddz; if (cz < 0 || cz >= HG) continue;
      for (let ddx = -cr; ddx <= cr; ddx++) {
        const cx = c0x + ddx; if (cx < 0 || cx >= HG) continue;
        for (let j = this.head[cz * HG + cx]; j >= 0; j = this.next[j]) {
          if (j === i) continue;
          const ox = x - this.sx[j], oz = z - this.sz[j];
          const uj = this.units[this.sunit[j]];
          const rr = r0 + uj.rad;
          const d2 = ox * ox + oz * oz;
          if (d2 >= rr * rr || d2 < 1e-6) continue;
          const d = Math.sqrt(d2);
          const pen = (rr - d) / d;
          const w = uj.mass / (u.mass + uj.mass);
          const enemy = uj.side !== u.side;
          pxs += ox * pen * w * (enemy ? 5 : 3.2); pzs += oz * pen * w * (enemy ? 5 : 3.2);
          if (enemy && charging && (isCav(t) || this.active(u, 'charge')) && this.simpacts[i] < (t.cls === 'elephant' ? 12 : this.active(u, 'wedge') ? 7 : isCav(t) ? 3 : 1) && this.phase === 'battle') this.impact(i, j, vx, vz, spd);
        }
      }
    }
    if (this.scharge[i] === 0 && spd > t.run * 0.7) this.scharge[i] = 1;
    else if (spd < t.run * 0.25 && this.scharge[i] === 1 && this.sstag[i] <= 0) { this.scharge[i] = 0; this.simpacts[i] = 0; }
    this.svx[i] = vx; this.svz[i] = vz;
    x += (vx + pxs) * dt; z += (vz + pzs) * dt;
    const lim = FIELD + 120;
    this.sx[i] = Math.max(-lim, Math.min(lim, x)); this.sz[i] = Math.max(-lim, Math.min(lim, z));
    const s = Math.hypot(vx, vz);
    this.sspd[i] = s;
    this.sphase[i] += s * dt * (isCav(t) ? (t.cls === 'elephant' ? 1.4 : 1.9) : 3.6);
    // facing: toward the enemy we fight, else where we walk, else formation front
    const want = face ?? (s > 0.4 ? Math.atan2(vx, vz) : u.fx);
    this.sface[i] += angDiff(want, this.sface[i]) * Math.min(1, dt * (isCav(t) ? 3 : 7));
  }

  escape(i) {
    const u = this.units[this.sunit[i]];
    this.salive[i] = 2;
    this.removeFromSlots(u, i);
    u.escaped++;
  }

  removeFromSlots(u, i) {
    const k = this.sslot[i];
    const last = u.slots.pop();
    if (last !== i) { u.slots[k] = last; this.sslot[last] = k; }
  }

  impact(i, j, vx, vz, spd) {
    const A = this.units[this.sunit[i]], D = this.units[this.sunit[j]];
    if (this.sstag[j] > 0.3) return;
    this.simpacts[i]++;
    const massR = A.mass / (A.mass + D.mass);
    const fx = Math.sin(this.sface[j]), fz = Math.cos(this.sface[j]);
    const nx = vx / spd, nz = vz / spd;
    const frontal = -(nx * fx + nz * fz) > 0.4;
    // braced spears and pikes wreck a frontal charge
    if (frontal && (D.t.antiCav || 0) > 0 && D.mstate < 2) {
      const brace = (D.t.antiCav + (D.ability ? 6 : 0)) / 22;
      if (this.rng() < brace) { this.hurt(i, D.t.dmg * 0.8 + D.t.antiCav * 0.9, j, 'front'); this.sstag[i] = 0.6; this.svx[i] *= 0.3; this.svz[i] *= 0.3; this.scharge[i] = 0; return; }
    }
    const power = A.t.charge * (spd / A.t.run) * massR * (this.active(A, 'wedge') ? 1.45 : 1) * (this.active(A, 'charge') ? 1.4 : 1);
    if (this.time - A.chargeHitT > 8) { A.chargeHitT = this.time; this.events.push({ type: 'chargehit', unit: A.id, target: D.id, side: A.side, x: this.sx[j], z: this.sz[j], cav: isCav(A.t) }); }
    const dmg = power * (0.5 + this.rng() * 0.6) + A.t.dmg * 0.4 - (D.t.armor + D.up) * 0.4;
    this.sstag[j] = 0.6 + massR * 0.6;
    this.svx[j] += nx * spd * massR * 0.9; this.svz[j] += nz * spd * massR * 0.9;
    if (dmg > 0) this.hurt(j, dmg, i, frontal ? 'front' : 'flank');
    this.svx[i] *= 0.82; this.svz[i] *= 0.82;
    if (this.rng() < 0.3) this.events.push({ type: 'impact', x: this.sx[j], z: this.sz[j], cav: true });
  }

  strike(i, j, d) {
    const A = this.units[this.sunit[i]], D = this.units[this.sunit[j]];
    const ta = A.t, td = D.t;
    const dx = this.sx[i] - this.sx[j], dz = this.sz[i] - this.sz[j];
    const fx = Math.sin(this.sface[j]), fz = Math.cos(this.sface[j]);
    const c = (dx * fx + dz * fz) / (Math.hypot(dx, dz) || 1);
    const front = c > 0.3, rear = c < -0.35;
    const charge = this.scharge[i] === 1 && this.time - A.chargeT < 6;
    let def = td.def + D.xp + (front ? td.shield * 12 : 0) + (front && D.ability && td.ability === 'phalanx' ? 7 : 0) + (front && D.ability && td.ability === 'testudo' ? 3 : 0);
    if (front && isCav(ta) && td.antiCav) def += td.antiCav * 0.6;
    if (D.mstate >= 2) def -= 10;
    def -= D.fatigue * 3;
    if (this.sstag[j] > 0) def -= 4;
    let atk = ta.atk + A.xp + A.up * 0.5 + (charge ? ta.charge * 0.45 * (this.active(A, 'charge') ? 1.6 : 1) : 0) + (this.active(A, 'charge') ? 5 : 0) + (this.active(A, 'warcry') ? 4 : 0) + (this.time < A.inspireUntil ? 3 : 0) - A.fatigue * 4 + Math.max(-4, Math.min(4, (this.height(this.sx[i], this.sz[i]) - this.height(this.sx[j], this.sz[j])) * 0.6));
    if (A.ability && ta.ability === 'testudo') atk -= 3;
    const gen = this.sides[A.side].gen; if (gen) atk += gen.stars * 0.5;
    const p = Math.max(0.06, Math.min(0.92, 0.42 + (atk - def) * 0.022 + (rear ? 0.25 : front ? 0 : 0.12)));
    if (this.rng() < p) {
      let dmg = ta.dmg * (0.7 + this.rng() * 0.6) + (charge ? ta.charge * 0.35 : 0) + (isCav(td) && ta.antiCav ? ta.antiCav * 0.6 : 0) - (td.armor + D.up) * 0.42;
      if (ta.look.weapon === 'falx') dmg += td.armor * 0.25;
      this.hurt(j, Math.max(1.2, dmg), i, rear ? 'rear' : front ? 'front' : 'flank');
      if (ta.cls === 'elephant') {
        // trample those around the target
        let n = 0;
        const c0x = ((this.sx[j] + HOFF) / CELL) | 0, c0z = ((this.sz[j] + HOFF) / CELL) | 0;
        for (let ddz = -1; ddz <= 1 && n < 3; ddz++) for (let ddx = -1; ddx <= 1 && n < 3; ddx++) {
          const cz = c0z + ddz, cx = c0x + ddx; if (cz < 0 || cx < 0 || cz >= HG || cx >= HG) continue;
          for (let k = this.head[cz * HG + cx]; k >= 0 && n < 3; k = this.next[k]) {
            if (k === j || this.salive[k] !== 1 || this.units[this.sunit[k]].side === A.side) continue;
            if ((this.sx[k] - this.sx[j]) ** 2 + (this.sz[k] - this.sz[j]) ** 2 < 9) { this.hurt(k, ta.dmg * 0.6, i, 'flank'); n++; }
          }
        }
      }
    }
    if (charge) this.scharge[i] = 0;
    D.lastFight = this.time; A.lastFight = this.time;
    this.scd[i] = (ta.cls === 'elephant' ? 1.7 : isCav(ta) ? 1.45 : 1.2) * (0.75 + this.rng() * 0.6);
    this.satk[i] = 0;
    if (this.rng() < 0.12) this.events.push({ type: 'clash', x: this.sx[j], z: this.sz[j] });
  }

  hurt(j, dmg, by, dir) {
    if (this.salive[j] !== 1) return;
    const D = this.units[this.sunit[j]];
    this.shp[j] -= dmg;
    if (dir === 'rear') D.rearT = this.time; else if (dir === 'flank') D.flankT = this.time;
    if ((dir === 'rear' || dir === 'flank') && by >= 0 && this.time - D.flankEvT > 9 && D.mstate < 2) { D.flankEvT = this.time; this.events.push({ type: 'flanked', unit: D.id, side: D.side, rear: dir === 'rear', x: this.sx[j], z: this.sz[j] }); }
    if (this.shp[j] <= 0) {
      this.salive[j] = 0; this.sdeadT[j] = 0;
      const bx = by >= 0 ? this.sx[j] - this.sx[by] : this.rng() - 0.5, bz = by >= 0 ? this.sz[j] - this.sz[by] : this.rng() - 0.5;
      this.sfall[j] = Math.atan2(bx, bz);
      this.removeFromSlots(D, j);
      D.losses.push(this.time);
      if (by >= 0) this.units[this.sunit[by]].kills++;
      this.events.push({ type: 'death', x: this.sx[j], z: this.sz[j], side: D.side, cls: D.t.cls });
      if (D.general && D.slots.length === 0) {
        const s = this.sides[D.side];
        if (!s.genDead) { s.genDead = true; this.events.push({ type: 'general', side: D.side, x: this.sx[j], z: this.sz[j] }); }
      }
    } else if (dmg > 3 && this.rng() < 0.4) {
      this.events.push({ type: 'blood', x: this.sx[j], z: this.sz[j] });
    }
  }

  // ------------------------------------------------------------ missiles
  fire(i, u) {
    const T = this.units[u.fireTarget];
    if (!T || T.slots.length === 0) return;
    const j = T.slots[Math.floor(this.rng() * T.slots.length)];
    const d = Math.hypot(this.sx[j] - this.sx[i], this.sz[j] - this.sz[i]);
    if (d > u.t.range * 1.08) return;
    const kind = { arrow: 0, javelin: 1, stone: 2 }[u.t.missile] ?? 0;
    const burning = this.active(u, 'fire');
    this.launch(i, this.sx[j] + this.svx[j] * (d / 40), this.sz[j] + this.svz[j] * (d / 40), kind, u.t.mdmg * (burning ? 1.4 : 1), u.side, u.id, 0);
    this.pfire[(this.pnext - 1 + this.PM) % this.PM] = burning ? 1 : 0;
    this.sammo[i]--;
    this.scd[i] = u.t.reload * (0.8 + this.rng() * 0.45);
    this.satk[i] = 0;
    if (!u.volleyT || this.time - u.volleyT > 2) { u.volleyT = this.time; this.events.push({ type: 'volley', x: u.cx, z: u.cz, kind }); }
  }

  launch(i, tx, tz, kind, dmg, side, unit, delay) {
    const k = this.pnext; this.pnext = (this.pnext + 1) % this.PM;
    const x0 = this.sx[i], z0 = this.sz[i];
    const u = this.units[unit];
    const y0 = this.height(x0, z0) + (isCav(u.t) ? 2.4 : 1.6);
    const d = Math.hypot(tx - x0, tz - z0);
    const spread = 0.8 + d * (kind === 0 ? 0.045 : kind === 2 ? 0.035 : 0.03);
    tx += (this.rng() - 0.5) * 2 * spread; tz += (this.rng() - 0.5) * 2 * spread;
    const dd = Math.hypot(tx - x0, tz - z0) || 1;
    const ty = this.height(tx, tz) + 0.9;
    const T = kind === 0 ? 0.8 + dd / 42 : kind === 2 ? 0.4 + dd / 48 : 0.3 + dd / 24;
    this.px[k] = x0; this.py[k] = y0; this.pz[k] = z0;
    this.pvx[k] = (tx - x0) / T; this.pvz[k] = (tz - z0) / T;
    this.pvy[k] = (ty - y0 + 0.5 * G * T * T) / T;
    this.pkind[k] = kind; this.pside[k] = side; this.pdmg[k] = dmg; this.punit[k] = unit;
    this.pon[k] = 1; this.pdelay[k] = delay; this.pfire[k] = 0;
  }

  updateProjectiles(dt) {
    for (let k = 0; k < this.PM; k++) {
      if (!this.pon[k]) continue;
      if (this.pdelay[k] > 0) { this.pdelay[k] -= dt; continue; } // pila go in a ragged volley
      this.pvy[k] -= G * dt;
      this.px[k] += this.pvx[k] * dt; this.py[k] += this.pvy[k] * dt; this.pz[k] += this.pvz[k] * dt;
      const x = this.px[k], z = this.pz[k];
      const gy = this.height(x, z);
      if (this.py[k] > gy + 2.2 || this.pvy[k] > 0) continue;
      // near the ground: look for a body
      const c0x = ((x + HOFF) / CELL) | 0, c0z = ((z + HOFF) / CELL) | 0;
      let hit = -1, bd = 9;
      for (let ddz = -1; ddz <= 1; ddz++) for (let ddx = -1; ddx <= 1; ddx++) {
        const cz = c0z + ddz, cx = c0x + ddx; if (cz < 0 || cx < 0 || cz >= HG || cx >= HG) continue;
        for (let j = this.head[cz * HG + cx]; j >= 0; j = this.next[j]) {
          if (this.salive[j] !== 1) continue;
          const uj = this.units[this.sunit[j]];
          const r = uj.rad + 0.25;
          const d2 = (this.sx[j] - x) ** 2 + (this.sz[j] - z) ** 2;
          const tall = uj.t.cls === 'elephant' ? 4 : isCav(uj.t) ? 2.6 : 1.8;
          if (d2 < r * r && this.py[k] < gy + tall && d2 < bd) { bd = d2; hit = j; }
        }
      }
      if (hit >= 0) {
        const D = this.units[this.sunit[hit]];
        const friendly = D.side === this.pside[k];
        if (!friendly || this.rng() < 0.35) {
          this.pon[k] = 0;
          const sp = Math.hypot(this.pvx[k], this.pvz[k]) || 1;
          const fx = Math.sin(this.sface[hit]), fz = Math.cos(this.sface[hit]);
          const facing = -(this.pvx[k] * fx + this.pvz[k] * fz) / sp;
          let block = facing > 0.25 ? D.t.shield * 1.05 : 0;
          if (D.ability && D.t.ability === 'testudo') block = Math.max(block, 0.82);
          if (this.pkind[k] === 3) block *= 0.6;
          if (this.rng() < block) { this.events.push({ type: 'block', x, z }); continue; }
          const pierce = this.pkind[k] === 3 ? 0.12 : this.pkind[k] === 2 ? 0.45 : 0.38;
          const dmg = Math.max(1, this.pdmg[k] * (0.75 + this.rng() * 0.5) - (D.t.armor + D.up) * pierce);
          this.hurt(hit, dmg, -1, facing > 0.25 ? 'front' : facing < -0.3 ? 'rear' : 'flank');
          if (this.pfire[k]) { D.burnT = this.time; if (this.rng() < 0.2) this.events.push({ type: 'burn', x, z }); }
          const shooter = this.units[this.punit[k]];
          if (this.salive[hit] === 0 && shooter) shooter.kills++;
          continue;
        }
      }
      if (this.py[k] <= gy) {
        this.pon[k] = 0;
        if (this.pkind[k] !== 2) {
          const sp = Math.hypot(this.pvx[k], this.pvy[k], this.pvz[k]) || 1;
          this.stuck.push({ x, y: gy, z, dx: this.pvx[k] / sp, dy: this.pvy[k] / sp, dz: this.pvz[k] / sp, kind: this.pkind[k] });
          if (this.stuck.length > 1500) this.stuck.shift();
        }
      }
    }
  }

  // ------------------------------------------------------------ end of battle
  checkEnd() {
    if (this.winner >= 0) return;
    if (this.time % 0.5 > 0.04) return;
    const a0 = this.activeUnits(0).length, a1 = this.activeUnits(1).length;
    if (a0 === 0 || a1 === 0) { this.winner = a0 === 0 ? 1 : 0; this.phase = 'over'; this.events.push({ type: 'end', winner: this.winner }); }
    else if (this.time > this.timeLimit) { this.winner = 1 - this.cfg.attacker; this.phase = 'over'; this.events.push({ type: 'end', winner: this.winner, timeout: true }); }
  }

  // casualties per campaign unit, aligned with cfg.sides[s].units
  results() {
    const out = this.sides.map((s) => ({ cas: s.units.map(() => 0), kills: 0, lost: 0, start: 0 }));
    for (const u of this.units) {
      const survivors = u.alive + u.escaped;
      const cu = this.cfg.sides[u.side].units[u.ci];
      const lost = Math.max(0, Math.round(cu.n) - survivors);
      out[u.side].cas[u.ci] = lost;
      out[u.side].lost += lost;
      out[u.side].kills += u.kills;
      out[u.side].start += Math.round(cu.n);
    }
    return { winner: this.winner, sides: out };
  }
}

export function abilitiesFor(t) {
  const l = [];
  if (t.pila) l.push('pila');
  if (t.ability === 'testudo') l.push('testudo');
  if (t.ability === 'phalanx') l.push('phalanx');
  if (t.general) l.push('rally', 'inspire');
  else if (t.cls === 'cav') l.push('wedge');
  else if (!t.range) l.push('charge');
  if (t.look.hair && !t.range && !isCav(t)) l.push('warcry');
  if (t.missile === 'arrow' || t.missile === 'stone') l.push('fire');
  return l;
}

export function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
