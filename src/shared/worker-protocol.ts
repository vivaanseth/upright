import type { Landmark } from "./posture-engine";

export const POSE_WORKER_PROTOCOL_VERSION = 1 as const;

interface WorkerEnvelope {
  protocolVersion: typeof POSE_WORKER_PROTOCOL_VERSION;
  requestId: number;
}

export type PoseWorkerRequest =
  | (WorkerEnvelope & {
      type: "initialize";
      fixture?: "deterministic";
    })
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

const envelope = (
  value: unknown,
): { protocolVersion: 1; requestId: number; type: string } => {
  if (!value || typeof value !== "object")
    throw new TypeError("Worker message must be an object.");
  const candidate = value as Record<string, unknown>;
  if (
    candidate.protocolVersion !== POSE_WORKER_PROTOCOL_VERSION ||
    !Number.isSafeInteger(candidate.requestId) ||
    typeof candidate.type !== "string"
  )
    throw new TypeError("Worker message envelope is invalid.");
  return candidate as {
    protocolVersion: 1;
    requestId: number;
    type: string;
  };
};

export function parsePoseWorkerRequest(value: unknown): PoseWorkerRequest {
  const candidate = envelope(value) as ReturnType<typeof envelope> &
    Record<string, unknown>;
  if (candidate.type === "initialize") {
    if (
      candidate.fixture !== undefined &&
      candidate.fixture !== "deterministic"
    )
      throw new TypeError("Worker fixture is invalid.");
    return candidate as unknown as PoseWorkerRequest;
  }
  if (candidate.type === "dispose")
    return candidate as unknown as PoseWorkerRequest;
  if (
    candidate.type !== "frame" ||
    typeof candidate.timestamp !== "number" ||
    !Number.isFinite(candidate.timestamp) ||
    !candidate.bitmap ||
    typeof (candidate.bitmap as { close?: unknown }).close !== "function"
  )
    throw new TypeError("Worker request payload is invalid.");
  return candidate as unknown as PoseWorkerRequest;
}

export function parsePoseWorkerResponse(value: unknown): PoseWorkerResponse {
  const candidate = envelope(value) as ReturnType<typeof envelope> &
    Record<string, unknown>;
  if (candidate.type === "ready" || candidate.type === "disposed")
    return candidate as unknown as PoseWorkerResponse;
  if (
    candidate.type === "recoverable-error" ||
    candidate.type === "fatal-error"
  ) {
    if (typeof candidate.message !== "string")
      throw new TypeError("Worker error payload is invalid.");
    return candidate as unknown as PoseWorkerResponse;
  }
  if (
    candidate.type !== "result" ||
    typeof candidate.timestamp !== "number" ||
    !Number.isFinite(candidate.timestamp) ||
    typeof candidate.inferenceMs !== "number" ||
    !Number.isFinite(candidate.inferenceMs) ||
    candidate.inferenceMs < 0 ||
    !(
      candidate.landmarks === null ||
      (Array.isArray(candidate.landmarks) &&
        candidate.landmarks.every(
          (landmark) =>
            landmark !== null &&
            typeof landmark === "object" &&
            ["x", "y", "z"].every(
              (key) =>
                typeof (landmark as Record<string, unknown>)[key] ===
                  "number" &&
                Number.isFinite((landmark as Record<string, number>)[key]),
            ),
        ))
    )
  )
    throw new TypeError("Worker result payload is invalid.");
  return candidate as unknown as PoseWorkerResponse;
}
