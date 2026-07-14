import { describe, expect, it } from "vitest";
import {
  powerStateSchema,
  trackingRuntimeStateSchema,
  trackingSnapshotReportSchema,
} from "./contracts";

describe("runtime contracts", () => {
  it("requires exact camera and calibration identity while tracking", () => {
    const base = {
      schemaVersion: 1,
      mode: "tracking",
      cameraId: null,
      calibrationId: null,
      errorCode: null,
      updatedAt: 100,
    } as const;
    expect(trackingRuntimeStateSchema.safeParse(base).success).toBe(false);
    expect(
      trackingRuntimeStateSchema.safeParse({
        ...base,
        cameraId: "camera-1",
        calibrationId: "00000000-0000-4000-8000-000000000000",
      }).success,
    ).toBe(true);
  });

  it("rejects malformed power events", () => {
    expect(
      powerStateSchema.safeParse({ onBattery: "yes", updatedAt: 1 }).success,
    ).toBe(false);
    expect(
      powerStateSchema.safeParse({ onBattery: true, updatedAt: 1 }).success,
    ).toBe(true);
  });

  it("keeps renderer posture reports timestamp-free", () => {
    const report = {
      state: "poor",
      score: 25,
      confidence: 0.91,
      inferenceMs: 42,
      sampledFps: 5,
      breakdown: null,
      message: "Leaning forward",
    };
    expect(trackingSnapshotReportSchema.parse(report)).toEqual(report);
    expect(
      trackingSnapshotReportSchema.safeParse({
        ...report,
        timestamp: 123,
      }).success,
    ).toBe(false);
  });
});
