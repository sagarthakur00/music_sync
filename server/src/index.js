import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, existsSync, unlink } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import { WebSocketServer } from "ws";
import { Room, serverNow } from "./room.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, "..", "uploads"));
const CLIENT_DIST = path.resolve(__dirname, "..", "..", "client", "dist");
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 60;
const MAX_TRACKS_PER_ROOM = 200;
// Limits that keep a public deployment from being filled up or spammed.
const MAX_ROOM_MB = Number(process.env.MAX_ROOM_MB) || 400;
const MAX_TOTAL_MB = Number(process.env.MAX_TOTAL_MB) || 2000;
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 200;
const MAX_CLIENTS_PER_ROOM = Number(process.env.MAX_CLIENTS_PER_ROOM) || 50;
const MB = 1024 * 1024;
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
const ROOM_ID_RE = /^\d{6}$/;
const AUDIO_EXT = new Set([".mp3", ".wav", ".ogg", ".oga", ".m4a", ".aac", ".flac", ".opus", ".webm"]);

mkdirSync(UPLOAD_DIR, { recursive: true });

/** @type {Map<string, Room>} */
const rooms = new Map();
const getRoom = (id, create = false) => {
  let room = rooms.get(id);
  if (!room && create && rooms.size < MAX_ROOMS) {
    room = new Room(id);
    rooms.set(id, room);
  }
  return room;
};

const roomBytes = (room) => room.tracks.reduce((n, t) => n + (t.size || 0), 0);
const totalBytes = () => [...rooms.values()].reduce((n, r) => n + roomBytes(r), 0);

/** Tiny fixed-window rate limiter keyed by IP. Good enough for one server instance. */
function rateLimit(name, max, windowMs) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return (req, res, next) => {
    const key = `${name}:${req.ip}`;
    const n = (hits.get(key) || 0) + 1;
    hits.set(key, n);
    if (n > max) return res.status(429).json({ error: "Too many requests, slow down a bit." });
    next();
  };
}

// ---------------------------------------------------------------- HTTP ----

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // real client IPs behind Render/Railway/nginx

app.get("/api/health", (_req, res) => res.json({ ok: true, serverTime: serverNow() }));

app.get("/api/rooms", (_req, res) => {
  const list = [...rooms.values()]
    .filter((r) => r.clients.size > 0)
    .map((r) => r.summary())
    .sort((a, b) => b.listeners - a.listeners);
  res.json({ rooms: list, listeners: list.reduce((n, r) => n + r.listeners, 0) });
});

/** Pick a 6-digit code nobody is using. */
app.post("/api/rooms", rateLimit("create", 30, 10 * 60 * 1000), (_req, res) => {
  if (rooms.size >= MAX_ROOMS) return res.status(503).json({ error: "Server is full, try again later." });
  for (let i = 0; i < 50; i++) {
    const id = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
    if (!rooms.has(id)) return res.json({ id });
  }
  res.status(503).json({ error: "Could not allocate a room code, try again." });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = path.join(UPLOAD_DIR, req.params.roomId);
      mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => cb(null, randomUUID() + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => {
    const ok = AUDIO_EXT.has(path.extname(file.originalname).toLowerCase()) || file.mimetype.startsWith("audio/");
    cb(ok ? null : new Error("Only audio files are allowed"), ok);
  },
});

app.post("/api/rooms/:roomId/tracks", rateLimit("upload", 60, 10 * 60 * 1000), (req, res) => {
  const room = ROOM_ID_RE.test(req.params.roomId) && getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: "Room not found" });
  const clientId = String(req.header("x-client-id") || "");
  if (!room.clients.has(clientId)) return res.status(403).json({ error: "Join the room first" });
  if (!room.canControl(clientId)) return res.status(403).json({ error: "Only admins can add tracks" });
  if (room.tracks.length >= MAX_TRACKS_PER_ROOM) return res.status(400).json({ error: "Track limit reached" });
  const incoming = Number(req.header("content-length")) || 0;
  if (roomBytes(room) + incoming > MAX_ROOM_MB * MB)
    return res.status(413).json({ error: `This room can hold up to ${MAX_ROOM_MB} MB of music. Delete some tracks first.` });
  if (totalBytes() + incoming > MAX_TOTAL_MB * MB)
    return res.status(507).json({ error: "The server is out of space right now. Try again later." });

  upload.array("files")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const added = (req.files || []).map((f) => {
      // multer decodes names as latin1; re-decode so non-English names survive
      const original = Buffer.from(f.originalname, "latin1").toString("utf8");
      const track = {
        id: path.parse(f.filename).name,
        name: original.replace(/\.[^.]+$/, ""),
        url: `/uploads/${room.id}/${f.filename}`,
        size: f.size,
      };
      room.addTrack(track);
      return track;
    });
    broadcastState(room);
    res.json({ tracks: added });
  });
});

app.use(
  "/uploads",
  express.static(UPLOAD_DIR, { maxAge: "1h", immutable: true, fallthrough: false }),
);

if (existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { index: false }));
  app.get(/^(?!\/api|\/uploads|\/ws).*/, (_req, res) => res.sendFile(path.join(CLIENT_DIST, "index.html")));
}

// ----------------------------------------------------------- WebSocket ----

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 64 * 1024 });

const send = (ws, msg) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
};

function broadcast(room, msg) {
  const data = JSON.stringify(msg);
  for (const c of room.clients.values()) c.send(data, true);
}

function broadcastState(room) {
  broadcast(room, { type: "ROOM_STATE", room: room.snapshot() });
}

function broadcastAction(room, action) {
  if (!action) return;
  broadcast(room, { type: "SCHEDULED_ACTION", action });
  broadcastState(room);
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const roomId = url.searchParams.get("roomId") || "";
  const clientId = (url.searchParams.get("clientId") || "").slice(0, 64);
  const username = url.searchParams.get("username") || "listener";

  if (!ROOM_ID_RE.test(roomId) || !clientId) {
    send(ws, { type: "ERROR", error: "Invalid room or client id" });
    return ws.close(1008, "invalid");
  }

  const room = getRoom(roomId, true);
  if (!room) {
    send(ws, { type: "ERROR", error: "The server is full right now. Try again later." });
    return ws.close(1013, "full");
  }
  if (!room.clients.has(clientId) && room.clients.size >= MAX_CLIENTS_PER_ROOM) {
    send(ws, { type: "ERROR", error: `This room is full (${MAX_CLIENTS_PER_ROOM} devices max).` });
    return ws.close(1013, "room full");
  }
  // A reconnect from the same browser replaces the old socket.
  const previous = room.clients.get(clientId);
  if (previous?.ws && previous.ws !== ws) previous.ws.close(4000, "replaced");

  const client = room.join(clientId, username, (data, raw) => (raw ? ws.readyState === ws.OPEN && ws.send(data) : send(ws, data)));
  client.ws = ws;
  ws.isAlive = true;

  send(ws, { type: "WELCOME", clientId, serverTime: serverNow() });
  broadcastState(room);

  ws.on("pong", () => (ws.isAlive = true));

  // Token bucket: allows bursts (clock sync sends ~20/s at start) but stops floods.
  let tokens = 60;
  let lastRefill = Date.now();
  ws.on("message", (raw) => {
    const t = Date.now();
    tokens = Math.min(60, tokens + ((t - lastRefill) / 1000) * 30);
    lastRefill = t;
    if (tokens < 1) return;
    tokens -= 1;
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    // Clock sync has to answer immediately, before anything else.
    if (msg.type === "NTP_REQUEST") {
      const t1 = serverNow();
      return send(ws, { type: "NTP_RESPONSE", t0: msg.t0, t1, t2: serverNow() });
    }
    handleMessage(room, clientId, msg, ws);
  });

  ws.on("close", () => {
    if (room.clients.get(clientId)?.ws !== ws) return; // replaced by a newer socket
    room.leave(clientId);
    broadcastState(room);
  });
});

function handleMessage(room, clientId, msg, ws) {
  const deny = () => send(ws, { type: "ERROR", error: "You don't have permission to do that" });
  const control = () => room.canControl(clientId);

  switch (msg.type) {
    case "REPORT_RTT": {
      const c = room.clients.get(clientId);
      if (!c || !Number.isFinite(msg.rtt)) return;
      const rtt = Math.min(5000, Math.max(0, msg.rtt));
      const changed = Math.abs(rtt - c.rtt) >= 5 || (c.rtt === 0 && rtt > 0);
      c.rtt = rtt;
      if (changed) broadcastState(room); // keeps the ping shown in the listener list fresh
      return;
    }
    case "PLAY":
      if (!control()) return deny();
      return broadcastAction(room, room.schedulePlay(msg.trackId, msg.positionSec));
    case "PAUSE":
      if (!control()) return deny();
      return broadcastAction(room, room.schedulePause());
    case "SEEK":
      if (!control()) return deny();
      return broadcastAction(room, room.scheduleSeek(msg.positionSec));
    case "TRACK_ENDED":
      return broadcastAction(room, room.handleTrackEnded(msg.trackId));
    case "DELETE_TRACK": {
      if (!control()) return deny();
      const track = room.tracks.find((t) => t.id === msg.trackId);
      const { removed, action } = room.removeTrack(msg.trackId);
      if (!removed) return;
      // Free the disk space too, not just the playlist slot.
      if (track) unlink(path.join(UPLOAD_DIR, room.id, path.basename(track.url)), () => {});
      if (action) broadcast(room, { type: "SCHEDULED_ACTION", action });
      return broadcastState(room);
    }
    case "REORDER_TRACKS":
      if (!control()) return deny();
      if (room.reorderTracks(msg.trackIds)) broadcastState(room);
      return;
    case "SET_VOLUME":
      if (!control()) return deny();
      room.volume = Math.min(1, Math.max(0, Number(msg.volume) || 0));
      return broadcastState(room);
    case "START_SPATIAL":
    case "STOP_SPATIAL":
      if (!control()) return deny();
      room.spatial.enabled = msg.type === "START_SPATIAL";
      return broadcastState(room);
    case "SET_LISTENING_SOURCE":
      if (!control()) return deny();
      room.setListening(msg.x, msg.y);
      return broadcastState(room);
    case "MOVE_CLIENT":
      // You can always move yourself; moving others needs control rights.
      if (msg.clientId !== clientId && !control()) return deny();
      if (room.moveClient(msg.clientId, msg.x, msg.y)) broadcastState(room);
      return;
    case "CHAT": {
      const chat = room.addChat(clientId, msg.text);
      if (chat) broadcastState(room);
      return;
    }
    case "SET_CONTROLS":
      if (!room.isAdmin(clientId)) return deny();
      if (msg.mode === "EVERYONE" || msg.mode === "ADMIN_ONLY") {
        room.controls = msg.mode;
        broadcastState(room);
      }
      return;
    case "SET_ADMIN": {
      if (!room.isAdmin(clientId)) return deny();
      const target = room.clients.get(msg.clientId);
      if (!target || target.isCreator) return; // creator always stays admin
      target.isAdmin = !!msg.isAdmin;
      return broadcastState(room);
    }
    default:
      return;
  }
}

// Drop dead sockets and clean up rooms nobody has used for a while.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.clients.size === 0 && room.emptySince && now - room.emptySince > EMPTY_ROOM_TTL_MS) {
      rooms.delete(id);
      rmSync(path.join(UPLOAD_DIR, id), { recursive: true, force: true });
    }
  }
}, 15_000);
wss.on("close", () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`music_sync server on http://localhost:${PORT}`);
});

export { app, server, rooms };
