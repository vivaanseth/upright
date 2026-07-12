import {
  ArrowClockwise,
  CheckCircle,
  Gauge,
  VideoCamera,
} from "@phosphor-icons/react";
import { CameraPreview } from "../components/CameraPreview";
import type { CameraDevice } from "../hooks/useTrackingController";
import type { TrackingSnapshot } from "../../../shared/contracts";

export function Diagnostics({
  stream,
  devices,
  selectedCameraId,
  snapshot,
  calibrating,
  progress,
  error,
  workerReady,
  onSelectCamera,
  onOpenCamera,
  onCalibrate,
}: {
  stream: MediaStream | null;
  devices: CameraDevice[];
  selectedCameraId: string | null;
  snapshot: TrackingSnapshot;
  calibrating: boolean;
  progress: number;
  error: string | null;
  workerReady: boolean;
  onSelectCamera: (id: string) => void;
  onOpenCamera: () => void;
  onCalibrate: () => void;
}): React.JSX.Element {
  return (
    <section className="screen" aria-labelledby="camera-title">
      <header className="screen-header">
        <div>
          <span className="context-label">Camera and calibration</span>
          <h2 id="camera-title">Keep the signal reliable.</h2>
          <p>
            The preview is visible only here and during setup. It is never
            saved.
          </p>
        </div>
      </header>
      <div className="diagnostics-layout">
        <CameraPreview stream={stream} />
        <div className="diagnostics-controls">
          <label className="field">
            <span>Camera</span>
            <select
              value={selectedCameraId ?? ""}
              onChange={(event) => onSelectCamera(event.target.value)}
            >
              <option value="" disabled>
                Select a camera
              </option>
              {devices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
            <small>Changing cameras requires a new calibration.</small>
          </label>
          {!stream && (
            <button className="button button-secondary" onClick={onOpenCamera}>
              <VideoCamera size={18} /> Open preview
            </button>
          )}
          <button
            className="button button-primary"
            disabled={!stream || calibrating || !workerReady}
            onClick={onCalibrate}
          >
            <ArrowClockwise size={18} weight="bold" />{" "}
            {calibrating ? "Hold your position" : "Calibrate now"}
          </button>
          {calibrating && (
            <div
              className="calibration-progress"
              aria-label={`Calibration ${progress}% complete`}
            >
              <span style={{ width: `${progress}%` }} />
            </div>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="diagnostic-readout">
            <div>
              <Gauge size={18} />
              <span>Model</span>
              <strong>{workerReady ? "Ready" : "Loading"}</strong>
            </div>
            <div>
              <CheckCircle size={18} />
              <span>Landmark confidence</span>
              <strong>{Math.round(snapshot.confidence * 100)}%</strong>
            </div>
            <div>
              <VideoCamera size={18} />
              <span>Inference</span>
              <strong>
                {snapshot.inferenceMs === null
                  ? "Idle"
                  : `${Math.round(snapshot.inferenceMs)} ms`}
              </strong>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
