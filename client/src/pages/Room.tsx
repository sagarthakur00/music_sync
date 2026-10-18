import { useEffect, useState } from "react";
import { useRoom } from "../sync/useRoom";
import { getUsername } from "../lib/identity";
import { navigate } from "../lib/router";
import AudioUnlock from "../components/AudioUnlock";
import Chat from "../components/Chat";
import Listeners from "../components/Listeners";
import NowPlaying from "../components/NowPlaying";
import SettingsPanel from "../components/SettingsPanel";
import SpatialGrid from "../components/SpatialGrid";
import SyncBadge from "../components/SyncBadge";
import TrackList from "../components/TrackList";
import Uploader from "../components/Uploader";
import { ChatIcon, CopyIcon, MusicIcon, UsersIcon } from "../components/Icons";

type Pane = "music" | "room" | "chat";

const TABS: { id: Pane; label: string; icon: typeof MusicIcon }[] = [
  { id: "music", label: "Music", icon: MusicIcon },
  { id: "room", label: "Room", icon: UsersIcon },
  { id: "chat", label: "Chat", icon: ChatIcon },
];

/** Clipboard API first (needs HTTPS), then a hidden textarea for plain-HTTP LAN dev. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export default function Room({ roomId }: { roomId: string }) {
  // Read once per mount: the name is stable for the whole visit.
  const [username] = useState(getUsername);
  const rh = useRoom(roomId, username);
  const [pane, setPane] = useState<Pane>("music");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (copyState === "idle") return;
    const t = setTimeout(() => setCopyState("idle"), 2000);
    return () => clearTimeout(t);
  }, [copyState]);

  const copyLink = async () => {
    const ok = await copyText(location.href);
    setCopyState(ok ? "copied" : "failed");
  };

  const paneClass = (p: Pane, extra = "") => `pane pane-${p}${pane === p ? " is-active" : ""}${extra ? ` ${extra}` : ""}`;

  const banner =
    rh.status === "reconnecting"
      ? "Reconnecting…"
      : rh.status === "closed"
        ? "Disconnected from the room."
        : rh.status === "connecting" && !rh.room
          ? "Joining room…"
          : null;

  return (
    <div className="room">
      <header className="topbar">
        <button type="button" className="brand" onClick={() => navigate("/")} aria-label="music_sync, back to home">
          music_sync
        </button>

        <div className="room-code-block">
          <span className="label">Room</span>
          <span className="room-code" aria-label={`Room code ${roomId}`}>
            {roomId}
          </span>
        </div>

        <div className="topbar-actions">
          <SyncBadge sync={rh.sync} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={copyLink} aria-label="Copy room link">
            <CopyIcon size={14} />
            {copyState === "copied" ? "Copied!" : copyState === "failed" ? "Copy failed" : "Copy link"}
          </button>
        </div>
      </header>

      {banner && (
        <div className={`status-banner${rh.status === "closed" ? " is-error" : ""}`} role="status">
          {banner}
        </div>
      )}

      {!rh.audio.unlocked && <AudioUnlock audio={rh.audio} />}

      {rh.error && (
        <div className="toast" role="alert">
          <span>{rh.error}</span>
          <button type="button" className="toast-close" onClick={rh.clearError} aria-label="Dismiss message">
            ×
          </button>
        </div>
      )}

      <main className="room-grid">
        <div className="col col-left">
          <div className={paneClass("music")}>
            <Uploader rh={rh} />
            <TrackList rh={rh} />
          </div>
        </div>

        <div className="col col-center">
          <div className="np-full">
            <NowPlaying rh={rh} />
          </div>
          <div className={paneClass("room")}>
            <SpatialGrid rh={rh} />
          </div>
        </div>

        <div className="col col-right">
          <div className={paneClass("room")}>
            <Listeners rh={rh} />
          </div>
          <div className={paneClass("chat")}>
            <Chat rh={rh} />
          </div>
          <div className={paneClass("room")}>
            <SettingsPanel rh={rh} />
          </div>
        </div>
      </main>

      <div className="dock">
        <div className="np-mini">
          <NowPlaying rh={rh} compact />
        </div>
        <nav className="tabbar" aria-label="Room sections">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`tab${pane === id ? " is-active" : ""}`}
              aria-pressed={pane === id}
              onClick={() => setPane(id)}
            >
              <Icon size={20} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
