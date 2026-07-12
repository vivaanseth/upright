import {
  ArrowSquareOut,
  DownloadSimple,
  Info,
  Trash,
} from "@phosphor-icons/react";
import type { Settings as SettingsType } from "../../../shared/contracts";

export function Settings({
  settings,
  version,
  onUpdate,
}: {
  settings: SettingsType;
  version: string;
  onUpdate: (patch: Partial<SettingsType>) => void;
}): React.JSX.Element {
  const exportData = async (): Promise<void> => {
    await window.posture.data.export();
  };
  const deleteSessions = async (): Promise<void> => {
    if (
      window.confirm(
        "Delete all saved session summaries? Calibration and settings will stay in place.",
      )
    )
      await window.posture.data.deleteSessions();
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
      </header>
      <div className="settings-groups">
        <SettingsGroup
          title="Feedback"
          description="Control how sensitive and how frequent gentle reminders should be."
        >
          <SettingRow
            label="Sensitivity"
            helper="Balanced works well for most desk setups."
          >
            <select
              value={settings.sensitivity}
              onChange={(event) =>
                onUpdate({
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
              value={settings.reminderDelaySeconds}
              onChange={(event) =>
                onUpdate({
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
              value={settings.cooldownMinutes}
              onChange={(event) =>
                onUpdate({
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
            onChange={(value) => onUpdate({ soundEnabled: value })}
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
            onChange={(value) => onUpdate({ launchAtLogin: value })}
          />
          <ToggleRow
            label="Start tracking automatically"
            helper="Camera access begins when Posture launches."
            checked={settings.autoStartTracking}
            onChange={(value) => onUpdate({ autoStartTracking: value })}
          />
          <ToggleRow
            label="Reduce work on battery"
            helper="Use five pose samples per second for lower energy use."
            checked={settings.reduceOnBattery}
            onChange={(value) => onUpdate({ reduceOnBattery: value })}
          />
          <SettingRow
            label="Appearance"
            helper="System follows your desktop theme."
          >
            <select
              value={settings.theme}
              onChange={(event) =>
                onUpdate({ theme: event.target.value as SettingsType["theme"] })
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
          description="There are no accounts, cloud uploads, or analytics."
        >
          <div className="settings-actions">
            <button className="button button-secondary" onClick={exportData}>
              <DownloadSimple size={18} /> Export local data
            </button>
            <button
              className="button button-secondary"
              onClick={deleteSessions}
            >
              <Trash size={18} /> Delete session data
            </button>
          </div>
          <div className="privacy-explainer">
            <Info size={19} />
            <p>
              Frames are processed in memory and discarded immediately. Saved
              files contain only preferences, calibration measurements, and
              aggregate session totals.
            </p>
          </div>
        </SettingsGroup>

        <div className="about-row">
          <span>Posture {version}</span>
          <button
            className="text-button"
            onClick={() => window.posture.updates.openLatestRelease()}
          >
            Check for updates <ArrowSquareOut size={15} />
          </button>
          <button
            className="text-button"
            onClick={() =>
              window.posture.app.openExternalTrustedUrl("mediapipe")
            }
          >
            Model details <ArrowSquareOut size={15} />
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
  onChange,
}: {
  label: string;
  helper: string;
  checked: boolean;
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
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}
