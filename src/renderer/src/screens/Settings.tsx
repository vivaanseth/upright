import {
  ArrowSquareOut,
  Camera,
  DownloadSimple,
  Info,
  Trash,
  Warning,
} from "@phosphor-icons/react";
import { useState } from "react";
import type {
  CalibrationRecord,
  Settings as SettingsType,
} from "../../../shared/contracts";

type Operation =
  | "setting"
  | "export"
  | "delete-sessions"
  | "delete-calibration"
  | "reset"
  | "external";

interface SettingsProps {
  settings: SettingsType;
  version: string;
  calibrations: CalibrationRecord[];
  onUpdate: (patch: Partial<SettingsType>) => Promise<void>;
  onOpenDiagnostics: () => void;
  onExport: () => Promise<string | null>;
  onDeleteSessions: () => Promise<void>;
  onDeleteCalibration: (cameraId: string) => Promise<void>;
  onResetAll: () => Promise<void>;
}

export function Settings({
  settings,
  version,
  calibrations,
  onUpdate,
  onOpenDiagnostics,
  onExport,
  onDeleteSessions,
  onDeleteCalibration,
  onResetAll,
}: SettingsProps): React.JSX.Element {
  const [operation, setOperation] = useState<Operation | null>(null);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const busy = operation !== null;

  const run = async (
    name: Operation,
    action: () => Promise<void>,
    success: string,
  ): Promise<void> => {
    setOperation(name);
    setFeedback(null);
    try {
      await action();
      setFeedback({ kind: "success", text: success });
    } catch (error) {
      setFeedback({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "That change could not be completed. Please try again.",
      });
    } finally {
      setOperation(null);
    }
  };

  const update = (patch: Partial<SettingsType>): void => {
    void run("setting", () => onUpdate(patch), "Setting saved.");
  };

  const exportData = (): void => {
    void run(
      "export",
      async () => {
        const destination = await onExport();
        if (!destination) throw new Error("Export canceled.");
      },
      "Local data exported successfully.",
    );
  };

  const deleteSessions = (): void => {
    if (
      !window.confirm(
        "Delete all saved session summaries? Calibration and settings will stay in place.",
      )
    )
      return;
    void run(
      "delete-sessions",
      onDeleteSessions,
      "All session summaries were deleted.",
    );
  };

  const deleteCalibration = (cameraId: string): void => {
    if (
      !window.confirm(
        "Delete this camera calibration? You must recalibrate before tracking with this camera.",
      )
    )
      return;
    void run(
      "delete-calibration",
      () => onDeleteCalibration(cameraId),
      "Camera calibration deleted.",
    );
  };

  const resetAll = (): void => {
    if (
      window.prompt(
        "This deletes every local setting, calibration, and session summary. Type RESET to continue.",
      ) !== "RESET"
    )
      return;
    void run("reset", onResetAll, "Posture was reset.");
  };

  const openTrusted = (kind: "repository" | "privacy" | "mediapipe"): void => {
    void run(
      "external",
      () => window.posture.app.openExternalTrustedUrl(kind),
      "Opened in your browser.",
    );
  };

  return (
    <section
      className="screen settings-screen"
      aria-labelledby="settings-title"
    >
      <header className="screen-header">
        <div>
          <span className="context-label">Preferences</span>
          <h2 id="settings-title">Make Posture fit your day.</h2>
        </div>
        <div
          className={`settings-feedback ${feedback?.kind ?? ""}`}
          aria-live="polite"
          aria-atomic="true"
        >
          {operation ? "Saving…" : (feedback?.text ?? "")}
        </div>
      </header>
      <div className="settings-groups" aria-busy={busy}>
        <SettingsGroup
          title="Camera and calibration"
          description="Each camera keeps its own calibration. A camera is never paired with another camera's baseline."
        >
          <div className="calibration-list">
            {calibrations.length === 0 ? (
              <p className="empty-setting">No saved camera calibrations.</p>
            ) : (
              calibrations.map((calibration, index) => {
                const compatible =
                  calibration.schemaVersion === 2 &&
                  calibration.compatibility === "compatible";
                return (
                  <div className="calibration-row" key={calibration.id}>
                    <div>
                      <strong>
                        Camera calibration {calibrations.length - index}
                      </strong>
                      <small>
                        {new Date(calibration.createdAt).toLocaleDateString()} ·{" "}
                        {compatible ? "Ready" : "Recalibration required"}
                        {calibration.cameraId === settings.selectedCameraId
                          ? " · Current camera"
                          : ""}
                      </small>
                    </div>
                    <button
                      className="text-button destructive-text"
                      disabled={busy}
                      onClick={() => deleteCalibration(calibration.cameraId)}
                    >
                      Delete
                    </button>
                  </div>
                );
              })
            )}
          </div>
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={onOpenDiagnostics}
          >
            <Camera size={18} /> Open camera diagnostics
          </button>
        </SettingsGroup>

        <SettingsGroup
          title="Feedback"
          description="Control how sensitive and how frequent gentle reminders should be."
        >
          <SettingRow
            label="Sensitivity"
            helper="Balanced works well for most desk setups."
          >
            <select
              disabled={busy}
              value={settings.sensitivity}
              onChange={(event) =>
                update({
                  sensitivity: event.target
                    .value as SettingsType["sensitivity"],
                })
              }
            >
              <option value="low">Low</option>
              <option value="balanced">Balanced</option>
              <option value="high">High</option>
            </select>
          </SettingRow>
          <SettingRow
            label="Poor posture delay"
            helper="Posture waits for a sustained change before nudging."
          >
            <select
              disabled={busy}
              value={settings.reminderDelaySeconds}
              onChange={(event) =>
                update({
                  reminderDelaySeconds: Number(event.target.value) as
                    | 15
                    | 30
                    | 60,
                })
              }
            >
              <option value="15">15 seconds</option>
              <option value="30">30 seconds</option>
              <option value="60">60 seconds</option>
            </select>
          </SettingRow>
          <SettingRow
            label="Reminder cooldown"
            helper="Minimum time between nudge windows."
          >
            <select
              disabled={busy}
              value={settings.cooldownMinutes}
              onChange={(event) =>
                update({
                  cooldownMinutes: Number(event.target.value) as 5 | 10 | 20,
                })
              }
            >
              <option value="5">5 minutes</option>
              <option value="10">10 minutes</option>
              <option value="20">20 minutes</option>
            </select>
          </SettingRow>
          <ToggleRow
            label="Reminder sound"
            helper="Off by default for focused work."
            checked={settings.soundEnabled}
            disabled={busy}
            onChange={(value) => update({ soundEnabled: value })}
          />
        </SettingsGroup>

        <SettingsGroup
          title="Desktop behavior"
          description="Choose when Posture starts and how it uses battery power."
        >
          <ToggleRow
            label="Launch at login"
            helper="Start Posture after you sign in."
            checked={settings.launchAtLogin}
            disabled={busy}
            onChange={(value) => update({ launchAtLogin: value })}
          />
          <ToggleRow
            label="Start tracking automatically"
            helper="Camera access begins when Posture launches."
            checked={settings.autoStartTracking}
            disabled={busy}
            onChange={(value) => update({ autoStartTracking: value })}
          />
          <ToggleRow
            label="Reduce work on battery"
            helper="Adapt toward three samples per second while running on battery."
            checked={settings.reduceOnBattery}
            disabled={busy}
            onChange={(value) => update({ reduceOnBattery: value })}
          />
          <SettingRow
            label="Appearance"
            helper="System follows your desktop theme."
          >
            <select
              disabled={busy}
              value={settings.theme}
              onChange={(event) =>
                update({ theme: event.target.value as SettingsType["theme"] })
              }
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          title="Privacy and data"
          description="There are no accounts, cloud uploads, analytics, or saved images."
        >
          <div className="settings-actions">
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={exportData}
            >
              <DownloadSimple size={18} /> Export local data
            </button>
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={deleteSessions}
            >
              <Trash size={18} /> Delete session data
            </button>
          </div>
          <div className="privacy-explainer">
            <Info size={19} />
            <p>
              Frames and raw landmarks are processed in memory and discarded.
              Saved files contain preferences, calibration measurements, and
              aggregate session totals only.
            </p>
          </div>
          <button
            className="text-button inline-link"
            disabled={busy}
            onClick={() => openTrusted("privacy")}
          >
            Read the privacy and data policy <ArrowSquareOut size={15} />
          </button>
        </SettingsGroup>

        <SettingsGroup
          title="Reset Posture"
          description="Return the app to its first-launch state on this computer."
        >
          <div className="danger-zone">
            <Warning size={20} />
            <div>
              <strong>Delete all local Posture data</strong>
              <p>
                This removes settings, every calibration, and all session
                summaries. It cannot be undone.
              </p>
            </div>
            <button
              className="button button-danger"
              disabled={busy}
              onClick={resetAll}
            >
              Reset everything
            </button>
          </div>
        </SettingsGroup>

        <div className="about-row">
          <span>Posture {version} · MIT License · Not medical software</span>
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              void run(
                "external",
                () => window.posture.updates.openLatestRelease(),
                "Opened releases in your browser.",
              )
            }
          >
            Check for updates <ArrowSquareOut size={15} />
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => openTrusted("repository")}
          >
            Source and license <ArrowSquareOut size={15} />
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => openTrusted("mediapipe")}
          >
            Model attribution <ArrowSquareOut size={15} />
          </button>
        </div>
      </div>
    </section>
  );
}

function SettingsGroup({
  title,
  description,
  children,
}: React.PropsWithChildren<{
  title: string;
  description: string;
}>): React.JSX.Element {
  return (
    <section className="settings-group">
      <header>
        <h3>{title}</h3>
        <p>{description}</p>
      </header>
      <div>{children}</div>
    </section>
  );
}

function SettingRow({
  label,
  helper,
  children,
}: React.PropsWithChildren<{
  label: string;
  helper: string;
}>): React.JSX.Element {
  return (
    <label className="setting-row">
      <span>
        <strong>{label}</strong>
        <small>{helper}</small>
      </span>
      {children}
    </label>
  );
}

function ToggleRow({
  label,
  helper,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  helper: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="setting-row">
      <span>
        <strong>{label}</strong>
        <small>{helper}</small>
      </span>
      <button
        className={`switch ${checked ? "checked" : ""}`}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}
