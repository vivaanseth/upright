/// <reference lib="webworker" />
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import {
  POSE_WORKER_PROTOCOL_VERSION,
  type PoseWorkerRequest,
  type PoseWorkerResponse,
} from "../../../shared/worker-protocol";

let landmarker: PoseLandmarker | null = null;

const send = (message: PoseWorkerResponse): void => self.postMessage(message);
const messageFor = (error: unknown): string =>
  error instanceof Error ? error.message : "Pose tracking could not continue.";

self.onmessage = async (event: MessageEvent<PoseWorkerRequest>) => {
  const request = event.data;
  if (request.protocolVersion !== POSE_WORKER_PROTOCOL_VERSION) return;

  if (request.type === "initialize") {
    try {
      landmarker?.close();
      landmarker = null;
      const wasmRoot = new URL("./wasm/", self.location.origin).toString();
      const fileset = await FilesetResolver.forVisionTasks(wasmRoot);
      importScripts(fileset.wasmLoaderPath);
      const moduleFactory = (self as typeof self & { ModuleFactory?: unknown })
        .ModuleFactory;
      if (typeof moduleFactory !== "function") {
        throw new Error(
          `MediaPipe loader did not register ModuleFactory from ${fileset.wasmLoaderPath}.`,
        );
      }
      const workerFileset = { ...fileset, wasmLoaderPath: "" };
      landmarker = await PoseLandmarker.createFromOptions(workerFileset, {
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
      send({
        protocolVersion: POSE_WORKER_PROTOCOL_VERSION,
        requestId: request.requestId,
        type: "ready",
      });
    } catch (error) {
      landmarker?.close();
      landmarker = null;
      send({
        protocolVersion: POSE_WORKER_PROTOCOL_VERSION,
        requestId: request.requestId,
        type: "fatal-error",
        message: messageFor(error),
      });
    }
    return;
  }

  if (request.type === "dispose") {
    landmarker?.close();
    landmarker = null;
    send({
      protocolVersion: POSE_WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      type: "disposed",
    });
    return;
  }

  try {
    if (!landmarker) {
      send({
        protocolVersion: POSE_WORKER_PROTOCOL_VERSION,
        requestId: request.requestId,
        type: "recoverable-error",
        message: "The pose model is not ready.",
      });
      return;
    }
    const started = performance.now();
    const result = landmarker.detectForVideo(request.bitmap, request.timestamp);
    send({
      protocolVersion: POSE_WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      type: "result",
      landmarks:
        result.landmarks[0]?.map((entry) => ({
          x: entry.x,
          y: entry.y,
          z: entry.z,
          visibility: entry.visibility,
        })) ?? null,
      timestamp: request.timestamp,
      inferenceMs: performance.now() - started,
    });
  } catch (error) {
    send({
      protocolVersion: POSE_WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      type: "recoverable-error",
      message: messageFor(error),
    });
  } finally {
    request.bitmap.close();
  }
};

export {};
