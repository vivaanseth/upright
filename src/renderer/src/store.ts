import { create } from "zustand";
import {
  defaultSettings,
  type AppInfo,
  type Calibration,
  type SessionSummary,
  type Settings,
  type TrackingSnapshot,
} from "../../shared/contracts";

export type View = "dashboard" | "settings" | "diagnostics";

interface AppStore {
  initialized: boolean;
  appInfo: AppInfo | null;
  settings: Settings;
  calibrations: Calibration[];
  session: SessionSummary | null;
  recentSessions: SessionSummary[];
  snapshot: TrackingSnapshot;
  view: View;
  tracking: boolean;
  cameraError: string | null;
  setSnapshot: (snapshot: TrackingSnapshot) => void;
  setSession: (session: SessionSummary | null) => void;
  setCalibrations: (calibrations: Calibration[]) => void;
  setTracking: (tracking: boolean) => void;
  setCameraError: (cameraError: string | null) => void;
  setView: (view: View) => void;
  initialize: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  completeOnboarding: () => Promise<void>;
  refreshSessions: () => Promise<void>;
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
  cameraError: null,
  setSnapshot: (snapshot) => set({ snapshot }),
  setSession: (session) => set({ session }),
  setCalibrations: (calibrations) => set({ calibrations }),
  setTracking: (tracking) => set({ tracking }),
  setCameraError: (cameraError) => set({ cameraError }),
  setView: (view) => set({ view }),
  initialize: async () => {
    const [appInfo, settings, calibrations, recentSessions] = await Promise.all(
      [
        window.posture.app.getInfo(),
        window.posture.settings.get(),
        window.posture.calibrations.list(),
        window.posture.sessions.getRecent(10),
      ],
    );
    set({ initialized: true, appInfo, settings, calibrations, recentSessions });
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
}));
