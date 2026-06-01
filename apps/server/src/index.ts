import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server, type Socket } from "socket.io";
import type {
  ClientToServerEvents,
  InterServerEvents,
  RoomCode,
  RoomErrorCode,
  ServerToClientEvents,
  SocketData
} from "@rps/shared";
import {
  RoomStore,
  RoomStoreError,
  normalizeRoomCode,
  sanitizeDisplayName,
  type RoundTiming
} from "./game.js";

const app = express();
const httpServer = createServer(app);
const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";
const clientOrigins = process.env.CLIENT_ORIGIN
  ? process.env.CLIENT_ORIGIN.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  : undefined;

const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
  httpServer,
  {
    cors: {
      origin: !clientOrigins || clientOrigins.includes("*") ? true : clientOrigins,
      methods: ["GET", "POST"]
    }
  }
);

const store = new RoomStore();
const roundTimers = new Map<RoomCode, NodeJS.Timeout>();

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const webDist = join(__dirname, "../../web/dist");

if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.use((request, response, next) => {
    if (request.method === "GET" && !request.path.startsWith("/socket.io")) {
      response.sendFile(join(webDist, "index.html"));
      return;
    }

    next();
  });
}

io.on("connection", (socket) => {
  socket.on("room:create", (payload) => {
    runSafely(socket, () => {
      const displayName = requireDisplayName(payload.displayName);

      if (socket.data.roomCode && store.getRoom(socket.data.roomCode)) {
        emitRoomState(socket.data.roomCode);
        return;
      }

      leaveCurrentRoom(socket, false);

      const { room, player } = store.createRoom(socket.id, displayName);
      socket.data.roomCode = room.code;
      socket.data.playerId = player.id;
      socket.data.displayName = displayName;
      socket.join(room.code);
      emitRoomState(room.code);
    });
  });

  socket.on("room:join", (payload) => {
    runSafely(socket, () => {
      const displayName = requireDisplayName(payload.displayName);
      const roomCode = normalizeRoomCode(payload.roomCode);

      if (!roomCode) {
        throw new RoomStoreError("BAD_REQUEST", "Enter a room code.");
      }

      if (socket.data.roomCode === roomCode && store.getRoom(roomCode)) {
        emitRoomState(roomCode);
        return;
      }

      leaveCurrentRoom(socket, false);

      const { room, player } = store.joinRoom(roomCode, socket.id, displayName);
      socket.data.roomCode = room.code;
      socket.data.playerId = player.id;
      socket.data.displayName = displayName;
      socket.join(room.code);
      emitRoomState(room.code);
    });
  });

  socket.on("player:ready", (payload) => {
    runSafely(socket, () => {
      const { roomCode, playerId } = requireSocketRoom(socket.data);
      const room = store.setReady(roomCode, playerId, Boolean(payload.ready));
      emitRoomState(room.code);
      startRoundIfReady(room.code);
    });
  });

  socket.on("round:move", (payload) => {
    runSafely(socket, () => {
      const { roomCode, playerId } = requireSocketRoom(socket.data);
      const room = store.submitMove(roomCode, playerId, payload);

      if (store.hasAllMoves(room)) {
        finishRound(room.code, "normal");
      }
    });
  });

  socket.on("round:rematch", () => {
    runSafely(socket, () => {
      const { roomCode, playerId } = requireSocketRoom(socket.data);
      const room = store.setReady(roomCode, playerId, true);
      emitRoomState(room.code);
      startRoundIfReady(room.code);
    });
  });

  socket.on("room:leave", () => {
    leaveCurrentRoom(socket, true);
  });

  socket.on("disconnect", () => {
    leaveCurrentRoom(socket, true);
  });
});

httpServer.listen(port, host, () => {
  console.log(`RPS server listening on http://${host}:${port}`);
});

function startRoundIfReady(roomCode: RoomCode): void {
  const room = store.getRoom(roomCode);

  if (!room || !store.canStartRound(room) || roundTimers.has(roomCode)) {
    return;
  }

  const timing = createRoundTiming();
  store.startRound(roomCode, timing);
  emitRoomState(roomCode);
  io.to(roomCode).emit("round:countdown", {
    roundId: timing.roundId,
    startsAt: timing.startsAt,
    captureAt: timing.captureAt
  });

  const timeoutDelay = Math.max(timing.captureAt - Date.now() + 2500, 1000);
  roundTimers.set(
    roomCode,
    setTimeout(() => {
      finishRound(roomCode, "timeout");
    }, timeoutDelay)
  );
}

function finishRound(roomCode: RoomCode, reason: "normal" | "timeout"): void {
  const room = store.getRoom(roomCode);

  if (!room?.currentRound) {
    clearRoundTimer(roomCode);
    return;
  }

  clearRoundTimer(roomCode);
  const result = store.finishRound(roomCode, reason);
  emitRoomState(roomCode);
  io.to(roomCode).emit("round:result", result);
}

function leaveCurrentRoom(socket: GameSocket, notifyOpponent: boolean): void {
  const previousRoomCode = socket.data.roomCode;
  const { room, deleted } = store.removeSocket(socket.id);

  if (previousRoomCode) {
    socket.leave(previousRoomCode);
    clearRoundTimer(previousRoomCode);
  }

  delete socket.data.roomCode;
  delete socket.data.playerId;
  delete socket.data.displayName;

  if (room && !deleted) {
    if (notifyOpponent) {
      io.to(room.code).emit("room:error", {
        code: "OPPONENT_LEFT",
        message: "Your opponent left the room."
      });
    }

    emitRoomState(room.code);
  }
}

function emitRoomState(roomCode: RoomCode): void {
  const room = store.getRoom(roomCode);

  if (!room) {
    return;
  }

  for (const player of room.players) {
    io.to(player.socketId).emit("room:state", store.toPublicState(room, player.id));
  }
}

function clearRoundTimer(roomCode: RoomCode): void {
  const timer = roundTimers.get(roomCode);

  if (timer) {
    clearTimeout(timer);
    roundTimers.delete(roomCode);
  }
}

function createRoundTiming(): RoundTiming {
  const startsAt = Date.now() + 900;

  return {
    roundId: randomUUID(),
    startsAt,
    captureAt: startsAt + 3000
  };
}

function requireDisplayName(value: unknown): string {
  const displayName = sanitizeDisplayName(value);

  if (!displayName) {
    throw new RoomStoreError("BAD_REQUEST", "Enter a name between 1 and 24 characters.");
  }

  return displayName;
}

function requireSocketRoom(data: SocketData): { roomCode: RoomCode; playerId: string } {
  if (!data.roomCode || !data.playerId) {
    throw new RoomStoreError("NOT_IN_ROOM", "Join a room first.");
  }

  return { roomCode: data.roomCode, playerId: data.playerId };
}

function runSafely(socket: GameSocket, callback: () => void): void {
  try {
    callback();
  } catch (error) {
    if (error instanceof RoomStoreError) {
      emitError(socket, error.code, error.message);
      return;
    }

    console.error(error);
    emitError(socket, "SERVER_ERROR", "Something went wrong.");
  }
}

function emitError(socket: GameSocket, code: RoomErrorCode, message: string): void {
  socket.emit("room:error", { code, message });
}
