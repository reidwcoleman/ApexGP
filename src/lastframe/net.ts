import Peer, { type DataConnection } from 'peerjs';
import type { Ev, MatchConfig, PlayerInfo, Req } from './shared.ts';

/**
 * Rooms, peer to peer over WebRTC (PeerJS's broker only introduces the browsers). The host's browser
 * runs the match. 'ctl' is reliable JSON (the lobby, shots, hits, doors), 'st' is unreliable binary
 * (where everyone is, 30 a second each way). A room is a 4-letter code.
 */
const PREFIX = 'lastframe-v1-';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ICE: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
  { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
];
export const makeCode = () => Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');

export type Down =
  | { t: 'welcome'; slot: number; cfg: MatchConfig; players: PlayerInfo[]; inGame: boolean; code: string }
  | { t: 'lobby'; cfg: MatchConfig; players: PlayerInfo[]; ready: string[] }
  | { t: 'start'; cfg: MatchConfig; players: PlayerInfo[] }
  | { t: 'end' }
  | { t: 'ev'; e: Ev }
  | { t: 'ping'; ts: number }
  | { t: 'kick'; why: string };
export type Up = Req | { t: 'pong'; ts: number };

function buf(d: unknown): ArrayBuffer | null {
  if (d instanceof ArrayBuffer) return d;
  if (ArrayBuffer.isView(d)) return d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer;
  return null;
}

interface Guest { id: string; ctl: DataConnection | null; st: DataConnection | null; ping: number }

export class Host {
  readonly peer: Peer;
  readonly guests = new Map<string, Guest>();
  onReq: (from: string, m: Req) => void = () => {};
  onState: (from: string, s: Float32Array) => void = () => {};
  onJoin: (id: string) => void = () => {};
  onLeave: (id: string) => void = () => {};
  onOpen: () => void = () => {};
  onError: (e: string) => void = () => {};
  private timer: number;
  private opened = false;

  constructor(readonly code = makeCode()) {
    this.peer = new Peer(PREFIX + code, { config: { iceServers: ICE }, debug: 1 });
    this.peer.on('open', () => {
      this.opened = true;
      this.onOpen();
    });
    this.peer.on('error', (e: Error & { type?: string }) => {
      console.warn('[net] host', e.type, e.message);
      if (e.type === 'unavailable-id') this.onError('taken');
      else if (!this.opened) this.onError(e.type ?? e.message);
    });
    this.peer.on('connection', (c) => this.accept(c));
    this.peer.on('disconnected', () => setTimeout(() => !this.peer.destroyed && this.peer.reconnect(), 1000));
    this.timer = window.setInterval(() => {
      for (const g of this.guests.values()) if (g.ctl?.open) g.ctl.send({ t: 'ping', ts: performance.now() } satisfies Down);
    }, 1000);
  }

  private guest(id: string): Guest {
    let g = this.guests.get(id);
    if (!g) this.guests.set(id, (g = { id, ctl: null, st: null, ping: 0 }));
    return g;
  }

  private accept(c: DataConnection) {
    const g = this.guest(c.peer);
    if (c.label === 'st') {
      g.st = c;
      c.on('data', (d) => {
        const b = buf(d);
        if (b && b.byteLength >= 4) this.onState(c.peer, new Float32Array(b));
      });
      return;
    }
    g.ctl = c;
    c.on('data', (d) => {
      const m = d as Up;
      if (m.t === 'pong') g.ping = performance.now() - m.ts;
      else this.onReq(c.peer, m);
    });
    c.on('open', () => this.onJoin(c.peer));
    c.on('close', () => this.drop(c.peer));
    c.on('error', () => this.drop(c.peer));
  }

  private drop(id: string) {
    if (this.guests.delete(id)) this.onLeave(id);
  }

  send(id: string, m: Down) {
    const g = this.guests.get(id);
    if (g?.ctl?.open) g.ctl.send(m);
  }

  all(m: Down) {
    for (const g of this.guests.values()) if (g.ctl?.open) g.ctl.send(m);
  }

  states(b: Float32Array) {
    const data = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    for (const g of this.guests.values()) if (g.st?.open) g.st.send(data);
  }

  close() {
    clearInterval(this.timer);
    this.peer.destroy();
  }
}

export class Guest_ {
  readonly peer: Peer;
  private ctl: DataConnection | null = null;
  private st: DataConnection | null = null;
  onDown: (m: Down) => void = () => {};
  onState: (s: Float32Array) => void = () => {};
  onClose: (why: string) => void = () => {};
  private closed = false;

  constructor(readonly code: string, hello: Req) {
    this.peer = new Peer({ config: { iceServers: ICE }, debug: 1 });
    const fail = setTimeout(() => this.close('Could not reach that room. Check the code, or the host may have left.'), 15000);
    this.peer.on('open', () => {
      const host = PREFIX + code.toUpperCase();
      const ctl = (this.ctl = this.peer.connect(host, { label: 'ctl', reliable: true, serialization: 'json' }));
      const st = (this.st = this.peer.connect(host, { label: 'st', reliable: false, serialization: 'raw' }));
      ctl.on('open', () => {
        clearTimeout(fail);
        ctl.send(hello);
      });
      ctl.on('data', (d) => {
        const m = d as Down;
        if (m.t === 'ping') ctl.send({ t: 'pong', ts: m.ts } satisfies Up);
        else if (m.t === 'kick') this.close(m.why);
        else this.onDown(m);
      });
      ctl.on('close', () => this.close('The host closed the room.'));
      st.on('data', (d) => {
        const b = buf(d);
        if (b && b.byteLength >= 4) this.onState(new Float32Array(b));
      });
    });
    this.peer.on('error', (e: Error & { type?: string }) => {
      console.warn('[net] guest', e.type, e.message);
      if (this.ctl?.open) return;
      if (e.type === 'peer-unavailable') this.close(`No room with code ${code.toUpperCase()}.`);
      else if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') this.close('Network trouble reaching the room server.');
    });
  }

  send(m: Req) {
    if (this.ctl?.open) this.ctl.send(m);
  }

  state(b: Float32Array) {
    if (this.st?.open) this.st.send(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  }

  close(why = '') {
    if (this.closed) return;
    this.closed = true;
    this.peer.destroy();
    this.onClose(why);
  }
}
