import Peer, { type DataConnection } from 'peerjs';
import type { Outfit } from './bean.ts';

/**
 * Party play, peer to peer over WebRTC (PeerJS's public broker only introduces the browsers). The
 * host's browser runs the show: the bots, the clock the obstacles turn to, who finished where, who
 * is out. Everyone runs their own bean themselves (no lag on your own jumps) and sends where it is;
 * the host sends everyone everything. Two channels per guest: 'ctl' (reliable JSON: the lobby and
 * the show) and 'gm' (unreliable binary: bean states, 30 a second each way).
 *
 * A room is a 4-letter code; the host's peer id is PREFIX + code.
 */

const PREFIX = 'wobblemania-v1-';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ICE: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
  { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
];
/** the most humans in a show (the rest of the 24 are bots) */
export const MAX_PLAYERS = 12;

export interface Member {
  /** 'host' or the guest's peer id */
  id: string;
  name: string;
  outfit: Outfit;
}

export interface NetContestant {
  id: number;
  name: string;
  outfit: Outfit;
  skill: number;
  style: string;
  owner: string;
  human: boolean;
}

export type CtlMsg =
  | { t: 'hello'; name: string; outfit: Outfit }
  | { t: 'welcome'; id: string; members: Member[]; inShow: boolean }
  | { t: 'members'; members: Member[]; inShow: boolean }
  | { t: 'show'; roster: NetContestant[] }
  /** load round `idx`; `order`: the contestants' ids in grid order; `time`: the host's clock */
  | { t: 'round'; idx: number; order: number[]; slots: number; out: number[]; key: number }
  /** a guest has the round built */
  | { t: 'loaded' }
  /** the countdown: GO at host time `go` */
  | { t: 'count'; go: number }
  /** a finish (guest → host: mine crossed; host → all: its place) */
  | { t: 'fin'; id: number; place?: number }
  /** out of a survival round (guest → host: mine fell; host → all: it's out) */
  | { t: 'out'; id: number }
  /** the round is over: who goes through */
  | { t: 'end'; through: number[]; fins: [number, number][] }
  | { t: 'results' }
  | { t: 'champion' }
  /** a bean did something to someone else's (sent to the host, which passes it on to the owner) */
  | { t: 'shove'; id: number; kind: 'knock' | 'grab'; v: [number, number, number] }
  | { t: 'lobby' }
  | { t: 'ping'; ts: number; ht: number; rtt: number }
  | { t: 'pong'; ts: number }
  | { t: 'kick'; why: string };

export const makeCode = () => Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');

// ---------------------------------------------------------------- bean states
/** floats per bean: id, pos, vel, yaw, flags, quat, progress */
export const STRIDE = 14;
/** flags: mode (2 bits), grounded, holding, held, fell, and this packet's events */
export const F = { GROUND: 4, HOLD: 8, HELD: 16, FELL: 32, HOP: 64, DIVE: 128, KNOCK: 256, GRAB: 512 } as const;

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
  ping: number;
}

export class PartyHost {
  readonly peer: Peer;
  readonly guests = new Map<string, Guest>();
  onCtl: (from: string, m: CtlMsg) => void = () => {};
  onState: (from: string, s: Float32Array) => void = () => {};
  onJoin: (id: string) => void = () => {};
  onLeave: (id: string) => void = () => {};
  onOpen: () => void = () => {};
  onError: (e: string) => void = () => {};
  /** the host's clock (the show's world time), for the pings */
  clock: () => number = () => 0;
  private timer: number;
  private opened = false;

  constructor(readonly code = makeCode()) {
    this.peer = new Peer(PREFIX + code, { config: { iceServers: ICE }, debug: 1 });
    this.peer.on('open', () => {
      this.opened = true;
      this.onOpen();
    });
    this.peer.on('error', (e: Error & { type?: string }) => {
      console.warn('[party] host', e.type, e.message);
      // (once the party is open, losing the broker or one guest's link doesn't end it)
      if (e.type === 'unavailable-id') this.onError('taken');
      else if (!this.opened) this.onError(e.type ?? e.message);
    });
    this.peer.on('connection', (c) => this.accept(c));
    this.peer.on('disconnected', () => setTimeout(() => !this.peer.destroyed && this.peer.reconnect(), 1000));
    this.timer = window.setInterval(() => this.ping(), 1000);
  }

  private guest(id: string): Guest {
    let g = this.guests.get(id);
    if (!g) this.guests.set(id, (g = { id, ctl: null, gm: null, ping: 0 }));
    return g;
  }

  private accept(c: DataConnection) {
    const g = this.guest(c.peer);
    if (c.label === 'gm') {
      g.gm = c;
      c.on('data', (d) => {
        const b = toBuf(d);
        if (b && b.byteLength >= 4) this.onState(c.peer, new Float32Array(b));
      });
      return;
    }
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

  private drop(id: string) {
    if (!this.guests.delete(id)) return;
    this.onLeave(id);
  }

  kick(id: string, why: string) {
    this.send(id, { t: 'kick', why });
    setTimeout(() => {
      this.guests.get(id)?.ctl?.close();
      this.drop(id);
    }, 300);
  }

  private ping() {
    for (const g of this.guests.values()) if (g.ctl?.open) g.ctl.send({ t: 'ping', ts: performance.now(), ht: this.clock(), rtt: g.ping / 1000 } satisfies CtlMsg);
  }

  send(id: string, m: CtlMsg) {
    const g = this.guests.get(id);
    if (g?.ctl?.open) g.ctl.send(m);
  }

  broadcast(m: CtlMsg) {
    for (const g of this.guests.values()) if (g.ctl?.open) g.ctl.send(m);
  }

  /** every bean's state to every guest */
  states(buf: Float32Array) {
    const out = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    for (const g of this.guests.values()) if (g.gm?.open) g.gm.send(out);
  }

  close() {
    clearInterval(this.timer);
    this.peer.destroy();
  }
}

// ---------------------------------------------------------------- guest
export class PartyGuest {
  readonly peer: Peer;
  private ctl: DataConnection | null = null;
  private gm: DataConnection | null = null;
  id = '';
  onCtl: (m: CtlMsg) => void = () => {};
  onState: (s: Float32Array) => void = () => {};
  onOpen: () => void = () => {};
  onClose: (why: string) => void = () => {};
  /** the host's clock minus ours (performance.now() seconds), smoothed; and the round trip */
  offset = NaN;
  rtt = 0.1;
  private closed = false;

  constructor(
    readonly code: string,
    hello: { name: string; outfit: Outfit },
  ) {
    this.peer = new Peer({ config: { iceServers: ICE }, debug: 1 });
    const fail = setTimeout(() => this.close('Could not reach that party. Check the code, or the host may have left.'), 15000);
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
        if (m.t === 'ping') {
          ctl.send({ t: 'pong', ts: m.ts } satisfies CtlMsg);
          if (m.rtt > 0) this.rtt = Math.min(1, m.rtt);
          // (the host's clock as of the ping, plus half the last round trip)
          const est = m.ht + this.rtt / 2 - performance.now() / 1000;
          this.offset = Number.isNaN(this.offset) || Math.abs(est - this.offset) > 0.5 ? est : this.offset + (est - this.offset) * 0.2;
        } else if (m.t === 'kick') this.close(m.why);
        else this.onCtl(m);
      });
      ctl.on('close', () => this.close('The host left the party.'));
      gm.on('data', (d) => {
        const b = toBuf(d);
        if (b && b.byteLength >= 4) this.onState(new Float32Array(b));
      });
    });
    this.peer.on('error', (e: Error & { type?: string }) => {
      console.warn('[party] guest', e.type, e.message);
      // (once in, the broker going away doesn't matter: the link to the host is direct)
      if (this.ctl?.open) return;
      if (e.type === 'peer-unavailable') this.close(`No party with code ${code.toUpperCase()}.`);
      else if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') this.close('Network trouble reaching the party server.');
    });
  }

  /** the host's clock now (NaN until the first ping) */
  hostTime() {
    return performance.now() / 1000 + this.offset;
  }

  send(m: CtlMsg) {
    if (this.ctl?.open) this.ctl.send(m);
  }

  state(buf: Float32Array) {
    if (this.gm?.open) this.gm.send(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  }

  close(why = '') {
    if (this.closed) return;
    this.closed = true;
    this.peer.destroy();
    this.onClose(why);
  }
}
