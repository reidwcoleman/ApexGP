import type { Venue } from './worldmap.ts';
import * as THREE from 'three';
import { MeshBuilder, srgb } from './geom.ts';
import type { GrandstandSpec, Layout, ScreenSpec, SpectatorBank } from './layout.ts';
import { STAND_ROW_DEPTH, STAND_ROW_RISE } from './layout.ts';
import { sponsorTexture, sponsorUV } from './signage.ts';
import { TEAMS } from '../../race/Teams.ts';
import { canvas2d, canvasTexture } from './textures.ts';
import { rng } from './noise.ts';
import { weatherUniforms } from '../weatherUniforms.ts';
import { renderFanAtlas, ATLAS_COLS } from '../../people/Crowd.ts';
import { peopleKit } from '../../people/Humans.ts';
import type { Track } from '../Track.ts';
import type { WorldMap } from './worldmap.ts';
import { buildLandmarks } from './landmarks.ts';
import { AUSTIN_FANS, drawAustinFlags } from './venues/austinScenery.ts';
import { SPIELBERG_FAN_COLOURS, drawSpielbergFlags } from './venues/spielberg.ts';
import { MONTREAL_FAN_COLOURS, drawMontrealFlags } from './venues/montreal.ts';
import { BRAZIL_FANS, drawInterlagosFlags } from './venues/interlagosFlags.ts';
import { ZANDVOORT_FANS, drawZandvoortFlags } from './venues/zandvoort.ts';

/**
 * Grandstands and the tifosi.
 *
 *   Tribuna Centrale   two tiers with a glass hospitality band between them and a
 *                      deep cantilevered roof, opposite the pits
 *   covered stands     stepped concrete, coloured seat blocks, steel roof + fascia
 *   open stands        uncovered terraces
 * Crowds are instanced person cards (canvas atlas, shirt tinted per instance,
 * idle bob, the odd arms-up wave) — overwhelmingly red: this is Monza. Waving
 * flags (tifosi red, tricolore, team colours) are held up in the stands and fly
 * from tall poles behind them; big screens face the main stands; fans stand on
 * the grass banks (prato) along the fences.
 */

export interface GrandstandBuild {
  group: THREE.Group;
  update(t: number): void;
  people: number;
  flags: number;
}

const CONCRETE = srgb(0xbdb8ae);
const CONCRETE_DARK = srgb(0x8d8a84);
const STEEL = srgb(0xe8e9eb);
const STEEL_DARK = srgb(0x5b5f66);
const SEAT_SCHEMES: number[][] = [
  [0xc8102e, 0xb20d27, 0xc8102e, 0xe8e8e8],
  [0x1f5fbf, 0x1b2552, 0x1f5fbf, 0xd9d9d9],
  [0x2e7d32, 0xd9d9d9, 0xc8102e, 0x2e7d32],
  [0xc8102e, 0xd9d9d9, 0x1b2552, 0xc8102e],
  [0xf2b705, 0xc8102e, 0xf2b705, 0x333333],
];
// Zandvoort: orange seats (and the odd block of Dutch blue) under the orange crowd
const ZANDVOORT_SEATS: number[][] = [
  [0xff7b00, 0xe8690c, 0xff7b00, 0x21468b],
  [0xf26b00, 0xff8c1a, 0x21468b, 0xff7b00],
  [0xff8c1a, 0xff9933, 0xff7b00, 0x21468b],
];

// ---------------------------------------------------------------- crowd atlas + material

/** the grandstand crowd: the ten 3D fan types rendered to sprites (falls back to the drawn set) */
function crowdAtlas(): { tex: THREE.CanvasTexture; variants: number } {
  const kit = peopleKit();
  const cv = kit ? renderFanAtlas(kit) : null;
  if (cv && cv.width > 0 && hasInk(cv)) return { tex: canvasTexture(cv, true, 4), variants: ATLAS_COLS };
  return { tex: drawnCrowdAtlas(), variants: 8 };
}
function hasInk(cv: HTMLCanvasElement): boolean {
  const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
  for (let i = 3; i < d.length; i += 400) if (d[i] > 0) return true;
  return false;
}

function drawnCrowdAtlas(): THREE.CanvasTexture {
  // 8 fans × 2 poses (sitting / on their feet); the shirt is drawn near-white and tinted per instance
  const CW = 96, CH = 192, COLS = 8, ROWS = 2;
  const { canvas, ctx } = canvas2d(CW * COLS, CH * ROWS);
  const r = rng(99);
  const skins = ['#f1c9a5', '#d9a47a', '#b07a52', '#7a4e32', '#e8b890', '#c68d63', '#f5d2b8', '#8d5a3b'];
  const hairs = ['#2a1d14', '#5a3a22', '#b08850', '#141414', '#7d6a55', '#8a2a1a', '#d8c08a', '#3b2a20'];
  const caps = ['#c8102e', '#ff7b00', '#ffffff', '#ffd400', '#111111', '#1b2552', '#ff7b00'];
  const k = CW / 64;
  const shade = (y0: number, y1: number, cx: number, w: number) => {
    // soft side shading and fold shadows, kept light so the tint mask survives
    const g = ctx.createLinearGradient(cx - w, 0, cx + w, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.12)');
    g.addColorStop(0.3, 'rgba(0,0,0,0)');
    g.addColorStop(0.75, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.14)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - w, y0, 2 * w, y1 - y0);
  };
  for (let col = 0; col < COLS; col++) {
    const skin = skins[Math.floor(r() * skins.length)];
    const hair = hairs[Math.floor(r() * hairs.length)];
    const cap = r() < 0.45 ? caps[Math.floor(r() * caps.length)] : null;
    const shades = r() < 0.4;
    const beard = r() < 0.25;
    const longHair = !cap && r() < 0.35;
    const phone = col === 3 || col === 6;
    const broad = 0.85 + r() * 0.3;
    for (let row = 0; row < ROWS; row++) {
      const ox = col * CW, oy = row * CH;
      const cx = ox + CW / 2;
      ctx.save();
      ctx.translate(0, oy);
      ctx.scale(1, CH / 128);
      ctx.translate(0, -oy);
      const Y = (v: number) => oy + v;
      // legs / lap
      ctx.fillStyle = r() < 0.5 ? '#2b3140' : r() < 0.5 ? '#4a4038' : '#3a4a5c';
      ctx.fillRect(cx - 17 * broad * k * 0.66, Y(100), 34 * broad * k * 0.66, 28);
      // torso: rounded shoulders, narrowing to the waist
      ctx.fillStyle = '#ffffff';
      const sw = 16 * broad * k * 0.66, ww = 13 * broad * k * 0.66;
      ctx.beginPath();
      ctx.moveTo(cx - sw * 0.7, Y(38));
      ctx.quadraticCurveTo(cx - sw * 1.1, Y(40), cx - sw, Y(52));
      ctx.lineTo(cx - ww, Y(104));
      ctx.lineTo(cx + ww, Y(104));
      ctx.lineTo(cx + sw, Y(52));
      ctx.quadraticCurveTo(cx + sw * 1.1, Y(40), cx + sw * 0.7, Y(38));
      ctx.closePath();
      ctx.fill();
      shade(Y(38), Y(104), cx, sw * 1.1);
      // collar
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.beginPath();
      ctx.ellipse(cx, Y(39), 6, 3, 0, 0, Math.PI);
      ctx.fill();
      // arms (sleeves near-white so they take the shirt colour, forearms skin)
      const arm = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) => {
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.strokeStyle = skin;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.fillStyle = skin;
        ctx.beginPath();
        ctx.arc(x2, y2, 3.5, 0, Math.PI * 2);
        ctx.fill();
      };
      if (row === 0) {
        // sitting: hands in the lap, or holding a phone up to film
        arm(cx - sw * 0.95, Y(46), cx - sw * 1.2, Y(76), cx - 10, Y(96));
        if (phone) {
          arm(cx + sw * 0.95, Y(46), cx + sw * 1.25, Y(70), cx + 8, Y(48));
          ctx.fillStyle = '#111';
          ctx.fillRect(cx + 3, Y(38), 10, 16);
        } else arm(cx + sw * 0.95, Y(46), cx + sw * 1.2, Y(76), cx + 10, Y(96));
      } else {
        // on their feet: both arms up, or one arm punching the air
        const both = col % 2 === 0;
        arm(cx + sw * 0.9, Y(46), cx + sw * 1.4, Y(26), cx + sw * 1.5, Y(6));
        if (both) arm(cx - sw * 0.9, Y(46), cx - sw * 1.4, Y(26), cx - sw * 1.5, Y(6));
        else arm(cx - sw * 0.95, Y(46), cx - sw * 1.2, Y(76), cx - 10, Y(92));
      }
      // neck + head
      ctx.fillStyle = skin;
      ctx.fillRect(cx - 4, Y(31), 8, 9);
      ctx.beginPath();
      ctx.ellipse(cx, Y(24), 10, 12.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // cheek shading
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.beginPath();
      ctx.ellipse(cx + 4, Y(27), 5, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      // hair / cap
      ctx.fillStyle = cap ?? hair;
      ctx.beginPath();
      ctx.ellipse(cx, Y(18), 11, cap ? 8 : 9, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      if (longHair) {
        ctx.fillRect(cx - 11, Y(18), 5, 20);
        ctx.fillRect(cx + 6, Y(18), 5, 20);
      }
      if (cap) {
        ctx.fillRect(cx - 12, Y(16), 24, 4);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(cx - 12, Y(19), 24, 2);
      }
      if (beard) {
        ctx.fillStyle = hair;
        ctx.beginPath();
        ctx.ellipse(cx, Y(31), 8, 5, 0, 0, Math.PI);
        ctx.fill();
      }
      if (shades) {
        ctx.fillStyle = '#111';
        ctx.fillRect(cx - 9, Y(22), 8, 4);
        ctx.fillRect(cx + 1, Y(22), 8, 4);
      } else {
        ctx.fillStyle = '#2a1d14';
        ctx.fillRect(cx - 6, Y(23), 3, 2);
        ctx.fillRect(cx + 3, Y(23), 3, 2);
      }
      ctx.restore();
    }
  }
  return canvasTexture(canvas, true, 4);
}

function crowdMaterial(atlas: THREE.Texture, uniforms: { uTime: THREE.IUniform }, variants = 8): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.5 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uCrowd = { value: atlas };
    sh.uniforms.uTime = uniforms.uTime;
    sh.uniforms.uRain = weatherUniforms.uRain;
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aShade;
uniform float uTime;
varying vec2 vCrowdUv;
varying float vShade;
float h11( float n ) { return fract( sin( n * 12.9898 ) * 43758.5453 ); }`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  float id = float( gl_InstanceID );
  float variant = floor( h11( id ) * ${variants.toFixed(1)} );
  float excite = h11( id + 17.0 );
  // waves roll along the stands; some fans are always on their feet
  float wave = step( 0.9, sin( uTime * ( 0.35 + excite * 0.4 ) + id * 1.37 ) ) * step( 0.35, excite );
  float bob = sin( uTime * ( 3.0 + excite * 4.0 ) + id ) * 0.025 * step( 0.55, excite ) + wave * 0.08;
  transformed.y += bob * ( position.y + 0.1 );
  transformed.x += sin( uTime * 0.8 + id * 3.1 ) * 0.02 * position.y;
  vCrowdUv = vec2( ( variant + uv.x ) / ${variants.toFixed(1)}, ( ( 1.0 - wave ) + uv.y ) / 2.0 );
  vShade = aShade;
}`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uCrowd;
varying vec2 vCrowdUv;
varying float vShade;`,
      )
      .replace(
        '#include <map_fragment>',
        `{
  vec4 t = texture2D( uCrowd, vCrowdUv );
  // near-white = shirt (the palest skin tone stays below 0.76); keep the drawn folds under the tint
  float shirt = smoothstep( 0.76, 0.84, min( min( t.r, t.g ), t.b ) );
  #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR )
    vec3 tint = vColor.rgb;
  #else
    vec3 tint = vec3( 1.0 );
  #endif
  diffuseColor.rgb = mix( t.rgb, tint * ( dot( t.rgb, vec3( 0.3333 ) ) / 0.97 ), shirt ) * vShade;
  diffuseColor.a = t.a;
}`,
      )
      .replace('#include <color_fragment>', '');
  };
  mat.customProgramCacheKey = () => 'apex-crowd-v4-' + variants;
  return mat;
}

// ---------------------------------------------------------------- flags

const FLAG_DESIGNS = 16;
/** flags 0–3 are the venue's own, 4 … 14 one per team, 15 the chequered flag */
const TEAM_FLAG0 = 4;

function flagAtlas(venue: Venue): THREE.CanvasTexture {
  const S = 256;
  const { canvas, ctx } = canvas2d(S * 4, S * 4);
  const at = (k: number) => [(k % 4) * S, Math.floor(k / 4) * S] as const;
  const txt = (x: number, y: number, s: string, size: number, col: string) => {
    ctx.fillStyle = col;
    ctx.font = `900 ${size}px "Titillium Web", "Arial Narrow", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s, x, y);
  };
  if (venue === 'airfield') {
    // 0: Union flag, 1: St George's cross, 2: SILVERSTONE banner, 3: papaya banner
    {
      const [x, y] = at(0);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, S, S);
      ctx.clip();
      ctx.fillStyle = '#012169';
      ctx.fillRect(x, y, S, S);
      const diag = (w: number, col: string) => {
        ctx.strokeStyle = col;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(x, y + S * 0.2);
        ctx.lineTo(x + S, y + S * 0.8);
        ctx.moveTo(x + S, y + S * 0.2);
        ctx.lineTo(x, y + S * 0.8);
        ctx.stroke();
      };
      diag(S * 0.12, '#ffffff');
      diag(S * 0.04, '#c8102e');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + S * 0.42, y + S * 0.2, S * 0.16, S * 0.6);
      ctx.fillRect(x, y + S * 0.43, S, S * 0.14);
      ctx.fillStyle = '#c8102e';
      ctx.fillRect(x + S * 0.455, y + S * 0.2, S * 0.09, S * 0.6);
      ctx.fillRect(x, y + S * 0.46, S, S * 0.08);
      ctx.restore();
    }
    {
      const [x, y] = at(1);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, S, S);
      ctx.fillStyle = '#ce1124';
      ctx.fillRect(x + S * 0.42, y, S * 0.16, S);
      ctx.fillRect(x, y + S * 0.42, S, S * 0.16);
    }
    {
      const [x, y] = at(2);
      ctx.fillStyle = '#0b1f3a';
      ctx.fillRect(x, y, S, S);
      ctx.fillStyle = '#c8102e';
      ctx.fillRect(x, y + S * 0.7, S, S * 0.08);
      txt(x + S / 2, y + S * 0.42, 'SILVER', 66, '#ffffff');
      txt(x + S / 2, y + S * 0.6, 'STONE', 66, '#ffffff');
    }
    {
      const [x, y] = at(3);
      ctx.fillStyle = '#ff8000';
      ctx.fillRect(x, y, S, S);
      txt(x + S / 2, y + S * 0.48, 'PAPAYA', 56, '#101216');
    }
  } else if (venue === 'austin') {
    drawAustinFlags(ctx, at, S, txt);
  } else if (venue === 'zandvoort') {
    drawZandvoortFlags(ctx, at, S, txt);
  } else if (venue === 'suzuka') {
    // 0: the Hinomaru, 1: SUZUKA banner, 2: 鈴鹿 banner, 3: red-and-white JAPAN banner
    {
      const [x, y] = at(0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, S, S);
      ctx.fillStyle = '#bc002d';
      ctx.beginPath();
      ctx.arc(x + S / 2, y + S / 2, S * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    {
      const [x, y] = at(1);
      ctx.fillStyle = '#12151c';
      ctx.fillRect(x, y, S, S);
      ctx.fillStyle = '#e60012';
      ctx.fillRect(x, y + S * 0.68, S, S * 0.1);
      txt(x + S / 2, y + S * 0.46, 'SUZUKA', 62, '#ffffff');
    }
    {
      const [x, y] = at(2);
      ctx.fillStyle = '#f4f1ea';
      ctx.fillRect(x, y, S, S);
      ctx.fillStyle = '#bc002d';
      ctx.fillRect(x, y, S, S * 0.12);
      ctx.fillRect(x, y + S * 0.88, S, S * 0.12);
      ctx.fillStyle = '#16181d';
      ctx.font = `900 104px "Hiragino Sans", "Yu Gothic", "Noto Sans JP", "Meiryo", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('鈴鹿', x + S / 2, y + S * 0.52);
    }
    {
      const [x, y] = at(3);
      ctx.fillStyle = '#bc002d';
      ctx.fillRect(x, y, S, S);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y + S * 0.3, S, S * 0.4);
      txt(x + S / 2, y + S * 0.5, 'JAPAN', 70, '#bc002d');
    }
  } else if (venue === 'interlagos') {
    drawInterlagosFlags(ctx, at, S, txt);
  } else if (venue === 'ardennes') {
    // 0: Dutch tricolour, 1: Belgian, 2: ORANJE, 3: black-yellow-red banner
    const bars = (k: number, cols: string[], vertical: boolean) => {
      const [x, y] = at(k);
      cols.forEach((c, i) => {
        ctx.fillStyle = c;
        if (vertical) ctx.fillRect(x + (i * S) / cols.length, y, S / cols.length + 1, S);
        else ctx.fillRect(x, y + (i * S) / cols.length, S, S / cols.length + 1);
      });
    };
    bars(0, ['#ae1c28', '#f4f4f4', '#21468b'], false);
    bars(1, ['#1a1a1a', '#fdda24', '#ef3340'], true);
    {
      const [x, y] = at(2);
      ctx.fillStyle = '#ff7b00';
      ctx.fillRect(x, y, S, S);
      txt(x + S / 2, y + S * 0.48, 'ORANJE', 58, '#ffffff');
    }
    {
      const [x, y] = at(3);
      ctx.fillStyle = '#fdda24';
      ctx.fillRect(x, y, S, S);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(x, y, S, S * 0.2);
      ctx.fillStyle = '#ef3340';
      ctx.fillRect(x, y + S * 0.8, S, S * 0.2);
      txt(x + S / 2, y + S * 0.5, 'SPA', 90, '#1a1a1a');
    }
  } else if (venue === 'spielberg') {
    drawSpielbergFlags(ctx, at, S, txt);
  } else if (venue === 'montreal') {
    drawMontrealFlags(ctx, at, S);
  }
  // 0: tifosi red, yellow disc with a black "R"
  else {
    const [x, y] = at(0);
    ctx.fillStyle = '#c8102e';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#ffd400';
    ctx.beginPath();
    ctx.arc(x + S / 2, y + S / 2, S * 0.26, 0, Math.PI * 2);
    ctx.fill();
    txt(x + S / 2, y + S / 2 + 6, 'R', 110, '#141414');
  }
  // 1: tricolore
  if (venue === 'park') {
    const [x, y] = at(1);
    for (const [k, c] of ['#009246', '#f1f2f1', '#ce2b37'].entries()) {
      ctx.fillStyle = c;
      ctx.fillRect(x + (k * S) / 3, y, S / 3 + 1, S);
    }
  }
  // 2: FORZA ROSSA banner flag
  if (venue === 'park') {
    const [x, y] = at(2);
    ctx.fillStyle = '#b50f25';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#ffd400';
    ctx.fillRect(x, y + S * 0.72, S, S * 0.1);
    txt(x + S / 2, y + S * 0.34, 'FORZA', 64, '#ffffff');
    txt(x + S / 2, y + S * 0.56, 'ROSSA', 64, '#ffffff');
  }
  // 3: yellow with red band
  if (venue === 'park') {
    const [x, y] = at(3);
    ctx.fillStyle = '#ffd400';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#c8102e';
    ctx.fillRect(x, y + S * 0.38, S, S * 0.24);
  }
  // 4–7: team flags
  // a flag for every team: primary field, secondary + accent bands, the name
  const teamFlag = (k: number, team: number) => {
    const [x, y] = at(k);
    const t = TEAMS[team % TEAMS.length];
    ctx.fillStyle = t.primary;
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = t.secondary;
    ctx.fillRect(x, y + S * 0.66, S, S * 0.18);
    ctx.fillStyle = t.accent;
    ctx.fillRect(x, y + S * 0.62, S, S * 0.04);
    ctx.save();
    ctx.font = `900 58px "Titillium Web", "Arial Narrow", Arial, sans-serif`;
    const w = ctx.measureText(t.short).width;
    const k2 = Math.min(1, (S * 0.88) / w);
    ctx.translate(x + S / 2, y + S * 0.38);
    ctx.scale(k2, 1);
    txt(0, 0, t.short, 58, t.ink);
    ctx.restore();
  };
  for (let k = 0; k < Math.min(11, TEAMS.length); k++) teamFlag(TEAM_FLAG0 + k, k);
  // chequered
  {
    const [x, y] = at(15);
    for (let i = 0; i < 8; i++)
      for (let j = 0; j < 8; j++) {
        ctx.fillStyle = (i + j) % 2 ? '#111' : '#f4f4f4';
        ctx.fillRect(x + (i * S) / 8, y + (j * S) / 8, S / 8 + 1, S / 8 + 1);
      }
  }
  return canvasTexture(canvas, true, 4);
}

function flagMaterial(tex: THREE.Texture, uniforms: { uTime: THREE.IUniform }): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.75, side: THREE.DoubleSide, map: tex });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.uniforms.uWind = weatherUniforms.uWind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nuniform vec2 uWind;\nattribute float aDesign;\nattribute float aBig;`)
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
#ifdef USE_MAP
  vMapUv = vec2( ( mod( aDesign, 4.0 ) + uv.x ) / 4.0, ( 3.0 - floor( aDesign / 4.0 ) + uv.y ) / 4.0 );
#endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  float id = float( gl_InstanceID );
  float k = uv.x;
  float ws = 1.0 + length( uWind ) * 0.15;
  float sp = mix( 6.0, 3.2, aBig ) * ws;
  float ph = uTime * sp + id * 2.1 - k * mix( 5.0, 3.0, aBig );
  float amp = mix( 0.16, 0.45, aBig );
  transformed.z += sin( ph ) * amp * k;
  transformed.y += sin( ph * 0.7 ) * amp * 0.3 * k - k * k * 0.12 * aBig;
  // hand-held flags are waved from side to side
  transformed.x += ( 1.0 - aBig ) * sin( uTime * 1.7 + id ) * 0.35 * ( position.y + 1.4 ) * 0.3;
}`,
      );
  };
  mat.customProgramCacheKey = () => 'apex-flag-v3';
  return mat;
}

// ---------------------------------------------------------------- big screens

function screenTexture(): THREE.CanvasTexture {
  const W = 512, H = 288;
  const { canvas, ctx } = canvas2d(W, H);
  // broadcast image: a car at speed through the park + timing tower
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.45);
  sky.addColorStop(0, '#6f9fd6');
  sky.addColorStop(1, '#c6d8e8');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#2f4a22';
  for (let i = 0; i < 40; i++) {
    ctx.beginPath();
    ctx.arc(i * 14 + 5, H * 0.42 - Math.sin(i * 1.7) * 8, 22, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#4c7a2e';
  ctx.fillRect(0, H * 0.45, W, H * 0.55);
  ctx.fillStyle = '#56585c';
  ctx.beginPath();
  ctx.moveTo(0, H * 0.72);
  ctx.lineTo(W, H * 0.58);
  ctx.lineTo(W, H * 0.8);
  ctx.lineTo(0, H);
  ctx.fill();
  ctx.fillStyle = '#c8102e';
  ctx.beginPath();
  ctx.ellipse(W * 0.6, H * 0.72, 70, 14, -0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#111';
  ctx.fillRect(W * 0.6 - 60, H * 0.72 - 6, 16, 22);
  ctx.fillRect(W * 0.6 + 44, H * 0.72 - 16, 16, 22);
  // timing tower
  ctx.fillStyle = 'rgba(10,12,16,0.85)';
  ctx.fillRect(10, 10, 118, 188);
  ctx.font = '700 15px "Titillium Web", Arial, sans-serif';
  ctx.textBaseline = 'middle';
  TEAMS.slice(0, 10).forEach((t, i) => {
    const y = 22 + i * 18;
    ctx.fillStyle = '#fff';
    ctx.fillText(String(i + 1), 16, y);
    ctx.fillStyle = t.primary;
    ctx.fillRect(34, y - 6, 4, 12);
    ctx.fillStyle = '#fff';
    ctx.fillText(t.short.slice(0, 3), 44, y);
    ctx.fillStyle = '#ddd';
    ctx.fillText(i === 0 ? 'LEAD' : `+${(i * 0.83 + 0.3).toFixed(1)}`, 86, y);
  });
  ctx.fillStyle = '#c8102e';
  ctx.fillRect(W - 150, H - 40, 140, 28);
  ctx.fillStyle = '#fff';
  ctx.font = '900 18px "Titillium Web", Arial, sans-serif';
  ctx.fillText('LAP 23 / 53', W - 138, H - 26);
  return canvasTexture(canvas, true, 4);
}

// ---------------------------------------------------------------- build

interface Person { m: THREE.Matrix4; c: THREE.Color; shade: number }
interface Flag { m: THREE.Matrix4; design: number; big: number }

export function buildGrandstands(layout: Layout, track: Track, map: WorldMap): GrandstandBuild {
  const group = new THREE.Group();
  group.name = 'Grandstands';
  const structure = new MeshBuilder();
  const steel = new MeshBuilder();
  const boards = new MeshBuilder();
  const glass = new MeshBuilder();
  const r = rng(2024);
  const people: Person[] = [];
  const flags: Flag[] = [];

  const reds = ['#c8102e', '#d4202c', '#a50d22', '#e53935', '#8e0c1c', '#c8102e', '#b3101f'].map((h) => new THREE.Color(h));
  const others = [
    ...TEAMS.map((t) => t.primary), '#ffd400', '#ffd400', '#ffffff', '#f2f2f2', '#1a1a1a', '#2b2b2b', '#7a7a7a', '#1b2552', '#6fa8dc', '#d9c7a0', '#2e7d32',
  ].map((h) => new THREE.Color(h));
  // Monza: a sea of red. Spa: the orange army from over the border, Belgian colours, every team's shirts
  const oranges = ['#ff7b00', '#ff8c1a', '#f26b00', '#ff9933', '#e86a10'].map((h) => new THREE.Color(h));
  const belgian = ['#1a1a1a', '#fdda24', '#ef3340'].map((h) => new THREE.Color(h));
  const brits = ['#012169', '#c8102e', '#f2f2f2', '#ff8000', '#1a3e8c'].map((h) => new THREE.Color(h));
  // Suzuka: white and Hinomaru red, the home team's blue, and team kit everywhere (Japanese fans love merch)
  const japan = ['#f4f4f4', '#ffffff', '#bc002d', '#e60012', '#1f3c88', '#0a0a0a', '#f2f2f2'].map((h) => new THREE.Color(h));
  const usa = AUSTIN_FANS.map((h) => new THREE.Color(h));
  // Spielberg: red-white-red, the Dutch orange army, Red Bull navy
  const aut = SPIELBERG_FAN_COLOURS.austria.map((h) => new THREE.Color(h));
  const rbull = SPIELBERG_FAN_COLOURS.redbull.map((h) => new THREE.Color(h));
  // Montréal: the Maple Leaf's red and white, Québec blue, Ferrari red for Gilles
  const canada = MONTREAL_FAN_COLOURS.map((h) => new THREE.Color(h));
  // Zandvoort: a sea of orange, a little red-white-blue
  const oranje = ZANDVOORT_FANS.oranje.map((h) => new THREE.Color(h));
  const holland = ZANDVOORT_FANS.holland.map((h) => new THREE.Color(h));
  const fanColor = () => {
    const q = r();
    const c =
      map.venue === 'zandvoort'
        ? q < 0.84 ? oranje[Math.floor(r() * oranje.length)] : q < 0.9 ? holland[Math.floor(r() * holland.length)] : others[Math.floor(r() * others.length)]
        : map.venue === 'interlagos'
        ? q < 0.46 ? BRAZIL_FANS[Math.floor(r() * BRAZIL_FANS.length)] : q < 0.52 ? reds[Math.floor(r() * reds.length)] : others[Math.floor(r() * others.length)]
        : map.venue === 'montreal'
        ? q < 0.34 ? canada[Math.floor(r() * canada.length)] : q < 0.46 ? reds[Math.floor(r() * reds.length)] : others[Math.floor(r() * others.length)]
        : map.venue === 'spielberg'
        ? q < 0.3 ? aut[Math.floor(r() * aut.length)] : q < 0.44 ? oranges[Math.floor(r() * oranges.length)] : q < 0.5 ? rbull[Math.floor(r() * rbull.length)] : others[Math.floor(r() * others.length)]
        : map.venue === 'austin'
        ? q < 0.4 ? usa[Math.floor(r() * usa.length)] : q < 0.46 ? reds[Math.floor(r() * reds.length)] : others[Math.floor(r() * others.length)]
        : map.venue === 'suzuka'
        ? q < 0.34 ? japan[Math.floor(r() * japan.length)] : q < 0.4 ? reds[Math.floor(r() * reds.length)] : others[Math.floor(r() * others.length)]
        : map.venue === 'airfield'
        ? q < 0.3 ? brits[Math.floor(r() * brits.length)] : q < 0.42 ? oranges[Math.floor(r() * oranges.length)] : q < 0.5 ? reds[Math.floor(r() * reds.length)] : others[Math.floor(r() * others.length)]
        : map.venue === 'ardennes'
        ? q < 0.34 ? oranges[Math.floor(r() * oranges.length)] : q < 0.44 ? belgian[Math.floor(r() * belgian.length)] : q < 0.52 ? reds[Math.floor(r() * reds.length)] : others[Math.floor(r() * others.length)]
        : q < 0.45 ? reds[Math.floor(r() * reds.length)] : others[Math.floor(r() * others.length)];
    // a good share of every crowd wears team kit
    if (q > (map.venue === 'zandvoort' ? 0.93 : 0.7)) {
      const sh = teamShirts[pickTeam()];
      return sh[Math.floor(r() * sh.length)].clone().multiplyScalar(0.85 + r() * 0.2);
    }
    return c.clone().multiplyScalar(0.82 + r() * 0.25);
  };
  // every team has its following, bigger for the big names
  const FOLLOWING = [3.2, 1.8, 1.8, 2.2, 1.1, 0.8, 0.9, 0.7, 0.7, 0.8, 0.7];
  const totalF = FOLLOWING.slice(0, TEAMS.length).reduce((a, b) => a + b, 0);
  const pickTeam = () => {
    let x = r() * totalF;
    for (let k = 0; k < TEAMS.length; k++) {
      x -= FOLLOWING[k] ?? 0.7;
      if (x <= 0) return k;
    }
    return 0;
  };
  const teamShirts = TEAMS.map((t) => [t.primary, t.primary, t.secondary].map((h) => new THREE.Color(h)));
  const flagDesign = () => {
    const q = r();
    if (q < (map.venue === 'zandvoort' ? 0.72 : 0.4)) return q < 0.18 ? 0 : q < 0.28 ? 1 : q < 0.35 ? 2 : 3;
    if (q < 0.43) return 15;
    return TEAM_FLAG0 + pickTeam();
  };

  let sponsorK = 0;
  const stands = layout.grandstands;
  stands.forEach((g: GrandstandSpec) => {
    const L = g.length;
    const rows = g.rows;
    const D = STAND_ROW_DEPTH, R = STAND_ROW_RISE;
    const z0 = 0.4;
    const yBase = 1.9;
    const centrale = g.style === 'centrale';
    const seatSet = map.venue === 'zandvoort' ? ZANDVOORT_SEATS : SEAT_SCHEMES;
    const scheme = seatSet[g.group % seatSet.length].map((h) => srgb(h));
    // row geometry: centrale has a 3.4 m hospitality band after the lower tier
    const lowerRows = centrale ? Math.round(rows * 0.45) : rows;
    const bandH = centrale ? 3.6 : 0;
    const bandD = centrale ? 2.2 : 0;
    const rowY = (i: number) => yBase + i * R + (i >= lowerRows ? bandH : 0);
    const rowZ = (i: number) => z0 + i * D + (i >= lowerRows ? bandD : 0);
    const depth = rowZ(rows - 1) + D + 0.8;
    const top = rowY(rows - 1) + R;

    const local = new MeshBuilder();
    const lsteel = new MeshBuilder();
    const lboards = new MeshBuilder();
    const lglass = new MeshBuilder();
    const standPeople: Person[] = [];
    const standFlags: Flag[] = [];
    // front wall + terraces
    local.aabb(-L / 2, -3, 0, L / 2, yBase + 0.1, z0, CONCRETE);
    for (let i = 0; i < rows; i++) {
      const y = rowY(i), za = rowZ(i);
      local.aabb(-L / 2, y - R - (i === lowerRows ? bandH : 0) - 0.25, za, L / 2, y, za + D, i % 2 ? CONCRETE : CONCRETE_DARK.clone().lerp(CONCRETE, 0.7), { skipBottom: true });
    }
    if (centrale) {
      // hospitality band: glass facade set back under the upper tier, a slab above
      const zb = rowZ(lowerRows - 1) + D;
      const yb = rowY(lowerRows - 1);
      lglass.quad4(new THREE.Vector3(L / 2, yb + 0.2, zb + 0.9), new THREE.Vector3(-L / 2, yb + 0.2, zb + 0.9), new THREE.Vector3(-L / 2, yb + bandH - 0.3, zb + 0.9), new THREE.Vector3(L / 2, yb + bandH - 0.3, zb + 0.9), new THREE.Color(1, 1, 1));
      local.aabb(-L / 2, yb + bandH - 0.35, zb - 0.2, L / 2, yb + bandH + 0.05, zb + bandD, CONCRETE);
      local.aabb(-L / 2, yb, zb, L / 2, yb + 0.2, zb + 1.2, CONCRETE_DARK);
      // mullions + balcony rail
      for (let x = -L / 2; x <= L / 2; x += 3) lsteel.aabb(x - 0.06, yb + 0.2, zb + 0.82, x + 0.06, yb + bandH - 0.3, zb + 0.95, STEEL_DARK);
      lsteel.aabb(-L / 2, yb + 1.0, zb - 0.05, L / 2, yb + 1.08, zb + 0.05, STEEL);
      // sponsor band on the slab edge
      const nB = Math.max(1, Math.round(L / 20));
      for (let k = 0; k < nB; k++) {
        const xa = -L / 2 + (k * L) / nB + 0.2, xb = xa + L / nB - 0.4;
        lboards.quad4(new THREE.Vector3(xb, yb + bandH - 0.33, zb - 0.22), new THREE.Vector3(xa, yb + bandH - 0.33, zb - 0.22), new THREE.Vector3(xa, yb + bandH + 0.03, zb - 0.22), new THREE.Vector3(xb, yb + bandH + 0.03, zb - 0.22), new THREE.Color(1, 1, 1), sponsorUV(sponsorK++));
      }
    }
    // back wall & sloped side walls
    local.aabb(-L / 2, -3, depth - 0.45, L / 2, top + 1.3, depth, CONCRETE_DARK);
    // the outside of the back wall (seen from the infield, the paddock and the TV towers):
    // a steel frame, floor ledges, stair towers and entrances, sponsor boards facing out
    {
      const zo = depth;
      const nCol = Math.max(2, Math.round(L / 7) + 1);
      for (let k = 0; k < nCol; k++) {
        const x = -L / 2 + (k * L) / (nCol - 1);
        lsteel.aabb(x - 0.22, -3, zo, x + 0.22, top + 1.3, zo + 0.35, STEEL_DARK);
      }
      for (const yl of [yBase + 0.2, top * 0.55]) local.aabb(-L / 2, yl, zo, L / 2, yl + 0.35, zo + 0.45, CONCRETE);
      local.aabb(-L / 2, top + 1.0, zo, L / 2, top + 1.45, zo + 0.5, CONCRETE);
      // entrances at the foot, between the columns
      const nDoor = Math.max(1, Math.round(L / 26));
      for (let k = 0; k < nDoor; k++) {
        const x = -L / 2 + ((k + 0.5) * L) / nDoor;
        local.aabb(x - 1.6, 0, zo + 0.01, x + 1.6, 2.6, zo + 0.06, srgb(0x1c1e22));
        lsteel.aabb(x - 1.8, 2.6, zo, x + 1.8, 2.85, zo + 0.9, STEEL);
      }
      // stair towers at the ends
      for (const sx of [-1, 1]) {
        const xs = sx * (L / 2 - 2.2);
        lsteel.aabb(xs - 1.6, -3, zo + 0.35, xs + 1.6, top + 1.2, zo + 3.2, STEEL_DARK.clone().lerp(STEEL, 0.4));
        for (let y = 2; y < top; y += 2.6) lsteel.aabb(xs - 1.7, y, zo + 3.15, xs + 1.7, y + 0.12, zo + 3.3, STEEL);
      }
      // sponsor boards on the upper back wall, facing outward
      if (top > 6) {
        const nB = Math.max(1, Math.round(L / 24));
        const w = L / nB;
        const y0 = top * 0.55 + 1.0, y1 = Math.min(top + 0.6, y0 + 3.2);
        for (let k = 0; k < nB; k++) {
          const xa = -L / 2 + k * w + 1.2, xb = xa + w - 2.4;
          if (xb - xa < 4) continue;
          lboards.quad4(new THREE.Vector3(xa, y0, zo + 0.4), new THREE.Vector3(xb, y0, zo + 0.4), new THREE.Vector3(xb, y1, zo + 0.4), new THREE.Vector3(xa, y1, zo + 0.4), new THREE.Color(1, 1, 1), sponsorUV(sponsorK++));
        }
      }
    }
    for (const sx of [-1, 1]) {
      const x0 = sx < 0 ? -L / 2 - 0.4 : L / 2;
      local.prismX([[-0.05, -3], [depth + 0.05, -3], [depth + 0.05, top + 1.4], [-0.05, yBase + 0.9]], x0, x0 + 0.4, CONCRETE_DARK);
    }
    // seat blocks with aisles every ~26 m, crowd, flags
    const blocks = Math.max(1, Math.round(L / 26));
    const bw = L / blocks;
    const occ = centrale ? 0.94 : g.style === 'covered' ? 0.9 : 0.86;
    for (let b = 0; b < blocks; b++) {
      const xa = -L / 2 + b * bw + 0.7;
      const xb = -L / 2 + (b + 1) * bw - 0.7;
      for (let i = 0; i < rows; i++) {
        const y = rowY(i), za = rowZ(i);
        const c = scheme[(b + (i > rows * 0.6 ? 1 : 0) + (i >= lowerRows ? 2 : 0)) % scheme.length];
        local.aabb(xa, y, za + D * 0.58, xb, y + 0.42, za + D * 0.72, c, { skipBottom: true });
        for (let x = xa + 0.3; x < xb - 0.3; x += 0.6) {
          if (r() > occ) continue;
          const m = new THREE.Matrix4().makeTranslation(x + (r() - 0.5) * 0.12, y + 0.02, za + D * 0.42);
          const covered = g.roof && i > 2 ? 0.6 + 0.1 * r() : 1;
          standPeople.push({ m, c: fanColor(), shade: covered });
          if (r() < 0.016) standFlags.push({ m: new THREE.Matrix4().makeTranslation(x, y + 1.9, za + D * 0.3), design: flagDesign(), big: 0 });
        }
      }
      if (b > 0) {
        const xa2 = -L / 2 + b * bw - 0.7;
        for (let i = 0; i < rows; i++) local.aabb(xa2, rowY(i), rowZ(i), xa2 + 1.4, rowY(i) + 0.02, rowZ(i) + D, srgb(0xd8d4cc), { skipBottom: true });
      }
    }
    // tifosi banners hung on the front wall
    {
      const nB = Math.max(1, Math.round(L / 16));
      const w = L / nB;
      for (let k = 0; k < nB; k++) {
        const xa = -L / 2 + k * w + 0.15, xb = xa + w - 0.3;
        lboards.quad4(new THREE.Vector3(xb, 0.4, -0.02), new THREE.Vector3(xa, 0.4, -0.02), new THREE.Vector3(xa, 1.6, -0.02), new THREE.Vector3(xb, 1.6, -0.02), new THREE.Color(1, 1, 1), sponsorUV(sponsorK++));
      }
    }
    // roof
    if (g.roof) {
      const over = centrale ? 5.5 : 3.2;
      const yBack = top + (centrale ? 4.2 : 3.4);
      const yFront = top + (centrale ? 6.6 : 5.4);
      const zFront = centrale ? -4.5 : -2.2;
      const zBack = depth + 0.6;
      const thick = centrale ? 0.9 : 0.35;
      lsteel.prismX([[zFront, yFront - thick], [zBack, yBack - thick], [zBack, yBack], [zFront, yFront]], -L / 2 - 1, L / 2 + 1, STEEL);
      const nCol = Math.max(2, Math.round(L / 14) + 1);
      for (let k = 0; k < nCol; k++) {
        const x = -L / 2 + (k * L) / (nCol - 1);
        lsteel.aabb(x - 0.3, top + 1.2, depth - 0.35, x + 0.3, yBack - 0.3, depth + 0.25, STEEL_DARK);
        lsteel.prismX([[zFront + 0.4, yFront - thick - 0.4], [zBack - 0.2, yBack - 1.3], [zBack - 0.2, yBack - thick], [zFront + 0.4, yFront - thick]], x - 0.15, x + 0.15, STEEL_DARK);
        lsteel.prismX([[depth * 0.55, top * 0.6], [depth * 0.55 + 0.25, top * 0.6], [zBack - 0.2, yBack - 1.3], [zBack - 0.45, yBack - 1.3]], x - 0.08, x + 0.08, STEEL_DARK);
      }
      // fascia with sponsors
      const nB = Math.max(1, Math.round(L / 22));
      const w = (L + 2) / nB;
      const fh = centrale ? 2.6 : 1.9;
      for (let k = 0; k < nB; k++) {
        const xa = -L / 2 - 1 + k * w, xb = xa + w;
        lboards.quad4(new THREE.Vector3(xb, yFront - fh, zFront - 0.05), new THREE.Vector3(xa, yFront - fh, zFront - 0.05), new THREE.Vector3(xa, yFront + 0.15, zFront - 0.05), new THREE.Vector3(xb, yFront + 0.15, zFront - 0.05), new THREE.Color(1, 1, 1), sponsorUV(sponsorK++));
      }
      lsteel.aabb(-L / 2 - 1, yFront - fh - 0.05, zFront - 0.02, L / 2 + 1, yFront + 0.2, zFront + 0.3, STEEL_DARK);
      void over;
    } else {
      // open stand: light towers at the ends and a rail at the back
      lsteel.aabb(-L / 2, top + 0.2, depth - 0.3, L / 2, top + 1.2, depth - 0.2, STEEL);
      for (const sx of [-1, 1]) lsteel.aabb(sx * L / 2 - 0.25, 0, depth - 0.2, sx * L / 2 + 0.25, top + 6, depth + 0.3, STEEL_DARK);
    }

    // place: local −z faces the track
    const front = g.center.clone().addScaledVector(g.facing, g.depth / 2);
    const zAxis = g.facing.clone().negate();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
    const M = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis).setPosition(front.x, g.y0, front.z);
    local.transform(M);
    lsteel.transform(M);
    lboards.transform(M);
    lglass.transform(M);
    structure.append(local);
    steel.append(lsteel);
    boards.append(lboards);
    glass.append(lglass);
    for (const p of standPeople) {
      p.m.premultiply(M);
      people.push(p);
    }
    for (const f of standFlags) {
      f.m.premultiply(M);
      flags.push(f);
    }
  });

  // ---------------------------------------------------------------- flagpoles behind the stands
  for (const fp of layout.flagpoles) {
    const y = map.height(fp.x, fp.z);
    const H = 11 + r() * 3;
    const m = new THREE.Matrix4().makeTranslation(fp.x, y, fp.z);
    steel.box(new THREE.Matrix4().makeScale(0.16, H, 0.16).setPosition(fp.x, y + H / 2, fp.z), STEEL);
    const fm = new THREE.Matrix4().makeRotationY(r() * Math.PI * 2).setPosition(fp.x, y + H - 1.6, fp.z);
    fm.multiply(new THREE.Matrix4().makeScale(2.6, 2.6, 2.6));
    flags.push({ m: fm, design: flagDesign(), big: 1 });
    void m;
  }

  // ---------------------------------------------------------------- big screens
  const screenMB = new MeshBuilder();
  for (const sc of layout.screens as ScreenSpec[]) {
    const lsteel = new MeshBuilder();
    const lscr = new MeshBuilder();
    const bottom = 5.5;
    lsteel.aabb(-sc.w / 2 - 0.4, bottom - 0.4, -0.5, sc.w / 2 + 0.4, bottom + sc.h + 0.4, 0.1, STEEL_DARK);
    for (const sx of [-1, 1]) lsteel.aabb(sx * sc.w * 0.3 - 0.3, -1, -0.8, sx * sc.w * 0.3 + 0.3, bottom, -0.2, STEEL_DARK);
    // the back: a truss frame, a walkway and the electronics cabinets (not a blank slab)
    for (let k = 0; k <= 4; k++) {
      const y = bottom - 0.2 + (k / 4) * (sc.h + 0.2);
      lsteel.aabb(-sc.w / 2 - 0.3, y - 0.09, -0.95, sc.w / 2 + 0.3, y + 0.09, -0.75, STEEL);
    }
    const nV = Math.max(3, Math.round(sc.w / 2.2));
    for (let k = 0; k <= nV; k++) {
      const x = -sc.w / 2 + (k / nV) * sc.w;
      lsteel.aabb(x - 0.08, bottom - 0.3, -0.95, x + 0.08, bottom + sc.h + 0.2, -0.75, STEEL);
    }
    lsteel.aabb(-sc.w / 2, bottom - 0.5, -1.9, sc.w / 2, bottom - 0.38, -0.5, STEEL_DARK);
    for (const sx of [-0.25, 0.25]) lsteel.aabb(sx * sc.w - 0.6, bottom - 0.38, -1.7, sx * sc.w + 0.6, bottom + 1.6, -1.0, srgb(0x9aa0a8));
    lscr.quad4(new THREE.Vector3(-sc.w / 2, bottom, 0.12), new THREE.Vector3(sc.w / 2, bottom, 0.12), new THREE.Vector3(sc.w / 2, bottom + sc.h, 0.12), new THREE.Vector3(-sc.w / 2, bottom + sc.h, 0.12), new THREE.Color(1, 1, 1));
    const M = new THREE.Matrix4().makeRotationY(sc.rot).setPosition(sc.x, map.height(sc.x, sc.z), sc.z);
    lsteel.transform(M);
    lscr.transform(M);
    steel.append(lsteel);
    screenMB.append(lscr);
  }

  // ---------------------------------------------------------------- fans on the grass banks
  for (const b of layout.banks as SpectatorBank[]) {
    const f = track.frame(b.sA);
    const p = new THREE.Vector3();
    for (let s = b.sA; s <= b.sB; s += 0.7) {
      track.frame(s, f);
      const lo = Math.min(Math.abs(b.latA), Math.abs(b.latB)), hi = Math.max(Math.abs(b.latA), Math.abs(b.latB));
      // denser near the fence, thinning up the bank
      for (let q = 0; q < 3; q++) {
        const u = Math.pow(r(), 1.7);
        if (r() > b.density * (1 - u * 0.6)) continue;
        const lat = b.side * (lo + 0.8 + u * (hi - lo - 1.6));
        track.point(s + (r() - 0.5) * 0.6, lat, 0, p);
        const y = map.height(p.x, p.z);
        const face = Math.atan2(-f.right.x * b.side, -f.right.z * b.side) + (r() - 0.5) * 0.7;
        const sc = 1.25 + r() * 0.12;
        const m = new THREE.Matrix4().makeRotationY(face + Math.PI).setPosition(p.x, y, p.z);
        m.multiply(new THREE.Matrix4().makeScale(sc, sc, sc));
        people.push({ m, c: fanColor(), shade: 1 });
        if (r() < 0.03) {
          const fm = new THREE.Matrix4().makeRotationY(face + Math.PI).setPosition(p.x, y + 2.3, p.z);
          flags.push({ m: fm, design: flagDesign(), big: 0 });
        }
      }
    }
  }

  // ---------------------------------------------------------------- meshes
  const structMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  const steelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.35 });
  const boardTex = sponsorTexture();
  const boardMat = new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.55, metalness: 0, emissiveMap: boardTex, emissive: 0xffffff, emissiveIntensity: 0.14 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a2430, roughness: 0.06, metalness: 0.85 });
  const scrTex = screenTexture();
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.3, emissiveMap: scrTex, emissive: 0xffffff, emissiveIntensity: 1.6 });
  const add = (mb: MeshBuilder, mat: THREE.Material, name: string, cast: boolean) => {
    if (mb.vertexCount === 0) return;
    const g = mb.geometry(false);
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    m.castShadow = cast;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
  };
  add(structure, structMat, 'stands_structure', true);
  add(steel, steelMat, 'stands_steel', true);
  add(boards, boardMat, 'stands_boards', false);
  add(glass, glassMat, 'stands_glass', false);
  add(screenMB, screenMat, 'big_screens', false);

  // crowd
  const uniforms = { uTime: { value: 0 } };
  const personGeo = new THREE.PlaneGeometry(0.62, 1.24);
  personGeo.translate(0, 0.62, 0);
  personGeo.rotateY(Math.PI);
  const nrm = personGeo.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 0.55, -0.83);
  const shade = new Float32Array(people.length);
  people.forEach((p, i) => (shade[i] = p.shade));
  personGeo.setAttribute('aShade', new THREE.InstancedBufferAttribute(shade, 1));
  const atlas = crowdAtlas();
  const crowd = new THREE.InstancedMesh(personGeo, crowdMaterial(atlas.tex, uniforms, atlas.variants), Math.max(1, people.length));
  people.forEach((p, i) => {
    crowd.setMatrixAt(i, p.m);
    crowd.setColorAt(i, p.c);
  });
  crowd.count = people.length;
  crowd.instanceMatrix.needsUpdate = true;
  if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
  crowd.computeBoundingSphere();
  crowd.name = 'crowd';
  crowd.receiveShadow = true;
  group.add(crowd);

  // flags
  const flagGeo = new THREE.PlaneGeometry(1.4, 0.92, 8, 2);
  flagGeo.translate(0.7, 0, 0);
  const design = new Float32Array(Math.max(1, flags.length));
  const big = new Float32Array(Math.max(1, flags.length));
  flags.forEach((f, i) => {
    design[i] = f.design;
    big[i] = f.big;
  });
  flagGeo.setAttribute('aDesign', new THREE.InstancedBufferAttribute(design, 1));
  flagGeo.setAttribute('aBig', new THREE.InstancedBufferAttribute(big, 1));
  const flagMesh = new THREE.InstancedMesh(flagGeo, flagMaterial(flagAtlas(map.venue), uniforms), Math.max(1, flags.length));
  flags.forEach((f, i) => flagMesh.setMatrixAt(i, f.m));
  flagMesh.count = flags.length;
  flagMesh.instanceMatrix.needsUpdate = true;
  flagMesh.computeBoundingSphere();
  flagMesh.name = 'flags';
  group.add(flagMesh);

  // venue landmarks (Ferris wheel, crossover bridge, hospitality, camera towers…)
  group.add(buildLandmarks(layout, track, map).group);

  return {
    group,
    people: people.length,
    flags: flags.length,
    update(t: number) {
      uniforms.uTime.value = t;
    },
  };
}
