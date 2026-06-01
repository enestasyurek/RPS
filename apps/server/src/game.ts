import { randomUUID } from "node:crypto";
import {
  decideKnownMoves,
  isMove,
  type KnownMove,
  type Move,
  type PlayerId,
  type PlayerPublic,
  type RoomCode,
  type RoomPhase,
  type RoomStatePayload,
  type RoundMovePayload,
  type RoundMoveResult,
  type RoundResultPayload,
  type RoundResultReason,
  type ScoreBoard
} from "@rps/shared";

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 5;
const MAX_PLAYERS = 2;

interface PlayerRecord extends PlayerPublic {
  socketId: string;
}

interface MoveSubmission {
  move: Move;
  confidence: number;
  submittedAt: number;
}

interface ActiveRound {
  id: string;
  startsAt: number;
  captureAt: number;
  moves: Map<PlayerId, MoveSubmission>;
}

interface RoomRecord {
  code: RoomCode;
  players: PlayerRecord[];
  phase: RoomPhase;
  score: ScoreBoard;
  currentRound?: ActiveRound;
  createdAt: number;
  updatedAt: number;
}

export interface RoomJoinResult {
  room: RoomRecord;
  player: PlayerRecord;
}

export interface RoundTiming {
  roundId: string;
  startsAt: number;
  captureAt: number;
}

export interface RemoveSocketResult {
  room?: RoomRecord;
  removedPlayer?: PlayerRecord;
  deleted: boolean;
}

export class RoomStore {
  private readonly rooms = new Map<RoomCode, RoomRecord>();

  createRoom(socketId: string, displayName: string): RoomJoinResult {
    const code = this.createUniqueRoomCode();
    const player = createPlayer(socketId, displayName);
    const now = Date.now();
    const room: RoomRecord = {
      code,
      players: [player],
      phase: "waiting",
      score: { [player.id]: 0 },
      createdAt: now,
      updatedAt: now
    };

    this.rooms.set(code, room);
    return { room, player };
  }

  joinRoom(roomCode: string, socketId: string, displayName: string): RoomJoinResult {
    const room = this.getRoom(normalizeRoomCode(roomCode));

    if (!room) {
      throw new RoomStoreError("ROOM_NOT_FOUND", "That room does not exist.");
    }

    if (room.players.length >= MAX_PLAYERS) {
      throw new RoomStoreError("ROOM_FULL", "That room already has two players.");
    }

    const player = createPlayer(socketId, displayName);
    room.players.push(player);
    room.score[player.id] = 0;
    room.updatedAt = Date.now();

    return { room, player };
  }

  getRoom(roomCode: string | undefined): RoomRecord | undefined {
    if (!roomCode) {
      return undefined;
    }

    return this.rooms.get(normalizeRoomCode(roomCode));
  }

  getRoomForSocket(socketId: string): RoomRecord | undefined {
    return [...this.rooms.values()].find((room) =>
      room.players.some((player) => player.socketId === socketId)
    );
  }

  getPlayer(room: RoomRecord, playerId: string | undefined): PlayerRecord | undefined {
    if (!playerId) {
      return undefined;
    }

    return room.players.find((player) => player.id === playerId);
  }

  setReady(roomCode: string, playerId: string, ready: boolean): RoomRecord {
    const room = this.requireRoom(roomCode);
    const player = this.requirePlayer(room, playerId);

    if (room.phase === "countdown") {
      return room;
    }

    player.ready = ready;
    room.phase = this.allPlayersReady(room) ? "ready" : "waiting";
    room.updatedAt = Date.now();
    return room;
  }

  canStartRound(room: RoomRecord): boolean {
    return room.players.length === MAX_PLAYERS && this.allPlayersReady(room);
  }

  startRound(roomCode: string, timing: RoundTiming): RoomRecord {
    const room = this.requireRoom(roomCode);
    room.phase = "countdown";
    room.currentRound = {
      id: timing.roundId,
      startsAt: timing.startsAt,
      captureAt: timing.captureAt,
      moves: new Map<PlayerId, MoveSubmission>()
    };
    room.updatedAt = Date.now();
    return room;
  }

  submitMove(roomCode: string, playerId: string, payload: RoundMovePayload): RoomRecord {
    const room = this.requireRoom(roomCode);
    const player = this.requirePlayer(room, playerId);

    if (!room.currentRound || room.currentRound.id !== payload.roundId) {
      throw new RoomStoreError("ROUND_NOT_ACTIVE", "This round is no longer active.");
    }

    if (!isMove(payload.move)) {
      throw new RoomStoreError("BAD_REQUEST", "Invalid move.");
    }

    if (room.currentRound.moves.has(player.id)) {
      return room;
    }

    room.currentRound.moves.set(player.id, {
      move: payload.move,
      confidence: clamp(payload.confidence, 0, 1),
      submittedAt: Date.now()
    });
    room.updatedAt = Date.now();
    return room;
  }

  hasAllMoves(room: RoomRecord): boolean {
    return Boolean(
      room.currentRound && room.players.every((player) => room.currentRound?.moves.has(player.id))
    );
  }

  finishRound(roomCode: string, fallbackReason: RoundResultReason = "timeout"): RoundResultPayload {
    const room = this.requireRoom(roomCode);

    if (!room.currentRound) {
      throw new RoomStoreError("ROUND_NOT_ACTIVE", "This round is no longer active.");
    }

    const [firstPlayer, secondPlayer] = room.players;

    if (!firstPlayer || !secondPlayer) {
      throw new RoomStoreError("ROUND_NOT_ACTIVE", "A round needs two players.");
    }

    const firstMove = this.getSubmittedMove(room, firstPlayer.id);
    const secondMove = this.getSubmittedMove(room, secondPlayer.id);
    const outcome = resolveRound(firstMove.move, secondMove.move, fallbackReason);
    const winner =
      outcome.winner === "first"
        ? firstPlayer.id
        : outcome.winner === "second"
          ? secondPlayer.id
          : "draw";

    if (winner !== "draw") {
      room.score[winner] = (room.score[winner] ?? 0) + 1;
    }

    const result: RoundResultPayload = {
      roundId: room.currentRound.id,
      moves: [
        toMoveResult(firstPlayer, firstMove),
        toMoveResult(secondPlayer, secondMove)
      ],
      winner,
      score: { ...room.score },
      reason: outcome.reason
    };

    room.phase = "result";
    delete room.currentRound;
    room.players.forEach((player) => {
      player.ready = false;
    });
    room.updatedAt = Date.now();

    return result;
  }

  removeSocket(socketId: string): RemoveSocketResult {
    const room = this.getRoomForSocket(socketId);

    if (!room) {
      return { deleted: false };
    }

    const removedPlayer = room.players.find((player) => player.socketId === socketId);
    room.players = room.players.filter((player) => player.socketId !== socketId);

    if (removedPlayer) {
      delete room.score[removedPlayer.id];
    }

    if (room.players.length === 0) {
      this.rooms.delete(room.code);
      return withRemovedPlayer({ room, deleted: true }, removedPlayer);
    }

    room.phase = "waiting";
    delete room.currentRound;
    room.players.forEach((player) => {
      player.ready = false;
    });
    room.updatedAt = Date.now();

    return withRemovedPlayer({ room, deleted: false }, removedPlayer);
  }

  toPublicState(room: RoomRecord, selfId?: PlayerId): RoomStatePayload {
    const payload: RoomStatePayload = {
      roomCode: room.code,
      players: room.players.map(({ id, displayName, ready, connected }) => ({
        id,
        displayName,
        ready,
        connected
      })),
      phase: room.phase,
      score: { ...room.score }
    };

    if (selfId) {
      payload.selfId = selfId;
    }

    return payload;
  }

  private requireRoom(roomCode: string): RoomRecord {
    const room = this.getRoom(roomCode);

    if (!room) {
      throw new RoomStoreError("ROOM_NOT_FOUND", "That room does not exist.");
    }

    return room;
  }

  private requirePlayer(room: RoomRecord, playerId: string): PlayerRecord {
    const player = this.getPlayer(room, playerId);

    if (!player) {
      throw new RoomStoreError("NOT_IN_ROOM", "You are not in that room.");
    }

    return player;
  }

  private allPlayersReady(room: RoomRecord): boolean {
    return room.players.length === MAX_PLAYERS && room.players.every((player) => player.ready);
  }

  private getSubmittedMove(room: RoomRecord, playerId: PlayerId): MoveSubmission {
    return (
      room.currentRound?.moves.get(playerId) ?? {
        move: "unknown",
        confidence: 0,
        submittedAt: Date.now()
      }
    );
  }

  private createUniqueRoomCode(): RoomCode {
    let code = createRoomCode();

    while (this.rooms.has(code)) {
      code = createRoomCode();
    }

    return code;
  }
}

export class RoomStoreError extends Error {
  constructor(
    public readonly code:
      | "BAD_REQUEST"
      | "ROOM_NOT_FOUND"
      | "ROOM_FULL"
      | "NOT_IN_ROOM"
      | "ROUND_NOT_ACTIVE",
    message: string
  ) {
    super(message);
  }
}

export function sanitizeDisplayName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length >= 1 && trimmed.length <= 24 ? trimmed : undefined;
}

export function normalizeRoomCode(value: string): RoomCode {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function resolveRound(
  first: Move,
  second: Move,
  fallbackReason: RoundResultReason = "normal"
): { winner: "first" | "second" | "draw"; reason: RoundResultReason } {
  if (first === "unknown" && second === "unknown") {
    return { winner: "draw", reason: fallbackReason === "timeout" ? "timeout" : "both_unknown" };
  }

  if (first === "unknown") {
    return { winner: "second", reason: "no_detection" };
  }

  if (second === "unknown") {
    return { winner: "first", reason: "no_detection" };
  }

  const winner = decideKnownMoves(first as KnownMove, second as KnownMove);
  return { winner, reason: winner === "draw" ? "draw" : "normal" };
}

function createPlayer(socketId: string, displayName: string): PlayerRecord {
  return {
    id: randomUUID(),
    socketId,
    displayName,
    ready: false,
    connected: true
  };
}

function createRoomCode(): RoomCode {
  let code = "";

  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  }

  return code;
}

function toMoveResult(player: PlayerRecord, move: MoveSubmission): RoundMoveResult {
  return {
    playerId: player.id,
    displayName: player.displayName,
    move: move.move,
    confidence: move.confidence
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function withRemovedPlayer(
  result: Omit<RemoveSocketResult, "removedPlayer">,
  removedPlayer: PlayerRecord | undefined
): RemoveSocketResult {
  if (!removedPlayer) {
    return result;
  }

  return { ...result, removedPlayer };
}
