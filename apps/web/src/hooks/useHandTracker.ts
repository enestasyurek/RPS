import { useCallback, useEffect, useRef, useState } from "react";
import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
  type NormalizedLandmark
} from "@mediapipe/tasks-vision";
import { classifyHandLandmarks, type GesturePrediction } from "../vision/classifier";

const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const HAND_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export type TrackerStatus = "loading" | "ready" | "error";

export interface HandTrackerState {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: TrackerStatus;
  cameraReady: boolean;
  modelReady: boolean;
  error: string | undefined;
  latestPrediction: GesturePrediction;
  captureMove: () => GesturePrediction;
}

export function useHandTracker(): HandTrackerState {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const latestRef = useRef<GesturePrediction>(classifyHandLandmarks(undefined));
  const lastUiUpdateRef = useRef(0);
  const lastDetectionRef = useRef(0);
  const targetFrameInterval = getTargetFrameInterval();
  const [status, setStatus] = useState<TrackerStatus>("loading");
  const [cameraReady, setCameraReady] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [error, setError] = useState<string>();
  const [latestPrediction, setLatestPrediction] = useState<GesturePrediction>(latestRef.current);

  useEffect(() => {
    let cancelled = false;
    let frameId = 0;
    let stream: MediaStream | undefined;

    async function boot() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera access is not available in this browser.");
        }

        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: "user",
            width: { ideal: prefersMobileCamera() ? 424 : 640 },
            height: { ideal: prefersMobileCamera() ? 320 : 480 },
            frameRate: { ideal: prefersMobileCamera() ? 18 : 24, max: prefersMobileCamera() ? 24 : 30 }
          }
        });

        if (cancelled) {
          return;
        }

        const video = videoRef.current;

        if (!video) {
          throw new Error("Video element is not ready.");
        }

        video.srcObject = stream;
        await video.play();
        setCameraReady(true);

        const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
        const landmarker = await createHandLandmarker(vision);

        if (cancelled) {
          landmarker.close();
          return;
        }

        landmarkerRef.current = landmarker;
        setModelReady(true);
        setStatus("ready");

        const loop = () => {
          const now = performance.now();

          if (now - lastDetectionRef.current >= targetFrameInterval) {
            lastDetectionRef.current = now;
            const result = detectForVideo(now);
            updateLatestPrediction(result, now);
          }

          frameId = requestAnimationFrame(loop);
        };

        frameId = requestAnimationFrame(loop);
      } catch (bootError) {
        const message = bootError instanceof Error ? bootError.message : "Camera setup failed.";
        setError(message);
        setStatus("error");
      }
    }

    void boot();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      landmarkerRef.current?.close();
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const captureMove = useCallback(() => {
    const result = detectForVideo(performance.now());
    const prediction = resultToPrediction(result);
    latestRef.current = prediction;
    setLatestPrediction(prediction);
    return prediction;
  }, []);

  function detectForVideo(timestamp: number): HandLandmarkerResult | undefined {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;

    if (!video || !landmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return undefined;
    }

    return landmarker.detectForVideo(video, timestamp);
  }

  function updateLatestPrediction(result: HandLandmarkerResult | undefined, now: number) {
    const prediction = resultToPrediction(result);
    latestRef.current = prediction;

    if (now - lastUiUpdateRef.current > 140) {
      lastUiUpdateRef.current = now;
      setLatestPrediction(prediction);
    }
  }

  return {
    videoRef,
    status,
    cameraReady,
    modelReady,
    error,
    latestPrediction,
    captureMove
  };
}

function resultToPrediction(result: HandLandmarkerResult | undefined): GesturePrediction {
  const landmarks = result?.landmarks?.[0] as NormalizedLandmark[] | undefined;
  return classifyHandLandmarks(landmarks);
}

async function createHandLandmarker(vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>) {
  const options = {
    baseOptions: {
      modelAssetPath: HAND_MODEL,
      delegate: "GPU" as const
    },
    runningMode: "VIDEO" as const,
    numHands: 1,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.55
  };

  try {
    return await HandLandmarker.createFromOptions(vision, options);
  } catch {
    return HandLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: {
        modelAssetPath: HAND_MODEL
      }
    });
  }
}

function prefersMobileCamera(): boolean {
  return (
    typeof navigator !== "undefined" &&
    (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches))
  );
}

function getTargetFrameInterval(): number {
  return prefersMobileCamera() ? 1000 / 12 : 1000 / 18;
}
