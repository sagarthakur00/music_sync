// Shapes of the messages exchanged with the server (mirrors server/src/room.js).

export type Position = { x: number; y: number };

export type Track = { id: string; name: string; url: string; size: number };

export type Client = {
  clientId: string;
  username: string;
  isAdmin: boolean;
  isCreator: boolean;
  rtt: number;
  position: Position;
};

export type ChatMessage = {
  id: number;
  clientId: string;
  username: string;
  text: string;
  timestamp: number;
  isCreator: boolean;
};

export type Playback = {
  state: "playing" | "paused";
  trackId: string | null;
  positionSec: number;
  anchorServerTime: number;
};

export type ControlsMode = "EVERYONE" | "ADMIN_ONLY";

export type RoomState = {
  id: string;
  clients: Client[];
  tracks: Track[];
  playback: Playback;
  controls: ControlsMode;
  spatial: { enabled: boolean; listening: Position };
  gains: Record<string, number>;
  volume: number;
  chat: ChatMessage[];
};

export type ScheduledAction =
  | { type: "PLAY"; trackId: string; positionSec: number; serverTime: number }
  | { type: "PAUSE"; trackId: string | null; positionSec: number; serverTime: number }
  | { type: "STOP"; serverTime: number };

export type ServerMessage =
  | { type: "WELCOME"; clientId: string; serverTime: number }
  | { type: "NTP_RESPONSE"; t0: number; t1: number; t2: number }
  | { type: "ROOM_STATE"; room: RoomState }
  | { type: "SCHEDULED_ACTION"; action: ScheduledAction }
  | { type: "ERROR"; error: string };

export const GRID = { SIZE: 100, ORIGIN: 50 };
