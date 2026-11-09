import * as THREE from 'three';
import { AIR } from './fx.ts';

/**
 * Light through the windows: the dust in a dark room lit up in a slab from the street lamp, the security light
 * or the sun outside. Each pane gets one shaft at most, from the strongest light it can see on its other
 * side (or the sun, or the night sky), into the room behind it. A shaft is a slanted box, the window pushed
 * along the light's way until it reaches the floor, and is drawn into the air layer by marching the eye's
 * ray through it, stopping at whatever is in front. Behind blinds it comes through in slats.
 */

type Glass = { axis: string; c: number; a: number; b: number; z0: number; z1: number };
type Light = { kind: string; pos: number[]; color: number[]; power: number; flicker?: number };
type Room = { name: string; a: number[]; b: number[] };
type DoorD = { axis: string; hinge: number[]; w: number; h: number; sign: number };
type Unit = { id: string; pos: number[] };
type Ray = (x: number, y: number, z: number, dx: number, dy: number, dz: number, far: number) => { t: number } | null;

const VS = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4( position, 1.0 );
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FS = /* glsl */ `
varying vec3 vW;
uniform sampler2D tDepth;
uniform vec2 nf;
uniform vec2 inv;
uniform mat4 toBox;
uniform vec3 fwd;
uniform vec3 col;
uniform float slats;
uniform float time;
uniform float k;
float lin( float d ) { return nf.x * nf.y / ( nf.y - d * ( nf.y - nf.x ) ); }
float ign( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
void main() {
  if ( k <= 0.0 ) discard;
  vec3 o = cameraPosition;
  vec3 d = normalize( vW - o );
  // the eye's ray in the box's own space, where the shaft is the unit cube
  vec3 lo = ( toBox * vec4( o, 1.0 ) ).xyz;
  vec3 ld = mat3( toBox ) * d;
  vec3 il = 1.0 / ( ld + sign( ld ) * 1e-6 + vec3( 1e-9 ) );
  vec3 t0 = ( vec3( 0.0 ) - lo ) * il, t1 = ( vec3( 1.0 ) - lo ) * il;
  vec3 tn = min( t0, t1 ), tf = max( t0, t1 );
  float a = max( max( tn.x, tn.y ), max( tn.z, 0.0 ) );
  float b = min( min( tf.x, tf.y ), tf.z );
  // whatever is in front of it
  float z = lin( texture2D( tDepth, gl_FragCoord.xy * inv ).r );
  b = min( b, z / max( dot( d, fwd ), 1e-3 ) );
  if ( b <= a ) discard;
  float j = ign( gl_FragCoord.xy + time * 61.0 );
  float acc = 0.0;
  for ( int i = 0; i < 8; i++ ) {
    float t = mix( a, b, ( float( i ) + j ) / 8.0 );
    vec3 q = lo + ld * t;
    // soft at its sides, strongest at the glass and gone by the floor
    float e = smoothstep( 0.0, 0.1, q.x ) * smoothstep( 1.0, 0.9, q.x ) * smoothstep( 0.0, 0.08, q.y ) * smoothstep( 1.0, 0.92, q.y );
    float w = smoothstep( 0.0, 0.04, q.z ) * pow( 1.0 - q.z, 1.6 );
    float s = 1.0;
    if ( slats > 0.0 ) {
      float f = fract( q.y * slats );
      s = 0.12 + 0.88 * smoothstep( 0.18, 0.32, f ) * smoothstep( 0.8, 0.66, f );
    }
    vec3 p = o + d * t;
    float dust = 0.7 + 0.3 * sin( p.x * 3.1 + time * 0.21 ) * sin( p.y * 2.3 - time * 0.17 ) * sin( p.z * 2.7 + time * 0.13 );
    // none of it right round the lens: standing in one, you see it beyond you, not as a fog on the glass
    acc += e * w * s * dust * smoothstep( 0.6, 3.2, t );
  }
  // a long look down one fills up, it doesn't keep getting brighter
  float len = b - a;
  gl_FragColor = vec4( col * k * acc / 8.0 * 2.6 * ( 1.0 - exp( -len * 0.38 ) ), 0.0 );
}
`;

const BLEND = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor } as const;

export class Shafts {
  readonly group = new THREE.Group();
  private mats: THREE.ShaderMaterial[] = [];
  private time = { value: 0 };
  private fwd = { value: new THREE.Vector3() };
  /** each shaft, the lamp it hangs on if that flickers, and the door it comes through if any */
  private all: { m: THREE.ShaderMaterial; mesh: THREE.Mesh; base: number; l?: Light; door: { ang: number } | null; sky: boolean }[] = [];
  /** lightning, 0..1: the shafts that come from the sky blaze for a blink */
  bolt = 0;

  constructor(map: { glass: Glass[]; doors?: DoorD[]; lights: Light[]; rooms: Room[]; units?: Unit[]; weather?: { sky?: number[]; sun?: { dir: number[]; power: number; color: number[] } } }, ray: Ray, gain = 1, doors: { ang: number }[] = []) {
    const roomAt = (x: number, y: number, z: number) => map.rooms.find((r) => x > r.a[0] && x < r.b[0] && y > r.a[1] - 0.2 && y < r.b[1] && z > r.a[2] && z < r.b[2]);
    const blinds = (map.units ?? []).filter((u) => u.id.includes('|blinds'));
    const sun = map.weather?.sun;
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
    type Best = { d: THREE.Vector3; c: THREE.Vector3; e: number; l?: Light };
    /** the strongest light reaching an opening from the far side of side: what would come through into side */
    const incoming = (cx: number, cy: number, cz: number, nrm: THREE.Vector3, along: THREE.Vector3, side: number, sky: boolean, minD: number): Best | null => {
      let best: Best | null = null;
      for (const l of map.lights) {
        if (l.power < 2) continue;
        const v = new THREE.Vector3(l.pos[0] - cx, l.pos[1] - cy, l.pos[2] - cz);
        const dist = v.length();
        if (dist > 30 || dist < minD) continue;
        v.divideScalar(dist);
        const facing = -(v.x * nrm.x + v.z * nrm.z) * side;
        if (facing < 0.25) continue;
        const e = (l.power / (dist * dist)) * facing;
        if (best && e <= best.e) continue;
        // can it see the opening: from just beyond it to just short of the lamp
        if (ray(cx - nrm.x * side * 0.08, cy, cz - nrm.z * side * 0.08, v.x, v.y, v.z, Math.max(0.1, dist - 0.35))) continue;
        best = { d: v.clone().negate(), c: new THREE.Vector3(...l.color), e, l };
      }
      const outdoors = !roomAt(cx - nrm.x * side * 0.5, cy, cz - nrm.z * side * 0.5);
      if (sky && outdoors && sun) {
        const v = new THREE.Vector3(...sun.dir);
        const facing = -(v.x * nrm.x + v.z * nrm.z) * side;
        const e = sun.power * 0.6 * facing;
        if (facing > 0.2 && v.y > 0.05 && (!best || e > best.e) && !ray(cx - nrm.x * side * 0.08, cy, cz - nrm.z * side * 0.08, v.x, v.y, v.z, 40)) best = { d: v.clone().negate(), c: new THREE.Vector3(...sun.color), e };
      } else if (sky && outdoors && !best && map.weather?.sky) {
        // only the night outside: a faint grey fall of it through the glass
        const v = new THREE.Vector3(-nrm.x * side * 0.75, 0.62, -nrm.z * side * 0.75).add(along.clone().multiplyScalar(0.2)).normalize();
        best = { d: v.clone().negate(), c: new THREE.Vector3(...map.weather.sky).multiplyScalar(0.9), e: 0.8 };
      }
      return best;
    };
    const add = (cx: number, cy: number, cz: number, along: THREE.Vector3, nrm: THREE.Vector3, w: number, h: number, side: number, best: Best, slats: boolean, door: { ang: number } | null) => {
      const room = roomAt(cx + nrm.x * side * 0.5, cy, cz + nrm.z * side * 0.5);
      if (!room) return;
      const d = best.d;
      // into the room enough to read as coming through, not skimming the wall
      if (d.x * nrm.x * side + d.z * nrm.z * side < 0.25) return;
      const len = d.y < -0.05 ? Math.min(7, (cy + h / 2 - room.a[1]) / -d.y) : 5;
      const o = new THREE.Vector3(cx, cy - h / 2, cz).addScaledVector(along, -w / 2).addScaledVector(nrm, side * 0.02);
      const M = new THREE.Matrix4().makeBasis(along.clone().multiplyScalar(w), new THREE.Vector3(0, h, 0), d.clone().multiplyScalar(len)).setPosition(o);
      // what reaches the opening, as light in the air; it saturates, so a lamp right outside is a bright slab and not a white-out
      const k = 0.1 * (1 - Math.exp(-(best.e * 0.045) / 0.1)) * gain;
      const mat = new THREE.ShaderMaterial({
        vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, depthTest: false, side: THREE.BackSide, ...BLEND,
        uniforms: {
          tDepth: AIR.tDepth, nf: AIR.nf, inv: AIR.inv, toBox: { value: M.clone().invert() }, fwd: this.fwd, col: { value: best.c }, slats: { value: slats ? h / 0.09 : 0 }, time: this.time, k: { value: k },
        },
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(M);
      mesh.matrixWorldNeedsUpdate = true;
      mesh.frustumCulled = false;
      mesh.renderOrder = -1;
      this.group.add(mesh);
      this.mats.push(mat);
      this.all.push({ m: mat, mesh, base: k, l: best.l?.flicker ? best.l : undefined, door, sky: !best.l });
    };
    for (const g of map.glass) {
      const w = g.b - g.a, h = g.z1 - g.z0;
      if (w < 0.3 || h < 0.3) continue;
      // the pane in game space: centre, along it, and its two faces
      const cx = g.axis === 'x' ? (g.a + g.b) / 2 : g.c, cz = g.axis === 'x' ? -g.c : -(g.a + g.b) / 2, cy = (g.z0 + g.z1) / 2;
      const along = g.axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, -1);
      const nrm = g.axis === 'x' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
      let pick: [number, Best] | null = null;
      for (const side of [1, -1]) {
        if (!roomAt(cx + nrm.x * side * 0.5, cy, cz + nrm.z * side * 0.5)) continue;
        const b = incoming(cx, cy, cz, nrm, along, side, true, 0.8);
        if (b && (!pick || b.e > pick[1].e)) pick = [side, b];
      }
      if (!pick || pick[1].e < 0.25) continue;
      const bl = blinds.some((u) => Math.hypot(u.pos[0] - cx, u.pos[2] - cz) < 0.5 && Math.abs(u.pos[1] - g.z0) < 0.4);
      add(cx, cy, cz, along, nrm, w, h, pick[0], pick[1], bl, null);
    }
    // a lit room through an open door into a dark one: only where one side is much brighter than the other
    (map.doors ?? []).forEach((dd, i) => {
      const x = dd.axis === 'x';
      const along = x ? new THREE.Vector3(dd.sign, 0, 0) : new THREE.Vector3(0, 0, -dd.sign);
      const nrm = x ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
      const cx = dd.hinge[0] + along.x * dd.w / 2, cz = dd.hinge[2] + along.z * dd.w / 2, cy = dd.hinge[1] + dd.h / 2;
      const into = [1, -1].map((side) => incoming(cx, cy, cz, nrm, along, side, false, 1.2));
      for (const [j, side] of [[0, 1], [1, -1]] as const) {
        const b = into[j], back = into[1 - j];
        if (!b || b.e < 0.6 || (back && back.e * 2.5 > b.e)) continue;
        add(cx, cy, cz, along.clone().multiplyScalar(Math.sign(along.x + along.z)), nrm, dd.w, dd.h, side, b, false, doors[i] ?? null);
      }
    });
  }

  get count() { return this.mats.length; }

  /** lamp is how lit each flickering lamp is now (1 on, 0 off) */
  update(time: number, cam: THREE.Camera, lamp?: (l: Light) => number) {
    this.time.value = time;
    cam.getWorldDirection(this.fwd.value);
    for (const h of this.all) {
      if (!h.l && !h.door && !h.sky) continue;
      // a door lets it through as it opens
      const open = h.door ? THREE.MathUtils.smoothstep(Math.abs(h.door.ang), 0.05, 1.0) : 1;
      h.m.uniforms.k.value = h.base * open * (h.l && lamp ? lamp(h.l) : 1) * (h.sky ? 1 + this.bolt * 28 : 1);
      h.mesh.visible = open > 0.01;
    }
  }
}
