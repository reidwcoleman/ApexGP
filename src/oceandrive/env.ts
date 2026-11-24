import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { U } from './materials.ts';

/**
 * Light: the same Poly Haven sky the bake used (Qwantani, late afternoon), as background and as the
 * image-based light, and its sun as one directional light with the energy measured off the HDRI
 * (the sun disc integrated: E ≈ 9.2 / 7.4 / 5.2 W/m²) so the real-time sun and the baked bounce
 * agree. Shadows: three cascades (CSM) out to 320 m, every lit material registered with them.
 */


// sun direction in three's frame: toward the sun (x east-ish over the sea, y up, z = -north)
const SUN_AZ = THREE.MathUtils.degToRad(-36);
const SUN_EL = THREE.MathUtils.degToRad(19.07);
export const SUN_E: [number, number, number] = [9.18, 7.38, 5.23];

export class Env {
  readonly toSun = new THREE.Vector3(Math.cos(SUN_AZ) * Math.cos(SUN_EL), Math.sin(SUN_EL), -Math.sin(SUN_AZ) * Math.cos(SUN_EL));
  csm!: CSM;
  hdr: THREE.DataTexture | null = null;
  envMap: THREE.Texture | null = null;
  private readonly prepped = new WeakSet<THREE.Material>();
  readonly fog: THREE.FogExp2;
  /** the backdrop: the sky photo with its highlights rolled off, and a drawn sun */
  readonly dome: THREE.Mesh;
  readonly domeMat: THREE.ShaderMaterial;

  constructor(readonly renderer: THREE.WebGLRenderer, readonly scene: THREE.Scene, readonly camera: THREE.PerspectiveCamera) {
    U.uSunDir.value.copy(this.toSun);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const mx = Math.max(...SUN_E);
    this.csm = new CSM({
      maxFar: 320,
      cascades: 3,
      mode: 'practical',
      parent: scene,
      shadowMapSize: 2048,
      lightDirection: this.toSun.clone().negate(),
      lightIntensity: mx,
      lightNear: 1,
      lightFar: 900,
      lightMargin: 120,
      camera,
    });
    for (const l of this.csm.lights) {
      l.color.setRGB(SUN_E[0] / mx, SUN_E[1] / mx, SUN_E[2] / mx);
      l.shadow.bias = -0.00012;
      l.shadow.normalBias = 0.035;
      l.shadow.radius = 2;
    }
    this.csm.fade = true;
    fixCsmChunk();
    // haze: the Atlantic air at 5 pm, a little milky
    this.fog = new THREE.FogExp2(0xb9c6d2, 0); // the haze is a post pass now (post.ts AtmosphereEffect)
    scene.fog = this.fog;
    this.domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        tSky: { value: null },
        uSun: { value: this.toSun },
        uK: { value: 1 },
        uSunK: { value: 1 },
        uSunTint: { value: new THREE.Vector3(1, 0.86, 0.66) },
        uCloud: { value: 0 },
        uCloudLit: { value: new THREE.Vector3(1.6, 1.5, 1.4) },
        uCloudAmb: { value: new THREE.Vector3(0.7, 0.75, 0.85) },
        uStars: { value: 0 },
        uFlash: { value: 0 },
        uHaze: { value: 0 },
        uHazeCol: { value: new THREE.Vector3(0.5, 0.55, 0.6) },
        uNightSky: { value: 0 },
        uMoon: { value: 0 },
        uTime: U.uTime,
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize( ( modelMatrix * vec4( position, 0.0 ) ).xyz );
          vec4 p = projectionMatrix * viewMatrix * vec4( cameraPosition + vDir * 4000.0, 1.0 );
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSky;
        uniform vec3 uSun;
        uniform float uK;
        uniform float uSunK;
        uniform vec3 uSunTint;
        uniform float uCloud;
        uniform vec3 uCloudLit;
        uniform vec3 uCloudAmb;
        uniform float uStars;
        uniform float uFlash;
        uniform float uHaze;
        uniform vec3 uHazeCol;
        uniform float uNightSky;
        uniform float uMoon;
        uniform float uTime;
        varying vec3 vDir;
        #include <common>
        float h12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
        float h13( vec3 p3 ) { p3 = fract( p3 * 0.1031 ); p3 += dot( p3, p3.zyx + 31.32 ); return fract( ( p3.x + p3.y ) * p3.z ); }
        float vn( vec2 x ) { vec2 i = floor( x ); vec2 f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( h12( i ), h12( i + vec2( 1, 0 ) ), f.x ), mix( h12( i + vec2( 0, 1 ) ), h12( i + vec2( 1, 1 ) ), f.x ), f.y ); }
        float fbm( vec2 p ) { float s = 0.0, a = 0.5; for ( int i = 0; i < 6; i ++ ) { s += a * vn( p ); p = mat2( 1.6, 1.2, -1.2, 1.6 ) * p + 7.3; a *= 0.5; } return s; }
        vec3 photo( vec3 d ) {
          vec2 uv = vec2( atan( d.z, d.x ) * RECIPROCAL_PI2 + 0.5, asin( clamp( d.y, -1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5 );
          vec3 c = texture2D( tSky, uv ).rgb * uK;
          float m = max( c.r, max( c.g, c.b ) );
          float lim = 2.5 * max( uK, 0.02 );
          if ( m > lim ) c *= ( lim + log( 1.0 + ( m - lim ) ) * 0.6 * uK ) / m;
          return c;
        }
        float cloudDens( vec2 p ) {
          vec2 q = vec2( fbm( p * 0.6 + uTime * 0.01 ), fbm( p * 0.6 - 3.7 ) );
          float n = fbm( p + q * 1.3 + vec2( uTime * 0.006, uTime * 0.002 ) );
          float cov = 1.0 - uCloud;
          return smoothstep( cov * 0.75, cov * 0.75 + 0.28, n );
        }
        void main() {
          vec3 d = normalize( vDir );
          vec3 c = photo( d );
          // night: the photo's last afterglow fades to a deep, slightly blue sky
          c = mix( c, vec3( dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ) ) * vec3( 0.45, 0.6, 1.0 ) * 0.7, uNightSky );
          float cs = dot( d, uSun );
          // the photo's own sun (with its lens starburst) is replaced by the sky from just outside it,
          // carried inward; a clean disc and glow are drawn over that
          if ( cs > 0.97 && uSunK > 0.0 ) {
            vec3 t1 = normalize( cross( uSun, vec3( 0.0, 1.0, 0.0 ) ) ), t2 = cross( t1, uSun );
            vec3 avg = vec3( 0.0 );
            for ( int i = 0; i < 12; i ++ ) {
              float a = float( i ) * 0.5236;
              avg += photo( normalize( uSun * 0.978 + ( t1 * cos( a ) + t2 * sin( a ) ) * 0.2085 ) );
            }
            c = mix( c, avg / 12.0, smoothstep( 0.975, 0.992, cs ) );
          }
          // stars (night)
          if ( uStars > 0.0 && d.y > 0.0 ) {
            vec3 sd = d * 420.0;
            vec3 cell = floor( sd );
            float h = h13( cell );
            if ( h > 0.996 ) {
              vec3 f = fract( sd ) - 0.5;
              float tw = 0.7 + 0.3 * sin( uTime * ( 2.0 + h * 40.0 ) + h * 100.0 );
              c += vec3( 0.9, 0.95, 1.0 ) * smoothstep( 0.22, 0.0, length( f ) ) * ( h - 0.996 ) * 250.0 * tw * uStars * smoothstep( 0.0, 0.25, d.y );
            }
          }
          float sunVis = 1.0;
          // clouds: a layer at altitude, warped fbm, lit from the sun's side, silver at the rims near the sun
          if ( uCloud > 0.0 && d.y > -0.05 ) {
            vec2 p = d.xz / ( d.y + 0.12 ) * 1.4;
            float dens = cloudDens( p );
            vec2 toS = normalize( uSun.xz + 1e-4 ) * 0.09;
            float ds = cloudDens( p + toS ) * 0.6 + cloudDens( p + toS * 2.5 ) * 0.4;
            float lit = exp( -ds * 2.2 );
            float rim = pow( max( cs, 0.0 ), 6.0 ) * ( 1.0 - dens ) * 2.5;
            vec3 col = uCloudAmb * ( 1.0 - 0.45 * dens ) + uCloudLit * ( lit * 0.85 + rim );
            col = mix( col, uHazeCol, 1.0 - smoothstep( 0.0, 0.3, d.y ) );
            float a = dens * smoothstep( -0.03, 0.1, d.y );
            c = mix( c, col, a );
            sunVis = 1.0 - a * 0.97;
          }
          if ( uMoon > 0.0 ) {
            // the moon: a pale disc with faint maria and a soft halo (it rides where the sun would be)
            float md = smoothstep( 0.99995, 0.99997, cs );
            vec3 t1 = normalize( cross( uSun, vec3( 0.0, 1.0, 0.0 ) ) ), t2 = cross( t1, uSun );
            vec2 mp = vec2( dot( d, t1 ), dot( d, t2 ) ) * 180.0;
            float maria = 0.75 + 0.25 * vn( mp * 0.9 + 3.0 );
            c += vec3( 0.85, 0.9, 1.0 ) * ( md * 3.5 * maria + pow( max( cs, 0.0 ), 2000.0 ) * 0.25 + pow( max( cs, 0.0 ), 60.0 ) * 0.015 ) * uMoon * sunVis;
          }
          float disc = smoothstep( 0.99996, 0.99998, cs );
          c += uSunTint * ( disc * 40.0 + pow( max( cs, 0.0 ), 3000.0 ) * 4.0 + pow( max( cs, 0.0 ), 400.0 ) * 0.9 * sunVis + pow( max( cs, 0.0 ), 50.0 ) * 0.3 ) * uSunK * mix( 0.15, 1.0, sunVis );
          // rain: the horizon greys out; lightning lights the whole sky
          c = mix( c, uHazeCol, uHaze * ( 1.0 - smoothstep( -0.05, 0.45, d.y ) ) );
          c += uFlash * vec3( 0.75, 0.8, 1.0 ) * ( 0.6 + 0.4 * d.y );
          gl_FragColor = vec4( c, 1.0 );
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(10, 256, 128), this.domeMat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    scene.add(this.dome);
  }

  /** reflection probes: the street as seen from a few points, filtered for glossy reflections */
  readonly probes: { pos: THREE.Vector3; tex: THREE.Texture }[] = [];
  bakeProbes(points: THREE.Vector3[], hide: THREE.Object3D[]) {
    for (const p of this.probes) p.tex.dispose();
    this.probes.length = 0;
    const pm = new THREE.PMREMGenerator(this.renderer);
    const rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
    const cam = new THREE.CubeCamera(0.3, 2500, rt);
    const vis = hide.map((o) => o.visible);
    hide.forEach((o) => (o.visible = false));
    for (const p of points) {
      cam.position.copy(p);
      cam.update(this.renderer, this.scene);
      this.probes.push({ pos: p.clone(), tex: pm.fromCubemap(rt.texture).texture });
    }
    hide.forEach((o, i) => (o.visible = vis[i]));
    rt.dispose();
    pm.dispose();
  }

  /** the probe nearest a point */
  probeAt(x: number, z: number): THREE.Texture | null {
    let best: THREE.Texture | null = null, bd = Infinity;
    for (const p of this.probes) {
      const d = (p.pos.x - x) ** 2 + (p.pos.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = p.tex;
      }
    }
    return best;
  }

  /** register a material with the shadow cascades (keeps its own onBeforeCompile) */
  prep(m: THREE.Material) {
    if (this.prepped.has(m)) return;
    this.prepped.add(m);
    if (!(m instanceof THREE.MeshStandardMaterial) && !(m instanceof THREE.MeshLambertMaterial) && !(m instanceof THREE.MeshPhongMaterial)) return;
    const own = m.onBeforeCompile;
    this.csm.setupMaterial(m);
    const csmHook = m.onBeforeCompile;
    m.onBeforeCompile = function (sh, r) {
      own.call(this, sh, r);
      csmHook.call(this, sh, r);
    };
    m.needsUpdate = true;
  }

  prepObject(o: THREE.Object3D, cast = true, receive = true) {
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = cast;
      m.receiveShadow = receive;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const x of mats) this.prep(x);
    });
  }

  update() {
    this.camera.updateMatrixWorld();
    this.csm.update();
  }

  resize() {
    this.csm.updateFrustums();
  }
}

/**
 * three r186's CSM swaps its own copy of lights_fragment_begin into ShaderChunk, and that copy lacks
 * the DFG lookup the stock chunk now does (material.dfg): left at zero, it multiplies every
 * image-based reflection by nothing. Put the lookup back (the stock chunk's own block).
 */
function fixCsmChunk() {
  const stock = THREE.ShaderChunk.lights_fragment_begin;
  if (stock.includes('material.dfg =')) return;
  const block = /* glsl */ `
#ifdef STANDARD
	float dotNVms = saturate( dot( geometryNormal, geometryViewDir ) );
	material.dfg = texture2D( dfgLUT, vec2( material.roughness, dotNVms ) ).rg;
	#if ( NUM_DIR_LIGHTS > 0 || NUM_POINT_LIGHTS > 0 || NUM_SPOT_LIGHTS > 0 )
		float EssMs = material.dfg.x + material.dfg.y;
		material.multiScatteringCompensation = 1.0 + material.specularColorBlended * ( 1.0 / EssMs - 1.0 );
	#endif
#endif
IncidentLight directLight;`;
  THREE.ShaderChunk.lights_fragment_begin = stock.replace('IncidentLight directLight;', block);
}
