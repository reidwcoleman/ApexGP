import Peer, { type DataConnection } from 'peerjs';
import type { Input } from './sim/car.ts';
import type { Stats, WEvent } from './sim/world.ts';

/**
 * Online lobbies, peer to peer over WebRTC (PeerJS's public broker only introduces the browsers).
 * The host's browser runs the match; everyone else sends inputs and gets snapshots. Two channels per
 * guest: 'ctl' (reliable JSON: lobby, chat, start/end) and 'gm' (unreliable binary: inputs up at
 * 120 Hz with the last few repeated against loss, snapshots down at 40 Hz).
 *
 * A room is a 4-letter code; the host's peer id is PREFIX + code.
 */

const PREFIX = 'boostball-v1-';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ICE: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
  { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
];

export interface LobbyPlayer {
  id: string; // peer id, 'host', or 'bot-N'
  name: string;
  team: 0 | 1;
  color: number;
  bot: boolean;
  skill: number;
  ping: number;
}
export interface LobbyState {
  code: string;
  players: LobbyPlayer[];
  size: 1 | 2 | 3 | 4;
  minutes: number;
  fill: boolean;
  botSkill: number;
  inMatch: boolean;
}

export type CtlMsg =
  | { t: 'hello'; name: string; color: number }
  | { t: 'welcome'; id: string; lobby: LobbyState }
  | { t: 'lobby'; lobby: LobbyState }
  | { t: 'team'; team: 0 | 1 }
  | { t: 'chat'; from: string; text: string }
  | { t: 'start'; roster: { name: string; team: 0 | 1; color: number; bot: boolean; skill: number; owner: string }[]; minutes: number; seed: number }
  | { t: 'toLobby' }
  | { t: 'ping'; ts: number }
  | { t: 'pong'; ts: number }
  | { t: 'kick' }
  | { t: 'ev'; ev: WEvent }
  | { t: 'stats'; stats: Stats[] };

export const makeCode = () => Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');

// ---------------------------------------------------------------- input packets
export function packInputs(seq: number, hist: (Input | undefined)[]): ArrayBuffer {
  // [1][count][u32 seq of the newest] then count × 6 bytes, newest first
  const n = hist.length;
  const buf = new ArrayBuffer(6 + n * 6);
  const v = new DataView(buf);
  v.setUint8(0, 1);
  v.setUint8(1, n);
  v.setUint32(2, seq);
  const q = (x: number) => Math.max(-127, Math.min(127, Math.round(x * 127)));
  for (let k = 0; k < n; k++) {
    const i = hist[k];
    const o = 6 + k * 6;
    if (!i) continue;
    v.setInt8(o, q(i.throttle));
    v.setInt8(o + 1, q(i.steer));
    v.setInt8(o + 2, q(i.pitch));
    v.setInt8(o + 3, q(i.yaw));
    v.setInt8(o + 4, q(i.roll));
    v.setUint8(o + 5, (i.jump ? 1 : 0) | (i.boost ? 2 : 0) | (i.handbrake ? 4 : 0));
  }
  return buf;
}

export function unpackInputs(buf: ArrayBuffer): { seq: number; inputs: Input[] } | null {
  const v = new DataView(buf);
  if (v.byteLength < 6 || v.getUint8(0) !== 1) return null;
  const n = v.getUint8(1);
  const seq = v.getUint32(2);
  const inputs: Input[] = [];
  for (let k = 0; k < n; k++) {
    const o = 6 + k * 6;
    if (o + 6 > v.byteLength) break;
    const f = v.getUint8(o + 5);
    inputs.push({
      throttle: v.getInt8(o) / 127,
      steer: v.getInt8(o + 1) / 127,
      pitch: v.getInt8(o + 2) / 127,
      yaw: v.getInt8(o + 3) / 127,
      roll: v.getInt8(o + 4) / 127,
      jump: !!(f & 1),
      boost: !!(f & 2),
      handbrake: !!(f & 4),
    });
  }
  return { seq, inputs };
}

/** quantise an input the way the network will, so host and guest simulate the same thing */
export function quant(i: Input): Input {
  const q = (x: number) => Math.max(-127, Math.min(127, Math.round(x * 127))) / 127;
  return { ...i, throttle: q(i.throttle), steer: q(i.steer), pitch: q(i.pitch), yaw: q(i.yaw), roll: q(i.roll) };
}

function toBuf(d: unknown): ArrayBuffer | null {
  if (d instanceof ArrayBuffer) return d;
  if (ArrayBuffer.isView(d)) return d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer;
  return null;
}

// ---------------------------------------------------------------- host
interface Guest {
  id: string;
  ctl: DataConnection | null;
  gm: DataConnection | null;
  queue: { seq: number; input: Input }[];
  lastSeq: number;
  lastInput: Input | null;
  acked: number;
  ping: number;
}

export class Host {
  peer: Peer;
  code: string;
  guests = new Map<string, Guest>();
  onCtl: (from: string, m: CtlMsg) => void = () => {};
  onJoin: (id: string) => void = () => {};
  onLeave: (id: string) => void = () => {};
  onOpen: () => void = () => {};
  onError: (e: string) => void = () => {};

  constructor(code = makeCode()) {
    this.code = code;
    this.peer = new Peer(PREFIX + code, { config: { iceServers: ICE }, debug: 1 });
    this.peer.on('open', () => this.onOpen());
    this.peer.on('error', (e: Error & { type?: string }) => {
      if (e.type === 'unavailable-id') this.onError('taken');
      else this.onError(e.type ?? e.message);
    });
    this.peer.on('connection', (c) => this.accept(c));
    this.peer.on('disconnected', () => {
      // lost the broker (not the guests): reconnect so new friends can still join
      setTimeout(() => !this.peer.destroyed && this.peer.reconnect(), 1000);
    });
    setInterval(() => this.ping(), 2000);
  }

  private guest(id: string): Guest {
    let g = this.guests.get(id);
    if (!g) {
      g = { id, ctl: null, gm: null, queue: [], lastSeq: -1, lastInput: null, acked: 0, ping: 0 };
      this.guests.set(id, g);
    }
    return g;
  }

  private accept(c: DataConnection): void {
    const g = this.guest(c.peer);
    if (c.label === 'gm') {
      g.gm = c;
      c.on('data', (d) => {
        const b = toBuf(d);
        if (!b) return;
        const p = unpackInputs(b);
        if (!p) return;
        // newest first: push any we haven't seen, oldest first
        for (let k = p.inputs.length - 1; k >= 0; k--) {
          const s = p.seq - k;
          if (s > g.lastSeq) {
            g.queue.push({ seq: s, input: p.inputs[k] });
            g.lastSeq = s;
          }
        }
        // don't let the buffer run away (a guest's clock running fast or a burst)
        if (g.queue.length > 6) g.queue.splice(0, g.queue.length - 3);
      });
    } else {
      g.ctl = c;
      c.on('open', () => this.onJoin(c.peer));
      c.on('data', (d) => {
        const m = d as CtlMsg;
        if (m.t === 'pong') g.ping = performance.now() - m.ts;
        else this.onCtl(c.peer, m);
      });
      c.on('close', () => this.drop(c.peer));
      c.on('error', () => this.drop(c.peer));
    }
  }

  private drop(id: string): void {
    if (!this.guests.has(id)) return;
    this.guests.delete(id);
    this.onLeave(id);
  }

  kick(id: string): void {
    this.send(id, { t: 'kick' });
    setTimeout(() => {
      this.guests.get(id)?.ctl?.close();
      this.drop(id);
    }, 200);
  }

  private ping(): void {
    for (const g of this.guests.values()) if (g.ctl?.open) g.ctl.send({ t: 'ping', ts: performance.now() });
  }

  send(id: string, m: CtlMsg): void {
    const g = this.guests.get(id);
    if (g?.ctl?.open) g.ctl.send(m);
  }

  broadcast(m: CtlMsg): void {
    for (const g of this.guests.values()) if (g.ctl?.open) g.ctl.send(m);
  }

  /** this tick's input for a guest (repeats the last one when the buffer is dry) */
  nextInput(id: string): { input: Input | null; seq: number } {
    const g = this.guests.get(id);
    if (!g) return { input: null, seq: 0 };
    const q = g.queue.shift();
    if (q) {
      g.lastInput = q.input;
      g.acked = q.seq;
    }
    return { input: g.lastInput, seq: g.acked };
  }

  snapshot(buf: Float32Array): void {
    const out = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    for (const g of this.guests.values()) if (g.gm?.open) g.gm.send(out);
  }

  close(): void {
    this.peer.destroy();
  }
}

// ---------------------------------------------------------------- guest
export class Guest2 {
  peer: Peer;
  ctl: DataConnection | null = null;
  gm: DataConnection | null = null;
  id = '';
  onCtl: (m: CtlMsg) => void = () => {};
  onSnap: (s: Float32Array) => void = () => {};
  onOpen: () => void = () => {};
  onClose: (why: string) => void = () => {};
  ping = 0;
  private closed = false;

  constructor(
    readonly code: string,
    hello: { name: string; color: number },
  ) {
    this.peer = new Peer({ config: { iceServers: ICE }, debug: 1 });
    const fail = setTimeout(() => this.close('Could not reach that lobby. Check the code, or the host may have left.'), 15000);
    this.peer.on('open', (id) => {
      this.id = id;
      const host = PREFIX + code.toUpperCase();
      const ctl = (this.ctl = this.peer.connect(host, { label: 'ctl', reliable: true, serialization: 'json' }));
      const gm = (this.gm = this.peer.connect(host, { label: 'gm', reliable: false, serialization: 'raw' }));
      ctl.on('open', () => {
        clearTimeout(fail);
        ctl.send({ t: 'hello', ...hello } satisfies CtlMsg);
        this.onOpen();
      });
      ctl.on('data', (d) => {
        const m = d as CtlMsg;
        if (m.t === 'ping') ctl.send({ t: 'pong', ts: m.ts } satisfies CtlMsg);
        else this.onCtl(m);
      });
      ctl.on('close', () => this.close('The host left the lobby.'));
      gm.on('data', (d) => {
        const b = toBuf(d);
        if (b) this.onSnap(new Float32Array(b));
      });
    });
    this.peer.on('error', (e: Error & { type?: string }) => {
      if (e.type === 'peer-unavailable') this.close(`No lobby with code ${code.toUpperCase()}.`);
      else if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') this.close('Network trouble reaching the lobby server.');
    });
  }

  send(m: CtlMsg): void {
    if (this.ctl?.open) this.ctl.send(m);
  }

  inputs(buf: ArrayBuffer): void {
    if (this.gm?.open) this.gm.send(buf);
  }

  close(why = ''): void {
    if (this.closed) return;
    this.closed = true;
    this.peer.destroy();
    this.onClose(why);
  }
}
