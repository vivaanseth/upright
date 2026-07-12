import type { Landmark } from "./posture-engine";

export const POSE_WORKER_PROTOCOL_VERSION = 1 as const;

interface WorkerEnvelope {
  protocolVersion: typeof POSE_WORKER_PROTOCOL_VERSION;
  requestId: number;
}

export type PoseWorkerRequest =
  | (WorkerEnvelope & { type: "initialize" })
  | (WorkerEnvelope & {
      type: "frame";
      bitmap: ImageBitmap;
      timestamp: number;
    })
  | (WorkerEnvelope & { type: "dispose" });

export type PoseWorkerResponse =
  | (WorkerEnvelope & { type: "ready" })
  | (WorkerEnvelope & {
      type: "result";
      landmarks: Landmark[] | null;
      timestamp: number;
      inferenceMs: number;
    })
  | (WorkerEnvelope & { type: "recoverable-error"; message: string })
  | (WorkerEnvelope & { type: "fatal-error"; message: string })
  | (WorkerEnvelope & { type: "disposed" });
