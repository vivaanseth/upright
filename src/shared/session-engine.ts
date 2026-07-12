import type {
  PostureState,
  SessionSummary,
  TrackingSnapshot,
} from "./contracts";

const stateField: Partial<Record<PostureState, keyof SessionSummary>> = {
  good: "goodMs",
  caution: "cautionMs",
  poor: "poorMs",
  unknown: "unknownMs",
  away: "awayMs",
};

export class SessionAccumulator {
  private summary: SessionSummary;
  private lastTimestamp: number | null = null;
  private lastState: PostureState | null = null;
  private scoreTotal = 0;
  private scoreSamples = 0;

  constructor(calibrationId: string | null, startedAt = new Date()) {
    this.summary = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      startedAt: startedAt.toISOString(),
      endedAt: null,
      trackedMs: 0,
      goodMs: 0,
      cautionMs: 0,
      poorMs: 0,
      unknownMs: 0,
      awayMs: 0,
      averageScore: null,
      reminderCount: 0,
      calibrationId,
    };
  }

  update(snapshot: TrackingSnapshot): SessionSummary {
    if (this.lastTimestamp !== null) {
      const rawDelta = snapshot.timestamp - this.lastTimestamp;
      const delta =
        rawDelta > 5_000 ? 0 : Math.min(2_000, Math.max(0, rawDelta));
      const field = this.lastState ? stateField[this.lastState] : undefined;
      if (field) (this.summary[field] as number) += delta;
      if (
        this.lastState === "good" ||
        this.lastState === "caution" ||
        this.lastState === "poor"
      )
        this.summary.trackedMs += delta;
    }

    if (snapshot.score !== null) {
      this.scoreTotal += snapshot.score;
      this.scoreSamples += 1;
      this.summary.averageScore = Math.round(
        this.scoreTotal / this.scoreSamples,
      );
    }
    this.lastTimestamp = snapshot.timestamp;
    this.lastState = snapshot.state;
    return this.getSummary();
  }

  recordReminder(): SessionSummary {
    this.summary.reminderCount += 1;
    return this.getSummary();
  }

  end(endedAt = new Date()): SessionSummary {
    this.summary.endedAt = endedAt.toISOString();
    return this.getSummary();
  }

  getSummary(): SessionSummary {
    return structuredClone(this.summary);
  }
}

export class ReminderPolicy {
  private poorSince: number | null = null;
  private goodSince: number | null = null;
  private lastReminderAt: number | null = null;
  private sessionStartedAt: number;

  constructor(sessionStartedAt = Date.now()) {
    this.sessionStartedAt = sessionStartedAt;
  }

  update(
    snapshot: TrackingSnapshot,
    reminderDelaySeconds: number,
    cooldownMinutes: number,
  ): boolean {
    const now = snapshot.timestamp;
    if (now - this.sessionStartedAt < 60_000) return false;

    if (snapshot.state === "good") {
      this.goodSince ??= now;
      if (now - this.goodSince >= 5_000) this.poorSince = null;
      return false;
    }

    this.goodSince = null;
    if (snapshot.state !== "poor") {
      this.poorSince = null;
      return false;
    }

    this.poorSince ??= now;
    const sustained = now - this.poorSince >= reminderDelaySeconds * 1_000;
    const cooledDown =
      this.lastReminderAt === null ||
      now - this.lastReminderAt >= cooldownMinutes * 60_000;
    if (sustained && cooledDown) {
      this.lastReminderAt = now;
      this.poorSince = null;
      return true;
    }
    return false;
  }
}
