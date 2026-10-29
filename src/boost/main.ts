import '@fontsource/titillium-web/600.css';
import '@fontsource/titillium-web/700.css';
import '@fontsource/titillium-web/700-italic.css';
import '@fontsource/titillium-web/900.css';
import './ui.css';
import { Game } from './game.ts';
import { loadRocketSim } from './sim/rocketsim.ts';

/** Boostball's own page (boost.html): nothing of the racing game is loaded. */

declare global {
  interface Window {
    __boost?: Game;
    __ready?: boolean;
  }
}

const loading = document.getElementById('loading')!;
const bar = loading.querySelector('.lbar b') as HTMLElement;
const step = loading.querySelector('.lstep') as HTMLElement;
const err = loading.querySelector('.lerr') as HTMLElement;
const set = (f: number, s: string) => {
  bar.style.width = `${Math.round(f * 100)}%`;
  step.textContent = s;
};
const tick = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
// (how long each loading step took, logged once: the console line to look at when loading feels slow)
const t0 = performance.now();
const took: string[] = [];
let tl = t0;
const lap = (what: string) => {
  const t = performance.now();
  took.push(`${what} ${Math.round(t - tl)}`);
  tl = t;
};

try {
  await tick();
  set(0.1, 'Painting the lines');
  await Promise.all([document.fonts.load('italic 900 40px "Titillium Web"'), document.fonts.load('700 40px "Titillium Web"')]).catch(() => undefined);
  await tick();
  set(0.25, 'Starting the physics');
  await loadRocketSim();
  lap('physics');
  set(0.35, 'Building the stadium');
  const game = new Game(document.getElementById('gl') as HTMLCanvasElement, document.getElementById('ui')!);
  window.__boost = game;
  lap('stadium');
  await tick();
  set(0.6, 'Warming up the engines');
  game.boot();
  lap('boot');
  await game.warm();
  lap('shaders');
  set(1, 'Kickoff');
  game.start();
  lap('start');
  console.info(`[boost] loaded in ${Math.round(performance.now() - t0)} ms: ${took.join(', ')}`);
  loading.classList.add('done');
  setTimeout(() => loading.remove(), 900);
  const q = new URLSearchParams(location.search);
  setTimeout(() => (window.__ready = true), Number(q.get('settle') ?? 1200));
} catch (e) {
  console.error(e);
  err.textContent = String((e as Error)?.stack ?? e);
}
