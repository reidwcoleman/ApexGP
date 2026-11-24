import * as THREE from 'three';
import { loadTile, type Tile, type TileInfo, type Skyline, type DtData } from './downtown.ts';
import type { Env } from './env.ts';

/**
 * The county around the beach block: tiles of real Miami (downtown, Brickell, Edgewater, Overtown...)
 * that load as you come near and stay. While a tile isn't in (or is far off) its blocks stand as plain
 * skyline buildings; within reach the detailed tile takes their place. Each tile brings its traffic,
 * signals, people and street lights when it arrives.
 */
const BASE = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/') + 'oceandrive/';
const LOAD_D = 650;
const SHOW_D = 1100;

export interface CountyHooks {
  /** a tile is in: its traffic, signals, walkers, lamps (three coords where it matters) */
  arrived: (t: Tile) => void;
}

interface Slot {
  info: TileInfo;
  box: THREE.Box2; // three x, z
  tile: Tile | null;
  loading: boolean;
}

export class County {
  readonly slots: Slot[];
  readonly loaded: Tile[] = [];
  private acc = 1;
  /** every tile's street data (for the police's map of the streets), fetched up front */
  datas: DtData[] = [];

  constructor(readonly env: Env, readonly scene: THREE.Scene, tiles: TileInfo[], readonly skyline: Skyline | null, readonly hooks: CountyHooks) {
    this.slots = tiles.map((info) => {
      const b = new THREE.Box2();
      for (const [x, y] of info.core) b.expandByPoint(new THREE.Vector2(x, -y));
      return { info, box: b, tile: null, loading: false };
    });
  }

  async fetchData() {
    this.datas = await Promise.all(this.slots.map((s) => fetch(BASE + s.info.data).then((r) => r.json() as Promise<DtData>)));
    return this.datas;
  }

  private dist(s: Slot, p: THREE.Vector3) {
    return s.box.distanceToPoint(new THREE.Vector2(p.x, p.z));
  }

  /** load what's near p now (before the game starts) */
  async preload(p: THREE.Vector3, progress: (f: number) => void) {
    const near = this.slots.filter((s) => this.dist(s, p) < LOAD_D);
    let done = 0;
    await Promise.all(near.map((s) => this.load(s, (f) => progress((done + f) / near.length)).then(() => done++)));
    this.update(0, p, true);
  }

  private async load(s: Slot, progress: (f: number) => void = () => {}) {
    if (s.tile || s.loading) return;
    s.loading = true;
    try {
      const t = await loadTile(this.env, s.info, progress);
      s.tile = t;
      this.loaded.push(t);
      this.scene.add(t.root);
      this.hooks.arrived(t);
    } catch (e) {
      console.warn('[county] tile', s.info.name, e);
    } finally {
      s.loading = false;
    }
  }

  update(dt: number, eye: THREE.Vector3, force = false) {
    this.acc += dt;
    if (!force && this.acc < 0.5) return;
    this.acc = 0;
    for (const s of this.slots) {
      const d = this.dist(s, eye);
      if (!s.tile && !s.loading && d < LOAD_D) void this.load(s);
      const show = !!s.tile && d < SHOW_D;
      if (s.tile) s.tile.root.visible = show;
      const g = this.skyline?.groups.get(s.info.name);
      if (g) for (const o of g) o.visible = !show;
    }
  }

  /** the label of the tile you're in ('' on the beach) */
  where(p: THREE.Vector3): string {
    for (const s of this.slots) if (this.dist(s, p) === 0) return s.info.label;
    return '';
  }
}
