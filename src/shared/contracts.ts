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
});

export type PostureFeatures = z.infer<typeof postureFeaturesSchema>;

export const calibrationSchema = z.object({
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

export type Calibration = z.infer<typeof calibrationSchema>;

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

export const sessionSummarySchema = z.object({
  schemaVersion: z.literal(1),
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
});

export type SessionSummary = z.infer<typeof sessionSummarySchema>;

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
    reportSnapshot: (snapshot: TrackingSnapshot) => void;
    onCommand: (listener: (command: TrackingCommand) => void) => () => void;
  };
  settings: {
    get: () => Promise<Settings>;
    update: (patch: Partial<Settings>) => Promise<Settings>;
  };
  calibrations: {
    list: () => Promise<Calibration[]>;
    save: (calibration: Calibration) => Promise<Calibration[]>;
    deleteForCamera: (cameraId: string) => Promise<Calibration[]>;
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
  window: {
    hide: () => Promise<void>;
    openMain: () => Promise<void>;
    quit: () => Promise<void>;
  };
  nudge: {
    dismiss: () => Promise<void>;
    pauseForMinutes: (minutes: 10 | 30 | 60) => Promise<void>;
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
  | { type: "open-settings" };

declare global {
  interface Window {
    posture: PostureApi;
  }
}
