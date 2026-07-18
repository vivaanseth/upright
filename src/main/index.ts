import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
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
import { mkdirSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  appInfoSchema,
  calibrationSchema,
  cameraAccessStatusSchema,
  powerStateSchema,
  settingsSchema,
  trackingSnapshotReportSchema,
  trackingRuntimeReportSchema,
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
import { IPC_CHANNELS } from "../shared/ipc";
import {
  isTrustedRendererUrl,
  isVideoOnlyMediaRequest,
  resolveRendererAsset,
  validateTrustedExternalUrl,
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
const NUDGE_PRELOAD_PATH = join(__dirname, "../preload/nudge.js");
const repositoryUrl = validateTrustedExternalUrl(__UPRIGHT_REPOSITORY_URL__);
const trustedUrls: Record<TrustedUrlKind, string> = {
  repository: repositoryUrl,
  releases: validateTrustedExternalUrl(`${repositoryUrl}/releases`),
  privacy: validateTrustedExternalUrl(`${repositoryUrl}/blob/main/PRODUCT.md`),
  mediapipe: validateTrustedExternalUrl(
    "https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker",
  ),
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
let runtimeTransitionQueue: Promise<void> = Promise.resolve();
const smokeTest = process.argv.includes("--smoke-test");
let lastSessionSaveAt = 0;
let resumeAfterPowerInterruption = false;
const powerInterruptions = new Set<"suspend" | "lock">();
let pauseTimer: NodeJS.Timeout | null = null;
let pauseGeneration = 0;
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

type WindowRole = "main" | "nudge";

function validateSender(
  event: IpcMainInvokeEvent | IpcMainEvent,
  role: WindowRole = "main",
): void {
  const expected = role === "main" ? mainWindow : nudgeWindow;
  if (
    !expected ||
    expected.isDestroyed() ||
    event.sender.isDestroyed() ||
    event.sender !== expected.webContents
  ) {
    throw new Error(`Blocked IPC from an unauthorized ${role} window.`);
  }
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame)
    throw new Error("Blocked IPC from a subframe.");
  const url = event.senderFrame?.url ?? event.sender.getURL();
  if (!allowOrigin(url))
    throw new Error("Blocked IPC from an untrusted origin.");
}

function handle<T>(
  channel: string,
  callback: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T> | T,
  role: WindowRole = "main",
): void {
  ipcMain.handle(
    channel,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      validateSender(event, role);
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
  const resolvedDark =
    settings.theme === "dark" ||
    (settings.theme === "system" && nativeTheme.shouldUseDarkColors);
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 760,
    minHeight: 620,
    backgroundColor: resolvedDark ? "#111518" : "#f7f8f8",
    title: "Upright",
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

  window.once("ready-to-show", () => {
    if (!smokeTest) {
      window.show();
      return;
    }
    process.stdout.write(
      `${JSON.stringify({
        uprightSmoke: true,
        version: app.getVersion(),
        platform: process.platform,
        architecture: process.arch,
        trayReady: Boolean(tray && !tray.isDestroyed()),
        rendererReady: !window.webContents.isDestroyed(),
      })}\n`,
    );
    quitting = true;
    setImmediate(() => app.quit());
  });
  window.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      sendCommand({ type: "window-hidden" });
      window.hide();
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!allowOrigin(url)) event.preventDefault();
  });
  window.webContents.on("render-process-gone", () => {
    if (quitting) return;
    suspendForRuntimeFailure("renderer-crashed");
    if (mainWindow === window) mainWindow = null;
    window.destroy();
    setTimeout(() => showMainWindow(), 250).unref();
  });
  window.on("unresponsive", () => {
    if (quitting) return;
    suspendForRuntimeFailure("renderer-unresponsive");
    window.webContents.reload();
  });
  const rendererSearch = new URLSearchParams({ theme: settings.theme });
  if (
    !app.isPackaged &&
    __UPRIGHT_E2E_FIXTURE__ &&
    process.env.UPRIGHT_TEST_MEDIAPIPE !== "true"
  )
    rendererSearch.set("fixture", "deterministic");
  void window.loadURL(rendererUrl("", `?${rendererSearch.toString()}`));
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
  mainWindow.webContents.send(IPC_CHANNELS.trackingCommand, command);
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
            label: `Status: ${lastState[0].toUpperCase()}${lastState.slice(1)}`,
            enabled: false,
          } as Electron.MenuItemConstructorOptions,
        ]
      : []),
    { type: "separator" },
    { label: "Open Upright", click: showMainWindow },
    isActive
      ? {
          label: "Pause tracking",
          click: () => {
            resumeAfterPowerInterruption = false;
            sendCommand({ type: "pause", reason: "tray" });
          },
        }
      : {
          label: "Start tracking",
          click: () => {
            resumeAfterPowerInterruption = false;
            sendCommand({ type: "resume" });
          },
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
        resumeAfterPowerInterruption = false;
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
        resumeAfterPowerInterruption = false;
        quitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(`Upright - ${runtimeLabel}`);
}

function createTray(): void {
  tray = new Tray(createTrayIcon());
  tray.on("click", showMainWindow);
  rebuildTray();
}

function showNudge(): boolean {
  if (mainWindow?.isFullScreen()) return false;
  if (nudgeWindow && !nudgeWindow.isDestroyed()) {
    nudgeWindow.showInactive();
    scheduleNudgeClose();
    return true;
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
    skipTaskbar: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: "#00000000",
    transparent: true,
    focusable: true,
    webPreferences: {
      preload: NUDGE_PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false,
    },
  });
  nudgeWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  nudgeWindow.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  nudgeWindow.setAlwaysOnTop(true, "floating");
  nudgeWindow.once("ready-to-show", () => nudgeWindow?.showInactive());
  nudgeWindow.on("closed", () => {
    nudgeWindow = null;
  });
  void nudgeWindow.loadURL(
    rendererUrl(
      "#nudge",
      `?theme=${encodeURIComponent(settings.theme)}&sound=${
        settings.soundEnabled ? "1" : "0"
      }`,
    ),
  );
  scheduleNudgeClose();
  return true;
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
  resumeAfterPowerInterruption = false;
  dismissNudge();
  sendCommand({ type: "pause", reason: `${minutes}-minute break` });
  if (pauseTimer) clearTimeout(pauseTimer);
  const generation = ++pauseGeneration;
  pauseTimer = setTimeout(() => {
    if (generation !== pauseGeneration) return;
    sendCommand({ type: "resume" });
    pauseTimer = null;
  }, minutes * 60_000);
  pauseTimer.unref();
}

function cancelPendingAutoResume(): void {
  pauseGeneration += 1;
  if (!pauseTimer) return;
  clearTimeout(pauseTimer);
  pauseTimer = null;
}

function suspendForRuntimeFailure(reason: string): void {
  resumeAfterPowerInterruption = false;
  cancelPendingAutoResume();
  currentSession?.suspend();
  reminderPolicy?.suspend();
  lastRuntimeState = {
    ...lastRuntimeState,
    mode: "error",
    errorCode: reason,
    updatedAt: performance.now(),
  };
  rebuildTray();
}

async function startSession(calibrationId: string): Promise<void> {
  if (currentSession?.getSummary().calibrationId === calibrationId) return;
  if (currentSession) await endSession();
  const now = performance.now();
  currentSession = new SessionAccumulator(calibrationId);
  reminderPolicy = new ReminderPolicy(now);
  lastSessionSaveAt = now;
}

async function endSession(): Promise<void> {
  const session = currentSession;
  if (!session) return;
  currentSession = null;
  reminderPolicy = null;
  await store.saveSession(session.end());
}

async function receiveSnapshot(snapshotInput: unknown): Promise<void> {
  const snapshot = trackingSnapshotSchema.parse({
    ...trackingSnapshotReportSchema.parse(snapshotInput),
    timestamp: performance.now(),
  });
  lastState = snapshot.state;
  rebuildTray();
  if (!currentSession) return;

  currentSession.update(snapshot);
  if (mainWindow?.isFullScreen()) {
    reminderPolicy?.suspend();
  } else if (
    reminderPolicy?.update(
      snapshot,
      settings.reminderDelaySeconds,
      settings.cooldownMinutes,
    )
  ) {
    if (showNudge()) currentSession.recordReminder();
  }
  if (snapshot.timestamp - lastSessionSaveAt > 10_000) {
    lastSessionSaveAt = snapshot.timestamp;
    await store.saveSession(currentSession.getSummary());
  }
}

async function receiveRuntimeState(input: unknown): Promise<void> {
  const runtime = trackingRuntimeStateSchema.parse({
    ...trackingRuntimeReportSchema.parse(input),
    updatedAt: performance.now(),
  });

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
  if (runtime.mode !== "tracking" && runtime.mode !== "paused" && pauseTimer) {
    pauseGeneration += 1;
    clearTimeout(pauseTimer);
    pauseTimer = null;
  }
  if (runtime.mode === "stopped") await endSession();
  if (runtime.mode === "stopped" || runtime.mode === "error")
    resumeAfterPowerInterruption = false;
  rebuildTray();
  if (autoStartPending && runtime.mode === "stopped") {
    autoStartPending = false;
    sendCommand({ type: "start" });
  }
}

function enqueueRuntimeState(input: unknown): void {
  runtimeTransitionQueue = runtimeTransitionQueue
    .then(() => receiveRuntimeState(input))
    .catch(() => {
      resumeAfterPowerInterruption = false;
      sendCommand({ type: "pause", reason: "invalid runtime state" });
    });
}

function currentPowerState() {
  return powerStateSchema.parse({
    onBattery: powerMonitor.isOnBatteryPower(),
    updatedAt: performance.now(),
  });
}

function emitPowerState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(
    IPC_CHANNELS.appPowerStateChanged,
    currentPowerState(),
  );
}

function configurePermissions(): void {
  const ses = session.defaultSession;
  ses.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) => {
      return (
        Boolean(mainWindow) &&
        webContents === mainWindow?.webContents &&
        permission === "media" &&
        details.mediaType === "video" &&
        allowOrigin(requestingOrigin)
      );
    },
  );
  ses.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const mediaTypes = "mediaTypes" in details ? details.mediaTypes : [];
      const allowed =
        webContents === mainWindow?.webContents &&
        permission === "media" &&
        isVideoOnlyMediaRequest(mediaTypes) &&
        allowOrigin(webContents.getURL());
      callback(allowed);
    },
  );
  if (app.isPackaged) {
    ses.webRequest.onBeforeRequest(
      { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
      (_details, callback) => callback({ cancel: true }),
    );
  }
}

function getCameraAccessStatus(): CameraAccessStatus {
  if (!app.isPackaged && __UPRIGHT_E2E_FIXTURE__) {
    return cameraAccessStatusSchema
      .catch("granted")
      .parse(process.env.UPRIGHT_TEST_CAMERA_STATUS);
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
  handle(IPC_CHANNELS.appGetInfo, () =>
    appInfoSchema.parse({
      name: app.name,
      version: app.getVersion(),
      platform: process.platform,
      isPackaged: app.isPackaged,
    }),
  );
  handle(IPC_CHANNELS.appGetPowerState, () => currentPowerState());
  handle(IPC_CHANNELS.appOpenUrl, async (_event, input) => {
    const kind = z
      .enum(["repository", "releases", "privacy", "mediapipe"])
      .parse(input) as TrustedUrlKind;
    await shell.openExternal(trustedUrls[kind]);
  });
  handle(IPC_CHANNELS.cameraGetAccessStatus, () => getCameraAccessStatus());
  handle(IPC_CHANNELS.cameraRequestAccess, () => requestCameraAccess());
  handle(IPC_CHANNELS.cameraOpenPrivacySettings, () =>
    openCameraPrivacySettings(),
  );
  handle(IPC_CHANNELS.trackingStart, () => {
    resumeAfterPowerInterruption = false;
    sendCommand({ type: "start" });
  });
  handle(IPC_CHANNELS.trackingPause, (_event, reason) => {
    resumeAfterPowerInterruption = false;
    cancelPendingAutoResume();
    return sendCommand({
      type: "pause",
      reason: z.string().max(120).optional().parse(reason),
    });
  });
  handle(IPC_CHANNELS.trackingResume, () => {
    resumeAfterPowerInterruption = false;
    cancelPendingAutoResume();
    sendCommand({ type: "resume" });
  });
  handle(IPC_CHANNELS.trackingStop, async () => {
    resumeAfterPowerInterruption = false;
    cancelPendingAutoResume();
    sendCommand({ type: "stop" });
    await endSession();
  });
  handle(IPC_CHANNELS.trackingCancelCalibration, () =>
    sendCommand({ type: "cancel-calibration" }),
  );
  ipcMain.on(IPC_CHANNELS.trackingSnapshot, (event, input) => {
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
  ipcMain.on(IPC_CHANNELS.trackingRuntimeState, (event, input) => {
    try {
      validateSender(event);
      enqueueRuntimeState(input);
    } catch {
      // Untrusted runtime events are ignored without crashing main.
    }
  });

  handle(IPC_CHANNELS.settingsGet, () => store.getSettings());
  handle(IPC_CHANNELS.settingsUpdate, async (_event, input) => {
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
  handle(IPC_CHANNELS.calibrationsList, () => store.getCalibrations());
  handle(IPC_CHANNELS.calibrationsSave, (_event, input) =>
    store.saveCalibration(calibrationSchema.parse(input)),
  );
  handle(IPC_CHANNELS.calibrationsDeleteCamera, (_event, input) =>
    store.deleteCalibrationForCamera(z.string().min(1).max(512).parse(input)),
  );
  handle(
    IPC_CHANNELS.sessionsCurrent,
    () => currentSession?.getSummary() ?? null,
  );
  handle(IPC_CHANNELS.sessionsRecent, async (_event, input) => {
    const limit = z.number().int().min(1).max(50).default(10).parse(input);
    return (await store.getSessions())
      .filter((session) => session.endedAt !== null)
      .slice(0, limit);
  });
  handle(IPC_CHANNELS.dataExport, async () => {
    const options = {
      title: "Export Upright data",
      defaultPath: `upright-export-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    };
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    await store.exportData(result.filePath);
    return result.filePath;
  });
  handle(IPC_CHANNELS.dataDeleteSessions, () => store.deleteSessions());
  handle(IPC_CHANNELS.dataResetAll, async () => {
    resumeAfterPowerInterruption = false;
    cancelPendingAutoResume();
    await endSession();
    await store.resetAll();
    settings = await store.getSettings();
  });
  handle(IPC_CHANNELS.storageGetRecoveries, () => [...pendingRecoveryNotices]);
  handle(IPC_CHANNELS.windowHide, () => {
    sendCommand({ type: "window-hidden" });
    mainWindow?.hide();
  });
  handle(IPC_CHANNELS.windowOpenMain, () => {
    dismissNudge();
    showMainWindow();
  });
  handle(IPC_CHANNELS.windowQuit, () => {
    resumeAfterPowerInterruption = false;
    quitting = true;
    app.quit();
  });
  handle(IPC_CHANNELS.nudgePreview, () => showNudge());
  handle(IPC_CHANNELS.nudgeDismiss, () => dismissNudge(), "nudge");
  handle(
    IPC_CHANNELS.nudgePause,
    (_event, input) => pauseForMinutes(z.literal(10).parse(input)),
    "nudge",
  );
  handle(
    IPC_CHANNELS.nudgeEnableInteraction,
    () => {
      if (!nudgeWindow || nudgeWindow.isDestroyed()) return;
      nudgeWindow.setFocusable(true);
    },
    "nudge",
  );
  handle(
    IPC_CHANNELS.nudgeOpenMain,
    () => {
      dismissNudge();
      showMainWindow();
    },
    "nudge",
  );
  handle(IPC_CHANNELS.updatesOpen, () =>
    shell.openExternal(trustedUrls.releases),
  );
}

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: data:",
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
    try {
      const asset = await stat(assetPath);
      if (!asset.isFile())
        return new Response("Application asset not found.", { status: 404 });
    } catch {
      return new Response("Application asset not found.", { status: 404 });
    }
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

app.setName("Upright");
const hasUserDataOverride = process.argv.some(
  (argument) =>
    argument === "--user-data-dir" || argument.startsWith("--user-data-dir="),
);
if (!hasUserDataOverride) {
  const legacyDataPath = join(app.getPath("appData"), "posture-desktop");
  mkdirSync(legacyDataPath, { recursive: true });
  app.setPath("userData", legacyDataPath);
  app.setPath("sessionData", legacyDataPath);
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
else {
  app.on("second-instance", showMainWindow);
  void app.whenReady().then(async () => {
    store = new LocalStore(undefined, (notice) => {
      pendingRecoveryNotices.push(notice);
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send(IPC_CHANNELS.storageRecovery, notice);
    });
    await store.initialize();
    await store.recoverUnfinishedSessions();
    settings = await store.getSettings();
    if (!smokeTest)
      app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
    if (app.isPackaged || !process.env.ELECTRON_RENDERER_URL)
      registerAppProtocol();
    configurePermissions();
    configureIpc();
    mainWindow = createMainWindow();
    createTray();
    if (smokeTest)
      setTimeout(() => {
        process.stderr.write(
          "Upright smoke test timed out before renderer readiness.\n",
        );
        app.exit(1);
      }, 20_000).unref();
    autoStartPending =
      settings.autoStartTracking && settings.onboardingComplete;

    const pauseForPowerInterruption = (kind: "suspend" | "lock"): void => {
      if (lastRuntimeState.mode === "tracking")
        resumeAfterPowerInterruption = true;
      powerInterruptions.add(kind);
      cancelPendingAutoResume();
      sendCommand({
        type: "pause",
        reason: kind === "suspend" ? "computer sleep" : "screen locked",
      });
    };
    const resumeAfterPower = (kind: "suspend" | "lock"): void => {
      powerInterruptions.delete(kind);
      if (powerInterruptions.size || !resumeAfterPowerInterruption) return;
      resumeAfterPowerInterruption = false;
      sendCommand({ type: "resume" });
    };
    powerMonitor.on("suspend", () => pauseForPowerInterruption("suspend"));
    powerMonitor.on("resume", () => resumeAfterPower("suspend"));
    powerMonitor.on("lock-screen", () => pauseForPowerInterruption("lock"));
    powerMonitor.on("unlock-screen", () => resumeAfterPower("lock"));
    powerMonitor.on("on-battery", emitPowerState);
    powerMonitor.on("on-ac", emitPowerState);
  });
}

app.on("before-quit", (event) => {
  resumeAfterPowerInterruption = false;
  quitting = true;
  cancelPendingAutoResume();
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
app.on("child-process-gone", (_event, details) => {
  if (quitting || details.type === "GPU") return;
  suspendForRuntimeFailure(`child-process-${details.type}`);
  sendCommand({ type: "pause", reason: "runtime process stopped" });
});
