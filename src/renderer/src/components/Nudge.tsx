import { ArrowRight, Pause, X } from "@phosphor-icons/react";
import { useEffect } from "react";

const safely = (operation: Promise<unknown>): void => {
  void operation.catch(() => undefined);
};

const enableInteraction = (): void => {
  safely(window.posture.nudge.enableInteraction());
};

const playReminderSound = (): void => {
  const AudioContextConstructor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextConstructor) return;
  const context = new AudioContextConstructor();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 587.33;
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.035, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.28);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.3);
  oscillator.addEventListener("ended", () => void context.close());
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
          onClick={() => safely(window.posture.nudge.dismiss())}
        >
          <X size={16} weight="bold" />
        </button>
      </div>
      <div className="nudge-actions">
        <button
          className="button button-secondary compact"
          onClick={() => safely(window.posture.nudge.pauseForMinutes(10))}
        >
          <Pause size={15} weight="bold" /> Pause 10 min
        </button>
        <button
          className="button button-primary compact"
          onClick={() => safely(window.posture.window.openMain())}
        >
          Open Posture <ArrowRight size={15} weight="bold" />
        </button>
      </div>
    </main>
  );
}
