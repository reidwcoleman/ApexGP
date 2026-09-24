import * as THREE from 'three';
import { createDevStage } from './devkit.ts';
import { Track } from '../world/Track.ts';
import { MONZA } from '../world/Circuits.ts';
import { buildTrackside, type PanelState } from '../world/TrackMesh.ts';
import { weatherUniforms } from '../world/weatherUniforms.ts';

/**
 * Trackside dev page.
 *   ?s=560&lat=0&h=1.4   camera at track.point(s, lat, h) looking at track.point(s+30, lat/2, 0.5)
 *   ?ahead=30            look-ahead distance for the above
 *   ?top=1               aerial view of the whole circuit
 *   ?aerial=S&ah=120     oblique aerial over track position S
 *   ?ls=S&ll=L&lh=H      override the look target with track.point(S, L, H)
 *   ?lights=0..5         start lights
 *   ?sun=az,el           sun azimuth/elevation in degrees
 *   ?wet=0..1&rain=0..1&dry=0..1&wt=seconds   weather uniforms (wet → overcast sky unless ?sky=clear)
 *   ?sky=clear|overcast  sky/env for the page
 *   ?env=1               use the real Environment (sky, terrain, trees…) instead of the page's simple sky
 *   ?cars=N              drop N cars on the grid / track (for reflections)
 *   ?panels=green        marshal LED panels
 *   ?ssr=0               disable the wet-road reflections
 */

const stage = createDevStage({ fov: 55, near: 0.1, far: 9000 });
const { scene, camera, gfx, params, controls } = stage;
const num = (k: string, d: number) => (params.get(k) !== null ? Number(params.get(k)) : d);

const track = new Track(MONZA);
const ts = buildTrackside(track, gfx);
scene.add(ts.group);
ts.startLights.set(num('lights', 0));
if (params.get('panels')) ts.setPanels?.(params.get('panels') as PanelState);
if (params.get('ssr') === '0') ts.setReflections?.(false);
if (params.get('ssr') === 'copy' && ts.ssr) ts.ssr.copyOnly = true;
if (params.get('ssrds') && ts.ssr) ts.ssr.fixedDownscale = num('ssrds', 3);
if (params.get('ssrlod')) {
  const { ssrUniforms } = await import('../world/trackside/materials.ts');
  ssrUniforms.uSsrLod.value = num('ssrlod', 0);
}
console.log(`[shot] trackside built in ${ts.stats.buildMs.toFixed(0)} ms: ${ts.stats.meshes} meshes, ${ts.stats.triangles} tris, ${ts.stats.chunks} chunks ${JSON.stringify(ts.stats.byKey)} ${JSON.stringify(ts.stats.phases)}`);

// ---------------------------------------------------------------- weather
const wet = num('wet', 0);
const rain = num('rain', 0);
weatherUniforms.uWetness.value = wet;
weatherUniforms.uRain.value = rain;
weatherUniforms.uDryLine.value = num('dry', 0);
weatherUniforms.uCloud.value = wet > 0 || rain > 0 ? 0.95 : 0.1;
weatherUniforms.uWeatherTime.value = num('wt', 12.3);
const overcast = params.get('sky') ? params.get('sky') === 'overcast' : wet > 0.05 || rain > 0;

// ---------------------------------------------------------------- sky, env, sun
const [az, el] = (params.get('sun') ?? '220,36').split(',').map((v) => (Number(v) * Math.PI) / 180);
const sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
const sun = new THREE.DirectionalLight(overcast ? 0xdfe6ee : 0xfff0dc, overcast ? 0.55 : 3.6);
const hemi = new THREE.HemisphereLight(overcast ? 0xb8c2cc : 0xbcd4f0, overcast ? 0x4a4f48 : 0x55603f, overcast ? 1.25 : 0.9);
let useEnv = false;

function skyTexture(): THREE.Texture {
  // equirect sky: gradient + fBm clouds (overcast: a low grey deck with darker rain bands)
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  const hash = (x: number, y: number) => {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const noise = (x: number, y: number, per: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const w = (a: number) => ((a % per) + per) % per;
    const a = hash(w(xi), yi), b = hash(w(xi + 1), yi), cc = hash(w(xi), yi + 1), d = hash(w(xi + 1), yi + 1);
    return (a + (b - a) * sx) * (1 - sy) + (cc + (d - cc) * sx) * sy;
  };
  const fbm = (x: number, y: number) => {
    let v = 0, amp = 0.5, f = 1;
    for (let o = 0; o < 5; o++) {
      v += amp * noise(x * f, y * f, 8 * f);
      amp *= 0.5;
      f *= 2;
    }
    return v;
  };
  const mix = (a: number[], b: number[], t: number) => a.map((v, k) => v + (b[k] - v) * t);
  for (let y = 0; y < H; y++) {
    const el = (0.5 - (y + 0.5) / H) * Math.PI; // +π/2 zenith … −π/2 nadir
    for (let x = 0; x < W; x++) {
      let col: number[];
      if (el < 0) {
        col = overcast ? [70, 74, 68] : [96, 110, 84];
      } else {
        const e = el / (Math.PI / 2);
        const n = fbm((x / W) * 8, e * 6 + 1.3);
        if (overcast) {
          const base = mix([196, 200, 203], [128, 134, 140], Math.pow(e, 0.6));
          const dark = mix(base, [92, 98, 106], Math.max(0, Math.min(1, (n - 0.42) * 2.2)));
          col = mix(dark, [205, 208, 210], Math.max(0, 1 - e * 6) * 0.6);
        } else {
          const blue = mix([214, 228, 240], [52, 104, 178], Math.pow(e, 0.55));
          const cloud = Math.max(0, Math.min(1, (n - 0.55) * 3.5)) * (1 - e * 0.5);
          col = mix(blue, [246, 246, 244], cloud);
        }
      }
      const o = (y * W + x) * 4;
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  if (!overcast) {
    // sun disc
    const sx = ((Math.atan2(sunDir.x, sunDir.z) / (2 * Math.PI) + 0.5) % 1) * W;
    const sy = (0.5 - Math.asin(sunDir.y) / Math.PI) * H;
    const sg = g.createRadialGradient(sx, sy, 0, sx, sy, 26);
    sg.addColorStop(0, 'rgba(255,252,240,1)');
    sg.addColorStop(0.15, 'rgba(255,250,235,0.9)');
    sg.addColorStop(1, 'rgba(255,245,220,0)');
    g.fillStyle = sg;
    g.fillRect(sx - 26, sy - 26, 52, 52);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

if (params.get('env')) {
  try {
    // the Environment API is still moving: call it loosely with a literal WeatherState
    const mod = (await import('../world/Environment.ts')) as unknown as {
      createEnvironment: (t: Track, g: typeof gfx, s: THREE.Scene, w: unknown) => { group: THREE.Group };
    };
    const weather = { kind: rain > 0.5 ? 'rain' : rain > 0 ? 'drizzle' : overcast ? 'overcast' : 'clear', time: 'afternoon', cloud: overcast ? 0.95 : 0.1, rain, wetness: wet, dryLine: num('dry', 0), fog: rain * 0.5, windX: 0, windZ: 0, lightning: 0, airTemp: 18, trackTemp: 22, t: num('wt', 12.3) };
    const env = mod.createEnvironment(track, gfx, scene, weather);
    const e = env as unknown as { setWeather?: (w: unknown) => void; update(dt: number, c: THREE.Camera): void; focusShadow(v: THREE.Vector3): void };
    e.setWeather?.(weather);
    scene.add(env.group);
    stage.onFrame((dt) => {
      e.update(dt, camera);
      e.focusShadow(controls.target);
    });
    useEnv = true;
  } catch (err) {
    console.warn('[track] Environment unavailable', err);
  }
}
if (!useEnv) {
  const sky = skyTexture();
  scene.background = sky;
  const pmrem = new THREE.PMREMGenerator(gfx.renderer);
  scene.environment = pmrem.fromEquirectangular(sky).texture;
  scene.environmentIntensity = overcast ? 1.0 : 0.8;
  scene.fog = new THREE.Fog(overcast ? 0x9aa0a4 : 0xc9d8e6, overcast ? 150 : 500, overcast ? 1600 : 4200);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target, hemi);
  if (overcast) gfx.grade.set({ exposure: 1.05, saturation: 0.95 });
}

// ---------------------------------------------------------------- crude terrain so the page stands alone
if (!useEnv) {
  const field = track.buildDistanceField(8, 500, 400);
  const W = field.w, H = field.h;
  const geo = new THREE.PlaneGeometry((W - 1) * field.cell, (H - 1) * field.cell, W - 1, H - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  let minY = Infinity;
  for (let i = 0; i < track.n; i++) minY = Math.min(minY, track.py[i]);
  for (let v = 0; v < pos.count; v++) {
    const x = pos.getX(v) + field.originX + ((W - 1) * field.cell) / 2;
    const z = pos.getZ(v) + field.originZ + ((H - 1) * field.cell) / 2;
    const d = Track.sampleField(field, field.dist, x, z);
    let y = minY - 3;
    if (isFinite(d)) {
      const hTrack = Track.sampleField(field, field.height, x, z);
      const far = Math.min(1, Math.max(0, (d - 40) / 160));
      y = hTrack - 1.2 - far * 3 + far * 8 * Math.sin(x * 0.004) * Math.cos(z * 0.005);
    }
    pos.setXYZ(v, x, y, z);
  }
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x3a4a2a, roughness: 0.97 }));
  ground.receiveShadow = true;
  scene.add(ground);
}

// ---------------------------------------------------------------- cars (for reflections)
const nCars = num('cars', 0);
if (nCars > 0) {
  try {
    const { createCar } = await import('../car/CarModel.ts');
    const { TEAMS } = await import('../race/Teams.ts');
    for (let k = 0; k < nCars; k++) {
      const team = TEAMS[k % TEAMS.length];
      const rig = createCar(team, team.drivers[k % 2], (k % 2) as 0 | 1, { envMap: scene.environment ?? undefined });
      const g = track.gridSlot(k);
      const cs = params.get('carS') ? num('carS', 0) + k * 9 : g.s;
      const cl = params.get('carS') ? (k % 2 ? 2.2 : -2.0) : g.lateral;
      const f = track.frame(cs);
      track.point(cs, cl, 0, rig.root.position);
      rig.root.rotation.y = f.heading;
      rig.setRainLight?.(rain > 0);
      scene.add(rig.root);
      stage.onFrame((dt) => rig.update(dt));
    }
  } catch (err) {
    console.warn('[track] cars unavailable', err);
  }
}

// ---------------------------------------------------------------- camera placement
const look = new THREE.Vector3();
if (params.get('top')) {
  let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
  for (let i = 0; i < track.n; i++) {
    minx = Math.min(minx, track.px[i]); maxx = Math.max(maxx, track.px[i]);
    minz = Math.min(minz, track.pz[i]); maxz = Math.max(maxz, track.pz[i]);
  }
  look.set((minx + maxx) / 2, 10, (minz + maxz) / 2);
  camera.position.set(look.x + 1, 2600, look.z + 260);
  camera.near = 20;
  scene.fog = null;
  camera.fov = 45;
  camera.updateProjectionMatrix();
} else if (params.get('aerial')) {
  const s = Number(params.get('aerial'));
  const ah = num('ah', 120);
  const f = track.frame(s);
  track.point(s, 0, 0, look);
  camera.position.copy(look).addScaledVector(f.tangent, -ah * 0.9).addScaledVector(f.right, ah * num('side', 0.35));
  camera.position.y += ah;
} else if (params.get('s')) {
  const s = Number(params.get('s'));
  const lat = num('lat', 0);
  const h = num('h', 1.2);
  const ahead = num('ahead', 30);
  track.point(s, lat, h, camera.position);
  track.point(s + ahead, lat * 0.5, 0.5, look);
} else {
  track.point(track.startS - 40, -2, 1.4, camera.position);
  track.point(track.startS - 10, -1, 0.5, look);
}
if (params.get('ls')) track.point(Number(params.get('ls')), num('ll', 0), num('lh', 1), look);
if (params.get('cam')) camera.position.fromArray(params.get('cam')!.split(',').map(Number));
if (params.get('look')) look.fromArray(params.get('look')!.split(',').map(Number));
camera.lookAt(look);
controls.target.copy(look);
controls.update();

// ---------------------------------------------------------------- per-frame
const wide = !!params.get('top');
const animate = params.get('anim') !== '0';
stage.onFrame((dt) => {
  if (!useEnv) {
    const focus = wide ? look : new THREE.Vector3().copy(camera.position).lerp(controls.target, 0.6);
    const r = wide ? 1400 : 110;
    sun.shadow.camera.left = -r;
    sun.shadow.camera.right = r;
    sun.shadow.camera.top = r;
    sun.shadow.camera.bottom = -r;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = wide ? 6000 : 900;
    sun.shadow.camera.updateProjectionMatrix();
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(sunDir, wide ? 3000 : 400);
  }
  if (animate) weatherUniforms.uWeatherTime.value += dt;
  ts.update(dt, camera);
});

// ?plainroad=1 swaps the road shader for a stock MeshStandardMaterial (to measure its cost with ?perf=N)
if (params.get('plainroad')) {
  const plain = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8 });
  ts.group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.name.startsWith('ts_asphalt_')) (o as THREE.Mesh).material = plain;
  });
}
// ?perf=N: average wall time of render + GPU sync over N frames (after warm-up).
// ?ab=ssr|road|wet alternates two variants in blocks of 6 frames so other GPU load cancels out.
const perfN = num('perf', 0);
if (perfN > 0) {
  const gl = gfx.renderer.getContext();
  const px = new Uint8Array(4);
  const orig = gfx.render.bind(gfx);
  const ab = params.get('ab');
  const roadMeshes: THREE.Mesh[] = [];
  ts.group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.name.startsWith('ts_asphalt_')) roadMeshes.push(o as THREE.Mesh);
  });
  const roadMat = roadMeshes[0]?.material as THREE.Material;
  const plainMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8 });
  const wet0 = weatherUniforms.uWetness.value;
  const setVariant = (b: boolean) => {
    if (ab === 'ssr') ts.setReflections?.(!b);
    if (ab === 'road') for (const m of roadMeshes) m.material = b ? plainMat : roadMat;
    if (ab === 'wet') weatherUniforms.uWetness.value = b ? 0 : wet0;
  };
  // ?gpu=1: time only the road draws with a GPU timer query (road chunks draw contiguously at renderOrder 1;
  // a marker at renderOrder 1.5 ends the query)
  const gpu = params.get('gpu') === '1';
  const tq = gpu ? (gl as WebGL2RenderingContext).getExtension('EXT_disjoint_timer_query_webgl2') : null;
  const gl2 = gl as WebGL2RenderingContext;
  let qActive: WebGLQuery | null = null;
  const pending: { q: WebGLQuery; block: number }[] = [];
  let curBlock = 0;
  if (tq) {
    for (const m of roadMeshes) {
      const prev = m.onBeforeRender;
      m.onBeforeRender = function (this: THREE.Object3D, ...args: Parameters<THREE.Object3D['onBeforeRender']>) {
        prev.apply(this, args);
        if (!qActive && args[2] === camera) {
          qActive = gl2.createQuery()!;
          gl2.beginQuery(tq.TIME_ELAPSED_EXT, qActive);
        }
      };
    }
    const marker = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, -1e4, 0, 0, -1e4, 0.001, 0.001, -1e4, 0], 3)), new THREE.MeshBasicMaterial());
    marker.frustumCulled = false;
    marker.renderOrder = 1.5;
    marker.onBeforeRender = () => {
      if (qActive) {
        gl2.endQuery(tq.TIME_ELAPSED_EXT);
        pending.push({ q: qActive, block: curBlock });
        qActive = null;
      }
    };
    scene.add(marker);
  }
  const gAcc = [0, 0], gCnt = [0, 0];
  const pollQueries = () => {
    while (pending.length && gl2.getQueryParameter(pending[0].q, gl2.QUERY_RESULT_AVAILABLE)) {
      const { q, block } = pending.shift()!;
      if (block >= 0 && !gl2.getParameter(tq!.GPU_DISJOINT_EXT)) {
        gAcc[block] += gl2.getQueryParameter(q, gl2.QUERY_RESULT) / 1e6;
        gCnt[block]++;
      }
      gl2.deleteQuery(q);
    }
  };
  let frame = 0;
  const acc = [0, 0], cnt = [0, 0];
  const samples: number[][] = [[], []];
  gfx.render = (dt: number) => {
    const block = Math.floor(frame / 6) % 2;
    setVariant(ab ? block === 1 : false);
    curBlock = frame > 30 ? block : -1;
    if (tq) pollQueries();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t0 = performance.now();
    orig(dt);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const ms = performance.now() - t0;
    frame++;
    // skip the first frame of each block (state change) and the warm-up
    if (frame > 30 && frame % 6 !== 1 && cnt[0] + cnt[1] < perfN) {
      acc[block] += ms;
      cnt[block]++;
      samples[block].push(ms);
      if (cnt[0] + cnt[1] === perfN) {
        const med = (a: number[]) => (a.sort((x, y) => x - y), a[a.length >> 1] ?? 0);
        const A = acc[0] / Math.max(1, cnt[0]), B = acc[1] / Math.max(1, cnt[1]);
        const mA = med(samples[0]), mB = med(samples[1]);
        window.__info = { ...(window.__info as object), perfA: +A.toFixed(2), perfB: +B.toFixed(2), medA: +mA.toFixed(2), medB: +mB.toFixed(2) };
        if (tq) {
          pollQueries();
          console.log(`[shot] gpu road draws: A ${(gAcc[0] / Math.max(1, gCnt[0])).toFixed(3)} ms (${gCnt[0]}) | B ${(gAcc[1] / Math.max(1, gCnt[1])).toFixed(3)} ms (${gCnt[1]})`);
        }
        console.log(`[shot] perf ${ab ? `A(${ab} on) ` : ''}avg ${A.toFixed(2)} med ${mA.toFixed(2)}${ab ? ` | B(${ab} off) avg ${B.toFixed(2)} med ${mB.toFixed(2)} | delta med ${(mA - mB).toFixed(2)} ms` : ''} at ${gfx.renderer.domElement.width}x${gfx.renderer.domElement.height}`);
        setVariant(false);
      }
    }
  };
}

let augmented = false;
stage.onFrame(() => {
  if (!augmented && window.__ready) {
    augmented = true;
    const info = gfx.renderer.info;
    window.__info = {
      ...(window.__info as object),
      calls: info.render.calls,
      triangles: info.render.triangles,
      buildMs: Math.round(ts.stats.buildMs),
      tsMeshes: ts.stats.meshes,
      tsTriangles: ts.stats.triangles,
    };
  }
});

stage.start();
