import type { Move } from "@rps/shared";

export interface HandLandmark {
  x: number;
  y: number;
  z?: number;
}

export interface GesturePrediction {
  move: Move;
  confidence: number;
  extended: {
    index: boolean;
    middle: boolean;
    ring: boolean;
    pinky: boolean;
  };
}

const WRIST = 0;
const INDEX_MCP = 5;
const INDEX_PIP = 6;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const MIDDLE_TIP = 12;
const RING_MCP = 13;
const RING_PIP = 14;
const RING_TIP = 16;
const PINKY_MCP = 17;
const PINKY_PIP = 18;
const PINKY_TIP = 20;

export function classifyHandLandmarks(landmarks: HandLandmark[] | undefined): GesturePrediction {
  if (!landmarks || landmarks.length < 21) {
    return unknownPrediction();
  }

  const extended = {
    index: isFingerExtended(landmarks, INDEX_MCP, INDEX_PIP, INDEX_TIP),
    middle: isFingerExtended(landmarks, MIDDLE_MCP, MIDDLE_PIP, MIDDLE_TIP),
    ring: isFingerExtended(landmarks, RING_MCP, RING_PIP, RING_TIP),
    pinky: isFingerExtended(landmarks, PINKY_MCP, PINKY_PIP, PINKY_TIP)
  };
  const extendedCount = Object.values(extended).filter(Boolean).length;

  if (extended.index && extended.middle && extended.ring && extended.pinky) {
    return { move: "paper", confidence: 0.92, extended };
  }

  if (extended.index && extended.middle && !extended.ring && !extended.pinky) {
    return { move: "scissors", confidence: 0.9, extended };
  }

  if (extendedCount === 0) {
    return { move: "rock", confidence: 0.88, extended };
  }

  if (extendedCount === 1 && !extended.index && !extended.middle) {
    return { move: "rock", confidence: 0.62, extended };
  }

  return { move: "unknown", confidence: 0.28, extended };
}

function isFingerExtended(
  landmarks: HandLandmark[],
  mcpIndex: number,
  pipIndex: number,
  tipIndex: number
): boolean {
  const wrist = landmarks[WRIST];
  const mcp = landmarks[mcpIndex];
  const pip = landmarks[pipIndex];
  const tip = landmarks[tipIndex];

  if (!wrist || !mcp || !pip || !tip) {
    return false;
  }

  const wristToTip = distance(wrist, tip);
  const wristToPip = distance(wrist, pip);
  const mcpToTip = distance(mcp, tip);
  const mcpToPip = distance(mcp, pip);

  return wristToTip > wristToPip * 1.14 && mcpToTip > mcpToPip * 1.08;
}

function distance(a: HandLandmark, b: HandLandmark): number {
  const zDelta = (a.z ?? 0) - (b.z ?? 0);
  return Math.hypot(a.x - b.x, a.y - b.y, zDelta);
}

function unknownPrediction(): GesturePrediction {
  return {
    move: "unknown",
    confidence: 0,
    extended: {
      index: false,
      middle: false,
      ring: false,
      pinky: false
    }
  };
}

