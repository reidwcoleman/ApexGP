#!/usr/bin/env node
// Bakes the Mogul cities from OpenStreetMap (Overpass) into compact JSON at public/mogul/<id>.json.
//   node tools/mogul_osm.mjs [id ...]
// Output (all coordinates in metres, x east, z south, origin = bbox centre):
//   { id, name, size: [w, d], b: [[h, kind, x0, z0, x1, z1, ...]], r: [[cls, x0, z0, ...]], p: [[kind, x0, z0, ...]], n: name samples }
// The raw Overpass answers are cached in assets-src/mogul/ (git-ignored) so a re-bake doesn't re-download.
import fs from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITIES } from '../src/mogul/cities.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = resolve(root, 'assets-src/mogul');
const outDir = resolve(root, 'public/mogul');
fs.mkdirSync(cacheDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

const MIRRORS = ['https://overpass.private.coffee/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];

async function overpass(q) {
  for (let round = 0; round < 6; round++) {
    for (const m of MIRRORS) {
      try {
        const r = await fetch(m, { method: 'POST', headers: { 'User-Agent': 'MogulCityBaker/1.0', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(150000) });
        const t = await r.text();
        if (r.ok && t.startsWith('{')) return JSON.parse(t);
        console.log('  ', m, r.status, t.slice(0, 60).replace(/\s+/g, ' '));
      } catch (e) {
        console.log('  ', m, String(e).slice(0, 80));
      }
    }
    await new Promise((r) => setTimeout(r, 8000 * (round + 1)));
  }
  throw new Error('overpass failed');
}

async function cached(name, q) {
  const f = resolve(cacheDir, name);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const j = await overpass(q);
  fs.writeFileSync(f, JSON.stringify(j));
  return j;
}

const ROAD = { motorway: 4, trunk: 4, primary: 3, secondary: 3, tertiary: 2, residential: 1, unclassified: 1, living_street: 1, service: 0, pedestrian: 5, footway: 6 };

function heightOf(t) {
  const h = parseFloat(t.height);
  if (h > 0 && h < 600) return h;
  const l = parseFloat(t['building:levels']);
  if (l > 0 && l < 150) return l * 3.4 + 1;
  return 0;
}

function kindOf(t) {
  const b = t.building || '';
  if (t.amenity === 'place_of_worship' || b === 'church' || b === 'cathedral') return 4;
  if (b === 'retail' || b === 'commercial' || t.shop) return 1;
  if (b === 'office') return 2;
  if (b === 'apartments' || b === 'residential' || b === 'house' || b === 'terrace') return 3;
  if (b === 'industrial' || b === 'warehouse') return 5;
  if (b === 'hotel' || t.tourism === 'hotel') return 6;
  return 0;
}

async function bake(c) {
  const [s, w, n, e] = c.bbox;
  const bb = `(${s},${w},${n},${e})`;
  console.log(c.id, 'buildings…');
  const B = await cached(`${c.id}-b.json`, `[out:json][timeout:120];way["building"]${bb};out geom tags;`);
  console.log(c.id, 'roads…');
  const R = await cached(`${c.id}-r.json`, `[out:json][timeout:120];way["highway"~"motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|pedestrian|service"]${bb};out geom tags;`);
  console.log(c.id, 'parks…');
  const P = await cached(`${c.id}-p.json`, `[out:json][timeout:120];(way["leisure"~"park|garden|pitch|playground"]${bb};way["landuse"~"grass|recreation_ground|cemetery"]${bb};way["natural"~"water|wood"]${bb};way["waterway"="riverbank"]${bb};);out geom tags;`);

  const lat0 = (s + n) / 2, lon0 = (w + e) / 2;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), kz = 110540;
  const W = (e - w) * kx, D = (n - s) * kz;
  const P2 = (g) => [Math.round((g.lon - lon0) * kx * 10) / 10, Math.round(-(g.lat - lat0) * kz * 10) / 10];
  const inside = (x, z, pad = 0) => Math.abs(x) <= W / 2 + pad && Math.abs(z) <= D / 2 + pad;

  const b = [];
  for (const el of B.elements) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 4) continue;
    const t = el.tags || {};
    if (t.building === 'roof' || t['building:part'] || t.layer < 0 || t.location === 'underground') continue;
    const pts = el.geometry.slice(0, -1).map(P2);
    let cx = 0, cz = 0, area = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % pts.length];
      area += x0 * z1 - x1 * z0;
      cx += x0; cz += z0;
    }
    cx /= pts.length; cz /= pts.length;
    if (!inside(cx, cz) || Math.abs(area) / 2 < 12) continue;
    if (area < 0) pts.reverse(); // counter-clockwise in x/z (z south) for the extruder
    let h = heightOf(t);
    const a = Math.abs(area) / 2;
    if (!h) h = c.defaultH * (0.75 + ((el.id * 2654435761) % 1000) / 1000 * 0.6) * (a < 80 ? 0.6 : 1);
    b.push([Math.round(h * 10) / 10, kindOf(t), ...pts.flat(), ...(t.name ? [] : [])]);
    if (t.name && b.length) b[b.length - 1].name = t.name;
  }
  const names = {};
  b.forEach((x, i) => { if (x.name) { names[i] = x.name; delete x.name; } });

  const r = [];
  for (const el of R.elements) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const t = el.tags || {};
    if (t.tunnel === 'yes' || t.access === 'private' || t.area === 'yes') continue;
    let cls = ROAD[t.highway];
    if (cls === undefined) continue;
    if (t.highway === 'service' && t.service && t.service !== 'alley') continue;
    const pts = el.geometry.map(P2);
    if (!pts.some(([x, z]) => inside(x, z, 40))) continue;
    r.push([cls, ...pts.flat(), t.name || '']);
  }
  const p = [];
  for (const el of P.elements) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 4) continue;
    const t = el.tags || {};
    const kind = t.natural === 'water' || t.waterway ? 1 : t.leisure === 'pitch' ? 2 : t.natural === 'wood' ? 3 : 0;
    const pts = el.geometry.slice(0, -1).map(P2);
    if (!pts.some(([x, z]) => inside(x, z, 60))) continue;
    p.push([kind, ...pts.flat()]);
  }
  const out = { id: c.id, name: c.name, size: [Math.round(W), Math.round(D)], b, r, p, names };
  const f = resolve(outDir, `${c.id}.json`);
  fs.writeFileSync(f, JSON.stringify(out));
  console.log(c.id, `${b.length} buildings, ${r.length} roads, ${p.length} parks → ${(fs.statSync(f).size / 1024) | 0} KB`);
}

const want = process.argv.slice(2);
const index = () => fs.writeFileSync(resolve(outDir, 'index.json'), JSON.stringify(CITIES.map((c) => c.id).filter((id) => fs.existsSync(resolve(outDir, `${id}.json`)))));
index();
for (const c of CITIES) if (!want.length || want.includes(c.id)) { await bake(c); index(); }
