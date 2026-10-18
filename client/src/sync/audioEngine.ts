// Plays audio with the Web Audio API so start times are sample-accurate.
// The server says "play track X from position P at server time T"; this file turns that into
// an AudioContext start time on this device, corrected for clock offset and speaker latency.

import { Clock, now } from "./clock";

export type LoadState = "loading" | "ready" | "error";

const START_GUARD_S = 0.03; // never schedule closer than this to "now"
const DRIFT_CHECK_MS = 2000;
const MAX_DRIFT_S = 0.025; // re-align if we are further off than this

type Current = {
  trackId: string;
  source: AudioBufferSourceNode;
  /** position in the song (s) at which the source started */
  startOffset: number;
  /** server time that corresponds to `startOffset` being heard */
  targetServer: number;
  /** AudioContext time the source was started at */
  when: number;
  ended: boolean;
};

export class AudioEngine {
  readonly ctx: AudioContext;
  private gain: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private loads = new Map<string, Promise<AudioBuffer | null>>();
  private current: Current | null = null;
  private wanted: { trackId: string; positionSec: number; serverTime: number } | null = null;
  private driftTimer: ReturnType<typeof setInterval>;
  private volume = 1;
  private spatialGain = 1;
  /** Manual per-device correction in ms; positive plays later. */
  nudgeMs = 0;

  loadState = new Map<string, LoadState>();
  onLoadChange: (() => void) | null = null;
  onEnded: ((trackId: string) => void) | null = null;
  onUnlockChange: (() => void) | null = null;

  private clock: Clock;

  constructor(clock: Clock) {
    this.clock = clock;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: "playback" });
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
    this.ctx.onstatechange = () => this.onUnlockChange?.();
    this.driftTimer = setInterval(() => this.checkDrift(), DRIFT_CHECK_MS);
  }

  get unlocked() {
    return this.ctx.state === "running";
  }

  /** Browsers only allow audio after a user gesture; call this from a click handler. */
  async unlock() {
    if (this.ctx.state !== "running") await this.ctx.resume();
    // Play one silent frame: needed on iOS to really open the audio output.
    const b = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.connect(this.ctx.destination);
    s.start();
    if (this.wanted) this.schedule();
  }

  /** Speaker/output delay of this device in seconds. */
  get outputLatency() {
    return (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
  }

  duration(trackId: string) {
    return this.buffers.get(trackId)?.duration ?? null;
  }

  load(trackId: string, url: string): Promise<AudioBuffer | null> {
    const existing = this.loads.get(trackId);
    if (existing) return existing;
    this.setLoad(trackId, "loading");
    const p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((data) => this.ctx.decodeAudioData(data))
      .then((buf) => {
        this.buffers.set(trackId, buf);
        this.setLoad(trackId, "ready");
        if (this.wanted?.trackId === trackId) this.schedule();
        return buf;
      })
      .catch((err) => {
        console.error("Could not load track", trackId, err);
        this.loads.delete(trackId);
        this.setLoad(trackId, "error");
        return null;
      });
    this.loads.set(trackId, p);
    return p;
  }

  forget(trackId: string) {
    this.buffers.delete(trackId);
    this.loads.delete(trackId);
    this.loadState.delete(trackId);
  }

  private setLoad(id: string, s: LoadState) {
    this.loadState.set(id, s);
    this.onLoadChange?.();
  }

  // ---- playback -----------------------------------------------------------

  play(trackId: string, positionSec: number, serverTime: number) {
    this.wanted = { trackId, positionSec, serverTime };
    this.schedule();
  }

  /** Stop at the given server time (sample accurate), or right away if that has passed. */
  pause(serverTime?: number) {
    this.wanted = null;
    const cur = this.current;
    if (!cur) return;
    const at = serverTime ? Math.max(this.ctx.currentTime, this.ctxTimeForServer(serverTime) - this.outputLatency) : 0;
    cur.ended = true; // a scheduled stop is not a natural end
    try {
      cur.source.stop(at);
    } catch {
      /* already stopped */
    }
    this.current = null;
  }

  /** AudioContext time at which a given server time happens on this device. */
  private ctxTimeForServer(serverTime: number) {
    const local = this.clock.toLocal(serverTime);
    const ts = this.ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime && ts.performanceTime) {
      return ts.contextTime + (local - (performance.timeOrigin + ts.performanceTime)) / 1000;
    }
    return this.ctx.currentTime + (local - now()) / 1000;
  }

  /** Start (or restart) the wanted track at exactly the right place. */
  private schedule() {
    const w = this.wanted;
    if (!w || !this.unlocked) return;
    const buffer = this.buffers.get(w.trackId);
    if (!buffer) return; // will be called again when loading finishes

    this.stopSource();

    // If the start time already passed (late joiner, slow load), jump ahead to catch up.
    const earliestServer = this.clock.serverNow() + START_GUARD_S * 1000 + this.outputLatency * 1000 + 50;
    const targetServer = Math.max(w.serverTime, earliestServer);
    const startOffset = w.positionSec + (targetServer - w.serverTime) / 1000;
    if (startOffset >= buffer.duration) return;

    const when = this.ctxTimeForServer(targetServer) - this.outputLatency + this.nudgeMs / 1000;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    const cur: Current = { trackId: w.trackId, source, startOffset, targetServer, when, ended: false };
    source.onended = () => {
      if (cur.ended) return;
      cur.ended = true;
      if (this.current === cur) {
        this.current = null;
        this.wanted = null;
        this.onEnded?.(cur.trackId);
      }
    };
    source.start(Math.max(this.ctx.currentTime, when), startOffset);
    this.current = cur;
  }

  private stopSource() {
    const cur = this.current;
    if (!cur) return;
    cur.ended = true;
    try {
      cur.source.stop();
    } catch {
      /* not started */
    }
    this.current = null;
  }

  /** Clocks drift and the offset estimate improves over time, so re-check alignment. */
  private checkDrift() {
    const cur = this.current;
    if (!cur || !this.wanted || !this.unlocked) return;
    const shouldBe = this.ctxTimeForServer(cur.targetServer) - this.outputLatency + this.nudgeMs / 1000;
    if (Math.abs(shouldBe - cur.when) > MAX_DRIFT_S) this.schedule();
  }

  /** Re-align immediately, e.g. after the user changes the nudge. */
  resync() {
    if (this.wanted) this.schedule();
  }

  // ---- volume -------------------------------------------------------------

  setVolume(volume: number) {
    this.volume = volume;
    this.applyGain();
  }

  setSpatialGain(gain: number) {
    this.spatialGain = gain;
    this.applyGain();
  }

  private applyGain() {
    const v = Math.max(0, Math.min(1, this.volume * this.spatialGain));
    this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.08);
  }

  /** Song position (s) this device is playing right now, or null if silent. */
  position() {
    const cur = this.current;
    if (!cur) return null;
    const heard = this.ctx.currentTime - this.outputLatency;
    return Math.max(cur.startOffset, cur.startOffset + (heard - cur.when));
  }

  destroy() {
    clearInterval(this.driftTimer);
    this.stopSource();
    void this.ctx.close();
  }
}
