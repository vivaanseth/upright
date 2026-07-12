import { useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { useTrackingController } from "./hooks/useTrackingController";
import { Dashboard } from "./screens/Dashboard";
import { Diagnostics } from "./screens/Diagnostics";
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
        cameraAccessStatus={controller.cameraAccessStatus}
        canOpenCameraSettings={store.appInfo?.platform !== "linux"}
        error={controller.calibrationError ?? store.cameraError}
        hasCalibration={Boolean(selectedCalibration)}
        onOpenCamera={() =>
          safely(controller.openCamera(store.settings.selectedCameraId))
        }
        onCloseCamera={controller.closePreview}
        onOpenCameraSettings={() =>
          safely(controller.openSystemPrivacySettings())
        }
        onSelectCamera={(id) => safely(controller.selectCamera(id))}
        onCalibrate={() => safely(controller.beginCalibration())}
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
        }}
      />
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
            onSelectCamera={(id) => safely(controller.selectCamera(id))}
            onOpenCamera={() =>
              safely(controller.openCamera(store.settings.selectedCameraId))
            }
            onCalibrate={() => safely(controller.beginCalibration())}
          />
        )}
        {store.view === "settings" && (
          <Settings
            settings={store.settings}
            version={store.appInfo?.version ?? "0.1.1"}
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
