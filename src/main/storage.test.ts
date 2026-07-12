import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  Calibration,
  SessionSummary,
  StorageRecoveryNotice,
} from "../shared/contracts";
import {
  sessionSummarySchema,
  sessionSummaryV1Schema,
} from "../shared/contracts";
import { LocalStore } from "./storage";

const temporaryRoots: string[] = [];
const createStore = async (
  onRecovery?: (notice: StorageRecoveryNotice) => void,
) => {
  const root = await mkdtemp(join(tmpdir(), "posture-storage-"));
  temporaryRoots.push(root);
  const store = new LocalStore(root, onRecovery);
  await store.initialize();
  return { root, store };
};

const session = (index: number): SessionSummary => ({
  schemaVersion: 2,
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  startedAt: new Date(Date.now() - index * 1_000).toISOString(),
  endedAt: null,
  trackedMs: 1_000,
  goodMs: 1_000,
  cautionMs: 0,
  poorMs: 0,
  unknownMs: 0,
  awayMs: 0,
  averageScore: 90,
  reminderCount: 0,
  calibrationId: null,
  updatedAt: new Date(Date.now() - index * 1_000).toISOString(),
  recovered: false,
});

const calibration = (
  index: number,
  cameraId = `camera-${index}`,
): Calibration => ({
  schemaVersion: 2,
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  cameraId,
  createdAt: new Date(Date.now() - index * 1_000).toISOString(),
  modelVersion: "test",
  scoringConfigVersion: "test",
  resolution: { width: 640, height: 480 },
  orientation: "landscape",
  baseline: {
    forwardHead: 0.2,
    lateralHeadTilt: 0,
    shoulderSlope: 0,
    verticalCompression: 1.2,
    trunkLean: 0,
    confidence: 0.95,
  },
  medianAbsoluteDeviation: {
    forwardHead: 0.01,
    lateralHeadTilt: 0.2,
    shoulderSlope: 0.2,
    verticalCompression: 0.01,
    trunkLean: 0.2,
    confidence: 0.01,
  },
  reliability: {
    forwardHead: 1,
    lateralHeadTilt: 1,
    shoulderSlope: 1,
    verticalCompression: 1,
    trunkLean: 1,
  },
  validFrameCount: 50,
  rejectedFrameCount: 0,
  compatibility: "compatible",
});

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("LocalStore", () => {
  it("returns safe defaults when files do not exist", async () => {
    const { store } = await createStore();
    await expect(store.getSettings()).resolves.toMatchObject({
      theme: "system",
      onboardingComplete: false,
    });
    await expect(store.getCalibrations()).resolves.toEqual([]);
    await expect(store.getSessions()).resolves.toEqual([]);
  });

  it("serializes concurrent settings updates without losing fields", async () => {
    const { store } = await createStore();
    await Promise.all([
      store.updateSettings({ theme: "dark" }),
      store.updateSettings({ soundEnabled: true }),
      store.updateSettings({ cooldownMinutes: 20 }),
    ]);
    await expect(store.getSettings()).resolves.toMatchObject({
      theme: "dark",
      soundEnabled: true,
      cooldownMinutes: 20,
    });
  });

  it("keeps the write queue usable after a rejected write", async () => {
    const { store } = await createStore();
    await expect(
      store.updateSettings({ theme: "purple" } as never),
    ).rejects.toBeTruthy();
    await expect(
      store.updateSettings({ theme: "dark" }),
    ).resolves.toMatchObject({ theme: "dark" });
    await expect(store.flush()).resolves.toBeUndefined();
  });

  it("replaces calibrations by exact camera and deletes selected cameras", async () => {
    const { store } = await createStore();
    await store.saveCalibration(calibration(1, "camera-a"));
    await store.saveCalibration(calibration(2, "camera-b"));
    const replaced = await store.saveCalibration(calibration(3, "camera-a"));
    expect(replaced.map((entry) => entry.cameraId)).toEqual([
      "camera-a",
      "camera-b",
    ]);
    expect(replaced[0].id).toBe(calibration(3, "camera-a").id);

    const remaining = await store.deleteCalibrationForCamera("camera-a");
    expect(remaining.map((entry) => entry.cameraId)).toEqual(["camera-b"]);
  });

  it("caps saved calibrations to the twelve most recent cameras", async () => {
    const { store } = await createStore();
    for (let index = 0; index < 14; index += 1) {
      await store.saveCalibration(calibration(index));
    }
    await expect(store.getCalibrations()).resolves.toHaveLength(12);
  });

  it("quarantines corrupt data once and persists safe defaults", async () => {
    const notices: StorageRecoveryNotice[] = [];
    const { root, store } = await createStore((notice) => notices.push(notice));
    await writeFile(join(root, "settings.json"), "{not-json", "utf8");
    await store.getSettings();
    await store.getSettings();
    expect(notices).toHaveLength(1);
    expect(
      JSON.parse(await readFile(join(root, "settings.json"), "utf8")),
    ).toMatchObject({ schemaVersion: 1, theme: "system" });
    expect(
      (await readdir(root)).filter((file) => file.includes(".corrupt-")),
    ).toHaveLength(1);
  });

  it("recovers corrupt session data during an active write", async () => {
    const notices: StorageRecoveryNotice[] = [];
    const { root, store } = await createStore((notice) => notices.push(notice));
    await writeFile(join(root, "sessions.json"), "{not-json", "utf8");
    const saved = await store.saveSession(session(1));
    expect(saved).toHaveLength(1);
    expect(notices).toHaveLength(1);
    expect(
      (await readdir(root)).filter((file) => file.includes(".corrupt-")),
    ).toHaveLength(1);
  });

  it("enforces the 500-session retention cap", async () => {
    const { root, store } = await createStore();
    await writeFile(
      join(root, "sessions.json"),
      JSON.stringify(
        Array.from({ length: 505 }, (_, index) => session(index + 1)),
      ),
      "utf8",
    );
    const saved = await store.saveSession(session(0));
    expect(saved).toHaveLength(500);
    expect(saved[0].id).toBe(session(0).id);
  });

  it("removes sessions older than ninety days", async () => {
    const { store } = await createStore();
    const recent = session(1);
    const old = {
      ...session(2),
      id: "00000000-0000-4000-8000-999999999999",
      startedAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1_000).toISOString(),
    };
    await store.saveSession(old);
    const saved = await store.saveSession(recent);
    expect(saved.map((entry) => entry.id)).toEqual([recent.id]);
  });

  it("migrates V1 sessions without inventing recovery state", async () => {
    const { root, store } = await createStore();
    const current = session(1);
    const legacy = sessionSummaryV1Schema.parse({
      ...current,
      schemaVersion: 1,
    });
    await writeFile(
      join(root, "sessions.json"),
      JSON.stringify([legacy]),
      "utf8",
    );
    const migrated = await store.getSessions();
    expect(migrated[0]).toMatchObject({ schemaVersion: 2, recovered: false });
    const persisted = sessionSummarySchema
      .array()
      .parse(JSON.parse(await readFile(join(root, "sessions.json"), "utf8")));
    expect(persisted[0]).toMatchObject({ schemaVersion: 2, recovered: false });
  });

  it("finalizes an unfinished session after a crash", async () => {
    const { store } = await createStore();
    const unfinished = session(1);
    await store.saveSession(unfinished);
    const recovered = await store.recoverUnfinishedSessions();
    expect(recovered[0]).toMatchObject({
      endedAt: unfinished.updatedAt,
      recovered: true,
    });
  });

  it("exports aggregates without private frame or landmark fields", async () => {
    const { root, store } = await createStore();
    await store.saveSession(session(0));
    const destination = join(root, "export.json");
    await store.exportData(destination);
    const exported = await readFile(destination, "utf8");
    expect(exported).toContain("aggregate session data");
    expect(exported).not.toMatch(
      /"(?:frames?|thumbnails?|landmarks|imageData)"\s*:/i,
    );
    expect((await readdir(root)).some((file) => file.endsWith(".tmp"))).toBe(
      false,
    );
    expect(JSON.parse(exported)).toMatchObject({ schemaVersion: 2 });
  });

  it("cleans temporary export files when atomic replacement fails", async () => {
    const { root, store } = await createStore();
    await expect(store.exportData(root)).rejects.toBeTruthy();
    expect(
      (await readdir(root)).filter((file) => file.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("retries atomic replacement failures on Windows", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });
    try {
      const { root, store } = await createStore();
      await expect(store.exportData(root)).rejects.toBeTruthy();
      expect(
        (await readdir(root)).filter((file) => file.endsWith(".tmp")),
      ).toEqual([]);
    } finally {
      Object.defineProperty(process, "platform", {
        configurable: true,
        value: originalPlatform,
      });
    }
  });

  it("deletes sessions and resets every local data file", async () => {
    const { root, store } = await createStore();
    await store.updateSettings({ theme: "dark" });
    await store.saveCalibration(calibration(1));
    await store.saveSession(session(1));

    await store.deleteSessions();
    await expect(store.getSessions()).resolves.toEqual([]);

    await store.resetAll();
    await expect(store.getSettings()).resolves.toMatchObject({
      theme: "system",
    });
    await expect(store.getCalibrations()).resolves.toEqual([]);
    await expect(store.getSessions()).resolves.toEqual([]);
    expect(
      (await readdir(root)).filter((file) => file.endsWith(".json")),
    ).toEqual([]);
  });
});
