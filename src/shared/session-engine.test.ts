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
    session.update(snapshot("caution", 3_000, 70));
    session.recordReminder();
    const summary = session.getSummary();
    expect(summary.averageScore).toBe(80);
    expect(summary.reminderCount).toBe(1);
  });

  it("weights score by elapsed time instead of inference sample count", () => {
    const session = new SessionAccumulator(null);
    session.update(snapshot("good", 0, 90));
    session.update(snapshot("good", 100, 90));
    session.update(snapshot("poor", 200, 10));
    session.update(snapshot("poor", 1_200, 10));
    expect(session.getSummary().averageScore).toBe(23);
  });

  it("does not inflate time across an explicit suspension", () => {
    const session = new SessionAccumulator(null);
    session.update(snapshot("good", 1_000, 90));
    session.suspend();
    session.update(snapshot("good", 60_000, 90));
    expect(session.getSummary().trackedMs).toBe(0);
  });

  it("ends sessions with explicit wall-clock timestamps", () => {
    const session = new SessionAccumulator(
      "00000000-0000-4000-8000-000000000000",
      new Date("2026-07-11T12:00:00.000Z"),
    );
    const ended = session.end(new Date("2026-07-11T12:05:00.000Z"));
    expect(ended).toMatchObject({
      endedAt: "2026-07-11T12:05:00.000Z",
      updatedAt: "2026-07-11T12:05:00.000Z",
    });
  });
});

describe("ReminderPolicy", () => {
  it("waits through the first minute and sustained poor posture window", () => {
    const policy = new ReminderPolicy(0);
    expect(policy.update(snapshot("poor", 50_000, 30), 30, 10)).toBe(false);
    expect(policy.update(snapshot("poor", 61_000, 30), 30, 10)).toBe(false);
    expect(policy.update(snapshot("poor", 91_001, 30), 30, 10)).toBe(true);
  });

  it("uses one monotonic clock for startup suppression and reminder timing", () => {
    const mainStartedAt = 2_000_000;
    const policy = new ReminderPolicy(mainStartedAt);
    expect(
      policy.update(snapshot("poor", mainStartedAt + 59_999, 30), 30, 10),
    ).toBe(false);
    expect(
      policy.update(snapshot("poor", mainStartedAt + 60_000, 30), 30, 10),
    ).toBe(false);
    expect(
      policy.update(snapshot("poor", mainStartedAt + 90_000, 30), 30, 10),
    ).toBe(true);
  });

  it("resets poor accumulation after five seconds of good posture", () => {
    const policy = new ReminderPolicy(0);
    policy.update(snapshot("poor", 61_000, 30), 30, 10);
    policy.update(snapshot("good", 70_000, 90), 30, 10);
    policy.update(snapshot("good", 76_000, 90), 30, 10);
    expect(policy.update(snapshot("poor", 80_000, 30), 30, 10)).toBe(false);
  });

  it("preserves poor accumulation through a brief recovery", () => {
    const policy = new ReminderPolicy(0);
    policy.update(snapshot("poor", 61_000, 30), 30, 10);
    policy.update(snapshot("poor", 81_000, 30), 30, 10);
    policy.update(snapshot("good", 82_000, 90), 30, 10);
    policy.update(snapshot("poor", 83_000, 30), 30, 10);
    expect(policy.update(snapshot("poor", 93_001, 30), 30, 10)).toBe(true);
  });

  it("suspends timing across sleep or pause", () => {
    const policy = new ReminderPolicy(0);
    policy.update(snapshot("poor", 61_000, 30), 30, 10);
    policy.update(snapshot("poor", 80_000, 30), 30, 10);
    policy.suspend();
    policy.update(snapshot("poor", 200_000, 30), 30, 10);
    expect(policy.update(snapshot("poor", 210_000, 30), 30, 10)).toBe(false);
  });

  it("does not duplicate reminders during cooldown", () => {
    const policy = new ReminderPolicy(0);
    policy.update(snapshot("poor", 61_000, 30), 15, 10);
    expect(policy.update(snapshot("poor", 76_001, 30), 15, 10)).toBe(true);
    policy.update(snapshot("poor", 80_000, 30), 15, 10);
    expect(policy.update(snapshot("poor", 96_000, 30), 15, 10)).toBe(false);
    expect(policy.update(snapshot("poor", 700_000, 30), 15, 10)).toBe(true);
  });

  it("clears poor accumulation for unknown and away states", () => {
    const policy = new ReminderPolicy(0);
    policy.update(snapshot("poor", 61_000, 30), 30, 10);
    policy.update(snapshot("poor", 80_000, 30), 30, 10);
    policy.update(snapshot("unknown", 81_000, null), 30, 10);
    expect(policy.update(snapshot("poor", 93_001, 30), 30, 10)).toBe(false);
    policy.update(snapshot("away", 94_000, null), 30, 10);
    expect(policy.update(snapshot("poor", 125_001, 30), 30, 10)).toBe(false);
  });
});
