import './style.css';
import { Game, START } from './game/game';
import { runSelfTest } from './game/selftest';
import type { CarType } from './entities/carModels';
import { loadCarKit } from './entities/carKit';
import { loadSkinnedKit } from './entities/skinned';

const params = new URLSearchParams(location.search);
const testMode = params.get('test'); // 'drive' | 'foot'
const selfTest = params.has('selftest') || params.has('self-test');

function boot() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  let game: Game;
  try {
    game = new Game(canvas);
  } catch (e) {
    document.body.innerHTML = `<div style="padding:40px;font:18px sans-serif;color:#fff">Palmera needs WebGL to run. (${(e as Error).message})</div>`;
    throw e;
  }

  const begin = (mode: 'foot' | 'drive' | 'play') => {
    game.start();
    if (mode === 'drive') {
      const v = game.spawnCar('sports', START.x - 4, START.z, Math.PI);
      v.persistent = true;
      game.enterVehicle(v);
    }
  };

  game.hud.onPlay(() => {
    game.input.wantLock = true;
    canvas.requestPointerLock?.();
    begin('play');
    // a normal game picks up where you left off (?fresh starts clean without touching the save)
    if (!params.has('fresh')) {
      game.saveGame.enabled = true;
      game.saveGame.load();
    }
  });

  if (testMode === 'drive' || testMode === 'foot') begin(testMode);
  else if (selfTest) begin('foot');
  else game.hud.showTitle(true);
  if (testMode || selfTest) {
    // automated runs should not grab the mouse
    game.input.wantLock = params.get('lock') === '1';
    canvas.addEventListener('mousedown', () => game.audio.init(), { once: true });
  }

  // debug hooks for automated testing
  const api = {
    game,
    get player() {
      return game.player;
    },
    get cars() {
      return game.vehicles;
    },
    get police() {
      return game.police;
    },
    get peds() {
      return game.npcs;
    },
    get wanted() {
      return game.wanted.level;
    },
    get cash() {
      return game.cash;
    },
    setTime: (h: number) => game.sky.setTime(h),
    teleport: (x: number, z: number) => game.teleport(x, z),
    setWanted: (n: number) => game.wanted.setLevel(n),
    spawnCar: (type: CarType, x: number, z: number, heading = 0) => game.spawnCar(type, x, z, heading),
    startMission: (i: number) => game.missions.start(i),
    giveWeapons: () => {
      for (const w of ['bat', 'pistol', 'smg', 'shotgun', 'rifle', 'sniper', 'grenade'] as const) game.weapons.give(w, w === 'grenade' ? 10 : 300);
      game.weapons.select('pistol');
    },
    selfTest: () => runSelfTest(game),
  };
  (window as unknown as { palmera: typeof api }).palmera = api;
  if (params.has('time')) game.sky.setTime(parseFloat(params.get('time')!));
  const wx = params.get('weather');
  if (wx === 'mist') game.sky.forceMist = true;
  if (wx === 'rain' || wx === 'clear' || wx === 'storm') {
    game.sky.forceWeather = wx;
    game.sky.rain = game.sky.rainTarget = wx === 'clear' ? 0 : 1;
    game.wet = wx === 'clear' ? 0 : 1;
  }

  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    game.update(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  if (selfTest) {
    void runSelfTest(game).then((r) => {
      const json = JSON.stringify(r);
      (window as unknown as { __selftest: unknown }).__selftest = r;
      const pre = document.createElement('pre');
      pre.id = 'selftest-result';
      pre.style.cssText = 'position:fixed;left:10px;top:30px;max-width:46vw;white-space:pre-wrap;font:12px monospace;background:rgba(0,0,0,.75);color:#fff;padding:8px;z-index:99;pointer-events:none';
      pre.textContent = r.steps.map((s) => `${s.passed ? 'PASS' : 'FAIL'} ${s.step}: ${s.detail}`).join('\n');
      pre.dataset.json = json;
      document.body.appendChild(pre);
      console.log('SELFTEST ' + json);
      document.title = 'SELFTEST DONE';
      if (params.has('report')) void fetch('/__selftest', { method: 'POST', body: json }).catch(() => undefined);
    });
  }
}

void Promise.all([loadCarKit(), loadSkinnedKit()]).then(boot);
