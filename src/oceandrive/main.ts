// Ocean Drive: one block of Miami Beach (Ocean Drive, 7th to 8th Street, Lummus Park and the beach),
// built from OpenStreetMap in Blender, lit by a Cycles bake, walked and driven in the browser.
import * as THREE from 'three';
import { Env } from './env.ts';
import { loadWorld } from './world.ts';
import { Ground } from './height.ts';
import { Input } from './input.ts';
import { Player } from './player.ts';
import { Post } from './post.ts';
import { U } from './materials.ts';
import { seaTick } from './water.ts';
import { loadPeople, setPeopleCore, setPeopleRest, type Look } from '../people/Humans.ts';
import { Cars } from './cars.ts';
import { Peds, PEOPLE } from './peds.ts';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800-italic.css';
import { Hud } from './hud.ts';
import { Ambience } from './audio.ts';
import { Gulls } from './gulls.ts';

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
  await env.loadSky('sky/qwantani_late_afternoon_puresky.hdr');
  step('Painting the hotels', 0.15);
  setPeopleCore(PEOPLE);
  setPeopleRest(false);
  const peopleP = loadPeople();
  const [world, ground] = await Promise.all([loadWorld(env, renderer, (f, label) => step(label, 0.15 + f * 0.7)), Ground.load(BASE + 'height.bin')]);
  scene.add(world.root);
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
  // on the west sidewalk outside the Colony's porch, looking up the street
  player.spawn(-7.3, -6, Math.PI);
  const cars = new Cars(scene, env, ground, world.meta.sw);
  const carsP = cars.load();
  const peds = new Peds(scene, env, kit, ground);
  peds.spawn();
  const gulls = new Gulls(scene);
  env.prepObject(gulls.root, true, false);
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
  renderer.compile(scene, camera);
  await new Promise((r) => setTimeout(r, 30));

  let dusk = false;
  const setDusk = (on: boolean) => {
    dusk = on;
    void env.setDusk(on).then(() => {
      for (const m of world.neon) m.color.setScalar(on ? 9 : 3.2);
      for (const m of world.lamps) {
        m.emissive.setRGB(1, 0.72, 0.42);
        m.emissiveIntensity = on ? (m.name.includes('bulb') ? 40 : 6) : 0;
      }
      post.exposure.value = (Number(Q.get('ev')) || 0.74) * (on ? 2.6 : 1);
      world.sea.uniforms.tSky.value = env.hdr;
      post.reset();
    });
  };
  if (Q.get('time') === 'dusk') setDusk(true);
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
    if (input.hit('KeyT')) setDusk(!dusk);
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
    cars.update(dt, driving ? null : player.pos);
    peds.update(dt, driving ? cars.playerPos() : player.pos);
    hud.update(driving, cars.near(player.pos, 3.2) && !driving, cars.speedKmh());
    audio.update(t, driving ? cars.playerPos().x : player.pos.x, U.uSwash.value, driving ? cars.speedKmh() : -1);
    env.update();
    post.render(t);
    adapt(dt);
    input.endFrame();
    requestAnimationFrame(frame);
  };
  $('#loading').classList.add('done');
  requestAnimationFrame(frame);
  (window as unknown as { od: unknown }).od = { renderer, scene, camera, player, cars, peds, env, post, world, ground };
}

boot().catch((e) => {
  console.error(e);
  const el = $('#loading .lerr');
  if (el) el.textContent = String(e?.stack ?? e);
});
