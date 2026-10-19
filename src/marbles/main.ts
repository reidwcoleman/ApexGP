import '@fontsource/lilita-one/400.css';
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import './marbles.css';
import { MarbleGame } from './game.ts';

/** Marble Mania's own page (marbles.html): nothing of the racing game or Miami is loaded. */

declare global {
  interface Window {
    __marbles?: MarbleGame;
    __ready?: boolean;
  }
}

const loading = document.getElementById('loading')!;
const bar = loading.querySelector('.lbar b') as HTMLElement;
const step = loading.querySelector('.lstep') as HTMLElement;
const err = loading.querySelector('.lerr') as HTMLElement;
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const ui = document.getElementById('ui')!;
if (new URLSearchParams(location.search).get('nohud')) ui.style.display = 'none';

await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
// (the sign painter needs the fonts before it letters the arches)
await Promise.all([document.fonts.load('96px "Lilita One"'), document.fonts.load('600 44px "Fredoka"')]).catch(() => undefined);

try {
  const game = new MarbleGame(canvas, ui);
  window.__marbles = game;
  await game.boot((f, s) => {
    bar.style.width = `${Math.round(f * 100)}%`;
    step.textContent = s;
  });
  loading.classList.add('done');
  setTimeout(() => loading.remove(), 900);
  const q = new URLSearchParams(location.search);
  setTimeout(() => (window.__ready = true), Number(q.get('settle') ?? 800));
} catch (e) {
  console.error(e);
  err.textContent = String((e as Error)?.stack ?? e);
}
