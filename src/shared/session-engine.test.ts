import { describe, expect, it } from "vitest";
import type { TrackingSnapshot } from "./contracts";
import { ReminderPolicy, SessionAccumulator } from "./session-engine";

const snapshot = (
  state: TrackingSnapshot["state"],
  timestamp: number,
  score: number | null = 80,
): TrackingSnapshot => ({
  state,
  timestamp,
  score,
  confidence: score === null ? 0 : 0.9,
  inferenceMs: 12,
  sampledFps: 5,
  breakdown: null,
  message: state,
});

describe("SessionAccumulator", () => {
  it("caps long gaps and separates away time from tracked time", () => {
    const session = new SessionAccumulator(
      null,
      new Date("2026-07-11T12:00:00.000Z"),
    );
    session.update(snapshot("good", 1_000));
    session.update(snapshot("good", 2_000));
    session.update(snapshot("away", 20_000, null));
    session.update(snapshot("away", 21_000, null));
    const summary = session.getSummary();
    expect(summary.goodMs).toBe(1_000);
    expect(summary.awayMs).toBe(1_000);
    expect(summary.trackedMs).toBe(1_000);
  });

  it("tracks reminders and average score", () => {
    const session = new SessionAccumulator(null);
    session.update(snapshot("good", 1_000, 90));
    session.update(snapshot("caution", 2_000, 70));
    session.recordReminder();
    const summary = session.getSummary();
    expect(summary.averageScore).toBe(80);
    expect(summary.reminderCount).toBe(1);
  });
});

describe("ReminderPolicy", () => {
  it("waits through the first minute and sustained poor posture window", () => {
    const policy = new ReminderPolicy(0);
    expect(policy.update(snapshot("poor", 50_000, 30), 30, 10)).toBe(false);
    expect(policy.update(snapshot("poor", 61_000, 30), 30, 10)).toBe(false);
    expect(policy.update(snapshot("poor", 91_001, 30), 30, 10)).toBe(true);
  });

  it("resets poor accumulation after five seconds of good posture", () => {
    const policy = new ReminderPolicy(0);
    policy.update(snapshot("poor", 61_000, 30), 30, 10);
    policy.update(snapshot("good", 70_000, 90), 30, 10);
    policy.update(snapshot("good", 76_000, 90), 30, 10);
    expect(policy.update(snapshot("poor", 80_000, 30), 30, 10)).toBe(false);
  });
});
