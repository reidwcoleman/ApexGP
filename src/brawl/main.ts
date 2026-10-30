import '@fontsource/lilita-one/400.css';
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import './brawl.css';
import { Game } from './game.ts';

/** Plush Panic's own page (brawl.html): nothing of the racing game is loaded. */

declare global {
  interface Window {
    __brawl?: Game;
    __ready?: boolean;
  }
}

const loading = document.getElementById('loading')!;
const bar = loading.querySelector('.lbar b') as HTMLElement;
const step = loading.querySelector('.lstep') as HTMLElement;
const err = loading.querySelector('.lerr') as HTMLElement;
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const ui = document.getElementById('ui')!;
const q = new URLSearchParams(location.search);

try {
  const game = new Game(canvas, ui);
  game.manual = q.has('manual');
  window.__brawl = game;
  await game.boot((f, s) => {
    bar.style.width = `${Math.round(f * 100)}%`;
    step.textContent = s;
  });
  loading.classList.add('done');
  setTimeout(() => loading.remove(), 900);
  setTimeout(() => (window.__ready = true), Number(q.get('settle') ?? 600));
} catch (e) {
  console.error(e);
  err.textContent = String((e as Error)?.stack ?? e);
}
