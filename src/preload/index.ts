import { contextBridge, ipcRenderer } from "electron";
import { z } from "zod";
import {
  appInfoSchema,
  calibrationSchema,
  calibrationRecordSchema,
  sessionSummarySchema,
  settingsSchema,
  trackingCommandSchema,
  trackingRuntimeReportSchema,
  trackingSnapshotReportSchema,
} from "../shared/contracts";
import { IPC_CHANNELS } from "../shared/ipc";
import type {
  Calibration,
  CameraAccessStatus,
  MainWindowApi,
  PowerState,
  Settings,
  StorageRecoveryNotice,
  TrackingCommand,
  TrackingRuntimeReport,
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

const invokeVoid = async (
  channel: string,
  ...args: unknown[]
): Promise<void> => {
  z.void().parse(await ipcRenderer.invoke(channel, ...args));
};

const api: MainWindowApi = {
  app: {
    getInfo: async () =>
      appInfoSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.appGetInfo)),
    getPowerState: async () =>
      parsePowerState(await ipcRenderer.invoke(IPC_CHANNELS.appGetPowerState)),
    onPowerStateChanged: (listener: (state: PowerState) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        state: unknown,
      ): void => listener(parsePowerState(state));
      ipcRenderer.on(IPC_CHANNELS.appPowerStateChanged, handler);
      return () =>
        ipcRenderer.removeListener(IPC_CHANNELS.appPowerStateChanged, handler);
    },
    openExternalTrustedUrl: (kind: TrustedUrlKind) =>
      invokeVoid(IPC_CHANNELS.appOpenUrl, kind),
  },
  camera: {
    getAccessStatus: async () =>
      parseCameraAccessStatus(
        await ipcRenderer.invoke(IPC_CHANNELS.cameraGetAccessStatus),
      ),
    requestAccess: async () =>
      parseCameraAccessStatus(
        await ipcRenderer.invoke(IPC_CHANNELS.cameraRequestAccess),
      ),
    openSystemPrivacySettings: async () =>
      z
        .boolean()
        .parse(
          await ipcRenderer.invoke(IPC_CHANNELS.cameraOpenPrivacySettings),
        ),
  },
  tracking: {
    start: () => invokeVoid(IPC_CHANNELS.trackingStart),
    pause: (reason?: string) => invokeVoid(IPC_CHANNELS.trackingPause, reason),
    resume: () => invokeVoid(IPC_CHANNELS.trackingResume),
    stop: () => invokeVoid(IPC_CHANNELS.trackingStop),
    reportSnapshot: (snapshot: TrackingSnapshotReport) =>
      ipcRenderer.send(
        IPC_CHANNELS.trackingSnapshot,
        trackingSnapshotReportSchema.parse(snapshot),
      ),
    reportRuntimeState: (state: TrackingRuntimeReport) =>
      ipcRenderer.send(
        IPC_CHANNELS.trackingRuntimeState,
        trackingRuntimeReportSchema.parse(state),
      ),
    cancelCalibration: () => invokeVoid(IPC_CHANNELS.trackingCancelCalibration),
    onCommand: (listener: (command: TrackingCommand) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        command: unknown,
      ): void => listener(trackingCommandSchema.parse(command));
      ipcRenderer.on(IPC_CHANNELS.trackingCommand, handler);
      return () =>
        ipcRenderer.removeListener(IPC_CHANNELS.trackingCommand, handler);
    },
  },
  settings: {
    get: async () =>
      settingsSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.settingsGet)),
    update: async (patch: Partial<Settings>) =>
      settingsSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.settingsUpdate,
          settingsSchema.partial().parse(patch),
        ),
      ),
  },
  calibrations: {
    list: async () =>
      z
        .array(calibrationRecordSchema)
        .parse(await ipcRenderer.invoke(IPC_CHANNELS.calibrationsList)),
    save: async (calibration: Calibration) =>
      z
        .array(calibrationRecordSchema)
        .parse(
          await ipcRenderer.invoke(
            IPC_CHANNELS.calibrationsSave,
            calibrationSchema.parse(calibration),
          ),
        ),
    deleteForCamera: async (cameraId: string) =>
      z
        .array(calibrationRecordSchema)
        .parse(
          await ipcRenderer.invoke(
            IPC_CHANNELS.calibrationsDeleteCamera,
            cameraId,
          ),
        ),
  },
  sessions: {
    getCurrent: async () =>
      sessionSummarySchema
        .nullable()
        .parse(await ipcRenderer.invoke(IPC_CHANNELS.sessionsCurrent)),
    getRecent: async (limit = 10) =>
      z
        .array(sessionSummarySchema)
        .parse(await ipcRenderer.invoke(IPC_CHANNELS.sessionsRecent, limit)),
  },
  data: {
    export: async () =>
      z
        .string()
        .nullable()
        .parse(await ipcRenderer.invoke(IPC_CHANNELS.dataExport)),
    deleteSessions: () => invokeVoid(IPC_CHANNELS.dataDeleteSessions),
    resetAll: () => invokeVoid(IPC_CHANNELS.dataResetAll),
  },
  storage: {
    getRecoveries: async () => {
      const notices: unknown = await ipcRenderer.invoke(
        IPC_CHANNELS.storageGetRecoveries,
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
      ipcRenderer.on(IPC_CHANNELS.storageRecovery, handler);
      return () =>
        ipcRenderer.removeListener(IPC_CHANNELS.storageRecovery, handler);
    },
  },
  window: {
    hide: () => invokeVoid(IPC_CHANNELS.windowHide),
    openMain: () => invokeVoid(IPC_CHANNELS.windowOpenMain),
    quit: () => invokeVoid(IPC_CHANNELS.windowQuit),
  },
  nudge: {
    preview: async () => {
      z.boolean().parse(await ipcRenderer.invoke(IPC_CHANNELS.nudgePreview));
    },
  },
  updates: {
    openLatestRelease: () => invokeVoid(IPC_CHANNELS.updatesOpen),
  },
};

contextBridge.exposeInMainWorld("upright", api);
