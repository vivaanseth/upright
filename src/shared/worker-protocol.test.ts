import { describe, expect, it, vi } from "vitest";
import {
  parsePoseWorkerRequest,
  parsePoseWorkerResponse,
  POSE_WORKER_PROTOCOL_VERSION,
} from "./worker-protocol";

const envelope = (type: string) => ({
  protocolVersion: POSE_WORKER_PROTOCOL_VERSION,
  requestId: 1,
  type,
});

describe("pose worker protocol", () => {
  it("accepts initialize, frame, and dispose requests", () => {
    expect(parsePoseWorkerRequest(envelope("initialize"))).toMatchObject({
      type: "initialize",
    });
    expect(
      parsePoseWorkerRequest({
        ...envelope("initialize"),
        fixture: "deterministic",
      }),
    ).toMatchObject({ fixture: "deterministic" });
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    expect(
      parsePoseWorkerRequest({
        ...envelope("frame"),
        bitmap,
        timestamp: 42,
      }),
    ).toMatchObject({ type: "frame", bitmap, timestamp: 42 });
    expect(parsePoseWorkerRequest(envelope("dispose"))).toMatchObject({
      type: "dispose",
    });
  });

  it("rejects malformed request envelopes and payloads", () => {
    for (const value of [
      null,
      {},
      { ...envelope("initialize"), protocolVersion: 2 },
      { ...envelope("initialize"), requestId: 1.2 },
      { ...envelope("initialize"), fixture: "unsafe" },
      { ...envelope("frame"), timestamp: Number.NaN, bitmap: { close() {} } },
      { ...envelope("frame"), timestamp: 1, bitmap: {} },
      envelope("unknown"),
    ])
      expect(() => parsePoseWorkerRequest(value)).toThrow(TypeError);
  });

  it("accepts ready, disposed, error, and landmark responses", () => {
    expect(parsePoseWorkerResponse(envelope("ready"))).toMatchObject({
      type: "ready",
    });
    expect(parsePoseWorkerResponse(envelope("disposed"))).toMatchObject({
      type: "disposed",
    });
    for (const type of ["recoverable-error", "fatal-error"]) {
      expect(
        parsePoseWorkerResponse({ ...envelope(type), message: "failed" }),
      ).toMatchObject({ type, message: "failed" });
    }
    expect(
      parsePoseWorkerResponse({
        ...envelope("result"),
        timestamp: 42,
        inferenceMs: 12,
        landmarks: [{ x: 0.5, y: 0.4, z: -0.1, visibility: 0.9 }],
      }),
    ).toMatchObject({ type: "result", inferenceMs: 12 });
    expect(
      parsePoseWorkerResponse({
        ...envelope("result"),
        timestamp: 42,
        inferenceMs: 0,
        landmarks: null,
      }),
    ).toMatchObject({ landmarks: null });
  });

  it("rejects malformed response payloads", () => {
    for (const value of [
      { ...envelope("fatal-error"), message: 5 },
      { ...envelope("result"), timestamp: 1, inferenceMs: -1, landmarks: null },
      {
        ...envelope("result"),
        timestamp: Number.POSITIVE_INFINITY,
        inferenceMs: 1,
        landmarks: null,
      },
      {
        ...envelope("result"),
        timestamp: 1,
        inferenceMs: 1,
        landmarks: [{ x: "bad", y: 0, z: 0 }],
      },
      envelope("other"),
    ])
      expect(() => parsePoseWorkerResponse(value)).toThrow(TypeError);
  });
});
