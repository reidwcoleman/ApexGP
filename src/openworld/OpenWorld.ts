import * as THREE from 'three';
import { Renderer, type QualityLevel } from '../core/Renderer.ts';
import { Track } from '../world/Track.ts';
import { createEnvironment, type Environment } from '../world/Environment.ts';
import { Weather, planWeather, type TimeOfDay, type WeatherKind } from '../world/Weather.ts';
import { applyWeatherUniforms } from '../world/weatherUniforms.ts';
import { loadAsphaltScan } from '../world/trackside/textures.ts';
import { TIME_PRESETS } from '../world/env/presets.ts';
import { MIAMI_ENV_TRACK } from './envTrack.ts';
import { Network } from './roads.ts';
import { buildRoads } from './city/roadMesh.ts';
import { buildGround, type GroundBuild } from './city/ground.ts';
import { bakeCityLights, setCityNight, uploadCityLights } from './city/cityLights.ts';
import { ll } from './geo.ts';
import { buildBuildings, type BuildingsBuild } from './city/buildings.ts';
import { buildProps, type PropsBuild } from './city/props.ts';
import { facadeUniforms } from './city/facade.ts';
import { CollisionWorld, type Contact } from './sim/collide.ts';
import { Input } from './input.ts';
import { CameraRig, CAM_MODES } from './camera.ts';
import { RoadsterCar } from './vehicles/RoadsterCar.ts';
import type { Trim } from './vehicles/roadster.ts';
import type { Drivable, WorldCtx } from './vehicles/drivable.ts';
import { Fleet, PAINTS, type ModelId } from './vehicles/fleet.ts';
import { Traffic } from './ai/traffic.ts';
import { People } from './ai/people.ts';
import { Police, type Suspect } from './ai/police.ts';
import { FleetCar } from './vehicles/FleetCar.ts';
import { Helicopter } from './vehicles/Helicopter.ts';
import { Seaplane } from './vehicles/Seaplane.ts';
import { Motorbike } from './vehicles/Motorbike.ts';
import { Boat } from './vehicles/Boat.ts';
import { Hud, ROADSTER_PAINTS, type MenuState } from './ui/Hud.ts';
import { OpenWorldAudio, type AudioFrame } from './audio.ts';
import { setDynLights, type DynLight } from './city/cityLights.ts';
import { placeAt, WORLD } from './geo.ts';
import type { CarBody } from './sim/car.ts';
import type { CamSubject } from './camera.ts';

/**
 * The open world: Miami, from Brickell to South Beach, at real scale. Owns the renderer, the
 * race game's sky / weather / grade (the same Environment, so it looks like ApexGP), the city,
 * the traffic, the people, the police and the player.
 */
export class OpenWorld {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.15, 30000);
  readonly gfx: Renderer;
  env!: Environment;
  weather!: Weather;
  net!: Network;
  ground!: GroundBuild;
  buildings!: BuildingsBuild;
  props!: PropsBuild;
  time: TimeOfDay;
  kind: WeatherKind;
  private readonly params = new URLSearchParams(location.search);
  private readonly clock = new THREE.Timer();
  private elapsed = 0;
  private running = false;
  readonly world = new CollisionWorld();
  input!: Input;
  cams!: CameraRig;
  player!: RoadsterCar;
  /** what the player is driving (null on foot) */
  vehicle: Drivable | null = null;
  fleet!: Fleet;
  traffic!: Traffic;
  private roadsBuild!: ReturnType<typeof buildRoads>;
  night = 0;
  people!: People;
  police!: Police;
  hud!: Hud;
  audio = new OpenWorldAudio();
  /** vehicles parked about the city for the player (the Roadster is one) */
  readonly owned: Drivable[] = [];
  private paused = false;
  private menuState: MenuState = { trim: 'rocket', paint: 0, time: 'afternoon', weather: 'clear', traffic: 70, quality: 'high' };
  private doorT = 0;
  private respawnT = 0;
  private respawnAt: { x: number; z: number } | null = null;
  private mapTick = 0;
  private readonly sirenPos: THREE.Vector3[] = [];
  private readonly tmpV = new THREE.Vector3();
  private readonly camFwd = new THREE.Vector3();
  private readonly headlight: DynLight = { pos: new THREE.Vector3(), color: new THREE.Color(1, 0.94, 0.85), intensity: 0, radius: 24 };
  /** a dev free camera (?free=1, or for screenshots: ?cam=x,y,z&look=x,y,z) */
  private free: FreeCam | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ui: HTMLElement,
  ) {
    const q = (this.params.get('q') as QualityLevel) ?? loadQuality();
    this.gfx = new Renderer(canvas, this.scene, this.camera, q);
    this.gfx.renderer.debug.checkShaderErrors = import.meta.env.DEV;
    this.time = (this.params.get('time') as TimeOfDay) ?? 'afternoon';
    this.kind = (this.params.get('weather') as WeatherKind) ?? 'clear';
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.gfx.resize();
    });
  }

  async boot(progress: (f: number, s: string) => void) {
    const step = async (f: number, s: string) => {
      progress(f, s);
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    };
    await step(0.04, 'Loading road surfaces');
    await loadAsphaltScan();
    await step(0.1, 'Surveying Miami');
    this.net = new Network();

    await step(0.16, 'Setting up the sky');
    this.weather = new Weather(planWeather(this.kind, this.time, 3600, 11));
    const w0 = this.weather.state;
    applyWeatherUniforms(w0);
    const track = new Track(MIAMI_ENV_TRACK);
    const capPos = ll(25.7642, -80.1928);
    this.env = createEnvironment(track, this.gfx, this.scene, w0, {
      scenery: false,
      floods: false,
      surface: (x, z, out) => {
        out.set(x, 0.03, z);
        return this.net.mask.land(x, z);
      },
      capture: { pos: new THREE.Vector3(capPos.x, 14, capPos.z), look: new THREE.Vector3(capPos.x - 200, 10, capPos.z + 300) },
    });
    // the stand-in lawn the environment brings is replaced by Miami's land
    this.env.group.traverse((o) => {
      if (o.name === 'SceneryStub') o.visible = false;
    });

    await step(0.28, 'Laying the land and the bay');
    this.ground = buildGround(this.net.mask);
    this.scene.add(this.ground.group);

    await step(0.4, 'Paving the streets');
    const roads = (this.roadsBuild = buildRoads(this.net));
    this.scene.add(roads.group);
    bakeCityLights(roads.lamps);
    uploadCityLights(this.gfx.renderer);

    await step(0.55, 'Raising the skyline');
    this.buildings = buildBuildings(this.net, this.ground.beachX);
    this.scene.add(this.buildings.group);

    for (const c of this.buildings.colliders) this.world.add({ ...c, kind: 'building' });

    await step(0.7, 'Planting palms');
    this.props = buildProps(this.net, roads, this.buildings, this.ground.beachX);
    this.scene.add(this.props.group);
    for (const s of this.props.solids) this.world.add(s);
    // the reflections: capture the city now that it stands (the environment's own lawn goes)
    await step(0.8, 'Catching the light');
    this.env.adoptScenery({ group: new THREE.Group(), heightAt: () => 0, setLight() {}, update() {}, setQuality() {}, stats: { miami: true } });

    await step(0.78, 'Filling the streets');
    this.fleet = new Fleet({ sedan: 56, suv: 48, compact: 30, pickup: 22, gwagon: 18, coupe: 18, cyber: 12, van: 14, taxi: 16, bus: 5, police: 14, policeSuv: 10 });
    this.scene.add(this.fleet.group);
    this.traffic = new Traffic(this.net, this.fleet, this.world, roads.parking);
    this.traffic.target = Number(this.params.get('traffic') ?? 70);

    this.police = new Police(this.net, this.world, this.fleet, this.traffic);
    this.scene.add(this.police.group);
    this.people = new People(this.net, this.world);
    this.scene.add(this.people.group);

    await step(0.85, 'Charging the Roadster');
    this.input = new Input(this.canvas);
    this.cams = new CameraRig(this.camera);
    const trim = (this.params.get('trim') as Trim) ?? 'rocket';
    this.menuState.trim = trim;
    this.menuState.time = this.time;
    this.menuState.weather = this.kind;
    this.menuState.traffic = this.traffic.target;
    this.menuState.quality = this.gfx.qualityLevel;
    this.player = new RoadsterCar(trim, ROADSTER_PAINTS[0][1]);
    this.scene.add(this.player.root);
    this.owned.push(this.player);
    this.spawnPlayer();
    this.vehicle = this.player;
    this.player.occupied = true;
    this.gfx.motionBlur = 0.9;
    this.placeLandmarkVehicles();
    this.hud = new Hud(this.ui, this.net);
    this.audio.arm();

    await step(0.95, 'Warming up');
    this.setupCamera();
    this.env.update(0, this.camera);
    this.env.setWeather(this.weather.state);
    this.gfx.render(0.016);
    await step(1, 'Ready');
    // the people come in behind the loading screen's back (the avatars stream in)
    if (this.params.get('people') !== '0') void this.people.load().catch((e) => console.warn('[openworld] people', e));
    addEventListener('blur', () => this.audio.suspend());
    addEventListener('focus', () => this.audio.resume());
    this.running = true;
    this.clock.connect(document);
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      this.clock.update(now);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      if (this.running) this.frame(dt);
    };
    requestAnimationFrame(loop);
  }

  private setupCamera() {
    const v = (s: string | null) => (s ? s.split(',').map(Number) : null);
    const c = v(this.params.get('cam'));
    const l = v(this.params.get('look'));
    const p0 = ll(25.7720, -80.1860);
    this.camera.position.set(c?.[0] ?? p0.x, c?.[1] ?? 120, c?.[2] ?? p0.z + 900);
    const look = new THREE.Vector3(l?.[0] ?? p0.x - 200, l?.[1] ?? 40, l?.[2] ?? p0.z);
    this.camera.lookAt(look);
    if (this.params.get('fov')) {
      this.camera.fov = Number(this.params.get('fov'));
      this.camera.updateProjectionMatrix();
    }
    if (c || this.params.get('free')) this.free = new FreeCam(this.camera, this.canvas);
  }

  /** the start: Brickell Avenue, heading north toward the river and Downtown */
  spawnPlayer() {
    const s = this.params.get('spawn')?.split(',').map(Number);
    if (s && s.length >= 3) {
      this.player.place(s[0], 0, s[1], s[2]);
      return;
    }
    const at = ll(25.7595, -80.1945);
    const hit = this.net.nearestEdge(at.x, at.z, 0, 200);
    if (hit) {
      const e = hit.e;
      const pt = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };
      // the right-hand lane heading north (toward smaller z)
      const north = e.pz[e.pz.length - 1] < e.pz[0];
      this.net.point(e, hit.pr.s, (north ? 1 : -1) * (e.spec.median + 1.7), pt);
      const yaw = Math.atan2(pt.tx, pt.tz) + (north ? 0 : Math.PI);
      this.player.place(pt.x, pt.y + 0.03, pt.z, yaw);
    } else this.player.place(at.x, 0, at.z, Math.PI);
  }

  /** back on the nearest road, upright, facing along it */
  recover() {
    const v = this.vehicle;
    if (!v) return;
    const body = this.bodyOf(v);
    if (!body && v !== this.player) return;
    const pt = this.roadPoint(v.pos.x, v.pos.z, v.pos.y);
    if (!pt) return v === this.player ? this.spawnPlayer() : undefined;
    if (v === this.player) this.player.place(pt.x, pt.y + 0.03, pt.z, pt.yaw);
    else if (v instanceof Motorbike) v.place(pt.x, pt.y + 0.03, pt.z, pt.yaw);
    else body!.place(pt.x, pt.y + 0.03, pt.z, pt.yaw);
    this.cams.cut();
  }

  /** the right-hand lane of the nearest road, facing along it */
  private roadPoint(x: number, z: number, y = 0, side = 0) {
    const hit = this.net.nearestEdge(x, z, y, 400) ?? this.net.nearestEdge(x, z, 0, 900);
    if (!hit) return null;
    const pt = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };
    const sgn = side || Math.sign(hit.pr.lat || 1);
    this.net.point(hit.e, hit.pr.s, sgn * (hit.e.spec.median + 1.7 + (side ? hit.e.spec.lanes * 3.4 - 2.4 : 0)), pt);
    return { x: pt.x, y: pt.y, z: pt.z, yaw: Math.atan2(pt.tx, pt.tz) + (sgn < 0 ? Math.PI : 0) };
  }

  /** open water near a point (clear of the shore by `clear` m), spiralling out */
  private waterNear(x: number, z: number, clear = 16) {
    const m = this.net.mask;
    const ok = (px: number, pz: number) => {
      if (px < WORLD.x0 || px > WORLD.x1 || pz < WORLD.z0 || pz > WORLD.z1) return false;
      if (m.land(px, pz)) return false;
      for (let k = 0; k < 8; k++) if (m.land(px + Math.sin((k * Math.PI) / 4) * clear, pz + Math.cos((k * Math.PI) / 4) * clear)) return false;
      return true;
    };
    for (let r = 0; r < 3000; r += 20)
      for (let k = 0; k < Math.max(1, r / 10); k++) {
        const a = (k / Math.max(1, r / 10)) * Math.PI * 2;
        const px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
        if (ok(px, pz)) return { x: px, z: pz };
      }
    return null;
  }

  /** open land near a point: off the roads, clear of buildings by `r` m (a helipad) */
  private clearLand(x: number, z: number, r: number) {
    const m = this.net.mask;
    const tmp: Contact[] = [];
    for (let d = 0; d < 600; d += 8)
      for (let k = 0; k < Math.max(1, d / 6); k++) {
        const a = (k / Math.max(1, d / 6)) * Math.PI * 2;
        const px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d;
        if (!m.land(px, pz) || !m.land(px + r, pz) || !m.land(px - r, pz) || !m.land(px, pz + r) || !m.land(px, pz - r)) continue;
        if (this.net.nearestEdge(px, pz, 0, r + 6)) continue;
        if (this.world.circleContacts(px, pz, r, 1, tmp).length) continue;
        return { x: px, z: pz };
      }
    return null;
  }

  /** the vehicles waiting about the city: the police helicopter pad on Watson Island, the
   *  seaplane base beside it, a superbike on Brickell, a go-fast boat off Bayside */
  private placeLandmarkVehicles() {
    const heli = new Helicopter('private');
    const hp = ll(25.7898, -80.1745);
    const hpt = this.clearLand(hp.x, hp.z, 16) ?? hp;
    heli.place(hpt.x, 0.05, hpt.z, Math.PI * 0.5);
    this.addOwned(heli);
    const sp = ll(25.7865, -80.1815);
    const w = this.waterNear(sp.x, sp.z, 22);
    if (w) {
      const plane = new Seaplane();
      plane.place(w.x, 0, w.z, Math.PI * 0.25);
      this.addOwned(plane);
    }
    const bp = ll(25.7781, -80.1862);
    const bw = this.waterNear(bp.x, bp.z, 14);
    if (bw) {
      const boat = new Boat();
      boat.place(bw.x, 0, bw.z, Math.PI);
      this.addOwned(boat);
    }
    const p = this.player.pos;
    const kerb = this.roadPoint(p.x + Math.sin(this.player.yaw) * 14, p.z + Math.cos(this.player.yaw) * 14, p.y);
    if (kerb) {
      const bike = new Motorbike(0xc8102e);
      bike.place(kerb.x + Math.cos(kerb.yaw) * 2.4, kerb.y, kerb.z - Math.sin(kerb.yaw) * 2.4, kerb.yaw);
      this.addOwned(bike);
    }
  }

  private addOwned(v: Drivable) {
    this.owned.push(v);
    this.scene.add(v.root);
  }

  private dropOwned(v: Drivable) {
    const i = this.owned.indexOf(v);
    if (i >= 0) this.owned.splice(i, 1);
    this.scene.remove(v.root);
  }

  /** the tyre body under a ground vehicle */
  private bodyOf(v: Drivable): CarBody | null {
    if (v instanceof RoadsterCar) return v.flying ? null : v.car;
    if (v instanceof FleetCar) return v.body;
    if (v instanceof Motorbike) return v.body;
    return null;
  }

  // ------------------------------------------------------------------ getting in and out

  private get onFoot() {
    return !this.vehicle;
  }

  private canExit(v: Drivable): string | null {
    const sp = Math.hypot(v.vel.x, v.vel.z);
    if (v instanceof RoadsterCar && v.flying) return 'Land first (T)';
    if (v instanceof Helicopter && !v.grounded) return 'Land first';
    if (sp > 7) return 'Slow down to get out';
    if (v instanceof Boat || v instanceof Seaplane) {
      const out = v.exitPoint(this.tmpV);
      if (!this.net.mask.land(out.x, out.z) && !this.net.mask.land(v.pos.x + Math.cos(v.yaw) * 7, v.pos.z - Math.sin(v.yaw) * 7)) return 'Get to the shore first';
    }
    return null;
  }

  private exitVehicle() {
    const v = this.vehicle!;
    const why = this.canExit(v);
    if (why) {
      this.hud.toast(why);
      return;
    }
    const out = v.exitPoint(this.tmpV);
    if ((v instanceof Boat || v instanceof Seaplane) && !this.net.mask.land(out.x, out.z)) out.set(v.pos.x + Math.cos(v.yaw) * 7, 0.2, v.pos.z - Math.sin(v.yaw) * 7);
    v.occupied = false;
    const P = this.people.player;
    P.pos.copy(out);
    P.pos.y = Math.max(out.y, v.pos.y) + 0.1;
    P.vel.set(0, 0, 0);
    P.vy = 0;
    P.yaw = v.yaw;
    this.people.playerVisible = true;
    if (v instanceof FleetCar) v.release();
    if (v === this.player) this.doorT = 1.4;
    this.vehicle = null;
    this.cams.cut();
  }

  private enterNearest() {
    const P = this.people.player.pos;
    let best: Drivable | null = null, bd = Infinity;
    for (const v of this.owned) {
      const d = Math.hypot(v.pos.x - P.x, v.pos.z - P.z);
      const r = v instanceof Helicopter ? 6 : v instanceof Boat || v instanceof Seaplane ? 7.5 : 3.6;
      if (d < r && d < bd && Math.abs(v.pos.y - P.y) < 3) {
        bd = d;
        best = v;
      }
    }
    if (!best) {
      const c = this.traffic.nearest(P.x, P.z, 4.2);
      if (c && Math.abs(c.pos.y - P.y) < 2.5) {
        const fc = new FleetCar(c, this.traffic);
        const driven = !(c.flags & 4) && c.state !== 'parked';
        if (driven) {
          this.people.ejectDriver(fc.exitPoint(this.tmpV).clone(), P);
          this.hud.toast(`Carjacked a ${fc.name}`);
        }
        this.police.report(c.police ? 'stealCop' : 'steal', P);
        this.enter(fc);
        return;
      }
    }
    if (best) this.enter(best);
  }

  private enter(v: Drivable) {
    if (this.vehicle) this.vehicle.occupied = false;
    this.vehicle = v;
    v.occupied = true;
    this.people.playerVisible = false;
    if (v === this.player) this.doorT = 1.2;
    this.cams.cut();
  }

  /** the vehicle the player is next to (for the prompt) */
  private nearVehicleName(): string {
    const P = this.people.player.pos;
    for (const v of this.owned) {
      const r = v instanceof Helicopter ? 6 : v instanceof Boat || v instanceof Seaplane ? 7.5 : 3.6;
      if (Math.hypot(v.pos.x - P.x, v.pos.z - P.z) < r) return v.name;
    }
    const c = this.traffic.nearest(P.x, P.z, 4.2);
    if (c) return c.police ? 'the police car' : c.state === 'parked' ? 'the parked car' : 'the car';
    return '';
  }

  // ------------------------------------------------------------------ the menu

  private openMenu() {
    this.paused = true;
    this.input.blocked = true;
    this.audio.suspend();
    this.hud.openMenu(this.menuState, {
      onResume: () => this.closeMenu(),
      onSpawnRoadster: (trim, paint) => this.deliverRoadster(trim, paint),
      onSpawnVehicle: (kind) => this.deliver(kind),
      onTime: (t) => {
        this.time = t as TimeOfDay;
        this.replanWeather();
      },
      onWeather: (w) => {
        this.kind = w as WeatherKind;
        this.replanWeather();
      },
      onTraffic: (n) => {
        this.traffic.target = n;
        this.people.target = Math.round(n * 2.1);
      },
      onQuality: (q) => {
        this.gfx.setQuality(q as QualityLevel);
        try {
          const s = JSON.parse(localStorage.getItem('apexgp.settings') ?? '{}');
          s.quality = q;
          localStorage.setItem('apexgp.settings', JSON.stringify(s));
        } catch {
          /* private mode */
        }
      },
      onExit: () => (location.href = './'),
    });
  }

  private closeMenu() {
    this.hud.closeMenu();
    this.paused = false;
    this.input.blocked = false;
    this.audio.resume();
  }

  private replanWeather() {
    this.weather = new Weather(planWeather(this.kind, this.time, 3600, 11));
    applyWeatherUniforms(this.weather.state);
    this.env.setWeather(this.weather.state);
  }

  /** a new Roadster at the kerb beside you (the old one is towed) */
  private deliverRoadster(trim: Trim, paint: number) {
    const old = this.player;
    const driving = this.vehicle === old;
    const at = driving ? { x: old.pos.x, y: old.pos.y, z: old.pos.z, yaw: old.yaw } : this.besideYou();
    this.dropOwned(old);
    const car = new RoadsterCar(trim, ROADSTER_PAINTS[paint][1]);
    this.player = car;
    this.addOwned(car);
    car.place(at.x, at.y + 0.03, at.z, at.yaw);
    if (driving || this.onFoot) this.enter(car);
    this.hud.toast(`${car.name} delivered · ${ROADSTER_PAINTS[paint][0]}`);
  }

  private besideYou() {
    const p = this.vehicle ? this.vehicle.pos : this.people.player.pos;
    return this.roadPoint(p.x, p.z, p.y) ?? { x: p.x + 4, y: p.y, z: p.z, yaw: 0 };
  }

  private deliver(kind: string) {
    const p = this.vehicle ? this.vehicle.pos : this.people.player.pos;
    let v: Drivable | null = null;
    if (kind === 'heli') {
      const h = new Helicopter('news');
      const at = this.besideYou();
      h.place(at.x, at.y + 0.05, at.z, at.yaw);
      v = h;
    } else if (kind === 'plane' || kind === 'boat') {
      const w = this.waterNear(p.x, p.z, kind === 'plane' ? 24 : 14);
      if (!w) return this.hud.toast('No open water nearby');
      if (kind === 'plane') {
        const s = new Seaplane();
        s.place(w.x, 0, w.z, Math.atan2(w.x - p.x, w.z - p.z));
        v = s;
      } else {
        const b = new Boat(0xf4f4f2, [0xff3f8e, 0x57e8ff, 0x111111][Math.floor(Math.random() * 3)]);
        b.place(w.x, 0, w.z, Math.atan2(w.x - p.x, w.z - p.z));
        v = b;
      }
    } else if (kind === 'bike') {
      const at = this.besideYou();
      const b = new Motorbike([0xc8102e, 0x0b0c0e, 0x1f5bd6, 0xf2f2f2][Math.floor(Math.random() * 4)]);
      b.place(at.x, at.y + 0.03, at.z, at.yaw);
      v = b;
    } else {
      const at = this.besideYou();
      const model = (kind === 'police' ? 'police' : kind) as ModelId;
      const paint = model === 'police' ? 0xf4f5f7 : PAINTS[Math.floor(Math.random() * PAINTS.length)];
      const c = this.traffic.spawnParked(model, at.x, at.y + 0.03, at.z, at.yaw, paint);
      if (!c) return this.hud.toast('None available right now');
      this.enter(new FleetCar(c, this.traffic));
      return;
    }
    // too many about: the oldest unused one goes (never the Roadster)
    const spare = this.owned.filter((o) => o !== this.player && o !== this.vehicle);
    if (spare.length > 6) this.dropOwned(spare[0]);
    this.addOwned(v);
    this.enter(v);
    this.hud.toast(`${v.name} delivered`);
  }

  // ------------------------------------------------------------------ busted / wasted

  private card(title: string, sub: string, at: { x: number; z: number }) {
    if (this.respawnT > 0) return;
    this.hud.showCard(title, sub);
    this.respawnT = 3.2;
    this.respawnAt = at;
  }

  private respawn() {
    const at = this.respawnAt!;
    this.respawnAt = null;
    if (this.vehicle) {
      const v = this.vehicle;
      v.occupied = false;
      if (v instanceof FleetCar) v.release();
      this.vehicle = null;
    }
    this.police.clear();
    const pt = this.roadPoint(at.x, at.z) ?? { x: at.x, y: 0, z: at.z, yaw: 0 };
    this.player.place(pt.x, pt.y + 0.03, pt.z, pt.yaw);
    this.player.health = 1;
    for (const o of this.owned) o.health = Math.max(o.health, 0.5);
    this.enter(this.player);
  }

  private frame(dt: number) {
    this.input.update(dt);
    const pad = this.input.s;
    if (pad.pause) {
      if (this.paused) this.closeMenu();
      else this.openMenu();
    }
    if (this.paused) {
      // the world holds still behind the menu; the sky keeps rendering
      this.env.update(0, this.camera);
      this.gfx.render(dt);
      return;
    }
    this.elapsed += dt;
    this.weather.update(dt, 0.3);
    const w = this.weather.state;
    applyWeatherUniforms(w);
    const P = TIME_PRESETS[w.time];
    const ctx: WorldCtx = { net: this.net, world: this.world, t: this.elapsed, night: this.night };
    // auto-drive for headless tests: ?auto=throttle[,steer]
    const auto = this.params.get('auto');
    if (auto) {
      const [th, st] = auto.split(',').map(Number);
      pad.throttle = Math.max(pad.throttle, th || 0);
      pad.steer = st || pad.steer;
    }
    if (pad.map) this.hud.bigMap = !this.hud.bigMap;
    // ---- busted / wasted: the card, then back on the street
    if (this.respawnT > 0) {
      this.respawnT -= dt;
      this.input.blocked = true;
      if (this.respawnT <= 0) {
        this.input.blocked = false;
        this.respawn();
      }
    }
    // ---- in and out
    if (pad.enter) {
      if (this.vehicle) this.exitVehicle();
      else this.enterNearest();
    }
    const camFwd = this.camFwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const camYaw = Math.atan2(camFwd.x, camFwd.z);
    // ---- the player's vehicle, and the parked ones settling
    if (this.vehicle) this.vehicle.drive(dt, pad, ctx);
    else this.people.movePlayer(dt, pad.moveX, pad.moveY, pad.boost, pad.handbrake, camYaw);
    for (const o of this.owned) {
      if (o === this.vehicle) continue;
      const d = Math.hypot(o.pos.x - this.focus.x, o.pos.z - this.focus.z);
      if (d < 400) o.drive(dt, null, ctx);
    }
    // the Roadster's butterfly doors swing up as you get in and out
    this.doorT -= dt;
    this.player.doorTarget = this.doorT > 0 || (!this.player.occupied && Math.hypot(this.player.vel.x, this.player.vel.z) < 0.5 && Math.hypot(this.people.player.pos.x - this.player.pos.x, this.people.player.pos.z - this.player.pos.z) < 6) ? 1 : 0;
    if (pad.camera) this.cams.mode = CAM_MODES[(CAM_MODES.indexOf(this.cams.mode) + 1) % CAM_MODES.length];
    if (pad.recover) this.recover();
    const cc = this.params.get('carcam');
    if (cc && this.vehicle) {
      // dev: an orbit shot of the car (azimuth from the nose, elevation, distance)
      const [az, el, d, fov] = cc.split(',').map(Number);
      const v = this.vehicle;
      const a = v.yaw + (az * Math.PI) / 180, e = (el * Math.PI) / 180;
      this.camera.position.set(v.pos.x + Math.sin(a) * Math.cos(e) * d, v.pos.y + 0.55 + Math.sin(e) * d, v.pos.z + Math.cos(a) * Math.cos(e) * d);
      this.camera.lookAt(v.pos.x, v.pos.y + 0.55, v.pos.z);
      if (fov && this.camera.fov !== fov) {
        this.camera.fov = fov;
        this.camera.updateProjectionMatrix();
      }
    } else if (this.free) this.free.update(dt);
    else {
      this.cams.look2(pad.lookX, pad.lookY, pad.dragging);
      if (this.vehicle && this.vehicle.impact > 4) this.cams.bump(Math.min(1, this.vehicle.impact / 25));
      this.cams.update(dt, this.vehicle ? this.vehicle.subject() : this.footSubject(), this.world);
    }
    // ---- the traffic, against whatever the player drives
    const v = this.vehicle;
    const body = v ? this.bodyOf(v) : null;
    const hl = v instanceof FleetCar ? v.car.spec.L / 2 : body ? body.spec.hl : 0.3;
    const hw = v instanceof FleetCar ? v.car.spec.W / 2 : body ? body.spec.hw : 0.3;
    const playerBox = body
      ? { pos: body.pos, vel: v!.vel, yaw: body.yaw, hl, hw, mass: body.spec.mass, onImpulse: (jx: number, jz: number) => { body.vx += jx; body.vz += jz; } }
      : null;
    this.traffic.update(dt, this.elapsed, this.focus, camFwd, this.night, playerBox);
    for (const h of this.traffic.hits) {
      if (h.speed > 3) this.cams.bump(Math.min(1, h.speed / 20));
      if (h.speed > 4) this.police.report(h.car.police ? 'hitCop' : 'hitCar', h.car.pos);
    }
    // ---- the people (they dodge, or don't, the player's vehicle)
    const pv = v && !(v instanceof Helicopter && !v.grounded) && !(v instanceof RoadsterCar && v.flying) ? [{ pos: v.pos, vel: v.vel, yaw: v.yaw, hl: Math.max(hl, 1), hw: Math.max(hw, 0.5) }] : [];
    this.people.update(dt, this.elapsed, this.focus, this.camera, pv, this.police.wanted >= 3 ? 0.3 : 0);
    for (const s of this.people.struck) this.police.report('hitPed', s);
    if (v && body && Math.abs(body.vLong) > 40) this.police.report('speeding', v.pos);
    // ---- the police
    const sus = this.suspect(v, body, hl, hw);
    this.police.update(dt, sus, ctx, this.camera.position, camFwd, this.night);
    for (const e of this.police.events) {
      if (e === 'escaped') this.hud.toast('You lost the police', 'good');
      if (e === 'up') this.hud.toast(`Wanted level ${this.police.wanted}`, 'bad');
      if (e === 'busted') this.card('BUSTED', 'Miami PD · released from Downtown HQ', ll(25.7795, -80.1975));
    }
    if (v && v.health <= 0) this.card('WASTED', 'Jackson Memorial Hospital', ll(25.7905, -80.2105));
    this.fleet.flush();
    // ---- the HUD
    this.updateHud(dt, camYaw);
    this.updateAudio(dt, v, body);
    this.gfx.motionCars.length = 0;
    if (this.vehicle && !(this.vehicle instanceof FleetCar)) this.gfx.motionCars.push(this.vehicle.root);
    this.env.setWeather(w);
    this.env.update(dt, this.camera);
    this.env.focusShadow(!this.free ? this.focus : this.camera.position.clone().add(new THREE.Vector3(0, 0, -30).applyQuaternion(this.camera.quaternion)));
    const night = THREE.MathUtils.clamp(THREE.MathUtils.smoothstep(P.night ?? 0, 0.05, 0.9) * 0.85 + (P.elevation < 4 ? 0.15 : 0) + (P.elevation < 10 ? 0.1 : 0), 0, 1);
    setCityNight(night);
    this.night = night;
    facadeUniforms.uNight.value = night;
    facadeUniforms.uDay.value = (1 - night) * (P.direct ?? 1);
    facadeUniforms.uFTime.value = this.elapsed;
    for (const wt of this.ground.water) wt.update(this.elapsed);
    this.props.update(this.elapsed, night);
    const dyn = this.police.dynLights(night, this.focus);
    // the player's headlights throw a pool on the road ahead after dark
    const hv = this.vehicle;
    if (hv && night > 0.2 && (hv.kind === 'roadster' || hv.kind === 'car' || hv.kind === 'bike')) {
      const fwd = 9 + Math.min(8, Math.hypot(hv.vel.x, hv.vel.z) * 0.25);
      this.headlight.pos.set(hv.pos.x + Math.sin(hv.yaw) * fwd, hv.pos.y + 1.4, hv.pos.z + Math.cos(hv.yaw) * fwd);
      this.headlight.intensity = 5 * night;
      dyn.push(this.headlight);
    }
    setDynLights(dyn, this.camera.position);
    this.gfx.render(dt);
  }

  /** where the player is (in a vehicle or on foot) */
  private get focus(): THREE.Vector3 {
    return this.vehicle ? this.vehicle.pos : this.people.player.pos;
  }

  private footSubject(): CamSubject {
    const P = this.people.player;
    return { pos: P.pos, yaw: P.yaw, vel: P.vel, size: 1.8, kind: 'foot' };
  }

  private suspect(v: Drivable | null, body: CarBody | null, hl: number, hw: number): Suspect {
    const foot = this.people.player;
    if (!v) return { pos: foot.pos, vel: foot.vel, yaw: foot.yaw, hl: 0.3, hw: 0.3, mass: 80, onFoot: true, flying: false, onImpulse: (jx, jz) => foot.vel.set(foot.vel.x + jx, foot.vel.y, foot.vel.z + jz) };
    const flying = (v instanceof RoadsterCar && v.flying) || (v instanceof Helicopter && !v.grounded) || (v instanceof Seaplane && !v.onWater) || v instanceof Boat;
    return {
      pos: body ? body.pos : v.pos,
      vel: v.vel,
      yaw: v.yaw,
      hl,
      hw,
      mass: body ? body.spec.mass : 1500,
      onFoot: false,
      flying,
      onImpulse: (jx, jz) => {
        if (body) {
          body.vx += jx;
          body.vz += jz;
        }
      },
    };
  }

  private updateHud(dt: number, camYaw: number) {
    const v = this.vehicle;
    const hud = this.hud;
    hud.setVehicle(v ? v.hud() : null, !v);
    hud.setWanted(this.police.wanted, this.police.unseen > 0.6, this.elapsed);
    const f = this.focus;
    const road = this.net.nearestEdge(f.x, f.z, f.y, 25);
    hud.setPlace(placeAt(f.x, f.z), road?.e.name ?? '', dt);
    let prompt = '';
    if (!v && this.respawnT <= 0) {
      const n = this.nearVehicleName();
      if (n) prompt = `F  ·  get in ${n}`;
    } else if (v === this.player && this.player.trim === 'rocket' && !this.player.flying && Math.hypot(v.vel.x, v.vel.z) < 2) prompt = 'T  ·  lift off';
    hud.setPrompt(prompt);
    if (++this.mapTick % 2 === 0) {
      const blips: Parameters<Hud['drawMap']>[3] = [];
      for (const c of this.police.cops) blips.push({ x: c.body.pos.x, z: c.body.pos.z, color: Math.floor(this.elapsed * 4) % 2 ? '#ff4d5e' : '#4d7dff', size: 4 });
      for (const c of this.traffic.cars) if (c.police && c.flags & 1) blips.push({ x: c.pos.x, z: c.pos.z, color: '#4d7dff', size: 3.5 });
      if (this.police.heli) blips.push({ x: this.police.heli.pos.x, z: this.police.heli.pos.z, color: '#4d7dff', size: 6 });
      for (const o of this.owned) if (o !== v) blips.push({ x: o.pos.x, z: o.pos.z, color: o === this.player ? '#ff3f8e' : '#57e8ff', size: 4, shape: 'square' });
      hud.drawMap(f.x, f.z, camYaw, blips, null);
    }
  }

  private updateAudio(dt: number, v: Drivable | null, body: CarBody | null) {
    if (!this.audio.ready) return;
    const pad = this.input.s;
    const f = this.focus;
    const kind: AudioFrame['kind'] = !v ? 'foot' : v.kind;
    this.police.sirens(this.sirenPos);
    const sirens = this.sirenPos.map((p) => p.distanceTo(f));
    const honks = this.traffic.honks.map((p) => p.distanceTo(f));
    let city = 0;
    for (const c of this.traffic.cars) if (Math.abs(c.pos.x - f.x) < 150 && Math.abs(c.pos.z - f.z) < 150) city++;
    const surf = Math.abs(f.x - this.ground.beachX(f.z));
    const thrust = v instanceof RoadsterCar ? v.thrustLevel : 0;
    const rpm = v instanceof Helicopter ? v.rpm : v instanceof Seaplane ? v.throttle : 0;
    const airborne = v instanceof RoadsterCar ? v.flying || !v.car.onGround : v instanceof Helicopter ? !v.grounded : v instanceof Seaplane ? !v.onWater : false;
    this.audio.update(dt, {
      kind,
      speed: v ? Math.hypot(v.vel.x, v.vel.z) : 0,
      throttle: pad.throttle,
      brake: pad.brake,
      slip: body ? body.slip : 0,
      thrust,
      rpm,
      airborne,
      impact: v ? v.impact : 0,
      horn: pad.horn && !(v instanceof FleetCar && v.police),
      siren: v instanceof FleetCar && v.siren,
      sirens,
      honks,
      surf,
      rain: this.weather.state.rain,
      city: Math.min(1, city / 18),
      height: f.y,
    });
  }
}

function loadQuality(): QualityLevel {
  try {
    const s = JSON.parse(localStorage.getItem('apexgp.settings') ?? '{}');
    if (s.quality) return s.quality;
  } catch {
    /* defaults */
  }
  return 'high';
}

/** WASD + drag free camera for development shots */
class FreeCam {
  private keys = new Set<string>();
  private yaw: number;
  private pitch: number;
  private drag = false;
  constructor(
    private readonly cam: THREE.PerspectiveCamera,
    canvas: HTMLCanvasElement,
  ) {
    const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
    this.yaw = e.y;
    this.pitch = e.x;
    addEventListener('keydown', (k) => this.keys.add(k.code));
    addEventListener('keyup', (k) => this.keys.delete(k.code));
    canvas.addEventListener('mousedown', () => (this.drag = true));
    addEventListener('mouseup', () => (this.drag = false));
    addEventListener('mousemove', (m) => {
      if (!this.drag) return;
      this.yaw -= m.movementX * 0.003;
      this.pitch = THREE.MathUtils.clamp(this.pitch - m.movementY * 0.003, -1.5, 1.5);
    });
  }
  update(dt: number) {
    const k = this.keys;
    const sp = (k.has('ShiftLeft') ? 220 : 40) * dt;
    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    if (k.has('KeyW')) this.cam.position.addScaledVector(f, sp);
    if (k.has('KeyS')) this.cam.position.addScaledVector(f, -sp);
    if (k.has('KeyD')) this.cam.position.addScaledVector(r, sp);
    if (k.has('KeyA')) this.cam.position.addScaledVector(r, -sp);
    if (k.has('KeyE')) this.cam.position.y += sp;
    if (k.has('KeyQ')) this.cam.position.y -= sp;
    if (this.drag || k.size) this.cam.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }
}
