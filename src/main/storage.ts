import { app } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { z } from "zod";
import {
  calibrationSchema,
  calibrationRecordSchema,
  defaultSettings,
  exportV2Schema,
  sessionRecordSchema,
  sessionSummarySchema,
  settingsSchema,
  type Calibration,
  type CalibrationRecord,
  type SessionRecord,
  type SessionSummary,
  type Settings,
  type StorageRecoveryNotice,
} from "../shared/contracts";

const calibrationsSchema = z.array(calibrationRecordSchema);
const sessionRecordsSchema = z.array(sessionRecordSchema);
type StoreFile = StorageRecoveryNotice["file"];

export class LocalStore {
  private readonly root: string;
  private readonly onRecovery?: (notice: StorageRecoveryNotice) => void;
  private writeQueue: Promise<void> = Promise.resolve();
  private writeActive = false;
  private readonly quarantined = new Set<string>();

  constructor(
    root = app.getPath("userData"),
    onRecovery?: (notice: StorageRecoveryNotice) => void,
  ) {
    this.root = root;
    this.onRecovery = onRecovery;
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  async getSettings(): Promise<Settings> {
    const stored = await this.readValidated(
      "settings.json",
      settingsSchema,
      defaultSettings,
    );
    return { ...defaultSettings, ...stored };
  }

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    return this.enqueueWrite(async () => {
      const current = await this.getSettings();
      const next = settingsSchema.parse({
        ...current,
        ...patch,
        schemaVersion: 1,
      });
      await this.atomicWriteUnlocked("settings.json", next);
      return next;
    });
  }

  async getCalibrations(): Promise<CalibrationRecord[]> {
    return this.readValidated("calibrations.json", calibrationsSchema, []);
  }

  async saveCalibration(
    calibration: Calibration,
  ): Promise<CalibrationRecord[]> {
    return this.enqueueWrite(async () => {
      const parsed = calibrationSchema.parse(calibration);
      const current = await this.getCalibrations();
      const next = [
        parsed,
        ...current.filter((entry) => entry.cameraId !== parsed.cameraId),
      ].slice(0, 12);
      await this.atomicWriteUnlocked("calibrations.json", next);
      return next;
    });
  }

  async deleteCalibrationForCamera(
    cameraId: string,
  ): Promise<CalibrationRecord[]> {
    return this.enqueueWrite(async () => {
      const next = (await this.getCalibrations()).filter(
        (entry) => entry.cameraId !== cameraId,
      );
      await this.atomicWriteUnlocked("calibrations.json", next);
      return next;
    });
  }

  async getSessions(): Promise<SessionSummary[]> {
    const records = await this.readValidated(
      "sessions.json",
      sessionRecordsSchema,
      [],
    );
    const migrated = records.map((record) => this.migrateSession(record));
    if (records.some((record) => record.schemaVersion === 1)) {
      const persist = () => this.atomicWriteUnlocked("sessions.json", migrated);
      if (this.writeActive) await persist();
      else await this.enqueueWrite(persist);
    }
    return migrated;
  }

  async saveSession(session: SessionSummary): Promise<SessionSummary[]> {
    return this.enqueueWrite(async () => {
      const parsed = sessionSummarySchema.parse(session);
      const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1_000;
      const next = [
        parsed,
        ...(await this.getSessions()).filter((entry) => entry.id !== parsed.id),
      ]
        .filter((entry) => Date.parse(entry.startedAt) >= cutoff)
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
        .slice(0, 500);
      await this.atomicWriteUnlocked("sessions.json", next);
      return next;
    });
  }

  async recoverUnfinishedSessions(): Promise<SessionSummary[]> {
    return this.enqueueWrite(async () => {
      const current = await this.getSessions();
      let changed = false;
      const recovered = current.map((session) => {
        if (session.endedAt) return session;
        changed = true;
        return sessionSummarySchema.parse({
          ...session,
          endedAt: session.updatedAt,
          recovered: true,
        });
      });
      if (changed) await this.atomicWriteUnlocked("sessions.json", recovered);
      return recovered;
    });
  }

  async deleteSessions(): Promise<void> {
    await this.enqueueWrite(() =>
      this.atomicWriteUnlocked("sessions.json", []),
    );
  }

  async resetAll(): Promise<void> {
    await this.enqueueWrite(async () => {
      await Promise.all(
        ["settings.json", "calibrations.json", "sessions.json"].map((file) =>
          rm(join(this.root, file), { force: true }),
        ),
      );
      this.quarantined.clear();
    });
  }

  async exportData(destination: string): Promise<void> {
    const payload = exportV2Schema.parse({
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      app: "Posture",
      settings: await this.getSettings(),
      calibrations: await this.getCalibrations(),
      sessions: await this.getSessions(),
      privacyNote:
        "This export contains settings, calibration measurements, and aggregate session data. It contains no images, video, or raw landmarks.",
    });
    await mkdir(dirname(destination), { recursive: true });
    await this.enqueueWrite(() => this.atomicReplace(destination, payload));
  }

  private migrateSession(record: SessionRecord): SessionSummary {
    if (record.schemaVersion === 2) return record;
    return sessionSummarySchema.parse({
      ...record,
      schemaVersion: 2,
      updatedAt: record.endedAt ?? record.startedAt,
      recovered: false,
    });
  }

  private enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      this.writeActive = true;
      try {
        return await operation();
      } finally {
        this.writeActive = false;
      }
    };
    const result = this.writeQueue.then(run, run);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async readValidated<T>(
    file: StoreFile,
    schema: z.ZodType<T>,
    fallback: T,
  ): Promise<T> {
    const filePath = join(this.root, file);
    try {
      const raw = await readFile(filePath, "utf8");
      return schema.parse(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
      if (!this.quarantined.has(file)) {
        this.quarantined.add(file);
        const backupPath = `${filePath}.corrupt-${Date.now()}`;
        const recover = async (): Promise<void> => {
          await rename(filePath, backupPath).catch(() => undefined);
          await this.atomicWriteUnlocked(file, fallback);
        };
        if (this.writeActive) await recover();
        else await this.enqueueWrite(recover);
        this.onRecovery?.({
          schemaVersion: 1,
          file,
          backupPath,
          recoveredAt: new Date().toISOString(),
        });
      }
      return fallback;
    }
  }

  private async atomicWriteUnlocked(
    file: string,
    data: unknown,
  ): Promise<void> {
    await this.atomicReplace(join(this.root, file), data);
  }

  private async atomicReplace(
    destination: string,
    data: unknown,
  ): Promise<void> {
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "w", 0o600);
    try {
      await handle.writeFile(JSON.stringify(data, null, 2), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    let lastError: unknown;
    const attempts = process.platform === "win32" ? 5 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        await rename(temporary, destination);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < attempts - 1) await wait(25 * 2 ** attempt);
      }
    }
    await rm(temporary, { force: true });
    throw lastError;
  }
}
