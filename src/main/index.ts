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
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import { join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  appInfoSchema,
  calibrationSchema,
  settingsSchema,
  trackingSnapshotSchema,
  type PostureState,
  type Settings,
  type TrackingCommand,
  type TrustedUrlKind,
} from "../shared/contracts";
import { ReminderPolicy, SessionAccumulator } from "../shared/session-engine";
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
let store: LocalStore;
let settings: Settings;
let currentSession: SessionAccumulator | null = null;
let reminderPolicy: ReminderPolicy | null = null;
let lastSessionSaveAt = 0;
let resumeAfterWake = false;
let pauseTimer: NodeJS.Timeout | null = null;

const allowOrigin = (url: string): boolean =>
  url.startsWith("app://posture") ||
  (!app.isPackaged && url.startsWith("http://localhost:"));

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

function rendererUrl(hash = ""): string {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL)
    return `${process.env.ELECTRON_RENDERER_URL}${hash}`;
  return `app://posture/index.html${hash}`;
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
  const isActive = !["paused", "unknown", "away"].includes(lastState);
  const menu = Menu.buildFromTemplate([
    {
      label: `Status: ${lastState[0].toUpperCase()}${lastState.slice(1)}`,
      enabled: false,
    },
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
  tray.setToolTip(`Posture - ${lastState}`);
}

function createTray(): void {
  tray = new Tray(createTrayIcon());
  tray.on("click", showMainWindow);
  rebuildTray();
}

function showNudge(): void {
  if (nudgeWindow && !nudgeWindow.isDestroyed()) {
    nudgeWindow.showInactive();
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
  void nudgeWindow.loadURL(rendererUrl("#nudge"));
  setTimeout(() => nudgeWindow?.close(), 8_000).unref();
}

function dismissNudge(): void {
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

async function startSession(): Promise<void> {
  if (currentSession) return;
  const calibrationId = (await store.getCalibrations())[0]?.id ?? null;
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
  if (!currentSession && !["paused", "calibrating"].includes(snapshot.state))
    await startSession();
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

function configurePermissions(): void {
  const ses = session.defaultSession;
  ses.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin, details) => {
      return (
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
        permission === "media" &&
        mediaTypes?.includes("video") === true &&
        mediaTypes?.includes("audio") !== true &&
        allowOrigin(webContents.getURL());
      callback(allowed);
    },
  );
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
  handle("app:open-url", async (_event, input) => {
    const kind = z
      .enum(["repository", "releases", "privacy", "mediapipe"])
      .parse(input) as TrustedUrlKind;
    await shell.openExternal(trustedUrls[kind]);
  });
  handle("tracking:start", async () => {
    await startSession();
    sendCommand({ type: "start" });
  });
  handle("tracking:pause", (_event, reason) =>
    sendCommand({
      type: "pause",
      reason: z.string().max(120).optional().parse(reason),
    }),
  );
  handle("tracking:resume", async () => {
    await startSession();
    sendCommand({ type: "resume" });
  });
  handle("tracking:stop", async () => {
    sendCommand({ type: "stop" });
    await endSession();
  });
  ipcMain.on("tracking:snapshot", (event, input) => {
    validateSender(event);
    void receiveSnapshot(input);
  });

  handle("settings:get", () => store.getSettings());
  handle("settings:update", async (_event, input) => {
    const patch = settingsSchema.partial().parse(input);
    settings = await store.updateSettings(patch);
    app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
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

function registerAppProtocol(): void {
  protocol.handle("app", (request) => {
    const requestUrl = new URL(request.url);
    const requested = decodeURIComponent(
      requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname,
    );
    const safePath = normalize(requested)
      .replace(/^(\.\.(\/|\\|$))+/, "")
      .replace(/^[/\\]+/, "");
    return net.fetch(pathToFileURL(join(RENDERER_ROOT, safePath)).toString());
  });
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
else {
  app.on("second-instance", showMainWindow);
  void app.whenReady().then(async () => {
    app.setName("Posture");
    store = new LocalStore();
    await store.initialize();
    settings = await store.getSettings();
    if (app.isPackaged || !process.env.ELECTRON_RENDERER_URL)
      registerAppProtocol();
    configurePermissions();
    configureIpc();
    mainWindow = createMainWindow();
    createTray();
    if (settings.autoStartTracking)
      mainWindow.webContents.once("did-finish-load", () =>
        sendCommand({ type: "start" }),
      );

    powerMonitor.on("suspend", () => {
      resumeAfterWake = !["paused", "away", "unknown"].includes(lastState);
      sendCommand({ type: "pause", reason: "computer sleep" });
    });
    powerMonitor.on("resume", () => {
      if (resumeAfterWake) sendCommand({ type: "resume" });
    });
  });
}

app.on("before-quit", () => {
  quitting = true;
  sendCommand({ type: "stop" });
  if (currentSession) void store.saveSession(currentSession.end());
});

app.on("window-all-closed", () => undefined);
app.on("activate", showMainWindow);
