import * as THREE from 'three';
import type { Car } from '../sim/car.ts';
import { unpackLoadout } from '../loadout.ts';
import { carModel } from './carmodel.ts';

/**
 * A battle car built from code, in the simulation's car frame (cm; x forward, y left, z up, the
 * ground at z = −17). An original body in the arena game's proportions: a compact tub filling the
 * hitbox, fenders swelling over chunky wheels with slim arch lips and dark wells, a tall cabin with a
 * steep screen and big glass, a short nose, a ducktail spoiler and twin boost nozzles. Every panel is
 * a lofted superellipse so the paint carries smooth reflections; team paint under a clear coat with
 * the player's accent in the stripes, swoosh, spoiler and rims.
 */

export const TEAM_COLORS = [0x1458ff, 0xff5a0a];

/** a slick's tread for the bump map: three circumferential grooves and fine sipes, a raised
 * lettering band on the sidewall (the lathe's v runs across the tyre) */
let treadTex: THREE.CanvasTexture | null = null;
function tread(): THREE.CanvasTexture {
  if (treadTex) return treadTex;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = '#fff';
  x.fillRect(0, 0, 512, 256);
  x.fillStyle = '#000';
  for (const v of [0.4, 0.5, 0.6]) x.fillRect(0, v * 256 - 2, 512, 4);
  x.fillStyle = '#777';
  for (let i = 0; i < 64; i++) {
    const u = (i / 64) * 512;
    x.fillRect(u, 0.33 * 256, 2, 0.06 * 256);
    x.fillRect(u + 4, 0.61 * 256, 2, 0.06 * 256);
  }
  // sidewall rings
  x.fillStyle = '#bbb';
  for (const v of [0.12, 0.88]) x.fillRect(0, v * 256 - 3, 512, 6);
  treadTex = new THREE.CanvasTexture(c);
  treadTex.wrapS = THREE.RepeatWrapping;
  treadTex.anisotropy = 4;
  return treadTex;
}

/** a fine hex mesh for the grille */
let meshTex: THREE.CanvasTexture | null = null;
function grilleTex(): THREE.CanvasTexture {
  if (meshTex) return meshTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = '#16181c';
  x.fillRect(0, 0, 256, 64);
  x.fillStyle = '#020203';
  for (let r = 0; r < 8; r++)
    for (let q = 0; q < 34; q++) {
      const cx = q * 8 + (r % 2) * 4;
      const cy = r * 8 + 4;
      x.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        x.lineTo(cx + Math.cos(a) * 3.2, cy + Math.sin(a) * 3.2);
      }
      x.fill();
    }
  meshTex = new THREE.CanvasTexture(c);
  meshTex.colorSpace = THREE.SRGBColorSpace;
  return meshTex;
}

export { DECALS, FINISHES } from '../loadout.ts';

export class CarView {
  readonly group = new THREE.Group();
  private readonly paint: THREE.MeshPhysicalMaterial;
  private wheels: { pivot: THREE.Group; spin: THREE.Group; r: number; front: boolean; z0: number }[] = [];
  private flames: THREE.Mesh[] = [];
  private flameMat: THREE.ShaderMaterial;
  private coreMat: THREE.ShaderMaterial;
  private cores: THREE.Mesh[] = [];
  private nozzleGlow: THREE.MeshBasicMaterial;
  private spin = 0;
  private tag: THREE.Sprite | null = null;
  readonly team: number;
  boostVis = 0;
  readonly loadout: ReturnType<typeof unpackLoadout>;
  /** where the boost jets leave the car (car frame), for the trail */
  readonly jets: THREE.Vector3[] = [];
  /** the height the car's origin rides at on flat ground */
  readonly rest: number;
  /** a soft contact shadow on whatever surface the wheels are on */
  private contact: THREE.Mesh;

  /** color: the accent in the low 24 bits, the decal and finish above them (see carLook) */
  constructor(team: number, color: number, name?: string) {
    this.team = team;
    const look = unpackLoadout(color);
    this.loadout = look;
    const { g, rig: R } = carModel(look.body);
    this.rest = -R.ground;
    const teamC = new THREE.Color(TEAM_COLORS[team]);
    const accC = new THREE.Color(look.accent);
    // the paint: candy gloss (a saturated base under a mirror clear coat), matte, metallic or pearl
    const fin = [
      { metalness: 0.35, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.8 },
      { metalness: 0.05, roughness: 0.62, clearcoat: 0.15, clearcoatRoughness: 0.6, envMapIntensity: 0.7 },
      { metalness: 0.88, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 2.2 },
      { metalness: 0.4, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.9, iridescence: 1, iridescenceIOR: 1.7, iridescenceThicknessRange: [250, 700] as [number, number] },
    ][look.finish];
    this.paint = new THREE.MeshPhysicalMaterial({ color: teamC, ...fin });
    const uAcc = { value: accC };
    const uTeam = { value: teamC.clone() };
    const uDecal = { value: look.decal };
    const uArchF = { value: new THREE.Vector3(...R.archF) };
    const uArchR = { value: new THREE.Vector3(...R.archR) };
    const uWk = { value: R.wk };
    const uFlake = { value: look.finish === 1 ? 0 : look.finish === 2 ? 1.6 : 1 };
    this.paint.onBeforeCompile = (sh) => {
      sh.uniforms.uAcc = uAcc;
      sh.uniforms.uTeam = uTeam;
      sh.uniforms.uDecal = uDecal;
      sh.uniforms.uArchF = uArchF;
      sh.uniforms.uArchR = uArchR;
      sh.uniforms.uWk = uWk;
      sh.uniforms.uFlake = uFlake;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vObj;\nuniform vec3 uAcc;\nuniform vec3 uTeam;\nuniform float uDecal;\nuniform float uFlake;\nuniform vec3 uArchF;\nuniform vec3 uArchR;\nuniform float uWk;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          vec3 o = vObj;
          float ay = abs(o.y) / uWk;
          // twin stripes over the hood, the scoop, roof and deck (not on the side bodies)
          float st = (1.0 - smoothstep(2.0, 2.5, abs(ay - 5.6))) * step(14.0, o.z) * step(ay, 20.0);
          // a blade down each flank: from behind the front arch, rising and widening to the tail
          float sw = o.z - (9.0 - o.x * 0.11);
          float swW = mix(0.9, 3.8, smoothstep(30.0, -40.0, o.x));
          float sws = (1.0 - smoothstep(swW - 0.4, swW, abs(sw))) * step(36.0, ay) * step(o.x, 33.0) * step(-52.0, o.x);
          // a thin pinstripe under it
          float pin = (1.0 - smoothstep(0.22, 0.5, abs(sw + swW + 1.5))) * step(36.0, ay) * step(o.x, 30.0) * step(-50.0, o.x);
          // an accent lip round each arch
          float hf = abs(length(o.xz - uArchF.xy) - uArchF.z);
          float hr = abs(length(o.xz - uArchR.xy) - uArchR.z);
          float lip = (1.0 - smoothstep(0.55, 0.85, min(hf, hr))) * step(38.5, ay);
          float onArch = step(min(hf, hr), 3.5);
          float blade = max(sws, pin) * (1.0 - onArch);
          float dec;
          if (uDecal < 0.5) dec = max(max(st, lip), blade);
          else if (uDecal < 1.5) dec = max(lip, blade);
          else if (uDecal < 2.5) {
            // one wide stripe nose to tail, with thin pinstripes either side
            float w = (1.0 - smoothstep(7.0, 7.5, ay)) + (1.0 - smoothstep(0.3, 0.6, abs(ay - 9.2)));
            dec = max(lip, min(1.0, w) * step(14.0, o.z) * step(ay, 20.0));
          } else if (uDecal < 3.5) {
            // two-tone: the upper body in the accent, split along a sharp waistline
            float waist = 20.0 + o.x * 0.04;
            dec = max(lip, smoothstep(waist - 0.25, waist + 0.25, o.z));
          } else if (uDecal < 4.5) {
            // hex cells breaking up toward the tail
            vec2 hp = vec2(o.x, o.z + ay * 0.6) / 4.2;
            vec2 hs = vec2(1.0, 1.7320508);
            vec2 a = mod(hp, hs) - hs * 0.5;
            vec2 b2 = mod(hp - hs * 0.5, hs) - hs * 0.5;
            vec2 gh = dot(a, a) < dot(b2, b2) ? a : b2;
            vec2 cellId = hp - gh;
            float hcell = fract(sin(dot(floor(cellId * 2.0), vec2(12.9898, 78.233))) * 43758.5453);
            float fill = step(hcell, smoothstep(30.0, -50.0, o.x) * 1.2 - 0.1);
            float inside = step(0.08, 0.5 - max(dot(abs(gh), normalize(hs)), abs(gh.x)));
            dec = max(lip, fill * inside * step(6.0, o.z));
          } else dec = lip;
          diffuseColor.rgb = mix(diffuseColor.rgb, uAcc, dec);
          // panel seams: the hood's edges, the doors
          float seam = (1.0 - smoothstep(0.12, 0.3, abs(ay - 21.5))) * step(38.0, o.x) * step(o.x, 72.0) * step(12.0, o.z);
          seam = max(seam, (1.0 - smoothstep(0.12, 0.3, abs(o.x + 12.0))) * step(33.0, ay) * step(4.0, o.z));
          seam = max(seam, (1.0 - smoothstep(0.12, 0.3, abs(o.x - 30.0))) * step(33.0, ay) * step(4.0, o.z) * step(o.z, 20.0));
          diffuseColor.rgb *= 1.0 - seam * 0.7;
          // the wheel wells: dark inside each arch
          float well = max(step(length(o.xz - uArchF.xy), uArchF.z - 0.5), step(length(o.xz - uArchR.xy), uArchR.z - 0.5));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.018), well);
          // dark sills along the bottom
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03), smoothstep(-8.0, -10.0, o.z));`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          // metallic flake under the clear coat: a fine glitter in the base layer's highlights
          {
            vec3 fc = floor(vObj * 7.0);
            vec3 fr = fract(sin(vec3(dot(fc, vec3(12.9898, 78.233, 37.719)), dot(fc, vec3(39.346, 11.135, 83.155)), dot(fc, vec3(73.156, 52.235, 9.151)))) * 43758.5453) - 0.5;
            // (fading out once a flake is under a pixel, so it never turns to noise)
            normal = normalize(normal + fr * 0.07 * uFlake * (1.0 - smoothstep(0.05, 0.14, length(fwidth(vObj)))));
          }`,
        );
    };
    this.paint.customProgramCacheKey = () => 'bbcarpaint' + (look.finish === 3 ? 'i' : '');
    const carbon = new THREE.MeshPhysicalMaterial({ color: 0x121317, roughness: 0.42, metalness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.3 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x04070c, roughness: 0.03, metalness: 0.8, envMapIntensity: 2.2, clearcoat: 1, clearcoatRoughness: 0 });
    const accentM = new THREE.MeshPhysicalMaterial({ color: accC, metalness: look.finish === 2 ? 0.85 : 0.5, roughness: look.finish === 1 ? 0.55 : 0.26, clearcoat: look.finish === 1 ? 0.1 : 1, clearcoatRoughness: 0.05 });
    const grilleM = new THREE.MeshStandardMaterial({ map: grilleTex(), roughness: 0.6, metalness: 0.3 });
    grilleM.map!.repeat.set(1, 1);
    const rubber = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.86, metalness: 0, bumpMap: tread(), bumpScale: 1.2 });
    // gunmetal rims (a painted accent shows on the calipers and the centre caps)
    const rimM = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0x3a3e46).lerp(accC, look.accent === 0xffffff ? 0 : 0.18), roughness: 0.28, metalness: 0.85, clearcoat: 0.8, envMapIntensity: 1.6 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xe8ecf2, roughness: 0.12, metalness: 1, envMapIntensity: 2 });
    const discM = new THREE.MeshStandardMaterial({ color: 0x3a3c42, roughness: 0.45, metalness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.5, metalness: 0.5 });
    // the exhaust pipes: brushed metal, seen inside too
    const nozzleM = new THREE.MeshStandardMaterial({ color: 0x55585f, roughness: 0.35, metalness: 0.9, side: THREE.DoubleSide });

    const add = (geo: THREE.BufferGeometry, m: THREE.Material, cast = true) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };
    add(g.paint, this.paint);
    add(g.glass, glass);
    add(g.carbon, carbon);
    add(g.accent, accentM);
    add(g.grille, grilleM, false);
    add(g.head, new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 5, 5.6) }), false);
    add(g.tail, new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.3, 0.22) }), false);
    // boost nozzles and flames
    this.nozzleGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.035, 0.02, 0.015) });
    this.flameMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uT: { value: 0 }, uC: { value: new THREE.Color(team === 0 ? 0x4f9dff : 0xff8a2a) }, uK: { value: 0 }, uHot: { value: 0 } },
      vertexShader: `varying vec3 vP; varying vec2 vU; void main(){ vP = position; vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: `uniform float uT; uniform vec3 uC; uniform float uK; uniform float uHot; varying vec3 vP; varying vec2 vU;
        void main(){ float t = clamp(-vP.x, 0.0, 1.0);
          // flickering shock bands running down the jet
          float n = 0.5 + 0.5*sin(vU.x*40.0 + uT*60.0) * sin(t*20.0 - uT*80.0);
          float bands = 0.75 + 0.25*sin(t*34.0 - uT*95.0);
          float core = (1.0 - t) * (1.0 - t);
          vec3 c = mix(uC * 1.7, vec3(1.8, 1.55, 1.1), mix(core * 0.85, 0.85, uHot));
          float a = pow(1.0 - t, mix(1.1, 1.8, uHot)) * (0.55 + 0.45*n) * bands * uK;
          gl_FragColor = vec4(c * a * mix(2.4, 3.4, uHot), a); }`,
    });
    // the jet takes the trail's colour
    const jc = [null, new THREE.Color(look.accent), null, new THREE.Color(0x9fe6ff), new THREE.Color(0xff5a10), new THREE.Color(0xffd27a)][look.trail];
    if (jc) (this.flameMat.uniforms.uC.value as THREE.Color).copy(jc);
    // a short white-hot core inside each jet
    this.coreMat = this.flameMat.clone();
    this.coreMat.uniforms.uHot.value = 1;
    for (const sy of [-1, 1]) {
      const nz = add(g.nozzle, nozzleM, false);
      const [jx, jy, jz] = R.jets[sy < 0 ? 1 : 0];
      nz.position.set(jx, jy, jz);
      // the glow sits deep in the pipe: a dark bore at rest, white-hot when boosting
      add(new THREE.CircleGeometry(4.2, 18).rotateY(-Math.PI / 2).translate(jx + 3, jy, jz), this.nozzleGlow, false);
      this.jets.push(new THREE.Vector3(jx - 6, jy, jz));
      const fl = new THREE.Mesh(g.flame, this.flameMat);
      fl.position.set(jx - 3, jy, jz);
      fl.scale.set(60, 5.4, 5.4);
      fl.renderOrder = 9;
      fl.frustumCulled = false;
      this.group.add(fl);
      this.flames.push(fl);
      const core = new THREE.Mesh(g.flame, this.coreMat);
      core.position.set(jx - 1, jy, jz);
      core.renderOrder = 10;
      core.frustumCulled = false;
      this.group.add(core);
      this.cores.push(core);
    }
    {
      const m = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uA: { value: 0.7 } },
        vertexShader: `varying vec2 vU; void main(){ vU = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform float uA; varying vec2 vU; void main(){ float d = length(vU * vec2(1.0, 1.0)); float k = pow(1.0 - smoothstep(0.25, 1.0, d), 1.6); gl_FragColor = vec4(0.0, 0.0, 0.0, k * uA); }`,
      });
      m.polygonOffset = true;
      m.polygonOffsetFactor = -3;
      this.contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
      this.contact.scale.set(150, 104, 1);
      this.contact.position.set(8, 0, R.ground + 0.6);
      this.contact.renderOrder = 2;
      this.group.add(this.contact);
    }
    // an antenna off the rear deck, leaning back, with a little team-coloured topper
    {
      const d = new THREE.Vector3(-Math.sin(0.3), 0, Math.cos(0.3));
      const base = new THREE.Vector3(...R.antenna);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.45, 30, 6), dark);
      rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
      rod.position.copy(base).addScaledVector(d, 15);
      this.group.add(rod);
      const top = new THREE.Mesh(new THREE.SphereGeometry(2.4, 14, 10), accentM);
      top.position.copy(base).addScaledVector(d, 30);
      top.castShadow = true;
      this.group.add(top);
    }
    // wheels: the right-hand ones mirrored so every rim's face looks out
    const caliperM = new THREE.MeshPhysicalMaterial({ color: accC.clone().lerp(new THREE.Color(0xff2a1a), look.accent === 0xffffff ? 0.8 : 0), roughness: 0.35, metalness: 0.3, clearcoat: 1 });
    for (const [wx, wy, wr, z0, w] of R.wheels) {
      const pivot = new THREE.Group();
      const spin = new THREE.Group();
      pivot.position.set(wx, wy, z0);
      const side = Math.sign(wy);
      const t = new THREE.Mesh(g.tyre, rubber);
      t.scale.set(wr, w, wr);
      t.castShadow = true;
      const rm = new THREE.Mesh(g.rim, rimM);
      rm.scale.set(wr, w * side, wr);
      const lip = new THREE.Mesh(g.rimLip, chrome);
      lip.scale.set(wr, w * side, wr);
      spin.add(t, rm, lip);
      const dc = new THREE.Mesh(g.disc, discM);
      dc.scale.set(wr, w * side, wr);
      const cp = new THREE.Mesh(g.caliper, caliperM);
      cp.scale.set(wr, w * side, wr);
      pivot.add(spin, dc, cp);
      this.group.add(pivot);
      this.wheels.push({ pivot, spin, r: wr, front: wx > 0, z0 });
    }
    if (name) this.setName(name);
  }

  /** reflect this environment (the arena's capture) in the paint, glass and metal */
  setEnv(tex: THREE.Texture | null): void {
    this.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && 'envMap' in m && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        m.envMap = tex;
        m.needsUpdate = true;
      }
    });
  }

  setName(name: string): void {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 96;
    const x = c.getContext('2d')!;
    x.font = 'italic 900 56px "Titillium Web", Arial, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.lineWidth = 10;
    x.strokeStyle = 'rgba(0,0,0,0.75)';
    x.strokeText(name.toUpperCase(), 256, 50);
    x.fillStyle = this.team === 0 ? '#7fb6ff' : '#ffb27a';
    x.fillText(name.toUpperCase(), 256, 50);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, fog: false }));
    sp.scale.set(160, 30, 1);
    sp.position.set(0, 0, 110);
    sp.renderOrder = 20;
    this.tag = sp;
    this.group.add(sp);
  }

  showTag(v: boolean): void {
    if (this.tag) this.tag.visible = v;
  }

  setAccent(c: number): void {
    void c;
  }

  /** pose from the simulated car (positions already smoothed by the caller) */
  update(car: Car, pos: THREE.Vector3, quat: THREE.Quaternion, dt: number, t: number): void {
    this.group.visible = car.alive;
    if (!car.alive) return;
    this.group.position.copy(pos);
    this.group.quaternion.copy(quat);
    const vf = car.vel.dot(car.rot.f);
    this.spin += (vf / 14) * dt;
    const steer = car.input.steer * (0.42 - Math.min(0.3, Math.abs(vf) / 6000));
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      w.spin.rotation.y = this.spin * (14 / w.r);
      if (w.front) w.pivot.rotation.z = -steer * (car.onGround ? 1 : 0.6);
      const comp = car.wheelComp[i];
      const target = w.z0 + (car.wheelContact[i] ? Math.min(6, comp) - 1.5 : -3.5);
      w.pivot.position.z += (target - w.pivot.position.z) * Math.min(1, dt * 25);
    }
    // the contact shadow fades as the wheels leave the surface
    const down = car.wheelContact.filter(Boolean).length;
    const sm = this.contact.material as THREE.ShaderMaterial;
    sm.uniforms.uA.value += ((down >= 2 ? 0.72 : 0) - sm.uniforms.uA.value) * Math.min(1, dt * 14);
    this.contact.visible = sm.uniforms.uA.value > 0.01;
    this.jet(car.boosting, t, dt);
  }

  /** parked (the garage): wheels at rest, the jets lit or not */
  idle(t: number, dt: number, boost: boolean): void {
    this.jet(boost, t, dt);
  }

  private jet(boosting: boolean, t: number, dt: number): void {
    const k = boosting ? 1 : 0;
    this.boostVis += (k - this.boostVis) * Math.min(1, dt * (k ? 30 : 12));
    this.flameMat.uniforms.uT.value = t;
    this.flameMat.uniforms.uK.value = this.boostVis;
    if (this.loadout.trail === 2) (this.flameMat.uniforms.uC.value as THREE.Color).setHSL((t * 0.6) % 1, 1, 0.55);
    this.coreMat.uniforms.uT.value = t;
    this.coreMat.uniforms.uK.value = this.boostVis;
    for (const f of this.cores) {
      f.visible = this.boostVis > 0.02;
      f.scale.set(22 + 12 * this.boostVis + Math.sin(t * 90 + f.position.y) * 3, 3.2, 3.2);
    }
    for (const f of this.flames) {
      f.visible = this.boostVis > 0.02;
      const L = 50 + 50 * this.boostVis + Math.sin(t * 70 + f.position.y) * 8;
      f.scale.set(L, 5.2 + 1.6 * this.boostVis, 5.2 + 1.6 * this.boostVis);
    }
    this.nozzleGlow.color.setRGB(0.035 + this.boostVis * 6, 0.02 + this.boostVis * 2.9, 0.015 + this.boostVis * 1.3);
  }
}
