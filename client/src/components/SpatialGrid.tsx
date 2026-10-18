import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { RoomHook } from "../sync/useRoom";
import { GRID, type Position } from "../sync/protocol";

type Props = { rh: RoomHook };

type DragKind = { kind: "source" } | { kind: "self"; clientId: string };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Leading + trailing throttle: sends at most once per `ms`, and always sends the last value. */
function createThrottle(ms: number) {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: (() => void) | null = null;
  const run = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    last = Date.now();
    const fn = pending;
    pending = null;
    fn?.();
  };
  return {
    call(fn: () => void) {
      pending = fn;
      const wait = ms - (Date.now() - last);
      if (wait <= 0) run();
      else if (!timer) timer = setTimeout(run, wait);
    },
    flush() {
      if (pending) run();
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      pending = null;
    },
  };
}

export default function SpatialGrid({ rh }: Props) {
  const { room, me, canControl, actions } = rh;
  const boardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragKind | null>(null);
  const lastPos = useRef<Position>({ x: GRID.ORIGIN, y: GRID.ORIGIN });
  const [drag, setDrag] = useState<(Position & { kind: DragKind["kind"] }) | null>(null);

  const sourceThrottle = useMemo(() => createThrottle(50), []);
  const selfThrottle = useMemo(() => createThrottle(50), []);
  useEffect(
    () => () => {
      sourceThrottle.cancel();
      selfThrottle.cancel();
    },
    [sourceThrottle, selfThrottle],
  );

  const spatialOn = !!room?.spatial.enabled;
  const listening: Position = drag?.kind === "source" ? drag : room?.spatial.listening ?? { x: GRID.ORIGIN, y: GRID.ORIGIN };
  const selfPos: Position | null = me
    ? drag?.kind === "self" ? drag : me.position
    : null;

  const toGrid = (clientX: number, clientY: number): Position | null => {
    const el = boardRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return {
      x: round1(clamp(((clientX - r.left) / r.width) * GRID.SIZE, 0, GRID.SIZE)),
      y: round1(clamp(((clientY - r.top) / r.height) * GRID.SIZE, 0, GRID.SIZE)),
    };
  };

  const startDrag = (e: PointerEvent<HTMLElement>, target: DragKind) => {
    const p = toGrid(e.clientX, e.clientY);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = target;
    lastPos.current = p;
    setDrag({ kind: target.kind, ...p });
  };

  const onBoardPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    // Pressing empty board space moves the listening target there (admins / everyone, depending on mode).
    if (e.target !== e.currentTarget || !canControl) return;
    startDrag(e, { kind: "source" });
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const p = toGrid(e.clientX, e.clientY);
    if (!p) return;
    lastPos.current = p;
    setDrag({ kind: d.kind, ...p });
    if (d.kind === "source") sourceThrottle.call(() => actions.setListeningSource(p.x, p.y));
    else selfThrottle.call(() => actions.moveClient(d.clientId, p.x, p.y));
  };

  const endDrag = () => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    const { x, y } = lastPos.current;
    if (d.kind === "source") {
      sourceThrottle.call(() => actions.setListeningSource(x, y));
      sourceThrottle.flush();
    } else {
      selfThrottle.call(() => actions.moveClient(d.clientId, x, y));
      selfThrottle.flush();
    }
    setDrag(null);
  };

  const pct = (v: number) => `${(clamp(v, 0, GRID.SIZE) / GRID.SIZE) * 100}%`;

  return (
    <div className="card spatial">
      <div className="card-head">
        <h2>Room map</h2>
        <label className="switch">
          <span className="switch-label">Spatial audio</span>
          <button
            type="button"
            role="switch"
            aria-checked={spatialOn}
            aria-label="Spatial audio"
            className={`switch-track${spatialOn ? " is-on" : ""}`}
            disabled={!room}
            onClick={() => actions.setSpatial(!spatialOn)}
          >
            <span className="switch-thumb" />
          </button>
        </label>
      </div>
      <p className="hint">Devices near the target play louder.</p>

      <div
        ref={boardRef}
        className={`board${spatialOn ? "" : " is-off"}${canControl ? " is-editable" : ""}`}
        role="group"
        aria-label="Room map. Drag the target or your dot to change the spatial mix."
        onPointerDown={onBoardPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {room?.clients.map((c) => {
          const isMe = c.clientId === me?.clientId;
          if (isMe) return null;
          const g = clamp(room.gains[c.clientId] ?? 1, 0, 1);
          const size = 10 + g * 12;
          return (
            <div
              key={c.clientId}
              className="dot"
              style={{
                left: pct(c.position.x),
                top: pct(c.position.y),
                width: size,
                height: size,
                opacity: 0.35 + 0.65 * g,
              }}
              title={`${c.username} · ${Math.round(g * 100)}% level`}
            >
              <span className="dot-label">{c.username}</span>
            </div>
          );
        })}

        {me && selfPos && (
          <div
            className="dot is-me is-draggable"
            style={{
              left: pct(selfPos.x),
              top: pct(selfPos.y),
              width: 18,
              height: 18,
              opacity: 1,
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              startDrag(e, { kind: "self", clientId: me.clientId });
            }}
            title="You. Drag to move your device on the map."
          >
            <span className="dot-label">You</span>
          </div>
        )}

        <div
          className={`listening${canControl ? " is-draggable" : ""}${drag?.kind === "source" ? " is-dragging" : ""}`}
          style={{ left: pct(listening.x), top: pct(listening.y) }}
          onPointerDown={(e) => {
            if (!canControl) return;
            e.stopPropagation();
            startDrag(e, { kind: "source" });
          }}
          role="img"
          aria-label={`Listening point at ${Math.round(listening.x)}, ${Math.round(listening.y)}`}
        >
          <span className="listening-ring" />
          <span className="listening-core" />
        </div>
      </div>

      {!spatialOn && <p className="hint">Spatial audio is off. Every device plays at the same level.</p>}
      {!canControl && room && <p className="hint">Only admins can move the listening point.</p>}
    </div>
  );
}
