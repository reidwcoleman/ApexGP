// Ocean Drive: one block of Miami Beach (Ocean Drive, 7th to 8th Street, Lummus Park and the beach),
// built from OpenStreetMap in Blender, lit by a Cycles bake, walked and driven in the browser.
import * as THREE from 'three';
import { Env } from './env.ts';
import { loadWorld, makeNets } from './world.ts';
import { Ground } from './height.ts';
import { Input } from './input.ts';
import { Player } from './player.ts';
import { Post } from './post.ts';
import { U } from './materials.ts';
import { seaTick, makeSea, NearSea } from './water.ts';
import { loadPeople, setPeopleCore, setPeopleRest, type Look } from '../people/Humans.ts';
import { Cars } from './cars.ts';
import { Peds, PEOPLE, fill } from './peds.ts';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800-italic.css';
import { Hud } from './hud.ts';
import { Ambience } from './audio.ts';
import { Gulls } from './gulls.ts';
import { Sky, TIMES, WEATHERS, type TimeOfDay, type Weather } from './sky.ts';
import { Rain } from './rain.ts';
import { SEA } from './water.ts';

const BASE = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/') + 'oceandrive/';
const Q = new URLSearchParams(location.search);
const $ = (s: string) => document.querySelector(s) as HTMLElement;
const step = (t: string, p: number) => {
  const l = $('#loading .lstep');
  if (l) l.textContent = t;
  const b = $('#loading .lbar b');
  if (b) b.style.width = Math.round(p * 100) + '%';
};


async function boot() {
  const canvas = $('#gl') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, Number(Q.get('dpr')) || 1.5));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.12, 6000);
  camera.position.set(-8, 1.7, 20);
  scene.add(camera);

  step('Reading the sky', 0.05);
  const env = new Env(renderer, scene, camera);
  const sky = new Sky(env, renderer);
  const time0 = (TIMES as string[]).includes(Q.get('time') ?? '') ? (Q.get('time') as TimeOfDay) : 'day';
  const weather0 = (WEATHERS as string[]).includes(Q.get('weather') ?? '') ? (Q.get('weather') as Weather) : 'clear';
  await sky.init(time0, weather0);
  step('Painting the hotels', 0.15);
  setPeopleCore(PEOPLE);
  setPeopleRest(false);
  const peopleP = loadPeople();
  const [world, ground] = await Promise.all([loadWorld(env, renderer, (f, label) => step(label, 0.15 + f * 0.7)), Ground.load(BASE + 'height.bin')]);
  scene.add(world.root);
  const nets = makeNets(world.meta);
  scene.add(nets);
  const near = new NearSea(makeSea(world.meta.water_x, world.meta.sea, env.hdr!, world.sea.uniforms.uSunCol.value, true), world.sea, world.meta.water_x);
  scene.add(near.mesh);
  U.uSea.value = world.meta.sea;
  step('Waking up South Beach', 0.88);
  const kit = await peopleP;
  const input = new Input(canvas);
  const look: Look = {
    female: false, tone: 0.35, body: 'Male_Adult_08', hair: 'none', hairColor: 0x2a1d14,
    top: 'tshirt', topColor: 0xffffff, tint: 0, bottom: 'jeans', bottomColor: 0x2d3f63, height: 1.0,
  };
  const player = new Player(kit, ground, look, world.meta.sea);
  scene.add(player.person.root);
  env.prepObject(player.person.root, true, true);
  fill(player.person.root);
  // on the west sidewalk outside the Colony's porch, looking up the street
  player.spawn(-7.3, -6, Math.PI);
  const cars = new Cars(scene, env, ground, world.meta.sw, kit);
  const carsP = cars.load();
  const peds = new Peds(scene, env, kit, ground);
  peds.spawn();
  const gulls = new Gulls(scene);
  const rain = new Rain(scene);
  sky.onSwap((info) => {
    world.sea.uniforms.tSky.value = info.hdr;
    near.mat.uniforms.tSky.value = info.hdr;
  });
  // what lights the street at night: the lamps along the park, the shop windows, headlights
  const lampSpots: THREE.Vector4[] = [];
  for (let y = -320; y < 410; y += 26) lampSpots.push(new THREE.Vector4(7.15, 4.4, -(y + 4), 150));
  for (let z = -95; z <= 95; z += 6) lampSpots.push(new THREE.Vector4(-12.6, 2.4, z, 28));
  // the side streets: light spilling from the shopfronts on 7th, 8th and Collins
  for (let x = -98; x <= -16; x += 9)
    for (const z of [-75, -61.6, 62.4, 75.6]) lampSpots.push(new THREE.Vector4(x + (z > 0 ? 4 : 0), 2.4, z, 22));
  for (let z = -92; z <= 92; z += 9) for (const x of [-98.6, -116.2]) lampSpots.push(new THREE.Vector4(x, 2.4, z, 22));
  const lampList: THREE.Vector4[] = [];
  // the beach rental's umbrella poles (too thin to survive the export's decimation)
  {
    const spots: [number, number][] = [];
    for (let y = -86; y < 90; y += 7) if (Math.abs(y) >= 4) for (const x of [196, 205]) spots.push([x, -y]);
    const geo = new THREE.CylinderGeometry(0.03, 0.03, 1, 8);
    geo.translate(0, 0.5, 0);
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xe9e6df, metalness: 0.6, roughness: 0.35 }), spots.length);
    const m = new THREE.Matrix4();
    spots.forEach(([x, z], i) => {
      const g = ground.height(x, z);
      const y0 = Number.isNaN(g) ? 0 : g - 0.1;
      m.makeScale(1, 1.66 + 0.4 - y0, 1).setPosition(x, y0, z);
      im.setMatrixAt(i, m);
    });
    im.castShadow = true;
    env.prepObject(im, true, true);
    scene.add(im);
  }
  env.prepObject(gulls.root, true, false);
  env.prepObject(nets, true, true);
  await carsP;
  player.obstacle = (x, z) => cars.blocks(x, z);
  const post = new Post(renderer, scene, camera);
  post.exposure.value = Number(Q.get('ev')) || 0.74;
  const hud = new Hud(document.body);
  const audio = new Ambience();
  if (Q.get('hud') === '0') hud.toggle();
  // a fixed camera for stills: ?cam=x,y,z&look=x,y,z (three coords)
  const camQ = Q.get('cam')?.split(',').map(Number);
  const lookQ = Q.get('look')?.split(',').map(Number);

  const resize = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    const s = new THREE.Vector2();
    renderer.getDrawingBufferSize(s);
    post.setSize(innerWidth, innerHeight);
    env.resize();
  };
  addEventListener('resize', resize);
  resize();

  // compile everything once behind the loader
  step('Opening the cafes', 0.95);
  env.update();
  // reflection probes down the street and on the sand (without the people and cars in them)
  step('Polishing the paint', 0.97);
  env.bakeProbes(
    [new THREE.Vector3(0, 1.6, 50), new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(0, 1.6, -50), new THREE.Vector3(-60, 1.6, 0), new THREE.Vector3(150, 1.8, 0)],
    [player.person.root, ...cars.list.map((c) => c.root), ...peds.list.map((p) => p.p.root), near.mesh, gulls.root],
  );
  cars.applyProbes();
  world.windows(env.probeAt(0, 0));
  renderer.compile(scene, camera);
  await new Promise((r) => setTimeout(r, 30));

  // time of day (T) and weather (Y): ?time=day|sunset|dusk|night&weather=clear|clouds|rain
  const setLook = (tm: TimeOfDay, w: Weather) => {
    void sky.set(tm, w);
    hud.flash(tm, w);
    // the reflections are re-taken once the light has settled
    clearTimeout(probeTimer);
    probeTimer = setTimeout(reprobe, 3300);
  };
  let probeTimer = 0 as unknown as ReturnType<typeof setTimeout>;
  const reprobe = () => {
    env.bakeProbes(
      [new THREE.Vector3(0, 1.6, 50), new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(0, 1.6, -50), new THREE.Vector3(-60, 1.6, 0), new THREE.Vector3(150, 1.8, 0)],
      [player.person.root, ...cars.list.map((c) => c.root), ...peds.list.map((p) => p.p.root), near.mesh, gulls.root, rain.mesh],
    );
    cars.applyProbes();
    world.windows(env.probeAt(0, 0));
    post.reset();
  };
  if (time0 !== 'day' || weather0 !== 'clear') {
    sky.update(0);
    reprobe();
  }
  sky.onThunder = (delay, loud) => setTimeout(() => audio.thunder(loud), delay * 1000);
  const ev0 = Number(Q.get('ev')) || 0.74;
  // adaptive resolution: keep ~60 fps by trading render scale (re-checked every 2 s)
  const maxDpr = Math.min(devicePixelRatio, Number(Q.get('dpr')) || 1.5);
  let dpr = renderer.getPixelRatio();
  let acc = 0, frames = 0;
  const adapt = (dt: number) => {
    if (Q.get('dpr')) return;
    acc += dt;
    frames++;
    if (acc < 2) return;
    const ft = acc / frames;
    acc = frames = 0;
    let next = dpr;
    if (ft > 0.024) next = Math.max(0.7, dpr - 0.15);
    else if (ft < 0.0145) next = Math.min(maxDpr, dpr + 0.1);
    if (Math.abs(next - dpr) > 0.01) {
      dpr = next;
      renderer.setPixelRatio(dpr);
      resize();
      post.reset();
    }
  };
  let last = performance.now();
  let t = 0;
  let driving = false;
  const frame = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    seaTick(t);
    near.update(camera.position);
    gulls.update(t);
    if (input.hit('KeyF')) {
      if (driving) {
        const out = cars.exit();
        if (out) {
          player.spawn(out.x, out.z, out.yaw);
          driving = false;
          player.hidden = false;
        }
      } else {
        const car = cars.nearest(player.pos, 3.2);
        if (car) {
          cars.enter(car);
          driving = true;
          player.hidden = true;
        }
      }
    }
    if (input.hit('KeyH')) hud.toggle();
    if (input.hit('KeyT')) setLook(TIMES[(TIMES.indexOf(sky.time) + 1) % TIMES.length], sky.weather);
    if (input.hit('KeyY')) setLook(sky.time, WEATHERS[(WEATHERS.indexOf(sky.weather) + 1) % WEATHERS.length]);
    if (camQ && lookQ) {
      player.update(dt, input, camera);
      camera.position.set(camQ[0], camQ[1], camQ[2]);
      camera.lookAt(lookQ[0], lookQ[1], lookQ[2]);
    } else if (driving) {
      cars.drive(dt, input, camera);
      player.person.root.visible = false;
    } else {
      player.update(dt, input, camera);
    }
    cars.setWalkers(peds.positions());
    cars.update(dt, driving ? null : player.pos, camera.position);
    peds.update(dt, driving ? cars.playerPos() : player.pos, camera.position);
    hud.update(driving, cars.near(player.pos, 3.2) && !driving, cars.speedKmh());
    audio.update(t, driving ? cars.playerPos().x : player.pos.x, U.uSwash.value, driving ? cars.speedKmh() : -1, sky.out.rain);
    // weather and light
    sky.update(dt);
    const o = sky.out;
    post.exposure.value = ev0 * o.exposure;
    post.air.u('uDensity').value = o.fogDensity;
    post.air.u('uHeightK').value = o.rain > 0.5 ? 0.006 : 0.02;
    (post.air.u('uFogCol').value as THREE.Vector3).copy(o.fogColor);
    (post.air.u('uSunDir').value as THREE.Vector3).copy(env.toSun);
    (post.air.u('uSunScat').value as THREE.Vector3).copy(o.sunScatter);
    rain.update(camera.position, o.rain, o.fogColor);
    for (const m of world.neon) m.color.setScalar(3.2 + 5.8 * o.night);
    for (const m of world.lamps) {
      m.emissive.setRGB(1, 0.72, 0.42);
      m.emissiveIntensity = o.lamps > 0.05 ? (m.name.includes('bulb') ? 40 : 6) * Math.min(1, o.lamps) : 0;
    }
    cars.setNight(o.lightsOn ? 1 : 0);
    if (o.lamps > 0) {
      lampList.length = 0;
      for (const l of lampSpots) lampList.push(l);
      cars.headlights(lampList);
      sky.setLamps(camera.position, lampList);
    }
    env.update();
    post.render(t);
    adapt(dt);
    input.endFrame();
    requestAnimationFrame(frame);
  };
  $('#loading').classList.add('done');
  requestAnimationFrame(frame);
  (window as unknown as { od: unknown }).od = { THREE, U, sky, renderer, scene, camera, player, cars, peds, env, post, world, ground };
}

boot().catch((e) => {
  console.error(e);
  const el = $('#loading .lerr');
  if (el) el.textContent = String(e?.stack ?? e);
});
