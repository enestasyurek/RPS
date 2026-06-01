export const MOVES = ["rock", "paper", "scissors", "unknown"] as const;

export type Move = (typeof MOVES)[number];
export type KnownMove = Exclude<Move, "unknown">;
export type PlayerId = string;
export type RoomCode = string;
export type RoomPhase = "waiting" | "ready" | "countdown" | "result";

export interface PlayerPublic {
  id: PlayerId;
  displayName: string;
  ready: boolean;
  connected: boolean;
}

export interface ScoreBoard {
  [playerId: PlayerId]: number;
}

export interface RoomStatePayload {
  roomCode: RoomCode;
  players: PlayerPublic[];
  phase: RoomPhase;
  score: ScoreBoard;
  selfId?: PlayerId;
}

export interface RoundCountdownPayload {
  roundId: string;
  startsAt: number;
  captureAt: number;
}

export interface RoundMovePayload {
  roundId: string;
  move: Move;
  confidence: number;
}

export interface RoundMoveResult {
  playerId: PlayerId;
  displayName: string;
  move: Move;
  confidence: number;
}

export type RoundResultReason =
  | "normal"
  | "draw"
  | "both_unknown"
  | "no_detection"
  | "timeout";

export interface RoundResultPayload {
  roundId: string;
  moves: RoundMoveResult[];
  winner: PlayerId | "draw";
  score: ScoreBoard;
  reason: RoundResultReason;
}

export type RoomErrorCode =
  | "BAD_REQUEST"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "NOT_IN_ROOM"
  | "ROUND_NOT_ACTIVE"
  | "OPPONENT_LEFT"
  | "SERVER_ERROR";

export interface RoomErrorPayload {
  code: RoomErrorCode;
  message: string;
}

export interface CreateRoomPayload {
  displayName: string;
}

export interface JoinRoomPayload {
  roomCode: string;
  displayName: string;
}

export interface ReadyPayload {
  ready: boolean;
}

export interface ClientToServerEvents {
  "room:create": (payload: CreateRoomPayload) => void;
  "room:join": (payload: JoinRoomPayload) => void;
  "player:ready": (payload: ReadyPayload) => void;
  "round:move": (payload: RoundMovePayload) => void;
  "round:rematch": () => void;
  "room:leave": () => void;
}

export interface ServerToClientEvents {
  "room:state": (payload: RoomStatePayload) => void;
  "round:countdown": (payload: RoundCountdownPayload) => void;
  "round:result": (payload: RoundResultPayload) => void;
  "room:error": (payload: RoomErrorPayload) => void;
}

export interface InterServerEvents {}

export interface SocketData {
  roomCode?: RoomCode;
  playerId?: PlayerId;
  displayName?: string;
}

export const MOVE_LABELS: Record<Move, string> = {
  rock: "Rock",
  paper: "Paper",
  scissors: "Scissors",
  unknown: "Unknown"
};

export const MOVE_BEATS: Record<KnownMove, KnownMove> = {
  rock: "scissors",
  paper: "rock",
  scissors: "paper"
};

export function isMove(value: unknown): value is Move {
  return typeof value === "string" && MOVES.includes(value as Move);
}

export function decideKnownMoves(
  first: KnownMove,
  second: KnownMove
): "first" | "second" | "draw" {
  if (first === second) {
    return "draw";
  }

  return MOVE_BEATS[first] === second ? "first" : "second";
}

