// One hook that owns the socket, clock and audio engine for a room.
// The UI only reads `state` and calls `actions` — it never touches sockets or audio directly.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock } from "./clock";
import { AudioEngine, type LoadState } from "./audioEngine";
import type { ControlsMode, RoomState, ServerMessage } from "./protocol";
import { getClientId } from "../lib/identity";

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed";

export type RoomHook = {
  status: ConnectionStatus;
  clientId: string;
  room: RoomState | null;
  me: RoomState["clients"][number] | null;
  canControl: boolean;
  isAdmin: boolean;
  error: string | null;
  clearError: () => void;
  sync: { offsetMs: number; rttMs: number; synced: boolean; samples: number };
  audio: {
    unlocked: boolean;
    unlock: () => Promise<void>;
    loadState: Record<string, LoadState>;
    duration: (trackId: string) => number | null;
    /** Current song position in seconds (derived from the shared clock). */
    getPosition: () => number;
    nudgeMs: number;
    setNudgeMs: (ms: number) => void;
  };
  actions: {
    play: (trackId: string, positionSec?: number) => void;
    pause: () => void;
    resume: () => void;
    seek: (positionSec: number) => void;
    next: () => void;
    prev: () => void;
    upload: (files: FileList | File[]) => Promise<void>;
    uploading: boolean;
    deleteTrack: (trackId: string) => void;
    reorderTracks: (trackIds: string[]) => void;
    setVolume: (volume: number) => void;
    setSpatial: (enabled: boolean) => void;
    setListeningSource: (x: number, y: number) => void;
    moveClient: (clientId: string, x: number, y: number) => void;
    sendChat: (text: string) => void;
    setControls: (mode: ControlsMode) => void;
    setAdmin: (clientId: string, isAdmin: boolean) => void;
  };
};

const NUDGE_KEY = "music_sync.nudgeMs";

function wsUrl(roomId: string, clientId: string, username: string) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const base = import.meta.env.VITE_SERVER_URL as string | undefined;
  const host = base ? base.replace(/^http/, "ws").replace(/\/$/, "") : `${proto}://${location.host}`;
  const q = new URLSearchParams({ roomId, clientId, username });
  return `${host}/ws?${q}`;
}

export const apiBase = () => ((import.meta.env.VITE_SERVER_URL as string | undefined) ?? "").replace(/\/$/, "");

export function useRoom(roomId: string, username: string): RoomHook {
  const clientId = useMemo(getClientId, []);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, force] = useState(0);
  const rerender = useCallback(() => force((n) => n + 1), []);
  const [uploading, setUploading] = useState(false);
  const [nudgeMs, setNudge] = useState(() => Number(safeGet(NUDGE_KEY)) || 0);

  const clockRef = useRef<Clock>(null as unknown as Clock);
  const engineRef = useRef<AudioEngine | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const roomRef = useRef<RoomState | null>(null);
  if (!clockRef.current) clockRef.current = new Clock();

  const send = useCallback((msg: object) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  // Audio engine lives as long as the room page.
  useEffect(() => {
    const engine = new AudioEngine(clockRef.current);
    engine.nudgeMs = nudgeMs;
    engine.onLoadChange = rerender;
    engine.onUnlockChange = rerender;
    engine.onEnded = (trackId) => send({ type: "TRACK_ENDED", trackId });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Socket with automatic reconnect.
  useEffect(() => {
    let closedByUs = false;
    let retry = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const clock = clockRef.current;
    let rttTimer: ReturnType<typeof setInterval> | undefined;

    const connect = () => {
      const ws = new WebSocket(wsUrl(roomId, clientId, username));
      wsRef.current = ws;
      ws.onopen = () => {
        retry = 0;
        setStatus("open");
        clock.onUpdate = rerender;
        clock.start((t0) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: "NTP_REQUEST", t0 })));
        rttTimer = setInterval(() => clock.synced && send({ type: "REPORT_RTT", rtt: clock.rtt }), 3000);
      };
      ws.onmessage = (ev) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        handle(msg);
      };
      ws.onclose = () => {
        clock.stop();
        clearInterval(rttTimer);
        if (closedByUs) return setStatus("closed");
        setStatus("reconnecting");
        retryTimer = setTimeout(connect, Math.min(8000, 500 * 2 ** retry++));
      };
    };

    const handle = (msg: ServerMessage) => {
      const engine = engineRef.current;
      switch (msg.type) {
        case "NTP_RESPONSE":
          clock.handleResponse(msg.t0, msg.t1, msg.t2);
          if (clock.sampleCount === 1 || clock.sampleCount === 8) applyPlayback(roomRef.current, true);
          return;
        case "ROOM_STATE": {
          const prev = roomRef.current;
          roomRef.current = msg.room;
          setRoom(msg.room);
          if (!engine) return;
          // Preload every track so switching songs is instant.
          for (const t of msg.room.tracks) void engine.load(t.id, apiBase() + t.url);
          for (const id of engine.loadState.keys()) if (!msg.room.tracks.some((t) => t.id === id)) engine.forget(id);
          engine.setVolume(msg.room.volume);
          engine.setSpatialGain(msg.room.gains[clientId] ?? 1);
          // First state after (re)joining: catch up with whatever is already playing.
          if (!prev) applyPlayback(msg.room, false);
          return;
        }
        case "SCHEDULED_ACTION": {
          const a = msg.action;
          if (!engine) return;
          if (a.type === "PLAY") engine.play(a.trackId, a.positionSec, a.serverTime);
          else engine.pause(a.serverTime);
          return;
        }
        case "ERROR":
          setError(msg.error);
          return;
      }
    };

    /** Make local audio match the room's playback state (used when joining late). */
    const applyPlayback = (r: RoomState | null, onlyIfPlaying: boolean) => {
      const engine = engineRef.current;
      if (!r || !engine) return;
      const p = r.playback;
      if (p.state === "playing" && p.trackId) engine.play(p.trackId, p.positionSec, p.anchorServerTime);
      else if (!onlyIfPlaying) engine.pause();
    };

    connect();
    return () => {
      closedByUs = true;
      clearTimeout(retryTimer);
      clearInterval(rttTimer);
      clock.stop();
      wsRef.current?.close();
      roomRef.current = null;
    };
  }, [roomId, clientId, username, rerender, send]);

  const me = room?.clients.find((c) => c.clientId === clientId) ?? null;
  const canControl = !!room && !!me && (room.controls === "EVERYONE" || me.isAdmin);

  const getPosition = useCallback(() => {
    const r = roomRef.current;
    if (!r) return 0;
    const p = r.playback;
    if (p.state !== "playing") return p.positionSec;
    const elapsed = (clockRef.current.serverNow() - p.anchorServerTime) / 1000;
    return Math.max(p.positionSec, p.positionSec + elapsed);
  }, []);

  const step = useCallback(
    (dir: 1 | -1) => {
      const r = roomRef.current;
      if (!r || r.tracks.length === 0) return;
      const idx = r.tracks.findIndex((t) => t.id === r.playback.trackId);
      // "Previous" restarts the song if we're more than 3s in, like most players.
      if (dir === -1 && idx >= 0 && getPosition() > 3) return send({ type: "PLAY", trackId: r.tracks[idx].id, positionSec: 0 });
      const nextIdx = idx < 0 ? 0 : (idx + dir + r.tracks.length) % r.tracks.length;
      send({ type: "PLAY", trackId: r.tracks[nextIdx].id, positionSec: 0 });
    },
    [send, getPosition],
  );

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (!list.length) return;
      const form = new FormData();
      list.forEach((f) => form.append("files", f));
      setUploading(true);
      try {
        const res = await fetch(`${apiBase()}/api/rooms/${roomId}/tracks`, {
          method: "POST",
          body: form,
          headers: { "x-client-id": clientId },
        });
        if (!res.ok) setError((await res.json().catch(() => null))?.error ?? `Upload failed (${res.status})`);
      } catch {
        setError("Upload failed. Check your connection.");
      } finally {
        setUploading(false);
      }
    },
    [roomId, clientId],
  );

  const engine = engineRef.current;
  const loadState: Record<string, LoadState> = {};
  engine?.loadState.forEach((v, k) => (loadState[k] = v));
  const clock = clockRef.current;

  return {
    status,
    clientId,
    room,
    me,
    canControl,
    isAdmin: !!me?.isAdmin,
    error,
    clearError: () => setError(null),
    sync: { offsetMs: clock.offset, rttMs: clock.rtt, synced: clock.synced, samples: clock.sampleCount },
    audio: {
      unlocked: !!engine?.unlocked,
      unlock: async () => {
        await engineRef.current?.unlock();
        rerender();
      },
      loadState,
      duration: (id) => engineRef.current?.duration(id) ?? null,
      getPosition,
      nudgeMs,
      setNudgeMs: (ms) => {
        const v = Math.max(-500, Math.min(500, Math.round(ms)));
        setNudge(v);
        safeSet(NUDGE_KEY, String(v));
        if (engineRef.current) {
          engineRef.current.nudgeMs = v;
          engineRef.current.resync();
        }
      },
    },
    actions: {
      play: (trackId, positionSec = 0) => send({ type: "PLAY", trackId, positionSec }),
      pause: () => send({ type: "PAUSE" }),
      resume: () => {
        const r = roomRef.current;
        const id = r?.playback.trackId ?? r?.tracks[0]?.id;
        if (id) send({ type: "PLAY", trackId: id, positionSec: r?.playback.trackId ? r.playback.positionSec : 0 });
      },
      seek: (positionSec) => send({ type: "SEEK", positionSec }),
      next: () => step(1),
      prev: () => step(-1),
      upload,
      uploading,
      deleteTrack: (trackId) => send({ type: "DELETE_TRACK", trackId }),
      reorderTracks: (trackIds) => send({ type: "REORDER_TRACKS", trackIds }),
      setVolume: (volume) => send({ type: "SET_VOLUME", volume }),
      setSpatial: (enabled) => send({ type: enabled ? "START_SPATIAL" : "STOP_SPATIAL" }),
      setListeningSource: (x, y) => send({ type: "SET_LISTENING_SOURCE", x, y }),
      moveClient: (id, x, y) => send({ type: "MOVE_CLIENT", clientId: id, x, y }),
      sendChat: (text) => send({ type: "CHAT", text }),
      setControls: (mode) => send({ type: "SET_CONTROLS", mode }),
      setAdmin: (id, isAdmin) => send({ type: "SET_ADMIN", clientId: id, isAdmin }),
    },
  };
}

function safeGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
}
