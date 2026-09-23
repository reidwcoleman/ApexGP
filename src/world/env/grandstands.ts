import * as THREE from 'three';
import { MeshBuilder, srgb } from './geom.ts';
import type { GrandstandSpec } from './layout.ts';
import { STAND_ROW_DEPTH, STAND_ROW_RISE } from './layout.ts';
import { sponsorTexture, sponsorUV, SPONSORS } from './signage.ts';
import { TEAMS } from '../../race/Teams.ts';
import { canvas2d, canvasTexture } from './textures.ts';
import { rng } from './noise.ts';

/**
 * Covered grandstands (stepped concrete terraces, coloured seat rows, steel
 * columns, cantilever roof with a sponsor fascia) and their crowds: thousands of
 * instanced people cards (canvas atlas, shirt tinted per instance, idle bob and
 * the odd wave), plus waving flags.
 */

export interface GrandstandBuild {
  group: THREE.Group;
  update(t: number): void;
  people: number;
}

const CONCRETE = srgb(0xbdb8ae);
const CONCRETE_DARK = srgb(0x8d8a84);
const STEEL = srgb(0xe8e9eb);
const STEEL_DARK = srgb(0x5b5f66);
const SEAT_SCHEMES: number[][] = [
  [0xc8102e, 0xd9d9d9, 0xc8102e, 0x1b2552],
  [0x0a5cc2, 0x1b2552, 0x0a5cc2, 0xd9d9d9],
  [0x00574b, 0xcedc00, 0x00574b, 0x2a2a2a],
  [0xff7a00, 0x2a2a2a, 0xff7a00, 0xd9d9d9],
  [0x5b2c83, 0xd9d9d9, 0x5b2c83, 0x0a5cc2],
];

function crowdAtlas(): THREE.CanvasTexture {
  const CW = 64, CH = 128, COLS = 8, ROWS = 2;
  const { canvas, ctx } = canvas2d(CW * COLS, CH * ROWS);
  const r = rng(99);
  const skins = ['#f1c9a5', '#d9a47a', '#b07a52', '#7a4e32', '#e8b890', '#c68d63'];
  const hairs = ['#2a1d14', '#5a3a22', '#b08850', '#141414', '#7d6a55', '#8a2a1a'];
  const caps = ['#c8102e', '#ffffff', '#0a5cc2', '#ff7a00', '#111111', '#ffd400'];
  for (let col = 0; col < COLS; col++) {
    const skin = skins[Math.floor(r() * skins.length)];
    const hair = hairs[Math.floor(r() * hairs.length)];
    const cap = r() < 0.35 ? caps[Math.floor(r() * caps.length)] : null;
    const broad = 0.85 + r() * 0.3;
    for (let row = 0; row < ROWS; row++) {
      const ox = col * CW, oy = row * CH;
      const cx = ox + CW / 2;
      // legs / lap (dark, mostly hidden by the row in front)
      ctx.fillStyle = r() < 0.5 ? '#2b3140' : '#4a4038';
      ctx.fillRect(cx - 18 * broad, oy + 100, 36 * broad, 28);
      // torso = shirt (pure white → tinted in the shader)
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(cx - 13 * broad, oy + 40);
      ctx.lineTo(cx + 13 * broad, oy + 40);
      ctx.lineTo(cx + 17 * broad, oy + 104);
      ctx.lineTo(cx - 17 * broad, oy + 104);
      ctx.closePath();
      ctx.fill();
      // arms
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
        // one or both arms raised
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
      // neck + head
      ctx.fillStyle = skin;
      ctx.fillRect(cx - 4, oy + 32, 8, 10);
      ctx.beginPath();
      ctx.ellipse(cx, oy + 25, 10, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      // hair / cap
      ctx.fillStyle = cap ?? hair;
      ctx.beginPath();
      ctx.ellipse(cx, oy + 19, 11, cap ? 8 : 9, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      if (cap) ctx.fillRect(cx - 12, oy + 17, 24, 4);
      // sunglasses on some
      if (r() < 0.3) {
        ctx.fillStyle = '#111';
        ctx.fillRect(cx - 8, oy + 23, 16, 4);
      }
    }
  }
  const tex = canvasTexture(canvas, true, 4);
  return tex;
}

function crowdMaterial(atlas: THREE.Texture, uniforms: { uTime: THREE.IUniform }): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.5 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uCrowd = { value: atlas };
    sh.uniforms.uTime = uniforms.uTime;
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
  // occasional wave / arms-up
  float wave = step( 0.93, sin( uTime * ( 0.35 + excite * 0.4 ) + id * 1.37 ) ) * step( 0.4, excite );
  float bob = sin( uTime * ( 3.0 + excite * 4.0 ) + id ) * 0.025 * step( 0.6, excite ) + wave * 0.08;
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
  #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
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
  mat.customProgramCacheKey = () => 'apex-crowd';
  return mat;
}

function flagMaterial(uniforms: { uTime: THREE.IUniform }): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.7, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nvarying vec2 vFlagUv;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  float id = float( gl_InstanceID );
  float k = uv.x;
  float ph = uTime * 6.0 + id * 2.1 - k * 5.0;
  transformed.z += sin( ph ) * 0.18 * k;
  transformed.y += sin( ph * 0.7 ) * 0.05 * k;
  // pole sway (held by a fan)
  transformed.x += sin( uTime * 1.7 + id ) * 0.25 * ( position.y + 1.5 ) * 0.3;
  vFlagUv = uv;
}`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vFlagUv;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  float band = step( 0.33, vFlagUv.y ) * step( vFlagUv.y, 0.66 );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.9 ), band * 0.85 );`,
      );
  };
  mat.customProgramCacheKey = () => 'apex-flag';
  return mat;
}

export function buildGrandstands(stands: GrandstandSpec[], heightAt: (x: number, z: number) => number, trackHeight: (x: number, z: number) => number): GrandstandBuild {
  const group = new THREE.Group();
  group.name = 'Grandstands';
  const structure = new MeshBuilder();
  const steel = new MeshBuilder();
  const boards = new MeshBuilder();
  const r = rng(2024);

  // crowd instances
  const people: { m: THREE.Matrix4; c: THREE.Color; shade: number }[] = [];
  const flags: { m: THREE.Matrix4; c: THREE.Color }[] = [];
  // team colours (dark/pale liveries swapped for their accent) + everyday clothing
  const teamCols = TEAMS.map((t) => {
    const c = new THREE.Color(t.primary);
    const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
    return l > 0.55 || l < 0.02 ? t.accent : t.primary;
  });
  const fanColors = [
    ...teamCols, ...teamCols,
    '#c8102e', '#c8102e', '#c8102e', '#ff7a00', '#ffd400', '#0a5cc2', '#1b2552', '#00574b', '#6fa8dc',
    '#ffffff', '#f2f2f2', '#1a1a1a', '#2b2b2b', '#7a7a7a', '#e05c8a', '#8fbc5a', '#d9c7a0', '#5b2c83',
  ].map((h) => new THREE.Color(h));

  let sponsorK = 0;
  stands.forEach((g, gi) => {
    const L = g.length;
    const rows = g.rows;
    const D = STAND_ROW_DEPTH, R = STAND_ROW_RISE;
    const z0 = 0.4; // front wall thickness
    const yBase = 1.7; // first tread above the base (clears fences)
    const depth = z0 + rows * D + 0.8;
    const top = yBase + rows * R;
    const scheme = SEAT_SCHEMES[gi % SEAT_SCHEMES.length].map((h) => srgb(h));

    const local = new MeshBuilder();
    const lsteel = new MeshBuilder();
    const lboards = new MeshBuilder();
    const standPeople: { m: THREE.Matrix4; c: THREE.Color; shade: number }[] = [];
    const standFlags: { m: THREE.Matrix4; c: THREE.Color }[] = [];
    // front wall + terraces
    local.aabb(-L / 2, -4, 0, L / 2, yBase + 0.1, z0, CONCRETE);
    for (let i = 0; i < rows; i++) {
      const y = yBase + i * R;
      const za = z0 + i * D;
      local.aabb(-L / 2, y - R - 0.25, za, L / 2, y, za + D, i % 2 ? CONCRETE : CONCRETE_DARK.clone().lerp(CONCRETE, 0.7), { skipBottom: true });
    }
    // back wall & side walls (sloped)
    local.aabb(-L / 2, -4, depth - 0.45, L / 2, top + 1.3, depth, CONCRETE_DARK);
    for (const sx of [-1, 1]) {
      const x0 = sx < 0 ? -L / 2 - 0.4 : L / 2;
      local.prismX([[-0.05, -4], [depth + 0.05, -4], [depth + 0.05, top + 1.4], [-0.05, yBase + 0.9]], x0, x0 + 0.4, CONCRETE_DARK);
    }
    // seat rows in colour blocks, aisles every ~28 m
    const blocks = Math.max(1, Math.round(L / 28));
    const bw = L / blocks;
    for (let b = 0; b < blocks; b++) {
      const xa = -L / 2 + b * bw + 0.7;
      const xb = -L / 2 + (b + 1) * bw - 0.7;
      for (let i = 0; i < rows; i++) {
        const y = yBase + i * R;
        const za = z0 + i * D;
        const c = scheme[(b + (i > rows * 0.6 ? 1 : 0)) % scheme.length];
        local.aabb(xa, y, za + D * 0.58, xb, y + 0.42, za + D * 0.72, c, { skipBottom: true });
        // crowd
        const occ = gi === 0 ? 0.9 : 0.82;
        const pitch = 0.62;
        for (let x = xa + 0.3; x < xb - 0.3; x += pitch) {
          if (r() > occ) continue;
          const m = new THREE.Matrix4().makeTranslation(x + (r() - 0.5) * 0.12, y + 0.02, za + D * 0.42);
          const c2 = fanColors[Math.floor(r() * fanColors.length)].clone().multiplyScalar(0.85 + r() * 0.2);
          const covered = g.roof && i > 2 ? 0.62 + 0.1 * r() : 1;
          standPeople.push({ m, c: c2, shade: covered });
          if (r() < 0.012) standFlags.push({ m: new THREE.Matrix4().makeTranslation(x, y + 1.9, za + D * 0.3), c: fanColors[Math.floor(r() * fanColors.length)].clone() });
        }
      }
      // aisle stairs (lighter concrete)
      if (b > 0) {
        const xa2 = -L / 2 + b * bw - 0.7;
        for (let i = 0; i < rows; i++) {
          const y = yBase + i * R;
          const za = z0 + i * D;
          local.aabb(xa2, y, za, xa2 + 1.4, y + 0.02, za + D, srgb(0xd8d4cc), { skipBottom: true });
        }
      }
    }
    // front sponsor band on the parapet (faces the track = local −z)
    {
      const nB = Math.max(1, Math.round(L / 18));
      const w = L / nB;
      for (let k = 0; k < nB; k++) {
        const xa = -L / 2 + k * w + 0.15, xb = xa + w - 0.3;
        lboards.quad4(
          new THREE.Vector3(xb, 0.35, -0.02),
          new THREE.Vector3(xa, 0.35, -0.02),
          new THREE.Vector3(xa, 1.55, -0.02),
          new THREE.Vector3(xb, 1.55, -0.02),
          new THREE.Color(1, 1, 1),
          sponsorUV(sponsorK++),
        );
      }
    }
    // roof
    if (g.roof) {
      const yBack = top + 3.4;
      const yFront = top + 5.6;
      const zFront = -2.2;
      const zBack = depth + 0.6;
      lsteel.prismX([[zFront, yFront - 0.35], [zBack, yBack - 0.35], [zBack, yBack], [zFront, yFront]], -L / 2 - 1, L / 2 + 1, STEEL);
      // underside panels slightly darker (reads as shade)
      const nCol = Math.max(2, Math.round(L / 16) + 1);
      for (let k = 0; k < nCol; k++) {
        const x = -L / 2 + (k * L) / (nCol - 1);
        // back column
        lsteel.aabb(x - 0.3, top + 1.2, depth - 0.35, x + 0.3, yBack - 0.3, depth + 0.25, STEEL_DARK);
        // raked rafter under the roof
        lsteel.prismX([[zFront + 0.4, yFront - 0.6], [zBack - 0.2, yBack - 1.3], [zBack - 0.2, yBack - 0.35], [zFront + 0.4, yFront - 0.35]], x - 0.15, x + 0.15, STEEL_DARK);
        // tie rod to the back of the terrace
        lsteel.prismX([[depth * 0.55, top * 0.6], [depth * 0.55 + 0.25, top * 0.6], [zBack - 0.2, yBack - 1.3], [zBack - 0.45, yBack - 1.3]], x - 0.08, x + 0.08, STEEL_DARK);
      }
      // fascia with sponsors
      const nB = Math.max(1, Math.round(L / 22));
      const w = (L + 2) / nB;
      for (let k = 0; k < nB; k++) {
        const xa = -L / 2 - 1 + k * w, xb = xa + w;
        lboards.quad4(
          new THREE.Vector3(xb, yFront - 1.9, zFront - 0.05),
          new THREE.Vector3(xa, yFront - 1.9, zFront - 0.05),
          new THREE.Vector3(xa, yFront + 0.15, zFront - 0.05),
          new THREE.Vector3(xb, yFront + 0.15, zFront - 0.05),
          new THREE.Color(1, 1, 1),
          sponsorUV(sponsorK++),
        );
      }
      lsteel.aabb(-L / 2 - 1, yFront - 1.95, zFront - 0.02, L / 2 + 1, yFront + 0.2, zFront + 0.3, STEEL_DARK);
    } else {
      // uncovered stand: a big screen / scoreboard at one end
      lsteel.aabb(L / 2 - 14, top + 1.3, depth - 1.2, L / 2 - 2, top + 8, depth - 0.6, STEEL_DARK);
      lboards.quad4(
        new THREE.Vector3(L / 2 - 2.3, top + 1.6, depth - 1.25),
        new THREE.Vector3(L / 2 - 13.7, top + 1.6, depth - 1.25),
        new THREE.Vector3(L / 2 - 13.7, top + 7.7, depth - 1.25),
        new THREE.Vector3(L / 2 - 2.3, top + 7.7, depth - 1.25),
        new THREE.Color(1, 1, 1),
        sponsorUV(15),
      );
    }

    // place the stand: local −z faces the track
    const front = g.center.clone().addScaledVector(g.facing, g.depth / 2);
    const y0 = trackHeight(front.x, front.z);
    const zAxis = g.facing.clone().negate();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
    const M = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis).setPosition(front.x, y0, front.z);
    local.transform(M);
    lsteel.transform(M);
    lboards.transform(M);
    structure.append(local);
    steel.append(lsteel);
    boards.append(lboards);
    for (const p of standPeople) {
      p.m.premultiply(M);
      people.push(p);
    }
    for (const f of standFlags) {
      f.m.premultiply(M);
      flags.push(f);
    }
    void heightAt;
  });

  const structMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  const steelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.3 });
  const boardTex = sponsorTexture();
  const boardMat = new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.55, metalness: 0, emissiveMap: boardTex, emissive: 0xffffff, emissiveIntensity: 0.18 });
  const add = (mb: MeshBuilder, mat: THREE.Material, name: string, cast: boolean) => {
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

  // crowd
  const uniforms = { uTime: { value: 0 } };
  const personGeo = new THREE.PlaneGeometry(0.62, 1.24);
  personGeo.translate(0, 0.62, 0);
  // face −z (toward the track), normals tipped up so the sky lights them
  personGeo.rotateY(Math.PI);
  const nrm = personGeo.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 0.55, -0.83);
  const shade = new Float32Array(people.length);
  people.forEach((p, i) => (shade[i] = p.shade));
  personGeo.setAttribute('aShade', new THREE.InstancedBufferAttribute(shade, 1));
  const crowd = new THREE.InstancedMesh(personGeo, crowdMaterial(crowdAtlas(), uniforms), people.length);
  people.forEach((p, i) => {
    crowd.setMatrixAt(i, p.m);
    crowd.setColorAt(i, p.c);
  });
  crowd.instanceMatrix.needsUpdate = true;
  if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
  crowd.computeBoundingSphere();
  crowd.name = 'crowd';
  crowd.receiveShadow = true;
  group.add(crowd);

  const flagGeo = new THREE.PlaneGeometry(1.5, 0.95, 6, 1);
  flagGeo.translate(0.75, 0, 0);
  const flagMesh = new THREE.InstancedMesh(flagGeo, flagMaterial(uniforms), Math.max(1, flags.length));
  flags.forEach((f, i) => {
    flagMesh.setMatrixAt(i, f.m);
    flagMesh.setColorAt(i, f.c);
  });
  flagMesh.count = flags.length;
  flagMesh.instanceMatrix.needsUpdate = true;
  flagMesh.computeBoundingSphere();
  flagMesh.name = 'flags';
  group.add(flagMesh);

  return {
    group,
    people: people.length,
    update(t: number) {
      uniforms.uTime.value = t;
    },
  };
}
