import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@rps/shared";

const fallbackUrl = import.meta.env.DEV
  ? `${window.location.protocol}//${window.location.hostname}:4000`
  : window.location.origin;

export function createGameSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  const socketUrl = import.meta.env.DEV && import.meta.env.VITE_SOCKET_URL
    ? import.meta.env.VITE_SOCKET_URL
    : fallbackUrl;

  return io(socketUrl, {
    autoConnect: true,
    retries: 3,
    ackTimeout: 6000
  });
}
