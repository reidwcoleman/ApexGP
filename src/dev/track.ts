import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createDevStage } from './devkit.ts';
import { Track } from '../world/Track.ts';
import { COSTA_DEL_SOL } from '../world/Circuits.ts';
import { buildTrackside } from '../world/TrackMesh.ts';

/**
 * Trackside dev page.
 *   ?s=560&lat=0&h=1.4   camera at track.point(s, lat, h) looking at track.point(s+30, lat/2, 0.5)
 *   ?ahead=30            look-ahead distance for the above
 *   ?top=1               aerial view of the whole circuit
 *   ?aerial=S&ah=120     oblique aerial over track position S
 *   ?ls=S&ll=L&lh=H      override the look target with track.point(S, L, H)
 *   ?lights=0..5         start lights
 *   ?sun=az,el           sun azimuth/elevation in degrees
 */

const stage = createDevStage({ fov: 55, near: 0.1, far: 9000 });
const { scene, camera, gfx, params, controls } = stage;

const track = new Track(COSTA_DEL_SOL);
const ts = buildTrackside(track, gfx);
scene.add(ts.group);
ts.startLights.set(Number(params.get('lights') ?? 0));
console.log(`[shot] trackside built in ${ts.stats.buildMs.toFixed(0)} ms: ${ts.stats.meshes} meshes, ${ts.stats.triangles} tris, ${ts.stats.chunks} chunks ${JSON.stringify(ts.stats.byKey)} ${JSON.stringify(ts.stats.phases)}`);

// ---------------------------------------------------------------- sky, env, sun
{
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 512;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, '#2f63b0');
  grd.addColorStop(0.35, '#6f9bd3');
  grd.addColorStop(0.49, '#cfe0f0');
  grd.addColorStop(0.5, '#dfe7ee');
  grd.addColorStop(0.53, '#9aa7b0');
  grd.addColorStop(1, '#5b6570');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  scene.background = tex;
  scene.backgroundIntensity = 1.0;
}
const pmrem = new THREE.PMREMGenerator(gfx.renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;
scene.fog = new THREE.Fog(0xc9d8e6, 500, 4200);

const hemi = new THREE.HemisphereLight(0xbcd4f0, 0x55603f, 0.9);
scene.add(hemi);

const [az, el] = (params.get('sun') ?? '220,36').split(',').map((v) => (Number(v) * Math.PI) / 180);
const sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
const sun = new THREE.DirectionalLight(0xfff0dc, 3.6);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

// ---------------------------------------------------------------- crude terrain so the page stands alone
{
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
    const gx = Math.round((x - field.originX) / field.cell);
    const gz = Math.round((z - field.originZ) / field.cell);
    const idx = gz * W + gx;
    const d = Track.sampleField(field, field.dist, x, z);
    let y = minY - 3;
    if (isFinite(d)) {
      const hTrack = Track.sampleField(field, field.height, x, z);
      const far = Math.min(1, Math.max(0, (d - 40) / 160));
      y = hTrack - 1.2 - far * 3 + far * 8 * Math.sin(x * 0.004) * Math.cos(z * 0.005);
    }
    void idx;
    pos.setXYZ(v, x, y, z);
  }
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x3a4a2a, roughness: 0.97 }));
  ground.receiveShadow = true;
  scene.add(ground);
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
  camera.position.set(look.x + 1, 1900, look.z + 260);
  camera.near = 20;
  camera.updateProjectionMatrix();
  scene.fog = null;
  camera.fov = 45;
  camera.updateProjectionMatrix();
} else if (params.get('aerial')) {
  const s = Number(params.get('aerial'));
  const ah = Number(params.get('ah') ?? 120);
  const f = track.frame(s);
  track.point(s, 0, 0, look);
  camera.position.copy(look).addScaledVector(f.tangent, -ah * 0.9).addScaledVector(f.right, ah * 0.35);
  camera.position.y += ah;
} else if (params.get('s')) {
  const s = Number(params.get('s'));
  const lat = Number(params.get('lat') ?? 0);
  const h = Number(params.get('h') ?? 1.2);
  const ahead = Number(params.get('ahead') ?? 30);
  track.point(s, lat, h, camera.position);
  track.point(s + ahead, lat * 0.5, 0.5, look);
} else {
  track.point(track.startS - 40, -2, 1.4, camera.position);
  track.point(track.startS - 10, -1, 0.5, look);
}
if (params.get('ls')) track.point(Number(params.get('ls')), Number(params.get('ll') ?? 0), Number(params.get('lh') ?? 1), look);
if (params.get('cam')) camera.position.fromArray(params.get('cam')!.split(',').map(Number));
if (params.get('look')) look.fromArray(params.get('look')!.split(',').map(Number));
camera.lookAt(look);
controls.target.copy(look);
controls.update();

// ---------------------------------------------------------------- per-frame
const wide = !!params.get('top');
stage.onFrame((dt) => {
  // keep the shadow frustum around what we look at
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
  ts.update(dt, camera);
});

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
