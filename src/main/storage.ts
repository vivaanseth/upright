import { app } from "electron";
import {
  mkdir,
  readFile,
  rename,
  writeFile,
  copyFile,
  rm,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  calibrationSchema,
  defaultSettings,
  sessionSummarySchema,
  settingsSchema,
  type Calibration,
  type SessionSummary,
  type Settings,
} from "../shared/contracts";

const calibrationsSchema = z.array(calibrationSchema);
const sessionsSchema = z.array(sessionSummarySchema);

export class LocalStore {
  private readonly root: string;

  constructor(root = app.getPath("userData")) {
    this.root = root;
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true });
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
    const current = await this.getSettings();
    const next = settingsSchema.parse({
      ...current,
      ...patch,
      schemaVersion: 1,
    });
    await this.atomicWrite("settings.json", next);
    return next;
  }

  async getCalibrations(): Promise<Calibration[]> {
    return this.readValidated("calibrations.json", calibrationsSchema, []);
  }

  async saveCalibration(calibration: Calibration): Promise<Calibration[]> {
    const parsed = calibrationSchema.parse(calibration);
    const current = await this.getCalibrations();
    const next = [
      parsed,
      ...current.filter((entry) => entry.cameraId !== parsed.cameraId),
    ].slice(0, 12);
    await this.atomicWrite("calibrations.json", next);
    return next;
  }

  async deleteCalibrationForCamera(cameraId: string): Promise<Calibration[]> {
    const next = (await this.getCalibrations()).filter(
      (entry) => entry.cameraId !== cameraId,
    );
    await this.atomicWrite("calibrations.json", next);
    return next;
  }

  async getSessions(): Promise<SessionSummary[]> {
    return this.readValidated("sessions.json", sessionsSchema, []);
  }

  async saveSession(session: SessionSummary): Promise<SessionSummary[]> {
    const parsed = sessionSummarySchema.parse(session);
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1_000;
    const next = [
      parsed,
      ...(await this.getSessions()).filter((entry) => entry.id !== parsed.id),
    ]
      .filter((entry) => Date.parse(entry.startedAt) >= cutoff)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
      .slice(0, 500);
    await this.atomicWrite("sessions.json", next);
    return next;
  }

  async deleteSessions(): Promise<void> {
    await this.atomicWrite("sessions.json", []);
  }

  async resetAll(): Promise<void> {
    await Promise.all(
      ["settings.json", "calibrations.json", "sessions.json"].map((file) =>
        rm(join(this.root, file), { force: true }),
      ),
    );
  }

  async exportData(destination: string): Promise<void> {
    const payload = {
      exportedAt: new Date().toISOString(),
      app: "Posture",
      settings: await this.getSettings(),
      calibrations: await this.getCalibrations(),
      sessions: await this.getSessions(),
      privacyNote:
        "This export contains settings, calibration measurements, and aggregate session data. It contains no images or video.",
    };
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, JSON.stringify(payload, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  private async readValidated<T>(
    file: string,
    schema: z.ZodType<T>,
    fallback: T,
  ): Promise<T> {
    const path = join(this.root, file);
    try {
      const raw = await readFile(path, "utf8");
      return schema.parse(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
      const backup = `${path}.corrupt-${Date.now()}`;
      await copyFile(path, backup).catch(() => undefined);
      return fallback;
    }
  }

  private async atomicWrite(file: string, data: unknown): Promise<void> {
    const path = join(this.root, file);
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(data, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, path);
  }
}
