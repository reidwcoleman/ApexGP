import '@fontsource/lilita-one/400.css';
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import './derby.css';
import { Derby } from './derby.ts';

/** Marble Derby's own page (derby.html). */

declare global {
  interface Window {
    __derby?: Derby;
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
// (the big screen letters its board in the page's fonts)
await Promise.all([document.fonts.load('96px "Lilita One"'), document.fonts.load('700 40px "Fredoka"')]).catch(() => undefined);

try {
  const game = new Derby(canvas, ui);
  window.__derby = game;
  await game.boot((f, s) => {
    bar.style.width = `${Math.round(f * 100)}%`;
    step.textContent = s;
  });
  loading.classList.add('done');
  setTimeout(() => loading.remove(), 900);
  setTimeout(() => (window.__ready = true), Number(new URLSearchParams(location.search).get('settle') ?? 800));
} catch (e) {
  console.error(e);
  err.textContent = String((e as Error)?.stack ?? e);
}
