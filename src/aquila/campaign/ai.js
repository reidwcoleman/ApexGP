// Campaign AI for the rival factions: diplomacy, recruitment, building and conquest.
import { FACTIONS, FACTION_IDS } from '../data/factions.js';
import { UNITS } from '../data/units.js';
import {
  atWar, warKey, declareWar, makePeace, armiesIn, provsOf, armyPower, defencePower, factionPower, reachable, moveArmy,
  battleSides, autoResolve, applyBattle, rosterFor, recruit, canBuild, build, linksOf, MAX_UNITS, log,
} from './state.js';

const THRESH = { easy: 1.55, normal: 1.3, hard: 1.12 };

function neighborsOf(s, world, f) {
  const set = new Set();
  s.provs.forEach((pr, i) => {
    if (pr.owner !== f) return;
    for (const l of linksOf(world, i)) { const o = s.provs[l.id].owner; if (o !== f) set.add(o); }
  });
  return set;
}

function frontier(s, world, f) {
  const out = [];
  s.provs.forEach((pr, i) => {
    if (pr.owner !== f) return;
    let threat = 0, enemy = false;
    for (const l of linksOf(world, i)) {
      const o = s.provs[l.id].owner;
      if (o !== f && atWar(s, f, o)) { enemy = true; for (const a of armiesIn(s, l.id)) if (a.owner === o) threat += armyPower(a); }
    }
    if (enemy) out.push({ i, threat });
  });
  return out;
}

export function aiDiplomacy(s, world, f) {
  const me = s.factions[f];
  const myP = factionPower(s, f) + provsOf(s, f) * 400;
  const nb = neighborsOf(s, world, f);
  for (const g of FACTION_IDS) {
    if (g === f || g === 'free' || !s.factions[g].alive) continue;
    const k = warKey(f, g);
    const theirP = factionPower(s, g) + provsOf(s, g) * 400;
    if (s.wars[k]) {
      // weary or beaten factions sue for peace
      if (g === s.player) {
        if (myP < theirP * 0.45 && Math.random() < 0.25 && !s.offers.some((o) => o.from === f)) {
          const gold = Math.round(Math.min(me.gold * 0.5, 200 + provsOf(s, f) * 60));
          s.offers.push({ from: f, kind: 'peace', gold: Math.max(0, gold) });
        }
      } else if (Math.random() < 0.035 || (myP < theirP * 0.4 && Math.random() < 0.15)) {
        makePeace(s, f, g);
      }
    } else if (nb.has(g) && (s.truce[k] || 0) <= s.turn) {
      const early = g === s.player && s.turn < 5;
      const ratio = Math.min(2.5, myP / Math.max(1, theirP));
      const p = FACTIONS[f].aggression * 0.03 * ratio * (g === s.player ? 1.25 : 1);
      if (!early && Math.random() < p) declareWar(s, f, g);
    }
  }
}

function pickUnit(s, world, f, prov, budget) {
  const lvl = s.provs[prov].bld.barracks;
  const opts = rosterFor(s, f).map((t) => UNITS[t]).filter((u) => u.bar <= lvl && u.cost <= budget && !u.general);
  if (!opts.length) return null;
  const r = Math.random();
  const pick = (cls) => { const l = opts.filter((u) => cls.includes(u.cls)); return l.length ? l[Math.floor(Math.random() * l.length)] : null; };
  let u = null;
  if (r < 0.5) u = pick(['inf', 'spear', 'pike']);
  else if (r < 0.7) u = pick(['missile']);
  else if (r < 0.9) u = pick(['cav', 'harcher']);
  else u = opts.slice().sort((a, b) => b.cost - a.cost)[0];
  return u || opts[Math.floor(Math.random() * opts.length)];
}

export function aiRecruitBuild(s, world, f) {
  const me = s.factions[f];
  const nprov = provsOf(s, f);
  const front = frontier(s, world, f).sort((a, b) => b.threat - a.threat);
  const myArmies = s.armies.filter((a) => a.owner === f);
  const maxArmies = 1 + Math.ceil(nprov / 4) + Math.min(3, Math.floor(me.gold / 5000));
  const reserve = 250;
  // recruitment where the danger is
  const places = (front.length ? front.map((x) => x.i) : s.provs.map((p, i) => (p.owner === f ? i : -1)).filter((i) => i >= 0))
    .filter((i) => s.provs[i].bld.barracks >= 1);
  if (!places.length) {
    // no barracks at all: build one in the biggest city
    let best = -1, bp = -1;
    s.provs.forEach((p, i) => { if (p.owner === f && p.pop > bp && !p.queue.length) { bp = p.pop; best = i; } });
    if (best >= 0 && canBuild(s, world, best, 'barracks').ok) build(s, world, best, 'barracks');
    return;
  }
  const recruits = Math.min(6, 2 + Math.floor(me.gold / 3000));
  for (let n = 0; n < recruits; n++) {
    const budget = me.gold - reserve;
    if (budget < 160) break;
    const prov = places[Math.floor(Math.random() * Math.min(places.length, 3))];
    const here = armiesIn(s, prov).filter((a) => a.owner === f);
    const room = here.some((a) => a.units.length < MAX_UNITS + 1);
    if (!room && myArmies.length >= maxArmies) break;
    const u = pickUnit(s, world, f, prov, budget);
    if (!u) break;
    recruit(s, world, prov, u.id);
  }
  // building
  const builds = Math.min(8, 2 + Math.floor(me.gold / 2500));
  const qmax = me.gold > 5000 ? 2 : 1;
  for (let k = 0; k < builds && me.gold > 900; k++) {
    const mine = s.provs.map((p, i) => (p.owner === f && p.queue.length < qmax ? i : -1)).filter((i) => i >= 0);
    if (mine.length) {
      const i = mine[Math.floor(Math.random() * mine.length)];
      const isFront = front.some((x) => x.i === i);
      const order = isFront ? ['walls', 'barracks', 'market', 'farm', 'temple', 'smithy'] : ['market', 'farm', 'barracks', 'temple', 'aqueduct', 'port', 'mine', 'arena', 'smithy', 'walls'];
      for (const b of order) if (canBuild(s, world, i, b).ok && Math.random() < 0.7) { build(s, world, i, b); break; }
    }
  }
}

// distance (in province steps through own land) from every province to the nearest enemy-adjacent one
function frontDistance(s, world, f) {
  const dist = new Map();
  const q = [];
  for (const { i } of frontier(s, world, f)) { dist.set(i, 0); q.push(i); }
  while (q.length) {
    const c = q.shift();
    for (const l of linksOf(world, c)) {
      if (s.provs[l.id].owner !== f || dist.has(l.id)) continue;
      dist.set(l.id, dist.get(c) + 1); q.push(l.id);
    }
  }
  return dist;
}

export function aiMoveArmies(s, world, f, pending, moves) {
  const th = THRESH[s.difficulty] || 1.3;
  const fd = frontDistance(s, world, f);
  const list = s.armies.filter((a) => a.owner === f);
  let freeTaken = Math.random() < (FACTION_IDS.some((g) => g !== 'free' && g !== f && s.factions[g].alive && s.wars[warKey(f, g)]) ? 0.12 : 0.3) ? 0 : 1;
  const warMajor = FACTION_IDS.some((g) => g !== 'free' && g !== f && s.factions[g].alive && s.wars[warKey(f, g)]);
  // merge small armies sharing a province
  for (const a of list) {
    if (!a.units.length) continue;
    for (const b of list) {
      if (b === a || b.prov !== a.prov || !b.units.length) continue;
      while (b.units.length > 1 && a.units.length < MAX_UNITS + 1) a.units.push(b.units.splice(1, 1)[0]);
      if (b.units.length <= 1) b.units = [];
    }
  }
  s.armies = s.armies.filter((a) => a.units.length > 0);
  for (const a of s.armies.filter((x) => x.owner === f)) {
    if (a.units.length <= 4 || a.mp <= 0) continue;
    const reach = reachable(s, world, a);
    const myP = armyPower(a);
    let best = null, bestScore = 0;
    for (const [id, r] of reach) {
      if (r.kind !== 'attack') continue;
      const owner = s.provs[id].owner;
      const dp = defencePower(s, id) + 1;
      const ratio = myP / dp;
      const need = owner === 'free' ? th + 0.45 : th;
      if (ratio < need) continue;
      if (owner === 'free' && (freeTaken >= 1 || Math.random() < (warMajor ? 0.8 : 0.5))) continue;
      const value = 1 + world.provinces[id].pop / 15000 + (s.factions[owner] && s.factions[owner].capital === id ? 1.5 : 0) + (owner === s.player ? 0.4 : 0);
      const score = value * Math.min(ratio, 3);
      if (score > bestScore) { bestScore = score; best = { id, r }; }
    }
    if (best) {
      const target = best.id;
      if (s.provs[target].owner === 'free') freeTaken++;
      const pathTo = best.r.path;
      // walk to the province before the target, then attack
      const stage = pathTo[pathTo.length - 2];
      if (stage !== a.prov) moveArmy(s, a, pathTo.slice(0, -1), best.r.cost - 1);
      moves.push({ army: a.id, prov: a.prov });
      a.from = a.prov;
      const sides = battleSides(s, world, a, target);
      a.mp = 0;
      if (sides.defender.owner === s.player) { pending.push({ armyId: a.id, prov: target }); continue; }
      const res = autoResolve(s, sides);
      const captured = applyBattle(s, world, sides, res);
      if (captured) moves.push({ army: a.id, prov: target, battle: true });
      else moves.push({ army: a.id, prov: a.prov, battle: target });
      continue;
    }
    // hold a threatened province
    const here = fd.get(a.prov);
    if (here === 0) {
      let threat = 0;
      for (const l of linksOf(world, a.prov)) for (const e of armiesIn(s, l.id)) if (atWar(s, f, e.owner)) threat = Math.max(threat, armyPower(e));
      if (threat > myP * 0.6 || Math.random() < 0.5) continue;
    }
    // advance toward the front
    let dest = null, dBest = here ?? 99;
    for (const [id, r] of reach) {
      if (r.kind !== 'move') continue;
      const d = fd.get(id) ?? 99;
      if (d < dBest || (d === dBest && Math.random() < 0.3 && d === 0)) { dBest = d; dest = { id, r }; }
    }
    if (dest) {
      moveArmy(s, a, dest.r.path, dest.r.cost);
      moves.push({ army: a.id, prov: a.prov });
    }
  }
}

export function aiTurn(s, world, f, pending, moves) {
  if (!s.factions[f].alive || f === 'free') return;
  aiDiplomacy(s, world, f);
  aiRecruitBuild(s, world, f);
  aiMoveArmies(s, world, f, pending, moves);
}
