// Battle AI: holds a line, screens with missiles, sends cavalry round the flanks
// to hit engaged enemies in the rear, rallies wavering units and chases routers.
import { isCav } from './sim.js';

export class BattleAI {
  constructor(sim, side) {
    this.sim = sim; this.side = side; this.t = 1.5;
    const s = sim.sides[side];
    const missile = sim.activeUnits(side).filter((u) => u.t.range).length;
    const theirMissile = sim.activeUnits(1 - side).filter((u) => u.t.range).length;
    this.defensive = side !== sim.cfg.attacker && (sim.cfg.walls > 0 || missile > theirMissile + 1 || Math.random() < 0.4);
    this.flank = new Map();
  }

  update(dt) {
    if (this.sim.phase !== 'battle') return;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.7 + Math.random() * 0.3;
    this.think();
  }

  issueAttack(u, T, run) {
    if (u.order.kind === 'attack' && u.order.target === T.id) { if (run && !u.run) this.sim.setRun(u.id, true); return; }
    this.sim.orderAttack(u.id, T.id, run);
  }
  issueMove(u, x, z, face, run = false) {
    const o = u.order;
    if (o.kind === 'move' && Math.hypot(o.x - x, o.z - z) < 6 && Math.abs(o.face - face) < 0.3) return;
    this.sim.orderMove(u.id, x, z, face, run);
  }

  think() {
    const sim = this.sim;
    const mine = sim.activeUnits(this.side);
    const foes = sim.activeUnits(1 - this.side);
    if (!mine.length || !foes.length) return;
    const avg = (l) => { let x = 0, z = 0; for (const u of l) { x += u.cx; z += u.cz; } return { x: x / l.length, z: z / l.length }; };
    const line = mine.filter((u) => !isCav(u.t) && !u.t.range && !u.general);
    const myC = avg(line.length ? line : mine);
    const foeC = avg(foes);
    let dx = foeC.x - myC.x, dz = foeC.z - myC.z;
    const D = Math.hypot(dx, dz) || 1; dx /= D; dz /= D;
    const face = Math.atan2(dx, dz);
    const routing = sim.units.filter((u) => u.side !== this.side && u.mstate >= 2 && u.alive > 0);
    const winning = routing.length > foes.length;
    const nearestFoe = (u, filter = () => true) => {
      let best = null, bd = 1e9;
      for (const e of foes) { if (!filter(e)) continue; const d = Math.hypot(e.cx - u.cx, e.cz - u.cz); if (d < bd) { bd = d; best = e; } }
      return [best, bd];
    };
    const advance = !this.defensive || sim.time > 120 || foes.some((e) => Math.hypot(e.cx - myC.x, e.cz - myC.z) < 110);
    const targeted = new Map();
    for (const u of mine) if (u.order.kind === 'attack') targeted.set(u.order.target, (targeted.get(u.order.target) || 0) + 1);

    for (const u of mine) useAbilities(sim, u, foes);
    for (const u of mine) {
      const ammo = u.t.range ? sim.unitAmmo(u) : 0;
      if (u.general) {
        const wavering = mine.find((f) => f.mstate === 1 && Math.hypot(f.cx - u.cx, f.cz - u.cz) < 85);
        if (wavering || mine.some((f) => f.mstate === 2)) sim.rally(u.id);
        if (winning) { const [r] = nearestRouter(u, routing); if (r) { this.issueAttack(u, r, true); continue; } }
        const [e, d] = nearestFoe(u);
        if (e && d < 25) { this.issueAttack(u, e, true); continue; }
        this.issueMove(u, myC.x - dx * 40, myC.z - dz * 40, face);
        continue;
      }
      if (u.t.cls === 'elephant') {
        const [e, d] = nearestFoe(u, (x) => !isCav(x.t)) ;
        if (e && (advance || d < 90)) this.issueAttack(u, e, d < 90);
        continue;
      }
      if (u.t.range && ammo > 0) {
        const [e, d] = nearestFoe(u, (x) => !(x.engaged && sim.friendlyNear(this.side, x)));
        if (e && d < u.t.range * 1.4) { this.issueAttack(u, e, false); continue; }
        if (u.t.cls === 'harcher') { const [e2] = nearestFoe(u); if (e2) this.issueAttack(u, e2, true); continue; }
        if (advance) {
          const lat = (u.cx - myC.x) * dz - (u.cz - myC.z) * dx;
          this.issueMove(u, myC.x + dx * 22 + dz * lat, myC.z + dz * 22 - dx * lat, face);
        }
        continue;
      }
      if (isCav(u.t)) {
        if (winning) { const [r] = nearestRouter(u, routing); if (r) { this.issueAttack(u, r, true); continue; } }
        // threatened by enemy cavalry: meet it
        const [ec, ecd] = nearestFoe(u, (x) => isCav(x.t) && x.t.cls !== 'elephant');
        if (ec && ecd < 50) { this.issueAttack(u, ec, true); continue; }
        // unprotected missile troops
        const [em, emd] = nearestFoe(u, (x) => x.t.range && !foes.some((g) => g !== x && !g.t.range && !isCav(g.t) && Math.hypot(g.cx - x.cx, g.cz - x.cz) < 30));
        if (em && emd < 260) { this.issueAttack(u, em, emd < 120); continue; }
        // engaged enemy infantry: ride around and hit the rear
        let best = null, bd = 1e9;
        for (const e of foes) {
          if (!e.engaged || isCav(e.t)) continue;
          const d = Math.hypot(e.cx - u.cx, e.cz - u.cz);
          if (d < bd) { bd = d; best = e; }
        }
        if (best) {
          const fx = Math.sin(best.fx), fz = Math.cos(best.fx);
          const rx = best.cx - fx * 35, rz = best.cz - fz * 35;
          const behind = (u.cx - best.cx) * fx + (u.cz - best.cz) * fz < -15;
          if (behind || Math.hypot(u.cx - rx, u.cz - rz) < 25) this.issueAttack(u, best, true);
          else {
            // swing wide around the flank on our side of the line
            const side = (u.cx - best.cx) * Math.cos(best.fx) - (u.cz - best.cz) * Math.sin(best.fx) > 0 ? 1 : -1;
            const wx = best.cx + Math.cos(best.fx) * side * 60 - fx * 20, wz = best.cz - Math.sin(best.fx) * side * 60 - fz * 20;
            const toW = Math.hypot(u.cx - wx, u.cz - wz);
            if (toW > 20 && !this.flank.get(u.id)) this.issueMove(u, wx, wz, Math.atan2(rx - wx, rz - wz), true);
            else { this.flank.set(u.id, true); this.issueMove(u, rx, rz, Math.atan2(best.cx - rx, best.cz - rz), true); }
          }
          continue;
        }
        this.flank.delete(u.id);
        if (advance) {
          const lat = (u.cx - myC.x) * dz - (u.cz - myC.z) * dx;
          const s = lat >= 0 ? 1 : -1;
          this.issueMove(u, myC.x + dz * s * Math.max(Math.abs(lat), 70) - dx * 10, myC.z - dx * s * Math.max(Math.abs(lat), 70) - dz * 10, face);
        }
        continue;
      }
      // line infantry (and missile troops out of ammo)
      if (u.order.kind === 'attack' && u.engaged) continue;
      const [e, d] = nearestFoe(u);
      if (!e) continue;
      if (!advance && d > 45) continue;
      if (d > 75) {
        const step = Math.min(45, d - 55);
        const lat = (u.cx - myC.x) * dz - (u.cz - myC.z) * dx;
        this.issueMove(u, myC.x + dx * step + dz * lat * 0.9, myC.z + dz * step - dx * lat * 0.9, face);
        continue;
      }
      // pick a target: prefer one our side is already fighting, spread the rest
      let pick = null, ps = 1e9;
      for (const f of foes) {
        const dd = Math.hypot(f.cx - u.cx, f.cz - u.cz);
        if (dd > 120) continue;
        const crowd = targeted.get(f.id) || 0;
        const score = dd + crowd * 25 - (f.engaged ? 15 : 0) + (isCav(f.t) && u.t.cls !== 'spear' && u.t.cls !== 'pike' ? 20 : 0);
        if (score < ps) { ps = score; pick = f; }
      }
      if (pick) { this.issueAttack(u, pick, d < 45); targeted.set(pick.id, (targeted.get(pick.id) || 0) + 1); }
    }
  }
}

function useAbilities(sim, u, foes) {
  if (u.alive <= 0 || u.mstate >= 2) return;
  let near = 1e9, nearMelee = 1e9, nearCav = 1e9;
  for (const e of foes) {
    const d = Math.hypot(e.cx - u.cx, e.cz - u.cz);
    near = Math.min(near, d);
    if (!e.t.range) nearMelee = Math.min(nearMelee, d);
    if (isCav(e.t)) nearCav = Math.min(nearCav, d);
  }
  const L = u.abilList;
  const tgtD = u.order.kind === 'attack' && sim.units[u.order.target] ? Math.hypot(sim.units[u.order.target].cx - u.cx, sim.units[u.order.target].cz - u.cz) : 1e9;
  if ((L.includes('charge') || L.includes('wedge')) && tgtD < 60 && !u.engaged) sim.useAbility(u.id, L.includes('wedge') ? 'wedge' : 'charge');
  if (L.includes('warcry') && near < 45) sim.useAbility(u.id, 'warcry');
  if (L.includes('fire') && u.fireTarget >= 0) sim.useAbility(u.id, 'fire');
  if (L.includes('inspire') && sim.units.some((f) => f.side === u.side && f.engaged && Math.hypot(f.cx - u.cx, f.cz - u.cz) < 70)) sim.useAbility(u.id, 'inspire');
  if (L.includes('testudo')) {
    const shot = foes.some((e) => e.fireTarget === u.id);
    if (shot && !u.ability && nearMelee > 45) sim.setAbility(u.id, true);
    else if (u.ability && (nearMelee < 40 || !shot)) sim.setAbility(u.id, false);
  }
  if (L.includes('phalanx')) sim.setAbility(u.id, nearCav < 70 || u.engaged);
}

function nearestRouter(u, list) {
  let best = null, bd = 1e9;
  for (const r of list) { const d = Math.hypot(r.cx - u.cx, r.cz - u.cz); if (d < bd && d < 160) { bd = d; best = r; } }
  return [best, bd];
}
