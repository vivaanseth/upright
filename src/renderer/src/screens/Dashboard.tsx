import { CaretRight, Pause, Play, Target, Timer } from "@phosphor-icons/react";
import type {
  SessionSummary,
  TrackingMode,
  TrackingSnapshot,
} from "../../../shared/contracts";
import { StatusVisual } from "../components/StatusVisual";

const formatDuration = (milliseconds: number): string => {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const exactPercentages = (values: number[]): number[] => {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return values.map(() => 0);
  const raw = values.map((value) => (value / total) * 100);
  const rounded = raw.map(Math.floor);
  let remaining = 100 - rounded.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, remainder: value - rounded[index] }))
    .sort((a, b) => b.remainder - a.remainder);
  for (const entry of order) {
    if (remaining <= 0) break;
    rounded[entry.index] += 1;
    remaining -= 1;
  }
  return rounded;
};

const trackingModeLabel: Record<TrackingMode, string> = {
  stopped: "Stopped",
  "requesting-permission": "Requesting camera access",
  preview: "Camera preview",
  calibrating: "Calibrating",
  tracking: "Tracking",
  paused: "Paused",
  recovering: "Recovering camera",
  error: "Needs attention",
};

export function Dashboard({
  snapshot,
  session,
  trackingMode,
  onToggle,
  onDiagnostics,
}: {
  snapshot: TrackingSnapshot;
  session: SessionSummary | null;
  trackingMode: TrackingMode;
  onToggle: () => void;
  onDiagnostics: () => void;
}): React.JSX.Element {
  const total = session?.trackedMs ?? 0;
  const [good, caution, poor] = exactPercentages([
    session?.goodMs ?? 0,
    session?.cautionMs ?? 0,
    session?.poorMs ?? 0,
  ]);
  const canPause = ["tracking", "recovering"].includes(trackingMode);

  return (
    <section
      className="screen dashboard-screen"
      aria-labelledby="dashboard-title"
    >
      <header className="screen-header compact-header">
        <div>
          <span className="context-label">Current session</span>
          <h2 id="dashboard-title">Stay comfortable, not perfect.</h2>
        </div>
        <button
          className={`button ${canPause ? "button-secondary" : "button-primary"}`}
          onClick={onToggle}
          disabled={
            trackingMode === "requesting-permission" ||
            trackingMode === "calibrating"
          }
        >
          {canPause ? (
            <Pause size={18} weight="bold" />
          ) : (
            <Play size={18} weight="fill" />
          )}
          {canPause ? "Pause" : "Start tracking"}
        </button>
      </header>

      <p className="tracking-mode" aria-live="polite" aria-atomic="true">
        Camera: {trackingModeLabel[trackingMode]}
      </p>

      <div className="dashboard-primary">
        <StatusVisual state={snapshot.state} score={snapshot.score} />
        <div className="session-time">
          <Timer size={19} />
          <span>Session time</span>
          <strong>{formatDuration(total)}</strong>
        </div>
      </div>

      <div className="metric-strip" aria-label="Session posture breakdown">
        <div>
          <strong>{good}%</strong>
          <span>Comfortable</span>
        </div>
        <div>
          <strong>{caution}%</strong>
          <span>Drifting</span>
        </div>
        <div>
          <strong>{poor}%</strong>
          <span>Reset time</span>
        </div>
        <div>
          <strong>{session?.reminderCount ?? 0}</strong>
          <span>Gentle nudges</span>
        </div>
      </div>

      <div className="detail-row">
        <div className="detail-icon">
          <Target size={21} />
        </div>
        <div>
          <strong>Personal baseline</strong>
          <p>
            Posture compares movement with the position you calibrated, not a
            universal ideal.
          </p>
        </div>
        <button className="text-button" onClick={onDiagnostics}>
          Check camera <CaretRight size={15} weight="bold" />
        </button>
      </div>
    </section>
  );
}
