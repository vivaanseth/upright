import type {
  Calibration,
  MetricBreakdown,
  PostureFeatures,
  PostureState,
  Settings,
  TrackingSnapshot,
} from "./contracts";

export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
  presence?: number;
}

const REQUIRED_CONFIDENCE = 0.65;
const indexes = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftHip: 23,
  rightHip: 24,
};

export const calibrationRejectionReasons = [
  "insufficient-frames",
  "low-confidence",
  "too-close",
  "too-far",
  "off-center",
  "excessive-motion",
  "head-occluded",
  "shoulders-occluded",
  "unstable-tilt",
  "unstable-trunk",
  "camera-disconnected",
] as const;

export type CalibrationRejectionReason =
  (typeof calibrationRejectionReasons)[number];

export class CalibrationError extends Error {
  readonly reason: CalibrationRejectionReason;

  constructor(reason: CalibrationRejectionReason, message: string) {
    super(message);
    this.name = "CalibrationError";
    this.reason = reason;
  }
}

const confidenceOf = (landmark: Landmark | undefined): number =>
  Math.min(landmark?.visibility ?? 1, landmark?.presence ?? 1);

const midpoint = (a: Landmark, b: Landmark): Landmark => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
  z: (a.z + b.z) / 2,
  visibility: Math.min(confidenceOf(a), confidenceOf(b)),
  presence: Math.min(confidenceOf(a), confidenceOf(b)),
});

const distance2d = (a: Landmark, b: Landmark): number =>
  Math.hypot(a.x - b.x, a.y - b.y);
const degrees = (radians: number): number => (radians * 180) / Math.PI;
const lineAngle = (a: Landmark, b: Landmark): number =>
  degrees(Math.atan2(b.y - a.y, b.x - a.x));

export function extractPostureFeatures(
  landmarks: Landmark[],
): PostureFeatures | null {
  const nose = landmarks[indexes.nose];
  const leftShoulder = landmarks[indexes.leftShoulder];
  const rightShoulder = landmarks[indexes.rightShoulder];
  if (!nose || !leftShoulder || !rightShoulder) return null;

  const requiredConfidence = Math.min(
    confidenceOf(nose),
    confidenceOf(leftShoulder),
    confidenceOf(rightShoulder),
  );
  if (requiredConfidence < REQUIRED_CONFIDENCE) return null;

  const shoulderWidth = distance2d(leftShoulder, rightShoulder);
  if (shoulderWidth < 0.08 || shoulderWidth > 0.72) return null;

  const shoulders = midpoint(leftShoulder, rightShoulder);
  const leftEar = landmarks[indexes.leftEar];
  const rightEar = landmarks[indexes.rightEar];
  const earsReliable =
    leftEar &&
    rightEar &&
    Math.min(confidenceOf(leftEar), confidenceOf(rightEar)) >=
      REQUIRED_CONFIDENCE;
  const head = earsReliable ? midpoint(leftEar, rightEar) : nose;

  const leftHip = landmarks[indexes.leftHip];
  const rightHip = landmarks[indexes.rightHip];
  const hipsReliable =
    leftHip &&
    rightHip &&
    Math.min(confidenceOf(leftHip), confidenceOf(rightHip)) >=
      REQUIRED_CONFIDENCE;
  const hips = hipsReliable ? midpoint(leftHip, rightHip) : null;

  return {
    forwardHead: (shoulders.z - head.z) / shoulderWidth,
    lateralHeadTilt: earsReliable
      ? lineAngle(leftEar, rightEar)
      : degrees(Math.atan2(nose.x - shoulders.x, shoulders.y - nose.y)),
    shoulderSlope: lineAngle(leftShoulder, rightShoulder),
    verticalCompression: (shoulders.y - nose.y) / shoulderWidth,
    trunkLean: hips
      ? degrees(Math.atan2(shoulders.x - hips.x, hips.y - shoulders.y))
      : null,
    confidence: hips
      ? Math.min(requiredConfidence, confidenceOf(hips))
      : requiredConfidence,
    shoulderWidth,
    centerOffset: shoulders.x - 0.5,
    lateralHeadTiltReliable: Boolean(earsReliable),
  };
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const medianAbsoluteDeviation = (values: number[], center: number): number =>
  median(values.map((value) => Math.abs(value - center)));

export function buildCalibration(
  samples: PostureFeatures[],
  cameraId: string,
  resolution: { width: number; height: number },
  modelVersion = "pose-landmarker-lite-0.10.35",
  sampling: { elapsedMs: number; rejectedFrameCount: number } = {
    elapsedMs: 10_000,
    rejectedFrameCount: 0,
  },
): Calibration {
  if (sampling.elapsedMs < 10_000 || samples.length < 25)
    throw new CalibrationError(
      "insufficient-frames",
      "Hold still a little longer so Posture can find a stable baseline.",
    );
  const totalFrameCount = samples.length + sampling.rejectedFrameCount;
  if (samples.length / Math.max(1, totalFrameCount) < 0.65)
    throw new CalibrationError(
      "low-confidence",
      "Posture could not see your head and shoulders consistently. Improve the lighting and keep them in view.",
    );

  const requiredKeys = [
    "forwardHead",
    "lateralHeadTilt",
    "shoulderSlope",
    "verticalCompression",
    "confidence",
  ] as const;
  const baseline = {} as PostureFeatures;
  const variance = {} as PostureFeatures;

  for (const key of requiredKeys) {
    const values = samples.map((sample) => sample[key]);
    const center = median(values);
    baseline[key] = center;
    variance[key] = medianAbsoluteDeviation(values, center);
  }

  const trunkValues = samples.flatMap((sample) =>
    sample.trunkLean === null ? [] : [sample.trunkLean],
  );
  baseline.trunkLean =
    trunkValues.length >= samples.length * 0.7 ? median(trunkValues) : null;
  variance.trunkLean =
    baseline.trunkLean === null
      ? null
      : medianAbsoluteDeviation(trunkValues, baseline.trunkLean);

  const shoulderWidths = samples.flatMap((sample) =>
    sample.shoulderWidth === undefined ? [] : [sample.shoulderWidth],
  );
  const medianShoulderWidth =
    shoulderWidths.length > 0 ? median(shoulderWidths) : null;
  if (medianShoulderWidth !== null && medianShoulderWidth < 0.12)
    throw new CalibrationError(
      "too-far",
      "Move a little closer so your head and shoulders are easier to see.",
    );
  if (medianShoulderWidth !== null && medianShoulderWidth > 0.55)
    throw new CalibrationError(
      "too-close",
      "Move a little farther away so your head and shoulders fit comfortably in view.",
    );

  const centerOffsets = samples.flatMap((sample) =>
    sample.centerOffset === undefined ? [] : [sample.centerOffset],
  );
  if (centerOffsets.length > 0 && Math.abs(median(centerOffsets)) > 0.2)
    throw new CalibrationError(
      "off-center",
      "Center yourself in the camera guide, then try calibration again.",
    );

  if (baseline.confidence < REQUIRED_CONFIDENCE)
    throw new CalibrationError(
      "low-confidence",
      "Posture cannot see your head and shoulders clearly enough.",
    );
  if (variance.lateralHeadTilt > 3.5)
    throw new CalibrationError(
      "unstable-tilt",
      "Keep your head naturally level during calibration, then try again.",
    );
  if (variance.trunkLean !== null && variance.trunkLean > 4)
    throw new CalibrationError(
      "unstable-trunk",
      "Keep your upper body comfortably still during calibration, then try again.",
    );
  if (
    variance.forwardHead > 0.08 ||
    variance.shoulderSlope > 3.5 ||
    variance.verticalCompression > 0.08
  ) {
    throw new CalibrationError(
      "excessive-motion",
      "There was too much movement during calibration. Sit naturally and try again.",
    );
  }

  const reliabilityFromVariance = (
    deviation: number | null,
    tolerance: number,
  ): number =>
    deviation === null
      ? 0
      : clamp(1 - deviation / Math.max(tolerance, 0.001), 0, 1);
  const reliableTiltRatio =
    samples.filter((sample) => sample.lateralHeadTiltReliable).length /
    samples.length;

  return {
    schemaVersion: 2,
    id: crypto.randomUUID(),
    cameraId,
    createdAt: new Date().toISOString(),
    modelVersion,
    scoringConfigVersion: "posture-scoring-v1",
    resolution,
    orientation:
      resolution.width === resolution.height
        ? "unknown"
        : resolution.width > resolution.height
          ? "landscape"
          : "portrait",
    baseline,
    medianAbsoluteDeviation: variance,
    reliability: {
      forwardHead: reliabilityFromVariance(variance.forwardHead, 0.08),
      lateralHeadTilt:
        reliabilityFromVariance(variance.lateralHeadTilt, 3.5) *
        reliableTiltRatio,
      shoulderSlope: reliabilityFromVariance(variance.shoulderSlope, 3.5),
      verticalCompression: reliabilityFromVariance(
        variance.verticalCompression,
        0.08,
      ),
      trunkLean: reliabilityFromVariance(variance.trunkLean, 4),
    },
    validFrameCount: samples.length,
    rejectedFrameCount: sampling.rejectedFrameCount,
    compatibility: "compatible",
  };
}

const sensitivityMultiplier: Record<Settings["sensitivity"], number> = {
  low: 1.25,
  balanced: 1,
  high: 0.75,
};
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function angleDifference(a: number, b: number): number {
  const difference = Math.abs(a - b) % 360;
  return difference > 180 ? 360 - difference : difference;
}

export function scorePosture(
  current: PostureFeatures,
  calibration: Calibration,
  sensitivity: Settings["sensitivity"],
): { score: number | null; breakdown: MetricBreakdown } {
  const multiplier = sensitivityMultiplier[sensitivity];
  const penalty = (deviation: number, tolerance: number): number =>
    clamp(deviation / (tolerance * multiplier), 0, 1);

  const forwardPenalty = penalty(
    Math.max(0, current.forwardHead - calibration.baseline.forwardHead),
    0.12,
  );
  const headTiltPenalty = penalty(
    angleDifference(
      current.lateralHeadTilt,
      calibration.baseline.lateralHeadTilt,
    ),
    8,
  );
  const shoulderPenalty = penalty(
    angleDifference(current.shoulderSlope, calibration.baseline.shoulderSlope),
    7,
  );
  const compressionPenalty = penalty(
    Math.max(
      0,
      (calibration.baseline.verticalCompression - current.verticalCompression) /
        Math.max(0.01, calibration.baseline.verticalCompression),
    ),
    0.12,
  );

  const trunkAvailable =
    current.trunkLean !== null && calibration.baseline.trunkLean !== null;
  const upperPenalty = trunkAvailable
    ? Math.max(
        compressionPenalty,
        penalty(
          angleDifference(current.trunkLean!, calibration.baseline.trunkLean!),
          10,
        ),
      )
    : compressionPenalty;

  const breakdown: MetricBreakdown = {
    forwardHead: Math.round((1 - forwardPenalty) * 100),
    lateralHeadTilt: Math.round((1 - headTiltPenalty) * 100),
    shoulderSlope: Math.round((1 - shoulderPenalty) * 100),
    upperBody: Math.round((1 - upperPenalty) * 100),
  };

  const weightedMetrics = [
    {
      value: breakdown.forwardHead,
      weight: 0.45,
      reliable: calibration.reliability.forwardHead >= 0.25,
    },
    {
      value: breakdown.lateralHeadTilt,
      weight: 0.2,
      reliable: calibration.reliability.lateralHeadTilt >= 0.25,
    },
    {
      value: breakdown.shoulderSlope,
      weight: 0.15,
      reliable: calibration.reliability.shoulderSlope >= 0.25,
    },
    {
      value: breakdown.upperBody,
      weight: 0.2,
      reliable:
        Math.max(
          calibration.reliability.verticalCompression,
          calibration.reliability.trunkLean,
        ) >= 0.25,
    },
  ].filter((metric) => metric.reliable);
  const availableWeight = weightedMetrics.reduce(
    (total, metric) => total + metric.weight,
    0,
  );
  const score =
    availableWeight === 0
      ? null
      : weightedMetrics.reduce(
          (total, metric) => total + metric.value * metric.weight,
          0,
        ) / availableWeight;

  return {
    score: score === null ? null : Math.round(clamp(score, 0, 100)),
    breakdown,
  };
}

const messages: Record<PostureState, string> = {
  good: "You are sitting close to your calibrated position.",
  caution: "A small reset may help.",
  poor: "Take a moment to reset.",
  unknown: "Adjust your position so your head and shoulders are visible.",
  away: "Tracking will continue when you return.",
  paused: "Camera access is paused.",
  calibrating: "Finding your comfortable upright position.",
};

export class PostureClassifier {
  private smoothedScore: number | null = null;
  private state: PostureState = "unknown";
  private lastReliableAt: number | null = null;
  private lastUpdateAt = performance.now();

  update(
    features: PostureFeatures | null,
    calibration: Calibration,
    settings: Settings,
    inferenceMs: number | null,
    sampledFps: number,
    now = performance.now(),
  ): TrackingSnapshot {
    const deltaMs = clamp(now - this.lastUpdateAt, 0, 2_000);
    this.lastUpdateAt = now;

    if (!features) {
      this.lastReliableAt ??= now;
      const nextState: PostureState =
        now - this.lastReliableAt >= 15_000 ? "away" : "unknown";
      this.state = nextState;
      return this.snapshot(
        nextState,
        null,
        0,
        inferenceMs,
        sampledFps,
        null,
        now,
      );
    }

    this.lastReliableAt = now;
    const scored = scorePosture(features, calibration, settings.sensitivity);
    if (scored.score === null) {
      this.smoothedScore = null;
      this.state = "unknown";
      return this.snapshot(
        "unknown",
        null,
        features.confidence,
        inferenceMs,
        sampledFps,
        null,
        now,
      );
    }
    const alpha = 1 - Math.exp(-deltaMs / 3_000);
    this.smoothedScore =
      this.smoothedScore === null
        ? scored.score
        : this.smoothedScore + alpha * (scored.score - this.smoothedScore);
    const score = Math.round(this.smoothedScore);
    this.state = this.classifyWithHysteresis(score);
    return this.snapshot(
      this.state,
      score,
      features.confidence,
      inferenceMs,
      sampledFps,
      scored.breakdown,
      now,
    );
  }

  paused(now = performance.now()): TrackingSnapshot {
    this.state = "paused";
    return this.snapshot("paused", null, 0, null, 0, null, now);
  }

  private classifyWithHysteresis(score: number): PostureState {
    if (this.state === "good" && score >= 70) return "good";
    if (this.state === "poor" && score < 55) return "poor";
    if (this.state === "caution") {
      if (score >= 80) return "good";
      if (score < 45) return "poor";
      return "caution";
    }
    if (score >= 75) return "good";
    if (score < 50) return "poor";
    return "caution";
  }

  private snapshot(
    state: PostureState,
    score: number | null,
    confidence: number,
    inferenceMs: number | null,
    sampledFps: number,
    breakdown: MetricBreakdown | null,
    now: number,
  ): TrackingSnapshot {
    return {
      state,
      score,
      confidence,
      inferenceMs,
      sampledFps,
      breakdown,
      message: messages[state],
      timestamp: now,
    };
  }
}
