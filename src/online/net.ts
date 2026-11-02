import Peer, { type DataConnection } from 'peerjs';

/**
 * Online races, peer to peer over WebRTC (PeerJS's public broker only introduces the browsers).
 * The host's browser runs the session: the lobby, the AI cars, the start lights. Everyone drives
 * their own car themselves (no lag on your own inputs) and sends where it is; the host passes every
 * car to everyone. Two channels per guest: 'ctl' (reliable JSON: lobby, start, finishes, chat) and
 * 'st' (unreliable binary: car states, 30 a second each way).
 *
 * A room is a 4-letter code; the host's peer id is PREFIX + code.
 */

const PREFIX = 'apexgp-race-v1-';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ICE: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
  { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
];
/** the most humans in a lobby */
export const MAX_PLAYERS = 12;

export interface Member {
  /** 'host' or the guest's peer id */
  id: string;
  name: string;
  /** index into TEAMS */
  team: number;
  ready: boolean;
  /** round trip to the host (ms) */
  ping: number;
  /** still loading the circuit / racing (not in the lobby) */
  busy?: boolean;
  /** this room's standings: F1 points from every race here, and wins */
  points?: number;
  wins?: number;
}

/** what the host picks for the next race */
export interface LobbySettings {
  track: string;
  laps: number;
  /** AI cars filling the grid: 0 none, else how many */
  ai: number;
  /** index into the AI levels (RaceSync AI_LEVELS) */
  level: number;
  weather: string;
  time: string;
  /** car-to-car contact between players */
  contact: boolean;
  damage: 'off' | 'visual' | 'full';
  /** grid: 'random' the players spread through the field, 'back' the players start behind the AI */
  grid: 'random' | 'back';
}

/** one car on the grid: its entry (team + seat) and who drives it */
export interface GridSlot {
  team: number;
  seat: 0 | 1;
  /** member id, or '' for an AI car */
  owner: string;
  name: string;
}

export interface RaceConfig {
  settings: LobbySettings;
  grid: GridSlot[];
  seed: number;
  formSeed: number;
  wxSeed: number;
  /** a number for this race (stale messages from the last one are dropped) */
  raceId: number;
  /** session clock origin: car states carry time since it */
  epoch: number;
}

export type CtlMsg =
  | { t: 'hello'; name: string; team: number }
  | { t: 'welcome'; id: string; members: Member[]; settings: LobbySettings; racing: boolean }
  | { t: 'members'; members: Member[]; settings: LobbySettings; racing: boolean }
  /** a guest changes their own details */
  | { t: 'me'; name?: string; team?: number; ready?: boolean; busy?: boolean }
  /** travel to the circuit and build the race */
  | { t: 'load'; cfg: RaceConfig }
  /** a guest has the circuit built */
  | { t: 'loaded'; raceId: number }
  /** the lights start at host clock `at`, out `hold` seconds after the fifth */
  | { t: 'start'; raceId: number; at: number; hold: number }
  /** a car took the flag (owner → host → all): race time incl. penalties */
  | { t: 'fin'; raceId: number; id: number; time: number; laps: number }
  /** quick chat */
  | { t: 'chat'; from: string; text: string }
  /** the race is over for the lobby: back to it */
  | { t: 'lobby' }
  | { t: 'ping'; ts: number; ht: number; rtt: number }
  | { t: 'pong'; ts: number }
  | { t: 'kick'; why: string };

export const makeCode = () => Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');

function toBuf(d: unknown): ArrayBuffer | null {
  if (d instanceof ArrayBuffer) return d;
  if (ArrayBuffer.isView(d)) return d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer;
  return null;
}

// ---------------------------------------------------------------- host
interface Guest {
  id: string;
  ctl: DataConnection | null;
  st: DataConnection | null;
  ping: number;
}

export class RaceHost {
  readonly peer: Peer;
  readonly guests = new Map<string, Guest>();
  onCtl: (from: string, m: CtlMsg) => void = () => {};
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
      console.warn('[online] host', e.type, e.message);
      // (once the room is open, losing the broker or one guest's link doesn't end it)
      if (e.type === 'unavailable-id') this.onError('taken');
      else if (!this.opened) this.onError(e.type ?? e.message);
    });
    this.peer.on('connection', (c) => this.accept(c));
    this.peer.on('disconnected', () => setTimeout(() => !this.peer.destroyed && this.peer.reconnect(), 1000));
    this.timer = window.setInterval(() => this.ping(), 1000);
  }

  /** the session clock (s): the host's own */
  now() {
    return performance.now() / 1000;
  }

  pingOf(id: string) {
    return this.guests.get(id)?.ping ?? 0;
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
        const b = toBuf(d);
        if (b && b.byteLength >= 4) this.onState(c.peer, new Float32Array(b));
      });
      return;
    }
    g.ctl = c;
    c.on('data', (d) => {
      const m = d as CtlMsg;
      if (m.t === 'pong') g.ping = performance.now() - m.ts;
      else this.onCtl(c.peer, m);
    });
    c.on('open', () => this.onJoin(c.peer));
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
    for (const g of this.guests.values()) if (g.ctl?.open) g.ctl.send({ t: 'ping', ts: performance.now(), ht: this.now(), rtt: g.ping / 1000 } satisfies CtlMsg);
  }

  send(id: string, m: CtlMsg) {
    const g = this.guests.get(id);
    if (g?.ctl?.open) g.ctl.send(m);
  }

  broadcast(m: CtlMsg, except?: string) {
    for (const g of this.guests.values()) if (g.id !== except && g.ctl?.open) g.ctl.send(m);
  }

  /** car states to one guest */
  states(id: string, buf: Float32Array) {
    const g = this.guests.get(id);
    if (g?.st?.open) g.st.send(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  }

  close() {
    clearInterval(this.timer);
    this.peer.destroy();
  }
}

// ---------------------------------------------------------------- guest
export class RaceGuest {
  readonly peer: Peer;
  private ctl: DataConnection | null = null;
  private st: DataConnection | null = null;
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
    hello: { name: string; team: number },
  ) {
    this.peer = new Peer({ config: { iceServers: ICE }, debug: 1 });
    const fail = setTimeout(() => this.close('Could not reach that room. Check the code, or the host may have left.'), 15000);
    this.peer.on('open', (id) => {
      this.id = id;
      const host = PREFIX + code.toUpperCase();
      const ctl = (this.ctl = this.peer.connect(host, { label: 'ctl', reliable: true, serialization: 'json' }));
      const st = (this.st = this.peer.connect(host, { label: 'st', reliable: false, serialization: 'raw' }));
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
      ctl.on('close', () => this.close('The host closed the room.'));
      st.on('data', (d) => {
        const b = toBuf(d);
        if (b && b.byteLength >= 4) this.onState(new Float32Array(b));
      });
    });
    this.peer.on('error', (e: Error & { type?: string }) => {
      console.warn('[online] guest', e.type, e.message);
      // (once in, the broker going away doesn't matter: the link to the host is direct)
      if (this.ctl?.open) return;
      if (e.type === 'peer-unavailable') this.close(`No room with code ${code.toUpperCase()}.`);
      else if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') this.close('Network trouble reaching the room server.');
    });
  }

  /** the session clock: the host's, as best we know it (ours until the first ping) */
  now() {
    return performance.now() / 1000 + (Number.isNaN(this.offset) ? 0 : this.offset);
  }

  send(m: CtlMsg) {
    if (this.ctl?.open) this.ctl.send(m);
  }

  state(buf: Float32Array) {
    if (this.st?.open) this.st.send(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  }

  close(why = '') {
    if (this.closed) return;
    this.closed = true;
    this.peer.destroy();
    this.onClose(why);
  }
}
