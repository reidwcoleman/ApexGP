// A proportional 5x7 bitmap font, baked once per colour. Canvas text would anti-alias; this can't.
import { canvas } from './pal';
const F = [0,0,0,0,0, 0,0,95,0,0, 0,7,0,7,0, 20,127,20,127,20, 36,42,127,42,18, 35,19,8,100,98, 54,73,85,34,80, 0,8,7,3,0, 0,28,34,65,0, 0,65,34,28,0, 42,28,127,28,42, 8,8,62,8,8, 0,128,112,48,0, 8,8,8,8,8, 0,0,96,96,0, 32,16,8,4,2,
 62,81,73,69,62, 0,66,127,64,0, 114,73,73,73,70, 33,65,73,77,51, 24,20,18,127,16, 39,69,69,69,57, 60,74,73,73,49, 65,33,17,9,7, 54,73,73,73,54, 70,73,73,41,30, 0,0,20,0,0, 0,64,52,0,0, 0,8,20,34,65, 20,20,20,20,20, 0,65,34,20,8, 2,1,89,9,6,
 62,65,93,89,78, 124,18,17,18,124, 127,73,73,73,54, 62,65,65,65,34, 127,65,65,65,62, 127,73,73,73,65, 127,9,9,9,1, 62,65,65,81,115, 127,8,8,8,127, 0,65,127,65,0, 32,64,65,63,1, 127,8,20,34,65, 127,64,64,64,64, 127,2,28,2,127, 127,4,8,16,127, 62,65,65,65,62,
 127,9,9,9,6, 62,65,81,33,94, 127,9,25,41,70, 38,73,73,73,50, 3,1,127,1,3, 63,64,64,64,63, 31,32,64,32,31, 63,64,56,64,63, 99,20,8,20,99, 3,4,120,4,3, 97,89,73,77,67, 0,127,65,65,65, 2,4,8,16,32, 0,65,65,65,127, 4,2,1,2,4, 64,64,64,64,64,
 0,3,7,8,0, 32,84,84,120,64, 127,40,68,68,56, 56,68,68,68,40, 56,68,68,40,127, 56,84,84,84,24, 0,8,126,9,2, 24,164,164,156,120, 127,8,4,4,120, 0,68,125,64,0, 32,64,64,61,0, 127,16,40,68,0, 0,65,127,64,0, 124,4,120,4,120, 124,8,4,4,120, 56,68,68,68,56,
 252,24,36,36,24, 24,36,36,24,252, 124,8,4,4,8, 72,84,84,84,36, 4,4,63,68,36, 60,64,64,32,124, 28,32,64,32,28, 60,64,48,64,60, 68,40,16,40,68, 76,144,144,144,124, 68,100,84,76,68, 0,8,54,65,0, 0,0,119,0,0, 0,65,54,8,0, 2,1,2,4,2];
const widths: number[] = [], starts: number[] = [];
for (let c = 0; c < 95; c++) {
  let a = 0, b = 4; while (a < 5 && !F[c * 5 + a]) a++; while (b > 0 && !F[c * 5 + b]) b--;
  if (c === 0) { a = 0; b = 2; } starts.push(a); widths.push(b - a + 1);
}
const atlases = new Map<string, HTMLCanvasElement>();
function atlas(col: string) {
  let a = atlases.get(col); if (a) return a;
  const { c, g } = canvas(95 * 6, 9); g.fillStyle = col;
  for (let i = 0; i < 95; i++) for (let x = 0; x < 5; x++) { const v = F[i * 5 + x]; for (let y = 0; y < 8; y++) if (v & (1 << y)) g.fillRect(i * 6 + x, y, 1, 1); }
  atlases.set(col, c); return c;
}
export const LINE = 10;
export function textW(t: string, scale = 1) { let w = 0; for (let i = 0; i < t.length; i++) { const k = t.charCodeAt(i) - 32; w += ((k >= 0 && k < 95 ? widths[k] : 3) + 1) * scale; } return Math.max(0, w - scale); }
export function text(g: CanvasRenderingContext2D, t: string, x: number, y: number, col: string, scale = 1, shadow?: string) {
  x = Math.round(x); y = Math.round(y);
  if (shadow) text(g, t, x + scale, y + scale, shadow, scale);
  const a = atlas(col);
  for (let i = 0; i < t.length; i++) {
    const k = t.charCodeAt(i) - 32;
    if (k < 0 || k >= 95) { x += 4 * scale; continue; }
    const w = widths[k];
    if (k) g.drawImage(a, k * 6 + starts[k], 0, w, 9, x, y, w * scale, 9 * scale);
    x += (w + 1) * scale;
  }
  return x;
}
export function bold(g: CanvasRenderingContext2D, t: string, x: number, y: number, col: string, scale = 1, shadow?: string) {
  // two passes would smear a 5x7 face shut, so weight comes from a hard drop shadow instead
  text(g, t, x + scale, y + scale, shadow ?? 'rgba(18,18,28,.55)', scale); text(g, t, x, y, col, scale);
}
/** a full 1px rim, for words that have to read over busy art */
export function rimmed(g: CanvasRenderingContext2D, t: string, cx: number, y: number, col: string, rim: string, scale = 1) { const x = Math.round(cx - textW(t, scale) / 2), Y = Math.round(y); for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) text(g, t, x + dx, Y + dy, rim, scale); text(g, t, x, Y, col, scale); }
export function center(g: CanvasRenderingContext2D, t: string, cx: number, y: number, col: string, scale = 1, shadow?: string) { text(g, t, cx - textW(t, scale) / 2, y, col, scale, shadow); }
export function right(g: CanvasRenderingContext2D, t: string, rx: number, y: number, col: string, scale = 1, shadow?: string) { text(g, t, rx - textW(t, scale), y, col, scale, shadow); }
export function wrap(t: string, w: number) {
  const out: string[] = []; let line = '';
  for (const word of t.split(' ')) { const n = line ? line + ' ' + word : word; if (textW(n) > w && line) { out.push(line); line = word; } else line = n; }
  if (line) out.push(line); return out;
}
