import { describe, expect, it } from "vitest";
import {
  defaultSettings,
  type Calibration,
  type PostureFeatures,
} from "./contracts";
import {
  buildCalibration,
  CalibrationError,
  PostureClassifier,
  scorePosture,
} from "./posture-engine";

const baseline: PostureFeatures = {
  forwardHead: 0.2,
  lateralHeadTilt: 0,
  shoulderSlope: 0,
  verticalCompression: 1.2,
  trunkLean: 0,
  confidence: 0.95,
};

const calibration: Calibration = {
  schemaVersion: 2,
  id: "00000000-0000-4000-8000-000000000000",
  cameraId: "camera-1",
  createdAt: "2026-07-11T12:00:00.000Z",
  modelVersion: "test",
  scoringConfigVersion: "test-scoring",
  resolution: { width: 640, height: 480 },
  orientation: "landscape",
  baseline,
  medianAbsoluteDeviation: {
    forwardHead: 0.01,
    lateralHeadTilt: 0.2,
    shoulderSlope: 0.2,
    verticalCompression: 0.01,
    trunkLean: 0.2,
    confidence: 0.01,
  },
  reliability: {
    forwardHead: 1,
    lateralHeadTilt: 1,
    shoulderSlope: 1,
    verticalCompression: 1,
    trunkLean: 1,
  },
  validFrameCount: 50,
  rejectedFrameCount: 0,
  compatibility: "compatible",
};

describe("posture scoring", () => {
  it("scores the calibrated baseline as good", () => {
    const result = scorePosture(baseline, calibration, "balanced");
    expect(result.score).toBe(100);
    expect(result.breakdown.upperBody).toBe(100);
  });

  it("penalizes combined forward head and compression drift", () => {
    const result = scorePosture(
      { ...baseline, forwardHead: 0.34, verticalCompression: 0.9 },
      calibration,
      "balanced",
    );
    expect(result.score).toBeLessThan(50);
    expect(result.breakdown.forwardHead).toBe(0);
  });

  it("makes high sensitivity react more strongly than low sensitivity", () => {
    const current = { ...baseline, forwardHead: 0.28 };
    const high = scorePosture(current, calibration, "high").score;
    const low = scorePosture(current, calibration, "low").score;
    expect(high).not.toBeNull();
    expect(low).not.toBeNull();
    expect(high!).toBeLessThan(low!);
  });

  it("returns unavailable instead of Poor when no metric is reliable", () => {
    const unreliable: Calibration = {
      ...calibration,
      reliability: {
        forwardHead: 0,
        lateralHeadTilt: 0,
        shoulderSlope: 0,
        verticalCompression: 0,
        trunkLean: 0,
      },
    };
    expect(scorePosture(baseline, unreliable, "balanced").score).toBeNull();
    expect(
      new PostureClassifier().update(
        baseline,
        unreliable,
        defaultSettings,
        12,
        5,
        1_000,
      ).state,
    ).toBe("unknown");
  });
});

describe("calibration", () => {
  it("uses robust medians for stable samples", () => {
    const samples = Array.from({ length: 50 }, (_, index) => ({
      ...baseline,
      forwardHead: index === 49 ? 4 : 0.2 + (index % 2) * 0.002,
    }));
    const result = buildCalibration(samples, "camera-1", {
      width: 640,
      height: 480,
    });
    expect(result.baseline.forwardHead).toBeCloseTo(0.201, 3);
  });

  it("rejects too few samples", () => {
    expect(() =>
      buildCalibration([baseline], "camera-1", { width: 640, height: 480 }),
    ).toThrow(/longer/i);
  });

  it("rejects unstable calibration", () => {
    const samples = Array.from({ length: 50 }, (_, index) => ({
      ...baseline,
      forwardHead: index % 2 === 0 ? 0 : 0.5,
    }));
    expect(() =>
      buildCalibration(samples, "camera-1", { width: 640, height: 480 }),
    ).toThrow(/movement/i);
  });

  it("returns typed framing rejection reasons", () => {
    const samples = Array.from({ length: 50 }, () => ({
      ...baseline,
      shoulderWidth: 0.6,
      centerOffset: 0,
      lateralHeadTiltReliable: true,
    }));
    try {
      buildCalibration(samples, "camera-1", { width: 640, height: 480 });
      throw new Error("Expected calibration to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(CalibrationError);
      expect((error as CalibrationError).reason).toBe("too-close");
    }
  });

  it("requires ten seconds of elapsed calibration time", () => {
    const samples = Array.from({ length: 50 }, () => baseline);
    expect(() =>
      buildCalibration(
        samples,
        "camera-1",
        { width: 640, height: 480 },
        "test",
        { elapsedMs: 9_999, rejectedFrameCount: 0 },
      ),
    ).toThrowError(CalibrationError);
  });
});

describe("classification", () => {
  it("keeps missing landmarks unknown before marking the user away", () => {
    const classifier = new PostureClassifier();
    expect(
      classifier.update(null, calibration, defaultSettings, null, 5, 1_000)
        .state,
    ).toBe("unknown");
    expect(
      classifier.update(null, calibration, defaultSettings, null, 5, 17_000)
        .state,
    ).toBe("away");
  });

  it("uses hysteresis around the good boundary", () => {
    const classifier = new PostureClassifier();
    const first = classifier.update(
      baseline,
      calibration,
      defaultSettings,
      12,
      5,
      1_000,
    );
    expect(first.state).toBe("good");
    const drift = { ...baseline, forwardHead: 0.27 };
    const second = classifier.update(
      drift,
      calibration,
      defaultSettings,
      12,
      5,
      2_000,
    );
    expect(second.state).toBe("good");
  });
});
