import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { RoomHook } from "../sync/useRoom";
import { CrownIcon, SendIcon } from "./Icons";

type Props = { rh: RoomHook };

const MAX_LENGTH = 2000;

export default function Chat({ rh }: Props) {
  const { room, me, actions } = rh;
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const messages = room?.chat ?? [];
  const count = messages.length;

  // Keep the newest message in view.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    actions.sendChat(t.slice(0, MAX_LENGTH));
    setText("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="card chat">
      <div className="card-head">
        <h2>Chat</h2>
      </div>
      <div className="chat-messages" ref={listRef} role="log" aria-live="polite" aria-label="Chat messages">
        {messages.length === 0 && <p className="empty-inline">No messages yet.</p>}
        {messages.map((m) => {
          const mine = m.clientId === me?.clientId;
          return (
            <div key={m.id} className={`msg${mine ? " is-mine" : ""}`}>
              <div className="msg-head">
                <span className="msg-user">
                  {m.username}
                  {m.isCreator && <span className="crown-inline" aria-label="Room creator"><CrownIcon size={11} /></span>}
                </span>
                <span className="msg-time">
                  {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <p className="msg-text">{m.text}</p>
            </div>
          );
        })}
      </div>
      <div className="chat-compose">
        <input
          className="input"
          type="text"
          value={text}
          maxLength={MAX_LENGTH}
          placeholder="Say something…"
          aria-label="Chat message"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!room}
        />
        <button
          type="button"
          className="btn btn-primary btn-icon"
          onClick={send}
          disabled={!room || text.trim() === ""}
          aria-label="Send message"
        >
          <SendIcon size={18} />
        </button>
      </div>
    </div>
  );
}
