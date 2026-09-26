import type { EncodedSample } from './mp4.ts';

/**
 * A small WebM (Matroska) writer for one VP9/VP8 video track, for browsers whose WebCodecs
 * encoder has no H.264: EBML header, segment info with the duration, the track, a cue per
 * cluster (so the clip seeks) and one cluster per keyframe of SimpleBlocks.
 */

function vint(n: number): Uint8Array {
  // element data size: the shortest length that holds n (all-ones is reserved)
  for (let len = 1; len <= 8; len++) {
    if (n < 2 ** (7 * len) - 1) {
      const out = new Uint8Array(len);
      let v = n;
      for (let i = len - 1; i >= 0; i--) {
        out[i] = v & 255;
        v = Math.floor(v / 256);
      }
      out[0] |= 1 << (8 - len);
      return out;
    }
  }
  throw new Error('webm: size too big');
}

function idBytes(id: number): Uint8Array {
  const b: number[] = [];
  let v = id;
  while (v > 0) {
    b.unshift(v & 255);
    v = Math.floor(v / 256);
  }
  return new Uint8Array(b);
}

function cat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function el(id: number, ...data: Uint8Array[]): Uint8Array {
  const body = cat(data);
  return cat([idBytes(id), vint(body.length), body]);
}
function uint(id: number, v: number, bytes = 0): Uint8Array {
  const b: number[] = [];
  let x = v;
  do {
    b.unshift(x & 255);
    x = Math.floor(x / 256);
  } while (x > 0);
  while (b.length < bytes) b.unshift(0);
  return el(id, new Uint8Array(b));
}
function float(id: number, v: number): Uint8Array {
  const a = new Uint8Array(8);
  new DataView(a.buffer).setFloat64(0, v);
  return el(id, a);
}
function text(id: number, s: string): Uint8Array {
  return el(id, new TextEncoder().encode(s));
}

export function muxWebm(samples: EncodedSample[], opts: { width: number; height: number; codec: 'V_VP9' | 'V_VP8' }): Blob {
  const header = el(0x1a45dfa3, uint(0x4286, 1), uint(0x42f7, 1), uint(0x42f2, 4), uint(0x42f3, 8), text(0x4282, 'webm'), uint(0x4287, 4), uint(0x4285, 2));
  const last = samples[samples.length - 1];
  const durMs = last ? (last.pts + last.duration) / 1000 : 0;
  const info = el(0x1549a966, uint(0x2ad7b1, 1000000), text(0x4d80, 'ApexGP'), text(0x5741, 'ApexGP'), float(0x4489, durMs));
  const tracks = el(0x1654ae6b, el(0xae, uint(0xd7, 1), uint(0x73c5, 1), uint(0x83, 1), text(0x86, opts.codec), el(0xe0, uint(0xb0, opts.width), uint(0xba, opts.height))));
  // clusters: a new one at every keyframe (and before the 16-bit block offset runs out)
  const clusters: { time: number; bytes: Uint8Array }[] = [];
  let blocks: Uint8Array[] = [];
  let t0 = -1;
  const flush = () => {
    if (t0 < 0) return;
    clusters.push({ time: t0, bytes: el(0x1f43b675, uint(0xe7, t0), ...blocks) });
    blocks = [];
  };
  for (const s of samples) {
    const t = Math.round(s.pts / 1000);
    if (t0 < 0 || s.key || t - t0 > 30000) {
      flush();
      t0 = t;
    }
    const rel = t - t0;
    const head = new Uint8Array(4);
    head[0] = 0x81;
    head[1] = (rel >> 8) & 255;
    head[2] = rel & 255;
    head[3] = s.key ? 0x80 : 0;
    blocks.push(el(0xa3, head, s.data));
  }
  flush();
  // cues point at clusters relative to the segment's data: fixed 8-byte positions, so their size is known first
  const cueFor = (time: number, pos: number) => el(0xbb, uint(0xb3, time), el(0xb7, uint(0xf7, 1), uint(0xf1, pos, 8)));
  const cuesSize = el(0x1c53bb6b, ...clusters.map((c) => cueFor(c.time, 0))).length;
  let pos = info.length + tracks.length + cuesSize;
  const cueList: Uint8Array[] = [];
  for (const c of clusters) {
    cueList.push(cueFor(c.time, pos));
    pos += c.bytes.length;
  }
  const cues = el(0x1c53bb6b, ...cueList);
  const body: Uint8Array[] = [info, tracks, cues, ...clusters.map((c) => c.bytes)];
  let size = 0;
  for (const b of body) size += b.length;
  const segHead = cat([idBytes(0x18538067), vint(size)]);
  return new Blob([header, segHead, ...body] as BlobPart[], { type: 'video/webm' });
}
