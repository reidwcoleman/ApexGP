import * as THREE from 'three';

/**
 * GPU resource bookkeeping for tearing a world down without a page reload.
 *
 * `collectResources` gathers every geometry / material / texture reachable from
 * objects that must survive (the cars, the particles, the people kit …) so
 * `disposeTree` can free everything else a world owns without touching them.
 */

export type ResourceSet = Set<object>;

const isTex = (v: unknown): v is THREE.Texture => !!v && (v as THREE.Texture).isTexture === true;

/** textures a material holds: its maps, and any in `uniforms` (ShaderMaterial) or `userData` */
export function materialTextures(m: THREE.Material, out: THREE.Texture[] = []): THREE.Texture[] {
  const rec = m as unknown as Record<string, unknown>;
  for (const k in rec) {
    const v = rec[k];
    if (isTex(v)) out.push(v);
  }
  const u = (m as THREE.ShaderMaterial).uniforms;
  if (u) for (const k in u) pushTex(u[k]?.value, out);
  const ud = m.userData as Record<string, unknown> | undefined;
  if (ud) for (const k in ud) {
    const v = ud[k];
    if (isTex(v)) out.push(v);
    else if (v && typeof v === 'object' && 'value' in (v as object)) pushTex((v as { value: unknown }).value, out);
  }
  return out;
}
function pushTex(v: unknown, out: THREE.Texture[]) {
  if (isTex(v)) out.push(v);
  else if (Array.isArray(v)) for (const x of v) if (isTex(x)) out.push(x);
}

function objectMaterials(o: THREE.Object3D): THREE.Material[] {
  const out: THREE.Material[] = [];
  const m = (o as THREE.Mesh).material;
  if (Array.isArray(m)) out.push(...m);
  else if (m) out.push(m);
  const me = o as THREE.Mesh;
  if (me.customDepthMaterial) out.push(me.customDepthMaterial);
  if (me.customDistanceMaterial) out.push(me.customDistanceMaterial);
  return out;
}

/**
 * Every geometry, material and texture reachable from `root`: an Object3D tree, or any plain
 * structure (object / array / Map) holding them — searched a few levels deep.
 */
export function collectResources(root: unknown, out: ResourceSet = new Set(), depth = 4): ResourceSet {
  const seen = new Set<unknown>();
  const visit = (v: unknown, d: number) => {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if ((v as THREE.Object3D).isObject3D) {
      (v as THREE.Object3D).traverse((o) => {
        const g = (o as THREE.Mesh).geometry;
        if (g) out.add(g);
        for (const m of objectMaterials(o)) {
          out.add(m);
          for (const t of materialTextures(m)) out.add(t);
        }
      });
      return;
    }
    if ((v as THREE.BufferGeometry).isBufferGeometry) return void out.add(v);
    if ((v as THREE.Material).isMaterial) {
      out.add(v);
      for (const t of materialTextures(v as THREE.Material)) out.add(t);
      return;
    }
    if (isTex(v)) return void out.add(v);
    if (d <= 0) return;
    if (v instanceof Map) for (const x of v.values()) visit(x, d - 1);
    else if (Array.isArray(v)) for (const x of v) visit(x, d - 1);
    else if (Object.getPrototypeOf(v) === Object.prototype) for (const k in v as Record<string, unknown>) visit((v as Record<string, unknown>)[k], d - 1);
  };
  visit(root, depth);
  return out;
}

/** free a texture's GPU memory (the whole render target when it belongs to one) */
export function disposeTexture(t: THREE.Texture) {
  const rt = (t as THREE.Texture & { renderTarget?: THREE.RenderTarget | null }).renderTarget;
  if (rt && typeof rt.dispose === 'function') rt.dispose();
  else t.dispose();
}

/**
 * Detach `root` and dispose every geometry, material and texture under it that is not in
 * `keep`. Returns how many of each were freed.
 */
export function disposeTree(root: THREE.Object3D, keep: ResourceSet = new Set()) {
  root.removeFromParent();
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  const texs = new Set<THREE.Texture>();
  root.traverse((o) => {
    const g = (o as THREE.Mesh).geometry;
    if (g && !keep.has(g)) geos.add(g);
    for (const m of objectMaterials(o)) {
      if (keep.has(m)) continue;
      mats.add(m);
      for (const t of materialTextures(m)) if (!keep.has(t)) texs.add(t);
    }
    // instanced meshes and skinned meshes own extra GPU data
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh) im.dispose();
    const sk = o as THREE.SkinnedMesh;
    if (sk.isSkinnedMesh && sk.skeleton && !keep.has(sk.skeleton)) sk.skeleton.dispose();
    const light = o as THREE.Light & { shadow?: THREE.LightShadow };
    if (light.isLight && light.shadow) light.shadow.dispose();
  });
  for (const g of geos) g.dispose();
  for (const m of mats) m.dispose();
  for (const t of texs) disposeTexture(t);
  return { geometries: geos.size, materials: mats.size, textures: texs.size };
}

// ------------------------------------------------------------------ live GPU uploads

/**
 * Every texture and render target that is live on the GPU right now. three.js registers a
 * 'dispose' listener on each one the first time it uploads it and removes it when it frees it,
 * so watching those registrations gives the full list — including textures only a shader
 * closure (onBeforeCompile) or a module-level uniform knows about, which no scene walk finds.
 */
const live = { textures: new Set<THREE.Texture>(), targets: new Set<THREE.RenderTarget>() };
let tracking = false;
export function trackGpuUploads() {
  if (tracking) return;
  tracking = true;
  const proto = THREE.EventDispatcher.prototype as unknown as {
    addEventListener(this: unknown, type: string, fn: unknown): void;
    removeEventListener(this: unknown, type: string, fn: unknown): void;
  };
  const add = proto.addEventListener;
  const remove = proto.removeEventListener;
  proto.addEventListener = function (type, fn) {
    if (type === 'dispose') {
      const o = this as { isTexture?: boolean; isRenderTarget?: boolean };
      if (o.isTexture) live.textures.add(this as THREE.Texture);
      else if (o.isRenderTarget) live.targets.add(this as THREE.RenderTarget);
    }
    return add.call(this, type, fn);
  };
  proto.removeEventListener = function (type, fn) {
    if (type === 'dispose') {
      live.textures.delete(this as THREE.Texture);
      live.targets.delete(this as THREE.RenderTarget);
    }
    return remove.call(this, type, fn);
  };
}

/**
 * Like collectResources, but walks any object graph (class instances too: the post chain,
 * the particle system …) to `depth` levels, and also picks up render targets and shadow maps.
 */
export function collectDeep(roots: unknown[], out: ResourceSet = new Set(), depth = 5): ResourceSet {
  const seen = new Set<unknown>();
  const addTex = (t: THREE.Texture) => {
    out.add(t);
    const rt = (t as THREE.Texture & { renderTarget?: THREE.RenderTarget | null }).renderTarget;
    if (rt) addRT(rt);
  };
  const addRT = (rt: THREE.RenderTarget) => {
    if (out.has(rt)) return;
    out.add(rt);
    for (const t of rt.textures ?? [rt.texture]) out.add(t);
    if (rt.depthTexture) out.add(rt.depthTexture);
  };
  const visit = (v: unknown, d: number) => {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return;
    if (typeof Node !== 'undefined' && v instanceof Node) return;
    const o = v as Record<string, unknown> & { isObject3D?: boolean; isTexture?: boolean; isRenderTarget?: boolean; isMaterial?: boolean; isBufferGeometry?: boolean };
    if (o.isObject3D) {
      (v as THREE.Object3D).traverse((x) => {
        const g = (x as THREE.Mesh).geometry;
        if (g) out.add(g);
        for (const m of objectMaterials(x)) {
          out.add(m);
          for (const t of materialTextures(m)) addTex(t);
        }
        const sh = (x as THREE.Light & { shadow?: THREE.LightShadow }).shadow;
        if ((x as THREE.Light).isLight && sh?.map) addRT(sh.map);
      });
      return;
    }
    if (o.isTexture) return addTex(v as THREE.Texture);
    if (o.isRenderTarget) return addRT(v as THREE.RenderTarget);
    if (o.isBufferGeometry) return void out.add(v);
    if (o.isMaterial) {
      out.add(v);
      for (const t of materialTextures(v as THREE.Material)) addTex(t);
      return;
    }
    if (d <= 0) return;
    if (v instanceof Map || v instanceof Set) for (const x of v.values()) visit(x, d - 1);
    else if (Array.isArray(v)) for (const x of v) visit(x, d - 1);
    else for (const k of Object.keys(v)) visit(o[k], d - 1);
  };
  for (const r of roots) visit(r, depth);
  return out;
}

/**
 * Free every live texture and render target that isn't in `keep` (a world switch, after the old
 * world has been taken out of the scene). Anything freed by mistake is simply re-uploaded (or
 * re-allocated) by three.js the next time it is drawn.
 */
export function sweepGpu(keep: ResourceSet) {
  const names: string[] = [];
  let targets = 0;
  let textures = 0;
  for (const rt of [...live.targets]) {
    if (keep.has(rt) || (rt.textures ?? [rt.texture]).some((t) => keep.has(t))) continue;
    names.push(`${rt.texture?.name || rt.constructor.name} ${rt.width}x${rt.height}`);
    rt.dispose();
    targets++;
  }
  for (const t of [...live.textures]) {
    // (render-target colour/depth attachments go with their target, above)
    // (and three's own lookup tables, which live inside the renderer where no walk reaches)
    const x = t as THREE.Texture & { isRenderTargetTexture?: boolean; isDepthTexture?: boolean; renderTarget?: unknown };
    if (keep.has(t) || x.isRenderTargetTexture || x.isDepthTexture || x.renderTarget || t.name === 'DFG_LUT') continue;
    const img = t.image as { width?: number; height?: number } | null;
    if (img && img.width === 1 && img.height === 1) continue;
    names.push(`${t.name || t.constructor.name} ${(t.image as { width?: number })?.width ?? ''}x${(t.image as { height?: number })?.height ?? ''}`);
    t.dispose();
    textures++;
  }
  return { targets, textures, names };
}
