import Peer, { type DataConnection } from 'peerjs';
import type { Ev, MatchConfig, PlayerInfo, Req } from './shared.ts';

/**
 * Rooms, peer to peer over WebRTC (PeerJS's broker only introduces the browsers). The host's browser
 * runs the match. 'ctl' is reliable JSON (the lobby, shots, hits, doors), 'st' is unreliable binary
 * (where everyone is, 30 a second each way). A room is a 4-letter code.
 */
const PREFIX = 'lastframe-v1-';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// these find a browser's public address, which is enough for nearly every home router. There is no relay here for the
// rest (two strict routers that will not talk to each other directly): the free one this used to name stopped answering,
// and a working one needs an account. tools/lastframe/turncheck.mjs asks them
const ICE: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
];
export const makeCode = () => Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');

export type Down =
  | { t: 'welcome'; slot: number; cfg: MatchConfig; players: PlayerInfo[]; inGame: boolean; code: string }
  | { t: 'lobby'; cfg: MatchConfig; players: PlayerInfo[]; ready: string[] }
  | { t: 'start'; cfg: MatchConfig; players: PlayerInfo[] }
  | { t: 'end' }
  | { t: 'ev'; e: Ev }
  | { t: 'ping'; ts: number; rt?: number }
  | { t: 'kick'; why: string };
export type Up = Req | { t: 'pong'; ts: number };

/** a bad line on purpose, for testing: ?net=lag,jitter,loss (milliseconds, milliseconds, 0..1) holds back everything this
 *  browser sends by lag plus up to jitter, and throws away that share of the position packets */
const BAD = (() => {
  const v = new URLSearchParams(location.search).get('net');
  if (!v) return null;
  const [lag, jit, loss] = v.split(',').map(Number);
  return { lag: lag || 0, jit: jit || 0, loss: loss || 0 };
})();
/** when the last message on each reliable line is due: nothing on it may overtake that */
const due = new WeakMap<DataConnection, number>();

function put(c: DataConnection | null, m: unknown, loose = false) {
  if (!c?.open) return;
  const go = () => {
    try {
      if (c.open) c.send(m);
    } catch (e) {
      // a line that is closing: the close handler deals with it
      console.warn('[net] send', (e as Error).message);
    }
  };
  if (!BAD) return go();
  if (loose) {
    if (Math.random() < BAD.loss) return;
    setTimeout(go, BAD.lag + Math.random() * BAD.jit);
    return;
  }
  const at = Math.max(due.get(c) ?? 0, performance.now() + BAD.lag + Math.random() * BAD.jit);
  due.set(c, at);
  setTimeout(go, at - performance.now());
}

/** how long a line may say nothing before it is taken for dead. Long: a browser busy loading the location answers nothing
 *  for a good while and is perfectly well. A line that has really gone is caught sooner, by `watchLine` */
const SILENCE = 45000;

/** the connection itself knows when the other end has stopped answering (it asks every few seconds, off the page's own
 *  thread, so a busy page is not a dead one): gone for good at once, or out of touch for seven seconds, and `dead` is called */
function watchLine(c: DataConnection, dead: () => void) {
  const pc = c.peerConnection as RTCPeerConnection | undefined;
  if (!pc) return;
  let t = 0;
  pc.addEventListener('iceconnectionstatechange', () => {
    const st = pc.iceConnectionState;
    clearTimeout(t);
    if (st === 'failed' || st === 'closed') dead();
    else if (st === 'disconnected') {
      t = window.setTimeout(() => {
        if (pc.iceConnectionState !== 'connected' && pc.iceConnectionState !== 'completed') dead();
      }, 7000);
    }
  });
}

function buf(d: unknown): ArrayBuffer | null {
  if (d instanceof ArrayBuffer) return d;
  if (ArrayBuffer.isView(d)) return d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer;
  return null;
}

interface Guest { id: string; ctl: DataConnection | null; st: DataConnection | null; ping: number; heard: number }

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
      const now = performance.now();
      for (const g of [...this.guests.values()]) {
        // a browser that shut its lid says nothing, and its line can take half a minute to notice: it is let go here
        if (now - g.heard > SILENCE) {
          try {
            g.ctl?.close();
            g.st?.close();
          } catch { /* already gone */ }
          this.drop(g.id);
        } else put(g.ctl, { t: 'ping', ts: now, rt: Math.round(g.ping) } satisfies Down);
      }
    }, 1000);
  }

  /** everyone's round trip, by the id they joined with */
  pings() {
    return new Map([...this.guests.values()].map((g) => [g.id, g.ping]));
  }

  private guest(id: string): Guest {
    let g = this.guests.get(id);
    if (!g) this.guests.set(id, (g = { id, ctl: null, st: null, ping: 0, heard: performance.now() }));
    return g;
  }

  private accept(c: DataConnection) {
    const g = this.guest(c.peer);
    if (c.label === 'st') {
      g.st = c;
      c.on('data', (d) => {
        const b = buf(d);
        g.heard = performance.now();
        if (b && b.byteLength >= 4 && b.byteLength % 4 === 0) this.onState(c.peer, new Float32Array(b));
      });
      return;
    }
    g.ctl = c;
    c.on('data', (d) => {
      const m = d as Up;
      if (!m || typeof m !== 'object') return;
      g.heard = performance.now();
      if (m.t === 'pong') g.ping = g.ping ? g.ping * 0.7 + (performance.now() - m.ts) * 0.3 : performance.now() - m.ts;
      else {
        try {
          this.onReq(c.peer, m);
        } catch (e) {
          // one bad message from one browser must not stop the match for the rest
          console.error('[net] request', m.t, e);
        }
      }
    });
    c.on('open', () => {
      g.heard = performance.now();
      this.onJoin(c.peer);
    });
    // only the line this guest is on now: an old one closing after they came back must not throw them out
    const gone = () => {
      if (this.guests.get(c.peer)?.ctl === c) this.drop(c.peer);
    };
    c.on('close', gone);
    c.on('error', gone);
    watchLine(c, gone);
  }

  /** shown the door: told why, then let go */
  kick(id: string, why: string) {
    const g = this.guests.get(id);
    if (!g) return;
    put(g.ctl, { t: 'kick', why } satisfies Down);
    this.guests.delete(id);
    setTimeout(() => {
      try {
        g.ctl?.close();
        g.st?.close();
      } catch { /* already gone */ }
    }, 400);
  }

  private drop(id: string) {
    if (this.guests.delete(id)) this.onLeave(id);
  }

  send(id: string, m: Down) {
    put(this.guests.get(id)?.ctl ?? null, m);
  }

  all(m: Down) {
    for (const g of this.guests.values()) put(g.ctl, m);
  }

  states(b: Float32Array) {
    const data = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    for (const g of this.guests.values()) put(g.st, data, true);
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
  private heard = performance.now();
  private watch = 0;
  /** round trip to the host, in milliseconds */
  ping = 0;

  constructor(readonly code: string, hello: Req) {
    this.peer = new Peer({ config: { iceServers: ICE }, debug: 1 });
    let found = false;
    const fail = setTimeout(() => this.close(found
      ? "Found the room, but your network and the host's will not connect directly. Try another network (a phone hotspot often works)."
      : 'Could not reach that room. Check the code, or the host may have left.'), 15000);
    this.peer.on('open', () => {
      const host = PREFIX + code.toUpperCase();
      const ctl = (this.ctl = this.peer.connect(host, { label: 'ctl', reliable: true, serialization: 'json' }));
      const st = (this.st = this.peer.connect(host, { label: 'st', reliable: false, serialization: 'raw' }));
      // the room server passed the host's answer on: the room exists, whether or not the two networks then connect
      (ctl.peerConnection as RTCPeerConnection | undefined)?.addEventListener('signalingstatechange', function (this: RTCPeerConnection) {
        if (this.signalingState === 'stable' && this.remoteDescription) found = true;
      });
      ctl.on('open', () => {
        clearTimeout(fail);
        this.heard = performance.now();
        put(ctl, hello);
        // a host whose machine went to sleep closes nothing: silence is how it shows
        this.watch = window.setInterval(() => {
          if (performance.now() - this.heard > SILENCE) this.close('Lost the connection to the host.');
        }, 1000);
      });
      ctl.on('data', (d) => {
        const m = d as Down;
        if (!m || typeof m !== 'object') return;
        this.heard = performance.now();
        if (m.t === 'ping') {
          // the host's clock went out and came back: the difference since the last one is the round trip's wobble, not its
          // length, so the host sends that back in the next ping
          put(ctl, { t: 'pong', ts: m.ts } satisfies Up);
          if (m.rt !== undefined) this.ping = m.rt;
        } else if (m.t === 'kick') this.close(m.why);
        else this.onDown(m);
      });
      ctl.on('close', () => this.close('The host closed the room.'));
      ctl.on('error', () => this.close('Lost the connection to the host.'));
      watchLine(ctl, () => this.close('Lost the connection to the host.'));
      st.on('data', (d) => {
        const b = buf(d);
        this.heard = performance.now();
        if (b && b.byteLength >= 4 && b.byteLength % 4 === 0) this.onState(new Float32Array(b));
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
    put(this.ctl, m);
  }

  state(b: Float32Array) {
    put(this.st, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), true);
  }

  close(why = '') {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.watch);
    this.peer.destroy();
    this.onClose(why);
  }
}
