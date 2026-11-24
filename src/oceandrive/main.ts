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
import { Dressing, type DressData } from './dressing.ts';
import { SEA } from './water.ts';
import { makePhys, CarBodies, Fx, Sfx } from './combat.ts';
import { loadGuns } from './weapons.ts';
import { Arsenal, type Actor } from './gunplay.ts';
import { Police } from './police.ts';
import { drawMap } from './minimap.ts';
import { county, loadSkyline, trimHorizon } from './downtown.ts';
import { County } from './county.ts';
import { PlanarReflection, reflectable, REFLECT } from './reflection.ts';
import { Boats } from './boats.ts';
import { RoadGraph } from './roadgraph.ts';
import { NightLights } from './nightlights.ts';

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
  const weather0 = (WEATHERS as string[]).includes(Q.get('weather') ?? '') ? (Q.get('weather') as Weather) : 'clouds';
  await sky.init(time0, weather0);
  step('Painting the hotels', 0.15);
  // the street clothes, and the uniforms (police polo, SWAT kit)
  setPeopleCore([...PEOPLE, 'Pilot_Male_03', 'Pilot_Female_02', 'Gardener_Male_01']);
  setPeopleRest(false);
  const peopleP = loadPeople();
  // the county: the tiles of Miami built so far (downtown, Brickell...) and the skyline round them
  const tiles = Q.get('downtown') === '0' ? [] : await county();
  const [world, ground] = await Promise.all([
    loadWorld(env, renderer, (f, label) => step(label, 0.15 + f * 0.55)),
    Ground.load(BASE + 'height.bin', tiles.flatMap((t) => t.layers.map((f) => BASE + f))),
  ]);
  const skyline = tiles.length ? await loadSkyline(env) : null;
  // the bay mirrors the sky, the skyline, the towers and the beach's hotels
  const mirror = skyline ? new PlanarReflection(-1.45) : null;
  if (skyline && mirror) {
    scene.add(skyline.root);
    trimHorizon(world.root);
    reflectable(skyline.root, (m) => !/bay|far|land|seawall|beach/.test(m.name));
    reflectable(world.root, (m) => /lm_(block|city|front2)|gl_/.test(m.name + (m.parent?.name ?? '')));
    env.dome.layers.enable(REFLECT);
    skyline.bay.uniforms.tRefl.value = mirror.rt.texture;
    skyline.bay.uniforms.uReflMat.value = mirror.texMatrix;
  }
  const physRegions: [number, number, number, number, number][] = [[-262, 300, -330, 420, 0.5]];
  for (const t of tiles) {
    const xs = t.core.map((p) => p[0]), ys = t.core.map((p) => p[1]);
    physRegions.push([Math.min(...xs) - 5, Math.max(...xs) + 5, Math.min(...ys) - 5, Math.max(...ys) + 5, 1.0]);
    if (t.name === 'dt') physRegions.push([-790, -262, -150, -20, 1.0]);
  }
  const physP = makePhys(ground, physRegions);
  const gunsP = loadGuns(env);
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
  // on the west sidewalk outside the Colony's porch, looking up the street (or ?at=downtown: on Biscayne Boulevard)
  if (tiles.length && Q.get('at') === 'downtown') player.spawn(-847.2, 664.6, Math.PI);
  else if (tiles.length && Q.get('at') === 'brickell') player.spawn(-905, 1600, Math.PI);
  else player.spawn(-7.3, -6, Math.PI);
  const cars = new Cars(scene, env, ground, world.meta.sw, kit);
  const carsP = cars.load();
  const peds = new Peds(scene, env, kit, ground);
  peds.cars = { strike: (x, z, r) => cars.strike(x, z, r), blocks: (x, z) => cars.blocks(x, z), reseat: (c, p) => cars.reseat(c, p) };
  peds.spawn();
  const gulls = new Gulls(scene);
  const rain = new Rain(scene);
  sky.onSwap((info) => {
    world.sea.uniforms.tSky.value = info.hdr;
    near.mat.uniforms.tSky.value = info.hdr;
    if (skyline) skyline.bay.uniforms.tSky.value = info.hdr;
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
  const nightLights = new NightLights(scene, 8);
  nightLights.addLamps(lampSpots);
  nightLights.addNeon(world.root);
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
  // the street furniture, signals, signs, palms down the side streets, parked cars along them
  const dress = new Dressing(scene, env, ground, (await (await fetch(BASE + 'dressing.json')).json()) as DressData, kit, world.root);
  cars.stopFor = (x, z, yaw) => dress.stopFor(x, z, yaw);
  // each tile of the county brings its traffic, signals, people and lights as it arrives
  const tileCentre = (core: [number, number][]) => new THREE.Vector3(core.reduce((a, p) => a + p[0], 0) / core.length, 38, -core.reduce((a, p) => a + p[1], 0) / core.length);
  let probesReady = false;
  const countyM = new County(env, scene, tiles, skyline, {
    arrived: (t) => {
      dress.addSignals(t.data.signals);
      cars.addRoutes(t.data.routes.map((r) => r.pts.map(([x, y]) => new THREE.Vector2(x, -y))));
      peds.spawnWalks(t.data.walks.map((w) => w.map(([x, y]) => new THREE.Vector2(x, -y))), Math.round((Number(Q.get('dtpeds')) || 46) * (t.info.name === 'dt' ? 1 : 0.8)));
      const spots = ((t.data as unknown as { lamps: [number, number][] }).lamps ?? []).map(([x, y]) => new THREE.Vector4(x, 6.5, -y, 150));
      lampSpots.push(...spots);
      nightLights.addLamps(spots);
      reflectable(t.root, (m) => /lm_\w+(b[12]|br)|gl_/.test(m.name + (m.parent?.name ?? '')));
      if (probesReady) {
        const c = tileCentre(t.info.core);
        t.setProbe(env.probeAt(c.x, c.z));
      }
    },
  });
  // boats in the marinas and out on the bay
  const boats = skyline ? new Boats(env) : null;
  if (boats) {
    await boats.load().catch((e) => console.warn('[boats]', e));
    scene.add(boats.root);
  }
  await countyM.fetchData();
  await countyM.preload(player.pos, (f) => step('Raising downtown', 0.9 + f * 0.05));
  {
    const spots: [number, number, number][] = [];
    const d = dress.data;
    const near = (x: number) => d.xs.some(([a, b]) => x > a - 8 && x < b + 8);
    for (const [y0, y1] of d.ys) {
      if (Math.abs(y0) > 100) continue;
      for (let x = -150; x < -16; x += 6.6) {
        if (near(x)) continue;
        spots.push([x, -(y0 + 1.25), Math.PI / 2], [x, -(y1 - 1.25), -Math.PI / 2]);
      }
    }
    const collins = d.xs.find((x) => x[2] === 'Collins Avenue');
    if (collins) for (let y = -60; y < 60; y += 6.6) spots.push([collins[0] + 1.3, -y, 0]);
    cars.park(spots);
  }
  let shadowPasses = 0;
  // shadow layers: the near cascade draws every caster; the middle one skips the small props (chairs,
  // AC units, shrubs, people), whose shadows are a pixel at that range; the far one only the buildings
  {
    const SMALL = /chair|table|aircon|shrub|bush|lamp|bistro|umbrella|lounger|bike|person/i;
    const MID = /palm|frond|bark/i;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.castShadow) return;
      const tag = `${m.name}|${(m.material as THREE.Material).name}`;
      if (SMALL.test(tag)) return;
      let car = false;
      for (let p: THREE.Object3D | null = m; p; p = p.parent) if (cars.list.some((c) => c.root === p)) car = true;
      if (car || MID.test(tag) || (m as THREE.InstancedMesh).isInstancedMesh) m.layers.enable(2);
      else m.layers.enable(1);
    });
    // three culls shadow casters by the *view* camera's layers, so draw the cascades one at a time
    // with the view camera's mask swapped for each
    const L = env.csm.lights as THREE.Light[];
    const sm = renderer.shadowMap as THREE.WebGLShadowMap & { render: (l: THREE.Light[], s: THREE.Scene, c: THREE.Camera) => void };
    const orig = sm.render.bind(sm);
    const MASK = [0xffffffff, (1 << 1) | (1 << 2), 1 << 1];
    let frameNo = 0;
    sm.render = (lights, sc, cam) => {
      const saved = cam.layers.mask;
      frameNo++;
      if (lights.length) shadowPasses++;
      for (const l of lights) {
        const i = L.indexOf(l);
        cam.layers.mask = i >= 0 ? MASK[i] : saved;
        orig([l], sc, cam);
      }
      cam.layers.mask = saved;
    };
    void frameNo;
  }
  player.obstacle = (x, z) => cars.blocks(x, z);
  // ---------------------------------------------------------------- the fight
  const [phys] = await Promise.all([physP, gunsP]);
  const fx = new Fx(scene);
  const carBodies = new CarBodies(phys);
  let sfxOut: () => { ctx: AudioContext; master: GainNode } | null = () => null;
  const sfx = new Sfx(() => sfxOut());
  const police = new Police(scene, env, kit, ground, cars, phys, fx, sfx, dress.data);
  police.witnesses = () => peds.positions();
  if (countyM.datas.length) police.graph = new RoadGraph(dress.data, countyM.datas.map((d) => d.graph));
  peds.phys = phys;
  peds.fx = fx;
  peds.sfx = sfx;
  peds.crime = (k, x, z) => police.crime(k, x, z);
  const actors = (): Actor[] => [...(peds.list as Actor[]).filter((d) => d.alive), ...police.actors()];
  const arsenal = new Arsenal(scene, player, {
    ground, fx, sfx, cars,
    actors,
    noise: (x, z, r) => peds.panic(x, z, r),
    crime: (k, x, z) => police.crime(k, x, z),
    punchTarget: (from, yaw) => {
      const cop = police.punchTarget(from, yaw);
      if (cop) return { hit: (d) => cop.hurt(22, d, 1, true) };
      const ped = peds.punchAt(from, yaw);
      return ped ? { hit: (d) => peds.shove(ped, d, 25) } : null;
    },
    carShot: (c) => {
      // a round through their window: the driver bails out and runs
      if (c.driver && !c.police && Math.random() < 0.6) {
        const out = cars.ejectDriver(c);
        if (out) peds.fromCar(out.p, c, out.x, out.z, out.yaw, 'flee');
      }
      if (c.police) police.crime('copCar', c.x, c.z);
    },
  });
  // your car hit theirs: out they get (most of them) to have words
  cars.onBump = (c, speed) => {
    if (c.police) {
      police.crime('copCar', c.x, c.z);
      return;
    }
    if (speed < 2 || Math.random() < 0.25) return;
    const out = cars.ejectDriver(c);
    if (out) peds.fromCar(out.p, c, out.x, out.z, out.yaw, arsenal.armed && Math.random() < 0.5 ? 'flee' : 'angry');
  };
  cars.onHitCar = (c) => police.crime('hitcar', c.x, c.z);
  cars.onJack = (c, p, x, z, yaw) => {
    peds.fromCar(p, c, x, z, yaw, 'jacked');
    police.crime('carjack', x, z);
  };
  cars.onExplode = (c) => {
    const p = new THREE.Vector3(c.x, c.y + 0.8, c.z);
    fx.explosion(p);
    sfx.explosion(p);
    fx.shake = Math.min(1, fx.shake + 12 / Math.max(6, p.distanceTo(camera.position)));
    peds.panic(c.x, c.z, 70, 'boom');
    if (c.blame) police.crime('explode', c.x, c.z);
    for (const a of actors()) {
      const d = Math.hypot(a.x - c.x, a.z - c.z);
      if (d > 9) continue;
      const dir = new THREE.Vector3(a.x - c.x, 0.6, a.z - c.z).normalize();
      a.hurt(d < 4 ? 400 : 90 * (1 - d / 9), dir, 1, c.blame);
    }
    if (c === cars.yours) player.hurt(500, new THREE.Vector3(0, 1, 0));
    else {
      const d = Math.hypot(player.pos.x - c.x, player.pos.z - c.z);
      if (d < 9 && !driving) {
        const dir = new THREE.Vector3(player.pos.x - c.x, 0, player.pos.z - c.z).normalize();
        player.hurt(d < 4 ? 400 : 160 * (1 - d / 9), dir);
        if (!player.dead) player.knock(dir.x * 8, dir.z * 8);
      }
    }
    for (const o of cars.list) {
      if (o === c) continue;
      const d = Math.hypot(o.x - c.x, o.z - c.z);
      if (d > 10) continue;
      o.vx += ((o.x - c.x) / (d || 1)) * (10 - d) * 0.8;
      o.vz += ((o.z - c.z) / (d || 1)) * (10 - d) * 0.8;
      cars.damage(o, (10 - d) * 9, c.blame);
    }
  };
  // you: hurt, killed
  player.onHurt = (dmg) => {
    hud.hurt(Math.min(0.9, dmg / 40));
    fx.shake = Math.min(1, fx.shake + dmg / 80);
  };
  let downT = -1;
  let downKind: 'dead' | 'busted' = 'dead';
  player.onDie = (dir) => {
    downT = 0;
    downKind = 'dead';
    if (driving) {
      // out of the wreck
      const c = cars.yours;
      if (c) {
        const out = cars.takeExitNow();
        if (out) player.spawn(out.x, out.z, out.yaw);
      }
      driving = false;
      player.hidden = false;
    }
    player.person.root.visible = true;
    playerRag = phys.ragdoll(player.person, dir.clone().multiplyScalar(2), 1, dir, 40);
  };
  let playerRag: ReturnType<typeof phys.ragdoll> | null = null;
  police.onBust = () => {
    if (downT >= 0) return;
    downT = 0;
    downKind = 'busted';
  };
  const post = new Post(renderer, scene, camera);
  post.exposure.value = Number(Q.get('ev')) || 0.74;
  const hud = new Hud(document.body);
  const audio = new Ambience();
  sfxOut = () => audio.out();
  cars.onCrash = (sp) => audio.crash(sp);
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
    mirror?.setSize(s.x, s.y);
    env.resize();
  };
  addEventListener('resize', resize);
  resize();

  // compile everything once behind the loader
  step('Opening the cafes', 0.95);
  env.update();
  // reflection probes down the street and on the sand (without the people and cars in them)
  step('Polishing the paint', 0.97);
  const PROBES = [new THREE.Vector3(0, 1.6, 50), new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(0, 1.6, -50), new THREE.Vector3(-60, 1.6, 0), new THREE.Vector3(150, 1.8, 0)];
  for (const t of tiles) PROBES.push(tileCentre(t.core));
  env.bakeProbes(PROBES, [player.person.root, ...cars.list.map((c) => c.root), ...peds.list.map((p) => p.p.root), near.mesh, gulls.root]);
  cars.applyProbes();
  world.windows(env.probeAt(0, 0));
  const tileProbes = () => {
    for (const t of countyM.loaded) {
      const c = tileCentre(t.info.core);
      t.setProbe(env.probeAt(c.x, c.z));
    }
    skyline?.setProbe(env.probeAt(-835, 640));
  };
  tileProbes();
  probesReady = true;
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
    env.bakeProbes(PROBES, [player.person.root, ...cars.list.map((c) => c.root), ...peds.list.map((p) => p.p.root), near.mesh, gulls.root, rain.mesh]);
    cars.applyProbes();
    world.windows(env.probeAt(0, 0));
    tileProbes();
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
  let frameN = 0;
  const camDir = new THREE.Vector3();
  const frame = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    seaTick(t);
    near.update(camera.position);
    gulls.update(t);
    const canAct = downT < 0 && !player.dead;
    const nearCar = canAct && !driving ? cars.nearest(player.pos, 3.2) : null;
    // (a police car with its crew aboard isn't yours to take)
    const takeable = nearCar && !nearCar.wreck && !(nearCar.police && nearCar.driver) ? nearCar : null;
    if (input.hit('KeyF') && canAct) {
      if (driving) cars.requestExit();
      else if (takeable) {
        const cop = takeable.police;
        if (cars.enter(takeable, camera)) {
          driving = true;
          player.hidden = true;
          if (cop) police.crime('copCar', takeable.x, takeable.z);
        }
      }
    }
    if (driving) {
      // out once the car has stopped, by the driver's door (or wherever's clear)
      const out = cars.takeExit((x, z, y) => player.clearAt(x, z, y));
      if (out) {
        player.spawn(out.x, out.z, out.yaw, camera);
        driving = false;
        player.hidden = false;
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
    if (downT >= 0 && !player.dead) {
      // the cuffs: you stand still
      player.aimK = 0;
    }
    arsenal.update(dt, input, camera, driving || downT >= 0);
    // a car that hits you knocks you down (and hurts: fast enough, it kills)
    if (!driving && !player.dead) {
      const hit = cars.strike(player.pos.x, player.pos.z);
      if (hit) {
        const sp = Math.hypot(hit.vx, hit.vz);
        player.hurt(sp > 3 ? sp * sp * 0.9 : 0, new THREE.Vector3(hit.vx, 0, hit.vz).normalize());
        if (!player.dead) player.knock(hit.vx, hit.vz);
        else if (playerRag) playerRag.blast(player.pos.clone().sub(new THREE.Vector3(hit.vx, 0, hit.vz).normalize()), sp * 4, 3);
      } else {
        // a car creeping into you nudges you aside rather than driving through you
        const push = cars.pushOut(player.pos.x, player.pos.z, 0.32);
        if (push && player.clearAt(player.pos.x + push.x, player.pos.z + push.z, player.pos.y)) {
          player.pos.x += push.x;
          player.pos.z += push.z;
        }
      }
    }
    cars.setWalkers(peds.positions());
    cars.update(dt, driving ? null : player.pos, camera.position);
    countyM.update(dt, camera.position);
    boats?.update(dt);
    const yourCar = driving ? cars.yours : null;
    peds.you = {
      pos: driving ? cars.playerPos() : player.pos, driving, car: yourCar, armed: arsenal.armed && !driving,
      aimFrom: arsenal.aiming ? arsenal.aimFrom : null, aimDir: arsenal.aiming ? arsenal.aimDir : null,
      hurt: (d, dir) => player.hurt(d, dir),
    };
    peds.update(dt, driving ? cars.playerPos() : player.pos, camera.position);
    const youSpeed = driving && yourCar ? Math.hypot(yourCar.vx, yourCar.vz) : (player as unknown as { speed: number }).speed;
    police.update(dt, {
      pos: driving ? cars.playerPos() : player.pos, driving, car: yourCar, armed: arsenal.armed,
      hostile: arsenal.firedT < 10 || police.stars >= 2, speed: youSpeed, dead: player.dead || downT >= 0,
      hurt: (d, dir) => player.hurt(d, dir),
    }, camera.position);
    // your car going up with you in it
    if (driving && yourCar && yourCar.wreck && !player.dead) player.hurt(500, new THREE.Vector3(0, 1, 0));
    carBodies.update(cars.list, camera.position);
    phys.step(dt);
    for (const h of cars.hurtCars()) fx.smoke(h.p, h.fire, dt);
    fx.update(dt, camera);
    sfx.listen(camera);
    if (fx.shake > 0) camera.position.add(new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(fx.shake * 0.12));
    // wasted / busted: the banner, then a fresh start
    if (downT >= 0) {
      downT += dt;
      if (downT > 1.2) hud.banner(downKind === 'dead' ? 'Hospitalized' : 'Arrested', downKind === 'dead' ? 'Mount Sinai Medical Center' : 'Miami Beach Police Department');
      if (downT > 5.5) {
        downT = -1;
        hud.banner(null);
        if (playerRag) {
          playerRag.dispose();
          playerRag = null;
        }
        player.revive();
        police.reset(true);
        if (driving) {
          cars.takeExitNow();
          driving = false;
          player.hidden = false;
        }
        // the hospital's at the south end of the beach walk; the station is on Washington Avenue
        if (downKind === 'dead') player.spawn(-7.3, 88, Math.PI, camera);
        else player.spawn(-99.6, 10, Math.PI, camera);
        post.reset();
      }
    }
    hud.update(dt, driving, !!takeable, cars.speedKmh(), !!takeable && !!takeable.driver);
    hud.fight({
      stars: police.stars, searching: police.searching, t, hp: player.hp, maxHp: player.maxHp, armor: player.armor,
      weapon: arsenal.weapon, mag: arsenal.weapon === 'fists' ? 0 : arsenal.ammo[arsenal.weapon].mag, reserve: arsenal.weapon === 'fists' ? 0 : arsenal.ammo[arsenal.weapon].reserve,
      reloading: arsenal.reloading, aim: player.aimK, armed: arsenal.armed && !driving,
    });
    if ((frameN++ & 1) === 0)
      drawMap(hud.map, dress.data, { x: driving ? cars.playerPos().x : player.pos.x, z: driving ? cars.playerPos().z : player.pos.z, yaw: driving && yourCar ? yourCar.yaw : player.yaw, camYaw: Math.atan2(camDir.set(0, 0, -1).applyQuaternion(camera.quaternion).x, camDir.z) },
        police.blips(), police.searching ? { x: police.lastKnown.x, z: police.lastKnown.z, r: 45 } : null, t);
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
    dress.update(dt, o.night, o.lamps);
    nightLights.update(dt, camera.position, Math.min(1, o.lamps));
    for (const tl of countyM.loaded) tl.setNight(o.lamps);
    skyline?.setNight(o.lamps);
    police.night = o.lamps;
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
      for (const l of fx.lights) lampList.push(new THREE.Vector4(l.p.x, l.p.y, l.p.z, l.i));
      sky.setLamps(camera.position, lampList);
    }
    env.update();
    if (mirror && skyline) {
      // only near the bay (or high up): the west of the beach block and beyond
      const want = camera.position.x < -150 || camera.position.y > 40;
      mirror.update(renderer, scene, camera, want);
      skyline.bay.uniforms.uReflOn.value = mirror.active ? 1 : 0;
    }
    post.render(t);
    adapt(dt);
    input.endFrame();
    requestAnimationFrame(frame);
  };
  $('#loading').classList.add('done');
  requestAnimationFrame(frame);
  (window as unknown as { od: unknown }).od = { THREE, U, sky, dress, arsenal, police, fx, phys, input, get driving() { return driving; }, get shadowPasses() { return shadowPasses; }, renderer, scene, camera, player, cars, peds, env, post, world, ground, county: countyM, skyline };
}

boot().catch((e) => {
  console.error(e);
  const el = $('#loading .lerr');
  if (el) el.textContent = String(e?.stack ?? e);
});
