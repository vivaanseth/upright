import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  SessionSummary,
  StorageRecoveryNotice,
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
  schemaVersion: 1,
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
});

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("LocalStore", () => {
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
  });
});
