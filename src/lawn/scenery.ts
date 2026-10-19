/**
 * Everything around the grass: the boundary (timber fence, hedge or stone wall), the house and
 * patio, the trees and bushes, the garden furniture, the pond. Built per lawn from its level.
 */
import * as THREE from 'three';
import type { LevelDef } from './levels.ts';
import type { MaskField } from './mask.ts';
import type { Particles } from './fx.ts';
import type { View } from './lawn.ts';
import { TreeField, treeKit, type TreePlacement } from './trees.ts';
import { buildBoundary } from './boundary.ts';
import { buildProps } from './props.ts';
import { buildHouse } from './house.ts';
import { Rng } from './util.ts';
import { TS } from './nav.ts';
import { BACKDROP, gardenTree, SHRUBS } from './trees.ts';

export interface SceneryCtx {
  mx: number;
  mz: number;
  view: View;
  time: number;
  sun: THREE.Vector3;
}

export interface Scenery {
  group: THREE.Object3D;
  update?(dt: number, ctx: SceneryCtx): void;
  dispose?(): void;
}

export async function buildScenery(level: LevelDef, mask: MaskField, fx: Particles): Promise<Scenery[]> {
  const out: Scenery[] = [];
  const trees: TreePlacement[] = [];
  const theme = level.theme;
  const tint = (k: number): [number, number, number] => [1 + (theme.leafTint[0] - 1) * k, 1 + (theme.leafTint[1] - 1) * k, 1 + (theme.leafTint[2] - 1) * k];

  // the garden's own trees and bushes
  for (const o of level.obstacles) {
    if (o.kind === 'tree') {
      const g = gardenTree(o.variant, o.size);
      trees.push({ proto: g.proto, x: o.x, z: o.z, s: g.s, rot: o.seed % 6.28, tint: tint(0.9), lod: 0, shade: true, fade: true });
    } else if (o.kind === 'shrub') {
      trees.push({ proto: SHRUBS[o.variant % SHRUBS.length], x: o.x, z: o.z, s: o.size * 0.55, rot: o.seed % 6.28, tint: tint(0.7), lod: 0, shade: false, fade: false });
    }
  }

  const boundary = await buildBoundary(level);
  out.push(boundary.scenery);
  trees.push(...boundary.trees);
  const props = await buildProps(level, mask, fx);
  out.push(...props.scenery);
  trees.push(...props.trees);

  // a wood and gardens beyond the fences
  const rng = new Rng(level.seed * 5 + 1);
  const W = level.w * TS;
  const H = level.h * TS;
  const R0 = Math.hypot(W, H) / 2 + 6;
  const n = 46;
  const hs = level.house;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.08, 0.08);
    const r = R0 + rng.range(2, 22);
    const x = Math.cos(a) * r * (W / H > 1.4 ? 1.25 : 1);
    const z = Math.sin(a) * r;
    // (never on the lawn, nor on the house)
    if (level.nav.playable(x, z)) continue;
    if (hs && x > hs.x0 - 3 && x < hs.x1 + 3 && z < hs.z + 0.5 && z > hs.z - 11) continue;
    const proto = BACKDROP[rng.int(0, BACKDROP.length - 1)];
    const near = r < R0 + 8;
    trees.push({ proto, x, z, s: rng.range(0.4, 0.75), rot: rng.range(0, 6.28), tint: tint(1), lod: near ? 1 : 2, shade: near, fade: near });
  }

  for (const p of trees) if (!SHRUBS.includes(p.proto)) p.fade = true;
  const kit = await treeKit();
  out.push(new TreeField(kit, trees, new THREE.Vector3(0.3, 0.8, -0.5)));
  if (hs) out.push(await buildHouse(level));
  return out;
}
