// Battle renderer: sky, painted terrain with grass and forests, instanced soldiers
// (GPU-animated), missiles in flight and stuck in the earth, dust and blood.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { FIELD, TERRAIN, isCav } from './sim.js';
import { buildModel, soldierMaterial } from './models.js';
import { createComposer } from '../engine/renderer.js';
import { mulberry32 } from '../util/noise.js';
import { high } from '../engine/quality.js';

const BIOME = {
  temperate: { g1: '#5b7434', g2: '#7c8a45', dirt: '#806a48', rock: '#7d786e', fog: '#c3cfd4', grass: ['#4a6428', '#9aa654'], trees: 'oak', sun: 32 },
  med: { g1: '#76833f', g2: '#8f9450', dirt: '#987d55', rock: '#9a907f', fog: '#d6d6c8', grass: ['#6e7a36', '#a7a560'], trees: 'cypress', sun: 40 },
  arid: { g1: '#a08c55', g2: '#b29b62', dirt: '#a7855a', rock: '#a08a70', fog: '#e0d4b8', grass: ['#8d7f45', '#bfae6e'], trees: 'palm', sun: 45 },
  desert: { g1: '#d0ac74', g2: '#c79c62', dirt: '#b88d58', rock: '#a98a66', fog: '#ead9b8', grass: ['#9a8a50', '#c7b177'], trees: 'palm', sun: 50 },
  steppe: { g1: '#94944f', g2: '#a8a35c', dirt: '#8f7c52', rock: '#8a8270', fog: '#d3d3c2', grass: ['#7e8040', '#b5ad62'], trees: 'oak', sun: 30 },
  boreal: { g1: '#46633a', g2: '#587543', dirt: '#6a5a40', rock: '#77756e', fog: '#bccbd0', grass: ['#3c5a2c', '#6e8a48'], trees: 'pine', sun: 24 },
};

export class BattleView {
  constructor(renderer, sim, labelsEl) {
    this.renderer = renderer;
    this.sim = sim;
    this.labelsEl = labelsEl;
    this.B = BIOME[sim.terrain.biome] || BIOME.temperate;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.5, 5000);
    this.time = 0;
    const ps = sim.sides.findIndex((s) => s.player);
    this.playerSide = ps < 0 ? 0 : ps;
    const z0 = sim.zoneOf(this.playerSide).z0;
    const faceYaw = sim.sideFacing(this.playerSide);
    this.cam = { x: 0, z: z0, dist: 120, yaw: faceYaw + Math.PI, pitch: 0.55, tx: 0, tz: z0, tdist: 120, tyaw: faceYaw + Math.PI, tpitch: 0.55 };
    this.buildSky();
    this.buildTerrain();
    this.buildGrass();
    this.buildTrees();
    this.buildTown();
    this.buildSoldiers();
    this.buildMissiles();
    this.buildParticles();
    this.buildMarkers();
    this.buildZone();
    this.buildClouds();
    this.buildStandards();
    this.buildDecals();
    this.arrows = [];
    this.shakeAmt = 0;
    this.composer = createComposer(renderer, this.scene, this.camera, { aoRadius: 2.2, aoIntensity: 2.4, aoFalloff: 1.2, bloom: 0.3, vignette: 0.45, saturation: 0.06 });
    this.resize();
  }

  // ---------------------------------------------------------------- environment
  buildSky() {
    const sky = new Sky();
    sky.scale.setScalar(4500);
    const u = sky.material.uniforms;
    u.turbidity.value = 5; u.rayleigh.value = 1.3; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8;
    const elev = THREE.MathUtils.degToRad(this.B.sun), az = (this.sim.sideFacing(this.playerSide) === 0 ? Math.PI : 0) + ((this.sim.cfg.seed % 100) / 100 - 0.5) * 1.6;
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - elev, az);
    u.sunPosition.value.copy(sunDir);
    this.scene.add(sky);
    this.sunDir = sunDir;
    // image-based light from the sky so bronze and steel actually shine
    const pm = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const sky2 = new Sky(); sky2.scale.setScalar(4500);
    for (const k in u) if (sky2.material.uniforms[k]) sky2.material.uniforms[k].value = u[k].value.clone ? u[k].value.clone() : u[k].value;
    envScene.add(sky2);
    this.envRT = pm.fromScene(envScene, 0.02, 1, 6000);
    // used only by metal-bearing materials (soldiers, standards); the ground keeps its painted light
    pm.dispose();
    this.scene.fog = new THREE.FogExp2(this.B.fog, 0.0011);
    const hemi = new THREE.HemisphereLight('#d5e3f5', '#6b5e40', 1.15);
    const sun = new THREE.DirectionalLight('#fff0d6', 3.0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(high() ? 4096 : 2048, high() ? 4096 : 2048);
    sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.04;
    this.sun = sun;
    this.scene.add(hemi, sun, sun.target);
  }

  buildTerrain() {
    this.decalU = { value: null };
    const T = this.sim.terrain;
    const seg = 300;
    const geo = new THREE.PlaneGeometry(TERRAIN * 2, TERRAIN * 2, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const g1 = new THREE.Color(this.B.g1), g2 = new THREE.Color(this.B.g2), rock = new THREE.Color(this.B.rock), dirt = new THREE.Color(this.B.dirt);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, T.at(x, z));
    }
    geo.computeVertexNormals();
    const nor = geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const slope = 1 - nor.getY(i);
      const n = Math.sin(x * 0.013 + Math.cos(z * 0.011) * 2) * 0.25 + Math.sin(x * 0.041 - z * 0.033 + Math.sin(x * 0.01)) * 0.25 + 0.5;
      c.copy(g1).lerp(g2, n);
      c.lerp(dirt, Math.min(1, Math.max(0, (Math.sin(x * 0.006 - z * 0.004) - 0.55) * 2)) * 0.6);
      c.lerp(rock, Math.min(1, slope * 6));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96 });
    const uDirt = { value: new THREE.Color(this.B.dirt) };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uDirt = uDirt;
      sh.uniforms.uDecal = this.decalU;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vW; uniform vec3 uDirt; uniform sampler2D uDecal;
float h2(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
float n = vn(vW.xz * 0.07) * 0.5 + vn(vW.xz * 0.45) * 0.3 + vn(vW.xz * 3.1) * 0.2;
diffuseColor.rgb *= 0.78 + 0.42 * n;
float dry = smoothstep(0.45, 0.75, vn(vW.xz * 0.006 + 11.0));
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.18, 1.05, 0.72), dry * 0.6);
float dp = smoothstep(0.62, 0.8, vn(vW.xz * 0.018 + 3.7));
diffuseColor.rgb = mix(diffuseColor.rgb, uDirt * (0.85 + 0.3 * n), dp * 0.55);
vec2 duv = (vW.xz + ${(FIELD + 60).toFixed(1)}) / ${(2 * (FIELD + 60)).toFixed(1)};
if (duv.x > 0.0 && duv.x < 1.0 && duv.y > 0.0 && duv.y < 1.0) {
  vec4 dc = texture2D(uDecal, vec2(duv.x, 1.0 - duv.y));
  diffuseColor.rgb = mix(diffuseColor.rgb, dc.rgb, dc.a * (0.75 + 0.25 * n));
}`);
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.terrainMesh = mesh;
  }

  buildGrass() {
    const desert = this.sim.terrain.biome === 'desert';
    const blade = new THREE.BufferGeometry();
    const P = [], Cc = [];
    const lo = new THREE.Color(this.B.grass[0]), hi = new THREE.Color(this.B.grass[1]);
    // a tuft of thin blades fanning out from the root
    const rb = mulberry32(3);
    const bladeN = desert ? 3 : 5;
    for (let k = 0; k < bladeN; k++) {
      const a = rb() * Math.PI * 2, lean = 0.12 + rb() * 0.22, h = (desert ? 0.28 : 0.38) + rb() * 0.3, w = 0.035;
      const ox = Math.cos(a) * 0.06, oz = Math.sin(a) * 0.06;
      const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
      const tx = ox + Math.cos(a) * lean, tz = oz + Math.sin(a) * lean;
      P.push(ox - px, 0, oz - pz, ox + px, 0, oz + pz, tx, h, tz, ox + px, 0, oz + pz, ox - px, 0, oz - pz, tx, h, tz);
      for (let r = 0; r < 2; r++) Cc.push(lo.r, lo.g, lo.b, lo.r, lo.g, lo.b, hi.r, hi.g, hi.b);
    }
    blade.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    blade.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
    blade.setAttribute('normal', new THREE.Float32BufferAttribute(P.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    this.windU = { value: 0 };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uWind = this.windU;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWind;').replace('#include <begin_vertex>', `#include <begin_vertex>
float wv = sin(uWind * 1.7 + instanceMatrix[3].x * 0.08 + instanceMatrix[3].z * 0.05) * 0.18 + sin(uWind * 3.1 + instanceMatrix[3].x * 0.3) * 0.06;
transformed.x += wv * position.y; transformed.z += wv * 0.6 * position.y;`);
    };
    const count = Math.round((desert ? 9000 : 90000) * (high() ? 1 : 0.45));
    const im = new THREE.InstancedMesh(blade, mat, count);
    const rng = mulberry32(this.sim.cfg.seed + 11);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const R = FIELD + 140;
    for (let i = 0; i < count; i++) {
      let x = (rng() - 0.5) * 2 * R, z = (rng() - 0.5) * 2 * R;
      // clumpy distribution
      if (rng() < 0.5) { const cx = Math.round(x / 9) * 9, cz = Math.round(z / 9) * 9; x = cx + (rng() - 0.5) * 6; z = cz + (rng() - 0.5) * 6; }
      p.set(x, this.sim.terrain.at(x, z), z);
      q.setFromAxisAngle(up, rng() * 6.28);
      const sc = 0.6 + rng() * 1.1;
      s.set(sc, sc * (0.7 + rng() * 0.8), sc);
      m4.compose(p, q, s); im.setMatrixAt(i, m4);
    }
    im.receiveShadow = true;
    this.scene.add(im);
  }

  buildTrees() {
    const kind = this.B.trees;
    const rng = mulberry32(this.sim.cfg.seed + 5);
    const parts = [];
    const tint = (g0, c) => { const g = g0.index ? g0.toNonIndexed() : g0; const col = new THREE.Color(c); const a = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < a.length; i += 3) { a[i] = col.r; a[i + 1] = col.g; a[i + 2] = col.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
    const trunk = new THREE.CylinderGeometry(0.25, 0.4, 4, 6); trunk.translate(0, 2, 0);
    let canopy;
    if (kind === 'pine') {
      const c1 = new THREE.ConeGeometry(2.6, 6, 8); c1.translate(0, 5.5, 0);
      const c2 = new THREE.ConeGeometry(2.0, 5, 8); c2.translate(0, 8.2, 0);
      const c3 = new THREE.ConeGeometry(1.3, 3.5, 8); c3.translate(0, 10.6, 0);
      canopy = [tint(c1, '#2f4f2a'), tint(c2, '#365a2f'), tint(c3, '#3d6534')];
    } else if (kind === 'cypress') {
      const c1 = new THREE.CylinderGeometry(0.4, 1.3, 9, 8); c1.translate(0, 6.5, 0);
      canopy = [tint(c1, '#3a4f2a')];
    } else if (kind === 'palm') {
      trunk.scale(0.6, 2.2, 0.6);
      canopy = [];
      for (let k = 0; k < 7; k++) { const l = new THREE.BoxGeometry(0.5, 0.12, 3.4); l.translate(0, 0, 1.7); l.rotateX(0.35); l.rotateY((k / 7) * Math.PI * 2); l.translate(0, 8.8, 0); canopy.push(tint(l, '#5f7a35')); }
    } else {
      const c1 = new THREE.IcosahedronGeometry(3.2, 1); c1.translate(0, 6.2, 0);
      const c2 = new THREE.IcosahedronGeometry(2.4, 1); c2.translate(1.5, 7.5, 0.8);
      canopy = [tint(c1, '#3f6328'), tint(c2, '#4a6f2e')];
    }
    parts.push(tint(trunk, '#4b3826'), ...canopy);
    const merged = mergeAll(parts);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    const count = 2600;
    const im = new THREE.InstancedMesh(merged, mat, count);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const groves = Array.from({ length: 6 }, () => ({ x: (rng() < 0.5 ? -1 : 1) * (FIELD * 0.55 + rng() * FIELD * 0.4), z: (rng() - 0.5) * 220, r: 25 + rng() * 30 }));
    let n = 0;
    for (let tries = 0; tries < 20000 && n < count; tries++) {
      let x, z;
      if (rng() < 0.18) { const g = groves[Math.floor(rng() * groves.length)]; const a = rng() * 6.28, r = Math.sqrt(rng()) * g.r; x = g.x + Math.cos(a) * r; z = g.z + Math.sin(a) * r; }
      else { x = (rng() - 0.5) * 2 * (TERRAIN * 0.85); z = (rng() - 0.5) * 2 * (TERRAIN * 0.85); if (Math.max(Math.abs(x), Math.abs(z)) < FIELD + 25) continue; }
      if (kind === 'palm' && rng() < 0.6) continue;
      p.set(x, this.sim.terrain.at(x, z) - 0.2, z);
      q.setFromAxisAngle(up, rng() * 6.28);
      const sc = 0.7 + rng() * 0.7; s.set(sc, sc * (0.85 + rng() * 0.4), sc);
      m4.compose(p, q, s); im.setMatrixAt(n++, m4);
    }
    im.count = n; im.castShadow = true; im.receiveShadow = true;
    this.scene.add(im);
    // rocks
    const rock = new THREE.DodecahedronGeometry(1, 0);
    const rim = new THREE.InstancedMesh(rock, new THREE.MeshStandardMaterial({ color: this.B.rock, roughness: 0.95, flatShading: true }), 260);
    for (let i = 0; i < 260; i++) {
      const x = (rng() - 0.5) * 2 * (FIELD + 200), z = (rng() - 0.5) * 2 * (FIELD + 200);
      p.set(x, this.sim.terrain.at(x, z) - 0.2, z);
      q.setFromEuler(new THREE.Euler(rng(), rng() * 6, rng()));
      const sc = 0.3 + rng() * rng() * 2.2; s.set(sc * (1 + rng()), sc, sc * (1 + rng()));
      m4.compose(p, q, s); rim.setMatrixAt(i, m4);
    }
    rim.castShadow = true; rim.receiveShadow = true;
    this.scene.add(rim);
  }

  // a town behind the defenders when a settlement is attacked
  buildTown() {
    const cfg = this.sim.cfg;
    if (!cfg.town) return;
    const def = 1 - cfg.attacker;
    const zs = this.sim.zoneOf(def).z0 > 0 ? 1 : -1;
    const rng = mulberry32(cfg.seed + 3);
    const style = cfg.town.style;
    const wallC = style === 'hut' ? '#6b4d2e' : style === 'east' ? '#c9a77a' : '#d8ccb3';
    const houseC = style === 'hut' ? '#8a6c48' : style === 'east' ? '#d2b083' : '#ece2cc';
    const roofC = style === 'hut' ? '#b39a5a' : style === 'east' ? '#c39d70' : '#b2532e';
    const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
    const roof = style === 'hut' ? new THREE.ConeGeometry(0.75, 0.9, 8) : new THREE.ConeGeometry(0.75, 0.5, 4);
    if (style !== 'hut') roof.rotateY(Math.PI / 4); roof.translate(0, 0.25, 0);
    const houses = new THREE.InstancedMesh(style === 'hut' ? new THREE.CylinderGeometry(0.5, 0.5, 1, 10).translate(0, 0.5, 0) : box, new THREE.MeshStandardMaterial({ color: houseC, roughness: 0.9 }), 400);
    const roofs = new THREE.InstancedMesh(roof, new THREE.MeshStandardMaterial({ color: roofC, roughness: 0.85 }), 400);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    let n = 0;
    for (let i = 0; i < 400; i++) {
      const x = (rng() - 0.5) * 380, z = zs * (FIELD - 20 + rng() * 170);
      const w = 5 + rng() * 6, d = 5 + rng() * 7, h = 3.5 + rng() * (style === 'east' ? 3 : 5);
      const y = this.sim.terrain.at(x, z) - 0.3;
      q.setFromAxisAngle(up, style === 'hut' ? 0 : Math.round(rng() * 2) * 0.1);
      m4.compose(p.set(x, y, z), q, s.set(w, h, style === 'hut' ? w : d)); houses.setMatrixAt(n, m4);
      if (style !== 'east') { m4.compose(p.set(x, y + h, z), q, s.set(w * 1.1, style === 'hut' ? w * 0.8 : 3, style === 'hut' ? w * 1.1 : d * 1.1)); roofs.setMatrixAt(n, m4); }
      else { m4.compose(p.set(x, -50, z), q, s.set(0.01, 0.01, 0.01)); roofs.setMatrixAt(n, m4); }
      n++;
    }
    for (const im of [houses, roofs]) { im.castShadow = true; im.receiveShadow = true; this.scene.add(im); }
    if (cfg.walls > 0) {
      const wall = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: wallC, roughness: 0.9 }), 120);
      let k = 0;
      const wz = zs * (FIELD - 30);
      for (let x = -210; x <= 210; x += 12) {
        const y = this.sim.terrain.at(x, wz) - 0.5;
        m4.compose(p.set(x, y, wz), q.identity(), s.set(12.2, 6 + cfg.walls * 1.5, 3)); wall.setMatrixAt(k++, m4);
        if (Math.abs(x) % 48 < 1) { m4.compose(p.set(x, y, wz), q.identity(), s.set(6, 10 + cfg.walls * 2, 6)); wall.setMatrixAt(k++, m4); }
      }
      wall.count = k; wall.castShadow = true; wall.receiveShadow = true;
      this.scene.add(wall);
    }
  }

  // ---------------------------------------------------------------- soldiers
  buildSoldiers() {
    const sim = this.sim;
    const byType = new Map();
    for (let i = 0; i < sim.N; i++) {
      const t = sim.units[sim.sunit[i]].t.id;
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push(i);
    }
    const { mat, depth } = soldierMaterial();
    mat.envMap = this.envRT.texture; mat.envMapIntensity = 0.35;
    this.soldierMat = mat;
    this.meshes = [];
    this.sIdx = new Int32Array(sim.N); this.sMesh = new Int16Array(sim.N);
    this.sScale = new Float32Array(sim.N);
    const rng = mulberry32(17);
    for (const [t, list] of byType) {
      const geo = buildModel(sim.units[sim.sunit[list[0]]].t);
      const team = new Float32Array(list.length * 3), anim = new Float32Array(list.length * 4), vari = new Float32Array(list.length * 3);
      geo.setAttribute('aTeam', new THREE.InstancedBufferAttribute(team, 3));
      geo.setAttribute('aVar', new THREE.InstancedBufferAttribute(vari, 3));
      const animAttr = new THREE.InstancedBufferAttribute(anim, 4); animAttr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aAnim', animAttr);
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      im.customDepthMaterial = depth;
      im.castShadow = true; im.receiveShadow = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      const c = new THREE.Color();
      list.forEach((si, k) => {
        this.sIdx[si] = k; this.sMesh[si] = this.meshes.length;
        const side = sim.sides[sim.units[sim.sunit[si]].side];
        c.set(side.color);
        const hsl = {}; c.getHSL(hsl);
        c.setHSL(hsl.h + (rng() - 0.5) * 0.02, Math.min(1, hsl.s * (0.85 + rng() * 0.25)), hsl.l * (0.82 + rng() * 0.3));
        team[k * 3] = c.r; team[k * 3 + 1] = c.g; team[k * 3 + 2] = c.b;
        vari[k * 3] = 0.78 + rng() * 0.36; vari[k * 3 + 1] = rng(); vari[k * 3 + 2] = rng();
        this.sScale[si] = 0.94 + rng() * 0.12;
      });
      this.meshes.push({ im, anim, animAttr, list });
      this.scene.add(im);
    }
  }

  updateSoldiers() {
    const sim = this.sim;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const ax = new THREE.Vector3(1, 0, 0), az = new THREE.Vector3(0, 0, 1), up = new THREE.Vector3(0, 1, 0);
    for (const m of this.meshes) {
      const arr = m.im.instanceMatrix.array, anim = m.anim;
      for (let k = 0; k < m.list.length; k++) {
        const i = m.list[k];
        const u = sim.units[sim.sunit[i]];
        const x = sim.sx[i], z = sim.sz[i];
        const y = sim.terrain.at(x, z);
        const sc = this.sScale[i];
        const o = k * 16;
        if (sim.salive[i] === 2) { arr[o + 13] = -9999; continue; }
        if (sim.salive[i] === 1) {
          const a = sim.sface[i], c = Math.cos(a) * sc, sn = Math.sin(a) * sc;
          arr[o] = c; arr[o + 1] = 0; arr[o + 2] = -sn; arr[o + 3] = 0;
          arr[o + 4] = 0; arr[o + 5] = sc; arr[o + 6] = 0; arr[o + 7] = 0;
          arr[o + 8] = sn; arr[o + 9] = 0; arr[o + 10] = c; arr[o + 11] = 0;
          arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
          const spd = sim.sspd[i];
          const ref = isCav(u.t) ? u.t.walk * 0.8 : u.t.walk * 0.7;
          anim[k * 4] = sim.sphase[i];
          anim[k * 4 + 1] = Math.min(1.25, spd / ref) * (spd > 0.15 ? 1 : 0);
          anim[k * 4 + 2] = Math.min(1, sim.satk[i] / (u.t.cls === 'elephant' ? 0.8 : 0.45));
          anim[k * 4 + 3] = u.ability && u.t.ability === 'testudo' ? 1 : 0;
        } else {
          const t = Math.min(1, sim.sdeadT[i] / (isCav(u.t) ? 0.9 : 0.55));
          const e = t * t;
          const rel = sim.sfall[i] - sim.sface[i];
          q.setFromAxisAngle(up, sim.sface[i]);
          if (isCav(u.t)) q2.setFromAxisAngle(az, (Math.sin(rel) > 0 ? -1 : 1) * e * Math.PI * 0.5);
          else q2.setFromAxisAngle(ax, (Math.cos(rel) > 0 ? 1 : -1) * e * Math.PI * 0.48);
          q.multiply(q2);
          p.set(x, y + (isCav(u.t) ? -0.35 * e : 0.02), z);
          m4.compose(p, q, s.set(sc, sc, sc));
          m4.toArray(arr, o);
          anim[k * 4 + 1] = 0; anim[k * 4 + 2] = 1; anim[k * 4 + 3] = 0;
        }
      }
      m.im.instanceMatrix.needsUpdate = true;
      m.animAttr.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------- missiles
  buildMissiles() {
    const arrow = mergeAll([new THREE.BoxGeometry(0.03, 0.03, 0.85), new THREE.ConeGeometry(0.03, 0.1, 4).rotateX(Math.PI / 2).translate(0, 0, 0.47), new THREE.BoxGeometry(0.1, 0.005, 0.12).translate(0, 0, -0.38)]);
    const jav = mergeAll([new THREE.CylinderGeometry(0.018, 0.018, 1.7, 4).rotateX(Math.PI / 2), new THREE.ConeGeometry(0.03, 0.18, 4).rotateX(Math.PI / 2).translate(0, 0, 0.92)]);
    const stone = new THREE.IcosahedronGeometry(0.06, 0);
    const wood = new THREE.MeshStandardMaterial({ color: '#6b5232', roughness: 0.8 });
    const mk = (g, n, mat = wood) => { const im = new THREE.InstancedMesh(g, mat, n); im.frustumCulled = false; im.count = 0; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.scene.add(im); return im; };
    this.flyArrow = mk(arrow, 2500); this.flyJav = mk(jav, 1200); this.flyStone = mk(stone, 1500, new THREE.MeshStandardMaterial({ color: '#8a8378' }));
    this.stuckArrow = mk(arrow, 1600); this.stuckJav = mk(jav, 800);
    this.stuckArrow.castShadow = this.stuckJav.castShadow = true;
    this.stuckCount = -1;
  }

  updateMissiles() {
    const sim = this.sim;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3(), z = new THREE.Vector3(0, 0, 1);
    let na = 0, nj = 0, ns = 0;
    for (let k = 0; k < sim.PM; k++) {
      if (!sim.pon[k] || sim.pdelay[k] > 0) continue;
      p.set(sim.px[k], sim.py[k], sim.pz[k]);
      v.set(sim.pvx[k], sim.pvy[k], sim.pvz[k]).normalize();
      q.setFromUnitVectors(z, v);
      m4.compose(p, q, s);
      const kind = sim.pkind[k];
      if (sim.pfire[k]) { this.spark(p.x, p.y, p.z, 'flame'); if (Math.random() < 0.5) this.spark(p.x, p.y, p.z, 'ember'); }
      if (kind === 0 && na < 2500) this.flyArrow.setMatrixAt(na++, m4);
      else if ((kind === 1 || kind === 3) && nj < 1200) this.flyJav.setMatrixAt(nj++, m4);
      else if (kind === 2 && ns < 1500) this.flyStone.setMatrixAt(ns++, m4);
    }
    this.flyArrow.count = na; this.flyJav.count = nj; this.flyStone.count = ns;
    this.flyArrow.instanceMatrix.needsUpdate = this.flyJav.instanceMatrix.needsUpdate = this.flyStone.instanceMatrix.needsUpdate = true;
    if (sim.stuck.length !== this.stuckCount || this.time % 1 < 0.02) {
      this.stuckCount = sim.stuck.length;
      let a = 0, j = 0;
      for (const st of sim.stuck) {
        v.set(st.dx, st.dy, st.dz);
        q.setFromUnitVectors(z, v);
        p.set(st.x, st.y, st.z).addScaledVector(v, st.kind === 0 ? 0.2 : 0.55);
        m4.compose(p, q, s);
        if (st.kind === 0 && a < 1600) this.stuckArrow.setMatrixAt(a++, m4);
        else if (j < 800) this.stuckJav.setMatrixAt(j++, m4);
      }
      this.stuckArrow.count = a; this.stuckJav.count = j;
      this.stuckArrow.instanceMatrix.needsUpdate = this.stuckJav.instanceMatrix.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------- particles
  buildParticles() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(cv);
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, vertexColors: false, fog: true, opacity: 1 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aAlpha; varying float vAlpha;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = aAlpha;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAlpha;').replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= vAlpha;');
    };
    const MAX = 3000;
    const im = new THREE.InstancedMesh(geo, mat, MAX);
    im.frustumCulled = false; im.count = 0;
    const alpha = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    geo.setAttribute('aAlpha', alpha);
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.scene.add(im);
    this.parts = { im, alpha, list: [], MAX };
    // additive glow: sparks, embers, fire
    const gmat = mat.clone();
    gmat.blending = THREE.AdditiveBlending; gmat.toneMapped = false; gmat.fog = false;
    gmat.onBeforeCompile = mat.onBeforeCompile;
    const ggeo = new THREE.PlaneGeometry(1, 1);
    const galpha = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    ggeo.setAttribute('aAlpha', galpha);
    const gim = new THREE.InstancedMesh(ggeo, gmat, MAX);
    gim.frustumCulled = false; gim.count = 0;
    gim.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.scene.add(gim);
    this.glow = { im: gim, alpha: galpha, list: [], MAX };
  }

  spark(x, y, z, kind = 'spark') {
    const P = this.glow;
    if (P.list.length >= P.MAX) return;
    const r = Math.random;
    if (kind === 'spark') P.list.push({ x, y, z, vx: (r() - 0.5) * 7, vy: 1.5 + r() * 4, vz: (r() - 0.5) * 7, t: 0, life: 0.25 + r() * 0.25, s0: 0.22, s1: 0.05, col: new THREE.Color(3.2, 2.4, 1.2), a: 1, g: 14 });
    else if (kind === 'ember') P.list.push({ x, y, z, vx: (r() - 0.5) * 0.6, vy: 0.4 + r() * 0.8, vz: (r() - 0.5) * 0.6, t: 0, life: 0.5 + r() * 0.5, s0: 0.35, s1: 0.1, col: new THREE.Color(3.0, 1.2, 0.3), a: 0.9, g: -1 });
    else if (kind === 'flame') P.list.push({ x, y, z, vx: 0, vy: 0, vz: 0, t: 0, life: 0.06, s0: 0.9, s1: 0.7, col: new THREE.Color(3.5, 1.6, 0.4), a: 1, g: 0 });
    else if (kind === 'flash') P.list.push({ x, y, z, vx: 0, vy: 0.5, vz: 0, t: 0, life: 0.5, s0: 2, s1: 9, col: new THREE.Color(2.4, 1.8, 0.9), a: 0.55, g: 0 });
  }

  puff(x, y, z, kind) {
    const P = this.parts;
    if (P.list.length >= P.MAX) return;
    const dust = kind === 'dust';
    P.list.push({
      x, y, z, vx: (Math.random() - 0.5) * (dust ? 1.2 : 2.5), vy: dust ? 0.4 + Math.random() * 0.5 : 1.5 + Math.random() * 1.5, vz: (Math.random() - 0.5) * (dust ? 1.2 : 2.5),
      t: 0, life: dust ? 2.2 + Math.random() * 1.5 : 0.6 + Math.random() * 0.3, s0: dust ? 1.2 + Math.random() * 1.2 : 0.25, s1: dust ? 4 + Math.random() * 2.5 : 0.6,
      col: dust ? new THREE.Color(this.B.dirt).lerp(new THREE.Color('#ffffff'), 0.25) : new THREE.Color('#7a0d0d'), a: dust ? 0.14 : 0.9, g: dust ? 0 : 9,
    });
  }

  updateParticles(dt) { this.updateSystem(this.parts, dt); this.updateSystem(this.glow, dt); }
  updateSystem(P, dt) {
    const m4 = new THREE.Matrix4(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const q = this.camera.quaternion;
    let n = 0;
    for (let i = P.list.length - 1; i >= 0; i--) {
      const o = P.list[i];
      o.t += dt;
      if (o.t > o.life) { P.list.splice(i, 1); continue; }
      o.vy -= o.g * dt; o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
      const k = o.t / o.life;
      const sz = o.s0 + (o.s1 - o.s0) * k;
      m4.compose(p.set(o.x, o.y, o.z), q, s.set(sz, sz, sz));
      P.im.setMatrixAt(n, m4);
      P.im.instanceColor.setXYZ(n, o.col.r, o.col.g, o.col.b);
      P.alpha.setX(n, o.a * (1 - k) * Math.min(1, o.t * 6));
      n++;
    }
    P.im.count = n;
    P.im.instanceMatrix.needsUpdate = true; P.im.instanceColor.needsUpdate = true; P.alpha.needsUpdate = true;
  }

  // ---------------------------------------------------------------- sky clouds
  buildClouds() {
    this.cloudU = { uTime: { value: 0 }, uSun: { value: this.sunDir } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.cloudU, transparent: true, depthWrite: false, fog: false,
      vertexShader: 'varying vec2 vP; void main(){ vP = (modelMatrix * vec4(position,1.0)).xz; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position,1.0); }',
      fragmentShader: `
        uniform float uTime; uniform vec3 uSun; varying vec2 vP;
        float h2(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }
        float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p *= 2.03; a *= 0.5; } return s; }
        void main(){
          vec2 q = vP * 0.0011 + vec2(uTime * 0.004, uTime * 0.0015);
          float c = smoothstep(0.48, 0.78, fbm(q));
          float r = length(vP) / 4200.0;
          float a = c * smoothstep(1.0, 0.55, r) * 0.85;
          vec3 col = mix(vec3(0.72, 0.75, 0.8), vec3(1.0, 0.97, 0.92), smoothstep(0.4, 0.9, fbm(q + 0.05)));
          gl_FragColor = vec4(col, a);
        }`,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), mat);
    m.rotation.x = Math.PI / 2; m.position.y = 650;
    this.scene.add(m);
  }

  // ---------------------------------------------------------------- standards: one bearer's banner per unit
  emblemTexture(color, culture, general) {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 192;
    const g = cv.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 192);
    const c = new THREE.Color(color);
    grd.addColorStop(0, `rgb(${c.r * 255 * 1.1},${c.g * 255 * 1.1},${c.b * 255 * 1.1})`); grd.addColorStop(1, `rgb(${c.r * 160},${c.g * 160},${c.b * 160})`);
    g.fillStyle = grd; g.fillRect(0, 0, 128, 192);
    g.strokeStyle = '#e8c35e'; g.lineWidth = 7; g.strokeRect(5, 5, 118, 182);
    // fringe
    g.fillStyle = '#e8c35e'; for (let x = 4; x < 128; x += 10) g.fillRect(x, 182, 5, 10);
    g.fillStyle = '#f3d98e'; g.strokeStyle = '#f3d98e'; g.lineWidth = 6;
    g.save(); g.translate(64, 92);
    if (culture === 'roman') {
      g.font = 'bold 34px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('SPQR', 0, general ? 24 : 0);
      if (general) { g.beginPath(); g.moveTo(-34, -22); g.quadraticCurveTo(0, -60, 34, -22); g.quadraticCurveTo(0, -38, -34, -22); g.fill(); }
      g.beginPath(); g.arc(0, 0, 50, 0.25, Math.PI - 0.25); g.stroke();
    } else if (culture === 'punic') {
      g.beginPath(); g.moveTo(0, -12); g.lineTo(-28, 48); g.lineTo(28, 48); g.closePath(); g.fill();
      g.beginPath(); g.arc(0, -30, 15, 0, Math.PI * 2); g.fill(); g.fillRect(-36, -14, 72, 8);
    } else if (['hellenic', 'seleucid', 'ptolemaic'].includes(culture)) {
      g.beginPath(); g.arc(0, 0, 13, 0, Math.PI * 2); g.fill();
      for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; g.beginPath(); g.moveTo(Math.cos(a) * 16, Math.sin(a) * 16); g.lineTo(Math.cos(a + 0.12) * 46, Math.sin(a + 0.12) * 46); g.lineTo(Math.cos(a - 0.12) * 46, Math.sin(a - 0.12) * 46); g.fill(); }
    } else if (['eastern', 'steppe'].includes(culture)) {
      g.beginPath(); g.arc(0, 0, 40, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(0, 0, 22, 0, Math.PI * 2); g.stroke();
      for (let k = 0; k < 4; k++) { g.rotate(Math.PI / 2); g.fillRect(-4, 24, 8, 26); }
    } else if (culture === 'african') {
      g.beginPath(); g.arc(0, 0, 42, 0.5, Math.PI * 2 - 0.5); g.arc(14, 0, 34, Math.PI * 2 - 0.62, 0.62, true); g.fill();
    } else {
      for (let k = 0; k < 3; k++) { g.rotate((Math.PI * 2) / 3); g.beginPath(); g.arc(0, -18, 18, Math.PI * 0.5, Math.PI * 2); g.stroke(); }
    }
    g.restore();
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }

  buildStandards() {
    const sim = this.sim;
    const wood = new THREE.MeshStandardMaterial({ color: '#5a4026', roughness: 0.8 });
    const gold = new THREE.MeshStandardMaterial({ color: '#d9ad45', metalness: 1, roughness: 0.3, envMap: this.envRT.texture, envMapIntensity: 0.6 });
    this.flagU = { uTime: { value: 0 } };
    const flagMats = new Map();
    const flagGeo = new THREE.PlaneGeometry(1.15, 1.6, 8, 10); flagGeo.translate(0, -0.8, 0);
    this.standards = [];
    for (const u of sim.units) {
      const side = sim.sides[u.side];
      const cul = side.culture || 'local';
      const key = u.side + (u.general ? 'g' : '');
      if (!flagMats.has(key)) {
        const tex = this.emblemTexture(side.color, cul, u.general);
        const m = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.75, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.32 });
        m.onBeforeCompile = (sh) => {
          sh.uniforms.uTime = this.flagU.uTime;
          sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', `#include <begin_vertex>
            float hang = -position.y / 1.6;
            float ph = modelMatrix[3].x * 0.7 + modelMatrix[3].z * 0.4;
            transformed.z += (sin(uTime * 3.2 + position.x * 3.0 + position.y * 2.2 + ph) * 0.16 + sin(uTime * 5.1 + position.y * 4.0 + ph) * 0.05) * (0.3 + hang);
            transformed.x += sin(uTime * 2.1 + ph) * 0.06 * hang;`);
        };
        flagMats.set(key, m);
      }
      const g = new THREE.Group();
      const H = u.general ? 5.6 : 4.6;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, H, 6), wood); pole.position.y = H / 2;
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 5), gold); bar.rotation.z = Math.PI / 2; bar.position.y = H - 0.35;
      const flag = new THREE.Mesh(flagGeo, flagMats.get(key)); flag.position.y = H - 0.38; flag.position.z = 0.02;
      g.add(pole, bar, flag);
      if (cul === 'roman') {
        if (u.general) {
          const body = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.38, 6), gold); body.position.y = H + 0.22;
          const wing = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.06, 0.14), gold); wing.position.y = H + 0.34; wing.rotation.z = 0.12;
          const wing2 = wing.clone(); wing2.rotation.z = -0.12; wing2.position.x = 0;
          const wreath = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 6, 16), gold); wreath.position.y = H + 0.05;
          g.add(body, wing, wing2, wreath);
        } else {
          for (let k = 0; k < 3; k++) { const d = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 12), gold); d.rotation.x = Math.PI / 2; d.position.y = H - 1.4 - k * 0.38; g.add(d); }
          const hand = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 6), gold); hand.position.y = H + 0.15; g.add(hand);
        }
      } else {
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.32, 6), gold); tip.position.y = H + 0.16; g.add(tip);
      }
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.scene.add(g);
      this.standards.push({ u, g, tilt: 0, y0: isCav(u.t) ? (u.t.cls === 'elephant' ? 3.6 : 1.4) : 0.4 });
    }
  }

  updateStandards(dt) {
    const sim = this.sim;
    this.flagU.uTime.value = this.time;
    for (const st of this.standards) {
      const u = st.u;
      if (u.slots.length === 0) { st.g.visible = false; continue; }
      st.g.visible = true;
      const f = sim.slotFrame(u);
      const k = Math.min(u.slots.length - 1, Math.floor(Math.min(f.cols, u.slots.length) / 2) + (f.rows > 1 ? f.cols : 0));
      const i = u.slots[k];
      const x = sim.sx[i], z = sim.sz[i];
      const a = sim.sface[i];
      const routing = u.mstate >= 2;
      st.tilt += ((routing ? 0.55 : 0) - st.tilt) * Math.min(1, dt * 3);
      st.g.position.set(x - Math.sin(a) * 0.25, sim.terrain.at(x, z) + st.y0 + Math.abs(Math.sin(sim.sphase[i])) * 0.08, z - Math.cos(a) * 0.25);
      st.g.rotation.set(-st.tilt, a, 0, 'YXZ');
    }
  }

  // ---------------------------------------------------------------- ground scars: trampled mud and blood
  buildDecals() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 768;
    this.decalCtx = cv.getContext('2d');
    this.decalTex = new THREE.CanvasTexture(cv);
    this.decalTex.colorSpace = THREE.SRGBColorSpace;
    this.decalU.value = this.decalTex;
    this.decalT = 0;
    this.decalScale = 768 / (2 * (FIELD + 60));
    this.bloodQueue = [];
    const B = new THREE.Color(this.B.dirt).multiplyScalar(0.62);
    this.mudStyle = `rgba(${(B.r * 255) | 0},${(B.g * 255) | 0},${(B.b * 255) | 0},`;
  }
  blood(x, z) { this.bloodQueue.push(x, z); }
  updateDecals(dt) {
    this.decalT -= dt;
    if (this.decalT > 0) return;
    this.decalT = 0.6;
    const sim = this.sim, g = this.decalCtx, S = this.decalScale, O = FIELD + 60;
    let drew = false;
    for (let n = 0; n < 700; n++) {
      const i = Math.floor(Math.random() * sim.N);
      if (sim.salive[i] !== 1 || sim.sspd[i] < 0.6) continue;
      const u = sim.units[sim.sunit[i]];
      const heavy = isCav(u.t) ? 2.2 : 1;
      g.fillStyle = this.mudStyle + (0.032 * heavy) + ')';
      g.beginPath(); g.arc((sim.sx[i] + O) * S, (sim.sz[i] + O) * S, 0.75 * heavy, 0, 6.283); g.fill();
      drew = true;
    }
    for (let k = 0; k < this.bloodQueue.length; k += 2) {
      const x = (this.bloodQueue[k] + O) * S, y = (this.bloodQueue[k + 1] + O) * S;
      g.fillStyle = `rgba(${70 + Math.random() * 30},${8 + Math.random() * 8},6,${0.25 + Math.random() * 0.25})`;
      for (let j = 0; j < 3; j++) { g.beginPath(); g.arc(x + (Math.random() - 0.5) * 2.5, y + (Math.random() - 0.5) * 2.5, 0.5 + Math.random() * 1.3, 0, 6.283); g.fill(); }
      drew = true;
    }
    this.bloodQueue.length = 0;
    if (drew) this.decalTex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- order arrows on the ground
  orderArrow(x0, z0, x1, z1, color = '#ffe08a') {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 6) return;
    const shape = new THREE.Shape();
    const w = 1.1, hw = 2.8, hl = Math.min(6, len * 0.35);
    shape.moveTo(-w, 0); shape.lineTo(w, 0); shape.lineTo(w, len - hl); shape.lineTo(hw, len - hl); shape.lineTo(0, len); shape.lineTo(-hw, len - hl); shape.lineTo(-w, len - hl); shape.closePath();
    const geo = new THREE.ShapeGeometry(shape, 1);
    // drape over the ground
    const ang = Math.atan2(x1 - x0, z1 - z0);
    const pos = geo.attributes.position;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i), ly = pos.getY(i);
      const wx = x0 + sa * ly + ca * lx, wz = z0 + ca * ly - sa * lx;
      pos.setXYZ(i, wx, this.sim.terrain.at(wx, wz) + 0.35, wz);
    }
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    m.renderOrder = 5;
    this.scene.add(m);
    this.arrows.push({ m, t: 0 });
  }
  updateArrows(dt) {
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i]; a.t += dt;
      a.m.material.opacity = 0.55 * Math.max(0, 1 - a.t / 1.8);
      if (a.t > 1.8) { this.scene.remove(a.m); a.m.geometry.dispose(); a.m.material.dispose(); this.arrows.splice(i, 1); }
    }
  }
  shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a); }

  // ---------------------------------------------------------------- deployment zone outline
  buildZone() {
    const z = this.sim.zoneOf(this.playerSide);
    const x0 = z.xMin - 120, x1 = z.xMax + 120;
    const pts = [];
    const edge = (ax, az, bx, bz) => { for (let k = 0; k <= 60; k++) { const t = k / 60, x = ax + (bx - ax) * t, zz = az + (bz - az) * t; pts.push(new THREE.Vector3(x, this.sim.terrain.at(x, zz) + 0.4, zz)); } };
    edge(x0, z.zMin, x1, z.zMin); edge(x1, z.zMin, x1, z.zMax); edge(x1, z.zMax, x0, z.zMax); edge(x0, z.zMax, x0, z.zMin);
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    this.zone = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#ffe08a', transparent: true, opacity: 0.8, toneMapped: false }));
    this.scene.add(this.zone);
  }
  hideZone() { if (this.zone) { this.scene.remove(this.zone); this.zone.geometry.dispose(); this.zone = null; } }

  // ---------------------------------------------------------------- selection + order markers
  buildMarkers() {
    const ring = new THREE.RingGeometry(0.35, 0.55, 16); ring.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false });
    this.selRings = new THREE.InstancedMesh(ring, mat, this.sim.N);
    this.selRings.frustumCulled = false; this.selRings.count = 0;
    this.selRings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.sim.N * 3), 3);
    this.scene.add(this.selRings);
    const g = new THREE.PlaneGeometry(0.7, 0.9); g.rotateX(-Math.PI / 2);
    this.ghost = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }), 4000);
    this.ghost.frustumCulled = false; this.ghost.count = 0;
    this.scene.add(this.ghost);
    this.ghostFade = 0;
  }

  updateSelection(selected, hovered) {
    const sim = this.sim;
    const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    let n = 0;
    const gold = new THREE.Color('#ffd25a'), white = new THREE.Color('#ffffff'), red = new THREE.Color('#ff6a50');
    for (const u of sim.units) {
      const sel = selected.has(u.id), hov = hovered === u.id;
      if (!sel && !hov) continue;
      const col = sel ? gold : u.side === this.playerSide ? white : red;
      const sc = isCav(u.t) ? (u.t.cls === 'elephant' ? 5 : 2.2) : 1;
      for (const i of u.slots) {
        p.set(sim.sx[i], sim.terrain.at(sim.sx[i], sim.sz[i]) + 0.08, sim.sz[i]);
        m4.compose(p, q, s.set(sc, 1, sc));
        this.selRings.setMatrixAt(n, m4);
        this.selRings.instanceColor.setXYZ(n, col.r, col.g, col.b);
        n++;
      }
    }
    this.selRings.count = n;
    this.selRings.instanceMatrix.needsUpdate = true; this.selRings.instanceColor.needsUpdate = true;
  }

  // ghost slots for a planned formation: [{x,z,face,unit,cols}]
  showGhost(plans) {
    const sim = this.sim;
    const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    let n = 0;
    for (const pl of plans) {
      const u = sim.units[pl.unit];
      const fake = { ...u, ax: pl.x, az: pl.z, fx: pl.face, cols: pl.cols ?? u.cols, slots: u.slots };
      const f = sim.slotFrame(fake);
      q.setFromAxisAngle(up, pl.face);
      const sc = isCav(u.t) ? (u.t.cls === 'elephant' ? 4 : 2) : 1;
      s.set(sc, 1, sc);
      for (let k = 0; k < u.slots.length && n < 4000; k++) {
        const sp = sim.slotPos(fake, f, k, u.slots[k]);
        p.set(sp[0], sim.terrain.at(sp[0], sp[1]) + 0.1, sp[1]);
        m4.compose(p, q, s); this.ghost.setMatrixAt(n++, m4);
      }
    }
    this.ghost.count = n; this.ghost.instanceMatrix.needsUpdate = true;
    this.ghost.material.opacity = 0.55; this.ghostFade = 0;
  }
  fadeGhost() { this.ghostFade = 1; }

  // ---------------------------------------------------------------- camera
  updateCamera(dt) {
    const c = this.cam;
    const k = 1 - Math.exp(-dt * 7);
    const lim = FIELD + 80;
    c.tx = Math.max(-lim, Math.min(lim, c.tx)); c.tz = Math.max(-lim, Math.min(lim, c.tz));
    c.tdist = Math.max(8, Math.min(420, c.tdist));
    c.tpitch = Math.max(0.12, Math.min(1.35, c.tpitch));
    c.x += (c.tx - c.x) * k; c.z += (c.tz - c.z) * k; c.dist += (c.tdist - c.dist) * k; c.yaw += (c.tyaw - c.yaw) * k; c.pitch += (c.tpitch - c.pitch) * k;
    const gy = this.sim.terrain.at(c.x, c.z);
    const cp = Math.cos(c.pitch);
    let px = c.x + Math.sin(c.yaw) * cp * c.dist, pz = c.z + Math.cos(c.yaw) * cp * c.dist, py = gy + Math.sin(c.pitch) * c.dist + 1.5;
    py = Math.max(py, this.sim.terrain.at(px, pz) + 3);
    this.camera.position.set(px, py, pz);
    this.camera.lookAt(c.x, gy + 1.5, c.z);
    if (this.shakeAmt > 0.01) {
      const a = this.shakeAmt * Math.min(1.5, c.dist / 60);
      this.camera.position.x += (Math.random() - 0.5) * a; this.camera.position.y += (Math.random() - 0.5) * a; this.camera.position.z += (Math.random() - 0.5) * a;
      this.shakeAmt *= Math.exp(-dt * 6);
    }
    const span = Math.min(260, 40 + c.dist * 1.2);
    this.sun.position.set(c.x + this.sunDir.x * 400, this.sunDir.y * 400, c.z + this.sunDir.z * 400);
    this.sun.target.position.set(c.x, gy, c.z);
    const sc = this.sun.shadow.camera;
    if (Math.abs(sc.right - span) > 1) { sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.near = 50; sc.far = 1000; sc.updateProjectionMatrix(); }
  }
  // dx: screen-right metres, dz: screen-forward metres
  pan(dx, dz) {
    const c = this.cam, s = Math.sin(c.yaw), co = Math.cos(c.yaw);
    c.tx += co * dx - s * dz;
    c.tz += -s * dx - co * dz;
  }
  forward() { return { x: -Math.sin(this.cam.yaw), z: -Math.cos(this.cam.yaw) }; }

  rayGround(cx, cy) {
    const ndc = new THREE.Vector2((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, this.camera);
    const o = rc.ray.origin, d = rc.ray.direction;
    let prev = 0;
    for (let t = 0; t < 3000; t += Math.max(0.5, t * 0.01)) {
      const x = o.x + d.x * t, z = o.z + d.z * t, y = o.y + d.y * t;
      if (y <= this.sim.terrain.at(x, z)) {
        let a = prev, b = t;
        for (let i = 0; i < 12; i++) { const m = (a + b) / 2; if (o.y + d.y * m <= this.sim.terrain.at(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m; }
        return { x: o.x + d.x * b, z: o.z + d.z * b };
      }
      prev = t;
    }
    return null;
  }

  // the unit whose soldier is nearest the cursor's ground point (or whose banner is under it)
  unitAt(cx, cy) {
    const g = this.rayGround(cx, cy);
    const sim = this.sim;
    let best = -1, bd = 1e9;
    if (g) {
      for (let i = 0; i < sim.N; i++) {
        if (sim.salive[i] !== 1) continue;
        const u = sim.units[sim.sunit[i]];
        const r = isCav(u.t) ? (u.t.cls === 'elephant' ? 4 : 2.2) : 1.4;
        const d = (sim.sx[i] - g.x) ** 2 + (sim.sz[i] - g.z) ** 2;
        if (d < r * r * 2.5 && d < bd) { bd = d; best = u.id; }
      }
    }
    return { unit: best, ground: g };
  }

  screenOf(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, vis: v.z < 1 && v.z > -1 };
  }

  // ---------------------------------------------------------------- frame
  resize() {
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    this.composer.setSize(innerWidth, innerHeight);
  }

  render(dt, selected, hovered) {
    this.time += dt;
    this.windU.value = this.time;
    this.updateCamera(dt);
    this.updateSoldiers();
    this.updateMissiles();
    this.updateParticles(dt);
    this.updateSelection(selected, hovered);
    this.updateStandards(dt);
    this.updateDecals(dt);
    this.updateArrows(dt);
    if (this.cloudU) this.cloudU.uTime.value = this.time;
    if (this.ghostFade > 0) { this.ghost.material.opacity -= dt * 0.5; if (this.ghost.material.opacity <= 0) { this.ghost.count = 0; this.ghostFade = 0; } }
    // dust behind fast movers
    const sim = this.sim;
    for (let n = 0; n < 40; n++) {
      const i = Math.floor(Math.random() * sim.N);
      if (sim.salive[i] !== 1) continue;
      const u = sim.units[sim.sunit[i]];
      const fast = sim.sspd[i] > (isCav(u.t) ? 3 : 2.6);
      if (fast && this.sim.terrain.biome !== 'boreal') this.puff(sim.sx[i], sim.terrain.at(sim.sx[i], sim.sz[i]) + 0.4, sim.sz[i], 'dust');
    }
    this.composer.render(dt);
  }
}

function mergeAll(geos) {
  const list = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const hasColor = list.some((g) => g.attributes.color);
  let count = 0; for (const g of list) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = hasColor ? new Float32Array(count * 3) : null;
  let o = 0;
  for (const g of list) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    if (col) { if (g.attributes.color) col.set(g.attributes.color.array, o * 3); else col.fill(1, o * 3, (o + g.attributes.position.count) * 3); }
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
