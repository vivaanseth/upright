import {
  Check,
  EyeSlash,
  Pause,
  Warning,
  Waveform,
} from "@phosphor-icons/react";
import type { PostureState } from "../../../shared/contracts";

const statusMeta: Record<PostureState, { label: string; icon: typeof Check }> =
  {
    good: { label: "Looking good", icon: Check },
    caution: { label: "Small adjustment", icon: Waveform },
    poor: { label: "Reset suggested", icon: Warning },
    unknown: { label: "Adjust your view", icon: EyeSlash },
    away: { label: "You are away", icon: EyeSlash },
    paused: { label: "Tracking paused", icon: Pause },
    calibrating: { label: "Calibrating", icon: Waveform },
  };

export function StatusVisual({
  state,
  score,
}: {
  state: PostureState;
  score: number | null;
}): React.JSX.Element {
  const meta = statusMeta[state];
  const Icon = meta.icon;
  const progress = score ?? 0;
  return (
    <div className={`status-visual state-${state}`}>
      <div
        className="score-ring"
        style={{ "--score": progress } as React.CSSProperties}
        aria-label={
          score === null
            ? meta.label
            : `${meta.label}, score ${score} out of 100`
        }
      >
        <div className="score-center">
          <Icon size={24} weight="bold" />
          {score === null ? (
            <span className="score-word">
              {state === "paused" ? "Off" : "Wait"}
            </span>
          ) : (
            <strong>{score}</strong>
          )}
        </div>
      </div>
      <div className="status-copy">
        <h1>{meta.label}</h1>
        <p>
          {state === "good"
            ? "You are close to your calibrated position."
            : state === "poor"
              ? "Relax your shoulders and gently sit taller."
              : state === "caution"
                ? "Your position is beginning to drift."
                : state === "paused"
                  ? "Start when you are ready for a focused session."
                  : "Make sure your head and shoulders are visible."}
        </p>
      </div>
    </div>
  );
}
