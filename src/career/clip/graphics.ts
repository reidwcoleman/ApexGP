/**
 * The broadcast graphics burned into the highlight clips, drawn on a 2D canvas the size of the
 * video (and redrawn only when something on it changes): a REPLAY tag with the lap, a slim
 * timing tower of the cars around the moment, the camera caption, and the lower third that
 * names the moment. Same system as the game's HUD: tinted glass, Titillium, the one red accent,
 * team colours only as team marks.
 */

export interface TowerRow {
  pos: number;
  code: string;
  color: string;
  gap: string;
  hi: boolean;
}

export interface LowerThird {
  kicker: string;
  title: string;
  sub: string;
  color: string;
}

export interface OverlayState {
  /** the red tag, top left ('Replay'), null for none */
  tag: string | null;
  /** beside the tag: 'Lap 7 / 10' */
  info: string | null;
  /** playback speed of this shot (< 1 shows SLOW MOTION) */
  slow: number;
  /** top right: the camera ('T-cam', 'VER') */
  camera: string | null;
  cameraSub: string | null;
  tower: TowerRow[] | null;
  l3: LowerThird | null;
  /** 0 … 1: the lower third wiping in (and back out) */
  l3In: number;
  /** 0 … 1: the top graphics fading in */
  topIn: number;
}

const FONT = '"Titillium Web", system-ui, sans-serif';
const ACCENT = '#ff2b3f';
const GLASS = 'rgba(10, 12, 17, 0.8)';
const LINE = 'rgba(255, 255, 255, 0.09)';
const INK = 'rgba(255, 255, 255, 0.94)';
const INK2 = 'rgba(255, 255, 255, 0.62)';

const q = (v: number, k = 40) => Math.round(v * k) / k;

/** a string that changes whenever the picture would (so an unchanged overlay isn't redrawn or re-uploaded) */
export function overlayKey(s: OverlayState): string {
  const t = s.tower ? s.tower.map((r) => `${r.pos}${r.code}${r.gap}${r.hi ? 1 : 0}`).join(',') : '';
  return `${s.tag}|${s.info}|${s.slow < 0.99 ? 1 : 0}|${s.camera}|${s.cameraSub}|${t}|${s.l3 ? s.l3.title + s.l3.sub + s.l3.kicker : ''}|${q(s.l3In)}|${q(s.topIn, 20)}`;
}

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function glass(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  rr(g, x, y, w, h, r);
  g.fillStyle = GLASS;
  g.fill();
  g.strokeStyle = LINE;
  g.lineWidth = 1;
  rr(g, x + 0.5, y + 0.5, w - 1, h - 1, r);
  g.stroke();
}

function spacing(g: CanvasRenderingContext2D, px: number) {
  (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${px}px`;
}

const ease = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return 1 - Math.pow(1 - t, 3);
};

export function drawOverlay(g: CanvasRenderingContext2D, W: number, H: number, s: OverlayState) {
  const k = H / 720;
  g.clearRect(0, 0, W, H);
  g.textBaseline = 'alphabetic';
  const M = 28 * k;

  // ---- top left: REPLAY · Lap 7 / 10 · slow motion, and the tower under it
  if (s.topIn > 0.001) {
    g.save();
    g.globalAlpha = ease(s.topIn);
    let x = M;
    const y = 26 * k;
    const h = 28 * k;
    if (s.tag) {
      g.font = `700 ${12.5 * k}px ${FONT}`;
      spacing(g, 1.2 * k);
      const tw = g.measureText(s.tag.toUpperCase()).width;
      const w = tw + 34 * k;
      rr(g, x, y, w, h, 6 * k);
      g.fillStyle = ACCENT;
      g.fill();
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(x + 13 * k, y + h / 2, 3.2 * k, 0, Math.PI * 2);
      g.fill();
      g.fillText(s.tag.toUpperCase(), x + 23 * k, y + h / 2 + 4.5 * k);
      x += w + 8 * k;
    }
    const pill = (a: string, b: string) => {
      g.font = `600 ${12.5 * k}px ${FONT}`;
      spacing(g, 1.2 * k);
      const wa = g.measureText(a).width;
      g.font = `700 ${14 * k}px ${FONT}`;
      spacing(g, 0.3 * k);
      const wb = b ? g.measureText(b).width : 0;
      const w = wa + (b ? wb + 8 * k : 0) + 26 * k;
      glass(g, x, y, w, h, 6 * k);
      g.font = `600 ${12.5 * k}px ${FONT}`;
      spacing(g, 1.2 * k);
      g.fillStyle = INK2;
      g.fillText(a, x + 13 * k, y + h / 2 + 4.5 * k);
      if (b) {
        g.font = `700 ${14 * k}px ${FONT}`;
        spacing(g, 0.3 * k);
        g.fillStyle = INK;
        g.fillText(b, x + 13 * k + wa + 8 * k, y + h / 2 + 5 * k);
      }
      x += w + 8 * k;
    };
    if (s.info) {
      const [a, ...b] = s.info.split(' ');
      pill(a.toUpperCase(), b.join(' '));
    }
    if (s.slow < 0.99) pill('SLOW MOTION', '');
    spacing(g, 0);

    // the tower: the cars around the moment, the ones it is about lit
    const rows = s.tower;
    if (rows && rows.length) {
      const tx = M, ty = y + h + 10 * k;
      const rh = 26 * k, tw = 176 * k, pad = 4 * k;
      glass(g, tx, ty, tw, rows.length * rh + pad * 2, 10 * k);
      rows.forEach((r, i) => {
        const ry = ty + pad + i * rh;
        if (r.hi) {
          rr(g, tx + pad, ry, tw - pad * 2, rh, 6 * k);
          g.fillStyle = 'rgba(255, 255, 255, 0.13)';
          g.fill();
        }
        g.font = `700 ${13 * k}px ${FONT}`;
        g.textAlign = 'right';
        g.fillStyle = r.hi ? INK : INK2;
        g.fillText(String(r.pos), tx + 30 * k, ry + rh / 2 + 4.5 * k);
        g.textAlign = 'left';
        g.fillStyle = r.color;
        g.fillRect(tx + 38 * k, ry + 6 * k, 3 * k, rh - 12 * k);
        g.font = `700 ${14 * k}px ${FONT}`;
        spacing(g, 0.6 * k);
        g.fillStyle = r.hi ? INK : 'rgba(255,255,255,0.78)';
        g.fillText(r.code, tx + 50 * k, ry + rh / 2 + 5 * k);
        spacing(g, 0);
        g.font = `600 ${12.5 * k}px ${FONT}`;
        g.textAlign = 'right';
        g.fillStyle = INK2;
        g.fillText(r.gap, tx + tw - 14 * k, ry + rh / 2 + 4.5 * k);
        g.textAlign = 'left';
      });
    }

    // top right: the camera
    if (s.camera) {
      g.font = `700 ${13 * k}px ${FONT}`;
      spacing(g, 1.2 * k);
      const a = s.camera.toUpperCase();
      const wa = g.measureText(a).width;
      g.font = `600 ${13 * k}px ${FONT}`;
      const b = s.cameraSub ? s.cameraSub.toUpperCase() : '';
      const wb = b ? g.measureText(b).width : 0;
      const w = wa + (b ? wb + 12 * k : 0) + 28 * k;
      const cx = W - M - w;
      glass(g, cx, y, w, h, 6 * k);
      g.font = `700 ${13 * k}px ${FONT}`;
      g.fillStyle = INK;
      g.fillText(a, cx + 14 * k, y + h / 2 + 4.5 * k);
      if (b) {
        g.font = `600 ${13 * k}px ${FONT}`;
        g.fillStyle = INK2;
        g.fillText(b, cx + 14 * k + wa + 12 * k, y + h / 2 + 4.5 * k);
      }
      spacing(g, 0);
    }
    g.restore();
  }

  // ---- the lower third: what happened, who, where
  const l3 = s.l3;
  if (l3 && s.l3In > 0.001) {
    const h = 96 * k;
    const y = H - 34 * k - h;
    const x = M;
    g.font = `700 ${31 * k}px ${FONT}`;
    const wt = g.measureText(l3.title).width;
    g.font = `600 ${15 * k}px ${FONT}`;
    const ws = g.measureText(l3.sub).width;
    const w = Math.min(W * 0.62, Math.max(360 * k, Math.max(wt, ws) + 64 * k));
    const p = ease(s.l3In);
    g.save();
    g.globalAlpha = Math.min(1, s.l3In * 2.5);
    g.beginPath();
    g.rect(x, y - 4 * k, w * p + 1, h + 8 * k);
    g.clip();
    glass(g, x, y, w, h, 12 * k);
    // the team's mark down the left edge
    g.save();
    rr(g, x, y, w, h, 12 * k);
    g.clip();
    g.fillStyle = l3.color;
    g.fillRect(x, y, 6 * k, h);
    g.restore();
    const tx = x + 28 * k;
    g.font = `700 ${12.5 * k}px ${FONT}`;
    spacing(g, 1.6 * k);
    g.fillStyle = ACCENT;
    g.fillText(l3.kicker.toUpperCase(), tx, y + 28 * k);
    spacing(g, 0);
    g.font = `700 ${31 * k}px ${FONT}`;
    g.fillStyle = INK;
    g.fillText(l3.title, tx, y + 62 * k, w - 52 * k);
    g.font = `600 ${15 * k}px ${FONT}`;
    g.fillStyle = INK2;
    g.fillText(l3.sub, tx, y + 84 * k, w - 52 * k);
    g.restore();
  }
}
