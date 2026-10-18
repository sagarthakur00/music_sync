// Room state and the rules for changing it. No network code here, so it can be unit tested.

export const GRID = { SIZE: 100, ORIGIN: 50, CLIENT_RADIUS: 25 };
export const MAX_CHAT = 100;
export const MAX_CHAT_LENGTH = 2000;
const MIN_LEAD_MS = 400; // never schedule closer than this into the future
const LEAD_PER_RTT = 1.5; // extra lead scales with the slowest client's round trip

/** High-resolution wall clock in ms. Clients sync to this. */
export const serverNow = () => performance.timeOrigin + performance.now();

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class Room {
  constructor(id) {
    this.id = id;
    /** @type {Map<string, {clientId:string, username:string, isAdmin:boolean, isCreator:boolean, rtt:number, position:{x:number,y:number}, joinedAt:number, send:(msg:object)=>void}>} */
    this.clients = new Map();
    /** @type {{id:string, name:string, url:string, size:number}[]} */
    this.tracks = [];
    this.playback = { state: "paused", trackId: null, positionSec: 0, anchorServerTime: 0 };
    this.controls = "EVERYONE"; // or ADMIN_ONLY
    this.spatial = { enabled: false, listening: { x: GRID.ORIGIN, y: GRID.ORIGIN } };
    this.volume = 1;
    this.chat = [];
    this.chatSeq = 0;
    this.emptySince = Date.now();
    this.createdAt = Date.now();
  }

  // ---- membership -------------------------------------------------------

  join(clientId, username, send) {
    const existing = this.clients.get(clientId);
    const isFirst = this.clients.size === 0 && !this.hadCreator;
    const client = {
      clientId,
      username: String(username || "listener").slice(0, 40),
      isAdmin: existing?.isAdmin ?? isFirst,
      isCreator: existing?.isCreator ?? isFirst,
      rtt: existing?.rtt ?? 0,
      position: existing?.position ?? { x: GRID.ORIGIN, y: GRID.ORIGIN },
      joinedAt: existing?.joinedAt ?? Date.now(),
      send,
    };
    if (isFirst) this.hadCreator = true;
    this.clients.set(clientId, client);
    this.emptySince = null;
    this.ensureAdmin();
    this.layoutClients();
    return client;
  }

  leave(clientId) {
    this.clients.delete(clientId);
    if (this.clients.size === 0) this.emptySince = Date.now();
    this.ensureAdmin();
    this.layoutClients();
  }

  /** If no admin is left, promote whoever has been here longest. */
  ensureAdmin() {
    const list = [...this.clients.values()];
    if (list.length && !list.some((c) => c.isAdmin)) {
      list.sort((a, b) => a.joinedAt - b.joinedAt)[0].isAdmin = true;
    }
  }

  /** Place clients evenly on a circle around the grid centre. */
  layoutClients() {
    const list = [...this.clients.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    const n = list.length;
    list.forEach((c, i) => {
      if (c.manuallyPlaced) return;
      if (n === 1) {
        c.position = { x: GRID.ORIGIN, y: GRID.ORIGIN };
        return;
      }
      const angle = (2 * Math.PI * i) / n - Math.PI / 2;
      c.position = {
        x: +(GRID.ORIGIN + GRID.CLIENT_RADIUS * Math.cos(angle)).toFixed(2),
        y: +(GRID.ORIGIN + GRID.CLIENT_RADIUS * Math.sin(angle)).toFixed(2),
      };
    });
  }

  canControl(clientId) {
    const c = this.clients.get(clientId);
    if (!c) return false;
    return this.controls === "EVERYONE" || c.isAdmin;
  }

  isAdmin(clientId) {
    return !!this.clients.get(clientId)?.isAdmin;
  }

  // ---- playback ---------------------------------------------------------

  /** Where the song is right now (seconds), based on the playback anchor. */
  currentPosition(at = serverNow()) {
    const p = this.playback;
    if (p.state !== "playing") return p.positionSec;
    return p.positionSec + Math.max(0, at - p.anchorServerTime) / 1000;
  }

  /** How far ahead to schedule so every client gets the message in time. */
  leadMs() {
    let maxRtt = 0;
    for (const c of this.clients.values()) maxRtt = Math.max(maxRtt, c.rtt || 0);
    return Math.round(Math.max(MIN_LEAD_MS, maxRtt * LEAD_PER_RTT + 200));
  }

  /** Returns the scheduled action to broadcast, or null when the request is invalid. */
  schedulePlay(trackId, positionSec) {
    const track = this.tracks.find((t) => t.id === trackId);
    if (!track) return null;
    const at = serverNow() + this.leadMs();
    const pos = Math.max(0, Number(positionSec) || 0);
    this.playback = { state: "playing", trackId, positionSec: pos, anchorServerTime: at };
    return { type: "PLAY", trackId, positionSec: pos, serverTime: at };
  }

  schedulePause() {
    if (this.playback.state !== "playing") return null;
    const at = serverNow() + this.leadMs();
    const pos = this.currentPosition(at);
    this.playback = { ...this.playback, state: "paused", positionSec: pos, anchorServerTime: at };
    return { type: "PAUSE", trackId: this.playback.trackId, positionSec: pos, serverTime: at };
  }

  /** Seek keeps the current play/pause state. */
  scheduleSeek(positionSec) {
    const { trackId, state } = this.playback;
    if (!trackId) return null;
    if (state === "playing") return this.schedulePlay(trackId, positionSec);
    this.playback = { ...this.playback, positionSec: Math.max(0, Number(positionSec) || 0) };
    return { type: "PAUSE", trackId, positionSec: this.playback.positionSec, serverTime: serverNow() };
  }

  /** Several clients report the same end; only the first one for the current track counts. */
  handleTrackEnded(trackId) {
    if (this.playback.state !== "playing" || this.playback.trackId !== trackId) return null;
    const idx = this.tracks.findIndex((t) => t.id === trackId);
    const next = this.tracks[idx + 1];
    if (!next) {
      this.playback = { state: "paused", trackId: null, positionSec: 0, anchorServerTime: serverNow() };
      return { type: "STOP", serverTime: serverNow() };
    }
    return this.schedulePlay(next.id, 0);
  }

  addTrack(track) {
    this.tracks.push(track);
  }

  removeTrack(trackId) {
    const before = this.tracks.length;
    this.tracks = this.tracks.filter((t) => t.id !== trackId);
    if (this.tracks.length === before) return { removed: false, action: null };
    if (this.playback.trackId === trackId) {
      this.playback = { state: "paused", trackId: null, positionSec: 0, anchorServerTime: serverNow() };
      return { removed: true, action: { type: "STOP", serverTime: serverNow() } };
    }
    return { removed: true, action: null };
  }

  reorderTracks(trackIds) {
    if (!Array.isArray(trackIds)) return false;
    const byId = new Map(this.tracks.map((t) => [t.id, t]));
    const ordered = trackIds.map((id) => byId.get(id)).filter(Boolean);
    if (ordered.length !== this.tracks.length) return false;
    this.tracks = ordered;
    return true;
  }

  // ---- spatial audio ----------------------------------------------------

  /** Gain per client: louder the closer the device is to the listening point. */
  gains() {
    const out = {};
    for (const c of this.clients.values()) {
      if (!this.spatial.enabled) {
        out[c.clientId] = 1;
        continue;
      }
      const dx = c.position.x - this.spatial.listening.x;
      const dy = c.position.y - this.spatial.listening.y;
      const dist = Math.hypot(dx, dy);
      const maxDist = GRID.SIZE * 0.6;
      // Smooth falloff, never fully silent so nobody thinks their device broke.
      out[c.clientId] = +clamp(1 - (dist / maxDist) ** 1.5, 0.08, 1).toFixed(3);
    }
    return out;
  }

  setListening(x, y) {
    this.spatial.listening = { x: clamp(+x || 0, 0, GRID.SIZE), y: clamp(+y || 0, 0, GRID.SIZE) };
  }

  moveClient(clientId, x, y) {
    const c = this.clients.get(clientId);
    if (!c) return false;
    c.position = { x: clamp(+x || 0, 0, GRID.SIZE), y: clamp(+y || 0, 0, GRID.SIZE) };
    c.manuallyPlaced = true;
    return true;
  }

  // ---- chat -------------------------------------------------------------

  addChat(clientId, text) {
    const c = this.clients.get(clientId);
    const clean = String(text ?? "").trim().slice(0, MAX_CHAT_LENGTH);
    if (!c || !clean) return null;
    const msg = {
      id: ++this.chatSeq,
      clientId,
      username: c.username,
      text: clean,
      timestamp: Date.now(),
      isCreator: c.isCreator,
    };
    this.chat.push(msg);
    if (this.chat.length > MAX_CHAT) this.chat.splice(0, this.chat.length - MAX_CHAT);
    return msg;
  }

  // ---- snapshots --------------------------------------------------------

  snapshot() {
    return {
      id: this.id,
      clients: [...this.clients.values()]
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map(({ clientId, username, isAdmin, isCreator, rtt, position }) => ({
          clientId,
          username,
          isAdmin,
          isCreator,
          rtt: Math.round(rtt),
          position,
        })),
      tracks: this.tracks,
      playback: this.playback,
      controls: this.controls,
      spatial: this.spatial,
      gains: this.gains(),
      volume: this.volume,
      chat: this.chat,
    };
  }

  summary() {
    const track = this.tracks.find((t) => t.id === this.playback.trackId);
    return {
      id: this.id,
      listeners: this.clients.size,
      trackCount: this.tracks.length,
      nowPlaying: this.playback.state === "playing" ? track?.name ?? null : null,
    };
  }
}
