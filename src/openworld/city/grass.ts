import * as THREE from 'three';
import { WORLD } from '../geo.ts';
import { weatherUniforms } from '../../world/weatherUniforms.ts';
import type { LawnMask } from './lawnmask.ts';

/**
 * Grass blades on Miami's lawns, round the camera. One instanced draw: a fixed tile of tufts (three
 * curved blades each) that wraps round the camera — every tuft keeps its place on the ground as you
 * move (the tile repeats every TILE m, so a tuft leaving behind reappears ahead). The vertex shader
 * reads the lawn mask (lawnmask.ts) and folds away any tuft not on lawn, shortens and thins them
 * with distance and fades them out by FADE m; the wind bends them. St. Augustine grass: broad, dark,
 * a little blue-green; yellowed tips in the dry patches.
 */

const TILE = 40;
const PER_M2 = 11;
const FADE: [number, number] = [13, 19];

export interface GrassBuild {
  mesh: THREE.Mesh;
  update(cam: THREE.Vector3, t: number): void;
}

function tuftGeometry(): THREE.BufferGeometry {
  // three blades, each a 4-segment strip bending over, rotated round the tuft
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const SEG = 3;
  for (let b = 0; b < 3; b++) {
    const a = (b / 3) * Math.PI * 2 + b * 0.7;
    const ox = Math.cos(a * 1.7) * 0.07, oz = Math.sin(a * 1.7) * 0.07;
    const dx = Math.cos(a), dz = Math.sin(a);
    const base = pos.length / 3;
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG;
      const w = 0.022 * (1 - t * 0.85);
      const lean = t * t * 0.18;
      const y = t;
      for (const side of [-1, 1]) {
        pos.push(ox + -dz * w * side + dx * lean, y, oz + dx * w * side + dz * lean);
        nor.push(dx * 0.4, 1, dz * 0.4);
        uv.push(side * 0.5 + 0.5, t);
      }
      if (s < SEG) {
        const k = base + s * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export function buildGrass(mask: LawnMask): GrassBuild {
  const tuft = tuftGeometry();
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = tuft.index;
  for (const k of ['position', 'normal', 'uv']) geo.setAttribute(k, tuft.getAttribute(k));
  const N = Math.round(TILE * TILE * PER_M2);
  const off = new Float32Array(N * 4);
  let s = 12345;
  const R = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < N; i++) {
    off[i * 4] = R() * TILE;
    off[i * 4 + 1] = R() * TILE;
    off[i * 4 + 2] = R() * Math.PI * 2;
    off[i * 4 + 3] = 0.07 + R() * 0.08;
  }
  geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
  geo.instanceCount = N;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const u = {
    uCam: { value: new THREE.Vector3() },
    uLawn: { value: mask.texture() as THREE.Texture },
    uLawnB: { value: new THREE.Vector4(WORLD.x0, WORLD.z0, 1 / (mask.W * mask.C), 1 / (mask.H * mask.C)) },
    uGT: { value: 0 },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, { uWind: weatherUniforms.uWind });
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 aOff;
uniform vec3 uCam;
uniform sampler2D uLawn;
uniform vec4 uLawnB;
uniform float uGT;
uniform vec2 uWind;
varying float vGT;
varying vec3 vGTint;
float gh( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }`,
      )
      .replace(
        '#include <begin_vertex>',
        `
// the tuft's place: its slot in the tile, repeated to sit within half a tile of the camera
vec2 local = aOff.xy;
vec2 wp = local + floor( ( uCam.xz - local ) / ${TILE.toFixed(1)} + 0.5 ) * ${TILE.toFixed(1)};
vec2 luv = ( wp - uLawnB.xy ) * uLawnB.zw;
float lawn = texture2D( uLawn, luv ).r;
float d = length( wp - uCam.xz );
float fade = 1.0 - smoothstep( ${FADE[0].toFixed(1)}, ${FADE[1].toFixed(1)}, d );
float on = smoothstep( 0.55, 0.9, lawn ) * fade;
float n = gh( floor( wp * 0.35 ) );
float hgt = aOff.w * ( 0.7 + 0.6 * n ) * on;
float ca = cos( aOff.z ), sa = sin( aOff.z );
vec3 p = position;
// (off the lawn the whole tuft goes to nothing: flattened it would still lie on the paving as a sliver)
p.xz = vec2( p.x * ca - p.z * sa, p.x * sa + p.z * ca ) * ( 0.6 + 0.6 * on ) * step( 0.02, on );
p.y *= hgt;
// the wind: tips bend downwind, gusting
float gust = 0.6 + 0.4 * sin( uGT * 1.7 + wp.x * 0.21 + wp.y * 0.13 );
p.xz += uWind * 0.02 * gust * position.y * position.y;
vec3 transformed = vec3( wp.x + p.x, 0.04 + p.y, wp.y + p.z );
vGT = position.y;
vGTint = mix( vec3( 0.2, 0.3, 0.1 ), vec3( 0.25, 0.34, 0.11 ), n ) * mix( 1.0, 1.2, smoothstep( 0.7, 1.0, gh( floor( wp * 0.05 ) ) ) * position.y );`,
      )
      .replace('#include <beginnormal_vertex>', `vec3 objectNormal = vec3( 0.0, 1.0, 0.0 );`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vGT;\nvarying vec3 vGTint;`)
      .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb = vGTint * ( 0.85 + 0.4 * vGT );`)
      // (both faces lit as the ground is: the blades' normal is the lawn's, whichever side shows)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>\nnormal = normalize( vNormal );`);
  };
  mat.customProgramCacheKey = () => 'ow-grass-v4';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'grass';
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return {
    mesh,
    update(cam, t) {
      u.uCam.value.copy(cam);
      u.uGT.value = t;
      // high up, the blades are too small to see
      mesh.visible = cam.y < 60;
    },
  };
}
