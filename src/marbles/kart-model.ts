import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { KART } from './kart-sim.ts';

/**
 * The karts, as instanced meshes (one draw per part for the whole grid): a tube frame, bodywork in
 * the driver's colours, a two-stroke with its exhaust can, a steering wheel, and four wheels that
 * steer, spin and ride their suspension. Kart space: x left, y up, z forward, origin at the centre of
 * mass; `H` takes it down to the ground.
 */

const H = -KART.hcg;

function tube(a: THREE.Vector3, b: THREE.Vector3, r: number) {
  const d = new THREE.Vector3().subVectors(b, a), l = d.length();
  const g = new THREE.CylinderGeometry(r, r, l, 8);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}
const p = (x: number, y: number, z: number) => new THREE.Vector3(x, H + y, z);

/** a smooth lump from a plan outline, pinched at the ends: a side pod, a nose */
function pod(w: number, h: number, l: number, round = 0.5) {
  const g = new THREE.SphereGeometry(1, 20, 14);
  const q = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < q.count; i++) {
    const x = q.getX(i), y = q.getY(i), z = q.getZ(i);
    const k = Math.pow(Math.abs(x), 2 + round * 4) + Math.pow(Math.abs(y), 2 + round * 4) + Math.pow(Math.abs(z), 2 + round * 4);
    const s = 1 / Math.pow(k, 1 / (2 + round * 4));
    q.setXYZ(i, x * s * w, y * s * h, z * s * l);
  }
  g.computeVertexNormals();
  return g;
}

function wheelGeo(r: number, w: number) {
  // the tyre: a lathe, slick with a rounded shoulder
  const prof: [number, number][] = [[r * 0.62, -w / 2], [r * 0.92, -w / 2], [r, -w * 0.38], [r, w * 0.38], [r * 0.92, w / 2], [r * 0.62, w / 2]];
  const tyre = new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a, b)), 26).rotateZ(Math.PI / 2);
  const rim = mergeGeometries([
    new THREE.CylinderGeometry(r * 0.62, r * 0.62, w * 0.86, 22, 1, true).rotateZ(Math.PI / 2),
    new THREE.CylinderGeometry(r * 0.56, r * 0.56, w * 0.9, 22).rotateZ(Math.PI / 2),
    ...[0, 1, 2, 3, 4].map((k) => new THREE.BoxGeometry(w * 1.02, r * 0.14, r * 1.04).rotateX((k / 5) * Math.PI)),
    new THREE.CylinderGeometry(r * 0.16, r * 0.16, w * 1.2, 12).rotateZ(Math.PI / 2),
  ].map((g) => (g.index ? g.toNonIndexed() : g)))!;
  return { tyre, rim };
}

export class KartModel {
  private body: THREE.InstancedMesh;
  private frame: THREE.InstancedMesh;
  private dark: THREE.InstancedMesh;
  private plate: THREE.InstancedMesh;
  private trim: THREE.InstancedMesh;
  private hoop: THREE.InstancedMesh;
  private tyres: THREE.InstancedMesh;
  private rims: THREE.InstancedMesh;
  private wheelH: THREE.InstancedMesh;
  private flame: THREE.InstancedMesh;
  private brake: THREE.InstancedMesh;
  private parts: THREE.InstancedMesh[];
  constructor(private scene: THREE.Scene, private n: number, colours: { a: number; b: number }[]) {
    const steel = new THREE.MeshStandardMaterial({ color: 0xb8bec8, metalness: 0.9, roughness: 0.32 });
    // the frame
    const F: THREE.BufferGeometry[] = [];
    const rail = 0.46, y = 0.17;
    F.push(tube(p(rail, y, -1.02), p(rail, y, 0.42), 0.034), tube(p(-rail, y, -1.02), p(-rail, y, 0.42), 0.034));
    F.push(tube(p(rail, y, 0.42), p(0.28, y, 1.12), 0.034), tube(p(-rail, y, 0.42), p(-0.28, y, 1.12), 0.034));
    F.push(tube(p(0.28, y, 1.12), p(-0.28, y, 1.12), 0.034), tube(p(rail, y, -0.86), p(-rail, y, -0.86), 0.034), tube(p(rail, y, 0.1), p(-rail, y, 0.1), 0.03));
    // stub axles, the rear axle, track rods
    F.push(tube(p(0.76, 0.25, 1.12), p(0.28, y, 1.12), 0.028), tube(p(-0.76, 0.25, 1.12), p(-0.28, y, 1.12), 0.028));
    F.push(tube(p(0.82, 0.29, -0.86), p(-0.82, 0.29, -0.86), 0.034));
    // the side bars and the rear bumper
    for (const s of [1, -1]) {
      F.push(tube(p(s * rail, y, 0.3), p(s * 0.86, y + 0.02, 0.2), 0.024), tube(p(s * rail, y, -0.42), p(s * 0.86, y + 0.02, -0.34), 0.024), tube(p(s * 0.86, y + 0.02, 0.2), p(s * 0.86, y + 0.02, -0.34), 0.024));
      F.push(tube(p(s * 0.32, 0.2, -1.04), p(s * 0.34, 0.26, -1.42), 0.024));
    }
    F.push(tube(p(0.78, 0.3, -1.42), p(-0.78, 0.3, -1.42), 0.03), tube(p(0.78, 0.15, -1.42), p(-0.78, 0.15, -1.42), 0.03), tube(p(0.78, 0.3, -1.42), p(0.78, 0.15, -1.42), 0.03), tube(p(-0.78, 0.3, -1.42), p(-0.78, 0.15, -1.42), 0.03));
    // steering column
    F.push(tube(p(0, 0.18, 1.02), p(0, 0.66, 0.44), 0.02));
    // the bits of the engine that catch the light: exhaust header and can
    F.push(tube(p(-0.46, 0.5, -0.34), p(-0.72, 0.44, -0.62), 0.04));
    F.push(new THREE.CylinderGeometry(0.075, 0.085, 0.62, 12).rotateX(Math.PI / 2 + 0.06).translate(-0.74, H + 0.42, -0.96));
    this.frame = new THREE.InstancedMesh(mergeGeometries(F.map((g) => (g.index ? g.toNonIndexed() : g)))!, steel, n);
    // the bodywork: nose, side pods, front panel, rear fairing, all in the driver's colour
    const nose = pod(0.64, 0.13, 0.5, 0.35).translate(0, H + 0.2, 1.26);
    const noseUp = new THREE.BoxGeometry(0.52, 0.34, 0.09).rotateX(-0.42).translate(0, H + 0.42, 0.92);
    const fair = pod(0.2, 0.2, 0.33, 0.4).translate(0, H + 0.31, 0.74);
    const pods = [1, -1].flatMap((s) => [pod(0.2, 0.14, 0.62, 0.4).translate(s * 0.76, H + 0.25, -0.08)]);
    const tail = pod(0.82, 0.075, 0.13, 0.4).translate(0, H + 0.32, -1.44);
    const bodyG = mergeGeometries([nose, noseUp, fair, ...pods, tail].map((g) => (g.index ? g.toNonIndexed() : g)))!;
    bodyG.computeVertexNormals();
    this.body = new THREE.InstancedMesh(bodyG, new THREE.MeshPhysicalMaterial({ roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.08, metalness: 0.08 }), n);
    // the second colour: stripes on the pods and a wing over the rear
    const wing = new THREE.BoxGeometry(1.06, 0.03, 0.26).translate(0, H + 0.92, -1.08);
    const plates = [1, -1].flatMap((s) => [new THREE.BoxGeometry(0.03, 0.2, 0.3).translate(s * 0.53, H + 0.84, -1.08)]);
    const stripe = [1, -1].map((s) => pod(0.205, 0.05, 0.5, 0.3).translate(s * 0.76, H + 0.31, -0.08));
    const noseStripe = pod(0.2, 0.135, 0.48, 0.35).translate(0, H + 0.205, 1.26);
    this.trim = new THREE.InstancedMesh(mergeGeometries([wing, ...plates, ...stripe, noseStripe].map((g) => (g.index ? g.toNonIndexed() : g)))!, new THREE.MeshPhysicalMaterial({ roughness: 0.3, clearcoat: 1 }), n);
    // the dark things: floor, seat, engine, wing posts
    const seatProf = [[0.02, 0], [0.26, 0.02], [0.3, 0.16], [0.28, 0.34]].map(([a, c]) => new THREE.Vector2(a, c));
    const seat = new THREE.LatheGeometry(seatProf, 18).scale(1, 1, 1.15).translate(0, H + 0.14, -0.3);
    const back = new THREE.BoxGeometry(0.46, 0.5, 0.06).rotateX(-0.26).translate(0, H + 0.48, -0.62);
    const floor = new THREE.BoxGeometry(0.86, 0.018, 1.1).translate(0, H + 0.12, 0.3);
    const block = new THREE.BoxGeometry(0.24, 0.3, 0.3).translate(-0.48, H + 0.36, -0.36);
    const head = new THREE.CylinderGeometry(0.12, 0.14, 0.14, 14).translate(-0.48, H + 0.58, -0.36);
    const fins = [0, 1, 2].map((k) => new THREE.CylinderGeometry(0.16, 0.16, 0.012, 14).translate(-0.48, H + 0.53 + k * 0.03, -0.36));
    const air = new THREE.CylinderGeometry(0.09, 0.09, 0.3, 12).rotateZ(Math.PI / 2).translate(-0.18, H + 0.38, -0.82);
    const posts = [1, -1].map((s) => tube(p(s * 0.3, 0.3, -1.0), p(s * 0.4, 0.9, -1.08), 0.016));
    const drive = new THREE.CylinderGeometry(0.11, 0.11, 0.03, 14).rotateZ(Math.PI / 2).translate(-0.44, H + 0.29, -0.86);
    this.dark = new THREE.InstancedMesh(mergeGeometries([seat, back, floor, block, head, ...fins, air, ...posts, drive].map((g) => (g.index ? g.toNonIndexed() : g)))!, new THREE.MeshStandardMaterial({ color: 0x20222a, roughness: 0.48, metalness: 0.35 }), n);
    // the number board
    const atlas = document.createElement('canvas');
    atlas.width = atlas.height = 512;
    const x = atlas.getContext('2d')!;
    x.fillStyle = '#f6f6f2';
    x.fillRect(0, 0, 512, 512);
    x.fillStyle = '#14141c';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.font = '900 72px "Arial Black", Impact, sans-serif';
    for (let k = 0; k < 36; k++) x.fillText(String(k + 1), (k % 6) * 85.3 + 42.6, Math.floor(k / 6) * 85.3 + 46);
    const tex = new THREE.CanvasTexture(atlas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const plateG = new THREE.CircleGeometry(0.15, 22);
    const pm = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 });
    pm.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vNum;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvNum = float(gl_InstanceID);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vNum;').replace('#include <map_fragment>', `float nn = floor(vNum + 0.5);
vec2 cellUv = (vec2(mod(nn, 6.0), 5.0 - floor(nn / 6.0)) + vMapUv) / 6.0;
vec4 sampledDiffuseColor = texture2D(map, cellUv);
diffuseColor *= sampledDiffuseColor;`);
    };
    plateG.rotateX(-0.42).translate(0, H + 0.43, 0.97);
    this.plate = new THREE.InstancedMesh(plateG, pm, n);
    // the steering wheel
    const sw = new THREE.TorusGeometry(0.15, 0.02, 8, 22);
    const spoke = new THREE.BoxGeometry(0.28, 0.03, 0.012);
    this.hoop = new THREE.InstancedMesh(mergeGeometries([sw.toNonIndexed(), spoke.toNonIndexed()])!, new THREE.MeshStandardMaterial({ color: 0x15161c, roughness: 0.5 }), n);
    // the wheels
    const w = wheelGeo(0.28, 0.26);
    this.tyres = new THREE.InstancedMesh(w.tyre, new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.74 }), n * 4);
    this.rims = new THREE.InstancedMesh(w.rim, new THREE.MeshStandardMaterial({ metalness: 0.75, roughness: 0.3 }), n * 4);
    this.wheelH = this.rims;
    // exhaust flame on a boost, and the brake light
    // (the can's own flame, and its twin from the other side of the tail, so it reads from behind)
    // (drawn from the tail back, so it stretches out of the pipe and never slides away from it)
    const cone = (x: number) => new THREE.ConeGeometry(0.12, 1, 10).rotateX(-Math.PI / 2).translate(x, H + 0.4, -0.5).toNonIndexed();
    this.flame = new THREE.InstancedMesh(mergeGeometries([cone(-0.74), cone(0.74)])!, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), n);
    this.brake = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.05, 0.02).translate(0, H + 0.3, -1.58), new THREE.MeshBasicMaterial({ color: 0xff2010, toneMapped: false }), n);
    this.parts = [this.frame, this.body, this.trim, this.dark, this.plate, this.hoop, this.tyres, this.rims, this.brake];
    for (const q of this.parts) {
      q.frustumCulled = false;
      q.castShadow = q !== this.plate && q !== this.brake;
      scene.add(q);
    }
    this.flame.frustumCulled = false;
    scene.add(this.flame);
    const C = new THREE.Color();
    colours.forEach((c, k) => {
      this.body.setColorAt(k, C.set(c.a));
      this.trim.setColorAt(k, C.set(c.b));
      for (let j = 0; j < 4; j++) this.rims.setColorAt(k * 4 + j, C.set(c.b).lerp(new THREE.Color(0xdddddd), 0.5));
    });
  }

  dispose() {
    this.scene.remove(...this.parts, this.flame);
    for (const q of this.parts) q.dispose();
    this.flame.dispose();
  }

  private M = new THREE.Matrix4();
  private W = new THREE.Matrix4();
  private Q = new THREE.Quaternion();
  private P = new THREE.Vector3();
  private S = new THREE.Vector3(1, 1, 1);
  private one = new THREE.Vector3(1, 1, 1);
  private flames = 0;
  private brakes = 0;

  begin() {
    this.flames = this.brakes = 0;
  }

  /** one kart's matrices: `w` is [spin, steer, drop] per wheel */
  put(k: number, pos: THREE.Vector3, quat: THREE.Quaternion, hands: number, wheels: { x: number; y: number; z: number; r: number; spin: number; steer: number; comp: number }[], hide: boolean, flame: number, brake: boolean, hue = 0xff9030) {
    const { M, W, Q, P, S, one } = this;
    S.setScalar(hide ? 0.0001 : 1);
    M.compose(pos, quat, S);
    for (const q of [this.frame, this.body, this.trim, this.dark, this.plate]) q.setMatrixAt(k, M);
    // the wheel on its column
    Q.setFromAxisAngle(AX, -0.9);
    W.compose(P.set(0, H + 0.67, 0.42), Q, one);
    Q.setFromAxisAngle(AZ, hands * 1.5);
    W.multiply(new THREE.Matrix4().makeRotationFromQuaternion(Q));
    this.hoop.setMatrixAt(k, W.premultiply(M));
    wheels.forEach((w, j) => {
      // the axle's own turn, then the steering, down at the wheel's place
      Q.setFromAxisAngle(AY, w.steer);
      Q.multiply(Q2.setFromAxisAngle(AX, w.spin));
      const s = w.r / 0.28;
      S.set(hide ? 0.0001 : w.z > 0 ? 0.9 : 1.2, hide ? 0.0001 : s, hide ? 0.0001 : s);
      W.compose(P.set(w.x, w.y, w.z), Q, S).premultiply(M);
      this.tyres.setMatrixAt(k * 4 + j, W);
      this.rims.setMatrixAt(k * 4 + j, W);
    });
    S.set(1, 1, 1);
    if (flame > 0 && !hide) {
      S.set(1, 1, flame * (0.7 + Math.random() * 0.8));
      this.flame.setColorAt(this.flames, FC.set(hue));
      W.compose(P.set(0, 0, -1.42), Q.identity(), S).premultiply(M);
      this.flame.setMatrixAt(this.flames++, W);
    }
    if (brake && !hide) this.brake.setMatrixAt(this.brakes++, M);
  }

  end() {
    this.flame.count = this.flames;
    this.brake.count = this.brakes;
    this.flame.instanceMatrix.needsUpdate = true;
    if (this.flame.instanceColor) this.flame.instanceColor.needsUpdate = true;
    this.brake.instanceMatrix.needsUpdate = true;
    for (const q of [this.frame, this.body, this.trim, this.dark, this.plate, this.hoop, this.tyres, this.rims]) q.instanceMatrix.needsUpdate = true;
  }
}
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);
const Q2 = new THREE.Quaternion();
const FC = new THREE.Color();
