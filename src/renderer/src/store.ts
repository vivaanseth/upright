import { create } from "zustand";
import {
  defaultSettings,
  type AppInfo,
  type CalibrationRecord,
  type SessionSummary,
  type Settings,
  type StorageRecoveryNotice,
  type TrackingMode,
  type TrackingSnapshot,
} from "../../shared/contracts";

export type View = "dashboard" | "history" | "settings" | "diagnostics";

interface AppStore {
  initialized: boolean;
  initializationError: string | null;
  appInfo: AppInfo | null;
  settings: Settings;
  calibrations: CalibrationRecord[];
  session: SessionSummary | null;
  recentSessions: SessionSummary[];
  snapshot: TrackingSnapshot;
  view: View;
  tracking: boolean;
  trackingMode: TrackingMode;
  cameraError: string | null;
  storageRecovery: StorageRecoveryNotice | null;
  setSnapshot: (snapshot: TrackingSnapshot) => void;
  setSession: (session: SessionSummary | null) => void;
  setCalibrations: (calibrations: CalibrationRecord[]) => void;
  setTracking: (tracking: boolean) => void;
  setTrackingMode: (trackingMode: TrackingMode) => void;
  setCameraError: (cameraError: string | null) => void;
  setStorageRecovery: (notice: StorageRecoveryNotice | null) => void;
  setView: (view: View) => void;
  initialize: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  completeOnboarding: () => Promise<void>;
  refreshCurrentSession: () => Promise<void>;
  refreshRecentSessions: () => Promise<void>;
  deleteSessions: () => Promise<void>;
  deleteCalibration: (cameraId: string) => Promise<void>;
  resetAll: () => Promise<void>;
}

let currentSessionRefresh: Promise<void> | null = null;

const initialSnapshot: TrackingSnapshot = {
  state: "paused",
  score: null,
  confidence: 0,
  inferenceMs: null,
  sampledFps: 0,
  timestamp: 0,
  breakdown: null,
  message: "Camera access is paused.",
};

export const useAppStore = create<AppStore>((set) => ({
  initialized: false,
  initializationError: null,
  appInfo: null,
  settings: defaultSettings,
  calibrations: [],
  session: null,
  recentSessions: [],
  snapshot: initialSnapshot,
  view: "dashboard",
  tracking: false,
  trackingMode: "stopped",
  cameraError: null,
  storageRecovery: null,
  setSnapshot: (snapshot) => set({ snapshot }),
  setSession: (session) => set({ session }),
  setCalibrations: (calibrations) => set({ calibrations }),
  setTracking: (tracking) => set({ tracking }),
  setTrackingMode: (trackingMode) =>
    set({ trackingMode, tracking: trackingMode === "tracking" }),
  setCameraError: (cameraError) => set({ cameraError }),
  setStorageRecovery: (storageRecovery) => set({ storageRecovery }),
  setView: (view) => set({ view }),
  initialize: async () => {
    set({ initializationError: null });
    try {
      const [appInfo, settings, calibrations, recentSessions, recoveries] =
        await Promise.all([
          window.upright.app.getInfo(),
          window.upright.settings.get(),
          window.upright.calibrations.list(),
          window.upright.sessions.getRecent(10),
          window.upright.storage.getRecoveries(),
        ]);
      set({
        initialized: true,
        initializationError: null,
        appInfo,
        settings,
        calibrations,
        recentSessions,
        storageRecovery: recoveries.at(-1) ?? null,
      });
    } catch (error) {
      set({
        initializationError:
          error instanceof Error ? error.message : "Upright could not start.",
      });
    }
  },
  updateSettings: async (patch) =>
    set({ settings: await window.upright.settings.update(patch) }),
  completeOnboarding: async () => {
    const settings = await window.upright.settings.update({
      onboardingComplete: true,
    });
    set({ settings, view: "dashboard" });
  },
  refreshCurrentSession: () => {
    if (currentSessionRefresh) return currentSessionRefresh;
    const request = window.upright.sessions
      .getCurrent()
      .then((session) => set({ session }))
      .finally(() => {
        if (currentSessionRefresh === request) currentSessionRefresh = null;
      });
    currentSessionRefresh = request;
    return request;
  },
  refreshRecentSessions: async () =>
    set({ recentSessions: await window.upright.sessions.getRecent(20) }),
  deleteSessions: async () => {
    await window.upright.data.deleteSessions();
    set({ session: null, recentSessions: [] });
  },
  deleteCalibration: async (cameraId) =>
    set({
      calibrations: await window.upright.calibrations.deleteForCamera(cameraId),
    }),
  resetAll: async () => {
    await window.upright.data.resetAll();
    set({
      settings: defaultSettings,
      calibrations: [],
      session: null,
      recentSessions: [],
      snapshot: initialSnapshot,
      view: "dashboard",
      tracking: false,
      trackingMode: "stopped",
      cameraError: null,
      storageRecovery: null,
      initializationError: null,
    });
  },
}));
