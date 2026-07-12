/// <reference lib="webworker" />
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { Landmark } from "../../../shared/posture-engine";

type Incoming =
  | { type: "initialize" }
  | { type: "frame"; bitmap: ImageBitmap; timestamp: number };
type Outgoing =
  | { type: "ready" }
  | {
      type: "result";
      landmarks: Landmark[] | null;
      timestamp: number;
      inferenceMs: number;
    }
  | { type: "error"; message: string };

let landmarker: PoseLandmarker | null = null;

const send = (message: Outgoing): void => self.postMessage(message);

self.onmessage = async (event: MessageEvent<Incoming>) => {
  try {
    if (event.data.type === "initialize") {
      const wasmRoot = new URL("./wasm/", self.location.origin).toString();
      const fileset = await FilesetResolver.forVisionTasks(wasmRoot);
      landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: new URL(
            "./models/pose_landmarker_lite.task",
            self.location.origin,
          ).toString(),
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      });
      send({ type: "ready" });
      return;
    }

    const started = performance.now();
    const result = landmarker?.detectForVideo(
      event.data.bitmap,
      event.data.timestamp,
    );
    event.data.bitmap.close();
    send({
      type: "result",
      landmarks:
        result?.landmarks[0]?.map((entry) => ({
          x: entry.x,
          y: entry.y,
          z: entry.z,
          visibility: entry.visibility,
        })) ?? null,
      timestamp: event.data.timestamp,
      inferenceMs: performance.now() - started,
    });
  } catch (error) {
    send({
      type: "error",
      message:
        error instanceof Error
          ? error.message
          : "Pose tracking could not start.",
    });
  }
};

export {};
