import { describe, expect, it } from "vitest";
import {
  defaultSettings,
  type Calibration,
  type PostureFeatures,
} from "./contracts";
import {
  buildCalibration,
  CalibrationError,
  extractPostureFeatures,
  type Landmark,
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

  it("redistributes unavailable optional metrics across reliable metrics", () => {
    const noUpperBody: Calibration = {
      ...calibration,
      baseline: { ...baseline, trunkLean: null },
      reliability: {
        ...calibration.reliability,
        verticalCompression: 0,
        trunkLean: 0,
      },
    };
    const score = scorePosture(
      { ...baseline, trunkLean: null, forwardHead: 0.26 },
      noUpperBody,
      "balanced",
    ).score;
    expect(score).toBe(72);
  });

  it("handles left and right angle wrap without false penalties", () => {
    const wrappedCalibration: Calibration = {
      ...calibration,
      baseline: { ...baseline, shoulderSlope: 179 },
    };
    const result = scorePosture(
      { ...baseline, shoulderSlope: -179 },
      wrappedCalibration,
      "balanced",
    );
    expect(result.breakdown.shoulderSlope).toBeGreaterThan(70);
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

  it("rejects low valid-frame ratios", () => {
    const samples = Array.from({ length: 25 }, () => baseline);
    expect(() =>
      buildCalibration(
        samples,
        "camera-1",
        { width: 640, height: 480 },
        "test",
        { elapsedMs: 10_000, rejectedFrameCount: 25 },
      ),
    ).toThrow(/could not see/i);
  });

  it("rejects off-center and too-far framing with typed reasons", () => {
    const offCenter = Array.from({ length: 50 }, () => ({
      ...baseline,
      shoulderWidth: 0.3,
      centerOffset: 0.24,
      lateralHeadTiltReliable: true,
    }));
    const tooFar = Array.from({ length: 50 }, () => ({
      ...baseline,
      shoulderWidth: 0.1,
      centerOffset: 0,
      lateralHeadTiltReliable: true,
    }));

    expect(() =>
      buildCalibration(offCenter, "camera-1", { width: 640, height: 480 }),
    ).toThrowError(expect.objectContaining({ reason: "off-center" }));
    expect(() =>
      buildCalibration(tooFar, "camera-1", { width: 640, height: 480 }),
    ).toThrowError(expect.objectContaining({ reason: "too-far" }));
  });

  it("marks trunk reliability unavailable when hips are not reliable enough", () => {
    const samples = Array.from({ length: 50 }, () => ({
      ...baseline,
      trunkLean: null,
      shoulderWidth: 0.3,
      centerOffset: 0,
      lateralHeadTiltReliable: true,
    }));
    const result = buildCalibration(samples, "camera-1", {
      width: 480,
      height: 640,
    });
    expect(result.orientation).toBe("portrait");
    expect(result.baseline.trunkLean).toBeNull();
    expect(result.reliability.trunkLean).toBe(0);
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

  it("moves from caution to poor and back only after hysteresis boundaries", () => {
    const classifier = new PostureClassifier();
    expect(
      classifier.update(
        { ...baseline, forwardHead: 0.3 },
        calibration,
        defaultSettings,
        12,
        5,
        1_000,
      ).state,
    ).toBe("caution");
    expect(
      classifier.update(
        {
          ...baseline,
          forwardHead: 0.42,
          shoulderSlope: 20,
          verticalCompression: 0.8,
        },
        calibration,
        defaultSettings,
        12,
        5,
        4_000,
      ).state,
    ).toBe("poor");
    expect(
      classifier.update(
        {
          ...baseline,
          forwardHead: 0.42,
          shoulderSlope: 20,
          verticalCompression: 0.8,
        },
        calibration,
        defaultSettings,
        12,
        5,
        7_000,
      ).state,
    ).toBe("poor");
    expect(
      classifier.update(baseline, calibration, defaultSettings, 12, 5, 10_000)
        .state,
    ).toBe("caution");
  });

  it("emits a paused snapshot without carrying score state", () => {
    const paused = new PostureClassifier().paused(5_000);
    expect(paused).toMatchObject({
      state: "paused",
      score: null,
      sampledFps: 0,
    });
  });
});

describe("landmark feature extraction", () => {
  const emptyLandmarks = (): Landmark[] =>
    Array.from({ length: 33 }, () => ({
      x: 0.5,
      y: 0.5,
      z: 0,
      visibility: 0.95,
      presence: 0.95,
    }));

  const framedLandmarks = (): Landmark[] => {
    const landmarks = emptyLandmarks();
    landmarks[0] = { x: 0.5, y: 0.3, z: -0.05, visibility: 0.95 };
    landmarks[7] = { x: 0.43, y: 0.26, z: -0.05, visibility: 0.95 };
    landmarks[8] = { x: 0.57, y: 0.26, z: -0.05, visibility: 0.95 };
    landmarks[11] = { x: 0.36, y: 0.58, z: 0, visibility: 0.95 };
    landmarks[12] = { x: 0.64, y: 0.58, z: 0, visibility: 0.95 };
    landmarks[23] = { x: 0.4, y: 0.9, z: 0, visibility: 0.95 };
    landmarks[24] = { x: 0.6, y: 0.9, z: 0, visibility: 0.95 };
    return landmarks;
  };

  it("extracts upper-body features when required landmarks are visible", () => {
    const features = extractPostureFeatures(framedLandmarks());
    expect(features).toMatchObject({
      confidence: 0.95,
      lateralHeadTiltReliable: true,
    });
    expect(features?.trunkLean).not.toBeNull();
  });

  it("returns null for missing, low-confidence, or impossible framing", () => {
    expect(extractPostureFeatures([])).toBeNull();

    const lowConfidence = framedLandmarks();
    lowConfidence[11].visibility = 0.2;
    expect(extractPostureFeatures(lowConfidence)).toBeNull();

    const tooNarrow = framedLandmarks();
    tooNarrow[11].x = 0.49;
    tooNarrow[12].x = 0.5;
    expect(extractPostureFeatures(tooNarrow)).toBeNull();

    const tooWide = framedLandmarks();
    tooWide[11].x = 0.1;
    tooWide[12].x = 0.9;
    expect(extractPostureFeatures(tooWide)).toBeNull();
  });

  it("falls back to nose-based tilt when ears are unavailable", () => {
    const landmarks = framedLandmarks();
    landmarks[7].visibility = 0.2;
    const features = extractPostureFeatures(landmarks);
    expect(features?.lateralHeadTiltReliable).toBe(false);
    expect(features?.trunkLean).not.toBeNull();
  });

  it("treats hips as optional for upper-body scoring", () => {
    const landmarks = framedLandmarks();
    landmarks[23].visibility = 0.2;
    const features = extractPostureFeatures(landmarks);
    expect(features?.trunkLean).toBeNull();
    expect(features?.confidence).toBe(0.95);
  });
});
