import { CaretRight, Pause, Play, Target, Timer } from "@phosphor-icons/react";
import type {
  SessionSummary,
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

const percentage = (value: number, total: number): number =>
  total > 0 ? Math.round((value / total) * 100) : 0;

export function Dashboard({
  snapshot,
  session,
  tracking,
  onToggle,
  onDiagnostics,
}: {
  snapshot: TrackingSnapshot;
  session: SessionSummary | null;
  tracking: boolean;
  onToggle: () => void;
  onDiagnostics: () => void;
}): React.JSX.Element {
  const total = session?.trackedMs ?? 0;
  const good = percentage(session?.goodMs ?? 0, total);
  const caution = percentage(session?.cautionMs ?? 0, total);
  const poor = percentage(session?.poorMs ?? 0, total);

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
          className={`button ${tracking ? "button-secondary" : "button-primary"}`}
          onClick={onToggle}
        >
          {tracking ? (
            <Pause size={18} weight="bold" />
          ) : (
            <Play size={18} weight="fill" />
          )}
          {tracking ? "Pause" : "Start tracking"}
        </button>
      </header>

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
