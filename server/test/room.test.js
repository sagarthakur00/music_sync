import { test } from "node:test";
import assert from "node:assert/strict";
import { Room, serverNow } from "../src/room.js";

const noop = () => {};
const track = (id) => ({ id, name: id, url: `/uploads/x/${id}.mp3`, size: 1 });

test("first client becomes creator and admin, admin passes on when they leave", () => {
  const r = new Room("123456");
  r.join("a", "alice", noop);
  r.join("b", "bob", noop);
  assert.equal(r.clients.get("a").isAdmin, true);
  assert.equal(r.clients.get("a").isCreator, true);
  assert.equal(r.clients.get("b").isAdmin, false);
  r.leave("a");
  assert.equal(r.clients.get("b").isAdmin, true);
});

test("play is scheduled in the future with enough lead for the slowest client", () => {
  const r = new Room("123456");
  r.join("a", "a", noop).rtt = 600;
  r.addTrack(track("t1"));
  const before = serverNow();
  const action = r.schedulePlay("t1", 12);
  assert.equal(action.type, "PLAY");
  assert.ok(action.serverTime - before >= 600 * 1.5, "lead covers slow client");
  assert.equal(r.playback.state, "playing");
  assert.equal(r.schedulePlay("missing", 0), null);
});

test("pause records where the song stopped", () => {
  const r = new Room("123456");
  r.join("a", "a", noop);
  r.addTrack(track("t1"));
  r.schedulePlay("t1", 10);
  r.playback.anchorServerTime = serverNow() - 5000; // pretend 5s have played
  const action = r.schedulePause();
  assert.equal(action.type, "PAUSE");
  assert.ok(action.positionSec > 14.9 && action.positionSec < 16, `got ${action.positionSec}`);
  assert.equal(r.schedulePause(), null, "pausing twice does nothing");
});

test("track ended advances once, then stops at the end of the queue", () => {
  const r = new Room("123456");
  r.join("a", "a", noop);
  r.addTrack(track("t1"));
  r.addTrack(track("t2"));
  r.schedulePlay("t1", 0);
  assert.equal(r.handleTrackEnded("t1").trackId, "t2");
  assert.equal(r.handleTrackEnded("t1"), null, "duplicate report ignored");
  assert.equal(r.handleTrackEnded("t2").type, "STOP");
});

test("spatial gains fall off with distance and stay audible", () => {
  const r = new Room("123456");
  r.join("a", "a", noop);
  r.join("b", "b", noop);
  r.spatial.enabled = true;
  r.moveClient("a", 50, 50);
  r.moveClient("b", 100, 100);
  r.setListening(50, 50);
  const g = r.gains();
  assert.equal(g.a, 1);
  assert.ok(g.b < 0.5 && g.b >= 0.08);
});

test("admin-only mode blocks non-admins", () => {
  const r = new Room("123456");
  r.join("a", "a", noop);
  r.join("b", "b", noop);
  r.controls = "ADMIN_ONLY";
  assert.equal(r.canControl("a"), true);
  assert.equal(r.canControl("b"), false);
});
