import * as THREE from 'three';
import type { Track } from '../world/Track.ts';
import type { RacingProfile } from '../sim/RacingProfile.ts';

export type LineMode = 'off' | 'corners' | 'full';

/**
 * The F1-game dynamic racing line: a chevron ribbon painted on the racing line
 * ahead of the player. Each point compares the player's current speed with the
 * target speed there — green: accelerate, yellow: lift, red: brake — so braking
 * points light up red as you approach them too fast and turn green as you slow.
 * 'corners' only draws braking zones and corners.
 */

const VERT = /* glsl */ `
attribute float aS;
attribute float aV;
attribute float aCorner;
attribute float aSide;
varying float vS;
varying float vV;
varying float vCorner;
varying float vSide;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vS = aS;
  vV = aV;
  vCorner = aCorner;
  vSide = aSide;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const FRAG = /* glsl */ `
uniform float uPlayerS;
uniform float uPlayerV;
uniform float uLap;
uniform float uMode;
uniform float uIntensity;
varying float vS;
varying float vV;
varying float vCorner;
varying float vSide;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float d = vS - uPlayerS;
  d = d - floor(d / uLap) * uLap;          // distance ahead along the lap
  if (d > uLap * 0.5) discard;
  float fade = smoothstep(6.0, 16.0, d) * (1.0 - smoothstep(110.0, 190.0, d));
  if (uMode < 1.5) fade *= vCorner;        // corners-only
  if (fade < 0.01) discard;
  // colour from the speed you carry now vs the target speed at this point
  float over = uPlayerV - vV;
  vec3 green = vec3(0.10, 0.95, 0.35);
  vec3 yellow = vec3(1.0, 0.82, 0.12);
  vec3 red = vec3(1.0, 0.12, 0.08);
  vec3 col = green;
  col = mix(col, yellow, smoothstep(-2.5, 0.5, over));
  col = mix(col, red, smoothstep(1.5, 4.0, over));
  // chevrons pointing along the direction of travel
  float u = vSide;                                  // −1 .. 1 across the ribbon
  float t = fract(vS / 2.2 - abs(u) * 0.35);
  float chev = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.52, 0.6, t));
  float edge = 1.0 - smoothstep(0.82, 1.0, abs(u));
  float a = fade * edge * mix(0.45, 0.95, chev);
  gl_FragColor = vec4(col * uIntensity * mix(0.7, 1.15, chev), a);
}
`;

export class RacingLineAssist {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  mode: LineMode = 'full';

  constructor(track: Track, profile: RacingProfile) {
    const step = 1.5;
    const n = Math.floor(track.length / step);
    const width = 0.62;
    const pos = new Float32Array((n + 1) * 2 * 3);
    const aS = new Float32Array((n + 1) * 2);
    const aV = new Float32Array((n + 1) * 2);
    const aCorner = new Float32Array((n + 1) * 2);
    const aSide = new Float32Array((n + 1) * 2);
    const idx: number[] = [];

    // corner mask: braking zones + corners = where the target speed is falling
    // or well below the car's top speed, padded a little
    const L = track.length;
    const vmaxLap = Math.max(...Array.from(profile.vmax));
    const mask = new Float32Array(L);
    for (let i = 0; i < L; i++) {
      const v = profile.vmax[i];
      const vNext = profile.vmax[(i + 40) % L];
      if (v < vmaxLap * 0.9 || vNext < v - 1.5) mask[i] = 1;
    }
    const maskS = new Float32Array(L);
    for (let i = 0; i < L; i++) {
      let m = 0;
      for (let k = -25; k <= 12; k += 3) m = Math.max(m, mask[(i + k + L) % L]);
      maskS[i] = m;
    }

    const p = new THREE.Vector3();
    for (let j = 0; j <= n; j++) {
      const s = j * step;
      const lat = track.racingLineAt(s);
      for (let side = 0; side < 2; side++) {
        const o = side === 0 ? -width / 2 : width / 2;
        track.point(s, lat + o, 0.035, p);
        const k = j * 2 + side;
        pos[k * 3] = p.x;
        pos[k * 3 + 1] = p.y;
        pos[k * 3 + 2] = p.z;
        aS[k] = s;
        aV[k] = profile.at(s);
        aCorner[k] = maskS[Math.floor(s) % L];
        aSide[k] = side === 0 ? -1 : 1;
      }
      if (j < n) {
        const a = j * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aS', new THREE.BufferAttribute(aS, 1));
    geo.setAttribute('aV', new THREE.BufferAttribute(aV, 1));
    geo.setAttribute('aCorner', new THREE.BufferAttribute(aCorner, 1));
    geo.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
    geo.setIndex(idx);
    geo.computeBoundingSphere();

    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uPlayerS: { value: 0 },
        uPlayerV: { value: 0 },
        uLap: { value: track.length },
        uMode: { value: 2 },
        uIntensity: { value: 1.1 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  setMode(m: LineMode) {
    this.mode = m;
    this.mesh.visible = m !== 'off';
    this.mat.uniforms.uMode.value = m === 'full' ? 2 : 1;
  }

  /** dim a little at golden hour so it doesn't glow */
  setIntensity(v: number) {
    this.mat.uniforms.uIntensity.value = v;
  }

  update(playerS: number, playerV: number) {
    this.mat.uniforms.uPlayerS.value = playerS;
    this.mat.uniforms.uPlayerV.value = playerV;
  }
}
