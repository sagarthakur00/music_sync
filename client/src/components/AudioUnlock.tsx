import { useState } from "react";
import type { RoomHook } from "../sync/useRoom";

type Props = { audio: RoomHook["audio"] };

/** Browsers only allow audio after a user gesture, so the room waits behind this overlay. */
export default function AudioUnlock({ audio }: Props) {
  const [busy, setBusy] = useState(false);

  const unlock = async () => {
    setBusy(true);
    try {
      await audio.unlock();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="unlock-overlay" role="dialog" aria-modal="true" aria-labelledby="unlock-title">
      <div className="unlock-card">
        <div className="unlock-pulse" aria-hidden="true" />
        <h2 id="unlock-title">Tap to start audio</h2>
        <p>Browsers need one tap before a page can play sound. Every device in the room will start together.</p>
        <button className="btn btn-primary btn-lg" onClick={unlock} disabled={busy} autoFocus aria-label="Tap to start audio">
          {busy ? <span className="spinner" aria-hidden="true" /> : null}
          Tap to start audio
        </button>
      </div>
    </div>
  );
}
