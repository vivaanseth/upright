import { z } from "zod";

export const postureStates = [
  "good",
  "caution",
  "poor",
  "unknown",
  "away",
  "paused",
  "calibrating",
] as const;

export type PostureState = (typeof postureStates)[number];

export const trackingModes = [
  "stopped",
  "requesting-permission",
  "preview",
  "calibrating",
  "tracking",
  "paused",
  "recovering",
  "error",
] as const;

export const trackingModeSchema = z.enum(trackingModes);
export type TrackingMode = z.infer<typeof trackingModeSchema>;

const trackingRuntimeFields = {
  schemaVersion: z.literal(1),
  mode: trackingModeSchema,
  cameraId: z.string().min(1).max(512).nullable(),
  calibrationId: z.string().uuid().nullable(),
  errorCode: z.string().min(1).max(80).nullable(),
};

const validateTrackingRuntime = (
  state: {
    mode: TrackingMode;
    cameraId: string | null;
    calibrationId: string | null;
  },
  context: z.RefinementCtx,
): void => {
  if (state.mode !== "tracking") return;
  if (!state.cameraId)
    context.addIssue({
      code: "custom",
      path: ["cameraId"],
      message: "Tracking requires an active camera.",
    });
  if (!state.calibrationId)
    context.addIssue({
      code: "custom",
      path: ["calibrationId"],
      message: "Tracking requires an exact calibration.",
    });
};

export const trackingRuntimeReportSchema = z
  .object(trackingRuntimeFields)
  .strict()
  .superRefine(validateTrackingRuntime);
export type TrackingRuntimeReport = z.infer<typeof trackingRuntimeReportSchema>;

export const trackingRuntimeStateSchema = z
  .object({
    ...trackingRuntimeFields,
    updatedAt: z.number().finite(),
  })
  .strict()
  .superRefine(validateTrackingRuntime);
export type TrackingRuntimeState = z.infer<typeof trackingRuntimeStateSchema>;

export const cameraOwners = [
  "none",
  "onboarding-preview",
  "diagnostics-preview",
  "calibration",
  "tracking",
] as const;
export const cameraOwnerSchema = z.enum(cameraOwners);
export type CameraOwner = z.infer<typeof cameraOwnerSchema>;

export const cameraFailureCodes = [
  "permission-denied",
  "permission-restricted",
  "no-device",
  "device-busy",
  "device-disconnected",
  "unsupported",
  "playback-failed",
  "worker-init-failed",
  "unknown",
] as const;
export const cameraFailureCodeSchema = z.enum(cameraFailureCodes);
export type CameraFailureCode = z.infer<typeof cameraFailureCodeSchema>;

export const cameraOpenResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), cameraId: z.string().min(1).max(512) }),
  z.object({ ok: z.literal(false), code: cameraFailureCodeSchema }),
]);
export type CameraOpenResult = z.infer<typeof cameraOpenResultSchema>;

export const featureExtractionFailureReasons = [
  "missing-head",
  "missing-shoulders",
  "low-confidence",
  "invalid-framing",
] as const;
export type FeatureExtractionResult =
  | {
      ok: true;
      features: PostureFeatures;
      reliability: {
        lateralHeadTilt: number;
        trunkLean: number;
      };
    }
  | {
      ok: false;
      reason: (typeof featureExtractionFailureReasons)[number];
    };

export interface ScoringConfig {
  readonly version: string;
  readonly requiredConfidence: number;
  readonly awayAfterMs: number;
  readonly smoothingTimeConstantMs: number;
  readonly hysteresisPoints: number;
  readonly tolerances: {
    readonly forwardHead: number;
    readonly lateralHeadTilt: number;
    readonly shoulderSlope: number;
    readonly upperBodyLean: number;
    readonly verticalCompression: number;
  };
  readonly weights: {
    readonly forwardHead: number;
    readonly lateralHeadTilt: number;
    readonly shoulderSlope: number;
    readonly upperBody: number;
  };
}

export const runtimeDiagnosticsSchema = z.object({
  targetFps: z.union([z.literal(3), z.literal(5), z.literal(8)]),
  measuredFps: z.number().min(0),
  inferenceMedianMs: z.number().min(0).nullable(),
  inferenceP95Ms: z.number().min(0).nullable(),
  dropRate: z.number().min(0).max(1),
  workerRestarts: z.number().int().min(0),
  cameraOwner: cameraOwnerSchema,
  featureReliability: z
    .object({
      lateralHeadTilt: z.number().min(0).max(1),
      trunkLean: z.number().min(0).max(1),
    })
    .nullable(),
});
export type RuntimeDiagnostics = z.infer<typeof runtimeDiagnosticsSchema>;

export const powerStateSchema = z.object({
  onBattery: z.boolean(),
  updatedAt: z.number().finite(),
});

export type PowerState = z.infer<typeof powerStateSchema>;

export const storageRecoveryNoticeSchema = z.object({
  schemaVersion: z.literal(1),
  file: z.enum(["settings.json", "calibrations.json", "sessions.json"]),
  backupPath: z.string().min(1),
  recoveredAt: z.string().datetime(),
});

export type StorageRecoveryNotice = z.infer<typeof storageRecoveryNoticeSchema>;

export const settingsSchema = z.object({
  schemaVersion: z.literal(1),
  selectedCameraId: z.string().max(512).nullable(),
  sensitivity: z.enum(["low", "balanced", "high"]),
  reminderDelaySeconds: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  cooldownMinutes: z.union([z.literal(5), z.literal(10), z.literal(20)]),
  soundEnabled: z.boolean(),
  launchAtLogin: z.boolean(),
  autoStartTracking: z.boolean(),
  reduceOnBattery: z.boolean(),
  theme: z.enum(["system", "light", "dark"]),
  onboardingComplete: z.boolean(),
  diagnosticsEnabled: z.boolean(),
});

export type Settings = z.infer<typeof settingsSchema>;

export const defaultSettings: Settings = {
  schemaVersion: 1,
  selectedCameraId: null,
  sensitivity: "balanced",
  reminderDelaySeconds: 30,
  cooldownMinutes: 10,
  soundEnabled: false,
  launchAtLogin: false,
  autoStartTracking: false,
  reduceOnBattery: true,
  theme: "system",
  onboardingComplete: false,
  diagnosticsEnabled: false,
};

export const postureFeaturesSchema = z.object({
  forwardHead: z.number().finite(),
  lateralHeadTilt: z.number().finite(),
  shoulderSlope: z.number().finite(),
  verticalCompression: z.number().finite(),
  trunkLean: z.number().finite().nullable(),
  confidence: z.number().min(0).max(1),
  shoulderWidth: z.number().positive().optional(),
  centerOffset: z.number().finite().optional(),
  lateralHeadTiltReliable: z.boolean().optional(),
});

export type PostureFeatures = z.infer<typeof postureFeaturesSchema>;

export const calibrationV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  cameraId: z.string().min(1).max(512),
  createdAt: z.string().datetime(),
  modelVersion: z.string().min(1),
  resolution: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  baseline: postureFeaturesSchema,
  variance: postureFeaturesSchema,
});

export type CalibrationV1 = z.infer<typeof calibrationV1Schema>;

export const calibrationReliabilitySchema = z.object({
  forwardHead: z.number().min(0).max(1),
  lateralHeadTilt: z.number().min(0).max(1),
  shoulderSlope: z.number().min(0).max(1),
  verticalCompression: z.number().min(0).max(1),
  trunkLean: z.number().min(0).max(1),
});

export const calibrationSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.string().uuid(),
  cameraId: z.string().min(1).max(512),
  createdAt: z.string().datetime(),
  modelVersion: z.string().min(1),
  scoringConfigVersion: z.string().min(1),
  resolution: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  orientation: z.enum(["landscape", "portrait", "unknown"]),
  baseline: postureFeaturesSchema,
  medianAbsoluteDeviation: postureFeaturesSchema,
  reliability: calibrationReliabilitySchema,
  validFrameCount: z.number().int().min(0),
  rejectedFrameCount: z.number().int().min(0),
  compatibility: z.enum(["compatible", "recalibration-required"]),
});

export type Calibration = z.infer<typeof calibrationSchema>;
export const calibrationRecordSchema = z.union([
  calibrationSchema,
  calibrationV1Schema,
]);
export type CalibrationRecord = z.infer<typeof calibrationRecordSchema>;

export const metricBreakdownSchema = z.object({
  forwardHead: z.number().min(0).max(100),
  lateralHeadTilt: z.number().min(0).max(100),
  shoulderSlope: z.number().min(0).max(100),
  upperBody: z.number().min(0).max(100),
});

export type MetricBreakdown = z.infer<typeof metricBreakdownSchema>;

export const trackingSnapshotSchema = z.object({
  state: z.enum(postureStates),
  score: z.number().min(0).max(100).nullable(),
  confidence: z.number().min(0).max(1),
  inferenceMs: z.number().min(0).nullable(),
  sampledFps: z.number().min(0),
  timestamp: z.number().finite(),
  breakdown: metricBreakdownSchema.nullable(),
  message: z.string().max(240),
});

export type TrackingSnapshot = z.infer<typeof trackingSnapshotSchema>;
export const trackingSnapshotReportSchema = trackingSnapshotSchema
  .omit({
    timestamp: true,
  })
  .strict();
export type TrackingSnapshotReport = z.infer<
  typeof trackingSnapshotReportSchema
>;

const sessionSummaryFields = {
  id: z.string().uuid(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  trackedMs: z.number().min(0),
  goodMs: z.number().min(0),
  cautionMs: z.number().min(0),
  poorMs: z.number().min(0),
  unknownMs: z.number().min(0),
  awayMs: z.number().min(0),
  averageScore: z.number().min(0).max(100).nullable(),
  reminderCount: z.number().int().min(0),
  calibrationId: z.string().uuid().nullable(),
};

export const sessionSummaryV1Schema = z.object({
  schemaVersion: z.literal(1),
  ...sessionSummaryFields,
});

export const sessionSummarySchema = z.object({
  schemaVersion: z.literal(2),
  ...sessionSummaryFields,
  updatedAt: z.string().datetime(),
  recovered: z.boolean(),
});

export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export const sessionRecordSchema = z.union([
  sessionSummarySchema,
  sessionSummaryV1Schema,
]);
export type SessionRecord = z.infer<typeof sessionRecordSchema>;

export const exportV2Schema = z.object({
  schemaVersion: z.literal(2),
  exportedAt: z.string().datetime(),
  app: z.literal("Posture"),
  settings: settingsSchema,
  calibrations: z.array(calibrationRecordSchema),
  sessions: z.array(sessionSummarySchema),
  privacyNote: z.string().min(1).max(500),
});
export type ExportV2 = z.infer<typeof exportV2Schema>;

export const exportV3Schema = z.object({
  schemaVersion: z.literal(3),
  exportedAt: z.string().datetime(),
  app: z.literal("Upright"),
  settings: settingsSchema,
  calibrations: z.array(calibrationRecordSchema),
  sessions: z.array(sessionSummarySchema),
  privacyNote: z.string().min(1).max(500),
});
export type ExportV3 = z.infer<typeof exportV3Schema>;

export const appInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.enum(["darwin", "win32", "linux"]),
  isPackaged: z.boolean(),
});

export type AppInfo = z.infer<typeof appInfoSchema>;

export type TrustedUrlKind =
  | "repository"
  | "releases"
  | "privacy"
  | "mediapipe";

export const cameraAccessStatusSchema = z.enum([
  "not-determined",
  "granted",
  "denied",
  "restricted",
  "unknown",
]);

export type CameraAccessStatus = z.infer<typeof cameraAccessStatusSchema>;

export interface MainWindowApi {
  app: {
    getInfo: () => Promise<AppInfo>;
    getPowerState: () => Promise<PowerState>;
    onPowerStateChanged: (listener: (state: PowerState) => void) => () => void;
    openExternalTrustedUrl: (kind: TrustedUrlKind) => Promise<void>;
  };
  camera: {
    getAccessStatus: () => Promise<CameraAccessStatus>;
    requestAccess: () => Promise<CameraAccessStatus>;
    openSystemPrivacySettings: () => Promise<boolean>;
  };
  tracking: {
    start: () => Promise<void>;
    pause: (reason?: string) => Promise<void>;
    resume: () => Promise<void>;
    stop: () => Promise<void>;
    reportSnapshot: (snapshot: TrackingSnapshotReport) => void;
    reportRuntimeState: (state: TrackingRuntimeReport) => void;
    onCommand: (listener: (command: TrackingCommand) => void) => () => void;
    cancelCalibration: () => Promise<void>;
  };
  settings: {
    get: () => Promise<Settings>;
    update: (patch: Partial<Settings>) => Promise<Settings>;
  };
  calibrations: {
    list: () => Promise<CalibrationRecord[]>;
    save: (calibration: Calibration) => Promise<CalibrationRecord[]>;
    deleteForCamera: (cameraId: string) => Promise<CalibrationRecord[]>;
  };
  sessions: {
    getCurrent: () => Promise<SessionSummary | null>;
    getRecent: (limit?: number) => Promise<SessionSummary[]>;
  };
  data: {
    export: () => Promise<string | null>;
    deleteSessions: () => Promise<void>;
    resetAll: () => Promise<void>;
  };
  storage: {
    getRecoveries: () => Promise<StorageRecoveryNotice[]>;
    onRecovery: (
      listener: (notice: StorageRecoveryNotice) => void,
    ) => () => void;
  };
  window: {
    hide: () => Promise<void>;
    openMain: () => Promise<void>;
    quit: () => Promise<void>;
  };
  nudge: {
    preview: () => Promise<void>;
  };
  updates: {
    openLatestRelease: () => Promise<void>;
  };
}

export interface NudgeWindowApi {
  dismiss: () => Promise<void>;
  pauseForMinutes: (minutes: 10) => Promise<void>;
  enableInteraction: () => Promise<void>;
  openMain: () => Promise<void>;
}

export const trackingCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }).strict(),
  z
    .object({
      type: z.literal("pause"),
      reason: z.string().max(120).optional(),
    })
    .strict(),
  z.object({ type: z.literal("resume") }).strict(),
  z.object({ type: z.literal("stop") }).strict(),
  z.object({ type: z.literal("recalibrate") }).strict(),
  z.object({ type: z.literal("open-settings") }).strict(),
  z.object({ type: z.literal("cancel-calibration") }).strict(),
  z.object({ type: z.literal("window-hidden") }).strict(),
]);
export type TrackingCommand = z.infer<typeof trackingCommandSchema>;

declare global {
  interface Window {
    upright: MainWindowApi;
    uprightNudge: NudgeWindowApi;
  }
}
