import * as THREE from 'three';
import type { Terrain } from './collide.ts';
import { LF, SUN_GLSL } from './lighting.ts';
import { PASTURE } from './terrain.ts';

/**
 * Real grass, grown where you stand. The map holds no blades: a square of them is built once at three densities, and each
 * frame the squares round the camera are laid on the land. The height, the splat and the light all come from textures in the
 * vertex shader, and shading is done there too, so a blade costs almost nothing past its triangles.
 */
const PATCH = 8;
const LODS = [{ reach: 16, blades: 3400, segs: 3, w: 0.016 }, { reach: 34, blades: 1400, segs: 2, w: 0.028 }, { reach: 58, blades: 520, segs: 1, w: 0.05 }];

function bladePatch(n: number, segs: number, w: number, seed: number) {
  let s = seed;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const verts = segs * 2 + 1;
  const pos = new Float32Array(n * verts * 3), side = new Float32Array(n * verts), rd = new Float32Array(n * verts * 4);
  const idx: number[] = [];
  for (let b = 0; b < n; b++) {
    const x = rnd() * PATCH, z = rnd() * PATCH, a = rnd(), h = rnd(), c = rnd(), e = rnd();
    const o = b * verts;
    for (let i = 0; i < verts; i++) {
      const t = i === verts - 1 ? 1 : Math.floor(i / 2) / segs;
      pos[(o + i) * 3] = x;
      pos[(o + i) * 3 + 1] = t;
      pos[(o + i) * 3 + 2] = z;
      side[o + i] = i === verts - 1 ? 0 : (i % 2 ? 1 : -1) * w * (0.75 + 0.5 * e);
      rd.set([a, h, c, e], (o + i) * 4);
    }
    for (let i = 0; i < segs; i++) {
      const p = o + i * 2;
      if (i === segs - 1) idx.push(p, p + 1, p + 2);
      else idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  g.setAttribute('aRnd', new THREE.BufferAttribute(rd, 4));
  g.setIndex(idx);
  return g;
}

export class Grass {
  readonly group = new THREE.Group();
  private lods: { mesh: THREE.Mesh; origins: THREE.InstancedBufferAttribute; cap: number }[] = [];
  private frustum = new THREE.Frustum();
  private m = new THREE.Matrix4();
  private sphere = new THREE.Sphere(new THREE.Vector3(), PATCH * 0.9);
  /** which squares have any grass on them at all */
  private mask: Uint8Array;
  private mw: number;
  private mat: THREE.ShaderMaterial;
  private foot: Uint8ClampedArray | null = null;
  private fw = 1;

  /** what the ground is at (x, z), for footsteps */
  surface(x: number, z: number) {
    const t = this.t, d = this.foot;
    if (!d) return 'grit';
    const u = (x - t.x0) / ((t.nx - 1) * t.step), v = (-z - t.y0) / ((t.ny - 1) * t.step);
    const i = Math.max(0, Math.min(this.fw - 1, Math.floor(u * this.fw))), j = Math.max(0, Math.min(this.fw - 1, Math.floor((1 - v) * this.fw)));
    const o = (j * this.fw + i) * 4, g = d[o], r = d[o + 1], s = d[o + 2], l = d[o + 3];
    return g >= r && g >= s && g >= l ? 'turf' : s >= r && s >= l ? 'shingle' : l >= r ? 'hard' : 'grit';
  }

  constructor(private t: Terrain, hTex: THREE.Texture, splat: THREE.Texture, lm3: THREE.Texture) {
    const W = (t.nx - 1) * t.step, H = (t.ny - 1) * t.step;
    this.mw = Math.ceil(W / PATCH);
    const mh = Math.ceil(H / PATCH);
    this.mask = new Uint8Array(this.mw * mh);
    {
      // the splat's own picture, small, to skip squares of road and rock
      const cv = document.createElement('canvas');
      cv.width = this.mw;
      cv.height = mh;
      const c = cv.getContext('2d', { willReadFrequently: true });
      const img = splat.image as CanvasImageSource | undefined;
      if (c && img) {
        c.drawImage(img, 0, 0, this.mw, mh);
        const d = c.getImageData(0, 0, this.mw, mh).data;
        for (let j = 0; j < mh; j++) for (let i = 0; i < this.mw; i++) this.mask[(mh - 1 - j) * this.mw + i] = d[(j * this.mw + i) * 4] > 10 ? 1 : 0;
        // a square whose neighbour has grass may have it at its edge
        const m0 = this.mask.slice();
        for (let j = 1; j < mh - 1; j++) for (let i = 1; i < this.mw - 1; i++) {
          if (m0[j * this.mw + i - 1] || m0[j * this.mw + i + 1] || m0[(j - 1) * this.mw + i] || m0[(j + 1) * this.mw + i]) this.mask[j * this.mw + i] = 1;
        }
      } else this.mask.fill(1);
      // and bigger, for what's underfoot
      const fw = (this.fw = 260), fc = document.createElement('canvas');
      fc.width = fc.height = fw;
      const f = fc.getContext('2d', { willReadFrequently: true });
      if (f && img) {
        f.drawImage(img, 0, 0, fw, fw);
        this.foot = f.getImageData(0, 0, fw, fw).data;
      }
    }
    this.mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: {
        tH: { value: hTex }, tS: { value: splat }, tL: { value: lm3 }, tN: LF.noise, area: { value: new THREE.Vector4(t.x0, t.y0, W, H) }, time: LF.time as { value: number }, lfK: LF.lmK,
        eye: { value: new THREE.Vector3() }, reach: { value: 58 }, step: { value: new THREE.Vector2(1 / t.nx, 1 / t.ny) },
        lfSunDir: LF.sunDir, lfSunC: LF.sunC, lfSunVP: LF.sunVP, lfDynVP: LF.dynVP, lfSunMap: LF.sunMap, lfDynMap: LF.dynMap, lfCloud: LF.cloud,
      },
      vertexShader: /* glsl */ `
        precision highp float;
        attribute float aSide; attribute vec4 aRnd; attribute vec2 aOrigin;
        uniform sampler2D tH, tS, tL, tN; uniform vec4 area; uniform float time, reach; uniform vec3 eye; uniform vec2 lfK;
        varying vec3 vC;
        ${SUN_GLSL}
        ${PASTURE}
        void main() {
          vec2 root = aOrigin + position.xz;
          vec2 uv = vec2( ( root.x - area.x ) / area.z, ( -root.y - area.y ) / area.w );
          vec4 sp = texture2D( tS, uv );
          float gr = sp.r / max( dot( sp, vec4( 1.0 ) ), 0.001 );
          float dist = distance( eye.xz, root );
          float fade = 1.0 - smoothstep( reach * 0.62, reach, dist );
          float clump = texture2D( tN, root * 0.012 ).r;
          float tuft = texture2D( tN, root * 0.11 ).r;
          // grazed short where it's flat, long and rank on the banks, and in tussocks everywhere
          float ground = texture2D( tH, uv ).r;
          float H = ( 0.1 + 0.24 * aRnd.y * aRnd.y + 0.34 * smoothstep( 0.5, 0.72, tuft ) * aRnd.y ) * ( 0.75 + 0.9 * smoothstep( 0.42, 0.62, clump ) );
          H *= smoothstep( 0.3, 0.72, gr ) * fade;
          if ( H < 0.015 || ground < 0.4 ) { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); vC = vec3( 0.0 ); return; }
          float t = position.y;
          float yaw = aRnd.x * 6.2831853;
          vec2 dir = vec2( cos( yaw ), sin( yaw ) ), perp = vec2( -dir.y, dir.x );
          // wind: slow gusts running across the slope, a shiver on top
          float gust = texture2D( tN, root * 0.008 + vec2( -time * 0.012, time * 0.007 ) ).r * 2.0 - 0.9;
          vec2 windD = vec2( 0.72, 0.69 );
          float sway = gust * 0.5 + 0.1 * sin( time * 2.3 + aRnd.w * 6.28 + root.x * 0.7 );
          // a blade leans out as it rises, and more at the tip
          float lean = 0.35 + aRnd.z * 0.75;
          vec2 bend = dir * lean * t * t * H + windD * sway * t * t * H;
          // what's underfoot gets pushed aside
          vec2 away = root - eye.xz;
          float push = 1.0 - smoothstep( 0.15, 0.8, length( away ) );
          bend += normalize( away + 1e-3 ) * push * t * H * 0.8;
          vec3 P = vec3( root.x + bend.x, ground + t * H * ( 1.0 - 0.32 * lean ) * ( 1.0 - 0.5 * push ), root.y + bend.y );
          // a little wider up close to the eye than the geometry says, so it never drops below a pixel
          float grow = 1.0 + dist * 0.016;
          float taper = 1.0 - t * t * 0.6;
          P.xz += perp * aSide * taper * grow;
          vec4 c = projectionMatrix * viewMatrix * vec4( P, 1.0 );
          gl_Position = c;
          // the light, here rather than per pixel. The ground's own colour, so blades and land meet at a distance
          vec3 base = lfPasture( tN, root );
          float tone = 0.8 + 0.42 * aRnd.w;
          vec3 alb = base * mix( vec3( 0.92, 1.02, 0.88 ), vec3( 1.2, 1.1, 0.62 ), aRnd.z * aRnd.y ) * tone;
          // dry tips, and a dark thatch at the root where the light doesn't get
          alb = mix( alb, vec3( 0.34, 0.31, 0.15 ), t * t * 0.32 * aRnd.y );
          float ao = mix( 0.34, 1.0, smoothstep( 0.0, 0.7, t ) );
          vec3 sky = ( exp2( texture2D( tL, uv ).rgb * lfK.x ) - 1.0 ) / lfK.y;
          float vis = lfSunVis( vec3( root.x, ground + t * H, root.y ), vec3( 0.0, 1.0, 0.0 ), aRnd.x * 6.28 ) * lfCloudAt( tN, root );
          vec3 v = normalize( eye - P );
          vec3 bn = normalize( vec3( dir.x * ( 0.25 + t * lean ), 1.0, dir.y * ( 0.25 + t * lean ) ) );
          float nl = clamp( dot( bn, lfSunDir ), 0.0, 1.0 ) * 0.82 + 0.1;
          // the sun through a blade from behind
          float through = pow( clamp( dot( -v, lfSunDir ) * 0.5 + 0.5, 0.0, 1.0 ), 3.0 ) * 0.5 * t;
          vC = alb * ( sky * ao + lfSunC * vis * ( nl * ao + through ) * 0.3183 );
          vC *= mix( vec3( 1.0 ), vec3( 1.12, 1.16, 0.9 ), through * vis );
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec3 vC;
        void main() { gl_FragColor = vec4( vC, 1.0 ); }`,
    });
    LODS.forEach((l, i) => {
      const g = bladePatch(l.blades, l.segs, l.w, 19 + i * 7);
      const cap = 900;
      const origins = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
      origins.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aOrigin', origins);
      g.instanceCount = 0;
      const mesh = new THREE.Mesh(g, this.mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 0;
      this.group.add(mesh);
      this.lods.push({ mesh, origins, cap });
    });
    this.group.name = 'grass';
  }

  update(cam: THREE.PerspectiveCamera) {
    const t = this.t;
    const p = cam.position;
    (this.mat.uniforms.eye.value as THREE.Vector3).copy(p);
    this.frustum.setFromProjectionMatrix(this.m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const n = [0, 0, 0];
    const R = LODS[2].reach;
    const c0 = Math.floor((p.x - R) / PATCH), c1 = Math.floor((p.x + R) / PATCH), r0 = Math.floor((p.z - R) / PATCH), r1 = Math.floor((p.z + R) / PATCH);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const x = c * PATCH, z = r * PATCH, cx = x + PATCH / 2, cz = z + PATCH / 2;
      const d = Math.hypot(cx - p.x, cz - p.z) - PATCH * 0.7;
      if (d > R) continue;
      const i = Math.floor((cx - t.x0) / t.step), j = Math.floor((-cz - t.y0) / t.step);
      if (i < 1 || j < 1 || i >= t.nx - 1 || j >= t.ny - 1) continue;
      const mi = Math.floor((cx - t.x0) / PATCH), mj = Math.floor((-cz - t.y0) / PATCH);
      if (!this.mask[mj * this.mw + mi]) continue;
      this.sphere.center.set(cx, t.h[j * t.nx + i], cz);
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const l = d < LODS[0].reach ? 0 : d < LODS[1].reach ? 1 : 2;
      const k = n[l];
      const L = this.lods[l];
      if (k >= L.cap) continue;
      L.origins.setXY(k, x, z);
      n[l] = k + 1;
    }
    this.lods.forEach((L, i) => {
      (L.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = n[i];
      L.mesh.visible = n[i] > 0;
      L.origins.needsUpdate = true;
    });
  }
}
