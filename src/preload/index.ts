import { contextBridge, ipcRenderer } from "electron";
import type {
  Calibration,
  PostureApi,
  Settings,
  TrackingCommand,
  TrackingSnapshot,
  TrustedUrlKind,
} from "../shared/contracts";

const api: PostureApi = {
  app: {
    getInfo: () => ipcRenderer.invoke("app:get-info"),
    openExternalTrustedUrl: (kind: TrustedUrlKind) =>
      ipcRenderer.invoke("app:open-url", kind),
  },
  tracking: {
    start: () => ipcRenderer.invoke("tracking:start"),
    pause: (reason?: string) => ipcRenderer.invoke("tracking:pause", reason),
    resume: () => ipcRenderer.invoke("tracking:resume"),
    stop: () => ipcRenderer.invoke("tracking:stop"),
    reportSnapshot: (snapshot: TrackingSnapshot) =>
      ipcRenderer.send("tracking:snapshot", snapshot),
    onCommand: (listener: (command: TrackingCommand) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        command: TrackingCommand,
      ): void => listener(command);
      ipcRenderer.on("tracking:command", handler);
      return () => ipcRenderer.removeListener("tracking:command", handler);
    },
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    update: (patch: Partial<Settings>) =>
      ipcRenderer.invoke("settings:update", patch),
  },
  calibrations: {
    list: () => ipcRenderer.invoke("calibrations:list"),
    save: (calibration: Calibration) =>
      ipcRenderer.invoke("calibrations:save", calibration),
    deleteForCamera: (cameraId: string) =>
      ipcRenderer.invoke("calibrations:delete-camera", cameraId),
  },
  sessions: {
    getCurrent: () => ipcRenderer.invoke("sessions:current"),
    getRecent: (limit = 10) => ipcRenderer.invoke("sessions:recent", limit),
  },
  data: {
    export: () => ipcRenderer.invoke("data:export"),
    deleteSessions: () => ipcRenderer.invoke("data:delete-sessions"),
    resetAll: () => ipcRenderer.invoke("data:reset-all"),
  },
  window: {
    hide: () => ipcRenderer.invoke("window:hide"),
    openMain: () => ipcRenderer.invoke("window:open-main"),
    quit: () => ipcRenderer.invoke("window:quit"),
  },
  nudge: {
    dismiss: () => ipcRenderer.invoke("nudge:dismiss"),
    pauseForMinutes: (minutes: 10 | 30 | 60) =>
      ipcRenderer.invoke("nudge:pause", minutes),
  },
  updates: {
    openLatestRelease: () => ipcRenderer.invoke("updates:open"),
  },
};

contextBridge.exposeInMainWorld("posture", api);
