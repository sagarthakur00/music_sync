# music_sync

Play the same song on many devices at once, in sync. Open a room on your laptop, join from phones and
other computers, upload songs, and every device plays together like one big speaker system.

## Run locally

Requirements: Node.js 20 or newer.

```bash
cd ~/Desktop/music_sync
npm install
npm run dev
```

- App: http://localhost:5173
- Server: http://localhost:8080

**Phones on the same Wi-Fi:** Vite prints a `Network:` URL (for example `http://192.168.1.5:5173`).
Open that on the phone. Phones block audio until you tap, so tap **Tap to start audio** on each device.

### Production mode (one port)

```bash
npm start          # builds the client, then serves everything from http://localhost:8080
```

### Tests

```bash
npm test           # server room logic tests
```

## How the sync works

1. **Clock sync (NTP style).** Each device sends `NTP_REQUEST` probes (every 50 ms at first, then every
   2.5 s). The server stamps when it got and answered each one. The device keeps the fastest 50% of
   the last 16 probes and works out how far its clock is from the server's (`client/src/sync/clock.ts`).
2. **Scheduled playback.** Play, pause and seek requests go to the server, which picks a start time a
   little in the future: at least 400 ms, more if a device is on a slow connection. It then sends
   `SCHEDULED_ACTION { trackId, positionSec, serverTime }` to everyone (`server/src/room.js`).
3. **Sample-accurate start.** Each device converts that server time to its own `AudioContext` time,
   subtracts its speaker latency and starts a Web Audio buffer at exactly that moment
   (`client/src/sync/audioEngine.ts`).
4. **Drift correction.** Every 2 s the device checks if it has drifted more than 25 ms and re-aligns.
5. **Late joiners** start at the song's current position.
6. **Nudge.** If one device (for example Bluetooth speakers) still sounds early or late, use the
   "Sync nudge" slider in Settings. The value is saved per device.

## Features

- 6-digit rooms, shareable link, random usernames
- Upload many audio files (mp3, wav, ogg, m4a, flac, opus), reorder, delete, auto-advance
- Shared play, pause, seek, next and previous
- Spatial audio: drag the target on the room map, and nearby devices play louder
- Shared master volume, chat, listener list with ping
- Permissions: the room creator is admin and can make others admin; "who can control playback"
  can be Everyone or Admins only
- Auto reconnect; empty rooms and their uploads are deleted after 10 minutes

## Project layout

```
server/            Node + Express + ws
  src/index.js     HTTP API, uploads, WebSocket message handling
  src/room.js      room state and rules (unit tested)
  test/
client/            React + TypeScript + Vite
  src/sync/        clock sync, audio engine, useRoom hook (core logic)
  src/pages/       Home, Room
  src/components/  UI pieces
```

## Configuration

| Variable          | Where  | Default             | Meaning                                       |
| ----------------- | ------ | ------------------- | --------------------------------------------- |
| `PORT`            | server | `8080`              | HTTP and WebSocket port                       |
| `UPLOAD_DIR`      | server | `server/uploads`    | where uploaded songs are stored               |
| `MAX_UPLOAD_MB`   | server | `60`                | max size per file                             |
| `SERVER_URL`      | vite   | `http://localhost:8080` | dev proxy target                          |
| `VITE_SERVER_URL` | client | same origin         | set when the API runs on a different domain   |

## Deploy (Render, free)

`render.yaml` is ready. Render builds the client and runs one Node service that serves everything on a
single HTTPS URL (WebSockets included).

1. Push this folder to a GitHub repo (see below).
2. On https://render.com, sign in with GitHub, then **New + → Blueprint**, pick the repo and click
   **Apply**.
3. Wait for the build (~2–3 min). Your link looks like `https://music-sync-xxxx.onrender.com`.
   Share it with friends.

```bash
cd ~/Desktop/music_sync
git init && git add . && git commit -m "music_sync"
git branch -M main
git remote add origin https://github.com/<your-username>/music_sync.git
git push -u origin main
```

Free plan notes:

- The service sleeps after 15 minutes with no visitors. The first visit after that takes about a
  minute to wake up.
- Disk is temporary: uploaded songs and rooms disappear on restart or redeploy.
- Every push to `main` redeploys automatically.

Built-in limits for a public link (change them with env vars in the Render dashboard):

| Variable               | Default | Meaning                               |
| ---------------------- | ------- | ------------------------------------- |
| `MAX_UPLOAD_MB`        | 40      | max size of one file                  |
| `MAX_ROOM_MB`          | 300     | total music per room                  |
| `MAX_TOTAL_MB`         | 1000    | total music on the server             |
| `MAX_ROOMS`            | 200     | rooms at the same time                |
| `MAX_CLIENTS_PER_ROOM` | 50      | devices per room                      |

Room creation and uploads are also rate-limited per IP, and WebSocket floods are dropped.

Other hosts work too (Railway, Fly.io, a VPS): build with `npm ci --include=dev && npm run build`
and start with `npm run start -w server`. The host must support WebSockets.
