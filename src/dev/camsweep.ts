import * as THREE from 'three';

/**
 * Dev: drive the followed car around the whole lap (teleported every `step`
 * metres on the racing line) under each trackside camera mode, and check each
 * frame's sight line with a real raycast against the scene (trees, stands,
 * walls, terrain). Run from the console / tools/shot.mjs:
 *
 *   const m = await import('/src/dev/camsweep.ts'); await m.sweep(__game, { modes: ['tv'], step: 25 })
 */

type AnyGame = Record<string, any>;

const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export interface SweepRow {
  mode: string;
  s: number;
  cam: string;
  where: string;
  lost: boolean;
  blocked: boolean;
  hit: string;
  dist: number;
}

export async function sweep(g: AnyGame, opts: { modes?: string[]; step?: number; from?: number; to?: number; frames?: number; onFrame?: (row: SweepRow) => Promise<void> | void }) {
  const modes = opts.modes ?? ['tv'];
  const step = opts.step ?? 25;
  if (g.state !== 'spectate') g.debugSpectate({ laps: 5, director: false });
  const track = g.track;
  const c = g.race.cars[g.focusId];
  const rig = g.rigs.get(c.entry);
  let s = 0;
  const place = () => {
    c.car.placeOnTrack(track, s, track.racingLineAt(s));
    c.car.setSpeed(55);
  };
  const orig = g.spectateFrame;
  g.spectateFrame = (dt: number) => {
    place();
    g.syncAllViews(dt);
    g.cams.update(dt, c.car, rig, track);
  };
  g.directorOn = false;
  const roots = [g.trackside.group, g.pits.group, g.env.group];
  const ray = new THREE.Raycaster();
  const rows: SweepRow[] = [];
  const target = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const L = track.length;
  try {
    for (const mode of modes) {
      g.cams.set(mode);
      for (s = opts.from ?? 0; s < (opts.to ?? L); s += step) {
        for (let k = 0; k < (opts.frames ?? 3); k++) await raf();
        const cam = g.camera.position as THREE.Vector3;
        rig.root.getWorldPosition(target);
        target.y += 0.7;
        const dist = cam.distanceTo(target);
        dir.copy(target).sub(cam).normalize();
        ray.set(cam, dir);
        ray.near = 0.3;
        ray.far = Math.max(0.4, dist - 4);
        let hit = '';
        for (const h of ray.intersectObjects(roots, true)) {
          const m = (h.object as THREE.Mesh).material as THREE.Material | THREE.Material[];
          const mat = Array.isArray(m) ? m[0] : m;
          if (!mat || mat.visible === false || mat.depthWrite === false || mat.side === THREE.BackSide) continue;
          if ((h.object as THREE.SkinnedMesh).isSkinnedMesh || h.object.name === 'horizon') continue;
          const see = (mat.alphaTest ?? 0) > 0 && !(h.object as THREE.BatchedMesh).isBatchedMesh;
          if (see && h.distance > 14) continue;
          hit = `${h.object.name || h.object.parent?.name || h.object.type}@${h.distance.toFixed(0)}`;
          break;
        }
        const row: SweepRow = { mode, s: Math.round(s), cam: g.cams.mode, where: g.cams.where, lost: g.cams.lost, blocked: hit !== '', hit, dist: Math.round(dist) };
        rows.push(row);
        await opts.onFrame?.(row);
      }
    }
  } finally {
    g.spectateFrame = orig;
  }
  const summary: Record<string, { n: number; blocked: number; lost: number; hits: string[] }> = {};
  for (const r of rows) {
    const o = (summary[r.mode] ??= { n: 0, blocked: 0, lost: 0, hits: [] });
    o.n++;
    if (r.blocked) {
      o.blocked++;
      if (o.hits.length < 12) o.hits.push(`${r.s}:${r.where}:${r.hit}`);
    }
    if (r.lost) o.lost++;
  }
  return { summary, rows };
}
