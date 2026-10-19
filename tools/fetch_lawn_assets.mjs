// Fetch the CC0 Poly Haven assets Apex Lawn uses (textures, models, HDRIs) and pack them into
// public/lawn/ for the browser: textures → webp, models → one meshopt-compressed GLB each (1k).
//
//   node tools/fetch_lawn_assets.mjs [textures|models|hdris] [id ...]
//
// Sources land in assets-src/lawn (git-ignored); the packed files are committed.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SRC = 'assets-src/lawn';
const OUT = 'public/lawn';

const TEXTURES = {
  fence: 'weathered_brown_planks',
  fence2: 'wood_planks_grey',
  brick: 'red_brick_03',
  plaster: 'beige_wall_001',
  roof: 'roof_09',
  stonewall: 'rustic_stone_wall_02',
  paving: 'large_floor_tiles_02',
  gravel: 'rocky_trail',
  litter: 'brown_mud_leaves_01',
  deck: 'wood_floor_deck',
};
const MODELS = [
  'garden_gnome', 'outdoor_table_chair_set_01', 'painted_wooden_bench', 'garden_sprinkler_01', 'planter_box_01', 'planter_box_02',
  'boulder_01', 'rock_07', 'rock_09', 'stone_01', 'rock_moss_set_01', 'tree_stump_01',
  'stone_fire_pit', 
  
];
const HDRIS = {
  morning: 'spruit_sunrise',
  day: 'kloofendal_48d_partly_cloudy_puresky',
  autumn: 'golden_gate_hills',
  dusk: 'belfast_sunset_puresky',
};

const get = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r;
};
const save = async (url, file) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return;
  fs.writeFileSync(file, Buffer.from(await (await get(url)).arrayBuffer()));
};
const files = async (id) => (await get(`https://api.polyhaven.com/files/${id}`)).json();
const gt = (...a) => execFileSync('npx', ['--yes', '@gltf-transform/cli', ...a], { stdio: 'inherit' });

async function textures(only) {
  for (const [key, id] of Object.entries(TEXTURES)) {
    if (only.length && !only.includes(key) && !only.includes(id)) continue;
    const f = await files(id);
    for (const [map, name] of [['Diffuse', 'c'], ['nor_gl', 'n'], ['Rough', 'r']]) {
      const e = f[map]?.['1k']?.jpg;
      if (!e) {
        console.warn(`${id}: no ${map}`);
        continue;
      }
      const jpg = `${SRC}/tex/${key}_${name}.jpg`;
      await save(e.url, jpg);
      const out = `${OUT}/tex/${key}_${name}.webp`;
      fs.mkdirSync(path.dirname(out), { recursive: true });
      execFileSync('cwebp', ['-quiet', '-q', name === 'n' ? '92' : '84', jpg, '-o', out]);
    }
    console.log('texture', key, id);
  }
}

async function models(only) {
  for (const id of MODELS) {
    if (only.length && !only.includes(id)) continue;
    const f = await files(id);
    const e = f.gltf?.['1k']?.gltf;
    if (!e) {
      console.warn(`${id}: no 1k gltf`);
      continue;
    }
    const dir = `${SRC}/models/${id}`;
    await save(e.url, `${dir}/${id}.gltf`);
    for (const [rel, inc] of Object.entries(e.include ?? {})) await save(inc.url, `${dir}/${rel}`);
    const glb = `${dir}/${id}.glb`;
    const out = `${OUT}/models/${id}.glb`;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    gt('copy', `${dir}/${id}.gltf`, glb);
    gt('resize', glb, glb, '--width', '1024', '--height', '1024');
    gt('webp', glb, glb, '--quality', '82');
    gt('dedup', glb, glb);
    gt('prune', glb, glb);
    gt('meshopt', glb, out, '--level', 'high');
    console.log('model', id, (fs.statSync(out).size / 1024).toFixed(0), 'KB');
  }
}

async function hdris(only) {
  for (const [key, id] of Object.entries(HDRIS)) {
    if (only.length && !only.includes(key) && !only.includes(id)) continue;
    const f = await files(id);
    const e = f.hdri?.['1k']?.hdr;
    if (!e) {
      console.warn(`${id}: no 1k hdr`);
      continue;
    }
    await save(e.url, `${OUT}/hdri/${key}.hdr`);
    console.log('hdri', key, id);
  }
}

const [what = 'all', ...rest] = process.argv.slice(2);
if (what === 'all' || what === 'textures') await textures(rest);
if (what === 'all' || what === 'models') await models(rest);
if (what === 'all' || what === 'hdris') await hdris(rest);
