import * as THREE from 'three';
import { loadTreeKit, PROTO_INFO, TREE_BUILD } from '../world/env/treeproto.ts';
import { createTreeUniforms, IMP_GAIN, impostorMaterial, leafTune, setLeafFill, treeMaterial, type TreeUniforms } from '../world/env/treematerial.ts';

/**
 * Tree LOD check: one prototype drawn as LOD0 | LOD1 | LOD2 | impostor side by side, from the same
 * distance and bearing, with the game's tree materials — so a hand-over that would show (a crown
 * thinning, brightening, changing shape) shows here, and is measured: window.__info has each
 * column's coverage (share of its pixels the tree covers) and mean colour of what it covers.
 *   ?p=<proto index or id>  ?d=<m>  ?az=<deg, camera bearing round the tree>  ?h=<camera height m>
 *   ?sun=<deg, sun bearing>  ?elev=<deg sun elevation>  ?fov=50  ?key=1 (flat key background, for coverage)
 */
const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.get(k) !== null ? Number(q.get(k)) : d);
const pArg = q.get('p') ?? '0';
const P = /^\d+$/.test(pArg) ? Number(pArg) : PROTO_INFO.findIndex((x) => x.id === pArg);
const D = num('d', 60);
const AZ = THREE.MathUtils.degToRad(num('az', 0));
const CH = num('h', 1.5);
const W = innerWidth, H = innerHeight, COLS = 4;

const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setScissorTest(true);

const KEY = q.get('key') === '1';
const bg = KEY ? new THREE.Color(1, 0, 1) : new THREE.Color(0.42, 0.6, 0.85);
const scene = new THREE.Scene();
const sunAz = THREE.MathUtils.degToRad(num('sun', 140));
const sunEl = THREE.MathUtils.degToRad(num('elev', 35));
const sunDir = new THREE.Vector3(Math.sin(sunAz) * Math.cos(sunEl), Math.sin(sunEl), Math.cos(sunAz) * Math.cos(sunEl));
const sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
sun.position.copy(sunDir).multiplyScalar(100);
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0x9cc0ff, 0x4d4a36, 1.1));

const camera = new THREE.PerspectiveCamera(num('fov', 50), W / COLS / H, 0.5, 2000);

// ?fill=&inward=&turnBroad=&turnFir=&fillAO=&wood0=  (TREE_BUILD)   ?cut=&edge=&cutF=&edgeF=  (leafTune)
for (const k of Object.keys(TREE_BUILD) as (keyof typeof TREE_BUILD)[]) if (q.get(k) !== null) (TREE_BUILD as Record<string, unknown>)[k] = typeof TREE_BUILD[k] === 'boolean' ? q.get(k) === '1' : Number(q.get(k));
{
  const c = leafTune.uLeafCut.value;
  c.set(num('cut', c.x), num('edge', c.y), num('cutF', c.z), num('edgeF', c.w));
}

void loadTreeKit().then((kit) => {
  const proto = kit.protos[P];
  // ?ig=r,g,b — try an impostor colour gain (IMP_GAIN) for this prototype
  if (q.get('ig')) IMP_GAIN[proto.id] = q.get('ig')!.split(',').map(Number) as [number, number, number];
  const conifer = proto.id.startsWith('fir') || proto.id.startsWith('spruce');
  const columns: THREE.Object3D[] = [];
  const unis: TreeUniforms[] = [];
  // the three LODs, each shown whole (its own uniforms: the LOD bands set so only it draws)
  for (let lod = 0; lod < 3; lod++) {
    const u = createTreeUniforms();
    u.uSunW.value.copy(sunDir);
    setLeafFill(u, 1);
    unis.push(u);
    const g = proto.lods[lod];
    const b = new THREE.BatchedMesh(1, g.attributes.position.count, g.index!.count, treeMaterial(kit, u));
    const id = b.addInstance(b.addGeometry(g));
    b.setColorAt(id, new THREE.Vector4(1, 1, 1, (conifer ? 2 : 1) + 3) as unknown as THREE.Color);
    b.frustumCulled = false;
    columns.push(b);
  }
  // the impostor (never fading: iInfo.z = 0)
  {
    const u = createTreeUniforms();
    u.uSunW.value.copy(sunDir);
    setLeafFill(u, 1);
    unis.push(u);
    const base = new THREE.InstancedBufferGeometry();
    base.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    base.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    base.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    base.setIndex([0, 1, 2, 0, 2, 3]);
    base.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array([0, 0, 0, 1]), 4));
    base.setAttribute('iInfo', new THREE.InstancedBufferAttribute(new Float32Array([P, 0, 0, 0]), 4));
    base.setAttribute('iTint', new THREE.InstancedBufferAttribute(new Float32Array([1, 1, 1]), 3));
    base.instanceCount = 1;
    const imp = new THREE.Mesh(base, impostorMaterial(kit, u));
    imp.frustumCulled = false;
    columns.push(imp);
  }
  const look = new THREE.Vector3(0, proto.height * 0.5, 0);
  camera.position.set(Math.sin(AZ) * D, CH, Math.cos(AZ) * D);
  camera.lookAt(look);
  const cw = Math.floor(W / COLS);
  const info: { col: string; cover: number; lum: number; rgb: number[] }[] = [];
  let frames = 0;
  const draw = () => {
    for (let c = 0; c < COLS; c++) {
      for (const o of columns) o.visible = false;
      columns[c].visible = true;
      if (!columns[c].parent) scene.add(columns[c]);
      unis[c].uTime.value = performance.now() / 1000;
      unis[c].uFrame.value = (unis[c].uFrame.value + 1) % 64;
      renderer.setViewport(c * cw, 0, cw, H);
      renderer.setScissor(c * cw, 0, cw, H);
      renderer.setClearColor(bg);
      renderer.clear();
      renderer.render(scene, camera);
    }
    if (++frames === 10) {
      const gl = renderer.getContext();
      const px = new Uint8Array(cw * H * 4);
      for (let c = 0; c < COLS; c++) {
        gl.readPixels(c * cw, 0, cw, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let n = 0, r = 0, g = 0, b = 0;
        const kr = Math.round(bg.r * 255), kg = Math.round(bg.g * 255), kb = Math.round(bg.b * 255);
        for (let i = 0; i < px.length; i += 4) {
          if (Math.abs(px[i] - kr) + Math.abs(px[i + 1] - kg) + Math.abs(px[i + 2] - kb) < 4) continue;
          n++;
          r += px[i];
          g += px[i + 1];
          b += px[i + 2];
        }
        const k = Math.max(n, 1);
        info.push({ col: ['lod0', 'lod1', 'lod2', 'imp'][c], cover: +(n / (cw * H)).toFixed(5), lum: +((0.2126 * r + 0.7152 * g + 0.0722 * b) / k).toFixed(1), rgb: [r / k, g / k, b / k].map((v) => Math.round(v)) });
      }
      (window as unknown as Record<string, unknown>).__info = { proto: proto.id, d: D, info, kit: kit.timings };
      (window as unknown as Record<string, unknown>).__ready = true;
    }
    requestAnimationFrame(draw);
  };
  draw();
});
