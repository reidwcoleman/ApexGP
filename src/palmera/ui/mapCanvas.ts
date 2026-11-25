// Top-down map image of Port Palmera, used by the minimap and the pause map.
import { BEACH, BRIDGE, DISTRICTS, ISLAND, MAIN, ROAD_HALF, WORLD, type CityMap } from '../world/map';

export const MAP_SCALE = 1; // pixels per metre

export function buildMapCanvas(map: CityMap): HTMLCanvasElement {
  const W = (WORLD.x1 - WORLD.x0) * MAP_SCALE, H = (WORLD.z1 - WORLD.z0) * MAP_SCALE;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const X = (x: number) => (x - WORLD.x0) * MAP_SCALE;
  const Z = (z: number) => (z - WORLD.z0) * MAP_SCALE;
  const rect = (x0: number, z0: number, x1: number, z1: number) => ctx.fillRect(X(x0), Z(z0), (x1 - x0) * MAP_SCALE, (z1 - z0) * MAP_SCALE);
  // water
  const grd = ctx.createLinearGradient(0, 0, W, 0);
  grd.addColorStop(0, '#1d5f7a');
  grd.addColorStop(1, '#14506e');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);
  // land
  ctx.fillStyle = '#4f6a3e';
  rect(MAIN.x0, MAIN.z0, -480, MAIN.z1);
  ctx.fillStyle = '#5f8a4c';
  rect(-480, MAIN.z0, 80, MAIN.z1);
  ctx.fillStyle = '#9b9a93';
  rect(80, MAIN.z0, MAIN.x1, MAIN.z1);
  ctx.fillStyle = '#a7a39a';
  rect(ISLAND.x0, ISLAND.z0, BEACH.x0, ISLAND.z1);
  ctx.fillStyle = '#e8d4a2';
  rect(BEACH.x0, ISLAND.z0, 735, ISLAND.z1);
  // flats
  for (const f of map.flats) {
    ctx.fillStyle = f.kind === 'pond' ? '#2c4a3a' : f.kind === 'pool' ? '#49c6e5' : f.kind === 'grass' ? '#6f9a55' : f.kind === 'plaza' ? '#c9b59a' : f.kind === 'court' ? '#3f8f74' : '#7d7d80';
    rect(f.x - f.w / 2, f.z - f.d / 2, f.x + f.w / 2, f.z + f.d / 2);
  }
  // buildings
  for (const b of map.buildings) {
    if (b.y0 > 0 && b.w < 6) continue;
    ctx.fillStyle = b.style === 0 ? '#6f7f8c' : b.style === 1 ? '#c98fa0' : b.style === 2 ? '#b8a48f' : '#8e8a85';
    rect(b.x - b.w / 2, b.z - b.d / 2, b.x + b.w / 2, b.z + b.d / 2);
  }
  // docks
  ctx.fillStyle = '#a98b67';
  for (const d of map.docks) rect(d.x0, d.z0, d.x1, d.z1);
  // roads
  ctx.lineCap = 'square';
  for (const pass of [0, 1]) {
    for (const e of map.edges) {
      const A = map.nodes[e.a], B = map.nodes[e.b];
      ctx.strokeStyle = pass === 0 ? '#2b2d31' : e.swamp ? '#b9ac8c' : e.bridge ? '#f1ede4' : '#e9e6df';
      ctx.lineWidth = (pass === 0 ? ROAD_HALF * 2 + 3 : ROAD_HALF * 2 - 2) * MAP_SCALE;
      ctx.beginPath();
      ctx.moveTo(X(A.x), Z(A.z));
      ctx.lineTo(X(B.x), Z(B.z));
      ctx.stroke();
    }
  }
  // bridge outline
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(X(BRIDGE.x0), Z(BRIDGE.z - BRIDGE.half), (BRIDGE.x1 - BRIDGE.x0) * MAP_SCALE, BRIDGE.half * 2 * MAP_SCALE);
  return c;
}

export function drawDistrictLabels(ctx: CanvasRenderingContext2D, toScreen: (x: number, z: number) => [number, number], size: number) {
  ctx.save();
  ctx.font = `600 ${size}px "Avenir Next", "Trebuchet MS", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const d of DISTRICTS) {
    const [sx, sy] = toScreen(d.x, d.z);
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(10,20,35,0.7)';
    ctx.strokeText(d.name.toUpperCase(), sx, sy);
    ctx.fillStyle = '#fff4e0';
    ctx.fillText(d.name.toUpperCase(), sx, sy);
  }
  ctx.restore();
}
