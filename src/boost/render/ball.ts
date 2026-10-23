import * as THREE from 'three';
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
  private uHit = { value: 0 };
  private uCol = { value: new THREE.Color(1, 1, 1) };

  constructor() {
    const pts = panelCentres();
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.75, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.15, envMapIntensity: 1.3 });
    const uPts = { value: pts };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uPts = uPts;
      sh.uniforms.uHit = this.uHit;
      sh.uniforms.uCol = this.uCol;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vDir;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvDir = normalize(position);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vDir;\nuniform vec3 uPts[32];\nuniform float uHit;\nuniform vec3 uCol;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          vec3 d = normalize(vDir);
          float b1 = -2.0, b2 = -2.0; int bi = 0;
          for (int i = 0; i < 32; i++) { float k = dot(d, uPts[i]); if (k > b1) { b2 = b1; b1 = k; bi = i; } else if (k > b2) { b2 = k; } }
          float seam = 1.0 - smoothstep(0.0, 0.012, b1 - b2);
          float inset = smoothstep(0.004, 0.02, b1 - b2) * (1.0 - smoothstep(0.035, 0.05, b1 - b2));
          float pent = bi < 12 ? 1.0 : 0.0;
          vec3 base = mix(vec3(0.82, 0.84, 0.88), vec3(0.22, 0.24, 0.28), pent);
          base = mix(base, base * 0.55, inset);
          diffuseColor.rgb = mix(base, vec3(0.05), seam);
          `,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          totalEmissiveRadiance += uCol * (seam * (0.35 + 3.0 * uHit) + inset * 0.6 * uHit + pent * 0.08);`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.55, seam);');
    };
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL.R, 96, 64), mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
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
    this.uHit.value = Math.max(0, this.uHit.value - dt * 2.2);
    (this.glow.material as THREE.ShaderMaterial).uniforms.uK.value = THREE.MathUtils.smoothstep(speed, 2500, 5000) * 0.9 + this.uHit.value * 0.4;
  }
}
