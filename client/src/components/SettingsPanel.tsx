import { useEffect, useRef, useState } from "react";
import type { RoomHook } from "../sync/useRoom";
import type { ControlsMode } from "../sync/protocol";
import { SlidersIcon } from "./Icons";

type Props = { rh: RoomHook };

const MODES: { value: ControlsMode; label: string }[] = [
  { value: "EVERYONE", label: "Everyone" },
  { value: "ADMIN_ONLY", label: "Admins only" },
];

const fmtMs = (ms: number) => `${ms > 0 ? "+" : ""}${Math.round(ms)} ms`;

export default function SettingsPanel({ rh }: Props) {
  const { room, canControl, isAdmin, actions, audio, sync } = rh;
  const serverVolume = room?.volume;
  const [volume, setVolume] = useState(serverVolume ?? 1);
  const volumeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Follow the room's master volume whenever the server reports a change.
  useEffect(() => {
    if (serverVolume !== undefined) setVolume(serverVolume);
  }, [serverVolume]);

  useEffect(() => () => clearTimeout(volumeTimer.current), []);

  const onVolume = (v: number) => {
    setVolume(v);
    clearTimeout(volumeTimer.current);
    volumeTimer.current = setTimeout(() => actions.setVolume(v), 100);
  };

  const controls = room?.controls ?? "EVERYONE";

  return (
    <div className="card settings">
      <div className="card-head">
        <h2>
          <SlidersIcon size={16} /> Settings
        </h2>
      </div>

      <div className="setting">
        <div className="setting-head">
          <label htmlFor="master-volume">Master volume</label>
          <span className="value">{Math.round(volume * 100)}%</span>
        </div>
        <input
          id="master-volume"
          className="range"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          disabled={!canControl}
          onChange={(e) => onVolume(Number(e.target.value))}
        />
        {!canControl && room && <p className="hint">Only admins can change the volume.</p>}
      </div>

      <div className="setting">
        <div className="setting-head">
          <span id="controls-label">Who can control playback</span>
        </div>
        <div className="seg" role="radiogroup" aria-labelledby="controls-label">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={controls === m.value}
              className={`seg-btn${controls === m.value ? " is-active" : ""}`}
              disabled={!isAdmin}
              onClick={() => actions.setControls(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>
        {!isAdmin && <p className="hint">Only admins can change this.</p>}
      </div>

      <div className="setting">
        <div className="setting-head">
          <label htmlFor="nudge">Sync nudge for this device</label>
          <span className="value">{fmtMs(audio.nudgeMs)}</span>
        </div>
        <input
          id="nudge"
          className="range"
          type="range"
          min={-200}
          max={200}
          step={1}
          value={audio.nudgeMs}
          onChange={(e) => audio.setNudgeMs(Number(e.target.value))}
        />
        <div className="nudge-foot">
          <p className="hint">If this device sounds early or late, nudge it.</p>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => audio.setNudgeMs(0)}
            disabled={audio.nudgeMs === 0}
          >
            Reset
          </button>
        </div>
      </div>

      <div className="stats" aria-label="Sync statistics">
        <div className="stat">
          <span className="stat-label">Offset</span>
          <span className="stat-value">{Math.round(sync.offsetMs)} ms</span>
        </div>
        <div className="stat">
          <span className="stat-label">Round trip</span>
          <span className="stat-value">{Math.round(sync.rttMs)} ms</span>
        </div>
        <div className="stat">
          <span className="stat-label">Samples</span>
          <span className="stat-value">{sync.samples}</span>
        </div>
      </div>
    </div>
  );
}
