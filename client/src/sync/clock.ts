// NTP-style clock sync: estimate how far this device's clock is from the server's.
//
// For each probe: t0 = sent (client), t1 = received (server), t2 = replied (server), t3 = received (client)
//   offset = ((t1 - t0) + (t2 - t3)) / 2     server time ≈ local time + offset
//   rtt    = (t3 - t0) - (t2 - t1)
// Probes with the smallest round trip are the most accurate, so we only trust the fastest half.

export const now = () => performance.timeOrigin + performance.now();

const MAX_SAMPLES = 16;
const INITIAL_INTERVAL_MS = 50;
const STEADY_INTERVAL_MS = 2500;

type Sample = { offset: number; rtt: number };

export class Clock {
  private samples: Sample[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  offset = 0;
  rtt = 0;
  /** Fires whenever the estimate changes. */
  onUpdate: (() => void) | null = null;
  private send: ((t0: number) => void) | null = null;

  get synced() {
    return this.samples.length >= MAX_SAMPLES / 2;
  }

  get sampleCount() {
    return this.samples.length;
  }

  start(send: (t0: number) => void) {
    this.stop();
    this.send = send;
    this.samples = [];
    this.tick();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.send = null;
  }

  private tick = () => {
    if (!this.send) return;
    this.send(now());
    const interval = this.samples.length < MAX_SAMPLES ? INITIAL_INTERVAL_MS : STEADY_INTERVAL_MS;
    this.timer = setTimeout(this.tick, interval);
  };

  handleResponse(t0: number, t1: number, t2: number) {
    const t3 = now();
    const rtt = t3 - t0 - (t2 - t1);
    if (!Number.isFinite(rtt) || rtt < 0 || rtt > 10_000) return;
    const offset = (t1 - t0 + (t2 - t3)) / 2;
    this.samples.push({ offset, rtt });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();

    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, Math.max(1, Math.ceil(this.samples.length / 2)));
    this.offset = best.reduce((s, x) => s + x.offset, 0) / best.length;
    this.rtt = best.reduce((s, x) => s + x.rtt, 0) / best.length;
    this.onUpdate?.();
  }

  serverNow() {
    return now() + this.offset;
  }

  /** Convert a server timestamp into this device's clock. */
  toLocal(serverTime: number) {
    return serverTime - this.offset;
  }
}
