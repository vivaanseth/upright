import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  LockKey,
  PersonSimple,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { CameraAccessStatus } from "../../../shared/contracts";
import { CameraPreview } from "../components/CameraPreview";
import type { CameraDevice } from "../hooks/useTrackingController";

const steps = ["Welcome", "Privacy", "Camera", "Calibrate", "Ready"];

export function Onboarding({
  stream,
  devices,
  selectedCameraId,
  progress,
  calibrating,
  cameraAccessStatus,
  canOpenCameraSettings,
  error,
  hasCalibration,
  onOpenCamera,
  onCloseCamera,
  onOpenCameraSettings,
  onSelectCamera,
  onCalibrate,
  onComplete,
}: {
  stream: MediaStream | null;
  devices: CameraDevice[];
  selectedCameraId: string | null;
  progress: number;
  calibrating: boolean;
  cameraAccessStatus: CameraAccessStatus;
  canOpenCameraSettings: boolean;
  error: string | null;
  hasCalibration: boolean;
  onOpenCamera: () => void;
  onCloseCamera: () => void;
  onOpenCameraSettings: () => void;
  onSelectCamera: (id: string) => void;
  onCalibrate: () => void;
  onComplete: () => void;
}): React.JSX.Element {
  const [step, setStep] = useState(0);
  const cameraRequestedRef = useRef(false);

  useEffect(() => {
    if (step !== 2) {
      return;
    }
    if (!stream && !cameraRequestedRef.current) {
      cameraRequestedRef.current = true;
      void onOpenCamera();
    }
  }, [onOpenCamera, step, stream]);
  useEffect(() => {
    if (step !== 3 || !hasCalibration) return;
    const timer = window.setTimeout(() => setStep(4), 0);
    return () => window.clearTimeout(timer);
  }, [hasCalibration, step]);

  const canContinue =
    step < 2 ||
    (step === 2 && Boolean(stream && selectedCameraId)) ||
    (step === 3 && hasCalibration);
  const continueToNextStep = (): void => {
    if (step === 1) {
      cameraRequestedRef.current = true;
      setStep(2);
      onOpenCamera();
      return;
    }
    setStep((value) => value + 1);
  };

  return (
    <main className="onboarding-shell">
      <div className="onboarding-topbar">
        <div className="brand">
          <span className="brand-mark">
            <PersonSimple size={22} weight="bold" />
          </span>
          <span>Posture</span>
        </div>
        <span>Setup takes about a minute</span>
      </div>
      <section className="onboarding-panel">
        <ol
          className="step-track"
          aria-label={`Step ${step + 1} of ${steps.length}`}
        >
          {steps.map((label, index) => (
            <li
              key={label}
              className={index <= step ? "complete" : ""}
              aria-current={index === step ? "step" : undefined}
            >
              <i />
              {label}
            </li>
          ))}
        </ol>
        <div className="onboarding-content">
          {step === 0 && (
            <Intro
              icon={<PersonSimple size={31} />}
              title="A quieter way to notice your posture."
              body="Posture learns your comfortable upright position, then waits for a sustained change before offering a gentle reset."
            />
          )}
          {step === 1 && (
            <Intro
              icon={<LockKey size={31} />}
              title="Your camera stays yours."
              body="Pose detection runs on this computer. Posture never uploads, saves, or logs camera frames, and there is no account to create."
              note="This tool offers ergonomic reminders, not medical advice or diagnosis."
            />
          )}
          {step === 2 && (
            <div className="onboarding-camera">
              <div>
                <span className="large-icon">
                  <Camera size={28} />
                </span>
                <h1>Choose your camera.</h1>
                <p>
                  Keep your head and both shoulders inside the guide. You can
                  change cameras later.
                </p>
              </div>
              <CameraPreview stream={stream} compact />
              <label className="field">
                <span>Camera</span>
                <select
                  value={selectedCameraId ?? ""}
                  onChange={(event) => onSelectCamera(event.target.value)}
                  disabled={!stream && devices.length === 0}
                >
                  <option value="" disabled>
                    {devices.length === 0
                      ? "Looking for cameras"
                      : "Select a camera"}
                  </option>
                  {devices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label}
                    </option>
                  ))}
                </select>
              </label>
              {stream && devices.length === 0 && (
                <p className="supporting-copy">
                  Camera access is active, but this system has not exposed the
                  camera name yet. You can continue with the current camera.
                </p>
              )}
              {!stream && (
                <button
                  className="button button-secondary"
                  onClick={() => {
                    cameraRequestedRef.current = true;
                    onOpenCamera();
                  }}
                >
                  Try camera again
                </button>
              )}
              {(cameraAccessStatus === "denied" ||
                cameraAccessStatus === "restricted") &&
                canOpenCameraSettings && (
                  <button
                    className="text-button"
                    onClick={onOpenCameraSettings}
                  >
                    Open camera privacy settings
                  </button>
                )}
              {error && (
                <p className="inline-error" role="alert">
                  {error}
                </p>
              )}
            </div>
          )}
          {step === 3 && (
            <div className="calibration-step">
              <div>
                <span className="large-icon">
                  <PersonSimple size={28} />
                </span>
                <h1>Find your baseline.</h1>
                <p>
                  Sit comfortably upright in your usual working position. Stay
                  natural and still for ten seconds.
                </p>
              </div>
              <CameraPreview stream={stream} compact />
              <div
                className="calibration-progress large"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
                aria-label={`Calibration ${progress}% complete`}
              >
                <span style={{ width: `${progress}%` }} />
              </div>
              <button
                className="button button-primary"
                disabled={calibrating}
                onClick={onCalibrate}
              >
                {calibrating ? `Calibrating ${progress}%` : "Start calibration"}
              </button>
              {error && (
                <p className="inline-error" role="alert">
                  {error}
                </p>
              )}
            </div>
          )}
          {step === 4 && (
            <Intro
              icon={<Check size={31} weight="bold" />}
              title="You are ready."
              body="Close the window whenever you like. Posture keeps tracking from the tray until you pause or quit."
              note="The first reminder is suppressed for one minute so you can settle in."
            />
          )}
        </div>
        <footer className="onboarding-actions">
          <button
            className="button button-quiet"
            disabled={step === 0}
            onClick={() => {
              if (step === 2) onCloseCamera();
              setStep((value) => value - 1);
            }}
          >
            <ArrowLeft size={17} /> Back
          </button>
          {step === 4 ? (
            <button className="button button-primary" onClick={onComplete}>
              Start my first session <ArrowRight size={17} />
            </button>
          ) : (
            step !== 3 && (
              <button
                className="button button-primary"
                disabled={!canContinue}
                onClick={continueToNextStep}
              >
                Continue <ArrowRight size={17} />
              </button>
            )
          )}
        </footer>
      </section>
    </main>
  );
}

function Intro({
  icon,
  title,
  body,
  note,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  note?: string;
}): React.JSX.Element {
  return (
    <div className="intro-step">
      <span className="large-icon">{icon}</span>
      <h1>{title}</h1>
      <p>{body}</p>
      {note && <div className="note-box">{note}</div>}
    </div>
  );
}
