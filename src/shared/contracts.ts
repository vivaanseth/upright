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

export const trackingRuntimeStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: trackingModeSchema,
    cameraId: z.string().min(1).max(512).nullable(),
    calibrationId: z.string().uuid().nullable(),
    errorCode: z.string().min(1).max(80).nullable(),
    updatedAt: z.number().finite(),
  })
  .superRefine((state, context) => {
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
  });

export type TrackingRuntimeState = z.infer<typeof trackingRuntimeStateSchema>;

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

export interface PostureApi {
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
    reportRuntimeState: (state: TrackingRuntimeState) => void;
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
    dismiss: () => Promise<void>;
    pauseForMinutes: (minutes: 10 | 30 | 60) => Promise<void>;
    enableInteraction: () => Promise<void>;
  };
  updates: {
    openLatestRelease: () => Promise<void>;
  };
}

export type TrackingCommand =
  | { type: "start" }
  | { type: "pause"; reason?: string }
  | { type: "resume" }
  | { type: "stop" }
  | { type: "recalibrate" }
  | { type: "open-settings" }
  | { type: "cancel-calibration" }
  | { type: "window-hidden" };

declare global {
  interface Window {
    posture: PostureApi;
  }
}
