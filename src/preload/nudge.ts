import { contextBridge, ipcRenderer } from "electron";
import type { NudgeWindowApi } from "../shared/contracts";

// Keep this preload self-contained: sandboxed Electron preloads cannot load a
// Rollup shared chunk. The main process still validates these channels against
// the centralized registry and the expected nudge window role.
const channels = {
  dismiss: "nudge:dismiss",
  pause: "nudge:pause",
  enableInteraction: "nudge:enable-interaction",
  openMain: "nudge:open-main",
} as const;

const invokeVoid = async (
  channel: (typeof channels)[keyof typeof channels],
  ...args: unknown[]
): Promise<void> => {
  const result: unknown = await ipcRenderer.invoke(channel, ...args);
  if (result !== undefined)
    throw new TypeError("Received an invalid nudge IPC response.");
};

const api: NudgeWindowApi = {
  dismiss: () => invokeVoid(channels.dismiss),
  pauseForMinutes: () => invokeVoid(channels.pause, 10),
  enableInteraction: () => invokeVoid(channels.enableInteraction),
  openMain: () => invokeVoid(channels.openMain),
};

contextBridge.exposeInMainWorld("uprightNudge", api);
