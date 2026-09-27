import * as THREE from 'three';
import type { CarGeoLevel } from './carGeometry.ts';
import { FLAP_PIVOT, FW_FLAP_PIVOT } from './carGeometry.ts';
import { TRACK_F, TRACK_R, TYRE_W_F, TYRE_W_R, WHEEL_R, Z_FRONT_AXLE, Z_REAR_AXLE } from './carLayout.ts';

/**
 * Baked ambient occlusion for the car: how much of the sky each vertex sees, with the car itself
 * (and the wheels and the ground under it) in the way. The dark under the wings and the halo,
 * inside the sidepod undercut and the cockpit, the floor edge over the road — what makes a
 * procedural model read as a solid object rather than lit panels.
 *
 * GPU bake, once per detail level (the geometry is shared by every car): depth maps of the car
 * at rest from DIRS directions, then per vertex the cosine-weighted share of directions in which
 * nothing is in front of it. Stored as `aOcc` = 1 − visibility (0 where not baked, so a mesh
 * without the attribute renders as before — WebGL's default attribute value is 0).
 */

const DIRS = 48;
const RES = 256;
const RADIUS = 3.1;
/** directions rendered side by side into one target (TILE × TILE) and read back together: a GPU
 * readback stalls the pipeline whatever its size, so 16 views per read is 9 stalls at boot, not 144 */
const TILE = 4;

let renderer: THREE.WebGLRenderer | null = null;
/** the game's renderer (set once at boot; without it the car renders unbaked) */
export function setCarAORenderer(r: THREE.WebGLRenderer) {
  renderer = r;
}

const DEPTH_VERT = /* glsl */ `
varying float vD;
void main() {
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  vD = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const DEPTH_FRAG = /* glsl */ `
uniform float uGround;
varying float vD;
void main() { gl_FragColor = vec4( vD, uGround, 0.0, 1.0 ); }`;
/** light bounced up from the road still reaches what faces it: a ground hit counts this much */
const GROUND_BOUNCE = 0.55;

/** directions spread evenly over the sphere (the lower half mostly sees the ground plane) */
function fibonacci(n: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) / n) * 2;
    const r = Math.sqrt(1 - y * y);
    out.push(new THREE.Vector3(Math.cos(i * ga) * r, y, Math.sin(i * ga) * r));
  }
  return out;
}

export function bakeCarAO(L: CarGeoLevel): number {
  if (!renderer) return 0;
  const t0 = performance.now();
  const r = renderer;
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({ vertexShader: DEPTH_VERT, fragmentShader: DEPTH_FRAG, side: THREE.DoubleSide, uniforms: { uGround: { value: 0 } } });
  const groundMat = new THREE.ShaderMaterial({ vertexShader: DEPTH_VERT, fragmentShader: DEPTH_FRAG, side: THREE.DoubleSide, uniforms: { uGround: { value: 1 } } });
  const receivers: { g: THREE.BufferGeometry; off: THREE.Vector3 }[] = [];
  const add = (g: THREE.BufferGeometry | null | undefined, receive = true, m?: THREE.Matrix4) => {
    if (!g) return;
    const mesh = new THREE.Mesh(g, mat);
    if (m) {
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(m);
    }
    scene.add(mesh);
    // (pivot-local parts are only translated: the offset takes them to body space)
    if (receive) receivers.push({ g, off: m ? new THREE.Vector3().setFromMatrixPosition(m) : new THREE.Vector3() });
  };
  const B = L.body;
  add(B.paint);
  add(B.carbon);
  add(B.trim);
  add(B.driver);
  add(B.head);
  for (const k of Object.keys(L.parts) as (keyof typeof L.parts)[]) {
    add(L.parts[k].paint);
    add(L.parts[k].carbon);
    add(L.parts[k].trim);
  }
  add(L.flap, true, new THREE.Matrix4().makeTranslation(FLAP_PIVOT[0], FLAP_PIVOT[1], FLAP_PIVOT[2]));
  for (const f of L.fwFlaps) add(f, true, new THREE.Matrix4().makeTranslation(FW_FLAP_PIVOT[0], FW_FLAP_PIVOT[1], FW_FLAP_PIVOT[2]));
  // occluders only: the wheels (as solid drums) and the road
  const drumF = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, TYRE_W_F, 20).rotateZ(Math.PI / 2);
  const drumR = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, TYRE_W_R, 20).rotateZ(Math.PI / 2);
  for (const s of [1, -1]) {
    add(drumF, false, new THREE.Matrix4().makeTranslation((s * TRACK_F) / 2, WHEEL_R, Z_FRONT_AXLE));
    add(drumR, false, new THREE.Matrix4().makeTranslation((s * TRACK_R) / 2, WHEEL_R, Z_REAR_AXLE));
  }
  const ground = new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2);
  scene.add(new THREE.Mesh(ground, groundMat));
  scene.updateMatrixWorld(true);

  const RT = RES * TILE;
  const rt = new THREE.WebGLRenderTarget(RT, RT, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const cam = new THREE.OrthographicCamera(-RADIUS, RADIUS, RADIUS, -RADIUS, 0.1, RADIUS * 4);
  const centre = new THREE.Vector3(0, 0.5, 0);
  const buf = new Float32Array(RT * RT * 4);
  const dirs = fibonacci(DIRS);
  const prevRT = r.getRenderTarget();
  const prevClear = r.getClearColor(new THREE.Color());
  const prevAlpha = r.getClearAlpha();
  const prevAuto = r.autoClear;
  const prevShadow = r.shadowMap.autoUpdate;
  r.shadowMap.autoUpdate = false;
  r.autoClear = true;
  r.setClearColor(0x000000, 1);

  // per receiver: visibility sum and weight sum per vertex
  const acc = receivers.map(({ g, off }) => ({ g, off, vis: new Float32Array(g.attributes.position.count), w: new Float32Array(g.attributes.position.count) }));
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const view = new THREE.Matrix4();
  const views = dirs.map(() => new THREE.Matrix4());
  const per = TILE * TILE;
  for (let b0 = 0; b0 < dirs.length; b0 += per) {
    const batch = dirs.slice(b0, b0 + per);
    // one clear of the whole target, then each direction into its own tile
    rt.scissorTest = false;
    rt.viewport.set(0, 0, RT, RT);
    r.setRenderTarget(rt);
    r.clear();
    rt.scissorTest = true;
    batch.forEach((d, j) => {
      const tx = (j % TILE) * RES, ty = Math.floor(j / TILE) * RES;
      cam.position.copy(centre).addScaledVector(d, RADIUS * 2);
      cam.up.set(Math.abs(d.y) > 0.95 ? 1 : 0, Math.abs(d.y) > 0.95 ? 0 : 1, 0);
      cam.lookAt(centre);
      cam.updateMatrixWorld(true);
      views[b0 + j].copy(cam.matrixWorldInverse);
      rt.viewport.set(tx, ty, RES, RES);
      rt.scissor.set(tx, ty, RES, RES);
      r.setRenderTarget(rt);
      r.render(scene, cam);
    });
    r.readRenderTargetPixels(rt, 0, 0, RT, RT, buf);
    batch.forEach((d, j) => {
      const tx = (j % TILE) * RES, ty = Math.floor(j / TILE) * RES;
      view.copy(views[b0 + j]);
      for (const a of acc) {
        const pos = a.g.attributes.position as THREE.BufferAttribute;
        const nor = a.g.attributes.normal as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          n.fromBufferAttribute(nor, i);
          const c = n.dot(d);
          if (c <= 0.02) continue;
          p.fromBufferAttribute(pos, i);
          p.add(a.off);
          // a small push off the surface so a vertex doesn't shadow itself
          p.addScaledVector(n, 0.012).applyMatrix4(view);
          const u = Math.floor(((p.x / RADIUS) * 0.5 + 0.5) * RES);
          const v = Math.floor(((p.y / RADIUS) * 0.5 + 0.5) * RES);
          a.w[i] += c;
          if (u < 0 || v < 0 || u >= RES || v >= RES) {
            a.vis[i] += c;
            continue;
          }
          const k = ((ty + v) * RT + tx + u) * 4;
          const depth = buf[k];
          const mine = -p.z;
          if (depth === 0 || mine <= depth + 0.02) a.vis[i] += c;
          else if (buf[k + 1] > 0.5) a.vis[i] += c * GROUND_BOUNCE;
        }
      }
    });
  }
  r.setRenderTarget(prevRT);
  r.setClearColor(prevClear, prevAlpha);
  r.autoClear = prevAuto;
  r.shadowMap.autoUpdate = prevShadow;
  rt.dispose();
  mat.dispose();
  groundMat.dispose();
  drumF.dispose();
  drumR.dispose();
  ground.dispose();

  for (const a of acc) {
    const occ = new Float32Array(a.vis.length);
    for (let i = 0; i < occ.length; i++) {
      const vis = a.w[i] > 0 ? a.vis[i] / a.w[i] : 1;
      // (the open half-sphere over a flat panel reads 1; deep cavities fall toward 0)
      occ[i] = Math.min(1, Math.max(0, 1 - vis));
    }
    a.g.setAttribute('aOcc', new THREE.BufferAttribute(occ, 1));
  }
  return Math.round(performance.now() - t0);
}

/**
 * Hook a car material up to the baked occlusion: ambient light and reflections are attenuated
 * by it (and a little of the direct light, for the crevices the shadow map is too coarse for).
 */
export function withCarAO<T extends THREE.Material>(mat: T): T {
  const prev = mat.onBeforeCompile.bind(mat);
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aOcc;\nvarying float vOcc;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOcc = aOcc;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vOcc;').replace(
      '#include <aomap_fragment>',
      `#include <aomap_fragment>
      {
        float cVis = 1.0 - clamp( vOcc, 0.0, 1.0 );
        // (a gentle curve: open panels untouched, only real cavities go dark)
        float cAO = smoothstep( 0.05, 0.85, cVis ) * 0.85 + 0.15;
        reflectedLight.indirectDiffuse *= cAO;
        reflectedLight.indirectSpecular *= mix( cAO * cAO, 1.0, 0.2 );
        reflectedLight.directDiffuse *= mix( 1.0, cAO, 0.3 );
        reflectedLight.directSpecular *= mix( 1.0, cAO, 0.3 );
        #ifdef USE_CLEARCOAT
          clearcoatSpecularIndirect *= mix( cAO * cAO, 1.0, 0.2 );
        #endif
      }`,
    );
  };
  mat.customProgramCacheKey = () => prevKey() + '-ao1';
  return mat;
}
