import * as THREE from 'three';
import { MeshBuilder, srgb } from './geom.ts';
import type { GrandstandSpec, Layout, ScreenSpec, SpectatorBank } from './layout.ts';
import { STAND_ROW_DEPTH, STAND_ROW_RISE } from './layout.ts';
import { sponsorTexture, sponsorUV } from './signage.ts';
import { TEAMS } from '../../race/Teams.ts';
import { canvas2d, canvasTexture } from './textures.ts';
import { rng } from './noise.ts';
import { weatherUniforms } from '../weatherUniforms.ts';
import type { Track } from '../Track.ts';
import type { WorldMap } from './worldmap.ts';

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

// ---------------------------------------------------------------- crowd atlas + material

function crowdAtlas(): THREE.CanvasTexture {
  const CW = 64, CH = 128, COLS = 8, ROWS = 2;
  const { canvas, ctx } = canvas2d(CW * COLS, CH * ROWS);
  const r = rng(99);
  const skins = ['#f1c9a5', '#d9a47a', '#b07a52', '#7a4e32', '#e8b890', '#c68d63'];
  const hairs = ['#2a1d14', '#5a3a22', '#b08850', '#141414', '#7d6a55', '#8a2a1a'];
  const caps = ['#c8102e', '#c8102e', '#ffffff', '#ffd400', '#111111', '#c8102e'];
  for (let col = 0; col < COLS; col++) {
    const skin = skins[Math.floor(r() * skins.length)];
    const hair = hairs[Math.floor(r() * hairs.length)];
    const cap = r() < 0.45 ? caps[Math.floor(r() * caps.length)] : null;
    const broad = 0.85 + r() * 0.3;
    for (let row = 0; row < ROWS; row++) {
      const ox = col * CW, oy = row * CH;
      const cx = ox + CW / 2;
      ctx.fillStyle = r() < 0.5 ? '#2b3140' : '#4a4038';
      ctx.fillRect(cx - 18 * broad, oy + 100, 36 * broad, 28);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(cx - 13 * broad, oy + 40);
      ctx.lineTo(cx + 13 * broad, oy + 40);
      ctx.lineTo(cx + 17 * broad, oy + 104);
      ctx.lineTo(cx - 17 * broad, oy + 104);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      if (row === 0) {
        ctx.beginPath();
        ctx.moveTo(cx - 15 * broad, oy + 46);
        ctx.lineTo(cx - 19 * broad, oy + 78);
        ctx.moveTo(cx + 15 * broad, oy + 46);
        ctx.lineTo(cx + 19 * broad, oy + 78);
        ctx.stroke();
        ctx.strokeStyle = skin;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(cx - 19 * broad, oy + 78);
        ctx.lineTo(cx - 12, oy + 96);
        ctx.moveTo(cx + 19 * broad, oy + 78);
        ctx.lineTo(cx + 12, oy + 96);
        ctx.stroke();
      } else {
        const both = col % 2 === 0;
        ctx.beginPath();
        ctx.moveTo(cx + 14 * broad, oy + 46);
        ctx.lineTo(cx + 22, oy + 26);
        if (both) {
          ctx.moveTo(cx - 14 * broad, oy + 46);
          ctx.lineTo(cx - 22, oy + 26);
        } else {
          ctx.moveTo(cx - 15 * broad, oy + 46);
          ctx.lineTo(cx - 19 * broad, oy + 78);
        }
        ctx.stroke();
        ctx.strokeStyle = skin;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(cx + 22, oy + 26);
        ctx.lineTo(cx + 25, oy + 6);
        if (both) {
          ctx.moveTo(cx - 22, oy + 26);
          ctx.lineTo(cx - 25, oy + 6);
        }
        ctx.stroke();
      }
      ctx.fillStyle = skin;
      ctx.fillRect(cx - 4, oy + 32, 8, 10);
      ctx.beginPath();
      ctx.ellipse(cx, oy + 25, 10, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = cap ?? hair;
      ctx.beginPath();
      ctx.ellipse(cx, oy + 19, 11, cap ? 8 : 9, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      if (cap) ctx.fillRect(cx - 12, oy + 17, 24, 4);
      if (r() < 0.3) {
        ctx.fillStyle = '#111';
        ctx.fillRect(cx - 8, oy + 23, 16, 4);
      }
    }
  }
  return canvasTexture(canvas, true, 4);
}

function crowdMaterial(atlas: THREE.Texture, uniforms: { uTime: THREE.IUniform }): THREE.MeshStandardMaterial {
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
  float variant = floor( h11( id ) * 8.0 );
  float excite = h11( id + 17.0 );
  // waves roll along the stands; some fans are always on their feet
  float wave = step( 0.9, sin( uTime * ( 0.35 + excite * 0.4 ) + id * 1.37 ) ) * step( 0.35, excite );
  float bob = sin( uTime * ( 3.0 + excite * 4.0 ) + id ) * 0.025 * step( 0.55, excite ) + wave * 0.08;
  transformed.y += bob * ( position.y + 0.1 );
  transformed.x += sin( uTime * 0.8 + id * 3.1 ) * 0.02 * position.y;
  vCrowdUv = vec2( ( variant + uv.x ) / 8.0, ( ( 1.0 - wave ) + uv.y ) / 2.0 );
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
  float shirt = smoothstep( 0.8, 0.97, min( min( t.r, t.g ), t.b ) );
  #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR )
    vec3 tint = vColor.rgb;
  #else
    vec3 tint = vec3( 1.0 );
  #endif
  diffuseColor.rgb = mix( t.rgb, tint, shirt ) * vShade;
  diffuseColor.a = t.a;
}`,
      )
      .replace('#include <color_fragment>', '');
  };
  mat.customProgramCacheKey = () => 'apex-crowd-v2';
  return mat;
}

// ---------------------------------------------------------------- flags

const FLAG_DESIGNS = 8;

function flagAtlas(): THREE.CanvasTexture {
  const S = 256;
  const { canvas, ctx } = canvas2d(S * 4, S * 2);
  const at = (k: number) => [(k % 4) * S, Math.floor(k / 4) * S] as const;
  const txt = (x: number, y: number, s: string, size: number, col: string) => {
    ctx.fillStyle = col;
    ctx.font = `900 ${size}px "Titillium Web", "Arial Narrow", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s, x, y);
  };
  // 0: tifosi red, yellow disc with a black "R"
  {
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
  {
    const [x, y] = at(1);
    for (const [k, c] of ['#009246', '#f1f2f1', '#ce2b37'].entries()) {
      ctx.fillStyle = c;
      ctx.fillRect(x + (k * S) / 3, y, S / 3 + 1, S);
    }
  }
  // 2: FORZA ROSSA banner flag
  {
    const [x, y] = at(2);
    ctx.fillStyle = '#b50f25';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#ffd400';
    ctx.fillRect(x, y + S * 0.72, S, S * 0.1);
    txt(x + S / 2, y + S * 0.34, 'FORZA', 64, '#ffffff');
    txt(x + S / 2, y + S * 0.56, 'ROSSA', 64, '#ffffff');
  }
  // 3: yellow with red band
  {
    const [x, y] = at(3);
    ctx.fillStyle = '#ffd400';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#c8102e';
    ctx.fillRect(x, y + S * 0.38, S, S * 0.24);
  }
  // 4–7: team flags
  const teamFlag = (k: number, team: number) => {
    const [x, y] = at(k);
    const t = TEAMS[team % TEAMS.length];
    ctx.fillStyle = t.primary;
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = t.accent;
    ctx.fillRect(x, y + S * 0.7, S, S * 0.12);
    txt(x + S / 2, y + S * 0.42, t.short, 58, t.ink);
  };
  teamFlag(4, 2);
  teamFlag(5, 3);
  teamFlag(6, 1);
  teamFlag(7, 5);
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
  vMapUv = vec2( ( mod( aDesign, 4.0 ) + uv.x ) / 4.0, ( 1.0 - floor( aDesign / 4.0 ) + uv.y ) / 2.0 );
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
  mat.customProgramCacheKey = () => 'apex-flag-v2';
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
  const fanColor = () => {
    const c = r() < 0.55 ? reds[Math.floor(r() * reds.length)] : others[Math.floor(r() * others.length)];
    return c.clone().multiplyScalar(0.82 + r() * 0.25);
  };
  const flagDesign = () => {
    const q = r();
    return q < 0.42 ? 0 : q < 0.6 ? 1 : q < 0.76 ? 2 : q < 0.84 ? 3 : 4 + Math.floor(r() * 4);
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
    const scheme = SEAT_SCHEMES[g.group % SEAT_SCHEMES.length].map((h) => srgb(h));
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
  const crowd = new THREE.InstancedMesh(personGeo, crowdMaterial(crowdAtlas(), uniforms), Math.max(1, people.length));
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
  const flagMesh = new THREE.InstancedMesh(flagGeo, flagMaterial(flagAtlas(), uniforms), Math.max(1, flags.length));
  flags.forEach((f, i) => flagMesh.setMatrixAt(i, f.m));
  flagMesh.count = flags.length;
  flagMesh.instanceMatrix.needsUpdate = true;
  flagMesh.computeBoundingSphere();
  flagMesh.name = 'flags';
  group.add(flagMesh);

  return {
    group,
    people: people.length,
    flags: flags.length,
    update(t: number) {
      uniforms.uTime.value = t;
    },
  };
}
