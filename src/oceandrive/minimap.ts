import type { DressData } from './dressing.ts';
import type { RoadGraph } from './roadgraph.ts';

// every street of the county as one path (built once)
let roadPath: Path2D | null = null;
let roadOf: RoadGraph | null = null;
function roads(gr: RoadGraph): Path2D {
  if (roadPath && roadOf === gr) return roadPath;
  const p = new Path2D();
  for (const e of gr.edges) {
    const q = e.pts;
    if (q.length < 4) continue;
    p.moveTo(q[0], q[1]);
    for (let i = 2; i < q.length; i += 2) p.lineTo(q[i], q[i + 1]);
  }
  roadOf = gr;
  return (roadPath = p);
}

/**
 * The map in the corner: the street grid (from the same data the city was built from), the park,
 * the beach and the sea, turned so where you're looking is up; you in the middle, the police as
 * flashing blips, the area they're searching as a circle.
 */
export function drawMap(
  cv: HTMLCanvasElement,
  data: DressData,
  you: { x: number; z: number; yaw: number; camYaw: number },
  blips: [number, number, 'car' | 'cop' | 'heli'][],
  search: { x: number; z: number; r: number } | null,
  t: number,
  graph: RoadGraph | null = null,
) {
  const g = cv.getContext('2d')!;
  const W = cv.width, H = cv.height;
  const s = 1.5; // px per metre (the canvas is drawn at 2x)
  g.save();
  g.fillStyle = '#26323a';
  g.fillRect(0, 0, W, H);
  g.translate(W / 2, H * 0.6);
  // up on the map is the camera's forward (three: -z is north)
  g.rotate(you.camYaw - Math.PI);
  g.scale(s, s);
  g.translate(-you.x, -you.z);
  // the park, the beach, the sea (x east; z south)
  g.fillStyle = '#35503a';
  g.fillRect(10, -420, 120, 840);
  g.fillStyle = '#b9a77e';
  g.fillRect(130, -420, 132, 840);
  g.fillStyle = '#2b5f80';
  g.fillRect(262, -420, 600, 840);
  // roads
  g.fillStyle = '#c9ccd0';
  const [cx0, cx1, cy0, cy1] = data.city;
  g.fillRect(data.od[0], -cy1, data.od[1] - data.od[0], cy1 - cy0 + 200);
  for (const [a, b] of data.xs) g.fillRect(a, -cy1, b - a, cy1 - cy0);
  for (const [a, b] of data.ys) g.fillRect(cx0, -b, cx1 - cx0, b - a);
  if (graph) {
    g.strokeStyle = '#c9ccd0';
    g.lineWidth = 9;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.stroke(roads(graph));
  }
  // the search
  if (search) {
    g.beginPath();
    g.arc(search.x, search.z, search.r, 0, Math.PI * 2);
    g.fillStyle = 'rgba(120,150,255,0.18)';
    g.strokeStyle = 'rgba(160,180,255,0.6)';
    g.lineWidth = 1.2;
    g.fill();
    g.stroke();
  }
  // the police
  const ph = Math.floor(t * 4) % 2;
  for (const [x, z, k] of blips) {
    g.beginPath();
    g.arc(x, z, k === 'heli' ? 4.5 : k === 'car' ? 3.4 : 2.4, 0, Math.PI * 2);
    g.fillStyle = (ph === 0) !== (k === 'cop') ? '#ff3b3b' : '#3b7bff';
    g.fill();
    g.lineWidth = 0.8;
    g.strokeStyle = '#000';
    g.stroke();
  }
  // you
  g.translate(you.x, you.z);
  g.rotate(-you.yaw + Math.PI);
  g.beginPath();
  g.moveTo(0, -5.5);
  g.lineTo(4, 4);
  g.lineTo(0, 2);
  g.lineTo(-4, 4);
  g.closePath();
  g.fillStyle = '#fff';
  g.fill();
  g.strokeStyle = '#000';
  g.lineWidth = 0.8;
  g.stroke();
  g.restore();
  // north
  g.fillStyle = 'rgba(255,255,255,.75)';
  g.font = '700 20px "Barlow Condensed", sans-serif';
  const nx = W / 2 - Math.sin(you.camYaw) * H * 0.42, ny = H * 0.6 + Math.cos(you.camYaw) * H * 0.42;
  g.fillText('N', Math.max(8, Math.min(W - 20, nx - 6)), Math.max(22, Math.min(H - 6, ny + 7)));
}
