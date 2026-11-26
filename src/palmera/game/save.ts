// Saving: cash, jobs done, weapons and ammo, stats, armour, the time of day, the radio station and
// where you were standing, kept in localStorage. Saved every 20 s while nothing is going on (no
// job, no heat, not in a store), when a job is passed, and when the page closes. Test runs
// (?test, ?selftest) and ?fresh neither load nor save.
import type { Game } from './game';
import type { WeaponId } from '../entities/humans';
import type { AmmoId } from './weapons';

const KEY = 'palmera.save.v1';

interface SaveData {
  v: 1;
  savedAt: number;
  cash: number;
  done: number[];
  owned: WeaponId[];
  clip: Record<AmmoId, number>;
  reserve: Record<AmmoId, number>;
  stats: Game['stats'];
  armor: number;
  time: number;
  radio: number;
  pos: { x: number; z: number } | null;
  clothes?: string[];
  exportList?: string[];
  exported?: string[];
  wearing?: string;
  garage?: (import('./garage').StoredCar | null)[];
  stunts?: number[];
  props?: { owned: boolean; till: number }[];
}

export class SaveGame {
  enabled = false;
  private t = 0;

  constructor(private game: Game) {
    addEventListener('beforeunload', () => this.save());
  }

  get exists() {
    try {
      return !!localStorage.getItem(KEY);
    } catch {
      return false;
    }
  }

  /** where it is safe to stand on the next visit (outdoors, on foot or in a car, not swimming) */
  private spot(): { x: number; z: number } | null {
    const g = this.game;
    const p = g.player;
    if (g.interiors.inside || p.dead || p.swimming) return null;
    const ref = p.vehicle ? p.vehicle.pos : p.pos;
    if (ref.y < -5 || (p.vehicle && p.vehicle.isBoat)) return null;
    return { x: Math.round(ref.x * 10) / 10, z: Math.round(ref.z * 10) / 10 };
  }

  save(note?: string) {
    if (!this.enabled) return;
    const g = this.game;
    const lo = g.loadout;
    const old = this.read();
    const d: SaveData = {
      v: 1,
      savedAt: Date.now(),
      cash: g.cash,
      done: [...g.missions.done],
      stunts: [...g.stunts.done],
      owned: [...lo.owned],
      clip: { ...lo.clip },
      reserve: { ...lo.reserve },
      stats: { ...g.stats },
      armor: Math.round(g.player.armor),
      time: g.sky.time,
      radio: g.audio.radio.station,
      pos: this.spot() ?? old?.pos ?? null,
      clothes: [...g.wardrobe.owned],
      wearing: g.wardrobe.wearing,
      exportList: [...g.exports.list],
      exported: [...g.exports.delivered],
      garage: g.garages.slots.map((c) => (c ? { ...c, tune: { ...c.tune } } : null)),
      props: g.properties.state,
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(d));
      if (note) g.hud.toast(note);
    } catch {
      /* storage full or blocked: play on without saving */
    }
  }

  private read(): SaveData | null {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const d = JSON.parse(raw) as SaveData;
      return d && d.v === 1 ? d : null;
    } catch {
      return null;
    }
  }

  /** restore a saved game; returns whether there was one */
  load(): boolean {
    const d = this.read();
    if (!d) return false;
    const g = this.game;
    g.cash = d.cash;
    g.missions.done = new Set(d.done);
    if (d.stunts) g.stunts.done = new Set(d.stunts);
    const lo = g.loadout;
    lo.owned = new Set(d.owned);
    Object.assign(lo.clip, d.clip);
    Object.assign(lo.reserve, d.reserve);
    Object.assign(g.stats, d.stats);
    g.player.armor = d.armor;
    g.sky.setTime(d.time);
    const r = g.audio.radio;
    let guard = 0;
    while (r.station !== d.radio && guard++ < 8) r.tune(1);
    if (d.pos) g.teleport(d.pos.x, d.pos.z);
    if (d.clothes) g.wardrobe.owned = new Set(d.clothes);
    if (d.exportList?.length) {
      g.exports.list = d.exportList as typeof g.exports.list;
      g.exports.delivered = new Set((d.exported ?? []) as typeof g.exports.list);
    }
    if (d.props) g.properties.restore(d.props);
    if (d.garage) d.garage.forEach((c, i) => (g.garages.slots[i] = c ? { ...c, tune: { ...c.tune } } : null));
    if (d.wearing) {
      g.wardrobe.wearing = d.wearing;
      g.wardrobe.apply(d.wearing);
    }
    g.hud.toast(`Welcome back · $${d.cash.toLocaleString()} · ${d.done.length} job${d.done.length === 1 ? '' : 's'} done`);
    return true;
  }

  reset() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* nothing to remove */
    }
  }

  update(dt: number) {
    if (!this.enabled) return;
    const g = this.game;
    this.t += dt;
    if (this.t < 20) return;
    if (g.missions.active || g.activities.active || g.wanted.level > 0 || g.player.dead || g.interiors.inside) return;
    this.t = 0;
    this.save();
  }
}
