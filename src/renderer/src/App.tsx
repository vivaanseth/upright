import { useEffect, useRef, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { useTrackingController } from "./hooks/useTrackingController";
import { Dashboard } from "./screens/Dashboard";
import { Diagnostics } from "./screens/Diagnostics";
import { History } from "./screens/History";
import { Onboarding } from "./screens/Onboarding";
import { Settings } from "./screens/Settings";
import { useAppStore } from "./store";

const safely = (operation: Promise<unknown>): void => {
  void operation.catch(() => undefined);
};

export function App(): React.JSX.Element {
  const store = useAppStore();
  const controller = useTrackingController();
  const initialize = store.initialize;
  const refreshCurrentSession = store.refreshCurrentSession;
  const refreshRecentSessions = store.refreshRecentSessions;
  const setStorageRecovery = store.setStorageRecovery;
  const previousTrackingMode = useRef(store.trackingMode);

  useEffect(() => {
    void initialize();
  }, [initialize]);
  useEffect(() => {
    if (!store.initialized) return;
    document.documentElement.dataset.theme = store.settings.theme;
  }, [store.initialized, store.settings.theme]);
  useEffect(() => {
    if (!store.initialized || store.trackingMode !== "tracking") return;
    void refreshCurrentSession();
    const timer = window.setInterval(() => void refreshCurrentSession(), 1_000);
    return () => window.clearInterval(timer);
  }, [refreshCurrentSession, store.initialized, store.trackingMode]);
  useEffect(() => {
    const previous = previousTrackingMode.current;
    previousTrackingMode.current = store.trackingMode;
    if (
      previous === "tracking" &&
      store.trackingMode !== "tracking" &&
      store.initialized
    ) {
      void Promise.all([refreshCurrentSession(), refreshRecentSessions()]);
    }
  }, [
    refreshCurrentSession,
    refreshRecentSessions,
    store.initialized,
    store.trackingMode,
  ]);
  useEffect(() => {
    if (store.view === "history") void refreshRecentSessions();
  }, [store.view, refreshRecentSessions]);
  useEffect(
    () => window.upright.storage.onRecovery(setStorageRecovery),
    [setStorageRecovery],
  );

  if (store.initializationError)
    return (
      <InitializationFailure
        message={store.initializationError}
        onRetry={() => void store.initialize()}
      />
    );
  if (!store.initialized) return <LoadingScreen />;

  const selectedCalibration = store.calibrations.find(
    (item) =>
      item.schemaVersion === 2 &&
      item.compatibility === "compatible" &&
      item.cameraId === store.settings.selectedCameraId,
  );

  if (!store.settings.onboardingComplete) {
    return (
      <Onboarding
        stream={controller.stream}
        devices={controller.devices}
        selectedCameraId={store.settings.selectedCameraId}
        progress={controller.calibrationProgress}
        calibrating={controller.calibrating}
        cameraAccessStatus={controller.cameraAccessStatus}
        cameraFailureCode={controller.cameraFailureCode}
        workerReady={controller.workerReady}
        canOpenCameraSettings={store.appInfo?.platform !== "linux"}
        error={controller.calibrationError ?? store.cameraError}
        hasCalibration={Boolean(selectedCalibration)}
        onOpenCamera={() =>
          safely(controller.openCamera(store.settings.selectedCameraId, true))
        }
        onCloseCamera={controller.closePreview}
        onOpenCameraSettings={() =>
          safely(controller.openSystemPrivacySettings())
        }
        onSelectCamera={(id) => safely(controller.selectCamera(id))}
        onCalibrate={() => safely(controller.beginCalibration())}
        onCancelCalibration={controller.cancelCalibration}
        onTestReminder={() => window.upright.nudge.preview()}
        onComplete={() => {
          safely(
            store
              .completeOnboarding()
              .then(() => window.upright.tracking.start()),
          );
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <Sidebar
        view={store.view}
        onChange={(view) => {
          if (
            store.view === "diagnostics" &&
            view !== "diagnostics" &&
            !store.tracking
          ) {
            controller.closePreview();
          }
          store.setView(view);
          window.requestAnimationFrame(() => {
            const heading = document.querySelector<HTMLElement>(
              ".content-shell .screen h1",
            );
            heading?.focus();
          });
        }}
      />
      <main className="content-shell">
        {store.storageRecovery && (
          <div className="recovery-banner" role="status">
            <span>
              Upright recovered a damaged local {store.storageRecovery.file}{" "}
              file and kept a quarantined backup.
            </span>
            <button
              className="text-button"
              onClick={() => store.setStorageRecovery(null)}
            >
              Dismiss
            </button>
          </div>
        )}
        {store.view === "dashboard" && (
          <Dashboard
            snapshot={store.snapshot}
            session={store.session}
            trackingMode={store.trackingMode}
            cameraError={store.cameraError}
            cameraFailureCode={controller.cameraFailureCode}
            cameraId={store.settings.selectedCameraId}
            hasCalibration={Boolean(selectedCalibration)}
            onToggle={() => {
              void (["tracking", "recovering"].includes(store.trackingMode)
                ? window.upright.tracking.pause("user")
                : window.upright.tracking.start());
            }}
            onDiagnostics={() => store.setView("diagnostics")}
            onRetryCamera={() =>
              safely(
                selectedCalibration
                  ? controller.startTracking()
                  : controller.openCamera(
                      store.settings.selectedCameraId,
                      false,
                      "preview",
                    ),
              )
            }
            onRecalibrate={() => {
              store.setView("diagnostics");
              safely(controller.beginCalibration());
            }}
          />
        )}
        {store.view === "diagnostics" && (
          <Diagnostics
            stream={controller.stream}
            devices={controller.devices}
            selectedCameraId={store.settings.selectedCameraId}
            snapshot={store.snapshot}
            calibrating={controller.calibrating}
            progress={controller.calibrationProgress}
            error={controller.calibrationError ?? store.cameraError}
            workerReady={controller.workerReady}
            diagnosticsEnabled={store.settings.diagnosticsEnabled}
            diagnostics={controller.diagnostics}
            onSelectCamera={(id) => safely(controller.selectCamera(id))}
            onOpenCamera={() =>
              safely(
                controller.openCamera(store.settings.selectedCameraId, false),
              )
            }
            onCalibrate={() => safely(controller.beginCalibration())}
            onCancelCalibration={controller.cancelCalibration}
          />
        )}
        {store.view === "history" && (
          <History sessions={store.recentSessions} />
        )}
        {store.view === "settings" && (
          <Settings
            settings={store.settings}
            version={store.appInfo?.version ?? "0.6.0"}
            calibrations={store.calibrations}
            onUpdate={store.updateSettings}
            onOpenDiagnostics={() => store.setView("diagnostics")}
            onExport={() => window.upright.data.export()}
            onDeleteSessions={store.deleteSessions}
            onDeleteCalibration={async (cameraId) => {
              if (cameraId === store.settings.selectedCameraId) {
                await window.upright.tracking.pause("calibration-deleted");
                controller.closePreview();
              }
              await store.deleteCalibration(cameraId);
            }}
            onResetAll={async () => {
              await window.upright.tracking.pause("reset");
              controller.closePreview();
              await store.resetAll();
            }}
          />
        )}
      </main>
    </div>
  );
}

function InitializationFailure({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}): React.JSX.Element {
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  return (
    <main className="failure-screen" aria-labelledby="startup-error-title">
      <div>
        <span className="context-label">Startup problem</span>
        <h1 id="startup-error-title">Upright could not finish opening.</h1>
        <p>{message}</p>
        <div className="dialog-actions">
          <button className="button button-primary" onClick={onRetry}>
            Retry
          </button>
          <button
            className="button button-secondary"
            onClick={() => setConfirmReset(true)}
          >
            Reset local data
          </button>
          <button
            className="button button-quiet"
            onClick={() => safely(window.upright.window.quit())}
          >
            Quit
          </button>
        </div>
        {confirmReset && (
          <ResetDataDialog
            error={resetError}
            onCancel={() => {
              setResetError(null);
              setConfirmReset(false);
            }}
            onConfirm={async () => {
              try {
                await window.upright.data.resetAll();
                window.location.reload();
              } catch (error) {
                setResetError(
                  error instanceof Error
                    ? error.message
                    : "Upright could not reset local data.",
                );
              }
            }}
          />
        )}
      </div>
    </main>
  );
}

export function ResetDataDialog({
  error,
  onCancel,
  onConfirm,
}: {
  error: string | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement as HTMLElement | null;
    if (!dialog.open) dialog.showModal();
    return () => opener?.focus();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="confirmation-dialog"
      aria-labelledby="reset-data-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
    >
      <form method="dialog" onSubmit={(event) => event.preventDefault()}>
        <span className="context-label">Permanent action</span>
        <h2 id="reset-data-title">Reset every local Upright record?</h2>
        <p>
          This deletes settings, calibrations, and aggregate session history.
          Type RESET to continue.
        </p>
        <label className="field">
          <span>Confirmation</span>
          <input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-describedby={error ? "reset-data-error" : undefined}
          />
        </label>
        {error && (
          <p id="reset-data-error" className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            className="button button-secondary"
            type="button"
            disabled={pending}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="button button-danger"
            type="button"
            disabled={pending || value !== "RESET"}
            onClick={() => {
              setPending(true);
              void onConfirm().finally(() => setPending(false));
            }}
          >
            {pending ? "Resetting…" : "Reset everything"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function LoadingScreen(): React.JSX.Element {
  return (
    <main className="loading-screen" aria-label="Loading Upright">
      <div className="loading-mark" />
      <div className="loading-line wide" />
      <div className="loading-line" />
    </main>
  );
}
