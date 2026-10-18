import { useEffect, useRef, useState } from "react";
import { apiBase } from "../sync/useRoom";
import { getUsername, randomUsername, setUsername } from "../lib/identity";
import { navigate } from "../lib/router";
import CodeInput from "../components/CodeInput";
import { MusicIcon, PencilIcon, PlusIcon, RefreshIcon } from "../components/Icons";

type RoomSummary = { id: string; listeners: number; trackCount: number; nowPlaying: string | null };
type RoomsResponse = { rooms: RoomSummary[]; listeners: number };

const POLL_MS = 5000;
const NAME_MAX = 40;

export default function Home() {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [totalListeners, setTotalListeners] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Poll the public room list for the live count and the "Active rooms" card.
  useEffect(() => {
    let alive = true;
    let controller: AbortController | null = null;
    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const res = await fetch(`${apiBase()}/api/rooms`, { signal: controller.signal, cache: "no-store" });
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data = (await res.json()) as RoomsResponse;
        if (!alive) return;
        setRooms(data.rooms);
        setTotalListeners(data.listeners);
        setLoadError(false);
      } catch (err) {
        if (alive && !(err instanceof Error && err.name === "AbortError")) setLoadError(true);
      }
    };
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
      controller?.abort();
    };
  }, []);

  const createRoom = async () => {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch(`${apiBase()}/api/rooms`, { method: "POST" });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = (await res.json()) as { id: string };
      navigate(`/room/${data.id}`);
    } catch {
      setCreateError("Couldn't create a room. Check your connection and try again.");
      setCreating(false);
    }
  };

  const liveText =
    loadError && totalListeners === null
      ? "Can't reach the server"
      : totalListeners === null
        ? "Checking who's listening…"
        : `${totalListeners} ${totalListeners === 1 ? "person" : "people"} listening now`;

  return (
    <main className="home">
      <section className="card home-card" aria-labelledby="app-title">
        <div className="brand-mark" aria-hidden="true">
          <MusicIcon size={22} />
        </div>
        <h1 id="app-title" className="app-title">
          music_sync
        </h1>
        <p className="subtitle">Play the same song on every device, perfectly in sync.</p>

        <p className={`live${loadError ? " is-error" : ""}`} aria-live="polite">
          <span className="dot-live" aria-hidden="true" />
          {liveText}
        </p>

        <div className="field-block">
          <span className="label" id="join-label">
            Join a room
          </span>
          <div role="group" aria-labelledby="join-label">
            <CodeInput onComplete={(code) => navigate(`/room/${code}`)} />
          </div>
        </div>

        <UsernameEditor />

        <button type="button" className="btn btn-primary btn-lg btn-block" onClick={createRoom} disabled={creating}>
          {creating ? <span className="spinner" aria-hidden="true" /> : <PlusIcon size={18} />}
          {creating ? "Creating room…" : "Create new room"}
        </button>
        {createError && (
          <p className="error-text" role="alert">
            {createError}
          </p>
        )}
      </section>

      <section className="card rooms-card" aria-labelledby="rooms-title">
        <div className="card-head">
          <h2 id="rooms-title">Active rooms</h2>
          <span className="muted">{rooms.length}</span>
        </div>
        {rooms.length === 0 ? (
          <div className="empty">
            <p>No active rooms yet. Create one above and share the code.</p>
          </div>
        ) : (
          <ul className="room-list">
            {rooms.map((r) => (
              <li key={r.id}>
                <button type="button" className="room-row" onClick={() => navigate(`/room/${r.id}`)} aria-label={`Join room ${r.id}`}>
                  <span className="room-row-code">{r.id}</span>
                  <span className="room-row-info">
                    <span className="room-row-now">{r.nowPlaying ?? "Idle"}</span>
                    <span className="room-row-meta">
                      {r.listeners} {r.listeners === 1 ? "listener" : "listeners"} · {r.trackCount}{" "}
                      {r.trackCount === 1 ? "track" : "tracks"}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

/** Shows the saved username with regenerate and inline rename. */
function UsernameEditor() {
  const [name, setName] = useState(getUsername);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const cancelled = useRef(false);

  const startEdit = () => {
    cancelled.current = false;
    setDraft(name);
    setEditing(true);
  };

  const save = () => {
    setEditing(false);
    if (cancelled.current) return;
    const next = draft.trim().slice(0, NAME_MAX);
    if (next && next !== name) {
      setUsername(next);
      setName(next);
    }
  };

  const regenerate = () => {
    const next = randomUsername();
    setUsername(next);
    setName(next);
  };

  return (
    <div className="username">
      <p className="username-line">
        You&apos;ll join as{" "}
        {editing ? (
          <input
            className="input input-inline"
            value={draft}
            maxLength={NAME_MAX}
            autoFocus
            aria-label="Username"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                cancelled.current = true;
                e.currentTarget.blur();
              }
            }}
          />
        ) : (
          <button type="button" className="name-btn" onClick={startEdit} aria-label={`Edit username, currently ${name}`}>
            <strong>{name}</strong>
            <PencilIcon size={13} />
          </button>
        )}
      </p>
      <button type="button" className="btn btn-ghost btn-sm" onClick={regenerate} aria-label="Generate a new random username">
        <RefreshIcon size={14} />
        Regenerate
      </button>
    </div>
  );
}
