import type { RoomHook } from "../sync/useRoom";
import { CrownIcon, ShieldIcon, UsersIcon } from "./Icons";

type Props = { rh: RoomHook };

export default function Listeners({ rh }: Props) {
  const { room, me, isAdmin, actions } = rh;
  const clients = room?.clients ?? [];

  return (
    <div className="card listeners">
      <div className="card-head">
        <h2>
          <UsersIcon size={16} /> Listeners
        </h2>
        <span className="muted">{clients.length}</span>
      </div>
      <ul className="client-list">
        {clients.map((c) => {
          const isMe = c.clientId === me?.clientId;
          return (
            <li key={c.clientId} className={`client${isMe ? " is-me" : ""}`}>
              <span className="avatar" aria-hidden="true">
                {c.username.charAt(0).toUpperCase()}
              </span>
              <div className="client-main">
                <div className="client-name">
                  <span className="client-username" title={c.username}>
                    {c.username}
                  </span>
                  {isMe && <span className="tag tag-you">you</span>}
                  {c.isCreator && (
                    <span className="crown" title="Room creator" aria-label="Room creator">
                      <CrownIcon size={14} />
                    </span>
                  )}
                  {c.isAdmin && <span className="tag tag-admin">admin</span>}
                </div>
                <span className="client-rtt">{c.rtt > 0 ? `${Math.round(c.rtt)} ms` : "— ms"}</span>
              </div>
              {isAdmin && !isMe && !c.isCreator && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => actions.setAdmin(c.clientId, !c.isAdmin)}
                  aria-label={`${c.isAdmin ? "Remove admin from" : "Make admin"} ${c.username}`}
                >
                  <ShieldIcon size={14} />
                  {c.isAdmin ? "Remove admin" : "Make admin"}
                </button>
              )}
            </li>
          );
        })}
        {clients.length === 0 && <li className="muted small">Connecting to the room…</li>}
      </ul>
    </div>
  );
}
