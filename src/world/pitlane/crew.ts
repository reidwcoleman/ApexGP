import * as THREE from 'three';
import { TEAMS } from '../../race/Teams.ts';
import { Frame, TrackSpace, rng } from './geo.ts';
import { GARAGE_W, L, type PitPlan } from './layout.ts';
import type { BoxState } from '../PitComplex.ts';

/**
 * Pit crews: every person of every team is one instance of a single low-poly
 * rigged body (11 rigid bones + hand-held items), posed on the GPU from a
 * handful of per-instance numbers (walk phase/amplitude, crouch, kneel, lean,
 * arm raise, elbow bend, head yaw, held item, head variant, seated). The CPU
 * only moves people around and eases those numbers — one draw call (+ one
 * shadow draw) for ~240 people.
 */

// ------------------------------------------------------------------ rig

const BONE = { PELVIS: 0, TORSO: 1, HEAD: 2, UARM_L: 3, FARM_L: 4, UARM_R: 5, FARM_R: 6, THIGH_L: 7, SHIN_L: 8, THIGH_R: 9, SHIN_R: 10 } as const;
const ZONE = { PRIMARY: 0, SECONDARY: 1, HELMET: 2, VISOR: 3, BLACK: 4, SKIN: 5, METAL: 6, RUBBER: 7, COMPOUND: 8, RIM: 9, TEAM: 10, SCREEN: 11, WHITE: 12 } as const;
/** held items (instance picks one); 10/11 = head variants */
export const ITEM = { NONE: 0, GUN: 1, TYRE: 2, JACK: 3, TABLET: 4, HELMET: 10, HEAD: 11 } as const;

class RigBuilder {
  pos: number[] = [];
  nor: number[] = [];
  bone: number[] = [];
  zone: number[] = [];
  item: number[] = [];
  idx: number[] = [];
  add(src: THREE.BufferGeometry, m: THREE.Matrix4, bone: number, zone: number, item = 0) {
    const g = src.index ? src : src;
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const n = g.getAttribute('normal') as THREE.BufferAttribute;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const base = this.pos.length / 3;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      this.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.nor.push(v.x, v.y, v.z);
      this.bone.push(bone);
      this.zone.push(zone);
      this.item.push(item);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aBone', new THREE.Float32BufferAttribute(this.bone, 1));
    g.setAttribute('aZone', new THREE.Float32BufferAttribute(this.zone, 1));
    g.setAttribute('aItem', new THREE.Float32BufferAttribute(this.item, 1));
    g.setIndex(this.idx);
    return g;
  }
}

const M = () => new THREE.Matrix4();
const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
const S = (x: number, y: number, z: number) => new THREE.Matrix4().makeScale(x, y, z);
const RX = (a: number) => new THREE.Matrix4().makeRotationX(a);
const RZ = (a: number) => new THREE.Matrix4().makeRotationZ(a);
const RY = (a: number) => new THREE.Matrix4().makeRotationY(a);
const mul = (...ms: THREE.Matrix4[]) => ms.reduce((a, b) => a.multiply(b), M());

/** capsule whose end-sphere centres sit exactly on the two joints yA (top) and yB (bottom) — ball joints stay closed when bent */
let LOD = 0;
/** segment count for the current level of detail */
const q = (n: number, min = 3) => (LOD ? Math.max(min, Math.round(n * 0.55)) : n);
function limb(r: RigBuilder, x: number, z: number, yA: number, yB: number, rad: number, bone: number, zone: number, sx = 1, sz = 1, radial = 8) {
  const len = Math.max(0.01, yA - yB);
  const g = new THREE.CapsuleGeometry(rad, len, LOD ? 1 : 2, q(radial, 4));
  r.add(g, mul(T(x, (yA + yB) / 2, z), S(sx, 1, sz)), bone, zone);
}

export function buildRig(lod: 0 | 1 = 0): THREE.BufferGeometry {
  LOD = lod;
  const r = new RigBuilder();
  // hips: a squashed horizontal capsule; belt
  r.add(new THREE.CapsuleGeometry(0.115, 0.1, LOD ? 1 : 2, q(8)), mul(T(0, 0.95, 0), RZ(Math.PI / 2), S(1, 1, 0.72)), BONE.PELVIS, ZONE.PRIMARY);
  r.add(new THREE.CylinderGeometry(0.125, 0.125, 0.05, q(12), 1, true), mul(T(0, 1.03, 0), S(1.3, 1, 0.78)), BONE.PELVIS, ZONE.BLACK);
  // torso: abdomen + chest (wider at the shoulders), chest band, collar
  limb(r, 0, 0, 1.13, 1.06, 0.12, BONE.TORSO, ZONE.PRIMARY, 1.25, 0.8, 10);
  limb(r, 0, 0, 1.36, 1.28, 0.15, BONE.TORSO, ZONE.PRIMARY, 1.3, 0.76, 12);
  r.add(new THREE.CylinderGeometry(0.153, 0.153, 0.075, q(12), 1, true), mul(T(0, 1.335, 0), S(1.3, 1, 0.76)), BONE.TORSO, ZONE.SECONDARY);
  r.add(new THREE.CylinderGeometry(0.153, 0.153, 0.03, q(12), 1, true), mul(T(0, 1.275, 0), S(1.3, 1, 0.76)), BONE.TORSO, ZONE.WHITE);
  r.add(new THREE.CylinderGeometry(0.056, 0.062, 0.1, q(8), 1, true), T(0, 1.53, 0), BONE.TORSO, ZONE.BLACK);
  // crew head: helmet with visor + chin bar
  {
    r.add(new THREE.SphereGeometry(0.13, q(12), q(8)), mul(T(0, 1.665, 0.005), S(1, 1.06, 1.12)), BONE.HEAD, ZONE.HELMET, ITEM.HELMET);
    const visor = new THREE.SphereGeometry(0.134, q(10), LOD ? 2 : 3, -Math.PI * 0.3, Math.PI * 0.6, Math.PI * 0.4, Math.PI * 0.2);
    r.add(visor, mul(T(0, 1.665, 0.009), S(1, 1.06, 1.12)), BONE.HEAD, ZONE.VISOR, ITEM.HELMET);
    r.add(new THREE.BoxGeometry(0.15, 0.04, 0.06), T(0, 1.56, 0.1), BONE.HEAD, ZONE.BLACK, ITEM.HELMET);
  }
  // engineer head: face, cap with peak, headset
  {
    r.add(new THREE.SphereGeometry(0.1, q(9), q(7)), mul(T(0, 1.635, 0.012), S(0.9, 1.15, 1)), BONE.HEAD, ZONE.SKIN, ITEM.HEAD);
    const cap = new THREE.SphereGeometry(0.108, q(9), q(4, 2), 0, Math.PI * 2, 0, Math.PI * 0.46);
    r.add(cap, mul(T(0, 1.66, 0.0), S(0.94, 1.0, 1.02)), BONE.HEAD, ZONE.SECONDARY, ITEM.HEAD);
    r.add(new THREE.BoxGeometry(0.15, 0.012, 0.09), mul(T(0, 1.67, 0.12), RX(0.12)), BONE.HEAD, ZONE.SECONDARY, ITEM.HEAD);
    for (const sx of [-1, 1]) r.add(new THREE.CylinderGeometry(0.048, 0.048, 0.04, q(8)), mul(T(sx * 0.1, 1.625, 0), RZ(Math.PI / 2)), BONE.HEAD, ZONE.BLACK, ITEM.HEAD);
    r.add(new THREE.TorusGeometry(0.105, 0.011, 3, q(8), Math.PI), mul(T(0, 1.63, 0), RY(Math.PI / 2)), BONE.HEAD, ZONE.BLACK, ITEM.HEAD);
  }
  // arms: upper, fore, glove
  for (const sx of [1, -1]) {
    const up = sx > 0 ? BONE.UARM_L : BONE.UARM_R;
    const fo = sx > 0 ? BONE.FARM_L : BONE.FARM_R;
    const x = sx * 0.205;
    limb(r, x, 0, 1.43, 1.15, 0.058, up, ZONE.PRIMARY);
    r.add(new THREE.BoxGeometry(0.016, 0.26, 0.03), T(x + sx * 0.058, 1.3, 0), up, ZONE.SECONDARY);
    limb(r, x, 0, 1.15, 0.92, 0.048, fo, ZONE.PRIMARY);
    r.add(new THREE.SphereGeometry(0.052, q(7), q(5)), mul(T(x, 0.87, 0.012), S(0.75, 1.25, 1)), fo, ZONE.BLACK);
  }
  // legs: thigh + shin with a side stripe, boot
  for (const sx of [1, -1]) {
    const th = sx > 0 ? BONE.THIGH_L : BONE.THIGH_R;
    const sh = sx > 0 ? BONE.SHIN_L : BONE.SHIN_R;
    const x = sx * 0.1;
    limb(r, x, 0, 0.92, 0.5, 0.082, th, ZONE.PRIMARY);
    r.add(new THREE.BoxGeometry(0.014, 0.36, 0.035), T(x + sx * 0.087, 0.74, 0), th, ZONE.SECONDARY);
    limb(r, x, 0, 0.5, 0.12, 0.062, sh, ZONE.PRIMARY);
    r.add(new THREE.BoxGeometry(0.012, 0.3, 0.03), T(x + sx * 0.068, 0.3, 0), sh, ZONE.SECONDARY);
    r.add(new THREE.CapsuleGeometry(0.05, 0.14, LOD ? 1 : 2, q(6, 4)), mul(T(x, 0.05, 0.04), RX(Math.PI / 2), S(1.1, 1, 0.9)), sh, ZONE.BLACK);
  }
  // ---- held items
  // wheel gun in the right hand, barrel along the forearm
  {
    const x = -0.215;
    r.add(new THREE.CylinderGeometry(0.048, 0.052, 0.26, q(10)), T(x, 0.74, 0.02), BONE.FARM_R, ZONE.METAL, ITEM.GUN);
    r.add(new THREE.CylinderGeometry(0.036, 0.036, 0.09, q(8)), T(x, 0.57, 0.02), BONE.FARM_R, ZONE.BLACK, ITEM.GUN);
    r.add(new THREE.BoxGeometry(0.05, 0.1, 0.12), T(x, 0.86, -0.06), BONE.FARM_R, ZONE.BLACK, ITEM.GUN);
    r.add(new THREE.BoxGeometry(0.2, 0.035, 0.04), T(x + 0.1, 0.72, 0.05), BONE.FARM_R, ZONE.TEAM, ITEM.GUN);
    // hose trailing back and down
    r.add(new THREE.CylinderGeometry(0.018, 0.018, 0.9, q(6)), mul(T(x, 0.95, -0.35), RX(0.9)), BONE.FARM_R, ZONE.BLACK, ITEM.GUN);
  }
  // tyre on rim carried in front of the body (axle along the body's forward): lathed
  // profile with rounded shoulders, compound stripe on both sidewalls, dark rim
  {
    const z = 0.36, y = 0.97, rad = 0.35, w = 0.34, rimR = 0.225;
    const h = w / 2;
    const prof: THREE.Vector2[] = [];
    const push = (rr: number, yy: number) => prof.push(new THREE.Vector2(rr, yy));
    push(rimR, -h + 0.01);
    push(rad - 0.05, -h);
    for (let k = 1; k <= (LOD ? 1 : 3); k++) {
      const a = (k / (LOD ? 1 : 3)) * (Math.PI / 2);
      push(rad - 0.05 + Math.sin(a) * 0.05, -h + 0.05 - Math.cos(a) * 0.05);
    }
    for (let k = 0; k <= (LOD ? 1 : 3); k++) {
      const a = (k / (LOD ? 1 : 3)) * (Math.PI / 2);
      push(rad - 0.05 + Math.cos(a) * 0.05, h - 0.05 + Math.sin(a) * 0.05);
    }
    push(rad - 0.05, h);
    push(rimR, h - 0.01);
    const lathe = new THREE.LatheGeometry(prof, q(16));
    r.add(lathe, mul(T(0, y, z), RX(Math.PI / 2)), BONE.TORSO, ZONE.RUBBER, ITEM.TYRE);
    for (const sz of [-1, 1]) {
      const zz = z + sz * (h + 0.002);
      const ring = (r0: number, r1: number, zone: number, dz = 0) => {
        const g = new THREE.RingGeometry(r1, r0, q(16), 1);
        r.add(g, mul(T(0, y, zz + sz * dz), sz > 0 ? M() : RY(Math.PI)), BONE.TORSO, zone, ITEM.TYRE);
      };
      ring(rad * 0.84, rad * 0.77, ZONE.COMPOUND, 0.0);
      ring(rimR + 0.004, 0.05, ZONE.RIM, -0.035);
    }
    r.add(new THREE.CylinderGeometry(0.07, 0.07, w + 0.04, q(10)), mul(T(0, y, z), RX(Math.PI / 2)), BONE.TORSO, ZONE.METAL, ITEM.TYRE);
  }
  // jack: handle from the hands to a low trolley ahead; bound to the pelvis so it stays level
  {
    const y0 = 0.95, z0 = 0.32, y1 = 0.3, z1 = 1.25;
    const len = Math.hypot(y0 - y1, z1 - z0);
    const ang = Math.atan2(z1 - z0, y0 - y1);
    r.add(new THREE.CylinderGeometry(0.025, 0.025, len, q(8)), mul(T(0, (y0 + y1) / 2, (z0 + z1) / 2), RX(ang)), BONE.PELVIS, ZONE.METAL, ITEM.JACK);
    r.add(new THREE.BoxGeometry(0.46, 0.035, 0.035), T(0, y0 + 0.01, z0 - 0.01), BONE.PELVIS, ZONE.BLACK, ITEM.JACK);
    r.add(new THREE.BoxGeometry(0.34, 0.1, 0.55), T(0, 0.2, z1 + 0.15), BONE.PELVIS, ZONE.TEAM, ITEM.JACK);
    r.add(new THREE.BoxGeometry(0.28, 0.14, 0.14), T(0, 0.33, z1 + 0.38), BONE.PELVIS, ZONE.BLACK, ITEM.JACK);
    for (const sx of [-1, 1]) for (const dz of [-0.15, 0.35]) r.add(new THREE.CylinderGeometry(0.06, 0.06, 0.05, q(8)), mul(T(sx * 0.19, 0.06, z1 + dz), RZ(Math.PI / 2)), BONE.PELVIS, ZONE.BLACK, ITEM.JACK);
  }
  // tablet in the left hand
  r.add(new THREE.BoxGeometry(0.2, 0.26, 0.015), mul(T(0.215, 0.86, 0.1), RX(-0.3)), BONE.FARM_L, ZONE.BLACK, ITEM.TABLET);
  r.add(new THREE.BoxGeometry(0.17, 0.22, 0.004), mul(T(0.215, 0.86, 0.11), RX(-0.3)), BONE.FARM_L, ZONE.SCREEN, ITEM.TABLET);
  return r.geometry();
}

// ------------------------------------------------------------------ material (GPU pose)

const POSE_VERT = /* glsl */ `
attribute float aBone;
attribute float aZone;
attribute float aItem;
attribute vec4 iA; // x y z heading
attribute vec4 iB; // walk phase, walk amp, crouch, kneel
attribute vec4 iC; // lean, arm L, arm R, elbow
attribute vec4 iD; // head yaw, item, head variant (10 helmet / 11 bare head), seated
attribute vec4 iE; // compound rgb, scale (0 hides)
attribute vec3 iCol0;
attribute vec3 iCol1;
attribute vec3 iCol2;
varying vec3 vCrewCol;
varying vec3 vCrewPbr;
vec3 cRX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
vec3 cRY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }
vec3 cRZ(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z); }
void crewPose(inout vec3 p, inout vec3 n) {
  int b = int(aBone + 0.5);
  float ph = iB.x, amp = iB.y, crouch = iB.z, kneel = iB.w;
  float seated = iD.w;
  float sw = sin(ph) * amp;
  float thL = sw * 0.5 + crouch * 1.2;
  float thR = -sw * 0.5 + crouch * 1.2;
  float knL = max(0.0, -sin(ph)) * amp * 1.0 + amp * 0.12 + crouch * 2.05;
  float knR = max(0.0, sin(ph)) * amp * 1.0 + amp * 0.12 + crouch * 2.05;
  thL = mix(thL, 1.5, kneel); knL = mix(knL, 1.5, kneel);
  thR = mix(thR, -0.12, kneel); knR = mix(knR, 1.62, kneel);
  thL = mix(thL, 1.45, seated); knL = mix(knL, 1.2, seated);
  thR = mix(thR, 1.5, seated); knR = mix(knR, 1.55, seated);
  // hip height from whichever leg supports it (foot or knee on the ground)
  float LT = 0.43, LS = 0.43, FOOT = 0.06;
  float dL = max(LT * cos(thL) + LS * cos(thL - knL) + FOOT, LT * cos(thL) + 0.07);
  float dR = max(LT * cos(thR) + LS * cos(thR - knR) + FOOT, LT * cos(thR) + 0.07);
  float hip = max(dL, dR) + abs(sin(ph)) * amp * 0.035;
  hip = mix(hip, 0.1, seated);
  float lean = iC.x + amp * 0.12;
  float aL = iC.y - sw * 0.7, aR = iC.z + sw * 0.7;
  float el = iC.w + amp * 0.35;
  // legs
  if (b >= 7) {
    bool left = b <= 8;
    float th = left ? thL : thR;
    float kn = left ? knL : knR;
    vec3 hp = vec3(left ? 0.1 : -0.1, 0.92, 0.0);
    if (b == 8 || b == 10) {
      vec3 kp = vec3(hp.x, 0.5, 0.0);
      p = kp + cRX(p - kp, kn); n = cRX(n, kn);
    }
    p = hp + cRX(p - hp, -th); n = cRX(n, -th);
  }
  // arms
  if (b >= 3 && b <= 6) {
    bool left = b <= 4;
    float sx = left ? 1.0 : -1.0;
    vec3 sp = vec3(sx * 0.215, 1.43, 0.0);
    if (b == 4 || b == 6) {
      vec3 ep = vec3(sp.x, 1.15, 0.0);
      p = ep + cRX(p - ep, -el); n = cRX(n, -el);
    }
    float a = left ? aL : aR;
    float abd = sx * (abs(iD.y - 2.0) < 0.5 ? 0.4 : 0.1);
    p = sp + cRX(cRZ(p - sp, abd), -a); n = cRX(cRZ(n, abd), -a);
  }
  if (b == 2) {
    vec3 np = vec3(0.0, 1.52, 0.0);
    p = np + cRY(p - np, iD.x); n = cRY(n, iD.x);
  }
  if (b >= 1 && b <= 6) {
    vec3 tp = vec3(0.0, 1.0, 0.0);
    p = tp + cRX(p - tp, -lean); n = cRX(n, -lean);
  }
  p.y += hip - 0.92;
}
`;

const POSE_MAIN = /* glsl */ `
  vec3 transformed = vec3(position);
  vec3 cN = vec3(normal);
  {
    float it = aItem;
    float want = it < 5.0 ? iD.y : iD.z;
    float show = (it < 0.5 || abs(it - want) < 0.5) ? 1.0 : 0.0;
    crewPose(transformed, cN);
    transformed = cRY(transformed * iE.w * show, iA.w) + iA.xyz;
    cN = cRY(cN, iA.w);
  }
`;

const COLOR_VERT = /* glsl */ `
  {
    int z = int(aZone + 0.5);
    vec3 c = iCol0; vec3 m = vec3(0.72, 0.0, 0.0);
    if (z == 1) c = iCol1;
    else if (z == 2) { c = iCol2; m = vec3(0.22, 0.1, 0.0); }
    else if (z == 3) { c = vec3(0.012, 0.014, 0.018); m = vec3(0.06, 0.6, 0.0); }
    else if (z == 4) { c = vec3(0.018); m = vec3(0.75, 0.0, 0.0); }
    else if (z == 5) { c = mix(vec3(0.62, 0.42, 0.3), vec3(0.3, 0.19, 0.12), fract(iE.w * 37.0)); m = vec3(0.55, 0.0, 0.0); }
    else if (z == 6) { c = vec3(0.55, 0.56, 0.58); m = vec3(0.3, 0.9, 0.0); }
    else if (z == 7) { c = vec3(0.016); m = vec3(0.82, 0.0, 0.0); }
    else if (z == 8) { c = iE.rgb; m = vec3(0.55, 0.0, 0.0); }
    else if (z == 9) { c = vec3(0.05, 0.05, 0.055); m = vec3(0.35, 0.8, 0.0); }
    else if (z == 10) { c = iCol0; m = vec3(0.4, 0.3, 0.0); }
    else if (z == 11) { c = vec3(0.35, 0.5, 0.7); m = vec3(0.2, 0.0, 1.2); }
    else if (z == 12) { c = vec3(0.78); m = vec3(0.6, 0.0, 0.0); }
    vCrewCol = c;
    vCrewPbr = m;
  }
`;

export function crewMaterials(): { material: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial } {
  const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 1 });
  material.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${POSE_VERT}`)
      .replace('#include <beginnormal_vertex>', `${POSE_MAIN}\n  vec3 objectNormal = cN;\n${COLOR_VERT}`)
      .replace('#include <begin_vertex>', '');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vCrewCol;\nvarying vec3 vCrewPbr;`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n  diffuseColor.rgb = vCrewCol;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n  roughnessFactor = vCrewPbr.x;\n  metalnessFactor = vCrewPbr.y;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n  totalEmissiveRadiance += vCrewCol * vCrewPbr.z;`);
  };
  material.customProgramCacheKey = () => 'pit-crew-v1';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${POSE_VERT}`)
      .replace('#include <begin_vertex>', POSE_MAIN);
  };
  depth.customProgramCacheKey = () => 'pit-crew-depth-v1';
  return { material, depth };
}

// ------------------------------------------------------------------ choreography

interface Pose {
  crouch: number;
  kneel: number;
  lean: number;
  armL: number;
  armR: number;
  elbow: number;
  head: number;
  seated: number;
}
/** poses come from a small ring pool so the per-frame choreography allocates nothing */
const POSE_POOL: Pose[] = Array.from({ length: 32 }, () => ({ crouch: 0, kneel: 0, lean: 0, armL: 0, armR: 0, elbow: 0, head: 0, seated: 0 }));
let posePtr = 0;
const P = (crouch = 0, kneel = 0, lean = 0, armL = 0.08, armR = 0.08, elbow = 0.15, head = 0, seated = 0): Pose => {
  const o = POSE_POOL[posePtr++ & 31];
  o.crouch = crouch;
  o.kneel = kneel;
  o.lean = lean;
  o.armL = armL;
  o.armR = armR;
  o.elbow = elbow;
  o.head = head;
  o.seated = seated;
  return o;
};
/** a persistent copy (for data kept across frames) */
const Pk = (...a: Parameters<typeof P>): Pose => ({ ...P(...a) });

interface Spot {
  /** frame-local position (x along +s, z toward the pit side) */
  x: number;
  z: number;
  /** facing direction (frame-local) */
  fx: number;
  fz: number;
  pose: Pose;
  item: number;
}

const ROLE = { GUN: 0, OFF: 4, ON: 8, JACK_F: 12, JACK_R: 13, STAB: 14, WING: 16, CHIEF: 18, EXT: 19 } as const;
const BOX_CREW = 20;
const WALL_CREW = 4;
const PER_TEAM = BOX_CREW + WALL_CREW;

const WHEELS: [number, number][] = [
  [1.8, -0.8], // front, track side
  [1.8, 0.8], // front, garage side
  [-1.8, -0.8],
  [-1.8, 0.8],
];

const sm = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const face = (x: number, z: number, tx: number, tz: number) => {
  const dx = tx - x, dz = tz - z;
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l] as const;
};

/** where member i stands and how, in the box frame, for a state + progress */
const _spot: Spot = { x: 0, z: 0, fx: 0, fz: 1, pose: POSE_POOL[0], item: 0 };
function boxSpot(i: number, state: BoxState, p: number, tState: number): Spot {
  const S = (x: number, z: number, tx: number, tz: number, pose: Pose, item: number = ITEM.NONE): Spot => {
    const dx = tx - x, dz = tz - z;
    const l = Math.sqrt(dx * dx + dz * dz) || 1;
    _spot.x = x;
    _spot.z = z;
    _spot.fx = dx / l;
    _spot.fz = dz / l;
    _spot.pose = pose;
    _spot.item = item;
    return _spot;
  };
  const rel = state === 'release';
  if (i < 4) {
    // wheel guns
    const [wx, wz] = WHEELS[i];
    const o = Math.sign(wz);
    const busy = state === 'service' ? Math.max(sm(0.04, 0.12, p) * (1 - sm(0.24, 0.32, p)), sm(0.5, 0.58, p) * (1 - sm(0.76, 0.84, p))) : 0;
    const done = state === 'service' ? sm(0.84, 0.9, p) : 0;
    if (rel) return S(wx + (wx > 0 ? 0.2 : -0.2), wz + o * 1.7, wx, wz, P(0, 0, -0.05, 0.3, 0.9, 0.5), ITEM.GUN);
    return S(wx, wz + o * (0.98 - busy * 0.12), wx, wz, P(0, 1, 0.3 + busy * 0.12, 1.05 + done * 1.8, 1.2 + busy * 0.25, 0.32 - busy * 0.2), ITEM.GUN);
  }
  if (i < 8) {
    // tyre off
    const [wx, wz] = WHEELS[i - 4];
    const o = Math.sign(wz), f = Math.sign(wx);
    if (state === 'service') {
      const grab = sm(0.08, 0.16, p), away = sm(0.18, 0.36, p);
      const x = wx + f * (0.9 - grab * 0.55 + away * 0.9);
      const z = wz + o * (1.2 - grab * 0.45 + away * 1.0);
      const hold = p > 0.17;
      return S(x, z, wx, wz, P(0.4 - away * 0.3, 0, 0.25, hold ? 0.35 : 0.75, hold ? 0.35 : 0.75, hold ? 0.9 : 0.5), hold ? ITEM.TYRE : ITEM.NONE);
    }
    if (rel) return S(wx + f * 1.8, wz + o * 2.2, wx, wz, P(0, 0, 0, 0.35, 0.35, 0.9), ITEM.TYRE);
    return S(wx + f * 0.9, wz + o * 1.2, wx, wz, P(0.32, 0, 0.22, 0.45, 0.45, 0.8));
  }
  if (i < 12) {
    // tyre on
    const [wx, wz] = WHEELS[i - 8];
    const o = Math.sign(wz), f = Math.sign(wx);
    if (state === 'service') {
      const inn = sm(0.3, 0.44, p), back = sm(0.5, 0.68, p);
      const x = wx - f * (0.95 - inn * 0.6 + back * 0.4);
      const z = wz + o * (1.3 - inn * 0.62 + back * 0.6);
      const hold = p < 0.45;
      return S(x, z, wx, wz, P(0.3 - back * 0.25, 0, 0.2, hold ? 0.35 + inn * 0.3 : 0.2, hold ? 0.35 + inn * 0.3 : 0.2, hold ? 0.9 : 0.4), hold ? ITEM.TYRE : ITEM.NONE);
    }
    if (rel) return S(wx - f * 1.5, wz + o * 2.0, wx, wz, P(0, 0, 0, 0.2, 0.2, 0.3));
    return S(wx - f * 0.95, wz + o * 1.3, wx, wz, P(0.22, 0, 0.12, 0.35, 0.35, 0.9), ITEM.TYRE);
  }
  if (i === ROLE.JACK_F) {
    const lift = state === 'service' ? sm(0.02, 0.1, p) * (1 - sm(0.78, 0.86, p)) : 0;
    const out = state === 'service' ? sm(0.88, 0.98, p) : rel ? 1 : 0;
    return S(4.35 + out * 0.4, out * 2.4, 0, out * 2.4, P(0.1, 0, 0.2 - lift * 0.3, 0.75, 0.75, 0.3), ITEM.JACK);
  }
  if (i === ROLE.JACK_R) {
    const lift = state === 'service' ? sm(0.02, 0.1, p) * (1 - sm(0.78, 0.86, p)) : 0;
    // a little to the garage side of the car's centreline, so a chase camera still sees the car
    return S(-4.05 - (rel ? 0.6 : 0), 0.95, -2.7, 0.15, P(0.15, 0, 0.2 - lift * 0.3, 0.75, 0.75, 0.3), ITEM.JACK);
  }
  if (i === ROLE.STAB || i === ROLE.STAB + 1) {
    const o = i === ROLE.STAB ? -1 : 1;
    if (rel) return S(0.2, o * 2.3, 0, 0, P(0, 0, 0, 0.1, 0.1, 0.2));
    if (state === 'service') return S(0.2, o * 1.3, 0.2, 0, P(0.42, 0, 0.4, 0.95, 0.95, 0.25));
    return S(0.2, o * 1.45, 0.2, 0, P(0.3, 0, 0.3, 0.35, 0.35, 0.75));
  }
  if (i === ROLE.WING || i === ROLE.WING + 1) {
    const o = i === ROLE.WING ? -1 : 1;
    if (rel) return S(2.4, o * 2.2, 2.4, 0, P(0, 0, 0, 0.1, 0.1, 0.2));
    if (state === 'service') {
      const work = 0.2 * Math.sin(tState * 9);
      return S(2.65, o * 1.2, 2.7, 0, P(0.5, 0, 0.5, 0.9 + work, 0.9 - work, 0.35));
    }
    return S(2.65, o * 1.4, 2.7, 0, P(0.35, 0, 0.3, 0.3, 0.3, 0.8));
  }
  if (i === ROLE.CHIEF) {
    // watches the fast lane for traffic, hand on the release button
    return S(3.9, 2.2, -6, -2.5, P(0, 0, 0.05, 0.1, 1.0, 1.2, 0.2), ITEM.NONE);
  }
  // fire extinguisher / spare man
  return S(-2.9, 2.1, 0, 0, P(0, 0, 0, 0.5, 0.5, 0.6));
}

/** idle spots inside the garage (garage frame: x along s from the garage centre, z into the garage from the front) */
function idleSpots(k: number): Spot[] {
  const r = rng(1000 + k * 77);
  const out: Spot[] = [];
  const add = (x: number, z: number, fx: number, fz: number, pose: Pose, item: number = ITEM.NONE) => {
    const l = Math.hypot(fx, fz) || 1;
    out.push({ x, z, fx: fx / l, fz: fz / l, pose, item });
  };
  // engineers at the back desk, looking at the screens
  for (let i = 0; i < 5; i++) add(-3.6 + i * 1.8 + (r() - 0.5) * 0.3, 11.9 + (r() - 0.5) * 0.4, (r() - 0.5) * 0.3, 1, Pk(0, 0, 0.08, 0.35, 0.35, 1.3, (r() - 0.5) * 0.4), i === 2 ? ITEM.TABLET : ITEM.NONE);
  // mechanics at the tyre racks and toolboxes
  for (let i = 0; i < 4; i++) {
    const sx = i % 2 ? 1 : -1;
    add(sx * 7.1, 3.5 + i * 1.6 + r() * 0.5, sx, 0, Pk(i === 3 ? 0.5 : 0, 0, 0.25, 0.9, 0.7, 0.6));
  }
  // a group chatting near the front
  const gx = (r() - 0.5) * 4, gz = 3.6;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + r() * 0.4;
    add(gx + Math.cos(a) * 0.7, gz + Math.sin(a) * 0.7, -Math.cos(a), -Math.sin(a), Pk(0, 0, 0.02, 0.15 + r() * 0.3, 0.12, 0.3 + r() * 0.8, (r() - 0.5) * 0.6), i === 1 ? ITEM.TABLET : ITEM.NONE);
  }
  // around the spare wing / trolleys
  add(0.8, 8.2, -1, 0.2, Pk(0.55, 0, 0.3, 1.1, 1.1, 0.4));
  add(-0.6, 8.9, 1, -0.3, Pk(0, 0, 0.2, 0.9, 0.3, 0.8));
  // walkers (targets re-rolled at run time)
  for (let i = 0; i < 5; i++) add((r() - 0.5) * 12, 2 + r() * 10, 0, 1, Pk());
  return out;
}

// ------------------------------------------------------------------ system

export interface Seat {
  team: number;
  pos: THREE.Vector3;
  heading: number;
}

const COMPOUND_HEX: Record<string, string> = { soft: '#e3202e', medium: '#f3c300', hard: '#eeeeee', inter: '#2fb34a', wet: '#1f6fd6' };

/** one instanced draw of crew members at a level of detail */
class CrewBatch {
  readonly mesh: THREE.Mesh;
  readonly geo: THREE.InstancedBufferGeometry;
  readonly A: Float32Array;
  readonly B: Float32Array;
  readonly C: Float32Array;
  readonly D: Float32Array;
  readonly E: Float32Array;
  readonly C0: Float32Array;
  readonly C1: Float32Array;
  readonly C2: Float32Array;
  private readonly attrs: THREE.InstancedBufferAttribute[] = [];
  count = 0;
  constructor(lod: 0 | 1, n: number, material: THREE.Material, depth: THREE.Material) {
    const rig = buildRig(lod);
    const geo = (this.geo = new THREE.InstancedBufferGeometry());
    geo.index = rig.index;
    for (const k of ['position', 'normal', 'aBone', 'aZone', 'aItem']) geo.setAttribute(k, rig.getAttribute(k));
    const mk = (name: string, size: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(n * size), size).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, a);
      this.attrs.push(a);
      return a.array as Float32Array;
    };
    this.A = mk('iA', 4);
    this.B = mk('iB', 4);
    this.C = mk('iC', 4);
    this.D = mk('iD', 4);
    this.E = mk('iE', 4);
    this.C0 = mk('iCol0', 3);
    this.C1 = mk('iCol1', 3);
    this.C2 = mk('iCol2', 3);
    geo.instanceCount = 0;
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.customDepthMaterial = depth;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.name = lod ? 'pit_crew_far' : 'pit_crew';
  }
  commit() {
    this.geo.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * a.itemSize);
      a.needsUpdate = true;
    }
  }
}

export class CrewSystem {
  /** near (full detail) and far (light) crews, one draw call each */
  readonly group = new THREE.Group();
  private readonly n: number;
  private readonly near: CrewBatch;
  private readonly far: CrewBatch;
  // simulation state
  private readonly px: Float32Array;
  private readonly pz: Float32Array;
  private readonly py: Float32Array;
  private readonly hd: Float32Array;
  private readonly phase: Float32Array;
  private readonly speed: Float32Array;
  private readonly amp: Float32Array;
  private readonly pose: Float32Array; // 8 per member
  private readonly delay: Float32Array;
  private readonly wait: Float32Array;
  private readonly wTarget: Float32Array; // walker targets (x,z) in garage frame
  private readonly jit: Float32Array; // per-member pose variation
  private readonly item: Float32Array;
  private readonly headV: Float32Array;
  private readonly ecol: Float32Array; // compound rgb + scale
  private readonly c0: Float32Array;
  private readonly c1: Float32Array;
  private readonly c2: Float32Array;
  private readonly visible = new Uint8Array(16);
  private readonly cam = new THREE.Vector3();
  /** triangles per person at [full, far] detail */
  get rigTriangles(): [number, number] {
    return [this.near.geo.index!.count / 3, this.far.geo.index!.count / 3];
  }
  /** people drawn last frame at [full, far] detail */
  get drawn(): [number, number] {
    return [this.near.count, this.far.count];
  }
  private readonly team: { state: BoxState; p: number; t: number; boxF: Frame; garF: Frame; idle: Spot[]; center: THREE.Vector3 }[] = [];
  private readonly seats: Seat[];
  private readonly rand = rng(4242);
  private readonly ts: TrackSpace;
  private time = 0;

  constructor(plan: PitPlan, ts: TrackSpace, seats: Seat[]) {
    this.ts = ts;
    this.seats = seats;
    const nTeams = TEAMS.length;
    const n = (this.n = nTeams * PER_TEAM);
    const { material, depth } = crewMaterials();
    this.near = new CrewBatch(0, n, material, depth);
    this.far = new CrewBatch(1, n, material, depth);
    this.group.add(this.near.mesh, this.far.mesh);
    this.group.name = 'pit_crews';
    const c0 = (this.c0 = new Float32Array(n * 3)), c1 = (this.c1 = new Float32Array(n * 3)), c2 = (this.c2 = new Float32Array(n * 3));
    this.item = new Float32Array(n);
    this.headV = new Float32Array(n);
    this.ecol = new Float32Array(n * 4);
    this.px = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.py = new Float32Array(n);
    this.hd = new Float32Array(n);
    this.phase = new Float32Array(n);
    this.speed = new Float32Array(n);
    this.amp = new Float32Array(n);
    this.pose = new Float32Array(n * 8);
    this.delay = new Float32Array(n);
    this.wait = new Float32Array(n);
    this.wTarget = new Float32Array(n * 2);
    this.jit = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) this.jit[i] = this.rand() * 2 - 1;

    const tmp = new THREE.Color();
    TEAMS.forEach((t, k) => {
      const boxF = new Frame().at(ts, plan.boxS(k), L.box, 0);
      const g0 = plan.teamS0 + k * GARAGE_W;
      const garF = new Frame().at(ts, g0 + GARAGE_W / 2, L.front, 0.06);
      const idle = idleSpots(k);
      this.team.push({ state: 'idle', p: 0, t: 99, boxF, garF, idle, center: boxF.o.clone() });
      const prim = new THREE.Color(t.primary), sec = new THREE.Color(t.secondary), acc = new THREE.Color(t.accent);
      // dark suits read as black blobs: lift them a little toward the secondary
      const suit = prim.clone();
      if (suit.r + suit.g + suit.b < 0.08) suit.lerp(sec, 0.15).multiplyScalar(1.6);
      // helmets: the team colour when it is bright enough to read against the dark visor, else white
      const helmet = prim.r + prim.g + prim.b > 0.35 && k % 2 === 0 ? prim : new THREE.Color(0xe8e9ea);
      for (let j = 0; j < PER_TEAM; j++) {
        const i = k * PER_TEAM + j;
        suit.toArray(c0, i * 3);
        (sec.r + sec.g + sec.b < 0.05 ? acc : sec).toArray(c1, i * 3);
        (j >= BOX_CREW ? tmp.set(0x111214) : helmet).toArray(c2, i * 3);
        this.setCompoundColor(i, COMPOUND_HEX.medium);
        this.ecol[i * 4 + 3] = 0.95 + this.rand() * 0.09;
        // start at the idle spot
        if (j < BOX_CREW) {
          const sp = idle[j % idle.length];
          this.place(i, garF, sp);
          this.headV[i] = ITEM.HEAD;
        } else {
          const seat = seats.filter((s) => s.team === k)[j - BOX_CREW];
          if (seat) {
            this.px[i] = seat.pos.x;
            this.pz[i] = seat.pos.z;
            this.py[i] = seat.pos.y - 0.02;
            this.hd[i] = seat.heading;
            this.setPose(i, P(0, 0, 0.12, 0.95, 0.95, 1.0, 0, 1));
          } else this.ecol[i * 4 + 3] = 0;
          this.headV[i] = ITEM.HEAD;
        }
        const w = this.randomWalkTarget();
        this.wTarget[i * 2] = w[0];
        this.wTarget[i * 2 + 1] = w[1];
      }
    });
    this.visible.fill(1);
    this.writeAll();
  }

  private randomWalkTarget(): [number, number] {
    return [(this.rand() - 0.5) * 13, 1.5 + this.rand() * 10.5];
  }

  private setCompoundColor(i: number, hex: string) {
    const c = new THREE.Color(hex);
    this.ecol[i * 4] = c.r;
    this.ecol[i * 4 + 1] = c.g;
    this.ecol[i * 4 + 2] = c.b;
  }

  setCompound(team: number, compound: string) {
    const hex = COMPOUND_HEX[compound] ?? COMPOUND_HEX.medium;
    for (let j = 0; j < BOX_CREW; j++) this.setCompoundColor(team * PER_TEAM + j, hex);
  }

  private place(i: number, f: Frame, sp: Spot) {
    const w = f.p(sp.x, 0, sp.z);
    this.px[i] = w.x;
    this.pz[i] = w.z;
    this.py[i] = w.y;
    const d = f.dir(sp.fx, 0, sp.fz);
    this.hd[i] = Math.atan2(d.x, d.z);
    this.setPose(i, sp.pose);
    this.item[i] = sp.item;
  }

  private setPose(i: number, p: Pose) {
    const o = i * 8;
    const a = this.pose;
    a[o] = p.crouch;
    a[o + 1] = p.kneel;
    a[o + 2] = p.lean;
    a[o + 3] = p.armL;
    a[o + 4] = p.armR;
    a[o + 5] = p.elbow;
    a[o + 6] = p.head;
    a[o + 7] = p.seated;
  }

  setBox(team: number, state: BoxState, progress: number) {
    const T = this.team[team];
    if (!T) return;
    if (T.state !== state) {
      const prev = T.state;
      T.state = state;
      T.t = 0;
      if (state === 'ready' || (state === 'service' && prev === 'idle')) {
        for (let j = 0; j < BOX_CREW; j++) {
          this.delay[team * PER_TEAM + j] = state === 'service' ? 0 : this.rand() * 1.4;
        }
      }
      if (state === 'release') for (let j = 0; j < BOX_CREW; j++) this.delay[team * PER_TEAM + j] = 0.5 + this.rand() * 0.8;
    }
    T.p = progress;
  }

  /** signal state for the box light: 0 off, 1 red, 2 green */
  signal(team: number): number {
    const T = this.team[team];
    if (T.state === 'ready') return 1;
    if (T.state === 'service') return T.p < 0.9 ? 1 : 2;
    if (T.state === 'release') return T.t < 1.4 ? 2 : 0;
    return 0;
  }

  /** a sight line kept free of people (the garage camera → the car): segment a→b in xz, radius r */
  clear: { ax: number; az: number; bx: number; bz: number; r: number } | null = null;
  /** a team whose crew is not drawn (the menu garage has its own people) */
  hideTeam = -1;

  update(dt: number, camPos: THREE.Vector3) {
    this.time += dt;
    this.cam.copy(camPos);
    const tmpV = new THREE.Vector3();
    for (let k = 0; k < this.team.length; k++) {
      const T = this.team[k];
      T.t += dt;
      const near = camPos.distanceTo(T.center) < 260;
      this.visible[k] = near ? 1 : 0;
      if (!near) continue;
      // after the release, fall back to idle once everyone is home
      const f = T.boxF;
      for (let j = 0; j < PER_TEAM; j++) {
        const i = k * PER_TEAM + j;
        if (j >= BOX_CREW) {
          // pit-wall engineers: small head movements
          const o = i * 8;
          this.pose[o + 6] = Math.sin(this.time * 0.37 + j * 1.7) * 0.25 + (T.state !== 'idle' ? 0.45 : 0);
          this.pose[o + 3] = 0.95 + Math.sin(this.time * 0.9 + j) * 0.05;
          continue;
        }
        let sp: Spot;
        let frame: Frame;
        let home = false;
        const st = T.state;
        const goingOut = st === 'ready' || st === 'service' || (st === 'release' && this.delay[i] > 0);
        if (goingOut) {
          sp = boxSpot(j, st === 'release' ? 'release' : st, T.p, T.t);
          frame = f;
        } else {
          sp = T.idle[j % T.idle.length];
          frame = T.garF;
          home = true;
        }
        if (this.delay[i] > 0) {
          this.delay[i] -= dt;
          if (st === 'ready') {
            // still inside, about to go: put the helmet on
            this.headV[i] = ITEM.HELMET;
            continue;
          }
        }
        // walkers wander inside the garage
        const walker = home && j >= 15 && (j % T.idle.length) >= 15;
        let tx: number, tz: number;
        if (walker) {
          if (this.wait[i] > 0) this.wait[i] -= dt;
          tx = this.wTarget[i * 2];
          tz = this.wTarget[i * 2 + 1];
        } else {
          tx = sp.x;
          tz = sp.z;
        }
        const w = frame.p(tx, 0, tz, tmpV);
        const dx = w.x - this.px[i], dz = w.z - this.pz[i];
        const dist = Math.sqrt(dx * dx + dz * dz);
        const fast = st === 'service' ? 4.5 : goingOut ? 3.4 : 2.2;
        let moving = false;
        if (dist > 0.03 && !(walker && this.wait[i] > 0)) {
          const step = Math.min(dist, fast * dt * (dist > 1.5 ? 1 : 0.6 + 0.4 * (dist / 1.5)));
          this.px[i] += (dx / dist) * step;
          this.pz[i] += (dz / dist) * step;
          this.py[i] += (w.y - this.py[i]) * Math.min(1, dt * 8);
          this.speed[i] = step / Math.max(dt, 1e-4);
          moving = dist > 0.35;
          if (moving) {
            this.phase[i] += step * (Math.PI * 2) / 1.5;
            const want = Math.atan2(dx, dz);
            this.hd[i] = turn(this.hd[i], want, dt * 9);
          }
        } else {
          this.speed[i] = 0;
          if (walker && this.wait[i] <= 0) {
            this.wait[i] = 1.5 + this.rand() * 4;
            const nt = this.randomWalkTarget();
            this.wTarget[i * 2] = nt[0];
            this.wTarget[i * 2 + 1] = nt[1];
          }
        }
        if (!moving) {
          const d = frame.dir(sp.fx, 0, sp.fz, tmpV);
          if (!walker) this.hd[i] = turn(this.hd[i], Math.atan2(d.x, d.z), dt * 7);
        }
        // pose
        const amp = moving ? Math.min(1, this.speed[i] / 3.2) * 0.9 + 0.1 : 0;
        const o = i * 8;
        const held = this.item[i];
        const carry = held === ITEM.TYRE;
        const want = moving && !(st === 'service') ? P(0, 0, 0.05, carry ? 0.35 : 0.1, carry ? 0.35 : held === ITEM.GUN ? 0.5 : 0.1, carry ? 0.9 : 0.25) : sp.pose;
        const use = walker && !moving ? P(0, 0, 0.05, 0.12, 0.12, 0.3, Math.sin(this.time * 0.5 + i) * 0.4) : want;
        const kk = 1 - Math.exp(-dt * (st === 'service' ? 16 : 7));
        const jo = i * 4;
        const jv = moving ? 0 : 1;
        const ps = this.pose;
        ps[o] += (use.crouch - ps[o]) * kk;
        ps[o + 1] += (use.kneel - ps[o + 1]) * kk;
        ps[o + 2] += (use.lean + this.jit[jo] * 0.05 * jv - ps[o + 2]) * kk;
        ps[o + 3] += (use.armL + this.jit[jo + 1] * 0.08 * jv - ps[o + 3]) * kk;
        ps[o + 4] += (use.armR + this.jit[jo + 2] * 0.08 * jv - ps[o + 4]) * kk;
        ps[o + 5] += (use.elbow + this.jit[jo + 1] * 0.1 * jv - ps[o + 5]) * kk;
        ps[o + 6] += (use.head + this.jit[jo + 3] * 0.3 * jv - ps[o + 6]) * kk;
        ps[o + 7] += (use.seated - ps[o + 7]) * kk;
        // idle breathing / fidget
        if (!moving && home) this.pose[o + 6] += Math.sin(this.time * 0.6 + i * 1.3) * 0.004;
        this.amp[i] += (amp - this.amp[i]) * Math.min(1, dt * 10);
        // items: walking back after the stop the old tyre stays in hand; inside they drop it
        if (!home || dist < 1.0) this.item[i] = walker ? ITEM.NONE : sp.item;
        // helmets outside, bare heads inside
        this.headV[i] = home && (dist < 2.5 || walker) ? ITEM.HEAD : ITEM.HELMET;
      }
    }
    this.writeAll();
  }

  /** copy the members of visible teams into the near/far batches (by distance) and draw only those */
  private writeAll() {
    const near = this.near, far = this.far;
    near.count = 0;
    far.count = 0;
    const cx = this.cam.x, cz = this.cam.z;
    for (let k = 0; k < this.team.length; k++) {
      if (!this.visible[k] || k === this.hideTeam) continue;
      for (let j = 0; j < PER_TEAM; j++) {
        const i = k * PER_TEAM + j;
        if (this.ecol[i * 4 + 3] === 0) continue;
        const dx = this.px[i] - cx, dz = this.pz[i] - cz;
        const d2 = dx * dx + dz * dz;
        // never let the camera end up inside someone
        if (d2 < 0.8 * 0.8 && Math.abs(this.py[i] + 1 - this.cam.y) < 1.2) continue;
        const cl = this.clear;
        if (cl) {
          const ux = cl.bx - cl.ax, uz = cl.bz - cl.az;
          const t = Math.max(0, Math.min(1, ((this.px[i] - cl.ax) * ux + (this.pz[i] - cl.az) * uz) / (ux * ux + uz * uz || 1)));
          const ex = cl.ax + ux * t - this.px[i], ez = cl.az + uz * t - this.pz[i];
          if (ex * ex + ez * ez < cl.r * cl.r) continue;
        }
        const b = d2 < 32 * 32 ? near : far;
        const slot = b.count++;
        const o = i * 8, q4 = slot * 4, q3 = slot * 3;
        const A = b.A, B = b.B, C = b.C, D = b.D, E = b.E;
        A[q4] = this.px[i];
        A[q4 + 1] = this.py[i];
        A[q4 + 2] = this.pz[i];
        A[q4 + 3] = this.hd[i];
        B[q4] = this.phase[i];
        B[q4 + 1] = this.amp[i];
        B[q4 + 2] = this.pose[o];
        B[q4 + 3] = this.pose[o + 1];
        C[q4] = this.pose[o + 2];
        C[q4 + 1] = this.pose[o + 3];
        C[q4 + 2] = this.pose[o + 4];
        C[q4 + 3] = this.pose[o + 5];
        D[q4] = this.pose[o + 6];
        D[q4 + 1] = this.item[i];
        D[q4 + 2] = this.headV[i];
        D[q4 + 3] = this.pose[o + 7];
        E[q4] = this.ecol[i * 4];
        E[q4 + 1] = this.ecol[i * 4 + 1];
        E[q4 + 2] = this.ecol[i * 4 + 2];
        E[q4 + 3] = this.ecol[i * 4 + 3];
        for (let c = 0; c < 3; c++) {
          b.C0[q3 + c] = this.c0[i * 3 + c];
          b.C1[q3 + c] = this.c1[i * 3 + c];
          b.C2[q3 + c] = this.c2[i * 3 + c];
        }
      }
    }
    near.commit();
    far.commit();
  }
}

function turn(a: number, b: number, rate: number) {
  let d = b - a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return a + d * Math.min(1, rate);
}
