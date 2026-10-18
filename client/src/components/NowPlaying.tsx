import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { RoomHook } from "../sync/useRoom";
import { formatTime } from "../lib/format";
import { NextIcon, PauseIcon, PlayIcon, PrevIcon } from "./Icons";

type Props = { rh: RoomHook; compact?: boolean };

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export default function NowPlaying({ rh, compact = false }: Props) {
  const { room, canControl, actions, audio } = rh;
  const trackId = room?.playback.trackId ?? null;
  const track = room?.tracks.find((t) => t.id === trackId) ?? null;
  const playing = room?.playback.state === "playing";
  const hasTracks = (room?.tracks.length ?? 0) > 0;

  const barRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const elapsedRef = useRef<HTMLSpanElement>(null);
  const totalRef = useRef<HTMLSpanElement>(null);
  // While the user scrubs, this holds the fraction (0..1) the bar should show.
  const scrubRef = useRef<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);

  // The rAF loop reads the latest values through this ref, so it never has to restart.
  const source = useRef({ trackId, getPosition: audio.getPosition, duration: audio.duration });
  useEffect(() => {
    source.current = { trackId, getPosition: audio.getPosition, duration: audio.duration };
  });

  // Progress is written straight to the DOM every frame; React only re-renders on real state changes.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const s = source.current;
      const dur = s.trackId ? s.duration(s.trackId) : null;
      const validDur = dur && dur > 0 ? dur : null;
      const pos = s.trackId ? s.getPosition() : 0;
      const frac = scrubRef.current ?? (validDur ? clamp01(pos / validDur) : 0);
      const shownSec = scrubRef.current !== null && validDur ? scrubRef.current * validDur : pos;

      if (fillRef.current) fillRef.current.style.width = `${frac * 100}%`;
      if (barRef.current) barRef.current.setAttribute("aria-valuenow", String(Math.round(frac * 100)));
      if (elapsedRef.current) elapsedRef.current.textContent = formatTime(shownSec);
      if (totalRef.current) totalRef.current.textContent = validDur ? formatTime(validDur) : "--:--";
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const fractionFromX = (clientX: number) => {
    const el = barRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return clamp01((clientX - r.left) / r.width);
  };

  const durationNow = () => (trackId ? audio.duration(trackId) : null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!canControl || !trackId) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubRef.current = fractionFromX(e.clientX);
    setScrubbing(true);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (scrubRef.current === null) return;
    scrubRef.current = fractionFromX(e.clientX);
  };

  const endScrub = (e: PointerEvent<HTMLDivElement>, commit: boolean) => {
    if (scrubRef.current === null) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const frac = scrubRef.current;
    scrubRef.current = null;
    setScrubbing(false);
    const dur = durationNow();
    if (commit && dur) actions.seek(frac * dur);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!canControl || !trackId) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const delta = e.key === "ArrowRight" ? 5 : -5;
    actions.seek(Math.max(0, audio.getPosition() + delta));
  };

  const togglePlay = () => (playing ? actions.pause() : actions.resume());

  const controlsDisabled = !room || !canControl;
  const transportDisabled = controlsDisabled || !hasTracks;
  const hint = room && !canControl ? "Only admins can control playback" : null;

  return (
    <section className={`now-playing${compact ? " is-compact" : ""}${playing ? " is-playing" : ""}`} aria-label="Now playing">
      <div className="np-info">
        <div className="np-art" aria-hidden="true">
          <span className="eq">
            <i />
            <i />
            <i />
          </span>
        </div>
        <div className="np-text">
          <span className="np-label">{playing ? "Now playing" : "Paused"}</span>
          <span className="np-title" title={track?.name}>
            {track ? track.name : "Nothing playing"}
          </span>
        </div>
      </div>

      <div className="np-progress">
        <div
          ref={barRef}
          className={`progress${canControl && trackId ? " is-seekable" : ""}${scrubbing ? " is-scrubbing" : ""}`}
          role="slider"
          tabIndex={canControl && trackId ? 0 : -1}
          aria-label="Playback position"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={0}
          aria-disabled={!canControl || !trackId}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => endScrub(e, true)}
          onPointerCancel={(e) => endScrub(e, false)}
          onKeyDown={onKeyDown}
        >
          <div ref={fillRef} className="progress-fill" />
        </div>
        <div className="np-times">
          <span ref={elapsedRef}>0:00</span>
          <span ref={totalRef}>--:--</span>
        </div>
      </div>

      <div className="transport">
        <button
          type="button"
          className="btn btn-icon"
          onClick={actions.prev}
          disabled={transportDisabled}
          aria-label="Previous track"
        >
          <PrevIcon size={compact ? 16 : 20} />
        </button>
        <button
          type="button"
          className="btn btn-icon btn-play"
          onClick={togglePlay}
          disabled={transportDisabled}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <PauseIcon size={compact ? 18 : 24} /> : <PlayIcon size={compact ? 18 : 24} />}
        </button>
        <button
          type="button"
          className="btn btn-icon"
          onClick={actions.next}
          disabled={transportDisabled}
          aria-label="Next track"
        >
          <NextIcon size={compact ? 16 : 20} />
        </button>
      </div>

      {hint && <p className="hint">{hint}</p>}
    </section>
  );
}
