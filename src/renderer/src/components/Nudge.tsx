import { ArrowRight, Pause, X } from "@phosphor-icons/react";

export function Nudge(): React.JSX.Element {
  return (
    <main className="nudge-shell" role="alert" aria-live="assertive">
      <div className="nudge-heading">
        <div className="nudge-mark" aria-hidden="true" />
        <div>
          <strong>Take a moment to reset</strong>
          <p>Relax your shoulders and return to your comfortable baseline.</p>
        </div>
        <button
          className="icon-button"
          aria-label="Dismiss reminder"
          onClick={() => window.posture.nudge.dismiss()}
        >
          <X size={16} weight="bold" />
        </button>
      </div>
      <div className="nudge-actions">
        <button
          className="button button-secondary compact"
          onClick={() => window.posture.nudge.pauseForMinutes(10)}
        >
          <Pause size={15} weight="bold" /> Pause 10 min
        </button>
        <button
          className="button button-primary compact"
          onClick={() => window.posture.window.openMain()}
        >
          Open Posture <ArrowRight size={15} weight="bold" />
        </button>
      </div>
    </main>
  );
}
