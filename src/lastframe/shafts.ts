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
  /** each shaft that hangs on a flickering lamp, and which lamp */
  private hung: { m: THREE.ShaderMaterial; base: number; l: Light }[] = [];

  constructor(map: { glass: Glass[]; lights: Light[]; rooms: Room[]; units?: Unit[]; weather?: { sky?: number[]; sun?: { dir: number[]; power: number; color: number[] } } }, ray: Ray, gain = 1) {
    const inRoom = (x: number, y: number, z: number) => map.rooms.some((r) => x > r.a[0] && x < r.b[0] && y > r.a[1] - 0.2 && y < r.b[1] && z > r.a[2] && z < r.b[2]);
    const roomAt = (x: number, y: number, z: number) => map.rooms.find((r) => x > r.a[0] && x < r.b[0] && y > r.a[1] - 0.2 && y < r.b[1] && z > r.a[2] && z < r.b[2]);
    const blinds = (map.units ?? []).filter((u) => u.id.includes('|blinds'));
    const sun = map.weather?.sun;
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
    for (const g of map.glass) {
      const w = g.b - g.a, h = g.z1 - g.z0;
      if (w < 0.3 || h < 0.3) continue;
      // the pane in game space: centre, along it, and its two faces
      const cx = g.axis === 'x' ? (g.a + g.b) / 2 : g.c, cz = g.axis === 'x' ? -g.c : -(g.a + g.b) / 2, cy = (g.z0 + g.z1) / 2;
      const along = g.axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, -1);
      const nrm = g.axis === 'x' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
      let best: { d: THREE.Vector3; c: THREE.Vector3; e: number; side: number; l?: Light } | null = null;
      for (const side of [1, -1]) {
        // the shaft goes into the room on this side, from a light on the other
        const ins = roomAt(cx + nrm.x * side * 0.5, cy, cz + nrm.z * side * 0.5);
        if (!ins) continue;
        const outdoors = !inRoom(cx - nrm.x * side * 0.5, cy, cz - nrm.z * side * 0.5);
        for (const l of map.lights) {
          if (l.power < 2) continue;
          const v = new THREE.Vector3(l.pos[0] - cx, l.pos[1] - cy, l.pos[2] - cz);
          const dist = v.length();
          if (dist > 30 || dist < 0.8) continue;
          v.divideScalar(dist);
          const facing = -(v.x * nrm.x + v.z * nrm.z) * side;
          if (facing < 0.25) continue;
          const e = (l.power / (dist * dist)) * facing;
          if (best && e <= best.e) continue;
          // can it see the window: from just outside the glass to just short of the lamp
          const sx = cx - nrm.x * side * 0.08, sz = cz - nrm.z * side * 0.08;
          const hit = ray(sx, cy, sz, v.x, v.y, v.z, Math.max(0.1, dist - 0.35));
          if (hit) continue;
          best = { d: v.clone().negate(), c: new THREE.Vector3(...l.color), e, side, l };
        }
        if (outdoors && sun) {
          const v = new THREE.Vector3(...sun.dir);
          const facing = -(v.x * nrm.x + v.z * nrm.z) * side;
          const e = sun.power * 0.6 * facing;
          if (facing > 0.2 && v.y > 0.05 && (!best || e > best.e) && !ray(cx - nrm.x * side * 0.08, cy, cz - nrm.z * side * 0.08, v.x, v.y, v.z, 40)) {
            best = { d: v.clone().negate(), c: new THREE.Vector3(...sun.color), e, side };
          }
        } else if (outdoors && !best && map.weather?.sky) {
          // only the night outside: a faint grey fall of it through the glass
          const v = new THREE.Vector3(-nrm.x * side * 0.75, 0.62, -nrm.z * side * 0.75).add(along.clone().multiplyScalar(0.2)).normalize();
          best = { d: v.clone().negate(), c: new THREE.Vector3(...map.weather.sky).multiplyScalar(0.9), e: 0.8, side };
        }
      }
      if (!best || best.e < 0.25) continue;
      const side = best.side;
      const room = roomAt(cx + nrm.x * side * 0.5, cy, cz + nrm.z * side * 0.5)!;
      const d = best.d;
      // into the room enough to read as coming through the window, not skimming the wall
      const inward = d.x * nrm.x * side + d.z * nrm.z * side;
      if (inward < 0.25) continue;
      const floor = room.a[1];
      const len = d.y < -0.05 ? Math.min(7, (g.z1 - floor) / -d.y) : 5;
      const o = new THREE.Vector3(cx, cy, cz).addScaledVector(along, -w / 2).add(new THREE.Vector3(0, -h / 2, 0)).addScaledVector(nrm, side * 0.02);
      const U = along.clone().multiplyScalar(w), V = new THREE.Vector3(0, h, 0), D = d.clone().multiplyScalar(len);
      const M = new THREE.Matrix4().makeBasis(U, V, D).setPosition(o);
      const toBox = M.clone().invert();
      const bl = blinds.some((u) => Math.hypot(u.pos[0] - cx, u.pos[2] - cz) < 0.5 && Math.abs(u.pos[1] - g.z0) < 0.4);
      // what reaches the glass, as light in the air: a lamp falls off with distance, the sky and sun don't
      // it saturates: a lamp right outside is a bright slab, not a white-out
      const k = 0.1 * (1 - Math.exp(-(best.e * 0.045) / 0.1)) * gain;
      const mat = new THREE.ShaderMaterial({
        vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, depthTest: false, side: THREE.BackSide, ...BLEND,
        uniforms: {
          tDepth: AIR.tDepth, nf: AIR.nf, inv: AIR.inv, toBox: { value: toBox }, fwd: this.fwd, col: { value: best.c }, slats: { value: bl ? h / 0.09 : 0 }, time: this.time, k: { value: k },
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
      if (best.l?.flicker) this.hung.push({ m: mat, base: k, l: best.l });
    }
  }

  get count() { return this.mats.length; }

  /** lamp is how lit each flickering lamp is now (1 on, 0 off) */
  update(time: number, cam: THREE.Camera, lamp?: (l: Light) => number) {
    this.time.value = time;
    cam.getWorldDirection(this.fwd.value);
    if (lamp) for (const h of this.hung) h.m.uniforms.k.value = h.base * lamp(h.l);
  }
}
