// The 3D city: a living diorama of one settlement. Every building the player owns
// stands on its plot at its current level; walls grow with the city's tier, houses
// with its population. Plots are pickable for the city screen.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createComposer } from '../engine/renderer.js';
import { high } from '../engine/quality.js';
import { FACTIONS } from '../data/factions.js';
import { BUILDINGS, BLD_KEYS, RESOURCES, tierOf, resourceOf } from './city.js';
import { mulberry32, fbm } from '../util/noise.js';

const WALL_R = [40, 52, 66, 82];
const PLOTS = {
  market: { x: 0, z: 0, r: 13 },
  temple: { x: 0, z: -30, r: 12 },
  barracks: { x: 32, z: -12, r: 15 },
  arena: { x: -32, z: 10, r: 17 },
  smithy: { x: 19, z: 19, r: 7 },
  academy: { x: -19, z: -19, r: 8 },
  aqueduct: { x: -30, z: -30, r: 6 },
  port: { x: 8, z: 101, r: 16 },
  stables: { x: 100, z: 18, r: 14 },
  mine: { x: -104, z: 24, r: 13 },
  farm: { x: 62, z: -112, r: 18 },
  walls: { x: 0, z: 0, r: 0 },
};
const PAL = {
  marble: '#ebe4d6', terracotta: '#b0532f', stone: '#c9bea9', stone2: '#a99d88', wood: '#6b4a2b', plaster: '#efe4cc', dark: '#2a221b', thatch: '#b39a5a',
  mud: '#d2b083', gold: '#d6ab45', bronze: '#b8893e', sand: '#d9c08a', water: '#2a6f8a', grassT: '#6c8a3e', grassM: '#8e9550', grassA: '#b39f66', dirt: '#8a7350', iron: '#3b3835',
};

export class CityView {
  constructor(renderer, world, state, prov, { labelsEl } = {}) {
    this.renderer = renderer; this.world = world; this.s = state; this.prov = prov;
    this.p = world.provinces[prov];
    this.labelsEl = labelsEl;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 1, 4000);
    this.cam = { yaw: 0.7, pitch: 0.62, dist: 210, tyaw: 0.7, tpitch: 0.55, tdist: 165, tx: 0, tz: 6, x: 0, z: 30, idle: 0 };
    this.time = 0;
    this.mats = {};
    this.coastal = this.p.coastal;
    this.style = { roman: 'med', hellenic: 'med', punic: 'med', ptolemaic: 'east', seleucid: 'east', eastern: 'east', african: 'east' }[this.p.culture] || 'hut';
    this.biome = this.p.biome;
    this.buildEnv();
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.pick = [];
    this.smokes = [];
    this.citizens = null;
    this.rebuild();
    this.composer = createComposer(renderer, this.scene, this.camera, { aoRadius: 2.5, aoIntensity: 2.2, aoFalloff: 1.5, bloom: 0.3, vignette: 0.5 });
    this.resize();
  }

  mat(c, o = {}) {
    const k = c + Object.entries(o).map(([n, v]) => n + ':' + (v && v.isTexture ? v.uuid : v)).join(',');
    if (!this.mats[k]) this.mats[k] = new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...o });
    return this.mats[k];
  }

  // ---------------------------------------------------------------- sky, light, ground, water
  buildEnv() {
    const sky = new Sky(); sky.scale.setScalar(3000);
    const u = sky.material.uniforms;
    u.turbidity.value = 4; u.rayleigh.value = 1.4; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8;
    const sun = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - 0.62, -0.9);
    u.sunPosition.value.copy(sun);
    this.scene.add(sky);
    const fogC = { desert: '#e3d3b2', arid: '#ddd2b6', steppe: '#d2d3c0', boreal: '#bccbd0', med: '#d6d6c8' }[this.biome] || '#c7d2d6';
    this.scene.fog = new THREE.Fog(fogC, 380, 1500);
    this.scene.add(new THREE.HemisphereLight('#dce8f7', '#6b5e40', 1.15));
    const d = new THREE.DirectionalLight('#fff0d6', 3.0);
    d.position.copy(sun).multiplyScalar(400);
    d.castShadow = true;
    d.shadow.mapSize.set(high() ? 4096 : 2048, high() ? 4096 : 2048);
    const sc = d.shadow.camera; sc.left = -220; sc.right = 220; sc.top = 220; sc.bottom = -220; sc.near = 50; sc.far = 1200;
    d.shadow.bias = -0.0004; d.shadow.normalBias = 0.05;
    this.scene.add(d);
    const pm = new THREE.PMREMGenerator(this.renderer);
    const es = new THREE.Scene(); const sk2 = new Sky(); sk2.scale.setScalar(3000);
    for (const k in u) if (sk2.material.uniforms[k]) sk2.material.uniforms[k].value = u[k].value.clone ? u[k].value.clone() : u[k].value;
    es.add(sk2);
    this.envRT = pm.fromScene(es, 0.02, 1, 4000); pm.dispose();
    // ground
    const geo = new THREE.CircleGeometry(700, 160, 0, Math.PI * 2);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    // CircleGeometry has one ring: subdivide by rebuilding as a polar grid
    const R = 700, rings = 120, segs = 200;
    const verts = [], uvs = [], idx = [];
    for (let r = 0; r <= rings; r++) for (let sgm = 0; sgm <= segs; sgm++) {
      const rr = (r / rings) ** 1.7 * R, a = (sgm / segs) * Math.PI * 2;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      verts.push(x, this.height(x, z), z);
      uvs.push(x / (2 * 260) + 0.5, 0.5 - z / (2 * 260));
    }
    for (let r = 0; r < rings; r++) for (let sgm = 0; sgm < segs; sgm++) {
      const a = r * (segs + 1) + sgm, b = a + segs + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    geo.dispose();
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g2.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g2.setIndex(idx);
    g2.computeVertexNormals();
    this.groundCanvas = document.createElement('canvas'); this.groundCanvas.width = this.groundCanvas.height = 2048;
    this.groundTex = new THREE.CanvasTexture(this.groundCanvas);
    this.groundTex.colorSpace = THREE.SRGBColorSpace; this.groundTex.anisotropy = 8;
    this.groundTex.wrapS = this.groundTex.wrapT = THREE.ClampToEdgeWrapping;
    const gm = new THREE.MeshStandardMaterial({ map: this.groundTex, roughness: 0.95 });
    const base = new THREE.Color(this.biome === 'desert' ? PAL.sand : this.biome === 'arid' ? PAL.grassA : this.biome === 'med' ? PAL.grassM : PAL.grassT);
    gm.onBeforeCompile = (sh) => {
      sh.uniforms.uBase = { value: base };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vW; uniform vec3 uBase;
        float h2(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }`)
        .replace('#include <map_fragment>', `
        float n = vn(vW.xz * 0.05) * 0.5 + vn(vW.xz * 0.4) * 0.3 + vn(vW.xz * 2.5) * 0.2;
        vec3 g = uBase * (0.82 + 0.36 * n);
        float rr = length(vW.xz);
        vec4 tc = (rr < 255.0) ? texture2D(map, vMapUv) : vec4(0.0);
        diffuseColor.rgb = mix(g, tc.rgb * (0.9 + 0.2 * n), tc.a);
        if (vW.y < 0.3) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.7, 0.52), smoothstep(0.3, -1.5, vW.y));`);
    };
    const ground = new THREE.Mesh(g2, gm);
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.ground = ground;
    if (this.coastal) {
      const wm = new THREE.MeshStandardMaterial({ color: '#2f7690', roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.92, envMap: this.envRT.texture, envMapIntensity: 0.9 });
      this.waterU = { uTime: { value: 0 } };
      wm.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = this.waterU.uTime;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; varying vec3 vW2;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW2 = (modelMatrix * vec4(transformed,1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTime; varying vec3 vW2;').replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          float w1 = sin(vW2.x * 0.18 + uTime * 1.3) + sin(vW2.z * 0.23 - uTime * 1.1) + sin((vW2.x + vW2.z) * 0.41 + uTime * 2.0) * 0.5;
          float w2 = cos(vW2.x * 0.21 - uTime * 0.9) + cos(vW2.z * 0.17 + uTime * 1.4);
          normal = normalize(normal + vec3(w1, 0.0, w2) * 0.06);`);
      };
      const water = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), wm);
      water.rotation.x = -Math.PI / 2; water.position.y = 0;
      this.scene.add(water);
    }
  }

  height(x, z) {
    const r = Math.hypot(x, z);
    let h = 1.5 + fbm(x * 0.006 + 3, z * 0.006 + 7, 4, 9) * 14 * Math.min(1, Math.max(0, (r - 110) / 120));
    h += Math.max(0, r - 260) * 0.12 * (0.6 + 0.4 * fbm(x * 0.01, z * 0.01, 3, 2));
    // acropolis for the temple, mound for the mine
    h += 3.2 * Math.exp(-((x - PLOTS.temple.x) ** 2 + (z - PLOTS.temple.z) ** 2) / 300);
    h += 16 * Math.exp(-((x + 128) ** 2 + (z - 18) ** 2) / 900);
    if (this.coastal) { const shore = z - 86; if (shore > 0) h -= shore * 0.55 + 1.5; }
    return h;
  }

  // ---------------------------------------------------------------- city rebuild
  rebuild() {
    const pr = this.s.provs[this.prov];
    this.pr = pr;
    for (const c of [...this.root.children]) { this.root.remove(c); c.traverse?.((o) => o.geometry?.dispose()); }
    this.pick.length = 0; this.smokes.length = 0;
    this.tier = tierOf(pr.pop);
    this.ownerColor = FACTIONS[pr.owner].color;
    this.rng = mulberry32(this.prov * 7919 + 13);
    this.paintGround();
    const building = pr.queue[0]?.b;
    for (const k of BLD_KEYS) {
      if (k === 'port' && !this.coastal) continue;
      if (k === 'mine' && RESOURCES[resourceOf(this.p)].kind !== 'metal') continue;
      const lvl = pr.bld[k];
      let g = new THREE.Group();
      g.userData.key = k;
      const pl = PLOTS[k];
      g.position.set(pl.x, k === 'walls' ? 0 : this.height(pl.x, pl.z), pl.z);
      const show = lvl + (building === k ? 1 : 0);
      if (show > 0 && this['b_' + k]) this['b_' + k](g, Math.min(BUILDINGS[k].max, show), building === k);
      if (k === 'walls' && show > 0) { const flags = []; g.traverse((o) => { if (o.userData.flag) flags.push(o); }); flags.forEach((f) => f.removeFromParent()); g = this.bake(g); flags.forEach((f) => g.add(f)); }
      if (building === k && k !== 'walls') this.scaffold(g, pl.r * 0.9, 10 + show * 3);
      this.root.add(g);
      if (k !== 'walls') {
        const hit = new THREE.Mesh(new THREE.CylinderGeometry(pl.r, pl.r, 26, 16), new THREE.MeshBasicMaterial({ visible: false }));
        hit.position.set(pl.x, g.position.y + 10, pl.z);
        hit.userData.key = k;
        this.root.add(hit);
        this.pick.push(hit);
        if (show === 0) this.emptyPlot(pl, k);
      }
    }
    this.houses();
    this.buildCitizens();
    this.highlight = new THREE.Mesh(new THREE.RingGeometry(1, 1.12, 64), new THREE.MeshBasicMaterial({ color: '#ffd774', transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false, side: THREE.DoubleSide }));
    this.highlight.rotation.x = -Math.PI / 2; this.highlight.visible = false;
    this.root.add(this.highlight);
    this.groundTex.needsUpdate = true;
  }

  setHighlight(key, selected) {
    const h = this.highlight;
    if (!key || !PLOTS[key] || key === 'walls') { h.visible = false; return; }
    const pl = PLOTS[key];
    h.visible = true;
    h.position.set(pl.x, this.height(pl.x, pl.z) + 0.6, pl.z);
    h.scale.setScalar(pl.r + 1.5);
    h.material.opacity = selected ? 0.95 : 0.6;
    h.userData.selected = selected;
  }

  focus(key) {
    if (!key || !PLOTS[key] || key === 'walls') { this.cam.tx = 0; this.cam.tz = 6; this.cam.tdist = 165; return; }
    const pl = PLOTS[key];
    this.cam.tx = pl.x * 0.8; this.cam.tz = pl.z * 0.8; this.cam.tdist = Math.max(70, pl.r * 7);
  }

  // ---------------------------------------------------------------- ground painting: plaza, roads, fields
  paintGround() {
    const c = this.groundCanvas.getContext('2d');
    const S = 2048 / 520, O = 260;
    const X = (x) => (x + O) * S, Z = (z) => (z + O) * S;
    c.clearRect(0, 0, 2048, 2048);
    const pr = this.pr;
    // fields (farms)
    const nf = pr.bld.farm * 7 + (this.tier >= 1 ? 3 : 1);
    const fr = mulberry32(this.prov + 5);
    const fieldCols = ['#c9a94a', '#a6a04a', '#7f9440', '#d4b964', '#6f8a3a', '#b48a4a'];
    for (let i = 0; i < nf; i++) {
      const a = -1.2 + (i / Math.max(1, nf)) * 4.6 + fr() * 0.2, r = 118 + fr() * 110;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this.coastal && z > 70) continue;
      const w = 22 + fr() * 26, h = 14 + fr() * 20;
      c.save(); c.translate(X(x), Z(z)); c.rotate(fr() * 3);
      c.globalAlpha = 0.85; c.fillStyle = fieldCols[i % fieldCols.length]; c.fillRect(-w * S / 2, -h * S / 2, w * S, h * S);
      c.globalAlpha = 0.25; c.strokeStyle = '#3d3020'; c.lineWidth = 1.2;
      for (let k = -w / 2; k < w / 2; k += 2.2) { c.beginPath(); c.moveTo(k * S, -h * S / 2); c.lineTo(k * S, h * S / 2); c.stroke(); }
      c.restore();
    }
    c.globalAlpha = 1;
    const wallR = this.pr.bld.walls ? WALL_R[this.tier] : WALL_R[this.tier] - 6;
    // trodden town ground
    const grd = c.createRadialGradient(X(0), Z(0), 0, X(0), Z(0), wallR * S);
    grd.addColorStop(0, 'rgba(160,140,105,0.75)'); grd.addColorStop(0.85, 'rgba(150,130,95,0.45)'); grd.addColorStop(1, 'rgba(150,130,95,0)');
    c.fillStyle = grd; c.beginPath(); c.arc(X(0), Z(0), wallR * S, 0, Math.PI * 2); c.fill();
    // roads
    c.strokeStyle = 'rgba(120,100,72,0.85)'; c.lineCap = 'round';
    const road = (pts, w) => { c.lineWidth = w * S; c.beginPath(); pts.forEach(([x, z], i) => (i ? c.lineTo(X(x), Z(z)) : c.moveTo(X(x), Z(z)))); c.stroke(); };
    road([[0, -260], [0, 260]], 5); road([[-260, 4], [260, -4]], 5);
    c.lineWidth = 3.5 * S; c.beginPath(); c.arc(X(0), Z(0), 20 * S, 0, Math.PI * 2); c.stroke();
    if (this.tier >= 2) { c.beginPath(); c.arc(X(0), Z(0), 40 * S, 0, Math.PI * 2); c.stroke(); }
    // paved plaza
    if (pr.bld.market) {
      const r = 9 + pr.bld.market * 2.5;
      c.fillStyle = '#d6cbb4'; c.fillRect(X(-r), Z(-r), 2 * r * S, 2 * r * S);
      c.strokeStyle = 'rgba(120,105,80,0.35)'; c.lineWidth = 1;
      for (let k = -r; k <= r; k += 2) { c.beginPath(); c.moveTo(X(k), Z(-r)); c.lineTo(X(k), Z(r)); c.stroke(); c.beginPath(); c.moveTo(X(-r), Z(k)); c.lineTo(X(r), Z(k)); c.stroke(); }
    }
  }

  // ---------------------------------------------------------------- helpers
  box(g, w, h, d, x, y, z, color, o = {}) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof color === 'string' ? this.mat(color) : color);
    m.position.set(x, y + h / 2, z); if (o.ry) m.rotation.y = o.ry;
    m.castShadow = m.receiveShadow = true; g.add(m); return m;
  }
  cyl(g, rt, rb, h, x, y, z, color, seg = 12) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), typeof color === 'string' ? this.mat(color) : color);
    m.position.set(x, y + h / 2, z); m.castShadow = m.receiveShadow = true; g.add(m); return m;
  }
  roof(g, w, h, d, x, y, z, color = PAL.terracotta, ry = 0) {
    // gabled roof: triangular prism along x
    const shape = new THREE.Shape(); shape.moveTo(-d / 2, 0); shape.lineTo(d / 2, 0); shape.lineTo(0, h); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
    geo.translate(0, 0, -w / 2); geo.rotateY(Math.PI / 2);
    const m = new THREE.Mesh(geo, this.mat(color)); m.position.set(x, y, z); m.rotation.y = ry;
    m.castShadow = m.receiveShadow = true; g.add(m); return m;
  }
  columns(g, n, x0, z0, x1, z1, y, h, r = 0.45, color = PAL.marble) {
    for (let i = 0; i < n; i++) { const t = n === 1 ? 0.5 : i / (n - 1); this.cyl(g, r, r * 1.1, h, x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t, color, 10); }
  }
  temple(g, w, d, h, x, z, y = 0, cols = 6, gold = false) {
    this.box(g, w + 2, 1.4, d + 2, x, y, z, PAL.stone);
    this.box(g, w * 0.7, h, d * 0.72, x, y + 1.4, z - d * 0.05, PAL.marble);
    this.columns(g, cols, x - w / 2 + 0.6, z + d / 2 - 0.6, x + w / 2 - 0.6, z + d / 2 - 0.6, y + 1.4, h, 0.5);
    this.columns(g, Math.max(3, Math.round(cols * d / w)), x - w / 2 + 0.6, z - d / 2 + 0.6, x - w / 2 + 0.6, z + d / 2 - 0.6, y + 1.4, h, 0.5);
    this.columns(g, Math.max(3, Math.round(cols * d / w)), x + w / 2 - 0.6, z - d / 2 + 0.6, x + w / 2 - 0.6, z + d / 2 - 0.6, y + 1.4, h, 0.5);
    this.box(g, w + 0.6, 0.9, d + 0.6, x, y + 1.4 + h, z, PAL.marble);
    this.roof(g, d + 0.6, h * 0.32, w + 0.8, x, y + 2.3 + h, z, gold ? PAL.gold : PAL.terracotta, Math.PI / 2);
  }
  house(g, x, z, w, d, h, style, ry) {
    const y = this.height(x, z) - 0.3;
    if (style === 'hut') { this.cyl(g, w / 2, w / 2, h, x, y, z, PAL.mud, 10); const c = this.cyl(g, 0.01, w * 0.62, h * 0.9, x, y + h, z, PAL.thatch, 10); return; }
    if (style === 'east') { this.box(g, w, h, d, x, y, z, PAL.mud, { ry }); if (this.rng() < 0.3) this.box(g, w * 0.5, h * 0.6, d * 0.5, x, y + h, z, PAL.mud, { ry }); return; }
    this.box(g, w, h, d, x, y, z, PAL.plaster, { ry });
    this.roof(g, w, h * 0.45, d + 0.3, x, y + h, z, PAL.terracotta, ry);
  }
  smoke(x, y, z, rate = 1) { this.smokes.push({ x, y, z, rate, t: 0, parts: [] }); }
  scaffold(g, r, h) {
    const w = this.mat(PAL.wood);
    const poles = 10;
    for (let i = 0; i < poles; i++) { const a = (i / poles) * Math.PI * 2; const m = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, h, 5), w); m.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); m.castShadow = true; g.add(m); }
    for (let y = 3; y < h; y += 3.5) { const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.1, 4, poles), w); ring.rotation.x = Math.PI / 2; ring.position.y = y; g.add(ring); }
    // crane
    const crane = new THREE.Group();
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, h + 8, 6), w); mast.position.y = (h + 8) / 2; crane.add(mast);
    const boom = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, r * 1.4), w); boom.position.set(0, h + 7, r * 0.5); boom.rotation.x = -0.25; crane.add(boom);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 6, 3), this.mat('#d8c9a0')); rope.position.set(0, h + 2.6, r * 1.05); crane.add(rope);
    crane.position.set(r * 0.9, 0, -r * 0.4); crane.traverse((o) => (o.castShadow = true));
    g.add(crane);
    this.crane = crane;
  }
  emptyPlot(pl, k) {
    if (this.pr.owner !== this.s.player) return;
    const y = this.height(pl.x, pl.z) + 0.15;
    const ring = new THREE.Mesh(new THREE.RingGeometry(pl.r * 0.55, pl.r * 0.62, 48), new THREE.MeshBasicMaterial({ color: '#f3d98e', transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(pl.x, y + 0.2, pl.z); ring.userData.pulse = true;
    this.root.add(ring);
    // a few survey stakes
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.6; const m = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2, 4), this.mat(PAL.wood)); m.position.set(pl.x + Math.cos(a) * pl.r * 0.6, y + 1, pl.z + Math.sin(a) * pl.r * 0.6); this.root.add(m); }
  }

  // ---------------------------------------------------------------- buildings
  b_market(g, l) {
    const r = 9 + l * 2.5;
    // stalls with awnings
    const aw = ['#b8423a', '#d8b04a', '#4a7aa8', '#e8e0d0', '#6f8a3a'];
    const n = l === 1 ? 8 : 6;
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + 0.3, rr = r * (l === 1 ? 0.55 : 0.4); const x = Math.cos(a) * rr, z = Math.sin(a) * rr; this.box(g, 2.2, 1.6, 1.6, x, 0, z, PAL.wood); this.roof(g, 2.6, 0.9, 2.2, x, 1.6, z, aw[i % aw.length], a); }
    this.cyl(g, 1, 1.1, 0.9, 0, 0, 0, PAL.stone, 14);
    if (l >= 2) {
      // colonnades on three sides and a basilica on the north side
      for (const [x0, z0, x1, z1] of [[-r + 1, r - 1, r - 1, r - 1], [-r + 1, -r + 6, -r + 1, r - 1], [r - 1, -r + 6, r - 1, r - 1]]) {
        const len = Math.hypot(x1 - x0, z1 - z0); const n2 = Math.round(len / 2.6);
        this.columns(g, n2, x0, z0, x1, z1, 0, 4.5, 0.35);
        const beam = this.box(g, x0 === x1 ? 1.2 : len + 1, 0.6, x0 === x1 ? len + 1 : 1.2, (x0 + x1) / 2, 4.5, (z0 + z1) / 2, PAL.marble);
      }
      this.box(g, 2 * r - 6, 7, 7, 0, 0, -r + 2.5, PAL.plaster);
      this.columns(g, 9, -r + 4, -r + 6.6, r - 4, -r + 6.6, 0, 7, 0.45);
      this.roof(g, 2 * r - 4, 3, 8.4, 0, 7, -r + 2.8, PAL.terracotta);
    }
    if (l >= 3) {
      this.box(g, 2.2, 3, 2.2, 0, 0, 2, PAL.marble);
      const st = this.cyl(g, 0.5, 0.7, 3.2, 0, 3, 2, this.mat(PAL.gold, { metalness: 1, roughness: 0.3, envMap: this.envRT.texture }), 8);
      this.cyl(g, 0.55, 0.55, 0.9, 0, 6.2, 2, this.mat(PAL.gold, { metalness: 1, roughness: 0.3, envMap: this.envRT.texture }), 8);
      // triumphal arch at the south entrance
      this.box(g, 2.4, 8, 3, -3.6, 0, r + 1.5, PAL.marble); this.box(g, 2.4, 8, 3, 3.6, 0, r + 1.5, PAL.marble); this.box(g, 9.6, 3, 3.2, 0, 8, r + 1.5, PAL.marble);
      this.box(g, 3, 1.4, 1.6, 0, 11, r + 1.5, this.mat(PAL.bronze, { metalness: 0.9, roughness: 0.35 }));
    }
    // owner flag
    this.flag(g, -r + 1.5, 0, r - 1.5, 10);
  }
  flag(g, x, y, z, h) {
    this.cyl(g, 0.15, 0.15, h, x, y, z, PAL.wood, 5);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2), this.mat(this.ownerColor, { side: THREE.DoubleSide }));
    f.position.set(x + 1.6, y + h - 1.2, z); f.castShadow = true; f.userData.flag = true; g.add(f);
  }
  b_temple(g, l) {
    this.box(g, 18, 1.2, 14, 0, -0.6, 0, PAL.stone2);
    if (l === 1) {
      this.cyl(g, 4.2, 4.6, 1, 0, 0.6, 0, PAL.stone, 20);
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; this.cyl(g, 0.3, 0.33, 4, Math.cos(a) * 3.5, 1.6, Math.sin(a) * 3.5, PAL.marble, 8); }
      this.cyl(g, 2.4, 2.4, 4, 0, 1.6, 0, PAL.marble, 16);
      this.cyl(g, 0.2, 4.1, 2, 0, 5.6, 0, PAL.terracotta, 20);
    } else if (l === 2) this.temple(g, 10, 14, 6, 0, 0, 0.6, 6);
    else { this.temple(g, 14, 18, 8.5, 0, -1, 0.6, 8, true); this.box(g, 3, 1.2, 2, 0, 0.6, 9.6, PAL.stone); }
  }
  b_barracks(g, l) {
    // parade ground
    const s = 9 + l;
    for (let i = -s; i <= s; i += 2.2) for (const z of [-s, s]) this.cyl(g, 0.14, 0.14, 1.4, i, 0, z, PAL.wood, 4);
    for (let i = -s; i <= s; i += 2.2) for (const x of [-s, s]) this.cyl(g, 0.14, 0.14, 1.4, x, 0, i, PAL.wood, 4);
    for (let i = 0; i < 4; i++) this.cyl(g, 0.22, 0.22, 2, -4 + i * 2.6, 0, 3, PAL.wood, 5);
    if (l === 1) for (let i = 0; i < 6; i++) { const x = -6 + (i % 3) * 5, z = -6 + Math.floor(i / 3) * 4; this.roof(g, 3, 2, 3, x, 0, z, '#d8cdb0'); }
    if (l >= 2) for (let i = 0; i < (l >= 3 ? 4 : 2); i++) { const z = -s + 3 + i * 3.6; this.box(g, 12, 2.6, 2.6, -1, 0, z, PAL.plaster); this.roof(g, 12, 1.2, 3, -1, 2.6, z); }
    if (l >= 2) { this.box(g, 5, 4, 5, s - 4, 0, s - 4, PAL.plaster); this.roof(g, 5, 1.8, 5.4, s - 4, 4, s - 4); }
    if (l >= 3) {
      const W = s + 2;
      for (const [x, z, w, d] of [[0, -W, 2 * W, 1.2], [0, W, 2 * W, 1.2], [-W, 0, 1.2, 2 * W], [W, 0, 1.2, 2 * W]]) this.box(g, w, l >= 4 ? 4.5 : 3, d, x, 0, z, PAL.stone);
      for (const [x, z] of [[-W, -W], [W, -W], [-W, W], [W, W]]) { this.box(g, 3, l >= 4 ? 7.5 : 5, 3, x, 0, z, PAL.stone); this.box(g, 3.4, 0.6, 3.4, x, l >= 4 ? 7.5 : 5, z, PAL.stone2); }
      if (l >= 4) this.flag(g, W, 7.5, W, 6);
    }
    this.flag(g, 0, 0, 0, l >= 3 ? 9 : 6);
  }
  b_arena(g, l) {
    if (l === 1) {
      for (let k = 0; k < 6; k++) { const r = 10 - k * 1.2; const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.8, 32, 1, false, Math.PI / 2, Math.PI), this.mat(k % 2 ? PAL.stone : PAL.stone2)); m.position.y = 0.4 + k * 0.8; m.castShadow = m.receiveShadow = true; g.add(m); }
      this.box(g, 12, 1.2, 3, 0, 0, 2, PAL.marble); this.box(g, 12, 4, 1, 0, 0, 3.6, PAL.marble);
      return;
    }
    const R = l === 2 ? 11 : 14, H = l === 2 ? 5 : 11;
    const prof = []; // stepped seating profile for a lathe
    const steps = l === 2 ? 6 : 9;
    prof.push(new THREE.Vector2(R * 0.45, 0));
    for (let k = 0; k <= steps; k++) { const r = R * 0.45 + (R - R * 0.45) * (k / steps); prof.push(new THREE.Vector2(r, (H * k) / steps)); prof.push(new THREE.Vector2(r + (R * 0.55) / steps, (H * k) / steps)); }
    prof.push(new THREE.Vector2(R, 0));
    const lathe = new THREE.LatheGeometry(prof, 48);
    const m = new THREE.Mesh(lathe, this.mat(PAL.stone)); m.scale.set(1.3, 1, 1); m.castShadow = m.receiveShadow = true; g.add(m);
    const sand = new THREE.Mesh(new THREE.CircleGeometry(R * 0.45, 40), this.mat('#d8c08a')); sand.rotation.x = -Math.PI / 2; sand.position.y = 0.05; sand.scale.set(1.3, 1, 1); sand.receiveShadow = true; g.add(sand);
    if (l >= 3) {
      // the outer arcaded wall
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128; const c = cv.getContext('2d');
      c.fillStyle = '#d8ccb3'; c.fillRect(0, 0, 512, 128);
      for (let row = 0; row < 3; row++) for (let i = 0; i < 16; i++) { c.fillStyle = '#5a4d3c'; const x = i * 32 + 8, y = row * 40 + 10; c.fillRect(x, y + 8, 16, 22); c.beginPath(); c.arc(x + 8, y + 8, 8, Math.PI, 0); c.fill(); }
      const t = new THREE.CanvasTexture(cv); t.wrapS = THREE.RepeatWrapping; t.repeat.set(4, 1); t.colorSpace = THREE.SRGBColorSpace;
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.4, R + 0.6, H + 2, 64, 1, true), new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, side: THREE.DoubleSide }));
      wall.position.y = (H + 2) / 2; wall.scale.set(1.3, 1, 1); wall.castShadow = true; g.add(wall);
    }
  }
  b_smithy(g, l) {
    this.box(g, 7, 3.4, 5, 0, 0, 0, PAL.stone2); this.roof(g, 7, 1.6, 5.4, 0, 3.4, 0, '#7a5a3a');
    this.box(g, 1.2, 5.5, 1.2, 2.4, 0, -1.2, PAL.stone); this.smoke(2.4 + PLOTS.smithy.x, 6 + this.height(PLOTS.smithy.x, PLOTS.smithy.z), -1.2 + PLOTS.smithy.z, 1);
    this.box(g, 0.8, 0.8, 1.4, -1, 0, 3.4, this.mat(PAL.iron, { metalness: 0.7, roughness: 0.4 }));
    if (l >= 2) { this.box(g, 5, 2.8, 4, -5.5, 0, 1, PAL.plaster); this.roof(g, 5, 1.3, 4.4, -5.5, 2.8, 1); for (let i = 0; i < 4; i++) this.cyl(g, 0.08, 0.08, 2.4, -6 + i * 0.6, 0, 3.6, PAL.iron, 4); }
    if (l >= 3) { this.box(g, 12, 3.6, 4.5, 1, 0, -5.5, PAL.stone2); this.roof(g, 12, 1.6, 4.9, 1, 3.6, -5.5, '#7a5a3a'); this.box(g, 1.2, 6, 1.2, 5, 0, -6.5, PAL.stone); this.smoke(5 + PLOTS.smithy.x, 6.5 + this.height(PLOTS.smithy.x, PLOTS.smithy.z), -6.5 + PLOTS.smithy.z, 1.3); }
  }
  b_academy(g, l) {
    if (l === 1) { this.box(g, 7, 3.4, 5, 0, 0, 0, PAL.plaster); this.roof(g, 7, 1.5, 5.4, 0, 3.4, 0); this.columns(g, 4, -2.6, 3, 2.6, 3, 0, 3.4, 0.3); return; }
    this.box(g, 9, 5, 7, 0, 0, -1, PAL.marble);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(3.6, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), this.mat(l >= 3 ? PAL.bronze : PAL.terracotta, l >= 3 ? { metalness: 0.7, roughness: 0.35 } : {}));
    dome.position.y = 5; dome.position.z = -1; dome.castShadow = true; g.add(dome);
    this.columns(g, 6, -4, 3.2, 4, 3.2, 0, 5, 0.35);
    if (l >= 3) { this.columns(g, 10, -7, 7, 7, 7, 0, 4, 0.3); this.box(g, 15, 0.6, 1.4, 0, 4, 7, PAL.marble); for (const x of [-5, 5]) { this.cyl(g, 0.3, 0.3, 2, x, 0, 9, PAL.wood, 5); const c = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 0), this.mat('#4f6f32', { flatShading: true })); c.position.set(x, 3, 9); c.castShadow = true; g.add(c); } }
  }
  b_aqueduct(g, l) {
    // the castellum (distribution tower)
    this.cyl(g, 3, 3.3, 5, 0, 0, 0, PAL.stone, 16);
    const d = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.mat(PAL.stone2)); d.position.y = 5; d.castShadow = true; g.add(d);
    if (l < 2) return;
    // a line of arches marching in from the hills
    const x0 = -160 - PLOTS.aqueduct.x, z0 = -150 - PLOTS.aqueduct.z;
    const len = Math.hypot(x0, z0), ang = Math.atan2(x0, z0);
    const n = Math.floor(len / 7);
    const topY = 11 + (l >= 3 ? 6 : 0);
    for (let i = 1; i < n; i++) {
      const t = i / n, x = x0 * t, z = z0 * t;
      const gy = this.height(x + PLOTS.aqueduct.x, z + PLOTS.aqueduct.z) - this.height(PLOTS.aqueduct.x, PLOTS.aqueduct.z);
      const h = Math.max(2, topY - gy);
      const pier = this.box(g, 1.6, h, 1.6, x, gy - 0.5, z, PAL.stone, { ry: ang });
      if (l >= 3) { const p2 = this.box(g, 1.1, 1, 1.1, x, gy + h * 0.5, z, PAL.stone2, { ry: ang }); }
    }
    const ch = this.box(g, 1.8, 1.4, len, x0 / 2, topY - 0.4, z0 / 2, PAL.stone2, { ry: ang });
  }
  b_port(g, l) {
    for (let i = 0; i < l + 1; i++) { const x = -14 + i * 11; this.box(g, 3, 1, 26, x, -0.2, 10, PAL.wood); for (let k = 0; k < 6; k++) this.cyl(g, 0.25, 0.25, 4, x + 1.3, -3, k * 4.5, PAL.wood, 5); }
    for (let i = 0; i < l * 2; i++) this.box(g, 6, 3.5, 4, -18 + i * 7, this.height(PLOTS.port.x - 18 + i * 7, PLOTS.port.z - 12) - this.height(PLOTS.port.x, PLOTS.port.z), -12, PAL.plaster) && this.roof(g, 6, 1.4, 4.4, -18 + i * 7, this.height(PLOTS.port.x - 18 + i * 7, PLOTS.port.z - 12) - this.height(PLOTS.port.x, PLOTS.port.z) + 3.5, -12);
    const ships = l + 1;
    for (let i = 0; i < ships; i++) this.ship(g, -8 + i * 11, 16 + (i % 2) * 6, i % 2 ? 0.3 : -0.2, l >= 2 && i === 0);
    if (l >= 3) { const x = 22, z = 26; this.box(g, 4, 6, 4, x, -2, z, PAL.stone); this.cyl(g, 1.4, 1.8, 10, x, 4, z, PAL.marble, 12); const f = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffcf70', toneMapped: false })); f.position.set(x, 14.6, z); g.add(f); }
  }
  ship(g, x, z, ry, big) {
    const s = new THREE.Group();
    const L = big ? 16 : 10;
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.0, L, 10, 1, false, 0, Math.PI), this.mat('#5a3b22'));
    hull.rotation.z = Math.PI / 2; hull.rotation.y = Math.PI / 2; hull.rotation.x = Math.PI; hull.position.y = 0.6; s.add(hull);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.2, L * 0.9), this.mat('#7a5a3a')); deck.position.y = 0.7; s.add(deck);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, L * 0.6, 5), this.mat(PAL.wood)); mast.position.y = L * 0.3 + 0.7; s.add(mast);
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 3.6), this.mat(big ? this.ownerColor : '#e8dfc8', { side: THREE.DoubleSide })); sail.position.set(0, L * 0.38 + 0.7, 0.2); sail.userData.flag = true; s.add(sail);
    if (big) for (let k = 0; k < 7; k++) for (const sd of [-1, 1]) { const o = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.12), this.mat(PAL.wood)); o.position.set(sd * 2.2, 0.4, -L * 0.35 + k * L * 0.1); o.rotation.z = sd * 0.35; s.add(o); }
    s.position.set(x, -this.height(PLOTS.port.x, PLOTS.port.z) + 0.1, z); s.rotation.y = ry; s.userData.bob = Math.random() * 6;
    s.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.add(s);
    (this.ships = this.ships || []).push(s);
  }
  horse(g, x, z, ry, color) {
    const h = new THREE.Group();
    const m = this.mat(color);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 2), m); b.position.y = 1.5; h.add(b);
    const n = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1, 0.45), m); n.position.set(0, 2.1, 1); n.rotation.x = -0.6; h.add(n);
    const hd = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.8), m); hd.position.set(0, 2.55, 1.35); hd.rotation.x = 0.5; h.add(hd);
    for (const [lx, lz] of [[0.25, 0.75], [-0.25, 0.75], [0.25, -0.75], [-0.25, -0.75]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.2, 0.2), m); l.position.set(lx, 0.6, lz); h.add(l); }
    h.position.set(x, 0, z); h.rotation.y = ry; h.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    h.userData.graze = Math.random() * 6;
    g.add(h);
    (this.horses = this.horses || []).push(h);
  }
  b_stables(g, l) {
    const R = 9 + l;
    const n = 26;
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; this.cyl(g, 0.12, 0.12, 1.3, Math.cos(a) * R, 0, Math.sin(a) * R, PAL.wood, 4); }
    const rail = new THREE.Mesh(new THREE.TorusGeometry(R, 0.08, 4, 48), this.mat(PAL.wood)); rail.rotation.x = Math.PI / 2; rail.position.y = 1.1; g.add(rail);
    const cols = ['#5b3b22', '#3d2a1c', '#8a6a4a', '#d8cdb8', '#2a2018'];
    for (let i = 0; i < l * 2 + 1; i++) this.horse(g, (this.rng() - 0.5) * R * 1.2, (this.rng() - 0.5) * R * 1.2, this.rng() * 6, cols[i % cols.length]);
    if (l >= 2) { this.box(g, 10, 3, 4, 0, 0, -R - 4, PAL.wood); this.roof(g, 10, 1.4, 4.4, 0, 3, -R - 4, PAL.thatch); }
    if (l >= 3) { this.box(g, 10, 3, 4, R + 4, 0, 0, PAL.wood, { ry: Math.PI / 2 }); this.roof(g, 10, 1.4, 4.4, R + 4, 3, 0, PAL.thatch, Math.PI / 2); }
  }
  b_mine(g, l) {
    // the hill sits west; dig into its flank
    this.box(g, 4, 3.5, 2, 4, 0, 0, PAL.dark, { ry: -Math.PI / 2 });
    this.box(g, 0.5, 4, 0.5, 4.2, 0, -2.2, PAL.wood); this.box(g, 0.5, 4, 0.5, 4.2, 0, 2.2, PAL.wood); this.box(g, 0.6, 0.5, 5, 4.2, 4, 0, PAL.wood);
    for (let i = 0; i < 3; i++) this.cyl(g, 0.01, 2.2 + i * 0.4, 1.8 + i * 0.3, 9 + i * 2.6, 0, 4 - i * 3, '#7a6a55', 8);
    this.box(g, 1.4, 1, 0.9, 6.5, 0, 0, PAL.wood);
    if (l >= 2) { for (const [x, z] of [[8, -6], [10, -6], [8, -8], [10, -8]]) this.cyl(g, 0.12, 0.12, 7, x, 0, z, PAL.wood, 4); this.box(g, 3, 0.4, 3, 9, 7, -7, PAL.wood); this.cyl(g, 0.9, 0.9, 0.3, 9, 7.4, -7, PAL.wood, 10); }
    if (l >= 3) { this.box(g, 5, 3, 4, 14, 0, 6, PAL.stone2); this.box(g, 1, 6, 1, 15.5, 0, 7, PAL.stone); this.smoke(15.5 + PLOTS.mine.x, 6.5 + this.height(PLOTS.mine.x, PLOTS.mine.z), 7 + PLOTS.mine.z, 1.2); }
  }
  b_farm(g, l) {
    // the villa(s) among the fields
    const villas = l;
    for (let i = 0; i < villas; i++) {
      const x = -10 + i * 14, z = i * 9;
      this.box(g, i === 2 ? 12 : 7, 3, i === 2 ? 9 : 5, x, 0, z, PAL.plaster); this.roof(g, i === 2 ? 12 : 7, 1.6, (i === 2 ? 9 : 5) + 0.4, x, 3, z);
      this.cyl(g, 1.2, 1.2, 3.5, x + 5, 0, z + 3, PAL.wood, 10); this.cyl(g, 0.01, 1.5, 1.6, x + 5, 3.5, z + 3, PAL.thatch, 10);
    }
  }
  b_walls(g, l) {
    const R = WALL_R[this.tier];
    const seg = Math.round(R * 1.2);
    const stone = l >= 2;
    const H = l === 1 ? 3.2 : l === 2 ? 5.5 : 8;
    const gates = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
      if (gates.some((ga) => Math.abs(Math.atan2(Math.sin(am - ga), Math.cos(am - ga))) < 0.06)) continue;
      const x = Math.cos(am) * R, z = Math.sin(am) * R;
      if (this.coastal && z > 82) continue;
      const len = 2 * Math.PI * R / seg + 0.2;
      const y = this.height(x, z) - 0.6;
      if (stone) {
        const w = this.box(g, len, H, 1.6, x, y, z, PAL.stone, { ry: -am + Math.PI / 2 });
        if (i % 2 === 0) this.box(g, len * 0.45, 0.8, 1.7, x, y + H, z, PAL.stone, { ry: -am + Math.PI / 2 });
      } else {
        for (let k = 0; k < 3; k++) { const t = k / 3; const px = Math.cos(a0 + (a1 - a0) * t) * R, pz = Math.sin(a0 + (a1 - a0) * t) * R; this.cyl(g, 0.3, 0.34, H + (k % 2) * 0.4, px, this.height(px, pz) - 0.6, pz, PAL.wood, 6); }
      }
    }
    if (stone) {
      const towers = l === 3 ? 16 : 10;
      for (let i = 0; i < towers; i++) {
        const a = (i / towers) * Math.PI * 2 + 0.2, x = Math.cos(a) * R, z = Math.sin(a) * R;
        if (this.coastal && z > 82) continue;
        const y = this.height(x, z) - 0.6;
        this.box(g, 4, H + 3, 4, x, y, z, PAL.stone2, { ry: -a });
        this.box(g, 4.6, 0.7, 4.6, x, y + H + 3, z, PAL.stone, { ry: -a });
        if (i % 4 === 0) this.flag(g, x, y + H + 3.7, z, 4);
      }
    }
    for (const ga of gates) {
      const x = Math.cos(ga) * R, z = Math.sin(ga) * R;
      if (this.coastal && z > 82) continue;
      const y = this.height(x, z) - 0.6;
      for (const s of [-1, 1]) { const ox = Math.cos(ga + Math.PI / 2) * 4.4 * s, oz = Math.sin(ga + Math.PI / 2) * 4.4 * s; this.box(g, 3.6, H + (stone ? 4 : 2), 3.6, x + ox, y, z + oz, stone ? PAL.stone2 : '#8a6a45', { ry: -ga }); if (!stone) this.roof(g, 4.2, 1.6, 4.2, x + ox, y + H + 2, z + oz, PAL.thatch, -ga); }
      if (stone) this.box(g, 9, 2, 3.4, x, y + H + 1, z, PAL.stone, { ry: -ga + Math.PI / 2 });
    }
  }

  // ---------------------------------------------------------------- houses and people
  houses() {
    // A planned Roman grid: insulae fill outward from the forum as the city grows.
    const pr = this.pr;
    const R = WALL_R[this.tier] - 4;
    const n = Math.min(620, Math.round(pr.pop / 85));
    const style = this.style;
    const g = new THREE.Group();
    const rng = mulberry32(this.prov * 31 + 7);
    const blocked = (x, z, pad = 0) => {
      for (const k of ['market', 'temple', 'barracks', 'arena', 'smithy', 'academy', 'aqueduct']) {
        if (!(pr.bld[k] > 0 || pr.queue.some((q) => q.b === k)) && k !== 'market') continue;
        const pl = PLOTS[k]; const rr = pl.r + (k === 'market' ? 4 + pr.bld.market * 2.5 : 2.5) + pad;
        if ((x - pl.x) ** 2 + (z - pl.z) ** 2 < rr * rr) return true;
      }
      if (this.coastal && z > 80) return true;
      return false;
    };
    const C = 5.2; // lot size
    const grid = style !== 'hut';
    const lots = [];
    const span = Math.ceil((R + 30) / C);
    for (let gx = -span; gx <= span; gx++) for (let gz = -span; gz <= span; gz++) {
      if (grid && (Math.abs(gx) % 4 === 0 || Math.abs(gz) % 4 === 0)) continue; // streets
      const x = gx * C + (grid ? 0 : (rng() - 0.5) * 3), z = gz * C + (grid ? 0 : (rng() - 0.5) * 3);
      const r = Math.hypot(x, z);
      if (Math.abs(x) < 3.5 || Math.abs(z) < 3.5) continue;
      if (blocked(x, z)) continue;
      const out = r > R;
      if (out && (r > R + 34 || rng() < 0.75)) continue; // a thin suburb outside the walls
      lots.push({ x, z, d: r + (out ? 60 : 0) + rng() * 14 });
    }
    lots.sort((a, b) => a.d - b.d);
    const plaster = [PAL.plaster, '#e9d6b4', '#f1e2c8', '#e4c9a6', '#efd9c0', '#ddd0b8'];
    const roofs = [PAL.terracotta, '#a5482a', '#b85d36', '#9c4a2e'];
    for (let k = 0; k < Math.min(n, lots.length); k++) {
      const { x, z } = lots[k];
      const r = Math.hypot(x, z);
      const tall = this.tier >= 2 && r < R * 0.55 ? 0.6 + rng() * 0.8 : rng() * 0.45;
      const w = C * (0.62 + rng() * 0.3), d = C * (0.62 + rng() * 0.3), h = 2.2 + tall * 2.2;
      const y = this.height(x, z) - 0.3;
      if (style === 'hut') { this.cyl(g, w / 2.4, w / 2.4, 2.2, x, y, z, PAL.mud, 10); this.cyl(g, 0.01, w * 0.55, 2.2, x, y + 2.2, z, PAL.thatch, 10); continue; }
      const ry = grid ? (rng() < 0.5 ? 0 : Math.PI / 2) : rng() * 6;
      if (style === 'east') { const mc = ['#d2b083', '#c9a676', '#dcc196', '#bf9a6a', '#e3cfa8'][Math.floor(rng() * 5)]; this.box(g, w, h, d, x, y, z, mc, { ry }); if (rng() < 0.35) this.box(g, w * 0.5, 1.4, d * 0.5, x, y + h, z, mc, { ry }); continue; }
      this.box(g, w, h, d, x, y, z, plaster[Math.floor(rng() * plaster.length)], { ry });
      this.roof(g, w + 0.2, 1.1 + rng() * 0.5, d + 0.4, x, y + h, z, roofs[Math.floor(rng() * roofs.length)], ry);
    }
    // street paving between the blocks
    // trees in gardens and the countryside
    for (let i = 0; i < 90; i++) {
      const a = rng() * Math.PI * 2, r = R + 10 + rng() * 140, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this.coastal && z > 78) continue;
      if (Object.values(PLOTS).some((pl) => pl.r && (x - pl.x) ** 2 + (z - pl.z) ** 2 < (pl.r + 4) ** 2)) continue;
      const y = this.height(x, z);
      const kind = this.biome === 'desert' || this.biome === 'arid' ? 'palm' : this.biome === 'med' ? (rng() < 0.6 ? 'cypress' : 'olive') : 'oak';
      if (kind === 'cypress') this.cyl(g, 0.15, 1.1, 7 + rng() * 3, x, y, z, '#3d5428', 8);
      else if (kind === 'palm') { this.cyl(g, 0.25, 0.35, 7, x, y, z, '#7a6040', 6); for (let k = 0; k < 6; k++) this.box(g, 0.4, 0.15, 3.4, x + Math.cos(k) * 1.4, y + 7, z + Math.sin(k) * 1.4, '#5f7a35', { ry: k }); }
      else { this.cyl(g, 0.3, 0.4, 2.2, x, y, z, PAL.wood, 6); const c = new THREE.Mesh(new THREE.IcosahedronGeometry(kind === 'olive' ? 1.8 : 2.4 + rng(), 0), this.mat(kind === 'olive' ? '#7d8a52' : '#4b6d2e', { flatShading: true })); c.position.set(x, y + 3.6, z); c.scale.y = 0.8; c.castShadow = true; g.add(c); }
    }
    this.root.add(this.bake(g));
  }

  // merge a static group's meshes into one mesh per material (hundreds of draw calls -> a handful)
  bake(g) {
    g.updateMatrixWorld(true);
    const by = new Map();
    g.traverse((o) => {
      if (!o.isMesh) return;
      const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
      for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      if (!by.has(o.material)) by.set(o.material, []);
      by.get(o.material).push(geo);
      o.geometry.dispose();
    });
    const out = new THREE.Group();
    for (const [m, list] of by) {
      const merged = mergeGeometries(list, false);
      list.forEach((x) => x.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, m);
      mesh.castShadow = mesh.receiveShadow = true;
      out.add(mesh);
    }
    return out;
  }

  buildCitizens() {
    const N = Math.min(140, 25 + Math.round(this.pr.pop / 400));
    const body = new THREE.CapsuleGeometry(0.32, 0.9, 2, 6); body.translate(0, 0.8, 0);
    const im = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ roughness: 0.9 }), N);
    const cols = ['#e8e0d0', '#b8423a', '#8a6a4a', '#d8b04a', '#4a6a8a', '#7a5a3a', '#efe7d6'];
    const R = WALL_R[this.tier] - 6;
    this.people = [];
    const rng = mulberry32(this.prov + 99);
    for (let i = 0; i < N; i++) {
      im.setColorAt(i, new THREE.Color(cols[i % cols.length]));
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * R;
      this.people.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, tx: 0, tz: 0, sp: 1.1 + rng() * 0.8, wait: rng() * 4 });
    }
    im.castShadow = true;
    this.citizens = im;
    this.root.add(im);
  }

  updateCitizens(dt) {
    if (!this.citizens) return;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const R = WALL_R[this.tier] - 6;
    this.people.forEach((c, i) => {
      if (c.wait > 0) c.wait -= dt;
      else {
        const dx = c.tx - c.x, dz = c.tz - c.z, d = Math.hypot(dx, dz);
        if (d < 0.5) {
          // walk along the roads: toward the forum or a gate street
          const pick = Math.random();
          if (pick < 0.35) { c.tx = (Math.random() - 0.5) * 16; c.tz = (Math.random() - 0.5) * 16; }
          else { const a = Math.floor(Math.random() * 4) * Math.PI / 2; const r = Math.random() * R; c.tx = Math.cos(a) * r + (Math.random() - 0.5) * 3; c.tz = Math.sin(a) * r + (Math.random() - 0.5) * 3; }
          c.wait = Math.random() * 3;
        } else { c.x += (dx / d) * c.sp * dt; c.z += (dz / d) * c.sp * dt; c.face = Math.atan2(dx, dz); }
      }
      p.set(c.x, this.height(c.x, c.z) + Math.abs(Math.sin(this.time * 8 + i)) * (c.wait > 0 ? 0 : 0.08), c.z);
      q.setFromAxisAngle(up, c.face || 0);
      m4.compose(p, q, s); this.citizens.setMatrixAt(i, m4);
    });
    this.citizens.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- smoke
  updateSmoke(dt) {
    if (!this.smokeMesh) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64; const c = cv.getContext('2d');
      const g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 64, 64);
      this.smokeMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), color: '#8a8580', transparent: true, depthWrite: false, opacity: 0.5 });
      this.smokeMesh = true;
    }
    for (const sm of this.smokes) {
      sm.t -= dt;
      if (sm.t <= 0 && sm.parts.length < 26) {
        sm.t = 0.35 / sm.rate;
        const sp = new THREE.Sprite(this.smokeMat.clone());
        sp.position.set(sm.x, sm.y, sm.z); sp.userData.age = 0; sp.scale.setScalar(1.2);
        this.scene.add(sp); sm.parts.push(sp);
      }
      for (let i = sm.parts.length - 1; i >= 0; i--) {
        const sp = sm.parts[i]; sp.userData.age += dt;
        const a = sp.userData.age;
        sp.position.y += dt * 2.2; sp.position.x += dt * 1.1;
        sp.scale.setScalar(1.2 + a * 1.6);
        sp.material.opacity = Math.max(0, 0.45 * (1 - a / 6));
        if (a > 6) { this.scene.remove(sp); sp.material.dispose(); sm.parts.splice(i, 1); }
      }
    }
  }

  // ---------------------------------------------------------------- camera + picking
  pickAt(cx, cy) {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1), this.camera);
    const hit = rc.intersectObjects(this.pick, false)[0];
    return hit ? hit.object.userData.key : null;
  }
  screenOf(key) {
    const pl = PLOTS[key];
    const v = new THREE.Vector3(pl.x, this.height(pl.x, pl.z) + (key === 'aqueduct' ? 12 : 14), pl.z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, vis: v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 };
  }

  updateCamera(dt) {
    const c = this.cam;
    c.idle += dt;
    if (c.idle > 6) c.tyaw += dt * 0.04;
    const k = 1 - Math.exp(-dt * 4);
    c.tdist = Math.max(45, Math.min(320, c.tdist)); c.tpitch = Math.max(0.2, Math.min(1.25, c.tpitch));
    c.yaw += (c.tyaw - c.yaw) * k; c.pitch += (c.tpitch - c.pitch) * k; c.dist += (c.tdist - c.dist) * k;
    c.x += (c.tx - c.x) * k; c.z += (c.tz - c.z) * k;
    const gy = this.height(c.x, c.z);
    const cp = Math.cos(c.pitch);
    this.camera.position.set(c.x + Math.sin(c.yaw) * cp * c.dist, gy + Math.sin(c.pitch) * c.dist, c.z + Math.cos(c.yaw) * cp * c.dist);
    this.camera.lookAt(c.x, gy + 4, c.z);
  }

  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.composer.setSize(innerWidth, innerHeight); }

  render(dt) {
    this.time += dt;
    this.updateCamera(dt);
    this.updateCitizens(dt);
    this.updateSmoke(dt);
    if (this.waterU) this.waterU.uTime.value = this.time;
    for (const s of this.ships || []) s.position.y = -this.height(PLOTS.port.x, PLOTS.port.z) + 0.1 + Math.sin(this.time * 1.2 + s.userData.bob) * 0.18;
    for (const h of this.horses || []) h.rotation.y += Math.sin(this.time * 0.3 + h.userData.graze) * dt * 0.2;
    if (this.crane) this.crane.rotation.y = Math.sin(this.time * 0.3) * 0.9;
    this.root.traverse((o) => { if (o.userData.pulse) o.material.opacity = 0.25 + 0.2 * Math.sin(this.time * 3); });
    if (this.highlight.visible) this.highlight.material.opacity = (this.highlight.userData.selected ? 0.75 : 0.45) + 0.2 * Math.sin(this.time * 4);
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose?.();
    this.envRT.dispose();
    this.scene.traverse((o) => { o.geometry?.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.map?.dispose?.(); m.dispose(); }); });
  }
}

export { PLOTS };
