import { TEAM_COUNT } from './layout.ts';
import * as THREE from 'three';
import { weatherUniforms } from '../weatherUniforms.ts';
import { pitU } from './materials.ts';
import { rng, type TrackSpace } from './geo.ts';
import { L, type PitPlan } from './layout.ts';
import { H } from './building.ts';

/**
 * Rain dripping off the edges of the canopy, the terrace slab, the pit-wall
 * stand roofs and the podium: each drop swells at the edge, falls under
 * gravity as a camera-facing streak that stretches with speed, and repeats.
 * One draw call, animated entirely in the vertex shader; hidden when dry.
 */

export class DripBuilder {
  pos: number[] = [];
  drip: number[] = [];
  private r = rng(777);
  /** drops along the segment a→b, every `spacing` m, falling `fall` m */
  edge(a: THREE.Vector3, b: THREE.Vector3, spacing: number, fall: number) {
    const n = Math.max(1, Math.floor(a.distanceTo(b) / spacing));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.2 + this.r() * 0.6) / n;
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
      const phase = this.r();
      const rate = 0.6 + this.r() * 0.9;
      const f = fall * (0.97 + this.r() * 0.03);
      for (let c = 0; c < 4; c++) {
        this.pos.push(x, y, z);
        this.drip.push(f, phase, rate, c);
      }
    }
  }
  mesh(): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aDrip', new THREE.Float32BufferAttribute(this.drip, 4));
    const idx: number[] = [];
    for (let i = 0; i < this.pos.length / 3; i += 4) idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
    g.setIndex(idx);
    g.computeBoundingSphere();
    if (g.boundingSphere) g.boundingSphere.radius += 20;
    const m = new THREE.MeshBasicMaterial({ color: 0xcfd8e0, transparent: true, opacity: 0.55, depthWrite: false });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = pitU.uTime;
      sh.uniforms.uRain = weatherUniforms.uRain;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\nattribute vec4 aDrip;\nuniform float uTime;\nuniform float uRain;\nvarying float vDripA;`)
        .replace(
          '#include <begin_vertex>',
          `vec3 transformed = vec3(position);
  {
    float H = aDrip.x;
    float tFall = sqrt(2.0 * H / 9.81);
    float hang = mix(1.6, 0.35, clamp(uRain, 0.0, 1.0));
    float cyc = hang + tFall;
    float tc = mod(uTime * aDrip.z + aDrip.y * cyc, cyc);
    float tf = max(tc - hang, 0.0);
    float y = -0.5 * 9.81 * tf * tf;
    float v = 9.81 * tf;
    float len = clamp(v * 0.022, 0.025, 0.3);
    float swell = tc < hang ? tc / hang : 1.0;
    int c = int(aDrip.w + 0.5);
    vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
    float w = (tf > 0.0 ? 0.006 : 0.009 * swell);
    float sx = (c == 0 || c == 3) ? -1.0 : 1.0;
    float top = (c >= 2) ? 1.0 : 0.0;
    float yy = tf > 0.0 ? y + top * len : -0.018 * swell + top * 0.018 * swell;
    transformed += right * sx * w + vec3(0.0, yy, 0.0);
    vDripA = uRain > 0.02 ? (tf > 0.0 ? 1.0 : 0.6 * swell) : 0.0;
    transformed *= uRain > 0.02 ? 1.0 : 0.0;
  }`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying float vDripA;`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n  diffuseColor.a *= vDripA;`);
    };
    m.customProgramCacheKey = () => 'pit-drips-v1';
    const mesh = new THREE.Mesh(g, m);
    mesh.name = 'pit_drips';
    mesh.renderOrder = 3;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }
}

/** drip lines along the complex's exposed edges */
export function buildDrips(plan: PitPlan, ts: TrackSpace): THREE.Mesh {
  const d = new DripBuilder();
  const F = L.front;
  const S0 = plan.bldgS0, S1 = plan.bldgS1;
  // canopy blade (sponsor band underside) and the first-floor terrace edge
  d.edge(ts.P(S0 - 3, F - 6.33, H.roof - 0.26), ts.P(S1 + 3, F - 6.33, H.roof - 0.26), 0.55, H.roof - 0.28);
  d.edge(ts.P(S0 - 0.8, F - 2.33, H.slab1 - 0.01), ts.P(S1 + 0.8, F - 2.33, H.slab1 - 0.01), 0.6, H.slab1 - 0.03);
  // podium deck front edge
  d.edge(ts.P(plan.podiumS0, plan.podiumTip - 0.05, H.slab1 - 0.81), ts.P(plan.podiumS1, plan.podiumTip - 0.05, H.slab1 - 0.81), 0.45, H.slab1 - 0.82);
  // pit-wall stand roofs: lane side falls to the lane, track side onto the wall top
  const w1 = L.wall + L.wallT;
  for (let k = 0; k < TEAM_COUNT; k++) {
    const s = plan.boxS(k);
    d.edge(ts.P(s - 3.75, w1 + 1.58, 2.8), ts.P(s + 3.75, w1 + 1.58, 2.8), 0.32, 2.78);
    d.edge(ts.P(s - 3.75, w1 - 0.34, 2.8), ts.P(s + 3.75, w1 - 0.34, 2.8), 0.32, 2.8 - L.wallH);
  }
  return d.mesh();
}
