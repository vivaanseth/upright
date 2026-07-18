import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  SessionSummary,
  TrackingSnapshot,
} from "../../../shared/contracts";
import { Dashboard } from "./Dashboard";

const snapshot: TrackingSnapshot = {
  state: "good",
  score: 90,
  confidence: 1,
  inferenceMs: 50,
  sampledFps: 5,
  timestamp: 100,
  breakdown: null,
  message: "Comfortable",
};

const session: SessionSummary = {
  schemaVersion: 2,
  id: "00000000-0000-4000-8000-000000000000",
  startedAt: "2026-07-12T00:00:00.000Z",
  endedAt: null,
  trackedMs: 3,
  goodMs: 1,
  cautionMs: 1,
  poorMs: 1,
  unknownMs: 0,
  awayMs: 0,
  averageScore: 90,
  reminderCount: 0,
  calibrationId: "00000000-0000-4000-8000-000000000000",
  updatedAt: "2026-07-12T00:00:00.000Z",
  recovered: false,
};

describe("Dashboard", () => {
  it("shows tracking lifecycle separately and totals posture percentages to 100", () => {
    render(
      <Dashboard
        snapshot={snapshot}
        session={session}
        trackingMode="recovering"
        cameraError={null}
        cameraFailureCode={null}
        cameraId="camera-1"
        hasCalibration
        onToggle={vi.fn()}
        onDiagnostics={vi.fn()}
        onRetryCamera={vi.fn()}
        onRecalibrate={vi.fn()}
      />,
    );
    expect(screen.getByText("Camera: Recovering camera")).toBeVisible();
    expect(screen.getByText("34%")).toBeVisible();
    expect(screen.getAllByText("33%")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Pause" })).toBeEnabled();
  });
});
