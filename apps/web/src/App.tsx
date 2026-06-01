import { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Check,
  Clipboard,
  DoorOpen,
  Link,
  LoaderCircle,
  RefreshCcw,
  Share2,
  Trophy,
  Users,
  VideoOff
} from "lucide-react";
import QRCode from "qrcode";
import type {
  Move,
  RoomErrorPayload,
  RoomStatePayload,
  RoundCountdownPayload,
  RoundResultPayload
} from "@rps/shared";
import { MOVE_LABELS } from "@rps/shared";
import { createGameSocket } from "./lib/socket";
import { useHandTracker } from "./hooks/useHandTracker";

const socket = createGameSocket();

type Toast = { tone: "error" | "info"; message: string } | undefined;

export default function App() {
  const tracker = useHandTracker();
  const [displayName, setDisplayName] = useState(() => localStorage.getItem("rps:name") ?? "");
  const [joinCode, setJoinCode] = useState(() =>
    normalizeRoomInput(new URLSearchParams(location.search).get("room") ?? "")
  );
  const [room, setRoom] = useState<RoomStatePayload>();
  const [round, setRound] = useState<RoundCountdownPayload>();
  const [result, setResult] = useState<RoundResultPayload>();
  const [toast, setToast] = useState<Toast>();
  const [captureLabel, setCaptureLabel] = useState("Ready");
  const [submittedMove, setSubmittedMove] = useState<Move>();
  const [connected, setConnected] = useState(socket.connected);
  const captureMoveRef = useRef(tracker.captureMove);

  useEffect(() => {
    captureMoveRef.current = tracker.captureMove;
  }, [tracker.captureMove]);

  useEffect(() => {
    const handleConnect = () => setConnected(true);
    const handleDisconnect = () => setConnected(false);
    const handleRoomState = (payload: RoomStatePayload) => {
      setRoom(payload);
      setJoinCode(payload.roomCode);
      syncRoomCodeInUrl(payload.roomCode);
      setToast(undefined);
    };
    const handleCountdown = (payload: RoundCountdownPayload) => {
      setRound(payload);
      setResult(undefined);
      setSubmittedMove(undefined);
    };
    const handleResult = (payload: RoundResultPayload) => {
      setResult(payload);
      setRound(undefined);
      setCaptureLabel("Ready");
    };
    const handleError = (payload: RoomErrorPayload) => {
      setToast({ tone: "error", message: payload.message });
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("room:state", handleRoomState);
    socket.on("round:countdown", handleCountdown);
    socket.on("round:result", handleResult);
    socket.on("room:error", handleError);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("room:state", handleRoomState);
      socket.off("round:countdown", handleCountdown);
      socket.off("round:result", handleResult);
      socket.off("room:error", handleError);
    };
  }, []);

  useEffect(() => {
    if (!round) {
      return;
    }

    const tick = () => {
      const now = Date.now();
      const untilCapture = round.captureAt - now;

      if (untilCapture > 2200) {
        setCaptureLabel("3");
      } else if (untilCapture > 1200) {
        setCaptureLabel("2");
      } else if (untilCapture > 100) {
        setCaptureLabel("1");
      } else {
        setCaptureLabel("Shoot");
      }
    };

    tick();
    const interval = window.setInterval(tick, 80);
    const timeout = window.setTimeout(() => {
      const prediction = captureMoveRef.current();
      setSubmittedMove(prediction.move);
      socket.emit("round:move", {
        roundId: round.roundId,
        move: prediction.confidence >= 0.55 ? prediction.move : "unknown",
        confidence: prediction.confidence
      });
    }, Math.max(round.captureAt - Date.now(), 0));

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [round]);

  const self = room?.players.find((player) => player.id === room.selfId);
  const opponent = room?.players.find((player) => player.id !== room.selfId);
  const canReady = Boolean(room && tracker.cameraReady && tracker.modelReady && room.phase !== "countdown");
  const statusText = getTrackerStatusText(tracker.status, tracker.cameraReady, tracker.modelReady);

  function persistName() {
    localStorage.setItem("rps:name", displayName.trim());
  }

  function createRoom() {
    persistName();
    socket.emit("room:create", { displayName });
  }

  function joinRoom() {
    persistName();
    socket.emit("room:join", { roomCode: normalizeRoomInput(joinCode), displayName });
  }

  function leaveRoom() {
    socket.emit("room:leave");
    setRoom(undefined);
    setRound(undefined);
    setResult(undefined);
    setSubmittedMove(undefined);
    syncRoomCodeInUrl(undefined);
  }

  function toggleReady() {
    if (!self) {
      return;
    }

    socket.emit("player:ready", { ready: !self.ready });
  }

  return (
    <main className="app-shell">
      <section className="topbar" aria-label="Game status">
        <div>
          <p className="eyebrow">Camera Duel</p>
          <h1>Rock Paper Scissors</h1>
        </div>
        <div className="connection-pill">
          <span className={connected ? "dot connected" : "dot"} />
          {connected ? "Online" : "Connecting"}
        </div>
      </section>

      {toast ? <ToastMessage toast={toast} onDismiss={() => setToast(undefined)} /> : null}

      <section className="game-layout">
        <aside className="control-panel" aria-label="Room controls">
          <NameAndRoom
            displayName={displayName}
            joinCode={joinCode}
            room={room}
            onDisplayName={setDisplayName}
            onJoinCode={(value) => setJoinCode(normalizeRoomInput(value))}
            onCreate={createRoom}
            onJoin={joinRoom}
            onLeave={leaveRoom}
          />

          {room ? <RoomShare roomCode={room.roomCode} /> : null}

          {room ? (
            <ScorePanel room={room} selfId={room.selfId} result={result} />
          ) : (
            <div className="empty-panel">
              <Users size={18} />
              <span>Create a room, then send the code to your opponent.</span>
            </div>
          )}
        </aside>

        <section className="arena" aria-label="Camera arena">
          <div className="camera-stage">
            <video ref={tracker.videoRef} className="camera-feed" playsInline muted />
            <div className="camera-overlay">
              <div className="scan-frame" />
              <div className="countdown" data-active={Boolean(round)}>
                {captureLabel}
              </div>
            </div>
            <div className="camera-status">
              {tracker.status === "error" ? <VideoOff size={18} /> : <Camera size={18} />}
              <span>{tracker.error ?? statusText}</span>
            </div>
          </div>

          <div className="gesture-strip" aria-label="Detected gesture">
            {(["rock", "paper", "scissors"] as const).map((move) => (
              <div
                className="gesture-chip"
                data-active={tracker.latestPrediction.move === move}
                key={move}
              >
                <span>{MOVE_LABELS[move]}</span>
              </div>
            ))}
          </div>

          <div className="action-row">
            {room ? (
              <>
                <button className="primary-action" disabled={!canReady} onClick={toggleReady}>
                  {self?.ready ? <Check size={20} /> : <Camera size={20} />}
                  {self?.ready ? "Ready" : "Ready up"}
                </button>
                {result ? (
                  <button className="secondary-action" onClick={() => socket.emit("round:rematch")}>
                    <RefreshCcw size={19} />
                    Play again
                  </button>
                ) : null}
              </>
            ) : (
              <div className="join-hint">
                <Link size={18} />
                <span>Join or create a room to start the match.</span>
              </div>
            )}
          </div>

          <MatchStatus
            room={room}
            selfName={self?.displayName}
            opponentName={opponent?.displayName}
            result={result}
            submittedMove={submittedMove}
          />
        </section>
      </section>
    </main>
  );
}

function NameAndRoom({
  displayName,
  joinCode,
  room,
  onDisplayName,
  onJoinCode,
  onCreate,
  onJoin,
  onLeave
}: {
  displayName: string;
  joinCode: string;
  room: RoomStatePayload | undefined;
  onDisplayName: (value: string) => void;
  onJoinCode: (value: string) => void;
  onCreate: () => void;
  onJoin: () => void;
  onLeave: () => void;
}) {
  const canSubmit = displayName.trim().length > 0;
  const hasJoinCode = joinCode.trim().length > 0;

  return (
    <div className="panel-block">
      <label>
        <span>Name</span>
        <input
          value={displayName}
          maxLength={24}
          disabled={Boolean(room)}
          onChange={(event) => onDisplayName(event.target.value)}
          placeholder="Player name"
        />
      </label>

      <label>
        <span>Room code</span>
        <input
          value={joinCode}
          maxLength={5}
          disabled={Boolean(room)}
          onChange={(event) => onJoinCode(event.target.value.toUpperCase())}
          placeholder="A7K2P"
        />
      </label>

      {room ? (
        <button className="secondary-action full" onClick={onLeave}>
          <DoorOpen size={18} />
          Leave room
        </button>
      ) : hasJoinCode ? (
        <div className="button-grid">
          <button className="primary-action" disabled={!canSubmit} onClick={onJoin}>
            <Link size={18} />
            Join room
          </button>
          <button className="secondary-action" disabled={!canSubmit} onClick={onCreate}>
            <Users size={18} />
            New room
          </button>
        </div>
      ) : (
        <div className="button-grid">
          <button className="primary-action" disabled={!canSubmit} onClick={onCreate}>
            <Users size={18} />
            Create
          </button>
          <button className="secondary-action" disabled={!canSubmit || !joinCode} onClick={onJoin}>
            <Link size={18} />
            Join
          </button>
        </div>
      )}
    </div>
  );
}

function RoomShare({ roomCode }: { roomCode: string }) {
  const [qr, setQr] = useState<string>();
  const shareUrl = useMemo(() => {
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set("room", roomCode);
    return url.toString();
  }, [roomCode]);

  useEffect(() => {
    QRCode.toDataURL(shareUrl, {
      width: 160,
      margin: 1,
      color: {
        dark: "#171412",
        light: "#fffaf0"
      }
    }).then(setQr, () => setQr(undefined));
  }, [shareUrl]);

  async function copyLink() {
    await navigator.clipboard?.writeText(shareUrl);
  }

  return (
    <div className="share-panel">
      <div>
        <p className="eyebrow">Room</p>
        <strong>{roomCode}</strong>
      </div>
      {qr ? <img src={qr} alt={`QR code for room ${roomCode}`} /> : null}
      <button className="icon-action" onClick={copyLink} aria-label="Copy room link" title="Copy link">
        <Clipboard size={18} />
      </button>
      {"share" in navigator ? (
        <button
          className="icon-action"
          onClick={() => navigator.share({ title: "RPS Camera Duel", url: shareUrl })}
          aria-label="Share room link"
          title="Share"
        >
          <Share2 size={18} />
        </button>
      ) : null}
    </div>
  );
}

function ScorePanel({
  room,
  selfId,
  result
}: {
  room: RoomStatePayload;
  selfId: string | undefined;
  result: RoundResultPayload | undefined;
}) {
  return (
    <div className="score-list">
      {room.players.map((player) => {
        const won = result?.winner === player.id;
        return (
          <div className="player-row" data-self={player.id === selfId} key={player.id}>
            <div>
              <span className="player-name">{player.displayName}</span>
              <span className="player-state">{player.ready ? "Ready" : "Waiting"}</span>
            </div>
            <strong>{room.score[player.id] ?? 0}</strong>
            {won ? <Trophy size={18} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function MatchStatus({
  room,
  selfName,
  opponentName,
  result,
  submittedMove
}: {
  room: RoomStatePayload | undefined;
  selfName: string | undefined;
  opponentName: string | undefined;
  result: RoundResultPayload | undefined;
  submittedMove: Move | undefined;
}) {
  if (!room) {
    return (
      <div className="status-board">
        <h2>Waiting for a room</h2>
        <p>The camera warms up first, then the room flow takes over.</p>
      </div>
    );
  }

  if (!opponentName) {
    return (
      <div className="status-board">
        <h2>{selfName}, you are in.</h2>
        <p>Share the room code and keep your hand inside the frame.</p>
      </div>
    );
  }

  if (result) {
    const winnerName =
      result.winner === "draw"
        ? "Draw"
        : room.players.find((player) => player.id === result.winner)?.displayName ?? "Winner";

    return (
      <div className="status-board result-board">
        <h2>{winnerName}</h2>
        <div className="result-moves">
          {result.moves.map((move) => (
            <div key={move.playerId}>
              <span>{move.displayName}</span>
              <strong>{MOVE_LABELS[move.move]}</strong>
              <small>{Math.round(move.confidence * 100)}%</small>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (room.phase === "countdown") {
    return (
      <div className="status-board">
        <h2>{submittedMove ? `${MOVE_LABELS[submittedMove]} locked` : "Countdown running"}</h2>
        <p>Hold your move steady until the capture moment.</p>
      </div>
    );
  }

  return (
    <div className="status-board">
      <h2>
        {room.phase === "ready" ? "Round is arming" : `${selfName} vs ${opponentName}`}
      </h2>
      <p>Both players need to be ready before the countdown starts.</p>
    </div>
  );
}

function ToastMessage({
  toast,
  onDismiss
}: {
  toast: Exclude<Toast, undefined>;
  onDismiss: () => void;
}) {
  return (
    <div className="toast" data-tone={toast.tone}>
      <span>{toast.message}</span>
      <button onClick={onDismiss} aria-label="Dismiss message">
        Close
      </button>
    </div>
  );
}

function getTrackerStatusText(status: string, cameraReady: boolean, modelReady: boolean) {
  if (status === "loading" && !cameraReady) {
    return "Waiting for camera permission";
  }

  if (cameraReady && !modelReady) {
    return "Loading hand detector";
  }

  if (cameraReady && modelReady) {
    return "Hand detector ready";
  }

  return "Preparing camera";
}

function normalizeRoomInput(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
}

function syncRoomCodeInUrl(roomCode: string | undefined) {
  const url = new URL(window.location.href);

  if (roomCode) {
    url.searchParams.set("room", roomCode);
  } else {
    url.searchParams.delete("room");
  }

  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
