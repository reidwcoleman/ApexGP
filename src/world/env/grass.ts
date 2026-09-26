import * as THREE from 'three';
import type { WorldMap } from './worldmap.ts';
import { SURF } from '../Track.ts';
import { noiseTexture } from './textures.ts';
import { weatherUniforms } from '../weatherUniforms.ts';

/**
 * Grass blades on the verges, in the few dozen metres of circuit around the camera.
 *
 * Built in track space, so it follows every curve and knows the surfaces exactly:
 *   tFrame   centreline + right vector per metre of lap (RGBA32F, texelFetch)
 *   tGround  per metre of lap × 0.5 m lateral bins over ±LAT: R = grass density (only on
 *            SURF.GRASS, not near other roads, pits, crossings, buildings), G = terrain height
 *            relative to the road plane at that point, B = mown lawn (short) ↔ rough (long)
 * One draw: a fixed set of blade triangles laid out over TILES metres of lap; each frame the
 * window slides to the camera's position along the lap (whole metres, so blades never swim).
 * Blades shrink away with distance and fade out by FADE m; nothing is drawn when the camera is
 * far from the circuit (TV towers, helicopter). Wind sway from the shared weather wind.
 * No shadow casting; receives shadows and the scene's lighting and haze.
 */

const LAT = 18;
const BIN = 0.5;
const BINS = Math.round((2 * LAT) / BIN) + 1;
const TILES = 64;
const PER_M2 = 26;
const FADE: [number, number] = [18, 30];
const ROW = 2048;

export interface GrassBuild {
  mesh: THREE.Mesh;
  update(camera: THREE.Camera, elapsed: number): void;
  setEnabled(on: boolean): void;
}

export function buildGrass(map: WorldMap, palette: { lawn: THREE.Color; meadow: THREE.Color; straw: THREE.Color }): GrassBuild {
  const track = map.track;
  const n = track.n;
  // ---- centreline frames
  const rows = Math.ceil(n / ROW);
  const fr = new Float32Array(ROW * rows * 2 * 4);
  for (let i = 0; i < n; i++) {
    const x = i % ROW, y = Math.floor(i / ROW);
    const a = (y * ROW + x) * 4, b = ((y + rows) * ROW + x) * 4;
    fr[a] = track.px[i];
    fr[a + 1] = track.py[i];
    fr[a + 2] = track.pz[i];
    fr[b] = track.rx[i];
    fr[b + 1] = track.ry[i];
    fr[b + 2] = track.rz[i];
  }
  const tFrame = new THREE.DataTexture(fr, ROW, rows * 2, THREE.RGBAFormat, THREE.FloatType);
  tFrame.minFilter = tFrame.magFilter = THREE.NearestFilter;
  tFrame.needsUpdate = true;

  // ---- ground: density, height offset, lawn
  const gd = new Uint16Array(BINS * n * 4);
  const toH = THREE.DataUtils.toHalfFloat;
  const H0 = toH(0), H1 = toH(1), H035 = toH(0.35);
  const nearCross = new Uint8Array(n);
  for (const c of track.crossings) for (const k of [c.lower, c.upper]) for (let d = -30; d <= 30; d++) nearCross[(((k + d) % n) + n) % n] = 1;
  const p = new THREE.Vector3();
  let grassBins = 0;
  const t0 = performance.now();
  const pitSide = track.pit.side;
  for (let i = 0; i < n; i++) {
    let prevH = 0;
    // the pit lane and its approaches (cheaper than a world-space pit-zone test per bin)
    const pitHere = track.inPit(i - 25) || track.inPit(i + 25) || track.inPit(i);
    for (let b = 0; b < BINS; b++) {
      const lat = -LAT + b * BIN;
      const q = (i * BINS + b) * 4;
      let dens = 0;
      let dh = prevH;
      const a = Math.abs(lat);
      const side = lat < 0 ? -1 : 1;
      const bar = side < 0 ? track.barrierL[i] : track.barrierR[i];
      if (!nearCross[i] && a < bar - 0.35 && a > track.halfWidth[i] + 1.5 && track.surfaceAt(i, lat) === SURF.GRASS) {
        track.point(i, lat, 0, p);
        // not where another part of the circuit (or the pit lane) runs close by
        const d = map.distToTrack(p.x, p.z);
        if (d > a - 3 && !(pitHere && side === pitSide) && !map.excluded(p.x, p.z, 0.5)) {
          dens = 1;
          grassBins++;
          // thinner right at the barrier foot and at the tarmac edge
          dens *= Math.min(1, (bar - 0.35 - a) / 1.2 + 0.25);
          if (b % 2 === 0) dh = map.height(p.x, p.z) - p.y;
        }
      }
      gd[q] = dens === 0 ? H0 : dens === 1 ? H1 : toH(dens);
      gd[q + 1] = dh === prevH && b > 0 ? gd[q - 3] : toH(Math.max(-8, Math.min(8, dh)));
      prevH = dh;
      gd[q + 2] = a < track.halfWidth[i] + 12 ? H1 : H035;
      gd[q + 3] = H1;
    }
  }
  const bakeMs = performance.now() - t0;
  const tGround = new THREE.DataTexture(gd, BINS, n, THREE.RGBAFormat, THREE.HalfFloatType);
  tGround.minFilter = tGround.magFilter = THREE.LinearFilter;
  tGround.wrapS = THREE.ClampToEdgeWrapping;
  tGround.wrapT = THREE.RepeatWrapping;
  tGround.needsUpdate = true;

  // ---- blades: TILES metres × ±LAT, PER_M2, one triangle each
  const count = Math.round(TILES * 2 * LAT * PER_M2);
  const aBlade = new Float32Array(count * 3 * 4);
  const aCorner = new Float32Array(count * 3);
  let seed = 12345;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let k = 0; k < count; k++) {
    const tile = Math.floor(rnd() * TILES);
    const lat = -LAT + rnd() * 2 * LAT;
    const ds = rnd();
    const r = rnd();
    for (let c = 0; c < 3; c++) {
      aBlade.set([tile, lat, ds, r], (k * 3 + c) * 4);
      aCorner[k * 3 + c] = c;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3 * 3), 3));
  geo.setAttribute('aBlade', new THREE.BufferAttribute(aBlade, 4));
  geo.setAttribute('aCorner', new THREE.BufferAttribute(aCorner, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);

  const uniforms = {
    tFrame: { value: tFrame },
    tGround: { value: tGround },
    tNoise: { value: noiseTexture() },
    uS0: { value: 0 },
    uN: { value: n },
    uRows: { value: rows },
    uTime: { value: 0 },
    /** dev: > 0 draws every blade this tall (m) regardless of the masks */
    uDebug: { value: 0 },
    uFade: { value: new THREE.Vector2(FADE[0], FADE[1]) },
    uLawnC: { value: palette.lawn },
    uMeadowC: { value: palette.meadow },
    uStrawC: { value: palette.straw },
    uWind: weatherUniforms.uWind,
    uWet: weatherUniforms.uWetness,
  };
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 aBlade;
attribute float aCorner;
uniform highp sampler2D tFrame;
uniform sampler2D tGround;
uniform sampler2D tNoise;
uniform float uS0, uN, uRows, uTime, uDebug;
uniform vec2 uFade, uWind;
uniform vec3 uLawnC, uMeadowC, uStrawC;
varying vec3 vGC;
varying float vGH;
vec3 gFetch( float i, float row ) {
  i = mod( i, uN );
  return texelFetch( tFrame, ivec2( int( mod( i, ${ROW}.0 ) ), int( floor( i / ${ROW}.0 ) + row * uRows ) ), 0 ).xyz;
}
float gHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `vec3 objectNormal = vec3( 0.0, 1.0, 0.0 );`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed;
{
  float tileS = uS0 + aBlade.x;
  // per-metre variety: shift the lateral pattern and the along-track offset
  float hsh = gHash( vec2( mod( tileS, uN ), 3.7 ) );
  float lat = mod( aBlade.y + ${LAT.toFixed(1)} + hsh * 7.31, ${(2 * LAT).toFixed(1)} ) - ${LAT.toFixed(1)};
  float s = tileS + fract( aBlade.z + hsh * 0.37 );
  float i0 = floor( s );
  float f = s - i0;
  vec3 c = mix( gFetch( i0, 0.0 ), gFetch( i0 + 1.0, 0.0 ), f );
  vec3 r = mix( gFetch( i0, 1.0 ), gFetch( i0 + 1.0, 1.0 ), f );
  vec4 g = texture2D( tGround, vec2( ( lat + ${LAT.toFixed(1)} ) / ${(2 * LAT + BIN).toFixed(2)} + ${(BIN / 2 / (2 * LAT + BIN)).toFixed(5)}, ( mod( s, uN ) + 0.5 ) / uN ) );
  vec3 base = c + r * lat;
  base.y += g.g - 0.03;
  float rnd = aBlade.w;
  float dist = length( base - cameraPosition );
  // density: surface mask, and thinning with distance (fewer, slightly larger blades far off)
  float lod = mix( 1.0, 0.35, smoothstep( 6.0, uFade.y, dist ) );
  float keep = step( rnd, g.r * lod );
  float fade = 1.0 - smoothstep( uFade.x, uFade.y, dist );
  // clumps: tufts of taller grass and bare patches
  float clump = texture2D( tNoise, base.xz * 0.37 ).a;
  float mown = g.b;
  float h = mix( mix( 0.09, 0.17, rnd ), mix( 0.24, 0.55, rnd * rnd ), 1.0 - mown ) * ( 0.6 + 0.8 * clump );
  h *= fade * keep * ( 1.0 + 0.25 * ( 1.0 - lod ) );
  if ( uDebug < 0.0 ) h *= -uDebug;
  float w = mix( 0.012, 0.022, fract( rnd * 13.1 ) ) * ( 1.0 + 0.8 * ( 1.0 - lod ) + dist * 0.004 );
  float yaw = fract( rnd * 91.7 ) * 6.2832;
  vec3 side = vec3( cos( yaw ), 0.0, sin( yaw ) );
  vec3 face = vec3( -side.z, 0.0, side.x );
  // lean: random curl plus the wind (gusting)
  float wl = length( uWind );
  vec2 wd = wl > 0.1 ? uWind / wl : vec2( 0.8, 0.6 );
  float gust = sin( uTime * 1.7 + base.x * 0.35 + base.z * 0.21 ) * 0.5 + 0.5;
  vec3 lean = face * ( fract( rnd * 7.3 ) - 0.5 ) * 0.5 + vec3( wd.x, 0.0, wd.y ) * ( 0.08 + wl * 0.03 ) * ( 0.4 + 0.6 * gust );
  transformed = base;
  if ( aCorner < 0.5 ) transformed -= side * w;
  else if ( aCorner < 1.5 ) transformed += side * w;
  else transformed += ( vec3( 0.0, 1.0, 0.0 ) + lean ) * h;
  if ( uDebug > 0.0 ) { transformed = base + ( aCorner < 0.5 ? -side * 0.1 : aCorner < 1.5 ? side * 0.1 : vec3( 0.0, uDebug * ( 0.1 + g.r ), 0.0 ) ); h = uDebug; }
  if ( h < 0.004 ) transformed = vec3( 0.0, -1e5, 0.0 );
  vGH = aCorner > 1.5 ? 1.0 : 0.0;
  // colour: the ground palette, fresh green to straw, lighter tips
  float dry = texture2D( tNoise, base.xz * 0.0041 + vec2( 0.37, 0.19 ) ).g;
  vec3 col = mix( uMeadowC, uLawnC, mown );
  col = mix( col, uStrawC, smoothstep( 0.45, 0.8, dry ) * ( 1.0 - mown * 0.6 ) * 0.7 + fract( rnd * 3.7 ) * 0.12 );
  vGC = col * ( 0.8 + 0.4 * fract( rnd * 5.3 ) );
  if ( uDebug > 0.0 ) vGC = vec3( g.r, clamp( g.g * 0.2 + 0.5, 0.0, 1.0 ), g.b );
}`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vGC;\nvarying float vGH;\nuniform float uWet;`)
      .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb = vGC * mix( 0.38, 1.25, vGH * vGH ) * mix( 1.0, 0.7, uWet );`)
      .replace('normal *= faceDirection;', '')
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
reflectedLight.indirectDiffuse *= mix( 0.45, 1.0, vGH );
reflectedLight.directDiffuse *= mix( 0.7, 1.0, vGH );`,
      );
  };
  mat.customProgramCacheKey = () => 'apex-grass-v1';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'grass_blades';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.userData.stats = { grassBins, bins: BINS * n, blades: count, bakeMs: Math.round(bakeMs) };
  mesh.userData.uniforms = uniforms;

  const cam = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  let hint = -1;
  let enabled = true;
  return {
    mesh,
    update(camera, elapsed) {
      uniforms.uTime.value = elapsed;
      if (!enabled) {
        mesh.visible = false;
        return;
      }
      camera.getWorldPosition(cam);
      const pr = track.project(cam.x, cam.z, hint, 60);
      hint = pr.index;
      const far = Math.abs(pr.lateral) > LAT + 25 || cam.y - track.heightAt(pr.s) > 30;
      mesh.visible = !far;
      if (far) return;
      camera.getWorldDirection(fwd);
      const i = pr.index;
      const j = (i + 3) % n;
      const along = fwd.x * (track.px[j] - track.px[i]) + fwd.z * (track.pz[j] - track.pz[i]);
      // most of the window ahead of where the camera looks
      const back = along >= 0 ? 12 : TILES - 12;
      uniforms.uS0.value = Math.floor(pr.s) - back;
    },
    setEnabled(on) {
      enabled = on;
      if (!on) mesh.visible = false;
    },
  };
}
