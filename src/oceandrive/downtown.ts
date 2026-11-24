import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { U, facadeMaterial, odMaterial, type LightmapInfo } from './materials.ts';
import { SEA } from './water.ts';
import { shared, skin, loadLightmaps } from './world.ts';
import type { Env } from './env.ts';

/**
 * Downtown Miami across the bay: Biscayne Boulevard from SE 4th Street to the arena, Bayfront Park and
 * Bayside, the towers (from OpenStreetMap's footprints and heights), the Metromover overhead; around it
 * the rest of downtown, Brickell and Edgewater as a skyline, and Miami Beach running north and south of
 * the beach block. Port Boulevard's bridge carries you over the bay from 7th Street.
 * (blender/oceandrive/downtown: prep.py -> build_dt.py -> bake -> export_dt.py)
 */

const BASE = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/') + 'oceandrive/';

export interface DtData {
  tx: number;
  ty: number;
  /** the playable streets (Blender x, y) */
  core: [number, number][];
  /** the bridge deck's centreline: Blender x, y, z */
  bridge: [number, number, number][];
  bridge_w: number;
  /** traffic loops (Blender x, y every ~2 m) */
  routes: { pts: [number, number][]; len: number; bridge: boolean; names: string[] }[];
  /** signal-controlled intersections: centre, and per leg the crosswalk's centre, the heading of traffic arriving, the road's width, one-way */
  signals: { x: number; y: number; legs: [number, number, number, number, number][] }[];
  /** walking lines along the sidewalks and the park paths */
  walks: [number, number][][];
  /** every drivable street, both districts: nodes, and edges (a, b, polyline, width) */
  graph: { pts: [number, number][]; edges: [number, number, [number, number][], number][] };
}

export interface DtScene {
  lightmaps: Record<string, LightmapInfo>;
  layers: { file: string }[];
  core: [number, number][];
}

/** a built tile of the county (county.json) */
export interface TileInfo {
  name: string;
  label: string;
  frame: 'main' | 'beach';
  core: [number, number][];
  glb: string;
  scene: string;
  data: string;
  layers: string[];
}

export interface Tile {
  info: TileInfo;
  root: THREE.Object3D;
  data: DtData;
  crowns: THREE.MeshStandardMaterial[];
  facades: THREE.MeshPhysicalMaterial[];
  /** reflections for the towers' glass */
  setProbe: (t: THREE.Texture | null) => void;
  /** lit crowns and the like at night (0..1) */
  setNight: (n: number) => void;
}
/** (the first tile, Biscayne Boulevard, as the page knew it before the county) */
export type Downtown = Tile;

export async function county(): Promise<TileInfo[]> {
  const r = await fetch(BASE + 'county.json').catch(() => null);
  return r && r.ok ? ((await r.json()) as { tiles: TileInfo[] }).tiles : [];
}

/** the materials downtown-built scenes need beyond the block's: facades, crowns, railings, far ground, the bay */
function dtSkin(env: Env, bay: THREE.ShaderMaterial | null) {
  const crowns: THREE.MeshStandardMaterial[] = [];
  const facades: THREE.MeshPhysicalMaterial[] = [];
  const fcache = new Map<string, THREE.Material>();
  const rail = new THREE.MeshPhysicalMaterial({ name: 'od_rail', color: 0x9fb8b4, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
  const farGround = odMaterial({ name: 'od_farground', diff: 'concrete_pavement_diff.webp', nor: 'concrete_pavement_nor.webp', tile: 4.0, kind: 'ground', grime: 0.6, vertexColors: false, color: 0xb9b6ae, roughness: 0.95 }, null);
  const special = (name: string, mesh: THREE.Mesh, lm: { tex: THREE.Texture; info: LightmapInfo } | null): THREE.Material | null => {
    if (name === 'od_bay' && bay) {
      mesh.renderOrder = 2;
      return bay;
    }
    if (name === 'od_rail') return rail;
    if (name === 'od_farground') return farGround;
    if (name === 'od_crown') {
      const m = new THREE.MeshStandardMaterial({ name: 'od_crown', vertexColors: true, color: 0x9a9ea3, roughness: 0.35, metalness: 0.6, emissive: 0xffffff, emissiveIntensity: 0 });
      // the emissive is the band's own colour (the vertex colour)
      m.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vColor.rgb;');
      };
      crowns.push(m);
      return m;
    }
    const fk = ({ od_curtain: 'curtain', od_ribbon: 'ribbon', od_garage: 'garage', od_skycondo: 'skycondo' } as const)[name as 'od_curtain'];
    if (fk) {
      const key = fk + '|' + (lm ? 'lm' + lm.tex.uuid : '');
      let m = fcache.get(key) as THREE.MeshPhysicalMaterial | undefined;
      if (!m) {
        m = facadeMaterial(fk, lm);
        fcache.set(key, m);
        facades.push(m);
      }
      return m;
    }
    return null;
  };
  void env;
  const setProbe = (t: THREE.Texture | null) => {
    for (const m of facades) {
      m.envMap = t;
      m.envMapIntensity = 1;
      m.needsUpdate = true;
    }
  };
  const setNight = (n: number) => {
    for (const m of crowns) m.emissiveIntensity = n > 0.02 ? 5.5 * n : 0;
  };
  return { special, crowns, facades, setProbe, setNight };
}

export async function loadTile(env: Env, info: TileInfo, progress: (f: number) => void = () => {}): Promise<Tile> {
  const tl = new THREE.TextureLoader();
  const meta = (await (await fetch(BASE + info.scene)).json()) as DtScene;
  const [data, lms] = await Promise.all([fetch(BASE + info.data).then((r) => r.json() as Promise<DtData>), loadLightmaps(meta.lightmaps, tl)]);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(BASE + info.glb, (e) => {
    if (e.total) progress(e.loaded / e.total);
  });
  const root = gltf.scene;
  root.name = 'tile_' + info.name;
  const k = dtSkin(env, null);
  skin(root, lms, env, shared(tl), k.special);
  return { info, root, data, crowns: k.crowns, facades: k.facades, setProbe: k.setProbe, setNight: k.setNight };
}

/** the county's skyline: every group sky_<tile> / skyland_<tile> (hidden while that tile is in), the bay, the far land */
export interface Skyline {
  root: THREE.Object3D;
  bay: THREE.ShaderMaterial;
  groups: Map<string, THREE.Object3D[]>;
  setProbe: (t: THREE.Texture | null) => void;
  setNight: (n: number) => void;
}
export async function loadSkyline(env: Env, tileNames: string[] = []): Promise<Skyline | null> {
  const r = await fetch(BASE + 'skyline.glb', { method: 'HEAD' }).catch(() => null);
  if (!r || !r.ok) return null;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(BASE + 'skyline.glb');
  const root = gltf.scene;
  root.name = 'skyline';
  const bay = makeBay(env.hdr!);
  const k = dtSkin(env, bay);
  skin(root, new Map(), env, shared(), k.special);
  const groups = new Map<string, THREE.Object3D[]>();
  root.traverse((o) => {
    const m = /^sky(?:land)?_(.+)$/.exec(o.name);
    if (!m || !(o as THREE.Mesh).isMesh && !o.children.length) return;
    // which group: the longest tile name the rest starts with (else 'far', or the object's own)
    const rest = m[1];
    const names = [...tileNames, 'far'].filter((n) => rest === n || rest.startsWith(n + '_')).sort((a, b) => b.length - a.length);
    const g = names[0] ?? rest.replace(/_\d+$/, '');
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(o);
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.castShadow = /^sky_/.test(o.name) && !/bay|far|beach|seawall/.test(g);
  });
  return { root, bay, groups, setProbe: k.setProbe, setNight: k.setNight };
}

/** the beach block's horizon plane (west to the edge of the world, north and south along the island): the skyline has its own now */
export function trimHorizon(block: THREE.Object3D) {
  block.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !(m.name.startsWith('horizon') || m.parent?.name.startsWith('horizon'))) return;
    m.updateMatrixWorld(true);
    const g = m.geometry;
    const pos = g.getAttribute('position');
    const idx = g.getIndex();
    if (!idx) return;
    const v = new THREE.Vector3();
    const keep: number[] = [];
    for (let i = 0; i < idx.count; i += 3) {
      let west = true;
      for (let k = 0; k < 3; k++) {
        v.fromBufferAttribute(pos, idx.getX(i + k)).applyMatrix4(m.matrixWorld);
        if (v.x > 202.5) west = false;
      }
      if (!west) keep.push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
    }
    g.setIndex(keep);
  });
}

/**
 * Biscayne Bay: sheltered water, a short wind chop and the wakes of nothing in particular. The slope is
 * a sum of small travelling waves and two ripple layers (faded with distance); the colour is the bay's
 * green-teal; the sky reflected by Fresnel, a glitter path under the sun, and the city's lights at night
 * as streaks on the water.
 */
export function makeBay(hdr: THREE.Texture): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    name: 'od_bay',
    transparent: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        tSky: { value: hdr },
        uSeaZ: { value: -1.5 },
        tRefl: { value: null },
        uReflMat: { value: new THREE.Matrix4() },
        uReflOn: { value: 0 },
      },
    ]),
    vertexShader: /* glsl */ `
      uniform float uSeaZ;
      varying vec3 vW;
      #include <fog_pars_vertex>
      void main() {
        vec4 w = modelMatrix * vec4( position, 1.0 );
        w.y = uSeaZ + 0.05;
        vW = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSky;
      uniform sampler2D tRefl;
      uniform mat4 uReflMat;
      uniform float uReflOn;
      uniform vec3 uSunCol;
      uniform vec3 uSunDir;
      uniform float uNight;
      uniform float uTime;
      uniform float uRain;
      uniform float uSeaState;
      uniform vec3 uSkyE;
      uniform float uSkyPhotoK;
      uniform float uGrey;
      varying vec3 vW;
      #include <common>
      #include <fog_pars_fragment>
      vec2 eqUv( vec3 d ) { return vec2( atan( d.z, d.x ) * RECIPROCAL_PI2 + 0.5, asin( clamp( d.y, -1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5 ); }
      float h12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
      float vn( vec2 x ) { vec2 i = floor( x ); vec2 f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
        return mix( mix( h12( i ), h12( i + vec2( 1, 0 ) ), f.x ), mix( h12( i + vec2( 0, 1 ) ), h12( i + vec2( 1, 1 ) ), f.x ), f.y ); }
      // a wind chop: travelling waves of 1.5 - 9 m from the east-south-east, slope only
      vec2 chop( vec2 p, float t, float fade ) {
        vec2 g = vec2( 0.0 );
        for ( int i = 0; i < 7; i ++ ) {
          float fi = float( i );
          float a = 3.6 + fi * 0.71 + sin( fi * 2.3 ) * 0.6;
          vec2 D = vec2( cos( a ), sin( a ) );
          float L = 9.0 * pow( 0.74, fi );
          float k = 6.2831853 / L;
          float c = sqrt( 9.81 / k );
          float amp = 0.05 * L / 9.0 * ( 0.6 + 0.4 * uSeaState );
          float ph = k * ( dot( D, p ) - c * t ) + fi * 1.7;
          g += D * k * amp * cos( ph );
        }
        return g * fade;
      }
      vec2 ripples( vec2 p, float t ) {
        float e = 0.06;
        vec2 a = p * 1.3 + vec2( t * 0.4, t * 0.15 ), b = p * 2.9 - vec2( t * 0.25, -t * 0.35 );
        float h0 = vn( a ) + 0.5 * vn( b );
        float hx = vn( a + vec2( e, 0 ) ) + 0.5 * vn( b + vec2( e, 0 ) );
        float hz = vn( a + vec2( 0, e ) ) + 0.5 * vn( b + vec2( 0, e ) );
        return vec2( hx - h0, hz - h0 ) / e;
      }
      void main() {
        vec3 V = normalize( vW - cameraPosition );
        float dist = length( vW - cameraPosition );
        float detail = 1.0 - smoothstep( 40.0, 600.0, dist );
        vec2 g = chop( vW.xz, uTime, 1.0 - smoothstep( 150.0, 2500.0, dist ) * 0.85 );
        // gusts: cat's-paws of rougher water and glassy patches drifting across the bay
        float gust = vn( vW.xz * 0.012 + vec2( uTime * 0.015, uTime * 0.006 ) ) * 0.7 + vn( vW.xz * 0.045 - uTime * 0.02 ) * 0.3;
        g *= 0.35 + 1.3 * gust;
        g += ripples( vW.xz, uTime ) * 0.05 * detail;
        if ( uRain > 0.0 ) g += ( vec2( vn( vW.xz * 9.0 + uTime * 3.0 ), vn( vW.xz * 9.0 - uTime * 3.3 + 5.0 ) ) - 0.5 ) * 0.4 * uRain * detail;
        vec3 N = normalize( vec3( -g.x, 1.0, -g.y ) );
        vec3 R = reflect( V, N );
        R.y = abs( R.y ) + 0.02;
        vec3 sky = min( texture2D( tSky, eqUv( normalize( R ) ) ).rgb * uSkyPhotoK, vec3( 40.0 ) );
        // the mirror: the skyline and the sky above the water, bent by the chop
        if ( uReflOn > 0.5 ) {
          vec4 rc = uReflMat * vec4( vW, 1.0 );
          vec2 ruv = rc.xy / rc.w + g * vec2( 0.035, 0.06 );
          if ( ruv.x > 0.0 && ruv.x < 1.0 && ruv.y > 0.0 && ruv.y < 1.0 ) {
            vec3 rf = texture2D( tRefl, ruv ).rgb;
            // the bay's own colour tints what it mirrors
            sky = min( rf, vec3( 40.0 ) ) * vec3( 0.86, 0.95, 0.92 );
          }
        }
        float cosi = max( dot( -V, N ), 0.0 );
        float F = 0.02 + 0.98 * pow( 1.0 - cosi, 5.0 );
        F = min( F, 0.9 );
        float sunUp = max( uSunDir.y, 0.0 );
        vec3 E = uSunCol * sunUp + uSkyE;
        // Biscayne Bay: a green-teal, not a pool
        vec3 body = vec3( 0.022, 0.105, 0.09 );
        body = mix( body, vec3( dot( body, vec3( 0.3, 0.5, 0.2 ) ) ) * vec3( 0.75, 0.9, 0.95 ), uGrey * 0.75 );
        body *= E * 0.3183;
        float rs = max( dot( R, uSunDir ), 0.0 );
        vec3 spec = uSunCol * ( pow( rs, 900.0 ) * 14.0 + pow( rs, 90.0 ) * 0.7 );
        vec3 col = mix( body, sky, F ) + spec;
        // the city at night, where the mirror can't see: a faint warm sheen off the far shore
        col += uNight * ( 1.0 - uReflOn ) * vec3( 1.0, 0.8, 0.55 ) * 0.02 * F;
        gl_FragColor = vec4( col, 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  m.uniforms.uTime = U.uTime;
  m.uniforms.uSunDir = U.uSunDir;
  m.uniforms.uNight = U.uNight;
  m.uniforms.uSunCol = U.uSunCol;
  m.uniforms.uRain = U.uRain;
  Object.assign(m.uniforms, SEA);
  return m;
}
