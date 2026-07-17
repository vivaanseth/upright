import { contextBridge, ipcRenderer } from "electron";
import type {
  Calibration,
  CameraAccessStatus,
  PostureApi,
  PowerState,
  Settings,
  StorageRecoveryNotice,
  TrackingCommand,
  TrackingRuntimeState,
  TrackingSnapshotReport,
  TrustedUrlKind,
} from "../shared/contracts";

const cameraAccessStatuses = new Set<CameraAccessStatus>([
  "not-determined",
  "granted",
  "denied",
  "restricted",
  "unknown",
]);

function parseCameraAccessStatus(value: unknown): CameraAccessStatus {
  if (
    typeof value === "string" &&
    cameraAccessStatuses.has(value as CameraAccessStatus)
  ) {
    return value as CameraAccessStatus;
  }
  throw new TypeError("Received an invalid camera access status.");
}

function parsePowerState(value: unknown): PowerState {
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PowerState).onBattery === "boolean" &&
    typeof (value as PowerState).updatedAt === "number" &&
    Number.isFinite((value as PowerState).updatedAt)
  ) {
    return value as PowerState;
  }
  throw new TypeError("Received an invalid power state.");
}

function parseStorageRecoveryNotice(value: unknown): StorageRecoveryNotice {
  if (
    typeof value === "object" &&
    value !== null &&
    (value as StorageRecoveryNotice).schemaVersion === 1 &&
    ["settings.json", "calibrations.json", "sessions.json"].includes(
      (value as StorageRecoveryNotice).file,
    ) &&
    typeof (value as StorageRecoveryNotice).backupPath === "string" &&
    typeof (value as StorageRecoveryNotice).recoveredAt === "string"
  ) {
    return value as StorageRecoveryNotice;
  }
  throw new TypeError("Received an invalid storage recovery notice.");
}

const api: PostureApi = {
  app: {
    getInfo: () => ipcRenderer.invoke("app:get-info"),
    getPowerState: async () =>
      parsePowerState(await ipcRenderer.invoke("app:get-power-state")),
    onPowerStateChanged: (listener: (state: PowerState) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        state: unknown,
      ): void => listener(parsePowerState(state));
      ipcRenderer.on("app:power-state-changed", handler);
      return () =>
        ipcRenderer.removeListener("app:power-state-changed", handler);
    },
    openExternalTrustedUrl: (kind: TrustedUrlKind) =>
      ipcRenderer.invoke("app:open-url", kind),
  },
  camera: {
    getAccessStatus: async () =>
      parseCameraAccessStatus(
        await ipcRenderer.invoke("camera:get-access-status"),
      ),
    requestAccess: async () =>
      parseCameraAccessStatus(
        await ipcRenderer.invoke("camera:request-access"),
      ),
    openSystemPrivacySettings: () =>
      ipcRenderer.invoke("camera:open-system-privacy-settings"),
  },
  tracking: {
    start: () => ipcRenderer.invoke("tracking:start"),
    pause: (reason?: string) => ipcRenderer.invoke("tracking:pause", reason),
    resume: () => ipcRenderer.invoke("tracking:resume"),
    stop: () => ipcRenderer.invoke("tracking:stop"),
    reportSnapshot: (snapshot: TrackingSnapshotReport) =>
      ipcRenderer.send("tracking:snapshot", snapshot),
    reportRuntimeState: (state: TrackingRuntimeState) =>
      ipcRenderer.send("tracking:runtime-state", state),
    cancelCalibration: () => ipcRenderer.invoke("tracking:cancel-calibration"),
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
  storage: {
    getRecoveries: async () => {
      const notices: unknown = await ipcRenderer.invoke(
        "storage:get-recoveries",
      );
      if (!Array.isArray(notices))
        throw new TypeError("Received invalid storage recovery history.");
      return notices.map(parseStorageRecoveryNotice);
    },
    onRecovery: (listener: (notice: StorageRecoveryNotice) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        notice: unknown,
      ): void => listener(parseStorageRecoveryNotice(notice));
      ipcRenderer.on("storage:recovery", handler);
      return () => ipcRenderer.removeListener("storage:recovery", handler);
    },
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
    enableInteraction: () => ipcRenderer.invoke("nudge:enable-interaction"),
  },
  updates: {
    openLatestRelease: () => ipcRenderer.invoke("updates:open"),
  },
};

contextBridge.exposeInMainWorld("posture", api);
