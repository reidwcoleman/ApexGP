/**
 * The walkable ground, ray-cast from the Blender scene at 25 cm (export.py): the height of whatever is
 * underfoot (street, curb, porch steps, lawn, dunes, beach, the sea floor) and a mask of what blocks
 * (café tables, lamp posts, parasols, palm trunks). Blender x/y map to three x / -z.
 */
class Layer {
  readonly nx: number;
  readonly ny: number;
  readonly x0: number;
  readonly y0: number;
  readonly res: number;
  readonly h: Uint16Array;
  readonly b: Uint8Array;
  readonly off: number;
  constructor(buf: ArrayBuffer) {
    const dv = new DataView(buf);
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic !== 'ODH1') throw new Error('height.bin: bad magic');
    this.nx = dv.getUint32(4, true);
    this.ny = dv.getUint32(8, true);
    this.x0 = dv.getFloat32(12, true);
    this.y0 = dv.getFloat32(16, true);
    this.res = dv.getFloat32(20, true);
    this.off = dv.getFloat32(24, true);
    const n = this.nx * this.ny;
    this.h = new Uint16Array(buf.slice(28, 28 + n * 2));
    this.b = new Uint8Array(buf, 28 + n * 2, n);
  }
  idx(x: number, z: number): number {
    const i = Math.floor((x - this.x0) / this.res);
    const j = Math.floor((-z - this.y0) / this.res);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return -1;
    return j * this.nx + i;
  }
}

/** the whole city at 50 cm (height_far.bin): what's underfoot beyond the detailed map */
let FAR: Layer | null = null;

export class Ground {
  readonly nx: number;
  readonly ny: number;
  readonly x0: number;
  readonly y0: number;
  readonly res: number;
  private readonly h: Uint16Array;
  private readonly b: Uint8Array;
  private readonly off: number;

  constructor(buf: ArrayBuffer) {
    const dv = new DataView(buf);
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic !== 'ODH1') throw new Error('height.bin: bad magic');
    this.nx = dv.getUint32(4, true);
    this.ny = dv.getUint32(8, true);
    this.x0 = dv.getFloat32(12, true);
    this.y0 = dv.getFloat32(16, true);
    this.res = dv.getFloat32(20, true);
    this.off = dv.getFloat32(24, true);
    const n = this.nx * this.ny;
    this.h = new Uint16Array(buf.slice(28, 28 + n * 2));
    this.b = new Uint8Array(buf, 28 + n * 2, n);
  }

  static async load(url: string): Promise<Ground> {
    const [a, b] = await Promise.all([fetch(url).then((r) => r.arrayBuffer()), fetch(url.replace('height.bin', 'height_far.bin')).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null)]);
    if (b) FAR = new Layer(b);
    return new Ground(a);
  }

  private idx(x: number, z: number): number {
    const bx = x, by = -z;
    const i = Math.floor((bx - this.x0) / this.res);
    const j = Math.floor((by - this.y0) / this.res);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return -1;
    return j * this.nx + i;
  }

  inside(x: number, z: number): boolean {
    return this.idx(x, z) >= 0 || (!!FAR && FAR.idx(x, z) >= 0);
  }

  /** height of the surface at a point (three coords): the detailed map, else the city map; NaN off both */
  height(x: number, z: number): number {
    const k = this.idx(x, z);
    if (k >= 0) return this.h[k] / 100 + this.off;
    if (FAR) {
      const f = FAR.idx(x, z);
      if (f >= 0) return FAR.h[f] / 100 + FAR.off;
    }
    return NaN;
  }

  /** bilinear height (smooth on slopes; steps stay steps at 25 cm) */
  heightSmooth(x: number, z: number): number {
    if (this.idx(x, z) < 0) return this.height(x, z);
    const bx = (x - this.x0) / this.res - 0.5, by = (-z - this.y0) / this.res - 0.5;
    const i = Math.floor(bx), j = Math.floor(by);
    const fx = bx - i, fy = by - j;
    const g = (ii: number, jj: number) => {
      ii = Math.max(0, Math.min(this.nx - 1, ii));
      jj = Math.max(0, Math.min(this.ny - 1, jj));
      return this.h[jj * this.nx + ii] / 100 + this.off;
    };
    const a = g(i, j), b = g(i + 1, j), c = g(i, j + 1), d = g(i + 1, j + 1);
    // don't blend across a step (a curb, a porch): take the nearest then
    const mx = Math.max(a, b, c, d), mn = Math.min(a, b, c, d);
    if (mx - mn > 0.12) return this.height(x, z);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }

  blocked(x: number, z: number): boolean {
    const k = this.idx(x, z);
    if (k >= 0) return this.b[k] === 1;
    if (FAR) {
      const f = FAR.idx(x, z);
      if (f >= 0) return FAR.b[f] === 1;
    }
    return true;
  }
}
