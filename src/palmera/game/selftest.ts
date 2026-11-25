// Scripted self-test of the core loop: move, act (jump, punch, shoot, drive), and HUD.
import { Human } from '../entities/humans';
import { groundAt } from '../world/map';
import type { Game } from './game';

export interface SelfTestResult {
  version: 1;
  steps: { step: string; passed: boolean; detail: string }[];
}

/** Wait until the game clock has advanced by `secs` (works even when frames are slow). */
function waitGame(game: Game, secs: number): Promise<void> {
  const until = game.elapsed + secs;
  return new Promise((res) => {
    const start = performance.now();
    const tick = () => {
      if (game.elapsed >= until || performance.now() - start > secs * 1000 * 6 + 4000) res();
      else setTimeout(tick, 16);
    };
    tick();
  });
}

export async function runSelfTest(game: Game): Promise<SelfTestResult> {
  const steps: SelfTestResult['steps'] = [];
  const inp = game.input;
  const p = game.player;
  await waitGame(game, 0.6);

  // ---- move: walk forward
  const sx = p.pos.x, sz = p.pos.z;
  game.playerCtl.camYaw = p.yaw;
  inp.virtual.add('KeyW');
  await waitGame(game, 1.5);
  inp.virtual.delete('KeyW');
  await waitGame(game, 0.2);
  const walked = Math.hypot(p.pos.x - sx, p.pos.z - sz);
  steps.push({ step: 'move', passed: walked > 2, detail: `walked ${walked.toFixed(1)} m forward in 1.5 s` });

  // ---- act: jump, punch a pedestrian, drive a car
  let maxY = p.pos.y;
  const y0 = p.pos.y;
  inp.press('Space');
  for (let i = 0; i < 12; i++) {
    await waitGame(game, 0.05);
    maxY = Math.max(maxY, p.pos.y);
  }
  const jumped = maxY - y0;
  await waitGame(game, 0.6);

  const ped = new Human('ped');
  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  ped.pos.set(p.pos.x + fx * 1.0, groundAt(p.pos.x + fx, p.pos.z + fz), p.pos.z + fz * 1.0);
  ped.state = 'idle';
  ped.health = ped.maxHealth = 60;
  game.addNpc(ped);
  const h0 = ped.health;
  inp.press('Mouse0');
  await waitGame(game, 0.3);
  const punched = ped.health < h0;

  // pistol: give one and fire
  game.loadout.owned.add('pistol');
  game.loadout.clip.pistol = 12;
  game.loadout.reserve.pistol = 24;
  game.weapons.select('pistol');
  await waitGame(game, 0.1);
  inp.press('Mouse0');
  await waitGame(game, 0.3);
  const fired = game.loadout.clip.pistol < 12;
  game.weapons.select('fist');

  // drive: spawn a sedan next to the player, press F, hold W
  const car = game.spawnCar('sedan', p.pos.x - fz * 6.0, p.pos.z + fx * 6.0, p.yaw); // on the quiet side, clear of palms
  car.persistent = true;
  await waitGame(game, 0.2);
  // step towards it like a player would
  game.playerCtl.camYaw = p.yaw;
  inp.virtual.add('KeyD');
  await waitGame(game, 0.3);
  inp.virtual.delete('KeyD');
  await waitGame(game, 0.2);
  inp.press('KeyF');
  await waitGame(game, 1.6);
  const entered = p.vehicle === car;
  const c0x = car.pos.x, c0z = car.pos.z;
  inp.virtual.add('KeyW');
  await waitGame(game, 2.0);
  inp.virtual.delete('KeyW');
  const drove = Math.hypot(car.pos.x - c0x, car.pos.z - c0z);
  const topSpeed = car.speed;
  inp.press('KeyF');
  await waitGame(game, 0.8);
  const exited = p.vehicle === null;
  steps.push({
    step: 'act',
    passed: jumped > 0.4 && punched && fired && entered && drove > 5,
    detail: `jumped ${jumped.toFixed(2)} m, punch ${punched ? 'hit' : 'missed'} (ped hp ${h0}->${Math.round(ped.health)}), pistol ${fired ? 'fired' : 'did not fire'}, entered car ${entered}, drove ${drove.toFixed(1)} m reaching ${(topSpeed * 2.237).toFixed(0)} mph, exited ${exited}`,
  });

  // ---- wanted: punching raised heat?
  steps.push({ step: 'wanted', passed: game.wanted.level > 0 || game.wanted.heat > 0, detail: `wanted level ${game.wanted.level}, heat ${game.wanted.heat.toFixed(1)} after assault` });

  // ---- hud
  await waitGame(game, 0.3);
  const q = (s: string) => document.querySelector(s) as HTMLElement | null;
  const cashTxt = q('#cash')?.textContent ?? '';
  const hpW = parseFloat(q('#hp > div')?.style.width ?? '0');
  const stars = document.querySelectorAll('#stars svg').length;
  const mini = q('#mini canvas') as HTMLCanvasElement | null;
  let miniPainted = false;
  if (mini) {
    const px = mini.getContext('2d')!.getImageData(mini.width / 2 - 40, mini.height / 2 - 40, 80, 80).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
    miniPainted = sum > 0;
  }
  const hudOk = cashTxt.startsWith('$') && hpW > 0 && stars === 5 && miniPainted && game.hud.drawn.speedo;
  steps.push({ step: 'hud', passed: hudOk, detail: `cash "${cashTxt}", health bar ${hpW.toFixed(0)}%, ${stars} wanted stars, minimap ${miniPainted ? 'drawn' : 'blank'}, speedometer ${game.hud.drawn.speedo ? 'shown in car' : 'never shown'}` });

  // ---- world: traffic and pedestrians present
  const traffic = game.vehicles.filter((v) => v.driver === 'npc').length;
  const peds = game.npcs.filter((h) => h.kind === 'ped').length;
  steps.push({ step: 'world', passed: traffic > 3 && peds > 3, detail: `${traffic} AI cars and ${peds} pedestrians active` });
  return { version: 1, steps };
}
