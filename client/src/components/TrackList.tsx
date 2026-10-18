import type { RoomHook } from "../sync/useRoom";
import { formatBytes } from "../lib/format";
import { ArrowDownIcon, ArrowUpIcon, MusicIcon, TrashIcon } from "./Icons";

type Props = { rh: RoomHook };

function Equaliser({ active }: { active: boolean }) {
  return (
    <span className={`eq${active ? " is-active" : ""}`} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export default function TrackList({ rh }: Props) {
  const { room, canControl, actions, audio } = rh;
  const tracks = room?.tracks ?? [];
  const playingId = room?.playback.trackId ?? null;
  const playing = room?.playback.state === "playing";

  const move = (index: number, dir: -1 | 1) => {
    const ids = tracks.map((t) => t.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    actions.reorderTracks(ids);
  };

  return (
    <div className="card tracklist">
      <div className="card-head">
        <h2>Tracks</h2>
        <span className="muted">{tracks.length}</span>
      </div>

      {tracks.length === 0 ? (
        <div className="empty">
          <MusicIcon size={28} />
          <p>Upload songs to get started</p>
        </div>
      ) : (
        <ol className="track-list">
          {tracks.map((t, i) => {
            const isPlaying = t.id === playingId;
            const load = audio.loadState[t.id];
            return (
              <li key={t.id} className={`track${isPlaying ? " is-playing" : ""}`}>
                <button
                  type="button"
                  className="track-main"
                  onClick={() => canControl && actions.play(t.id, 0)}
                  disabled={!canControl}
                  aria-current={isPlaying ? "true" : undefined}
                  aria-label={`${canControl ? "Play" : "Track"} ${t.name}`}
                >
                  <span className="track-index">{isPlaying ? <Equaliser active={playing} /> : i + 1}</span>
                  <span className="track-info">
                    <span className="track-name">{t.name}</span>
                    <span className="track-meta">
                      {formatBytes(t.size)}
                      {load === "loading" && (
                        <span className="load-state">
                          <span className="spinner spinner-sm" aria-hidden="true" /> Loading
                        </span>
                      )}
                      {load === "error" && <span className="load-state is-error">Failed to load</span>}
                    </span>
                  </span>
                </button>
                {canControl && (
                  <div className="track-actions">
                    <button
                      type="button"
                      className="btn btn-icon btn-ghost btn-sm"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label={`Move ${t.name} up`}
                    >
                      <ArrowUpIcon size={16} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-icon btn-ghost btn-sm"
                      onClick={() => move(i, 1)}
                      disabled={i === tracks.length - 1}
                      aria-label={`Move ${t.name} down`}
                    >
                      <ArrowDownIcon size={16} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-icon btn-ghost btn-sm btn-danger"
                      onClick={() => actions.deleteTrack(t.id)}
                      aria-label={`Delete ${t.name}`}
                    >
                      <TrashIcon size={16} />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
