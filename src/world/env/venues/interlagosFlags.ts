import * as THREE from 'three';

/**
 * Interlagos crowd flags (atlas cells 0–3): the Auriverde, a SENNA flag in his helmet's
 * yellow with the green and blue stripes, a green-and-yellow BRASIL banner and an
 * INTERLAGOS banner. Fan colours: the seleção's yellow and green, blue, white.
 */
export function drawInterlagosFlags(
  ctx: CanvasRenderingContext2D,
  at: (k: number) => readonly [number, number],
  S: number,
  txt: (x: number, y: number, s: string, size: number, col: string) => void,
) {
  // 0: the Brazilian flag — green field, yellow rhombus, blue globe with the white band
  {
    const [x, y] = at(0);
    ctx.fillStyle = '#009c3b';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#ffdf00';
    ctx.beginPath();
    ctx.moveTo(x + S * 0.08, y + S / 2);
    ctx.lineTo(x + S / 2, y + S * 0.14);
    ctx.lineTo(x + S * 0.92, y + S / 2);
    ctx.lineTo(x + S / 2, y + S * 0.86);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#002776';
    ctx.beginPath();
    ctx.arc(x + S / 2, y + S / 2, S * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + S / 2, y + S / 2, S * 0.2, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = S * 0.035;
    ctx.beginPath();
    ctx.arc(x + S * 0.42, y + S * 0.86, S * 0.42, -Math.PI * 0.62, -Math.PI * 0.2);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    for (let k = 0; k < 9; k++) {
      const a = k * 2.39;
      ctx.fillRect(x + S / 2 + Math.cos(a) * S * 0.12 * ((k % 3) / 3 + 0.3), y + S * 0.56 + Math.sin(a) * S * 0.06, 3, 3);
    }
    ctx.restore();
  }
  // 1: SENNA — his helmet: yellow, a green stripe and a blue stripe
  {
    const [x, y] = at(1);
    ctx.fillStyle = '#ffd500';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#00843d';
    ctx.fillRect(x, y + S * 0.64, S, S * 0.1);
    ctx.fillStyle = '#1e3f99';
    ctx.fillRect(x, y + S * 0.76, S, S * 0.08);
    txt(x + S / 2, y + S * 0.38, 'SENNA', 74, '#12306e');
  }
  // 2: BRASIL banner — green over yellow
  {
    const [x, y] = at(2);
    ctx.fillStyle = '#009c3b';
    ctx.fillRect(x, y, S, S * 0.55);
    ctx.fillStyle = '#ffdf00';
    ctx.fillRect(x, y + S * 0.55, S, S * 0.45);
    txt(x + S / 2, y + S * 0.3, 'BRASIL', 68, '#ffdf00');
    txt(x + S / 2, y + S * 0.77, '★', 60, '#002776');
  }
  // 3: INTERLAGOS banner — blue with yellow lettering
  {
    const [x, y] = at(3);
    ctx.fillStyle = '#0b2a6f';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#009c3b';
    ctx.fillRect(x, y + S * 0.7, S, S * 0.09);
    ctx.fillStyle = '#ffdf00';
    ctx.fillRect(x, y + S * 0.79, S, S * 0.07);
    txt(x + S / 2, y + S * 0.33, 'INTER', 64, '#ffdf00');
    txt(x + S / 2, y + S * 0.52, 'LAGOS', 64, '#ffffff');
  }
}

/** crowd shirt colours: the seleção's canary yellow and green, blue, white */
export const BRAZIL_FANS = ['#ffdf00', '#ffd400', '#f5c800', '#009c3b', '#00843d', '#1e3f99', '#002776', '#ffffff', '#ffdf00', '#009c3b'].map((h) => new THREE.Color(h));
