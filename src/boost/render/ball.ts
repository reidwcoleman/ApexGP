import * as THREE from 'three';
import { sdf } from '../sim/arena.ts';
import { BALL } from '../sim/ball.ts';

/**
 * The ball: a truncated-icosahedron panel layout found per pixel (the nearest of the 12 icosahedron
 * vertices and 20 face centres gives the pentagons and hexagons), brushed silver panels with a dark
 * inset hex, glowing seams that flare on every hit and take the colour of the last team to touch it.
 */

function panelCentres(): THREE.Vector3[] {
  const ico = new THREE.IcosahedronGeometry(1, 0);
  const p = ico.attributes.position as THREE.BufferAttribute;
  const verts: THREE.Vector3[] = [];
  const key = (v: THREE.Vector3) => `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
  const seen = new Set<string>();
  const faces: THREE.Vector3[] = [];
  for (let i = 0; i < p.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(p, i);
    const b = new THREE.Vector3().fromBufferAttribute(p, i + 1);
    const c = new THREE.Vector3().fromBufferAttribute(p, i + 2);
    faces.push(a.clone().add(b).add(c).normalize());
    for (const v of [a, b, c]) {
      const k = key(v);
      if (!seen.has(k)) {
        seen.add(k);
        verts.push(v.clone().normalize());
      }
    }
  }
  return [...verts, ...faces];
}

export class BallView {
  readonly mesh: THREE.Mesh;
  readonly glow: THREE.Mesh;
  /** the shadow straight under the ball on the floor (the real game's read for aerials), whatever the light */
  readonly shadow: THREE.Mesh;
  private uHit = { value: 0 };
  private uCol = { value: new THREE.Color(1, 1, 1) };
  private uT = { value: 0 };
  /** 0…1 how fast it's going (the seams and the rim burn brighter) */
  private uSpd = { value: 0 };

  constructor() {
    const pts = panelCentres();
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.62, roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.08, envMapIntensity: 1.4 });
    const uPts = { value: pts };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uPts = uPts;
      sh.uniforms.uHit = this.uHit;
      sh.uniforms.uCol = this.uCol;
      sh.uniforms.uT = this.uT;
      sh.uniforms.uSpd = this.uSpd;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vDir;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvDir = normalize(position);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vDir;\nuniform vec3 uPts[32];\nuniform float uHit;\nuniform vec3 uCol;\nuniform float uT;\nuniform float uSpd;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          vec3 d = normalize(vDir);
          float b1 = -2.0, b2 = -2.0; int bi = 0;
          for (int i = 0; i < 32; i++) { float k = dot(d, uPts[i]); if (k > b1) { b2 = b1; b1 = k; bi = i; } else if (k > b2) { b2 = k; } }
          float seam = 1.0 - smoothstep(0.0, 0.012, b1 - b2);
          float inset = smoothstep(0.004, 0.02, b1 - b2) * (1.0 - smoothstep(0.035, 0.05, b1 - b2));
          float pent = bi < 12 ? 1.0 : 0.0;
          // a fine honeycomb pressed into every panel, laid out in the panel's own plane
          vec3 pc = uPts[0];
          for (int i = 0; i < 32; i++) if (i == bi) pc = uPts[i];
          vec3 ax = normalize(cross(pc, abs(pc.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
          vec3 ay = cross(pc, ax);
          vec2 hp = vec2(dot(d, ax), dot(d, ay)) * 26.0;
          vec2 hs = vec2(1.0, 1.7320508);
          vec2 ha = mod(hp, hs) - hs * 0.5;
          vec2 hb = mod(hp - hs * 0.5, hs) - hs * 0.5;
          vec2 hg = dot(ha, ha) < dot(hb, hb) ? ha : hb;
          hg = abs(hg);
          float hexE = 0.5 - max(dot(hg, normalize(hs)), hg.x);
          float comb = (1.0 - smoothstep(0.03, 0.09, hexE)) * (1.0 - smoothstep(0.6, 1.4, length(fwidth(hp))));
          vec3 base = mix(vec3(0.86, 0.87, 0.9), vec3(0.2, 0.21, 0.24), pent);
          base *= 1.0 - comb * 0.22;
          base = mix(base, base * 0.5, inset);
          diffuseColor.rgb = mix(base, vec3(0.04), seam);
          `,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          // energy running along the seams: pulses racing round the ball after a hit, a steady
          // shimmer at speed
          float flow = pow(0.5 + 0.5 * sin(dot(d, vec3(0.6, 0.5, 0.62)) * 22.0 - uT * 9.0), 6.0);
          float seamE = seam * (0.3 + 3.2 * uHit + uSpd * 1.4 + flow * (1.6 * uHit + 0.9 * uSpd));
          totalEmissiveRadiance += uCol * (seamE + inset * (0.6 * uHit + 0.25 * uSpd) + pent * (0.08 + 0.2 * uSpd));
          // a rim of the last toucher's light round the silhouette
          float rimV = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 3.0);
          totalEmissiveRadiance += uCol * rimV * (0.12 + 0.6 * uSpd + 0.8 * uHit);`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.55, seam) + comb * 0.15;');
    };
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL.R, 96, 64), mat);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    const sm = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uA: { value: 0.6 } },
      vertexShader: `varying vec2 vU; void main(){ vU = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uA; varying vec2 vU; void main(){ float d = length(vU); float k = 1.0 - smoothstep(0.55, 1.0, d); gl_FragColor = vec4(0.0, 0.0, 0.0, k * uA); }`,
    });
    sm.polygonOffset = true;
    sm.polygonOffsetFactor = -2;
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sm);
    this.shadow.renderOrder = 3;
    // a soft fresnel halo that shows when it's moving fast
    const halo = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uK: { value: 0 }, uCol: this.uCol },
      vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform float uK; uniform vec3 uCol; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(max(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0), 2.5); gl_FragColor = vec4(uCol * f * uK * 1.5, f*uK); }`,
    });
    this.glow = new THREE.Mesh(new THREE.SphereGeometry(BALL.R * 1.18, 32, 24), halo);
    this.glow.renderOrder = 7;
  }

  hit(power: number, team: number): void {
    this.uHit.value = Math.min(1, 0.3 + power / 3000);
    this.uCol.value.set(team === 0 ? 0x4aa0ff : team === 1 ? 0xff8a30 : 0xffffff);
  }

  update(pos: THREE.Vector3, quat: THREE.Quaternion, speed: number, dt: number): void {
    this.mesh.position.copy(pos);
    this.mesh.quaternion.copy(quat);
    this.glow.position.copy(pos);
    // darker and tighter near the floor, wider and fainter up high
    const h = Math.max(0, pos.z - BALL.R);
    this.shadow.position.set(pos.x, pos.y, 1.5);
    this.shadow.scale.setScalar(BALL.R * (0.95 + Math.min(0.6, h / 2500)));
    // (on the flat floor only: it fades out where the floor curves up into the walls)
    const edge = THREE.MathUtils.smoothstep(sdf(pos.x, pos.y, 40), 20, 160);
    (this.shadow.material as THREE.ShaderMaterial).uniforms.uA.value = (0.62 - Math.min(0.32, h / 4000)) * edge;
    this.uHit.value = Math.max(0, this.uHit.value - dt * 1.6);
    this.uT.value += dt;
    this.uSpd.value += (THREE.MathUtils.smoothstep(speed, 1800, 4500) - this.uSpd.value) * Math.min(1, dt * 6);
    (this.glow.material as THREE.ShaderMaterial).uniforms.uK.value = THREE.MathUtils.smoothstep(speed, 2500, 5000) * 0.9 + this.uHit.value * 0.4;
  }
}
