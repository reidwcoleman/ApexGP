// Three.js campaign map: painted relief terrain with live province borders,
// shader water, cities, landmarks, forests, clouds and army standards.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WORLD_W, WORLD_H, GW, GH, HW, HH, sampleHeight, worldToLonLat, lonLatToGrid, toWorld } from '../map/geo.js';
import { FACTIONS, FACTION_IDS } from '../data/factions.js';
import { LANDMARKS } from '../data/cities.js';
import { createComposer } from '../engine/renderer.js';
import { mulberry32 } from '../util/noise.js';

const MIST = new THREE.Color('#b9c2c4');

export class CampaignView {
  constructor(renderer, world, labelsEl) {
    this.renderer = renderer;
    this.world = world;
    this.labelsEl = labelsEl;
    this.scene = new THREE.Scene();
    this.scene.background = MIST.clone();
    this.scene.fog = new THREE.Fog(MIST.clone(), 30, 120);
    this.camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 400);
    this.cam = { x: 0, z: 0, dist: 14, yaw: 0, tx: 0, tz: 0, tdist: 14, tyaw: 0 };
    this.time = 0;
    this.armyObjs = new Map();
    this.flags = new Uint8Array(256 * 4);
    this.hoverProv = -1;
    this.selProv = -1;
    this.reach = new Set();
    this.attackable = new Set();
    this.buildLights();
    this.buildTerrain();
    this.buildWater();
    this.buildTrees();
    this.buildCities();
    this.buildLandmarks();
    this.buildClouds();
    this.buildLabels();
    this.pathLine = null;
    this.fx = [];
    this.composer = createComposer(renderer, this.scene, this.camera, { aoRadius: 0.25, aoIntensity: 1.6, aoFalloff: 0.4, bloom: 0.35, vignette: 0.55 });
    this.resize();
  }

  // ---------------------------------------------------------------- lights
  buildLights() {
    const hemi = new THREE.HemisphereLight('#cfe0ff', '#6a5a40', 1.05);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff0d2', 2.8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.sun = sun;
    this.sunDir = new THREE.Vector3(-0.55, 0.75, 0.38).normalize();
    this.scene.add(sun, sun.target);
  }

  // ---------------------------------------------------------------- terrain
  buildTerrain() {
    const { heights, colorCanvas, own } = this.world;
    const geo = new THREE.PlaneGeometry(WORLD_W, WORLD_H, HW - 1, HH - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, Math.max(heights[i], -0.32));
    geo.computeVertexNormals();
    const map = new THREE.CanvasTexture(colorCanvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    map.generateMipmaps = true;
    map.minFilter = THREE.LinearMipmapLinearFilter;

    // province id (+ the province across the nearest border) and a smooth border-distance field,
    // rows south-first so v matches the plane's uv
    const { bdist, other } = this.world;
    const idData = new Uint8Array(GW * GH * 2), dData = new Uint8Array(GW * GH);
    for (let y = 0; y < GH; y++) {
      const src = y * GW, dst = (GH - 1 - y) * GW;
      for (let x = 0; x < GW; x++) {
        idData[(dst + x) * 2] = own[src + x] + 1; idData[(dst + x) * 2 + 1] = other[src + x];
        dData[dst + x] = Math.min(255, Math.round(bdist[src + x] * 28));
      }
    }
    const idTex = new THREE.DataTexture(idData, GW, GH, THREE.RGFormat, THREE.UnsignedByteType);
    idTex.magFilter = THREE.NearestFilter; idTex.minFilter = THREE.NearestFilter; idTex.needsUpdate = true;
    const dTex = new THREE.DataTexture(dData, GW, GH, THREE.RedFormat, THREE.UnsignedByteType);
    dTex.magFilter = THREE.LinearFilter; dTex.minFilter = THREE.LinearFilter; dTex.needsUpdate = true;
    // palette: row 0 = owner colour (a = tint), row 1 = flags (r owner index, g selected, b reach, a attack)
    this.palData = new Uint8Array(256 * 2 * 4);
    this.palTex = new THREE.DataTexture(this.palData, 256, 2, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.palTex.magFilter = THREE.NearestFilter; this.palTex.minFilter = THREE.NearestFilter; this.palTex.needsUpdate = true;

    const uniforms = { uProv: { value: idTex }, uDist: { value: dTex }, uPal: { value: this.palTex }, uProvSize: { value: new THREE.Vector2(GW, GH) }, uTime: { value: 0 }, uMist: { value: MIST }, uHover: { value: -1 } };
    this.terrainUniforms = uniforms;
    const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.93, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2D uProv; uniform sampler2D uDist; uniform sampler2D uPal; uniform vec2 uProvSize; uniform float uTime; uniform vec3 uMist; uniform float uHover;
varying vec3 vWPos;
float pid(vec2 uv){ return floor(texture2D(uProv, uv).r * 255.0 + 0.5); }
vec4 palC(float id){ return texture2D(uPal, vec2((id - 0.5) / 256.0, 0.25)); }
vec4 palF(float id){ return texture2D(uPal, vec2((id - 0.5) / 256.0, 0.75)); }
`)
        .replace('#include <map_fragment>', `#include <map_fragment>
{
  vec2 uv = vMapUv;
  float c = pid(uv);
  if (c > 0.5) {
    vec4 pc = palC(c); vec4 pf = palF(c);
    float o = floor(texture2D(uProv, uv).g * 255.0 + 0.5);
    float d = texture2D(uDist, uv).r * 255.0 / 28.0; // texels to the nearest border
    float px = fwidth(uv.x) * uProvSize.x;           // texels per screen pixel
    float aa = max(px, 0.35);
    float facAcross = (o < 0.5 || abs(palF(o).r - pf.r) > 0.001) ? 1.0 : 0.0;
    float provLine = 1.0 - smoothstep(0.55, 0.55 + aa * 1.2, d);
    float band = facAcross * (1.0 - smoothstep(1.2, 1.2 + max(1.6, aa * 3.0), d));
    float edge = facAcross * (1.0 - smoothstep(0.5, 0.5 + aa * 1.5, d));
    vec3 col = diffuseColor.rgb;
    col = mix(col, pc.rgb, 0.24 * pc.a);
    float pulse = 0.5 + 0.5 * sin(uTime * 3.0);
    if (pf.b > 0.5) col = mix(col, vec3(1.0, 0.97, 0.85), 0.07 + 0.04 * pulse);
    if (pf.a > 0.5) col = mix(col, vec3(0.95, 0.12, 0.06), 0.25 + 0.17 * pulse);
    if (abs(c - uHover) < 0.5) col = mix(col, vec3(1.0, 0.95, 0.75), 0.13);
    if (pf.g > 0.5) col = mix(col, vec3(1.0, 0.9, 0.55), 0.18);
    col = mix(col, col * 0.5, provLine * 0.6 * (1.0 - facAcross));
    col = mix(col, pc.rgb * 1.1, band * 0.7 * pc.a);
    col = mix(col, pc.rgb * 0.55, edge * 0.85 * pc.a);
    if (pf.g > 0.5) col = mix(col, vec3(1.0, 0.86, 0.4), (1.0 - smoothstep(0.5, 0.5 + aa * 2.5, d)) * 0.95);
    diffuseColor.rgb = col;
  }
  // fine detail so the painted map holds up close
  {
    vec2 q = vWPos.xz;
    float h1 = fract(sin(dot(floor(q * 60.0), vec2(12.9898, 78.233))) * 43758.5453);
    float n1 = sin(q.x * 37.0 + sin(q.y * 23.0)) * sin(q.y * 41.0 + sin(q.x * 19.0));
    diffuseColor.rgb *= 0.93 + 0.07 * n1 + 0.04 * (h1 - 0.5);
  }
  // the edge of the known world fades into mist
  float ed = min(min(uv.x, 1.0 - uv.x) * 1.4, min(uv.y, 1.0 - uv.y));
  diffuseColor.rgb = mix(uMist * 0.9, diffuseColor.rgb, smoothstep(0.0, 0.05, ed));
}`);
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.terrain = mesh;
    this.scene.add(mesh);
  }

  // ---------------------------------------------------------------- water
  buildWater() {
    const { heights } = this.world;
    const d = new Uint8Array(HW * HH);
    for (let y = 0; y < HH; y++) for (let x = 0; x < HW; x++) {
      const h = heights[y * HW + x];
      d[(HH - 1 - y) * HW + x] = Math.max(0, Math.min(255, Math.round(((h + 0.32) / 0.4) * 255)));
    }
    const ht = new THREE.DataTexture(d, HW, HH, THREE.RedFormat, THREE.UnsignedByteType);
    ht.magFilter = THREE.LinearFilter; ht.minFilter = THREE.LinearFilter; ht.needsUpdate = true;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uH: { value: null }, uTime: { value: 0 }, uSun: { value: this.sunDir }, uMist: { value: MIST }, uWorld: { value: new THREE.Vector2(WORLD_W, WORLD_H) },
    }]);
    uniforms.uH.value = ht;
    const mat = new THREE.ShaderMaterial({
      uniforms, fog: true,
      vertexShader: `
        #include <fog_pars_vertex>
        varying vec2 vUv; varying vec3 vW;
        void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: `
        #include <common>
        #include <fog_pars_fragment>
        uniform sampler2D uH; uniform float uTime; uniform vec3 uSun; uniform vec3 uMist; uniform vec2 uWorld;
        varying vec2 vUv; varying vec3 vW;
        float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hsh(i),hsh(i+vec2(1,0)),f.x), mix(hsh(i+vec2(0,1)),hsh(i+vec2(1,1)),f.x), f.y); }
        float wave(vec2 p){ return vn(p + uTime*vec2(0.35,0.2)) * 0.5 + vn(p*2.3 - uTime*vec2(0.25,0.4)) * 0.3 + vn(p*5.1 + uTime*vec2(0.5,-0.3))*0.2; }
        void main(){
          vec2 huv = (vW.xz + uWorld*0.5) / uWorld; huv.y = 1.0 - huv.y;
          bool inside = huv.x > 0.0 && huv.x < 1.0 && huv.y > 0.0 && huv.y < 1.0;
          float h = inside ? texture2D(uH, huv).r * 0.4 - 0.32 : -0.32;
          float depth = clamp(-h, 0.0, 0.4);
          vec3 shallow = vec3(0.14, 0.44, 0.47), mid = vec3(0.05, 0.25, 0.36), deep = vec3(0.025, 0.11, 0.22);
          vec3 col = mix(shallow, mid, smoothstep(0.0, 0.07, depth));
          col = mix(col, deep, smoothstep(0.07, 0.3, depth));
          vec2 p = vW.xz * 9.0;
          float e = 0.02;
          float w0 = wave(p), wx = wave(p + vec2(e*9.0, 0.0)), wz = wave(p + vec2(0.0, e*9.0));
          vec3 n = normalize(vec3((w0 - wx) * 1.6, 1.0, (w0 - wz) * 1.6));
          vec3 v = normalize(cameraPosition - vW);
          float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
          col = mix(col, vec3(0.55, 0.66, 0.72), fres * 0.5);
          vec3 hv = normalize(uSun + v);
          float spec = pow(max(dot(n, hv), 0.0), 180.0);
          col += vec3(1.0, 0.93, 0.78) * spec * 1.4;
          float foamBand = smoothstep(0.022, 0.0, depth);
          float foam = foamBand * smoothstep(0.35, 0.75, vn(vW.xz * 60.0 + uTime * 0.6) * 0.6 + foamBand * 0.6);
          col = mix(col, vec3(0.92, 0.95, 0.93), foam * 0.75);
          col = mix(col, shallow * 1.25, smoothstep(0.012, 0.0, depth) * 0.4);
          vec2 uv = huv;
          float ed = inside ? min(min(uv.x, 1.0 - uv.x) * 1.4, min(uv.y, 1.0 - uv.y)) : 0.0;
          col = mix(uMist * 0.9, col, smoothstep(0.0, 0.05, ed));
          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
        }`,
    });
    const geo = new THREE.PlaneGeometry(WORLD_W * 3, WORLD_H * 3, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(geo, mat);
    water.position.y = 0.0;
    water.receiveShadow = false;
    this.water = water;
    this.waterUniforms = uniforms;
    this.scene.add(water);
  }

  heightAt(x, z) {
    const { lon, lat } = worldToLonLat(x, z);
    return sampleHeight(this.world.heights, lon, lat);
  }

  // ---------------------------------------------------------------- forests
  buildTrees() {
    const { forest } = this.world;
    const rng = mulberry32(99);
    const cone = new THREE.ConeGeometry(0.018, 0.06, 6); cone.translate(0, 0.045, 0);
    const cone2 = new THREE.ConeGeometry(0.014, 0.045, 6); cone2.translate(0, 0.075, 0);
    const trunk = new THREE.CylinderGeometry(0.003, 0.004, 0.02, 4); trunk.translate(0, 0.01, 0);
    const tint = (g0, c) => { const g = g0.index ? g0.toNonIndexed() : g0; const col = new THREE.Color(c); const a = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < a.length; i += 3) { a[i] = col.r; a[i + 1] = col.g; a[i + 2] = col.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
    const pine = mergeGeometries([tint(cone, '#2f5226'), tint(cone2, '#3a6330'), tint(trunk, '#4a3622')]);
    const round = new THREE.IcosahedronGeometry(0.022, 0); round.translate(0, 0.04, 0);
    const oak = mergeGeometries([tint(round, '#46702f'), tint(trunk.clone(), '#4a3622')]);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    const M = 16000;
    const pines = new THREE.InstancedMesh(pine, mat, M), oaks = new THREE.InstancedMesh(oak, mat, M);
    let np = 0, no = 0;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    for (let tries = 0; tries < 260000 && (np < M || no < M); tries++) {
      const gx = Math.floor(rng() * GW), gy = Math.floor(rng() * GH);
      if (!forest[gy * GW + gx]) continue;
      const lon = -12 + (gx + rng()) / GW * 88, lat = 62 - (gy + rng()) / GH * 49;
      const w = toWorld(lon, lat);
      const h = this.heightAt(w.x, w.z);
      if (h < 0.01) continue;
      p.set(w.x, h - 0.004, w.z);
      q.setFromAxisAngle(up, rng() * 6.28);
      const sc = 0.7 + rng() * 0.7;
      s.set(sc, sc * (0.8 + rng() * 0.5), sc);
      m4.compose(p, q, s);
      col.setHSL(0.27 + rng() * 0.06, 0.4, 0.75 + rng() * 0.3);
      if (lat > 48 || rng() < 0.4) { if (np < M) { pines.setMatrixAt(np, m4); pines.setColorAt(np, col); np++; } }
      else if (no < M) { oaks.setMatrixAt(no, m4); oaks.setColorAt(no, col); no++; }
    }
    pines.count = np; oaks.count = no;
    for (const t of [pines, oaks]) { t.castShadow = true; t.receiveShadow = true; t.instanceMatrix.needsUpdate = true; if (t.instanceColor) t.instanceColor.needsUpdate = true; this.scene.add(t); }
    this.trees = [pines, oaks];
  }

  // ---------------------------------------------------------------- cities
  buildCities() {
    const rng = mulberry32(7);
    const provs = this.world.provinces;
    const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
    const pyr = new THREE.ConeGeometry(0.75, 0.5, 4, 1); pyr.rotateY(Math.PI / 4); pyr.translate(0, 0.25, 0);
    const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 8); cyl.translate(0, 0.5, 0);
    const cone = new THREE.ConeGeometry(0.62, 0.7, 8); cone.translate(0, 0.35, 0);
    const std = (c, r = 0.85) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
    const parts = {
      wall: new THREE.InstancedMesh(box, std('#ebe0c8'), 4000),
      roof: new THREE.InstancedMesh(pyr, std('#b2532e', 0.75), 4000),
      hut: new THREE.InstancedMesh(cyl, std('#8a6c48'), 3000),
      thatch: new THREE.InstancedMesh(cone, std('#b39a5a'), 3000),
      mud: new THREE.InstancedMesh(box, std('#d2b083'), 3000),
      stone: new THREE.InstancedMesh(box, std('#cdc4b2'), 3000),
      col: new THREE.InstancedMesh(cyl, std('#f2ede2', 0.6), 6000),
      palisade: new THREE.InstancedMesh(cyl, std('#6b4d2e'), 6000),
    };
    for (const k in parts) { parts[k].count = 0; parts[k].castShadow = true; parts[k].receiveShadow = true; }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const add = (k, x, y, z, sx, sy, sz, rot = 0) => {
      const im = parts[k]; if (im.count >= im.instanceMatrix.count) return;
      q.setFromAxisAngle(up, rot); p.set(x, y, z); s.set(sx, sy, sz); m4.compose(p, q, s); im.setMatrixAt(im.count++, m4);
    };
    this.cityPos = [];
    for (const pr of provs) {
      const cx = pr.x, cz = pr.z;
      const cy = Math.max(this.heightAt(cx, cz), 0.004);
      this.cityPos.push(new THREE.Vector3(cx, cy, cz));
      const big = Math.min(1, pr.pop / 40000);
      const n = 5 + Math.round(big * 14);
      const style = { roman: 'med', hellenic: 'med', punic: 'med', ptolemaic: 'east', seleucid: 'east', eastern: 'east', african: 'east', local: pr.lat > 44 ? 'hut' : 'med', steppe: 'hut' }[pr.culture] || 'hut';
      const R = 0.06 + big * 0.07;
      const H = (x, z) => Math.max(this.heightAt(x, z), cy - 0.01);
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * R;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, y = H(x, z) - 0.002;
        const w = 0.016 + rng() * 0.012, d = 0.016 + rng() * 0.014, hh = 0.013 + rng() * 0.01, rot = rng() * 3.14;
        if (style === 'med') { add('wall', x, y, z, w, hh, d, rot); add('roof', x, y + hh, z, w * 1.05, 0.02, d * 1.05, rot); }
        else if (style === 'east') { add('mud', x, y, z, w, hh * 0.9, d, rot); if (rng() < 0.3) add('mud', x, y + hh * 0.9, z, w * 0.5, hh * 0.6, d * 0.5, rot); }
        else { const hs = 0.012 + rng() * 0.006; add('hut', x, y, z, hs, 0.01, hs); add('thatch', x, y + 0.01, z, hs, 0.014, hs); }
      }
      // capital/large city monument
      if (pr.pop >= 14000) {
        const y = cy;
        if (style === 'med') {
          add('stone', cx, y, cz, 0.05, 0.006, 0.032);
          for (let i = 0; i < 6; i++) for (const sz of [-1, 1]) add('col', cx - 0.02 + i * 0.008, y + 0.006, cz + sz * 0.012, 0.004, 0.02, 0.004);
          add('stone', cx, y + 0.026, cz, 0.05, 0.005, 0.032);
          add('roof', cx, y + 0.031, cz, 0.034, 0.012, 0.022, 0);
        } else if (style === 'east') {
          add('mud', cx, y, cz, 0.05, 0.012, 0.05); add('mud', cx, y + 0.012, cz, 0.036, 0.012, 0.036); add('mud', cx, y + 0.024, cz, 0.022, 0.012, 0.022);
        } else {
          add('hut', cx, y, cz, 0.03, 0.018, 0.03); add('thatch', cx, y + 0.018, cz, 0.03, 0.03, 0.03);
        }
      }
    }
    for (const k in parts) { parts[k].instanceMatrix.needsUpdate = true; this.scene.add(parts[k]); }
    this.cityParts = parts;
    this.wallGroup = new THREE.Group();
    this.scene.add(this.wallGroup);

    // owner flags at every city
    const pole = new THREE.CylinderGeometry(0.0016, 0.0016, 0.09, 4); pole.translate(0, 0.045, 0);
    const flag = new THREE.PlaneGeometry(0.04, 0.026, 6, 1); flag.translate(0.02, 0.075, 0);
    this.flagUniforms = { uTime: { value: 0 } };
    const fmat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.7 });
    fmat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.flagUniforms.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', `#include <begin_vertex>
        float fx = clamp(position.x / 0.04, 0.0, 1.0);
        float ph = instanceMatrix[3].x * 40.0 + instanceMatrix[3].z * 31.0;
        transformed.z += sin(uTime * 5.0 + position.x * 120.0 + ph) * 0.006 * fx;
        transformed.y += cos(uTime * 4.0 + position.x * 90.0 + ph) * 0.002 * fx;`);
    };
    this.flagMesh = new THREE.InstancedMesh(flag, fmat, provs.length);
    this.poleMesh = new THREE.InstancedMesh(pole, std('#5a4630'), provs.length);
    provs.forEach((pr, i) => {
      const c = this.cityPos[i];
      m4.compose(p.set(c.x + 0.03, c.y, c.z + 0.03), q.identity(), s.set(1, 1, 1));
      this.flagMesh.setMatrixAt(i, m4); this.poleMesh.setMatrixAt(i, m4);
      this.flagMesh.setColorAt(i, new THREE.Color('#888'));
    });
    this.flagMesh.castShadow = this.poleMesh.castShadow = true;
    this.scene.add(this.flagMesh, this.poleMesh);
  }

  // stone walls / palisades per province (rebuilt when walls change)
  rebuildWalls(state) {
    this.wallGroup.clear();
    const seg = new THREE.BoxGeometry(1, 1, 1); seg.translate(0, 0.5, 0);
    const stone = new THREE.MeshStandardMaterial({ color: '#cbbfa8', roughness: 0.9 });
    const wood = new THREE.MeshStandardMaterial({ color: '#6b4d2e', roughness: 0.9 });
    const list = [];
    this.world.provinces.forEach((pr, i) => { const w = state.provs[i].bld.walls; if (w > 0) list.push([pr, w]); });
    if (!list.length) return;
    const SEGS = 18;
    const im = new THREE.InstancedMesh(seg, stone, list.length * SEGS * 2);
    const ip = new THREE.InstancedMesh(seg, wood, list.length * SEGS);
    let ni = 0, np = 0;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const [pr, w] of list) {
      const big = Math.min(1, pr.pop / 40000);
      const R = 0.075 + big * 0.07;
      const c = this.cityPos[pr.id];
      const isStone = !['gallic', 'briton', 'german', 'steppe', 'dacian', 'iberian'].includes(pr.culture) || w >= 2;
      for (let k = 0; k < SEGS; k++) {
        const a = (k / SEGS) * Math.PI * 2, a2 = ((k + 0.5) / SEGS) * Math.PI * 2;
        const x = c.x + Math.cos(a2) * R, z = c.z + Math.sin(a2) * R;
        const y = Math.max(this.heightAt(x, z), 0) - 0.003;
        const len = 2 * Math.PI * R / SEGS * 1.02;
        q.setFromAxisAngle(up, -a2 + Math.PI / 2);
        if (isStone) {
          m4.compose(p.set(x, y, z), q, s.set(len, 0.012 + w * 0.004, 0.006)); im.setMatrixAt(ni++, m4);
          if (k % 3 === 0) { const tx = c.x + Math.cos(a) * R, tz = c.z + Math.sin(a) * R; m4.compose(p.set(tx, Math.max(this.heightAt(tx, tz), 0) - 0.003, tz), q, s.set(0.012, 0.022 + w * 0.004, 0.012)); im.setMatrixAt(ni++, m4); }
        } else {
          m4.compose(p.set(x, y, z), q, s.set(len, 0.012, 0.004)); ip.setMatrixAt(np++, m4);
        }
      }
    }
    im.count = ni; ip.count = np;
    for (const m of [im, ip]) { m.castShadow = true; m.receiveShadow = true; m.instanceMatrix.needsUpdate = true; this.wallGroup.add(m); }
  }

  buildLandmarks() {
    const std = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
    for (const lm of LANDMARKS) {
      const w = toWorld(lm.lon, lm.lat);
      const y = Math.max(this.heightAt(w.x, w.z), 0.003);
      const g = new THREE.Group();
      if (lm.kind === 'pyramids') {
        [[0, 0, 0.07], [0.06, 0.05, 0.06], [0.1, 0.09, 0.035]].forEach(([dx, dz, s]) => {
          const m = new THREE.Mesh(new THREE.ConeGeometry(s * 0.72, s * 0.9, 4), std('#e2c68e'));
          m.rotation.y = Math.PI / 4; m.position.set(dx, s * 0.45, dz); m.castShadow = true; m.receiveShadow = true; g.add(m);
        });
        g.position.set(w.x - 0.05, y, w.z + 0.06);
      } else if (lm.kind === 'pharos') {
        const a = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.05, 0.026), std('#efe8da')); a.position.y = 0.025;
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.011, 0.05, 8), std('#efe8da')); b.position.y = 0.075;
        const fire = new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffcf70' })); fire.position.y = 0.106;
        g.add(a, b, fire); g.children.forEach((c) => (c.castShadow = true));
        g.position.set(w.x - 0.02, Math.max(y, 0), w.z - 0.03);
        const light = new THREE.PointLight('#ffbe66', 0.3, 0.6); light.position.y = 0.11; g.add(light);
        this.pharosFire = fire;
      } else if (lm.kind === 'colossus') {
        const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.012, 8), std('#e8e0cf')); ped.position.y = 0.006;
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.007, 0.05, 6), std('#c08a4a')); body.position.y = 0.037;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 8, 6), std('#c08a4a')); head.position.y = 0.067;
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.03, 4), std('#c08a4a')); arm.position.set(0.008, 0.07, 0); arm.rotation.z = -0.3;
        g.add(ped, body, head, arm); g.children.forEach((c) => (c.castShadow = true));
        g.position.set(w.x, Math.max(y, 0), w.z);
      }
      this.scene.add(g);
    }
  }

  // ---------------------------------------------------------------- clouds
  buildClouds() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const c = cv.getContext('2d');
    const rng = mulberry32(5);
    for (let i = 0; i < 26; i++) {
      const x = 30 + rng() * 68, y = 40 + rng() * 48, r = 14 + rng() * 26;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    this.cloudMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.45, fog: false });
    this.clouds = [];
    for (let i = 0; i < 30; i++) {
      const s = new THREE.Sprite(this.cloudMat);
      const sc = 4 + rng() * 7;
      s.scale.set(sc, sc * 0.55, 1);
      s.position.set((rng() - 0.5) * WORLD_W, 3.5 + rng() * 2.5, (rng() - 0.5) * WORLD_H);
      s.userData.v = 0.08 + rng() * 0.12;
      this.clouds.push(s); this.scene.add(s);
    }
  }

  // ---------------------------------------------------------------- labels
  buildLabels() {
    this.labels = this.world.provinces.map((p) => {
      const el = document.createElement('div');
      el.className = 'plabel';
      el.innerHTML = `<span class="pl-name">${p.name}</span><span class="pl-gar"></span>`;
      this.labelsEl.appendChild(el);
      return el;
    });
    this.facLabels = {};
    for (const id of FACTION_IDS) {
      if (id === 'free') continue;
      const el = document.createElement('div');
      el.className = 'flabel';
      el.textContent = FACTIONS[id].name.replace(/^The /, '').toUpperCase();
      this.labelsEl.appendChild(el);
      this.facLabels[id] = el;
    }
    this.armyLabelEl = document.createElement('div');
    this.labelsEl.appendChild(this.armyLabelEl);
  }

  // ---------------------------------------------------------------- state sync
  syncOwners(state) {
    const provs = this.world.provinces;
    const fidx = Object.fromEntries(FACTION_IDS.map((f, i) => [f, i]));
    const col = new THREE.Color();
    provs.forEach((pr, i) => {
      const o = state.provs[i].owner;
      const c = new THREE.Color(FACTIONS[o].color);
      const k = i * 4;
      this.palData[k] = c.r * 255; this.palData[k + 1] = c.g * 255; this.palData[k + 2] = c.b * 255;
      this.palData[k + 3] = o === 'free' ? 90 : 255;
      const f = 256 * 4 + k;
      this.palData[f] = (fidx[o] + 1) * 12;
      this.palData[f + 1] = i === this.selProv ? 255 : 0;
      this.palData[f + 2] = this.reach.has(i) ? 255 : 0;
      this.palData[f + 3] = this.attackable.has(i) ? 255 : 0;
      col.set(FACTIONS[o].color);
      this.flagMesh.setColorAt(i, col);
      const lab = this.labels[i];
      lab.style.setProperty('--fc', FACTIONS[o].color);
      lab.classList.toggle('capital', state.factions[o] && state.factions[o].capital === i);
      lab.classList.toggle('mine', o === state.player);
    });
    this.flagMesh.instanceColor.needsUpdate = true;
    this.palTex.needsUpdate = true;
    // faction name label positions: area-weighted centre of the largest holdings
    this.facCenters = {};
    for (const id of FACTION_IDS) {
      if (id === 'free') continue;
      let sx = 0, sz = 0, w = 0;
      provs.forEach((pr, i) => { if (state.provs[i].owner === id) { const a = Math.sqrt(pr.area); sx += toWorld(pr.clon, pr.clat).x * a; sz += toWorld(pr.clon, pr.clat).z * a; w += a; } });
      this.facCenters[id] = w > 0 ? { x: sx / w, z: sz / w, n: w } : null;
    }
  }

  setHighlights({ sel = -1, reach = [], attack = [] } = {}) {
    this.selProv = sel; this.reach = new Set(reach); this.attackable = new Set(attack);
    for (let i = 0; i < this.world.provinces.length; i++) {
      const f = 256 * 4 + i * 4;
      this.palData[f + 1] = i === sel ? 255 : 0;
      this.palData[f + 2] = this.reach.has(i) ? 255 : 0;
      this.palData[f + 3] = this.attackable.has(i) ? 255 : 0;
    }
    this.palTex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- armies
  makeArmyObj(owner) {
    const color = new THREE.Color(FACTIONS[owner].color);
    const g = new THREE.Group();
    const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, ...o });
    const team = std(color);
    const metal = std('#c9a24a', { metalness: 0.6, roughness: 0.35 });
    const skin = std('#d3a27a');
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.008, 20), std('#2a2118'));
    base.position.y = 0.004; g.add(base);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.004, 6, 28), team); ring.rotation.x = Math.PI / 2; ring.position.y = 0.009; g.add(ring);
    const soldier = (x, z, s) => {
      const sg = new THREE.Group();
      const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.007, 0.022, 6), std('#4a3a2a')); legs.position.y = 0.011;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.009, 0.024, 8), team); body.position.y = 0.034;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.0065, 10, 8), skin); head.position.y = 0.052;
      const helm = new THREE.Mesh(new THREE.SphereGeometry(0.007, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), metal); helm.position.y = 0.054;
      const shield = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.028, 0.003), team); shield.position.set(0, 0.032, 0.011);
      const boss = new THREE.Mesh(new THREE.SphereGeometry(0.003, 6, 4), metal); boss.position.set(0, 0.032, 0.013);
      const spear = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.08, 4), std('#6b4f2e')); spear.position.set(0.011, 0.045, 0);
      sg.add(legs, body, head, helm, shield, boss, spear);
      sg.position.set(x, 0.008, z); sg.scale.setScalar(s);
      sg.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      return sg;
    };
    g.add(soldier(-0.02, 0.012, 1), soldier(0.022, 0.014, 1), soldier(0.0, -0.016, 1.1));
    // standard: eagle for Rome, banner for everyone
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0018, 0.13, 5), std('#5a4630')); pole.position.set(-0.035, 0.07, -0.02);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.036, 0.046, 4, 4), std(color, { side: THREE.DoubleSide }));
    banner.position.set(-0.035 + 0.018, 0.11, -0.02);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.04, 4), metal); bar.rotation.z = Math.PI / 2; bar.position.set(-0.035 + 0.018, 0.133, -0.02);
    g.add(pole, banner, bar);
    if (owner === 'rome') {
      const eagle = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.016, 4), metal); eagle.position.set(-0.035, 0.144, -0.02); eagle.rotation.z = Math.PI;
      const wings = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.004, 0.006), metal); wings.position.set(-0.035, 0.15, -0.02); wings.rotation.z = 0.0;
      g.add(eagle, wings);
    } else {
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.004, 0.012, 5), metal); tip.position.set(-0.035, 0.14, -0.02); g.add(tip);
    }
    g.userData.banner = banner;
    pole.castShadow = banner.castShadow = true;
    const sel = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.005, 6, 36), new THREE.MeshBasicMaterial({ color: '#ffd36b', transparent: true, opacity: 0.9, toneMapped: false }));
    sel.rotation.x = Math.PI / 2; sel.position.y = 0.012; sel.visible = false; g.add(sel);
    g.userData.sel = sel;
    const el = document.createElement('div');
    el.className = 'alabel';
    el.style.setProperty('--fc', FACTIONS[owner].color);
    this.labelsEl.appendChild(el);
    g.userData.el = el;
    this.scene.add(g);
    return g;
  }

  // world position for an army standing in a province (spread several armies around the city)
  armySpot(provId, slot) {
    const c = this.cityPos[provId];
    const a = 2.3 + slot * 1.25, r = 0.11 + (slot > 3 ? 0.06 : 0);
    const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
    return new THREE.Vector3(x, Math.max(this.heightAt(x, z), 0.002), z);
  }

  syncArmies(state, selectedArmy) {
    const seen = new Set();
    const slots = new Map();
    for (const a of state.armies) {
      seen.add(a.id);
      let o = this.armyObjs.get(a.id);
      if (!o) {
        o = this.makeArmyObj(a.owner);
        this.armyObjs.set(a.id, o);
        const sp = this.armySpot(a.prov, 0);
        o.position.copy(sp);
        o.userData.from = sp.clone();
      }
      const slot = slots.get(a.prov) || 0; slots.set(a.prov, slot + 1);
      const target = this.armySpot(a.prov, slot);
      if (!o.userData.target || o.userData.target.distanceToSquared(target) > 1e-8) {
        o.userData.from = o.position.clone();
        o.userData.target = target;
        o.userData.t = 0;
      }
      o.userData.sel.visible = a.id === selectedArmy;
      o.userData.army = a;
      const men = a.units.reduce((s, u) => s + u.n, 0);
      o.userData.el.innerHTML = `<b>${a.units.length}</b><i>${men}</i>`;
      o.userData.el.classList.toggle('mine', a.owner === state.player);
      o.userData.el.classList.toggle('moved', a.owner === state.player && a.mp <= 0);
    }
    for (const [id, o] of this.armyObjs) {
      if (!seen.has(id)) { this.scene.remove(o); o.userData.el.remove(); this.armyObjs.delete(id); }
    }
  }

  // ---------------------------------------------------------------- path preview
  showPath(points, kind) {
    if (this.pathLine) { this.scene.remove(this.pathLine); this.pathLine.geometry.dispose(); this.pathLine = null; }
    if (!points || points.length < 2) return;
    const pts = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      for (let k = 0; k <= 16; k++) {
        const t = k / 16;
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        const y = Math.max(this.heightAt(x, z), 0) + 0.025 + Math.sin(t * Math.PI) * 0.06 * Math.min(1, a.distanceTo(b));
        pts.push(new THREE.Vector3(x, y, z));
      }
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = new THREE.TubeGeometry(curve, pts.length * 2, 0.008, 6, false);
    const mat = new THREE.MeshBasicMaterial({ color: kind === 'attack' ? '#ff5a3c' : kind === 'far' ? '#d9d2b8' : '#ffe08a', transparent: true, opacity: 0.92, toneMapped: false, depthTest: false });
    this.pathLine = new THREE.Mesh(geo, mat);
    this.pathLine.renderOrder = 10;
    this.scene.add(this.pathLine);
  }

  // A burst of smoke/fire where a battle happened
  battleFx(provId) {
    const c = this.cityPos[provId];
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffb35c', transparent: true, opacity: 0.9, toneMapped: false }));
    m.position.copy(c); m.position.y += 0.05;
    this.scene.add(m);
    this.fx.push({ m, t: 0 });
  }

  // ---------------------------------------------------------------- camera
  focus(x, z, dist) { this.cam.tx = x; this.cam.tz = z; if (dist) this.cam.tdist = dist; }
  pan(dx, dz) {
    const c = Math.cos(this.cam.yaw), s = Math.sin(this.cam.yaw);
    this.cam.tx += (dx * c + dz * s);
    this.cam.tz += (-dx * s + dz * c);
  }
  zoom(f) { this.cam.tdist = Math.min(52, Math.max(1.4, this.cam.tdist * f)); }

  updateCamera(dt) {
    const c = this.cam;
    const k = 1 - Math.exp(-dt * 8);
    c.tx = Math.max(-WORLD_W / 2 + 2, Math.min(WORLD_W / 2 - 2, c.tx));
    c.tz = Math.max(-WORLD_H / 2 + 1.5, Math.min(WORLD_H / 2 - 1.5, c.tz));
    c.x += (c.tx - c.x) * k; c.z += (c.tz - c.z) * k; c.dist += (c.tdist - c.dist) * k; c.yaw += (c.tyaw - c.yaw) * k;
    const t = Math.min(1, Math.max(0, (c.dist - 1.4) / 30));
    const pitch = 0.62 + t * 0.55; // radians above the horizon
    const gy = Math.max(this.heightAt(c.x, c.z), 0);
    const off = new THREE.Vector3(Math.sin(c.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(c.yaw) * Math.cos(pitch)).multiplyScalar(c.dist);
    this.camera.position.set(c.x + off.x, gy + off.y, c.z + off.z);
    this.camera.lookAt(c.x, gy, c.z);
    this.scene.fog.near = c.dist * 1.4; this.scene.fog.far = c.dist * 4.5 + 10;
    // shadow frustum follows the view
    const s = this.sun;
    const span = Math.min(30, c.dist * 1.2 + 0.5);
    s.position.set(c.x + this.sunDir.x * 20, this.sunDir.y * 20, c.z + this.sunDir.z * 20);
    s.target.position.set(c.x, 0, c.z);
    const sc = s.shadow.camera;
    if (sc.right !== span) { sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.near = 1; sc.far = 50; sc.updateProjectionMatrix(); }
    s.shadow.mapSize.width; // keep
  }

  // ---------------------------------------------------------------- picking
  rayGround(clientX, clientY) {
    const ndc = new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    const o = rc.ray.origin, d = rc.ray.direction;
    if (d.y >= 0) return null;
    // march down to the relief, then bisect
    let t0 = 0, t1 = (o.y - 0.8) / -d.y;
    t0 = Math.max(0, t1);
    const end = (o.y + 0.4) / -d.y;
    let prev = t0;
    const step = Math.max(0.01, this.cam.dist * 0.01);
    for (let t = t0; t < end + 1; t += step) {
      const x = o.x + d.x * t, z = o.z + d.z * t, y = o.y + d.y * t;
      const h = Math.max(this.heightAt(x, z), 0);
      if (y <= h) {
        let a = prev, b = t;
        for (let i = 0; i < 10; i++) { const m = (a + b) / 2; const mx = o.x + d.x * m, mz = o.z + d.z * m; if (o.y + d.y * m <= Math.max(this.heightAt(mx, mz), 0)) b = m; else a = m; }
        return new THREE.Vector3(o.x + d.x * b, o.y + d.y * b, o.z + d.z * b);
      }
      prev = t;
    }
    return null;
  }

  provinceAt(p) {
    if (!p) return -1;
    const { lon, lat } = worldToLonLat(p.x, p.z);
    const { gx, gy } = lonLatToGrid(lon, lat);
    const x = Math.floor(gx), y = Math.floor(gy);
    if (x < 0 || y < 0 || x >= GW || y >= GH) return -1;
    return this.world.own[y * GW + x];
  }

  armyAt(clientX, clientY) {
    let best = null, bd = 26 * 26;
    const v = new THREE.Vector3();
    for (const [, o] of this.armyObjs) {
      v.copy(o.position); v.y += 0.05;
      v.project(this.camera);
      if (v.z > 1) continue;
      const sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight;
      const d = (sx - clientX) ** 2 + (sy - clientY) ** 2;
      if (d < bd) { bd = d; best = o.userData.army; }
    }
    return best;
  }

  screenOf(p) {
    const v = p.clone().project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, vis: v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2 };
  }

  // ---------------------------------------------------------------- frame
  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(innerWidth, innerHeight);
  }

  render(dt, state) {
    this.time += dt;
    this.updateCamera(dt);
    this.terrainUniforms.uTime.value = this.time;
    this.terrainUniforms.uHover.value = this.hoverProv + 1;
    this.waterUniforms.uTime.value = this.time;
    this.flagUniforms.uTime.value = this.time;
    const d = this.cam.dist;
    const armyScale = Math.min(3.2, Math.max(0.9, d / 6));
    for (const [, o] of this.armyObjs) {
      const u = o.userData;
      if (u.target) {
        u.t = Math.min(1, (u.t || 0) + dt * 2.2);
        const e = u.t < 0.5 ? 2 * u.t * u.t : 1 - (-2 * u.t + 2) ** 2 / 2;
        o.position.lerpVectors(u.from, u.target, e);
        o.position.y = Math.max(this.heightAt(o.position.x, o.position.z), 0.002) + Math.sin(e * Math.PI) * 0.05;
      }
      o.scale.setScalar(armyScale);
      if (u.sel.visible) u.sel.scale.setScalar(1 + Math.sin(this.time * 5) * 0.08);
      const b = u.banner;
      b.rotation.y = Math.sin(this.time * 2 + o.position.x * 10) * 0.25;
    }
    for (const c of this.clouds) {
      c.position.x += c.userData.v * dt;
      if (c.position.x > WORLD_W / 2 + 6) c.position.x = -WORLD_W / 2 - 6;
    }
    this.cloudMat.opacity = Math.min(0.38, Math.max(0, (d - 26) / 16));
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]; f.t += dt;
      f.m.scale.setScalar(1 + f.t * 5); f.m.material.opacity = Math.max(0, 0.9 - f.t * 0.9);
      if (f.t > 1) { this.scene.remove(f.m); this.fx.splice(i, 1); }
    }
    if (this.pharosFire) this.pharosFire.scale.setScalar(1 + Math.sin(this.time * 9) * 0.2);
    this.composer.render(dt);
    this.updateLabels(state);
  }

  updateLabels(state) {
    const d = this.cam.dist;
    const provs = this.world.provinces;
    const showMinor = d < 16;
    const fs = Math.max(10, Math.min(15, 22 - d * 0.5));
    const v = new THREE.Vector3();
    for (let i = 0; i < provs.length; i++) {
      const el = this.labels[i];
      const cap = el.classList.contains('capital');
      if (!showMinor && !cap && !(d < 24 && provs[i].pop > 15000)) { if (el.style.display !== 'none') el.style.display = 'none'; continue; }
      v.copy(this.cityPos[i]); v.y += 0.01;
      const s = this.screenOf(v);
      if (!s.vis) { if (el.style.display !== 'none') el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.transform = `translate(${s.x | 0}px, ${(s.y + 10) | 0}px) translate(-50%, 0)`;
      el.style.fontSize = fs + 'px';
    }
    const showFac = d > 12;
    for (const id in this.facLabels) {
      const el = this.facLabels[id];
      const c = this.facCenters && this.facCenters[id];
      if (!showFac || !c) { el.style.display = 'none'; continue; }
      v.set(c.x, 0.1, c.z);
      const s = this.screenOf(v);
      if (!s.vis) { el.style.display = 'none'; continue; }
      el.style.display = '';
      const size = Math.max(11, Math.min(30, (Math.sqrt(c.n) * 3.2) * (16 / d) + 6));
      el.style.fontSize = size + 'px';
      el.style.opacity = Math.min(1, (d - 12) / 6) * 0.85;
      el.style.color = FACTIONS[id].color;
      el.style.transform = `translate(${s.x | 0}px, ${s.y | 0}px) translate(-50%, -50%)`;
    }
    for (const [, o] of this.armyObjs) {
      const el = o.userData.el;
      v.copy(o.position); v.y += 0.17 * o.scale.x;
      const s = this.screenOf(v);
      if (!s.vis || d > 34) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.transform = `translate(${s.x | 0}px, ${s.y | 0}px) translate(-50%, -100%)`;
    }
    if (state) {
      for (let i = 0; i < provs.length; i++) {
        const g = this.labels[i].lastChild;
        const w = state.provs[i].bld.walls;
        const txt = w ? '▣'.repeat(Math.min(3, w)) : '';
        if (g.textContent !== txt) g.textContent = txt;
      }
    }
  }
}
