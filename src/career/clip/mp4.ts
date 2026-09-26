/**
 * A small MP4 (ISO BMFF) writer for one H.264 video track, as WebCodecs' VideoEncoder hands it
 * over (length-prefixed NAL units plus an avcC record). The movie header goes first, so a clip
 * plays and seeks as soon as it is loaded; the samples sit in one chunk after it.
 */

export interface EncodedSample {
  data: Uint8Array;
  key: boolean;
  /** presentation time, µs from the start of the clip */
  pts: number;
  /** µs */
  duration: number;
}

const enc = new TextEncoder();

function u8(...v: number[]): Uint8Array {
  return new Uint8Array(v);
}
function u16(...v: number[]): Uint8Array {
  const a = new Uint8Array(v.length * 2);
  const d = new DataView(a.buffer);
  v.forEach((x, i) => d.setUint16(i * 2, x & 0xffff));
  return a;
}
function u32(...v: number[]): Uint8Array {
  const a = new Uint8Array(v.length * 4);
  const d = new DataView(a.buffer);
  v.forEach((x, i) => d.setUint32(i * 4, x >>> 0));
  return a;
}
function i32(...v: number[]): Uint8Array {
  const a = new Uint8Array(v.length * 4);
  const d = new DataView(a.buffer);
  v.forEach((x, i) => d.setInt32(i * 4, x | 0));
  return a;
}
function str(s: string): Uint8Array {
  return enc.encode(s);
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
function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const body = cat(parts);
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(str(type), 4);
  out.set(body, 8);
  return out;
}
function fullBox(type: string, version: number, flags: number, ...parts: Uint8Array[]): Uint8Array {
  return box(type, u8(version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255), ...parts);
}

const MATRIX = u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000);

/** run-length (count, value) pairs */
function runs(values: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const v of values) {
    const last = out[out.length - 1];
    if (last && last[1] === v) last[0]++;
    else out.push([1, v]);
  }
  return out;
}

export function muxMp4(samples: EncodedSample[], opts: { width: number; height: number; fps: number; avcC: Uint8Array }): Blob {
  const n = samples.length;
  const TS = Math.round(opts.fps * 1000);
  const toTs = (us: number) => Math.round((us * TS) / 1e6);
  // decode order is the order the encoder gave them; decode times advance by each sample's duration
  const dur = samples.map((s) => Math.max(1, toTs(s.duration)));
  const dts: number[] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    dts.push(acc);
    acc += dur[i];
  }
  const total = acc;
  const pts = samples.map((s) => toTs(s.pts));
  const reordered = pts.some((p, i) => p !== dts[i]);
  const movieDur = Math.round((total / TS) * 1000);

  const ftyp = box('ftyp', str('isom'), u32(0x200), str('isom'), str('iso2'), str('avc1'), str('mp41'));

  const W = opts.width, H = opts.height;
  const name = new Uint8Array(32);
  const avc1 = box(
    'avc1',
    u8(0, 0, 0, 0, 0, 0),
    u16(1), // data reference index
    u16(0, 0),
    u32(0, 0, 0),
    u16(W, H),
    u32(0x00480000, 0x00480000, 0),
    u16(1),
    name,
    u16(0x18, 0xffff),
    box('avcC', opts.avcC),
    // BT.709, limited range: what the encoder was given
    box('colr', str('nclx'), u16(1, 1, 1), u8(0)),
    box('pasp', u32(1, 1)),
  );
  const stsd = fullBox('stsd', 0, 0, u32(1), avc1);
  const stts = fullBox('stts', 0, 0, u32(runs(dur).length), ...runs(dur).map(([c, v]) => u32(c, v)));
  const keys: number[] = [];
  samples.forEach((s, i) => s.key && keys.push(i + 1));
  const stss = fullBox('stss', 0, 0, u32(keys.length), u32(...keys));
  const ctts = reordered ? fullBox('ctts', 1, 0, u32(runs(pts.map((p, i) => p - dts[i])).length), ...runs(pts.map((p, i) => p - dts[i])).map(([c, v]) => cat([u32(c), i32(v)]))) : new Uint8Array(0);
  const stsc = fullBox('stsc', 0, 0, u32(1), u32(1, n, 1));
  const stsz = fullBox('stsz', 0, 0, u32(0, n), u32(...samples.map((s) => s.data.length)));
  // the chunk offset is patched in once the header's size is known (it doesn't depend on the value)
  const stcoAt = () => fullBox('stco', 0, 0, u32(1), u32(offset));
  let offset = 0;
  const build = () => {
    const stbl = box('stbl', stsd, stts, ctts, stss, stsc, stsz, stcoAt());
    const minf = box('minf', fullBox('vmhd', 0, 1, u16(0, 0, 0, 0)), box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1))), stbl);
    const mdia = box(
      'mdia',
      fullBox('mdhd', 0, 0, u32(0, 0, TS, total), u16(0x55c4, 0)),
      fullBox('hdlr', 0, 0, u32(0), str('vide'), u32(0, 0, 0), str('ApexGP video\0')),
      minf,
    );
    const tkhd = fullBox('tkhd', 0, 3, u32(0, 0, 1, 0, movieDur, 0, 0), u16(0, 0, 0, 0), MATRIX, u32(W << 16, H << 16));
    const trak = box('trak', tkhd, mdia);
    const mvhd = fullBox('mvhd', 0, 0, u32(0, 0, 1000, movieDur, 0x00010000), u16(0x0100, 0), u32(0, 0), MATRIX, u32(0, 0, 0, 0, 0, 0, 2));
    return box('moov', mvhd, trak);
  };
  let moov = build();
  offset = ftyp.length + moov.length + 8;
  moov = build();
  let bytes = 0;
  for (const s of samples) bytes += s.data.length;
  const mdatHead = cat([u32(bytes + 8), str('mdat')]);
  return new Blob([ftyp, moov, mdatHead, ...samples.map((s) => s.data)] as BlobPart[], { type: 'video/mp4' });
}
