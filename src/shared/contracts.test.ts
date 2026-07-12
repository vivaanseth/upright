import { describe, expect, it } from "vitest";
import { powerStateSchema, trackingRuntimeStateSchema } from "./contracts";

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
});
