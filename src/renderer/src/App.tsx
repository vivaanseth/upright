import { useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { useTrackingController } from "./hooks/useTrackingController";
import { Dashboard } from "./screens/Dashboard";
import { Diagnostics } from "./screens/Diagnostics";
import { Onboarding } from "./screens/Onboarding";
import { Settings } from "./screens/Settings";
import { useAppStore } from "./store";

export function App(): React.JSX.Element {
  const store = useAppStore();
  const controller = useTrackingController();
  const initialize = store.initialize;
  const refreshSessions = store.refreshSessions;

  useEffect(() => {
    void initialize();
  }, [initialize]);
  useEffect(() => {
    if (!store.initialized) return;
    document.documentElement.dataset.theme = store.settings.theme;
  }, [store.initialized, store.settings.theme]);
  useEffect(() => {
    if (!store.initialized) return;
    const timer = window.setInterval(() => void refreshSessions(), 1_000);
    return () => window.clearInterval(timer);
  }, [refreshSessions, store.initialized]);

  if (!store.initialized) return <LoadingScreen />;

  const selectedCalibration = store.calibrations.find(
    (item) => item.cameraId === store.settings.selectedCameraId,
  );

  if (!store.settings.onboardingComplete) {
    return (
      <Onboarding
        stream={controller.stream}
        devices={controller.devices}
        selectedCameraId={store.settings.selectedCameraId}
        progress={controller.calibrationProgress}
        calibrating={controller.calibrating}
        error={controller.calibrationError ?? store.cameraError}
        hasCalibration={Boolean(selectedCalibration)}
        onOpenCamera={() =>
          void controller.openCamera(store.settings.selectedCameraId)
        }
        onSelectCamera={(id) => void controller.selectCamera(id)}
        onCalibrate={() => void controller.beginCalibration()}
        onComplete={() => {
          void store
            .completeOnboarding()
            .then(() => window.posture.tracking.start());
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <Sidebar view={store.view} onChange={store.setView} />
      <main className="content-shell">
        {store.view === "dashboard" && (
          <Dashboard
            snapshot={store.snapshot}
            session={store.session}
            tracking={store.tracking}
            onToggle={() => {
              void (store.tracking
                ? window.posture.tracking.pause("user")
                : window.posture.tracking.start());
            }}
            onDiagnostics={() => store.setView("diagnostics")}
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
            onSelectCamera={(id) => void controller.selectCamera(id)}
            onOpenCamera={() =>
              void controller.openCamera(store.settings.selectedCameraId)
            }
            onCalibrate={() => void controller.beginCalibration()}
          />
        )}
        {store.view === "settings" && (
          <Settings
            settings={store.settings}
            version={store.appInfo?.version ?? "0.1.0"}
            onUpdate={(patch) => void store.updateSettings(patch)}
          />
        )}
      </main>
    </div>
  );
}

function LoadingScreen(): React.JSX.Element {
  return (
    <main className="loading-screen" aria-label="Loading Posture">
      <div className="loading-mark" />
      <div className="loading-line wide" />
      <div className="loading-line" />
    </main>
  );
}
