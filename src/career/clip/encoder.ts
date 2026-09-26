import { muxMp4, type EncodedSample } from './mp4.ts';
import { muxWebm } from './webm.ts';

/**
 * Turns rendered frames (RGBA, top row first) into a video file.
 *
 * WebCodecs' VideoEncoder first: H.264 (hardware on almost every machine) muxed into MP4,
 * else VP9/VP8 into WebM. Frames carry their own timestamps (frame index / fps), so the clip
 * plays perfectly smoothly however long each frame took to render.
 *
 * Without WebCodecs, a MediaRecorder on a canvas stream (captureStream(0) + requestFrame):
 * it timestamps frames by the wall clock, so the producer must then deliver them in real time
 * (`realtime`).
 */

export interface ClipFormat {
  kind: 'avc' | 'vp9' | 'vp8' | 'recorder';
  codec: string;
  mime: string;
}

const AVC = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.42e01f'];

let probe: Promise<ClipFormat | null> | null = null;

/** the best way this browser can encode W×H clips (asked once) */
export function pickFormat(w: number, h: number, fps: number, bitrate: number): Promise<ClipFormat | null> {
  probe ??= (async () => {
    if (typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined') {
      const tryCfg = async (codec: string, hw: HardwareAcceleration, extra: Partial<VideoEncoderConfig> = {}) => {
        try {
          const r = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate, framerate: fps, hardwareAcceleration: hw, ...extra });
          return !!r.supported;
        } catch {
          return false;
        }
      };
      for (const hw of ['prefer-hardware', 'no-preference'] as HardwareAcceleration[])
        for (const c of AVC) if (await tryCfg(c, hw, { avc: { format: 'avc' } })) return { kind: 'avc', codec: c, mime: 'video/mp4' };
      if (await tryCfg('vp09.00.40.08', 'no-preference')) return { kind: 'vp9', codec: 'vp09.00.40.08', mime: 'video/webm' };
      if (await tryCfg('vp8', 'no-preference')) return { kind: 'vp8', codec: 'vp8', mime: 'video/webm' };
    }
    if (typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function') {
      for (const m of ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'])
        if (MediaRecorder.isTypeSupported(m)) return { kind: 'recorder', codec: m, mime: m.split(';')[0] };
    }
    return null;
  })();
  return probe;
}

export interface ClipSink {
  /** the producer must deliver frames in real time (MediaRecorder) */
  readonly realtime: boolean;
  /** frames handed over but not encoded yet */
  readonly backlog: number;
  readonly failed: boolean;
  /** one frame: RGBA, top row first, `index` frames from the start */
  add(rgba: Uint8Array, index: number, key: boolean): void;
  finish(): Promise<Blob | null>;
  close(): void;
}

export function createSink(fmt: ClipFormat, w: number, h: number, fps: number, bitrate: number): ClipSink {
  return fmt.kind === 'recorder' ? new RecorderSink(fmt, w, h, fps, bitrate) : new CodecSink(fmt, w, h, fps, bitrate);
}

class CodecSink implements ClipSink {
  readonly realtime = false;
  failed = false;
  private readonly enc: VideoEncoder;
  private readonly samples: EncodedSample[] = [];
  private desc: Uint8Array | null = null;
  constructor(
    private readonly fmt: ClipFormat,
    private readonly w: number,
    private readonly h: number,
    private readonly fps: number,
    bitrate: number,
  ) {
    this.enc = new VideoEncoder({
      output: (chunk, meta) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        this.samples.push({ data, key: chunk.type === 'key', pts: chunk.timestamp, duration: chunk.duration ?? Math.round(1e6 / fps) });
        const d = meta?.decoderConfig?.description;
        if (d && !this.desc) this.desc = d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array((d as ArrayBufferView).buffer.slice((d as ArrayBufferView).byteOffset, (d as ArrayBufferView).byteOffset + (d as ArrayBufferView).byteLength));
      },
      error: (e) => {
        console.warn('[highlights] encoder error', e);
        this.failed = true;
      },
    });
    const cfg: VideoEncoderConfig = {
      codec: fmt.codec,
      width: w,
      height: h,
      bitrate,
      bitrateMode: 'variable',
      framerate: fps,
      latencyMode: 'quality',
      hardwareAcceleration: 'no-preference',
    };
    if (fmt.kind === 'avc') cfg.avc = { format: 'avc' };
    try {
      this.enc.configure(cfg);
    } catch (e) {
      console.warn('[highlights] encoder configure failed', e);
      this.failed = true;
    }
  }
  get backlog() {
    return this.enc.state === 'configured' ? this.enc.encodeQueueSize : 0;
  }
  add(rgba: Uint8Array, index: number, key: boolean) {
    if (this.failed || this.enc.state !== 'configured') return;
    const frame = new VideoFrame(rgba, {
      format: 'RGBX',
      codedWidth: this.w,
      codedHeight: this.h,
      timestamp: Math.round((index * 1e6) / this.fps),
      duration: Math.round(1e6 / this.fps),
    });
    try {
      this.enc.encode(frame, { keyFrame: key });
    } catch (e) {
      console.warn('[highlights] encode failed', e);
      this.failed = true;
    }
    frame.close();
  }
  async finish(): Promise<Blob | null> {
    if (this.failed || this.enc.state !== 'configured') return null;
    try {
      await this.enc.flush();
    } catch {
      return null;
    }
    this.close();
    if (!this.samples.length) return null;
    // start on a keyframe
    const first = this.samples.findIndex((s) => s.key);
    const s = first > 0 ? this.samples.slice(first) : this.samples;
    const t0 = s[0]?.pts ?? 0;
    for (const x of s) x.pts -= t0;
    if (this.fmt.kind === 'avc') {
      if (!this.desc) return null;
      return muxMp4(s, { width: this.w, height: this.h, fps: this.fps, avcC: this.desc });
    }
    return muxWebm(s, { width: this.w, height: this.h, codec: this.fmt.kind === 'vp9' ? 'V_VP9' : 'V_VP8' });
  }
  close() {
    try {
      if (this.enc.state !== 'closed') this.enc.close();
    } catch {
      /* closed */
    }
  }
}

/** the fallback: a canvas stream into a MediaRecorder, fed in real time */
class RecorderSink implements ClipSink {
  readonly realtime = true;
  failed = false;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D | null;
  private readonly track: CanvasCaptureMediaStreamTrack | null = null;
  private readonly rec: MediaRecorder | null = null;
  private readonly chunks: Blob[] = [];
  private readonly img: ImageData | null;
  constructor(
    private readonly fmt: ClipFormat,
    w: number,
    h: number,
    _fps: number,
    bitrate: number,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.g = this.canvas.getContext('2d', { alpha: false });
    this.img = this.g ? this.g.createImageData(w, h) : null;
    try {
      const stream = this.canvas.captureStream(0);
      this.track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
      this.rec = new MediaRecorder(stream, { mimeType: fmt.codec, videoBitsPerSecond: bitrate });
      this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
      this.rec.start();
    } catch {
      this.failed = true;
    }
  }
  get backlog() {
    return 0;
  }
  add(rgba: Uint8Array) {
    if (this.failed || !this.g || !this.img) return;
    this.img.data.set(rgba);
    this.g.putImageData(this.img, 0, 0);
    this.track?.requestFrame();
  }
  finish(): Promise<Blob | null> {
    const rec = this.rec;
    if (this.failed || !rec) return Promise.resolve(null);
    return new Promise((res) => {
      rec.onstop = () => res(this.chunks.length ? new Blob(this.chunks, { type: this.fmt.mime }) : null);
      try {
        rec.stop();
      } catch {
        res(null);
      }
    });
  }
  close() {
    try {
      if (this.rec && this.rec.state !== 'inactive') this.rec.stop();
    } catch {
      /* stopped */
    }
  }
}
