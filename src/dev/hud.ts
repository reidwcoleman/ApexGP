import '@fontsource/titillium-web/600.css';
import '@fontsource/titillium-web/700.css';
import '@fontsource/titillium-web/900.css';
import '../ui/tokens.css';
import '../ui/hud.css';
import '../ui/menu.css';
import { Track } from '../world/Track.ts';
import { MONZA } from '../world/Circuits.ts';
import { Race } from '../race/Race.ts';
import { allEntries } from '../race/Teams.ts';
import { AIDriver } from '../sim/AIDriver.ts';
import { HUD } from '../ui/HUD.ts';
import { Menu } from '../ui/Menu.ts';
import { Engineer } from '../race/Engineer.ts';
import { uiColor } from '../race/Teams.ts';
import { planWeather } from '../world/Weather.ts';
const eng = new Engineer();

// ?t=seconds of race to simulate before the screenshot, ?screen=title|setup|results
const params = new URLSearchParams(location.search);
const ui = document.getElementById('ui')!;
const track = new Track(MONZA);
const entries = allEntries();
const race = new Race(track, { mode: 'race', laps: 5, difficulty: 0.97, playerEntry: entries[6], playerGrid: 9, entries, weather: planWeather((params.get('weather') as never) ?? 'drizzle', 'afternoon', 500, 4) });
const auto = new AIDriver(0.99, 0.6);
auto.startFrom(race.player.car, track);
const hud = new HUD(ui);
hud.setup(race, track);
hud.show(true);
const menu = new Menu(ui, { onSetupChange() {}, onStart() {}, onSettings() {}, onResume() {}, onRestart() {}, onQuit() {}, onResetCar() {}, onUi() {}, forecast: () => ({ weather: 'Light rain', time: 'Afternoon' }) });

const simT = Number(params.get('t') ?? 95);
race.startLights();
const dt = 1 / 60;
let t = 0;
while (t < simT) {
  const neigh = race.cars.map((c) => ({ id: c.id, s: c.car.s, lateral: c.car.lateral, speed: c.car.vx }));
  auto.update(dt, race.player.car, track, race.profile, race.phase === 'racing', neigh, race.player.id);
  Object.assign(race.playerInput, auto.input);
  race.update(dt);
  hud.handleEvents(race, race.events);
  const line = eng.update(dt, race, race.events);
  if (line) hud.radio(line, uiColor(race.player.entry.team));
  hud.update(dt, race);
  t += dt;
}
const screen = params.get('screen');
if (screen === 'results') {
  menu.showResults(race.classification(), 'Podium · P3', '5 laps · Autodromo Nazionale Monza', () => {}, () => {});
  hud.show(false);
} else if (screen) {
  menu.show(screen as 'title');
  hud.show(false);
}
let last = performance.now();
function loop(now: number) {
  const d = Math.min(0.05, (now - last) / 1000);
  last = now;
  const neigh = race.cars.map((c) => ({ id: c.id, s: c.car.s, lateral: c.car.lateral, speed: c.car.vx }));
  auto.update(d, race.player.car, track, race.profile, race.phase === 'racing', neigh, race.player.id);
  Object.assign(race.playerInput, auto.input);
  race.update(d);
  hud.handleEvents(race, race.events);
  hud.update(d, race);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
setTimeout(() => ((window as any).__ready = true), 1200);
(window as any).__info = { pos: race.player.position, lap: race.player.laps, best: race.bestLap };
