import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  powerMonitor,
  protocol,
  screen,
  session,
  shell,
  systemPreferences,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  appInfoSchema,
  calibrationSchema,
  cameraAccessStatusSchema,
  powerStateSchema,
  settingsSchema,
  trackingRuntimeStateSchema,
  trackingSnapshotSchema,
  type PostureState,
  type Settings,
  type TrackingCommand,
  type TrustedUrlKind,
  type CameraAccessStatus,
  type StorageRecoveryNotice,
  type TrackingRuntimeState,
} from "../shared/contracts";
import { ReminderPolicy, SessionAccumulator } from "../shared/session-engine";
import {
  isTrustedRendererUrl,
  isVideoOnlyMediaRequest,
  resolveRendererAsset,
} from "./security";
import { LocalStore } from "./storage";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
      stream: true,
    },
  },
]);

const RENDERER_ROOT = join(__dirname, "../renderer");
const PRELOAD_PATH = join(__dirname, "../preload/index.js");
const repositoryUrl = __POSTURE_REPOSITORY_URL__.replace(/\/$/, "");
const trustedUrls: Record<TrustedUrlKind, string> = {
  repository: repositoryUrl,
  releases: `${repositoryUrl}/releases`,
  privacy: `${repositoryUrl}/blob/main/PRODUCT.md`,
  mediapipe:
    "https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker",
};

let mainWindow: BrowserWindow | null = null;
let nudgeWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let lastState: PostureState = "paused";
let lastRuntimeState: TrackingRuntimeState = {
  schemaVersion: 1,
  mode: "stopped",
  cameraId: null,
  calibrationId: null,
  errorCode: null,
  updatedAt: 0,
};
let store: LocalStore;
let settings: Settings;
let currentSession: SessionAccumulator | null = null;
let reminderPolicy: ReminderPolicy | null = null;
let lastSessionSaveAt = 0;
let resumeAfterWake = false;
let pauseTimer: NodeJS.Timeout | null = null;
let nudgeTimer: NodeJS.Timeout | null = null;
let lastSnapshotReceivedAt = 0;
let autoStartPending = false;
let quitFlushStarted = false;
let quitFlushed = false;
const pendingRecoveryNotices: StorageRecoveryNotice[] = [];

const allowOrigin = (url: string): boolean =>
  isTrustedRendererUrl(url, {
    isPackaged: app.isPackaged,
    developmentUrl: process.env.ELECTRON_RENDERER_URL,
  });

function validateSender(event: IpcMainInvokeEvent | IpcMainEvent): void {
  const url = event.senderFrame?.url ?? event.sender.getURL();
  if (!allowOrigin(url))
    throw new Error("Blocked IPC from an untrusted origin.");
}

function handle<T>(
  channel: string,
  callback: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T> | T,
): void {
  ipcMain.handle(
    channel,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      validateSender(event);
      return callback(event, ...args);
    },
  );
}

function rendererUrl(hash = "", search = ""): string {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL)
    return `${process.env.ELECTRON_RENDERER_URL}${search}${hash}`;
  return `app://posture/index.html${search}${hash}`;
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 760,
    minHeight: 620,
    backgroundColor: "#ffffff",
    title: "Posture",
    show: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
      backgroundThrottling: false,
    },
  });

  window.once("ready-to-show", () => window.show());
  window.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!allowOrigin(url)) event.preventDefault();
  });
  void window.loadURL(rendererUrl());
  return window;
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function sendCommand(command: TrackingCommand): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("tracking:command", command);
}

function createTrayIcon(): Electron.NativeImage {
  const file = process.platform === "win32" ? "tray.ico" : "tray.png";
  const packagedPath = join(process.resourcesPath, "icons", file);
  const developmentPath = join(app.getAppPath(), "build", "tray", file);
  const image = nativeImage.createFromPath(
    app.isPackaged ? packagedPath : developmentPath,
  );
  if (!image.isEmpty()) return image.resize({ width: 18, height: 18 });
  return nativeImage.createEmpty();
}

function rebuildTray(): void {
  if (!tray) return;
  const isActive = [
    "requesting-permission",
    "preview",
    "calibrating",
    "tracking",
    "recovering",
  ].includes(lastRuntimeState.mode);
  const runtimeLabel = lastRuntimeState.mode.replace("-", " ");
  const menu = Menu.buildFromTemplate([
    {
      label: `Tracking: ${runtimeLabel[0].toUpperCase()}${runtimeLabel.slice(1)}`,
      enabled: false,
    },
    ...(lastRuntimeState.mode === "tracking"
      ? [
          {
            label: `Posture: ${lastState[0].toUpperCase()}${lastState.slice(1)}`,
            enabled: false,
          } as Electron.MenuItemConstructorOptions,
        ]
      : []),
    { type: "separator" },
    { label: "Open Posture", click: showMainWindow },
    isActive
      ? {
          label: "Pause tracking",
          click: () => sendCommand({ type: "pause", reason: "tray" }),
        }
      : {
          label: "Start tracking",
          click: () => sendCommand({ type: "resume" }),
        },
    {
      label: "Pause for",
      submenu: [10, 30, 60].map((minutes) => ({
        label: `${minutes} minutes`,
        click: () => pauseForMinutes(minutes as 10 | 30 | 60),
      })),
    },
    {
      label: "Recalibrate",
      click: () => {
        showMainWindow();
        sendCommand({ type: "recalibrate" });
      },
    },
    {
      label: "Settings",
      click: () => {
        showMainWindow();
        sendCommand({ type: "open-settings" });
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(`Posture - ${runtimeLabel}`);
}

function createTray(): void {
  tray = new Tray(createTrayIcon());
  tray.on("click", showMainWindow);
  rebuildTray();
}

function showNudge(): void {
  if (nudgeWindow && !nudgeWindow.isDestroyed()) {
    nudgeWindow.showInactive();
    scheduleNudgeClose();
    return;
  }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const width = 370;
  const height = 176;
  const { x, y } = display.workArea;
  const position = {
    x: x + display.workArea.width - width - 18,
    y: y + display.workArea.height - height - 18,
  };
  nudgeWindow = new BrowserWindow({
    ...position,
    width,
    height,
    frame: false,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: "#00000000",
    transparent: true,
    focusable: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false,
    },
  });
  nudgeWindow.setAlwaysOnTop(true, "floating");
  nudgeWindow.once("ready-to-show", () => nudgeWindow?.showInactive());
  nudgeWindow.on("closed", () => {
    nudgeWindow = null;
  });
  void nudgeWindow.loadURL(
    rendererUrl("#nudge", `?theme=${encodeURIComponent(settings.theme)}`),
  );
  scheduleNudgeClose();
}

function scheduleNudgeClose(): void {
  if (nudgeTimer) clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(() => nudgeWindow?.close(), 8_000);
  nudgeTimer.unref();
}

function dismissNudge(): void {
  if (nudgeTimer) clearTimeout(nudgeTimer);
  nudgeTimer = null;
  nudgeWindow?.close();
}

function pauseForMinutes(minutes: 10 | 30 | 60): void {
  dismissNudge();
  sendCommand({ type: "pause", reason: `${minutes}-minute break` });
  if (pauseTimer) clearTimeout(pauseTimer);
  pauseTimer = setTimeout(
    () => sendCommand({ type: "resume" }),
    minutes * 60_000,
  );
  pauseTimer.unref();
}

async function startSession(calibrationId: string): Promise<void> {
  if (currentSession?.getSummary().calibrationId === calibrationId) return;
  if (currentSession) await endSession();
  currentSession = new SessionAccumulator(calibrationId);
  reminderPolicy = new ReminderPolicy();
}

async function endSession(): Promise<void> {
  if (!currentSession) return;
  await store.saveSession(currentSession.end());
  currentSession = null;
  reminderPolicy = null;
}

async function receiveSnapshot(snapshotInput: unknown): Promise<void> {
  const snapshot = trackingSnapshotSchema.parse(snapshotInput);
  lastState = snapshot.state;
  rebuildTray();
  if (!currentSession) return;

  currentSession.update(snapshot);
  if (
    reminderPolicy?.update(
      snapshot,
      settings.reminderDelaySeconds,
      settings.cooldownMinutes,
    )
  ) {
    currentSession.recordReminder();
    showNudge();
  }
  if (Date.now() - lastSessionSaveAt > 10_000) {
    lastSessionSaveAt = Date.now();
    await store.saveSession(currentSession.getSummary());
  }
}

async function receiveRuntimeState(input: unknown): Promise<void> {
  const runtime = trackingRuntimeStateSchema.parse(input);
  if (runtime.updatedAt < lastRuntimeState.updatedAt) return;

  if (runtime.mode === "tracking") {
    if (!runtime.cameraId || !runtime.calibrationId) {
      throw new Error("Tracking requires a camera and calibration.");
    }
    const exactCalibration = (await store.getCalibrations()).find(
      (calibration) =>
        calibration.schemaVersion === 2 &&
        calibration.compatibility === "compatible" &&
        calibration.id === runtime.calibrationId &&
        calibration.cameraId === runtime.cameraId,
    );
    if (!exactCalibration) {
      throw new Error("Tracking calibration does not match the active camera.");
    }
    await startSession(exactCalibration.id);
  }

  lastRuntimeState = runtime;
  if (runtime.mode !== "tracking") {
    currentSession?.suspend();
    reminderPolicy?.suspend();
  }
  if (runtime.mode === "stopped") await endSession();
  rebuildTray();
  if (autoStartPending && runtime.mode === "stopped") {
    autoStartPending = false;
    sendCommand({ type: "start" });
  }
}

function currentPowerState() {
  return powerStateSchema.parse({
    onBattery: powerMonitor.isOnBatteryPower(),
    updatedAt: performance.now(),
  });
}

function emitPowerState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("app:power-state-changed", currentPowerState());
}

function configurePermissions(): void {
  const ses = session.defaultSession;
  ses.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin, details) => {
      return (
        permission === "media" &&
        details.mediaType !== "audio" &&
        allowOrigin(requestingOrigin)
      );
    },
  );
  ses.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const mediaTypes = "mediaTypes" in details ? details.mediaTypes : [];
      const allowed =
        permission === "media" &&
        isVideoOnlyMediaRequest(mediaTypes) &&
        allowOrigin(webContents.getURL());
      callback(allowed);
    },
  );
}

function getCameraAccessStatus(): CameraAccessStatus {
  if (process.env.NODE_ENV === "test") {
    return cameraAccessStatusSchema
      .catch("granted")
      .parse(process.env.POSTURE_TEST_CAMERA_STATUS);
  }
  if (process.platform !== "darwin" && process.platform !== "win32")
    return "granted";
  try {
    return systemPreferences.getMediaAccessStatus("camera");
  } catch {
    return "unknown";
  }
}

async function requestCameraAccess(): Promise<CameraAccessStatus> {
  const status = getCameraAccessStatus();
  if (status !== "not-determined") return status;
  if (process.platform !== "darwin") return "granted";
  try {
    return (await systemPreferences.askForMediaAccess("camera"))
      ? "granted"
      : getCameraAccessStatus();
  } catch {
    return getCameraAccessStatus();
  }
}

async function openCameraPrivacySettings(): Promise<boolean> {
  const target =
    process.platform === "darwin"
      ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera"
      : process.platform === "win32"
        ? "ms-settings:privacy-webcam"
        : null;
  if (!target) return false;
  await shell.openExternal(target);
  return true;
}

function configureIpc(): void {
  handle("app:get-info", () =>
    appInfoSchema.parse({
      name: app.name,
      version: app.getVersion(),
      platform: process.platform,
      isPackaged: app.isPackaged,
    }),
  );
  handle("app:get-power-state", () => currentPowerState());
  handle("app:open-url", async (_event, input) => {
    const kind = z
      .enum(["repository", "releases", "privacy", "mediapipe"])
      .parse(input) as TrustedUrlKind;
    await shell.openExternal(trustedUrls[kind]);
  });
  handle("camera:get-access-status", () => getCameraAccessStatus());
  handle("camera:request-access", () => requestCameraAccess());
  handle("camera:open-system-privacy-settings", () =>
    openCameraPrivacySettings(),
  );
  handle("tracking:start", () => sendCommand({ type: "start" }));
  handle("tracking:pause", (_event, reason) =>
    sendCommand({
      type: "pause",
      reason: z.string().max(120).optional().parse(reason),
    }),
  );
  handle("tracking:resume", () => sendCommand({ type: "resume" }));
  handle("tracking:stop", async () => {
    sendCommand({ type: "stop" });
    await endSession();
  });
  ipcMain.on("tracking:snapshot", (event, input) => {
    try {
      validateSender(event);
      const now = performance.now();
      if (now - lastSnapshotReceivedAt < 100) return;
      lastSnapshotReceivedAt = now;
      void receiveSnapshot(input).catch(() => undefined);
    } catch {
      // Untrusted or malformed event payloads are ignored without crashing main.
    }
  });
  ipcMain.on("tracking:runtime-state", (event, input) => {
    try {
      validateSender(event);
      void receiveRuntimeState(input).catch(() => {
        sendCommand({ type: "pause", reason: "invalid runtime state" });
      });
    } catch {
      // Untrusted runtime events are ignored without crashing main.
    }
  });

  handle("settings:get", () => store.getSettings());
  handle("settings:update", async (_event, input) => {
    const patch = settingsSchema.partial().parse(input);
    const previousLaunchAtLogin = settings.launchAtLogin;
    settings = await store.updateSettings(patch);
    if (
      patch.launchAtLogin !== undefined &&
      previousLaunchAtLogin !== settings.launchAtLogin
    ) {
      app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
    }
    return settings;
  });
  handle("calibrations:list", () => store.getCalibrations());
  handle("calibrations:save", (_event, input) =>
    store.saveCalibration(calibrationSchema.parse(input)),
  );
  handle("calibrations:delete-camera", (_event, input) =>
    store.deleteCalibrationForCamera(z.string().min(1).max(512).parse(input)),
  );
  handle("sessions:current", () => currentSession?.getSummary() ?? null);
  handle("sessions:recent", async (_event, input) => {
    const limit = z.number().int().min(1).max(50).default(10).parse(input);
    return (await store.getSessions()).slice(0, limit);
  });
  handle("data:export", async () => {
    const options = {
      title: "Export Posture data",
      defaultPath: `posture-export-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    };
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    await store.exportData(result.filePath);
    return result.filePath;
  });
  handle("data:delete-sessions", () => store.deleteSessions());
  handle("data:reset-all", async () => {
    await endSession();
    await store.resetAll();
    settings = await store.getSettings();
  });
  handle("storage:get-recoveries", () => [...pendingRecoveryNotices]);
  handle("window:hide", () => mainWindow?.hide());
  handle("window:open-main", () => {
    dismissNudge();
    showMainWindow();
  });
  handle("window:quit", () => {
    quitting = true;
    app.quit();
  });
  handle("nudge:dismiss", () => dismissNudge());
  handle("nudge:pause", (_event, input) =>
    pauseForMinutes(
      z.union([z.literal(10), z.literal(30), z.literal(60)]).parse(input),
    ),
  );
  handle("updates:open", () => shell.openExternal(trustedUrls.releases));
}

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

function registerAppProtocol(): void {
  protocol.handle("app", async (request) => {
    const assetPath = resolveRendererAsset(RENDERER_ROOT, request.url);
    if (!assetPath)
      return new Response("Invalid application URL.", { status: 400 });
    const response = await net.fetch(pathToFileURL(assetPath).toString());
    const headers = new Headers(response.headers);
    headers.set("Content-Security-Policy", contentSecurityPolicy);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  });
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
else {
  app.on("second-instance", showMainWindow);
  void app.whenReady().then(async () => {
    app.setName("Posture");
    store = new LocalStore(undefined, (notice) => {
      pendingRecoveryNotices.push(notice);
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send("storage:recovery", notice);
    });
    await store.initialize();
    await store.recoverUnfinishedSessions();
    settings = await store.getSettings();
    if (app.isPackaged || !process.env.ELECTRON_RENDERER_URL)
      registerAppProtocol();
    configurePermissions();
    configureIpc();
    mainWindow = createMainWindow();
    createTray();
    autoStartPending =
      settings.autoStartTracking && settings.onboardingComplete;

    powerMonitor.on("suspend", () => {
      resumeAfterWake = lastRuntimeState.mode === "tracking";
      sendCommand({ type: "pause", reason: "computer sleep" });
    });
    powerMonitor.on("resume", () => {
      if (resumeAfterWake) sendCommand({ type: "resume" });
    });
    powerMonitor.on("on-battery", emitPowerState);
    powerMonitor.on("on-ac", emitPowerState);
  });
}

app.on("before-quit", (event) => {
  quitting = true;
  if (quitFlushed || !store) return;
  event.preventDefault();
  if (quitFlushStarted) return;
  quitFlushStarted = true;
  sendCommand({ type: "stop" });
  void (async () => {
    await endSession();
    await store.flush();
  })().finally(() => {
    quitFlushed = true;
    app.quit();
  });
});

app.on("window-all-closed", () => undefined);
app.on("activate", showMainWindow);
