import '@fontsource/titillium-web/600.css';
import '@fontsource/titillium-web/700.css';
import '@fontsource/titillium-web/900.css';
import './ui/tokens.css';
import './ui/hud.css';
import './ui/menu.css';
import { Game } from './game/Game.ts';

declare global {
  interface Window {
    __game?: Game;
    __ready?: boolean;
  }
}

const loading = document.getElementById('loading')!;
const bar = loading.querySelector('.lbar b') as HTMLElement;
const step = loading.querySelector('.lstep') as HTMLElement;
const err = loading.querySelector('.lerr') as HTMLElement;

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const ui = document.getElementById('ui')!;
const game = new Game(canvas, ui);
window.__game = game;

game
  .boot((f, s) => {
    bar.style.width = `${Math.round(f * 100)}%`;
    step.textContent = s;
  })
  .then(() => {
    loading.classList.add('done');
    const q = new URLSearchParams(location.search);
    const demo = q.get('demo');
    if (demo) {
      game.debugStart({
        mode: demo === 'tt' ? 'timetrial' : 'race',
        camera: q.get('cam') ?? undefined,
        autopilot: q.get('auto') !== '0',
        skip: Number(q.get('skip') ?? 0),
        weather: (q.get('weather') as never) ?? undefined,
        time: (q.get('time') as never) ?? undefined,
        grid: q.get('grid') ? Number(q.get('grid')) : undefined,
        laps: q.get('laps') ? Number(q.get('laps')) : undefined,
      });
    }
    // let the loading fade and a few frames settle before signalling ready
    setTimeout(() => (window.__ready = true), Number(q.get('settle') ?? 1500));
  })
  .catch((e: unknown) => {
    console.error(e);
    err.textContent = String((e as Error)?.stack ?? e);
  });
