import { describe, expect, it } from "vitest";
import { RoomStore, resolveRound, sanitizeDisplayName } from "./game.js";

describe("resolveRound", () => {
  it("resolves the canonical rock paper scissors rules", () => {
    expect(resolveRound("rock", "scissors").winner).toBe("first");
    expect(resolveRound("paper", "rock").winner).toBe("first");
    expect(resolveRound("scissors", "paper").winner).toBe("first");
    expect(resolveRound("rock", "paper").winner).toBe("second");
  });

  it("treats missing detections as unknown", () => {
    expect(resolveRound("unknown", "paper")).toMatchObject({
      winner: "second",
      reason: "no_detection"
    });
    expect(resolveRound("unknown", "unknown", "timeout")).toMatchObject({
      winner: "draw",
      reason: "timeout"
    });
  });
});

describe("RoomStore", () => {
  it("creates, joins, starts, and scores a round", () => {
    const store = new RoomStore();
    const creator = store.createRoom("socket-a", "Ada");
    const joiner = store.joinRoom(creator.room.code, "socket-b", "Linus");

    store.setReady(creator.room.code, creator.player.id, true);
    const readyRoom = store.setReady(creator.room.code, joiner.player.id, true);

    expect(store.canStartRound(readyRoom)).toBe(true);

    store.startRound(creator.room.code, {
      roundId: "round-1",
      startsAt: 1000,
      captureAt: 4000
    });
    store.submitMove(creator.room.code, creator.player.id, {
      roundId: "round-1",
      move: "rock",
      confidence: 0.9
    });
    const activeRoom = store.submitMove(creator.room.code, joiner.player.id, {
      roundId: "round-1",
      move: "scissors",
      confidence: 0.88
    });

    expect(store.hasAllMoves(activeRoom)).toBe(true);

    const result = store.finishRound(creator.room.code, "normal");
    expect(result.winner).toBe(creator.player.id);
    expect(result.score[creator.player.id]).toBe(1);
    expect(store.getRoom(creator.room.code)?.phase).toBe("result");
  });

  it("removes a disconnected player and resets the room", () => {
    const store = new RoomStore();
    const creator = store.createRoom("socket-a", "Ada");
    store.joinRoom(creator.room.code, "socket-b", "Linus");

    const removal = store.removeSocket("socket-b");

    expect(removal.deleted).toBe(false);
    expect(removal.room?.players).toHaveLength(1);
    expect(removal.room?.phase).toBe("waiting");
  });
});

describe("sanitizeDisplayName", () => {
  it("normalizes display names", () => {
    expect(sanitizeDisplayName("  Ada   Lovelace  ")).toBe("Ada Lovelace");
    expect(sanitizeDisplayName("")).toBeUndefined();
    expect(sanitizeDisplayName("a".repeat(25))).toBeUndefined();
  });
});

