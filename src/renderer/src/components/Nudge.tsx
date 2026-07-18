import { ArrowRight, Pause, X } from "@phosphor-icons/react";
import { useEffect } from "react";
import { REMINDER_SOUND_DATA_URL } from "../reminder-sound";

const safely = (operation: Promise<unknown>): void => {
  void operation.catch(() => undefined);
};

const enableInteraction = (): void => {
  safely(window.uprightNudge.enableInteraction());
};

const playReminderSound = (): void => {
  const audio = new Audio(REMINDER_SOUND_DATA_URL);
  audio.volume = 0.45;
  void audio.play().catch(() => undefined);
};

export function Nudge(): React.JSX.Element {
  useEffect(() => {
    const shouldPlay =
      new URLSearchParams(window.location.search).get("sound") === "1";
    if (!shouldPlay) return;
    try {
      playReminderSound();
    } catch {
      // Audio failure should never prevent the reminder controls from working.
    }
  }, []);

  return (
    <main
      className="nudge-shell"
      role="alert"
      aria-live="assertive"
      onPointerDown={enableInteraction}
      onKeyDown={enableInteraction}
    >
      <div className="nudge-heading">
        <div className="nudge-mark" aria-hidden="true" />
        <div>
          <strong>Take a moment to reset</strong>
          <p>Relax your shoulders and return to your comfortable baseline.</p>
        </div>
        <button
          className="icon-button"
          aria-label="Dismiss reminder"
          onClick={() => safely(window.uprightNudge.dismiss())}
        >
          <X size={16} weight="bold" />
        </button>
      </div>
      <div className="nudge-actions">
        <button
          className="button button-secondary compact"
          onClick={() => safely(window.uprightNudge.pauseForMinutes(10))}
        >
          <Pause size={15} weight="bold" /> Pause 10 min
        </button>
        <button
          className="button button-primary compact"
          onClick={() => safely(window.uprightNudge.openMain())}
        >
          Open Upright <ArrowRight size={15} weight="bold" />
        </button>
      </div>
    </main>
  );
}
