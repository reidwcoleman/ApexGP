import * as THREE from 'three';
import { WorldMap } from './worldmap.ts';
import { fbm2, hash2i, rng, smoothstep } from './noise.ts';
import { fieldWarp } from './textures.ts';
import { buildTreeKit, PROTO_INFO, SPECIES_PROTOS, whenTreeKit, type SpeciesId, type TreeKit } from './treeproto.ts';
import { createTreeUniforms, impostorMaterial, TREE_FADE, treeDepthMaterial, treeMaterial, type TreeUniforms } from './treematerial.ts';
import type { Layout } from './layout.ts';
import { spielbergSpecies } from './venues/spielberg.ts';
import { hungaroringSpecies } from './venues/hungaroringLand.ts';

/**
 * The woods of the Parco di Monza.
 *
 * Placement: a jittered grid over the park driven by the forest density
 * (dense right up to the catch fences for most of the lap, open lawns at the
 * stands, Ascari and the Parabolica, big meadows further out, farmland with
 * copses outside the park wall), species by stand-type noise, a layered
 * woodland edge (hazel/bramble understorey and young trees in front of the
 * mature ones), plane-tree avenues and rows of Lombardy poplars.
 *
 * The trees are Poly Haven's scanned trees, baked offline (tools/bake_trees.mjs → treeproto.ts);
 * the far woods are placed sparser with bigger trees (same canopy cover, half the instances).
 *
 * Rendering (≈ 3 draw calls + shadows):
 *   near  one BatchedMesh with every prototype's LOD0/1/2; only trees within
 *         ~125 m of the circuit are in it, only those within the 3D range of the
 *         camera (89 m on High, conifers 52 m) visible, sorted front to back
 *         (LOD0 < 34 m, LOD1 < 50 m). Each tree has two instances in it (even LOD,
 *         odd LOD). A tree that changes its detail dissolves from one into the other
 *         (or into / out of its impostor) in a matched dither over 0.3 s and is then
 *         left alone (5 m of hysteresis): never a swap in one frame, and never a tree
 *         left half-dithered because it stands near a boundary (see change()).
 *         Doesn't cast shadows itself:
 *   shade a second BatchedMesh of the same trees at LOD2 only (out to 64 m), drawn
 *         into the shadow maps and nowhere else (its camera-pass draw list is
 *         emptied) — leafy shadows at a fraction of the full trees' cost in both
 *         cascades, thinning out leaf by leaf over their last 11 m; beyond, the
 *         ground's crown-shade mask.
 *   far   one instanced impostor card per tree (all of them, nearest the circuit
 *         first), showing the scan's baked frames; a near tree's impostor takes the
 *         other half of its 3D tree's dissolve.
 * Look-ahead: every one of those distances is measured not from the camera but from the
 * stretch of road it will cover in the next half second (its own travel, measured frame
 * to frame — a static TV camera gets none). At 300 km/h a tree beside the track used to
 * reach full detail ~20 m before the car (a quarter of a second: "as you pass it"); now
 * the detail is there ~55 m out (High), while what lies beside and behind (and every distance at
 * a standstill) is unchanged, so the cost stays where the view is.
 * Both are built once the baked files have arrived (Game.completeWorldInBackground awaits them
 * before the landscape is built, so no session ever starts — nor any view show — without them).
 */

export interface VegetationBuild {
  group: THREE.Group;
  uniforms: TreeUniforms;
  update(camera: THREE.Camera, elapsed: number): void;
  /**
   * The big screens' feed lens (true) and back (false): the 3D trees are laid out round the main
   * camera only, so the feed — a few hundred pixels wide, often a kilometre away — draws every tree
   * as its impostor instead (no holes where the main view's 3D trees would stand, and far cheaper).
   */
  feedView(on: boolean): void;
  /** dev: the 3D reach scaled (0: every tree its impostor — tools/treehand.mjs), and counts of the
   *  changes of detail: dissolves, instant ones without a cut (pops: should stay 0), at cuts, and
   *  changes held back until the dissolve before them is done (tools/treepop.mjs) */
  debug: { reach: number; fades: number; pops: number; snaps: number; deferred: number; cuts: number };
  /** how far the 3D trees reach before the impostors take over (quality level) */
  setDetail(q: 'low' | 'medium' | 'high' | 'ultra'): void;
  count: number;
  near: number;
  /** crown shade discs for the ground mask */
  shade: { x: number; z: number; r: number }[];
  kit: TreeKit;
  timings: Record<string, number>;
  /** placed trees (debug / props) */
  trees: { x: number; y: number; z: number; proto: number; s: number }[];
}

interface Tree {
  x: number;
  y: number;
  z: number;
  proto: number;
  s: number;
  rot: number;
  tint: THREE.Color;
  flip: boolean;
}

const fract = (x: number) => x - Math.floor(x);
/** the scans' leaf colour → the footage's: broadleaf a deeper, less yellow olive, spruce near-black
 *  blue-green, the (pale Searsia) bushes darker */
const BROAD_K = new THREE.Color(0.74, 0.9, 0.8);
const SPRUCE_K = new THREE.Color(0.3, 0.45, 0.4);
const SHRUB_K = new THREE.Color(0.56, 0.7, 0.6);
const NEAR_BAND = 125; // trees closer than this to the circuit get a 3D version
const R3D = 170;
const LOD0 = 72;
const LOD1 = 100;
/** look-ahead: seconds of the camera's travel the detail reaches ahead of it (capped per quality level) */
const LOOK_T = 0.5;
/** how long a tree takes to change its detail (s): a dissolve, quick enough never to be watched */
const FADE = TREE_FADE;
/** hysteresis round each detail boundary (m): a tree near one doesn't flap between its LODs */
const HYST = 5;
/** a camera move bigger than this in one frame (m) is a cut */
const CUT_M = 12;

/**
 * The 3D trees' instance colour w: the species flag (1 broadleaf, 2 conifer) and the instance's
 * fade — fading in (dirIn 1) or out (0), started at t0 (s of the scenery clock, kept to 1/60 s;
 * 0: steady). treematerial decodes it (TREE_FADE). Floats hold integers exactly to 2^24: ≈ 12 h.
 */
function fadeCode(flag: number, dirIn: number, t0: number) {
  return flag + 3 * dirIn + 6 * (t0 > 0 ? Math.max(1, Math.round(t0 * 60)) : 0);
}

export function buildVegetation(map: WorldMap, layout: Layout, renderer: THREE.WebGLRenderer): VegetationBuild {
  const timings: Record<string, number> = {};
  let tl = performance.now();
  const lap = (k: string) => {
    const n = performance.now();
    timings[k] = Math.round(n - tl);
    tl = n;
  };
  const kit = buildTreeKit();
  const r = rng(424242);
  const trees: Tree[] = [];
  const S = map.SQUARE;
  const track = map.track;

  // the flat umbrella crowns (Burkea scan) stand in for the dry-country trees: Abu Dhabi's ghaf and
  // acacia, Texas mesquite, Albert Park's gums, São Paulo's tipuanas, a few in Mexico City
  const UMBRELLA: Partial<Record<string, number>> = { yasmarina: 1, austin: 0.4, melbourne: 0.45, interlagos: 0.35, mexico: 0.25 };
  const pick = (sp: SpeciesId, h: number) => {
    const u = UMBRELLA[map.venue] ?? 0;
    if (u > 0 && (sp === 'oak' || sp === 'plane' || sp === 'chestnut') && fract(h * 13.7) < u) sp = 'umbrella';
    const list = SPECIES_PROTOS[sp];
    return list[Math.floor(h * list.length) % list.length];
  };
  const tintFor = (sp: SpeciesId, h: number, h2: number, h3 = fract(h * 7.31 + h2 * 3.17)) => {
    // every tree its own green: brightness, and a hue swing between fresh yellow-green
    // and deep blue-green (the variety that makes a wood read as many trees, not one mass)
    const j = (h - 0.5) * 0.24;
    const hue = (h3 - 0.5) * 2;
    const c = new THREE.Color((1 + j) * (1 + hue * 0.1), (1 + j * 0.9) * (1 + hue * 0.03), (1 + j * 0.5) * (1 - hue * 0.14));
    // (the scans' leaf photos are bright, fresh: a real spruce is near-black blue-green from any
    // distance, and broadleaf woods read as a dark olive mass in the footage)
    // (scan albedo, linear: broadleaf ≈ 0.1, 0.12, 0.04 — olive, R ≈ G; spruce the same; the bushes 0.18)
    if (sp === 'spruce') c.multiply(SPRUCE_K).multiplyScalar(0.92 + h3 * 0.18);
    else if (sp === 'shrub') c.multiply(SHRUB_K);
    else c.multiply(BROAD_K);
    // São Paulo in spring (November): deep, glossy tropical greens, nothing turning
    if (map.venue === 'interlagos') return c.multiply(new THREE.Color(0.9, 1.06, 0.84));
    // a few trees already turning (September): planes go yellow-brown, chestnuts brown
    // (not in Montréal: the Canadian GP is in June)
    if (map.venue === 'montreal') return c;
    // Sakhir: dusty grey-olive desert scrub
    if (map.venue === 'sakhir') return c.multiply(new THREE.Color(1.34, 1.0, 0.6));
    // Melbourne in March: the gums (oak / poplar / spruce crowns) blue-grey and olive, a few planes and elms turning
    if (map.venue === 'melbourne' && (sp === 'oak' || sp === 'poplar' || sp === 'spruce')) return c.multiply(new THREE.Color(0.8, 0.93, 0.86));
    // Abu Dhabi: dusty grey-olive desert trees (ghaf, acacia, sidr)
    if (map.venue === 'yasmarina') return c.multiply(sp === 'shrub' ? new THREE.Color(1.3, 1.0, 0.62) : new THREE.Color(1.02, 0.96, 0.74));
    // Mexico City at the end of the rainy season (late October): full, slightly dusty greens
    if (map.venue === 'mexico') return c.multiply(new THREE.Color(0.98, 1.02, 0.86));
    // Hungary in late July: dusty, olive, heat-tired foliage (nothing turning yet)
    if (map.venue === 'hungaroring') return c.multiply(new THREE.Color(1.04, 1.0, 0.8));
    if (h2 < 0.05 && (sp === 'plane' || sp === 'chestnut' || sp === 'poplar')) c.setRGB(1.28, 1.02, 0.5);
    else if (h2 < 0.09 && sp !== 'shrub' && sp !== 'spruce') c.setRGB(1.12, 1.03, 0.78);
    return c;
  };
  /** species by stand type */
  const speciesAt = (x: number, z: number, h: number): SpeciesId => {
    const n = fbm2(x / 260 + 4.1, z / 260 - 2.7, 3);
    const n2 = fbm2(x / 90 - 1.3, z / 90 + 8.8, 2);
    // the Ardennes: spruce plantations with stands of beech/oak (the chestnut crowns stand in for beech)
    // (about a quarter broadleaf, in stands, so the hills read as dark conifer with patches of lighter beech)
    if (map.venue === 'ardennes') return n < 0.12 || (n < 0.3 && h > 0.4) || h > 0.85 ? 'spruce' : n2 > -0.1 ? 'chestnut' : 'oak';
    // English lowland: oak and ash (the plane crowns stand in for ash), a few horse chestnuts and poplars
    if (map.venue === 'airfield') return n < 0.05 ? 'oak' : n < 0.3 ? 'plane' : n2 > 0.3 ? 'poplar' : 'chestnut';
    // Suzuka: sugi cedar and pine on the slopes (the spruce crowns stand in), oak and chestnut in the hollows
    if (map.venue === 'suzuka') return n < 0.15 || h > 0.5 ? 'spruce' : n2 > 0.1 ? 'oak' : 'chestnut';
    // Zandvoort: dune scrub (sea buckthorn, creeping willow) and wind-bent pines; pine plantations
    // (the spruce crowns stand in) and the estates' oaks inland
    if (map.venue === 'zandvoort') return map.forest(x, z) > 0.55 && map.distToTrack(x, z) > 480 ? (h < 0.8 ? 'spruce' : n2 > 0 ? 'oak' : 'chestnut') : h < 0.95 ? 'shrub' : 'spruce';
    // São Paulo: tipuanas and sibipirunas (the plane crowns: wide, feathery), figs and mango (oak), ipês (chestnut)
    if (map.venue === 'interlagos') return n < -0.05 || h < 0.25 ? 'plane' : n2 > 0.15 ? 'chestnut' : 'oak';
    // Styria: spruce (and larch) forest on the slopes, beech stands (the chestnut crowns), ash and lime in the valley
    if (map.venue === 'spielberg') return spielbergSpecies(map, x, z, n, n2, h);
    // the Gödöllő Hills: oak woods, black locust (the chestnut crowns), a few black pines, poplar lines
    if (map.venue === 'hungaroring') return hungaroringSpecies(map, x, z, n, n2, h);
    // Texas: live oak (the oak crowns), pecan (chestnut crowns) and mesquite / cedar scrub
    if (map.venue === 'austin') return n2 > 0.3 ? 'chestnut' : h < 0.16 ? 'shrub' : 'oak';
    // Sakhir: desert scrub only (the palms are venues/sakhirScenery.ts)
    if (map.venue === 'sakhir') return 'shrub';
    // Montréal: silver and Norway maples (the plane crowns: palmate leaves), ash and oak, a few
    // poplars along the water and spruce in the Expo 67 gardens
    // Mexico City: eucalyptus (the poplar crowns stand in: tall, narrow), ash (fresno: the plane
    // crowns), cypress and pine (spruce), jacaranda and ahuehuete (oak, chestnut)
    if (map.venue === 'mexico') return n < -0.2 || h < 0.1 ? 'poplar' : n < 0.18 ? (n2 > 0 ? 'plane' : 'oak') : h < 0.3 ? 'spruce' : 'chestnut';
    // Yas Island: ghaf and acacia (low, wide oak crowns) and scrub out on the sand (the palms are the scenery's)
    if (map.venue === 'yasmarina') return h < 0.45 ? 'shrub' : 'oak';
    if (map.venue === 'montreal') return h < 0.07 ? 'spruce' : n < -0.12 ? 'plane' : n < 0.22 ? (n2 > 0.3 ? 'poplar' : n2 > -0.1 ? 'plane' : 'oak') : n2 > 0 ? 'chestnut' : 'plane';
    // Albert Park: river red gums and other eucalypts (the oak crowns: wide, open, tinted grey-green),
    // English elms (chestnut) and London planes lining the roads, the odd Monterey cypress
    if (map.venue === 'melbourne') return h < 0.04 ? 'spruce' : n < -0.08 ? 'oak' : n < 0.2 ? 'plane' : n2 > -0.05 ? 'chestnut' : 'oak';
    let sp: SpeciesId;
    if (n < -0.18) sp = 'plane';
    else if (n < 0.12) sp = 'oak';
    else if (n < 0.34) sp = 'chestnut';
    else sp = n2 > 0.25 ? 'poplar' : 'plane';
    // mixed woods: a quarter of the trees are something else
    if (h < 0.12) sp = 'oak';
    else if (h < 0.2) sp = 'plane';
    else if (h < 0.26) sp = 'chestnut';
    return sp;
  };

  const okTree = (x: number, z: number, trackGap: number) => {
    if (x < S.x0 + 30 || x > S.x1 - 30 || z < S.z0 + 30 || z > S.z1 - 30) return false;
    if (map.trackClearance(x, z) < trackGap) return false;
    if (map.excluded(x, z, 1)) return false;
    if (map.ovalClearance(x, z) < 1.5) return false;
    if (map.pathDistance(x, z).d < 1.2) return false;
    if (map.inPitZone(x, z, 8)) return false;
    return true;
  };
  const add = (sp: SpeciesId, x: number, z: number, scale: number, h: number, h2: number) => {
    // (Zandvoort: the pines out in the open dunes are small and wind-bent, the scrub dense and low)
    if (map.venue === 'zandvoort' && (map.forest(x, z) < 0.55 || map.distToTrack(x, z) <= 480)) scale *= sp === 'spruce' ? 0.5 : sp === 'shrub' ? 1.3 : 1;
    const y = map.height(x, z) - 0.12;
    // Texas trees are low and wide-spreading: live oak, mesquite, stunted cedar
    if (map.venue === 'austin') scale *= sp === 'spruce' ? 0.55 : sp === 'shrub' ? 1 : 0.8;
    // low, sparse desert bushes
    if (map.venue === 'sakhir') scale *= 0.45;
    // the gums stand tall over the park
    if (map.venue === 'melbourne') scale *= sp === 'oak' ? 1.15 : 1;
    if (map.venue === 'yasmarina') scale *= sp === 'shrub' ? 0.9 : 0.6;
    trees.push({ x, y, z, proto: pick(sp, h), s: scale, rot: h2 * Math.PI * 2 * 7.3, tint: tintFor(sp, hash2i(Math.floor(x * 3), Math.floor(z * 3), 21), h2), flip: h > 0.5 });
  };

  // ---------------------------------------------------------------- the woods (jittered grid)
  {
    const bb = map.A.bb;
    // (the far woods are drawn with fewer, bigger trees: the same canopy cover — crown area grows
    // with the square of the scale — from half the instances; at that range nobody counts trunks)
    for (let pass = 0; pass < 3; pass++) {
      const C = pass === 0 ? 8.6 : pass === 1 ? 15 : 24;
      const big = pass === 0 ? 1 : pass === 1 ? 1.18 : 1.45;
      // pass 0 only needs the circuit's bounding box (+ its 360 m reach)
      const X0 = pass === 0 ? Math.max(S.x0 + 40, Math.floor((bb.x0 - 380) / C) * C) : S.x0 + 40;
      const X1 = pass === 0 ? Math.min(S.x1 - 40, bb.x1 + 380) : S.x1 - 40;
      const Z0 = pass === 0 ? Math.max(S.z0 + 40, Math.floor((bb.z0 - 380) / C) * C) : S.z0 + 40;
      const Z1 = pass === 0 ? Math.min(S.z1 - 40, bb.z1 + 380) : S.z1 - 40;
      for (let z = Z0; z < Z1; z += C)
        for (let x = X0; x < X1; x += C) {
          const d = map.distToTrack(x, z);
          // pass 0: within 360 m of the track, pass 1: 360–1300 m, pass 2: beyond
          if (pass === 0 && d > 360) continue;
          if (pass === 1 && (d <= 360 || d > 1300)) continue;
          if (pass === 2 && d <= 1300) continue;
          const ix = Math.floor(x / C), iz = Math.floor(z / C);
          const px = x + (hash2i(ix, iz, 1 + pass) - 0.5) * C * 0.92;
          const pz = z + (hash2i(ix, iz, 5 + pass) - 0.5) * C * 0.92;
          const f = map.forest(px, pz);
          if (f < 0.04) continue;
          const keep = pass === 0 ? 0.95 : pass === 1 ? 0.85 : 0.75;
          const h = hash2i(ix, iz, 9 + pass);
          if (h > f * keep) continue;
          if (!okTree(px, pz, 4.2)) continue;
          const h2 = hash2i(ix, iz, 13 + pass);
          const sp = speciesAt(px, pz, hash2i(ix, iz, 17 + pass));
          // lone trees on lawns grow bigger; young trees mix into the woods
          const lone = f < 0.35 ? 1.12 : 1;
          const young = h2 > 0.86 ? 0.62 + h2 * 0.2 : 1;
          add(sp, px, pz, (0.84 + hash2i(ix, iz, 19) * 0.32) * lone * young * big, h / Math.max(f * keep, 1e-3), h2);
        }
    }
  }
  // ---------------------------------------------------------------- layered woodland edge along the circuit
  {
    const p = new THREE.Vector3();
    for (const side of [-1, 1]) {
      for (let s = 0; s < track.n; s += 3.2) {
        const hs = hash2i(Math.floor(s), side, 31);
        const bar = track.barrierAt(s, side);
        track.point(s, side * (bar + 7), 0, p);
        const f = map.forest(p.x, p.z);
        if (f < 0.35) continue;
        // understorey shrubs right behind the fence line, and a second, taller band further in
        if (hs < 0.8) {
          const lat = side * (bar + 2.8 + hash2i(Math.floor(s), side, 32) * 5);
          track.point(s + (hs - 0.5) * 3, lat, 0, p);
          if (okTree(p.x, p.z, 2.4)) add('shrub', p.x, p.z, 0.8 + hash2i(Math.floor(s), side, 33) * 0.7, hs, 0.5);
        }
        if (hs > 0.25) {
          const lat = side * (bar + 8 + hash2i(Math.floor(s), side, 38) * 9);
          track.point(s + 1.6, lat, 0, p);
          if (okTree(p.x, p.z, 3)) add('shrub', p.x, p.z, 1.2 + hash2i(Math.floor(s), side, 39) * 0.8, 1 - hs, 0.5);
        }
        // young trees between the shrubs and the big trees
        if (hs > 0.5) {
          const lat = side * (bar + 5 + hash2i(Math.floor(s), side, 34) * 7);
          track.point(s, lat, 0, p);
          const sp = speciesAt(p.x, p.z, hash2i(Math.floor(s), side, 35));
          if (okTree(p.x, p.z, 4)) add(sp, p.x, p.z, 0.45 + hash2i(Math.floor(s), side, 36) * 0.25, hash2i(Math.floor(s), side, 37), 0.5);
        }
      }
    }
  }
  // scattered understorey inside the woods near the circuit
  // (half what it was: under the canopy most of it was never seen)
  for (let k = 0; k < 2500; k++) {
    const i = Math.floor(r() * track.n);
    const side = r() < 0.5 ? -1 : 1;
    const lat = side * (track.barrierAt(i, side) + 8 + r() * 70);
    const q = track.point(i, lat, 0);
    if (map.forest(q.x, q.z) < 0.5) continue;
    if (!okTree(q.x, q.z, 3)) continue;
    add('shrub', q.x, q.z, 0.6 + r() * 0.7, r(), 0.5);
  }
  // ---------------------------------------------------------------- desert scrub by the circuit
  // (Sakhir, Yas: the sand beyond the fences isn't bare — low saltbush and grass tussocks dot it,
  // in loose clumps, thinning out with distance; nothing on the lawns or the paving)
  if (map.venue === 'sakhir' || map.venue === 'yasmarina') {
    for (let k = 0; k < 9000; k++) {
      const i = Math.floor(r() * track.n);
      const side = r() < 0.5 ? -1 : 1;
      const far = r();
      const lat = side * (track.barrierAt(i, side) + 6 + far * far * 220);
      const q = track.point(i, lat, 0);
      // clumps: a low-frequency field decides where the scrub grows
      const clump = fbm2(q.x / 55 + 3.3, q.z / 55 - 7.1, 2);
      if (clump < 0.05 + far * 0.2) continue;
      if (map.forest(q.x, q.z) > 0.6 || map.pathDistance(q.x, q.z).d < 3) continue;
      if (!okTree(q.x, q.z, 5)) continue;
      const n = 1 + Math.floor(r() * 3);
      for (let j = 0; j < n; j++) {
        const x = q.x + (r() - 0.5) * 5, z = q.z + (r() - 0.5) * 5;
        if (!okTree(x, z, 5)) continue;
        add('shrub', x, z, 0.35 + r() * 0.45, r(), 0.5);
      }
    }
  }
  // ---------------------------------------------------------------- avenues & poplar rows
  for (const q of layout.avenueTrees) {
    if (!okTree(q.x, q.z, 6)) continue;
    add('plane', q.x, q.z, 0.95 + r() * 0.15, r(), r() * 0.3 + 0.2);
  }
  for (const q of layout.poplarRows) {
    if (q.x < S.x0 + 30 || q.x > S.x1 - 30 || q.z < S.z0 + 30 || q.z > S.z1 - 30) continue;
    if (map.trackClearance(q.x, q.z) < 8 || map.excluded(q.x, q.z, 1) || map.ovalClearance(q.x, q.z) < 2) continue;
    add('poplar', q.x, q.z, 0.9 + r() * 0.2, r(), r() * 0.5 + 0.3);
  }
  // ---------------------------------------------------------------- field hedgerows and tree lines
  // Out on the farmland every field is bounded by something that stands up out of it: hawthorn
  // hedges with an oak every so often (Northamptonshire, Brianza), poplar and acacia windbreaks
  // (the Great Plain), live oak and mesquite along the Texas fence lines, spruce and ash between
  // the Styrian meadows. They follow the terrain shader's own field grid (the same warped cells:
  // textures.fieldWarp), gappy in places, well away from the circuit — impostors only.
  {
    type Hedge = { fs: [number, number]; keep: number; tree: number; trees: SpeciesId[]; shrub: [number, number]; step: number; treeS: [number, number] };
    const HEDGES: Partial<Record<typeof map.venue, Hedge>> = {
      airfield: { fs: [320, 210], keep: 0.9, tree: 0.24, trees: ['oak', 'oak', 'plane', 'chestnut'], shrub: [1.5, 0.6], step: 7, treeS: [0.72, 0.4] },
      park: { fs: [320, 210], keep: 0.55, tree: 0.4, trees: ['poplar', 'poplar', 'plane', 'oak'], shrub: [1.3, 0.5], step: 8, treeS: [0.8, 0.3] },
      ardennes: { fs: [320, 210], keep: 0.6, tree: 0.3, trees: ['oak', 'chestnut', 'spruce'], shrub: [1.4, 0.5], step: 7, treeS: [0.75, 0.35] },
      spielberg: { fs: [320, 210], keep: 0.6, tree: 0.45, trees: ['spruce', 'oak', 'chestnut'], shrub: [1.3, 0.5], step: 9, treeS: [0.7, 0.35] },
      austin: { fs: [320, 210], keep: 0.7, tree: 0.55, trees: ['oak', 'oak', 'oak', 'spruce'], shrub: [1.2, 0.5], step: 9, treeS: [0.8, 0.45] },
      hungaroring: { fs: [560, 380], keep: 0.68, tree: 0.5, trees: ['poplar', 'oak', 'plane', 'poplar'], shrub: [1.4, 0.5], step: 8, treeS: [0.75, 0.35] },
    };
    const H = HEDGES[map.venue];
    if (H) {
      const n0 = trees.length;
      const G = 6;
      const band = G / 2;
      const [fw, fh] = H.fs;
      for (let z = S.z0 + 40; z < S.z1 - 40; z += G)
        for (let x = S.x0 + 40; x < S.x1 - 40; x += G) {
          const [wx, wz] = fieldWarp(x, z);
          const u = wx / fw, v = wz / fh;
          const cu = Math.floor(u), cv = Math.floor(v);
          const du = Math.min(u - cu, cu + 1 - u) * fw;
          const dv = Math.min(v - cv, cv + 1 - v) * fh;
          const vertical = du < dv;
          if (Math.min(du, dv) > band) continue;
          // one boundary: its id (for gaps + spacing) and the running coordinate along it
          const lineId = vertical ? Math.round(u) * 7919 + 13 : Math.round(v) * 104729 + 7;
          const along = vertical ? wz : wx;
          // spacing: the scan meets a boundary about every G metres; keep G/step of those
          const slot = Math.floor(along / G);
          if (hash2i(slot, lineId, 3) > G / H.step) continue;
          // gaps: grubbed-out stretches and gateways; some boundaries are bare wire fences
          if (hash2i(lineId, 0, 5) > H.keep) continue;
          const gap = fbm2(along / 170 + lineId * 0.013, lineId * 0.07, 2);
          if (gap < -0.1) continue;
          const out = map.outsidePark(x, z);
          if (out < 0.5 || map.distToTrack(x, z) < 160) continue;
          if (map.forest(x, z) > 0.45 || map.urban(x, z) > 0.2 || map.height(x, z) > 260) continue;
          const px = x + (hash2i(slot, lineId, 9) - 0.5) * 2.2, pz = z + (hash2i(slot, lineId, 11) - 0.5) * 2.2;
          if (!okTree(px, pz, 20)) continue;
          const h = hash2i(slot, lineId, 17);
          const h2 = hash2i(slot, lineId, 19);
          if (h < H.tree) add(H.trees[Math.floor(h2 * H.trees.length) % H.trees.length], px, pz, H.treeS[0] + hash2i(slot, lineId, 23) * H.treeS[1], h / H.tree, h2);
          else add('shrub', px, pz, H.shrub[0] + hash2i(slot, lineId, 29) * H.shrub[1], h, 0.5);
        }
      timings.hedges = trees.length - n0;
    }
  }
  // saplings growing out of the abandoned banking's edges
  if (layout.oval) {
    const o = layout.oval;
    for (let i = 20; i < o.n - 20; i += 23) {
      if (Math.abs(i - o.bridgeU) < 40) continue;
      const h = hash2i(i, 3, 41);
      if (h > 0.55) continue;
      const side = h < 0.3 ? -1 : 1;
      const off = side * (o.width / 2 + 0.6);
      const x = o.x[i] + o.tz[i] * -off, z = o.z[i] + o.tx[i] * off;
      trees.push({ x, y: map.height(x, z), z, proto: pick(h < 0.2 ? 'shrub' : 'oak', h * 3), s: h < 0.2 ? 0.8 : 0.35 + h * 0.3, rot: h * 40, tint: new THREE.Color(1, 1, 1), flip: h > 0.3 });
    }
  }

  lap('place');
  // ---------------------------------------------------------------- render: near batch + impostors
  const uniforms = createTreeUniforms();
  const group = new THREE.Group();
  group.name = 'Vegetation';

  const nearIdx: number[] = [];
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    if (map.distToTrack(t.x, t.z) < NEAR_BAND) nearIdx.push(i);
  }
  const isNear = new Uint8Array(trees.length);
  // (conifers too: their cards are stretches of bough lying in the bough's own plane, so a near fir
  // keeps its layered, drooping silhouette — they used to be impostors near the track. A fir is tall
  // and dense, so its 3D range is shorter (uFadeC, flag 2): beyond ~55 m the impostor's frames of the
  // full scan hold a conifer's spire and tiers as well as the 3D tree does, for a fraction of the cost)
  const conifer = new Set(SPECIES_PROTOS.spruce);
  for (const i of nearIdx) isNear[i] = conifer.has(trees[i].proto) ? 2 : 1;

  // LOD manager state (cells of 64 m over the near trees)
  const CELL = 64;
  const cells = new Map<number, number[]>();
  nearIdx.forEach((ti, k) => {
    const t = trees[ti];
    const key = (Math.floor(t.x / CELL) + 1024) * 2048 + Math.floor(t.z / CELL) + 1024;
    let a = cells.get(key);
    if (!a) cells.set(key, (a = []));
    a.push(k);
  });
  // two instances per tree: the even LOD (0 or 2) and LOD1 — both shown only while one fades into
  // the other. Each tree's detail is a small state machine (see update): the LOD it shows (cur:
  // -1 = its impostor), and while it changes, the one it is leaving (prev, -2 = none) and when the
  // change began (t0, s of the scenery clock).
  const cur = new Int8Array(nearIdx.length).fill(-1);
  const prev = new Int8Array(nearIdx.length).fill(-2);
  const tStart = new Float64Array(nearIdx.length);
  const shownE = new Int8Array(nearIdx.length).fill(-1);
  const shownO = new Uint8Array(nearIdx.length);
  const shadeOn = new Uint8Array(nearIdx.length);
  /** near tree → its impostor instance (-1: a small shrub, no impostor) */
  const impOf = new Int32Array(nearIdx.length).fill(-1);
  let impFade: THREE.InstancedBufferAttribute | null = null;
  /** trees mid-change (finished ones are retired every frame) */
  let fading: number[] = [];
  let fadingNext: number[] = [];
  const isFading = new Uint8Array(nearIdx.length);
  // double-buffered active lists + a per-tree stamp: no allocation per LOD pass
  let active: number[] = [];
  let next: number[] = [];
  const stamp = new Uint32Array(nearIdx.length);
  let gen = 0;
  const cam = new THREE.Vector3();
  const debug = { reach: 1, fades: 0, pops: 0, snaps: 0, deferred: 0, cuts: 0 };
  const last = new THREE.Vector3(1e9, 0, 0);
  let frames = 0;
  let reach = R3D + 16;
  let reachC = R3D + 16;
  let lod0 = LOD0;
  let lod1 = LOD1;
  let lookMax = 34;
  let clock = 0;
  let lastClock = -1;
  // the camera's travel (m/s, world x/z), smoothed: the direction and reach of the look-ahead
  const prevCam = new THREE.Vector3();
  let prevT = 0;
  let haveCam = false;
  let velX = 0;
  let velZ = 0;
  // (shadows from the 3D trees out to here; beyond, the ground's crown-shade mask carries on)
  let shadeR = LOD1 + 14;
  // (filled once the baked trees are in: whenTreeKit below)
  let bm: THREE.BatchedMesh | null = null;
  let colorsUp = false;
  let sm: THREE.BatchedMesh | null = null;
  let geoIds: number[][] = [];
  let shadeIds: number[] = [];
  const nearInst: number[] = [];
  const nearInstO: number[] = [];
  const shadeInst: number[] = [];

  /** the GPU side, as soon as the baked prototypes are here (normally long before: they load at start-up) */
  const buildRender = () => {
    if (!kit.ready) return;
    const t0 = performance.now();
    // BatchedMesh
    let maxV = 0, maxI = 0;
    for (const p of kit.protos)
      for (const g of p.lods) {
        maxV += g.attributes.position.count;
        maxI += g.index!.count;
      }
    const mat = treeMaterial(kit, uniforms);
    const b = new THREE.BatchedMesh(Math.max(1, nearIdx.length * 2), maxV, maxI, mat);
    b.name = 'trees_near';
    geoIds = kit.protos.map((p) => p.lods.map((g) => b.addGeometry(g)));
    // the shadow casters: LOD2 of the same trees, drawn into the shadow maps only
    let sV = 0, sI = 0;
    for (const p of kit.protos) {
      const g = p.lods[p.lods.length - 1];
      sV += g.attributes.position.count;
      sI += g.index!.count;
    }
    const sb = new THREE.BatchedMesh(Math.max(1, nearIdx.length), sV, sI, mat);
    sb.name = 'trees_shade';
    shadeIds = kit.protos.map((p) => sb.addGeometry(p.lods[p.lods.length - 1]));
    // (BatchedMesh builds its draw list per camera in onBeforeRender — the camera pass gets an empty
    // one; onBeforeShadow builds the real list for each cascade)
    sb.onBeforeRender = function () {
      (this as unknown as { _multiDrawCount: number })._multiDrawCount = 0;
    };
    sb.onBeforeShadow = function (renderer, _object, _camera, shadowCamera, geometry, depthMaterial) {
      THREE.BatchedMesh.prototype.onBeforeRender.call(this, renderer, null as unknown as THREE.Scene, shadowCamera, geometry, depthMaterial, null as unknown as THREE.Group);
    };
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const upA = new THREE.Vector3(0, 1, 0);
    const sv = new THREE.Vector3();
    const pv = new THREE.Vector3();
    const c4 = new THREE.Vector4();
    for (const i of nearIdx) {
      const t = trees[i];
      q.setFromAxisAngle(upA, t.rot);
      sv.set(t.s * (t.flip ? -1 : 1), t.s * (0.94 + fract(t.rot * 13.7) * 0.12), t.s);
      pv.set(t.x, t.y, t.z);
      m4.compose(pv, q, sv);
      // (instance colour: the tint, and in w the species flag and the instance's fade — fadeCode)
      c4.set(t.tint.r, t.tint.g, t.tint.b, fadeCode(isNear[i], 1, 0));
      // the even-LOD and the LOD1 instance (both shown only while one fades into the other)
      for (let e = 0; e < 2; e++) {
        const id = b.addInstance(geoIds[t.proto][e === 0 ? 0 : 1]);
        b.setMatrixAt(id, m4);
        b.setColorAt(id, c4);
        b.setVisibleAt(id, false);
        (e === 0 ? nearInst : nearInstO).push(id);
      }
      const sid = sb.addInstance(shadeIds[t.proto]);
      sb.setMatrixAt(sid, m4);
      sb.setVisibleAt(sid, false);
      shadeInst.push(sid);
    }
    b.perObjectFrustumCulled = true;
    // (front-to-back: the leaf cards' alpha test is the cost, and what's hidden behind a nearer
    // crown then fails the depth test before shading)
    b.sortObjects = true;
    b.castShadow = false;
    b.receiveShadow = true;
    b.computeBoundingBox();
    b.computeBoundingSphere();
    b.frustumCulled = false;
    b.renderOrder = -1;
    group.add(b);
    bm = b;
    b.onAfterRender = () => {
      colorsUp = true;
      b.onAfterRender = () => {};
    };
    sb.perObjectFrustumCulled = true;
    sb.sortObjects = false;
    sb.castShadow = true;
    sb.receiveShadow = false;
    sb.customDepthMaterial = treeDepthMaterial(kit, uniforms);
    sb.computeBoundingBox();
    sb.computeBoundingSphere();
    sb.frustumCulled = false;
    group.add(sb);
    sm = sb;
    // impostors
    const base = new THREE.InstancedBufferGeometry();
    base.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    base.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    base.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    base.setIndex([0, 1, 2, 0, 2, 3]);
    // small shrubs don't matter beyond the 3D range, but the big understorey bushes
    // hide the bare trunks of the woodland edge when seen from afar
    const shrubSet = new Set(SPECIES_PROTOS.shrub);
    const impList: number[] = [];
    for (let i = 0; i < trees.length; i++) if (!shrubSet.has(trees[i].proto) || trees[i].s >= 1.1) impList.push(i);
    // nearest the circuit first: the camera is always on it, so this is roughly front-to-back
    // order for free — the woods behind fail the depth test instead of being shaded and overdrawn
    const dTrack = new Float32Array(trees.length);
    for (const i of impList) dTrack[i] = map.distToTrack(trees[i].x, trees[i].z);
    impList.sort((a, b) => dTrack[a] - dTrack[b]);
    const N = impList.length;
    const iPos = new Float32Array(N * 4);
    const iInfo = new Float32Array(N * 4);
    const iTint = new Float32Array(N * 3);
    // (each impostor's fade: (start, s — 0: steady; 1 = fading in / shown, 0 = fading out / hidden);
    // only the near trees' ever change, as their 3D tree takes over or hands back)
    const iFade = new Float32Array(N * 2);
    const nearK = new Int32Array(trees.length).fill(-1);
    nearIdx.forEach((ti, k) => (nearK[ti] = k));
    impList.forEach((ti, i) => {
      const t = trees[ti];
      iPos.set([t.x, t.y, t.z, t.s], i * 4);
      iInfo.set([t.proto, t.flip ? 1 : 0, isNear[ti], t.rot], i * 4);
      iTint.set([t.tint.r, t.tint.g, t.tint.b], i * 3);
      iFade[i * 2 + 1] = 1;
      if (nearK[ti] >= 0) impOf[nearK[ti]] = i;
    });
    base.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 4));
    base.setAttribute('iInfo', new THREE.InstancedBufferAttribute(iInfo, 4));
    base.setAttribute('iTint', new THREE.InstancedBufferAttribute(iTint, 3));
    impFade = new THREE.InstancedBufferAttribute(iFade, 2);
    impFade.setUsage(THREE.DynamicDrawUsage);
    base.setAttribute('iFade', impFade);
    base.instanceCount = N;
    base.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const imp = new THREE.Mesh(base, impostorMaterial(kit, uniforms));
    imp.name = 'trees_impostors';
    imp.frustumCulled = false;
    imp.castShadow = false;
    imp.receiveShadow = false;
    imp.renderOrder = 1;
    group.add(imp);
    timings.render = Math.round(performance.now() - t0);
    timings.impostors = N;
    last.set(1e9, 0, 0);
  };
  whenTreeKit(buildRender);
  lap('batch');

  // 3D range per quality level: [impostor fade start, fade end, LOD0 distance]
  // (perf: 3D trees are the scenery's main GPU cost, in the camera and both shadow cascades; High was
  // [122, 142, 56] — impostors take over a little sooner now)
  // (leaf cards face the camera in the 3D trees and the impostors alike, so the hand-over can
  // come closer: fewer 3D trees on screen, the main tree cost)
  // (a 10 m hand-over: fewer trees mid-dither at once)
  // (the impostors are renders of the real scans now, close to the 3D trees in look: they take over
  // ~10 m sooner, the cheapest frame time there is)
  // (the 3D trees have three LODs now: hundreds of small leaf sprays close up, fewer and bigger ones
  // further out — [fade start, fade end, LOD0 →, LOD1 →])
  // (and the conifers' own, shorter 3D band: [fade start, fade end])
  // (and how far ahead the look-ahead may reach, m: LOOK_T of travel, at most this)
  // (since the hand-overs became timed fades — update — rather than distance bands, each row is
  // [broadleaf 3D reach, LOD0 → 1, LOD1 → 2, conifer 3D reach, look-ahead cap], m)
  const DETAIL = { low: [59, 24, 36, 38, 20], medium: [77, 30, 44, 46, 26], high: [89, 34, 50, 52, 34], ultra: [135, 54, 80, 75, 44] } as const;
  const setDetail = (q: keyof typeof DETAIL) => {
    const [r3, l0, l1, rc, la] = DETAIL[q];
    reach = r3;
    reachC = rc;
    lod0 = l0;
    lod1 = l1;
    lookMax = la;
    shadeR = l1 + 14;
    last.set(1e9, 0, 0);
  };
  const c4u = new THREE.Vector4();
  /** show near tree k's LOD L (its even or odd instance) fading in (dirIn 1) or out (0) from t0 (0: steady) */
  const showInst = (k: number, L: number, dirIn: number, t0: number) => {
    const t = trees[nearIdx[k]];
    let id: number;
    if (L === 1) {
      id = nearInstO[k];
      if (!shownO[k]) bm!.setVisibleAt(id, true);
      shownO[k] = 1;
    } else {
      id = nearInst[k];
      if (shownE[k] !== L) {
        if (shownE[k] < 0) bm!.setVisibleAt(id, true);
        bm!.setGeometryIdAt(id, geoIds[t.proto][L]);
        shownE[k] = L;
      }
    }
    bm!.setColorAt(id, c4u.set(t.tint.r, t.tint.g, t.tint.b, fadeCode(isNear[nearIdx[k]], dirIn, t0)));
    // (just this instance's texel re-uploaded, not the whole ~0.5 MB colour texture on every LOD pass —
    // once it has been uploaded whole: a first upload of only the ranges would leave the rest blank)
    if (colorsUp) (bm as unknown as { _colorsTexture: THREE.DataTexture })._colorsTexture.addUpdateRange(id * 4, 4);
  };
  const hideInst = (k: number, L: number) => {
    if (L === 1) {
      if (shownO[k]) bm!.setVisibleAt(nearInstO[k], false);
      shownO[k] = 0;
    } else if (L >= 0 && shownE[k] === L) {
      bm!.setVisibleAt(nearInst[k], false);
      shownE[k] = -1;
    }
  };
  /** near tree k's impostor: shown (dirIn 1) or hidden (0), fading from t0 (0: at once) */
  const setImp = (k: number, dirIn: number, t0: number) => {
    const i = impOf[k];
    if (i < 0 || !impFade) return;
    const a = impFade.array as Float32Array;
    a[i * 2] = t0;
    a[i * 2 + 1] = dirIn;
    impFade.addUpdateRange(i * 2, 2);
    impFade.needsUpdate = true;
  };
  /** a change of detail that has run its course: the LOD it left goes */
  const retire = (k: number) => {
    const p = prev[k];
    if (p >= 0 && (cur[k] < 0 || (p === 1) !== (cur[k] === 1))) hideInst(k, p);
    prev[k] = -2;
  };
  /**
   * Tree k changes its detail to `want` (-1: its impostor). Not in a single frame and not by
   * distance: the LOD it leaves and the one it takes cross-fade in a matched dither over FADE s of
   * the scenery clock, and are then left alone (hysteresis, HYST m, keeps it from flapping on the
   * boundary). The old distance bands kept every tree near a boundary half-dithered for as long
   * as it stayed there — from a static TV camera, forever: a screen-door crown — and a car
   * running alongside a row of trees saw a band of them stippled at all times. A cut (snap) just
   * sets the new state: the frame is new anyway.
   */
  const change = (k: number, want: number, snap: boolean) => {
    const old = cur[k];
    if (want === old) return;
    if (prev[k] !== -2) {
      // mid-dissolve: the next change waits until this one is done (the pass comes round again within
      // a few frames) — cutting it short dropped what was left of the old LOD in one frame, which at
      // 300 km/h, trees crossing two LOD bands within 0.3 s, happened ~80 times a second
      if (!snap) {
        debug.deferred++;
        return;
      }
      retire(k);
    }
    if (snap || (old >= 0 && want >= 0 && (old === 1) === (want === 1))) {
      if (snap) debug.snaps++;
      else debug.pops++;
      if (old >= 0) hideInst(k, old);
      if (want >= 0) showInst(k, want, 1, 0);
      setImp(k, want < 0 ? 1 : 0, 0);
      cur[k] = want;
      return;
    }
    // (on the 1/60 s grid the instance colour keeps — fadeCode — so 3D and impostor fade in step)
    debug.fades++;
    const t0 = Math.max(2, Math.round(clock * 60)) / 60;
    if (old >= 0) showInst(k, old, 0, t0);
    else setImp(k, 0, t0);
    if (want >= 0) showInst(k, want, 1, t0);
    else setImp(k, 1, t0);
    cur[k] = want;
    prev[k] = old;
    tStart[k] = t0;
    if (!isFading[k]) {
      isFading[k] = 1;
      fading.push(k);
    }
  };
  const update = (camera: THREE.Camera, elapsed: number) => {
    uniforms.uTime.value = elapsed;
    uniforms.uFrame.value = (uniforms.uFrame.value + 1) % 64;
    if (!bm || !sm) return;
    camera.getWorldPosition(cam);
    clock = elapsed;
    // (the shadow casters thin out over the last 11 m before they are dropped at shadeR + HYST: treeDepthMaterial)
    uniforms.uShade.value.set(cam.x, cam.z, shadeR - 14, shadeR - 3);
    // a cut: the camera jumped (TV cameras, the helicopter, the reflection capture, a replay seek)
    // or the clock went back — the new view gets its trees as they should be, no fades
    const snap = !haveCam || cam.distanceToSquared(prevCam) > CUT_M * CUT_M || clock < lastClock;
    lastClock = clock;
    if (snap) {
      last.set(1e9, 0, 0);
      debug.cuts++;
    }
    // retire the changes that have run their course
    fadingNext.length = 0;
    for (const k of fading) {
      if (snap || clock - tStart[k] >= FADE || clock < tStart[k]) {
        retire(k);
        isFading[k] = 0;
      } else fadingNext.push(k);
    }
    {
      const f = fading;
      fading = fadingNext;
      fadingNext = f;
    }
    // the camera's travel, every frame (a cut — TV cameras, the reflection capture, a replay seek —
    // is not a camera at warp speed: it is skipped, and the smoothing settles on the new one)
    const dtv = elapsed - prevT;
    if (haveCam && dtv > 1e-4) {
      const vx = (cam.x - prevCam.x) / dtv, vz = (cam.z - prevCam.z) / dtv;
      if (vx * vx + vz * vz < 130 * 130) {
        const kv = Math.min(1, dtv * 6);
        velX += (vx - velX) * kv;
        velZ += (vz - velZ) * kv;
      }
    }
    prevCam.copy(cam);
    prevT = elapsed;
    haveCam = true;
    frames++;
    if (cam.distanceToSquared(last) < 4 && frames % 15 !== 0) return;
    last.copy(cam);
    // the look-ahead for this pass (the CPU decides every change: the shader only plays the dissolve):
    // the near detail (LODs, conifers, all within ~60 m) by the full reach, the broadleaf 3D range
    // and the shadow casters by half of it (they are further out, and cost more the further they go)
    const sp = Math.hypot(velX, velZ);
    const aN = sp > 3 ? Math.min(lookMax, sp * LOOK_T) : 0;
    const aF = aN * 0.5;
    const ux = aN > 0 ? velX / sp : 0, uz = aN > 0 ? velZ / sp : 0;
    gen++;
    next.length = 0;
    const R = Math.max(reach, reachC) * Math.max(1, debug.reach) + HYST;
    const ex = cam.x + ux * aN, ez = cam.z + uz * aN;
    const c0x = Math.floor((Math.min(cam.x, ex) - R) / CELL), c1x = Math.floor((Math.max(cam.x, ex) + R) / CELL);
    const c0z = Math.floor((Math.min(cam.z, ez) - R) / CELL), c1z = Math.floor((Math.max(cam.z, ez) + R) / CELL);
    for (let cx = c0x; cx <= c1x; cx++)
      for (let cz = c0z; cz <= c1z; cz++) {
        const arr = cells.get((cx + 1024) * 2048 + cz + 1024);
        if (!arr) continue;
        for (const k of arr) {
          const t = trees[nearIdx[k]];
          const dx = t.x - cam.x, dz = t.z - cam.z, dy = t.y - cam.y;
          // distances from the look-ahead segments (treematerial: treeLookDist)
          const al = dx * ux + dz * uz;
          const pN = Math.min(Math.max(al, 0), aN), pF = Math.min(Math.max(al, 0), aF);
          const nx = dx - ux * pN, nz = dz - uz * pN, fx = dx - ux * pF, fz = dz - uz * pF;
          const dN = Math.sqrt(nx * nx + nz * nz + dy * dy);
          const dF = Math.sqrt(fx * fx + fz * fz + dy * dy);
          const fir = isNear[nearIdx[k]] === 2;
          // the detail it should have — each boundary moved HYST m away from the side it is on
          const c = cur[k];
          const h3 = c >= 0 ? HYST : -HYST;
          const in3D = fir ? dN < reachC * debug.reach + h3 : dF < reach * debug.reach + h3;
          const want = !in3D ? -1 : dN < lod0 + (c === 0 ? HYST : -HYST) ? 0 : dN < lod1 + (c === 0 || c === 1 ? HYST : -HYST) ? 1 : 2;
          change(k, want, snap);
          const sh = dF < (fir ? Math.min(shadeR, reachC) : shadeR) + (shadeOn[k] ? HYST : -HYST);
          if (shadeOn[k] !== +sh) {
            sm.setVisibleAt(shadeInst[k], sh);
            shadeOn[k] = +sh;
          }
          if (want < 0 && !shadeOn[k] && prev[k] === -2) continue;
          next.push(k);
          stamp[k] = gen;
        }
      }
    // the ones that dropped out of the scan: back to their impostors
    for (const k of active) {
      if (stamp[k] !== gen) {
        change(k, -1, snap);
        if (shadeOn[k]) sm.setVisibleAt(shadeInst[k], false);
        shadeOn[k] = 0;
        // (still fading out: kept on the list until its fade is retired)
        if (prev[k] !== -2) {
          next.push(k);
          stamp[k] = gen;
        }
      }
    }
    const t = active;
    active = next;
    next = t;
  };

  const shade = trees.map((t) => ({ x: t.x, z: t.z, r: PROTO_INFO[t.proto].crownR * t.s }));
  let feedNear = false;
  const feedView = (on: boolean) => {
    // (every impostor shown whatever its hand-over to a 3D tree, the 3D trees hidden for the pass)
    uniforms.uImpAll.value = on ? 1 : 0;
    if (on) {
      feedNear = bm?.visible ?? false;
      if (bm) bm.visible = false;
    } else if (bm) bm.visible = feedNear;
  };
  return { group, uniforms, update, feedView, setDetail, count: trees.length, near: nearIdx.length, shade, kit, trees, timings, debug };
}

void smoothstep;
