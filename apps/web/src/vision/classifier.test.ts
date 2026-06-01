import { describe, expect, it } from "vitest";
import { classifyHandLandmarks, type HandLandmark } from "./classifier";

describe("classifyHandLandmarks", () => {
  it("returns unknown when no hand is visible", () => {
    expect(classifyHandLandmarks(undefined)).toMatchObject({
      move: "unknown",
      confidence: 0
    });
  });

  it("classifies a closed fist as rock", () => {
    expect(classifyHandLandmarks(makeHand({})).move).toBe("rock");
  });

  it("classifies all four fingers extended as paper", () => {
    expect(
      classifyHandLandmarks(
        makeHand({
          index: true,
          middle: true,
          ring: true,
          pinky: true
        })
      ).move
    ).toBe("paper");
  });

  it("classifies index and middle extended as scissors", () => {
    expect(
      classifyHandLandmarks(
        makeHand({
          index: true,
          middle: true
        })
      ).move
    ).toBe("scissors");
  });
});

function makeHand(open: Partial<Record<"index" | "middle" | "ring" | "pinky", boolean>>) {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 })) satisfies HandLandmark[];
  points[0] = { x: 0.5, y: 0.9, z: 0 };

  setFinger(points, 5, 6, 8, 0.35, Boolean(open.index));
  setFinger(points, 9, 10, 12, 0.45, Boolean(open.middle));
  setFinger(points, 13, 14, 16, 0.55, Boolean(open.ring));
  setFinger(points, 17, 18, 20, 0.65, Boolean(open.pinky));

  return points;
}

function setFinger(
  points: HandLandmark[],
  mcp: number,
  pip: number,
  tip: number,
  x: number,
  open: boolean
) {
  points[mcp] = { x, y: 0.62, z: 0 };
  points[pip] = { x, y: open ? 0.42 : 0.66, z: 0 };
  points[tip] = { x, y: open ? 0.18 : 0.72, z: 0 };
}

