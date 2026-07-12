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

export type View = "dashboard" | "settings" | "diagnostics";

interface AppStore {
  initialized: boolean;
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
  refreshSessions: () => Promise<void>;
  deleteSessions: () => Promise<void>;
  deleteCalibration: (cameraId: string) => Promise<void>;
  resetAll: () => Promise<void>;
}

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

export const useAppStore = create<AppStore>((set, get) => ({
  initialized: false,
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
    const [appInfo, settings, calibrations, recentSessions, recoveries] =
      await Promise.all([
        window.posture.app.getInfo(),
        window.posture.settings.get(),
        window.posture.calibrations.list(),
        window.posture.sessions.getRecent(10),
        window.posture.storage.getRecoveries(),
      ]);
    set({
      initialized: true,
      appInfo,
      settings,
      calibrations,
      recentSessions,
      storageRecovery: recoveries.at(-1) ?? null,
    });
  },
  updateSettings: async (patch) =>
    set({ settings: await window.posture.settings.update(patch) }),
  completeOnboarding: async () => {
    const settings = await window.posture.settings.update({
      onboardingComplete: true,
    });
    set({ settings, view: "dashboard" });
  },
  refreshSessions: async () => {
    const [session, recentSessions] = await Promise.all([
      window.posture.sessions.getCurrent(),
      window.posture.sessions.getRecent(10),
    ]);
    if (get().tracking || session) set({ session, recentSessions });
    else set({ recentSessions });
  },
  deleteSessions: async () => {
    await window.posture.data.deleteSessions();
    set({ session: null, recentSessions: [] });
  },
  deleteCalibration: async (cameraId) =>
    set({
      calibrations: await window.posture.calibrations.deleteForCamera(cameraId),
    }),
  resetAll: async () => {
    await window.posture.data.resetAll();
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
    });
  },
}));
