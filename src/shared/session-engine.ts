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
  private lastScore: number | null = null;
  private weightedScoreTotal = 0;
  private scoredDurationMs = 0;

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
      ) {
        this.summary.trackedMs += delta;
        if (this.lastScore !== null) {
          this.weightedScoreTotal += this.lastScore * delta;
          this.scoredDurationMs += delta;
          this.summary.averageScore = Math.round(
            this.weightedScoreTotal / this.scoredDurationMs,
          );
        }
      }
    }
    this.lastTimestamp = snapshot.timestamp;
    this.lastState = snapshot.state;
    this.lastScore = snapshot.score;
    return this.getSummary();
  }

  suspend(): void {
    this.lastTimestamp = null;
    this.lastState = null;
    this.lastScore = null;
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
  private accumulatedPoorMs = 0;
  private goodSince: number | null = null;
  private lastReminderAt: number | null = null;
  private lastUpdatedAt: number | null = null;
  private lastState: PostureState | null = null;
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
    if (this.lastUpdatedAt !== null && this.lastState === "poor") {
      const eligibleStart = Math.max(
        this.lastUpdatedAt,
        this.sessionStartedAt + 60_000,
      );
      this.accumulatedPoorMs += Math.max(0, now - eligibleStart);
    }
    this.lastUpdatedAt = now;
    this.lastState = snapshot.state;

    if (now - this.sessionStartedAt < 60_000) return false;

    if (snapshot.state === "good") {
      this.goodSince ??= now;
      if (now - this.goodSince >= 5_000) this.accumulatedPoorMs = 0;
      return false;
    }

    this.goodSince = null;
    if (snapshot.state !== "poor") {
      if (
        snapshot.state === "unknown" ||
        snapshot.state === "away" ||
        snapshot.state === "paused" ||
        snapshot.state === "calibrating"
      )
        this.accumulatedPoorMs = 0;
      return false;
    }

    const sustained = this.accumulatedPoorMs >= reminderDelaySeconds * 1_000;
    const cooledDown =
      this.lastReminderAt === null ||
      now - this.lastReminderAt >= cooldownMinutes * 60_000;
    if (sustained && cooledDown) {
      this.lastReminderAt = now;
      this.accumulatedPoorMs = 0;
      return true;
    }
    return false;
  }

  suspend(): void {
    this.accumulatedPoorMs = 0;
    this.goodSince = null;
    this.lastUpdatedAt = null;
    this.lastState = null;
  }
}
