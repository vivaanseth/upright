import { describe, expect, it } from "vitest";
import { AdaptiveSamplingController } from "./adaptive-sampling";

const healthy = {
  onBattery: false,
  reduceOnBattery: true,
  latencyEwmaMs: 60,
  dropRate: 0.01,
};

describe("AdaptiveSamplingController", () => {
  it("starts at five and reaches eight after ten stable seconds", () => {
    const controller = new AdaptiveSamplingController(0);
    expect(controller.next(healthy, 0)).toBe(5);
    expect(controller.next(healthy, 9_999)).toBe(5);
    expect(controller.next(healthy, 10_000)).toBe(8);
  });

  it("reduces to three after sustained pressure", () => {
    for (const pressure of [
      { ...healthy, onBattery: true },
      { ...healthy, latencyEwmaMs: 151 },
      { ...healthy, dropRate: 0.21 },
    ]) {
      const controller = new AdaptiveSamplingController(0);
      expect(controller.next(pressure, 2_999)).toBe(5);
      expect(controller.next(pressure, 3_000)).toBe(3);
    }
  });

  it("uses dwell time and hysteresis while recovering", () => {
    const controller = new AdaptiveSamplingController(0);
    controller.next({ ...healthy, latencyEwmaMs: 200 }, 3_000);
    expect(controller.next(healthy, 12_999)).toBe(3);
    expect(controller.next(healthy, 13_000)).toBe(5);
    expect(controller.next(healthy, 23_000)).toBe(8);
    expect(controller.next({ ...healthy, latencyEwmaMs: 110 }, 28_000)).toBe(5);
  });

  it("resets accumulated state", () => {
    const controller = new AdaptiveSamplingController(0);
    controller.next(healthy, 10_000);
    controller.reset(20_000);
    expect(controller.current).toBe(5);
    expect(controller.next(healthy, 29_999)).toBe(5);
  });
});
