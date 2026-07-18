import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Calibration,
  CameraAccessStatus,
  CameraFailureCode,
  CameraOwner,
  PostureFeatures,
  PowerState,
  RuntimeDiagnostics,
  TrackingSnapshot,
  TrackingCommand,
  TrackingMode,
} from "../../../shared/contracts";
import {
  buildCalibration,
  extractPostureFeaturesDetailed,
  isCalibrationCompatible,
  PostureClassifier,
} from "../../../shared/posture-engine";
import {
  POSE_WORKER_PROTOCOL_VERSION,
  parsePoseWorkerResponse,
  type PoseWorkerRequest,
  type PoseWorkerResponse,
} from "../../../shared/worker-protocol";
import { AdaptiveSamplingController } from "../runtime/adaptive-sampling";
import { useAppStore } from "../store";

export interface CameraDevice {
  deviceId: string;
  label: string;
}

interface WorkerDeferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

const createDeferred = (): WorkerDeferred => {
  let resolve = (): void => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));

const percentile = (values: number[], ratio: number): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
};

const reportSnapshotToMain = (snapshot: TrackingSnapshot): void => {
  window.upright.tracking.reportSnapshot({
    state: snapshot.state,
    score: snapshot.score,
    confidence: snapshot.confidence,
    inferenceMs: snapshot.inferenceMs,
    sampledFps: snapshot.sampledFps,
    breakdown: snapshot.breakdown,
    message: snapshot.message,
  });
};

export function normalizeCameraDevices(
  devices: MediaDeviceInfo[],
  activeStream?: MediaStream | null,
): CameraDevice[] {
  const cameras = devices
    .filter((device) => device.kind === "videoinput")
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Camera ${index + 1}`,
    }))
    .filter((device) => device.deviceId);

  const activeTrack = activeStream?.getVideoTracks()[0];
  const activeId = activeTrack?.getSettings().deviceId;
  if (activeId && !cameras.some((device) => device.deviceId === activeId)) {
    cameras.unshift({
      deviceId: activeId,
      label: activeTrack?.label || "Current camera",
    });
  }
  return cameras;
}

export function useTrackingController() {
  const settings = useAppStore((state) => state.settings);
  const calibrations = useAppStore((state) => state.calibrations);
  const setCalibrations = useAppStore((state) => state.setCalibrations);
  const setSnapshot = useAppStore((state) => state.setSnapshot);
  const setTrackingMode = useAppStore((state) => state.setTrackingMode);
  const setCameraError = useAppStore((state) => state.setCameraError);
  const setView = useAppStore((state) => state.setView);
  const updateSettings = useAppStore((state) => state.updateSettings);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [cameraAccessStatus, setCameraAccessStatus] =
    useState<CameraAccessStatus>("unknown");
  const [cameraFailureCode, setCameraFailureCode] =
    useState<CameraFailureCode | null>(null);
  const [workerReady, setWorkerReady] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostics>({
    targetFps: 5,
    measuredFps: 0,
    inferenceMedianMs: null,
    inferenceP95Ms: null,
    dropRate: 0,
    workerRestarts: 0,
    cameraOwner: "none",
    featureReliability: null,
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameCanvasRef = useRef<OffscreenCanvas | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const workerDeferredRef = useRef<WorkerDeferred | null>(null);
  const workerReadyRef = useRef(false);
  const workerRestartCountRef = useRef(0);
  const workerStableSinceRef = useRef<number | null>(null);
  const restartInProgressRef = useRef<Promise<void> | null>(null);
  const restartWorkerRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const requestIdRef = useRef(0);
  const initializeRequestIdRef = useRef<number | null>(null);
  const inFlightRequestIdRef = useRef<number | null>(null);
  const samplerTimerRef = useRef<number | null>(null);
  const watchdogTimerRef = useRef<number | null>(null);
  const frameBusyRef = useRef(false);
  const frameFailureCountRef = useRef(0);
  const droppedFrameTimesRef = useRef<number[]>([]);
  const resultTimesRef = useRef<number[]>([]);
  const latencyEwmaRef = useRef<number | null>(null);
  const inferenceSamplesRef = useRef<Array<{ at: number; value: number }>>([]);
  const adaptiveSamplingRef = useRef(
    new AdaptiveSamplingController(performance.now()),
  );
  const cameraOwnerRef = useRef<CameraOwner>("none");
  const muteTimerRef = useRef<number | null>(null);
  const classifierRef = useRef(new PostureClassifier());
  const calibrationSamplesRef = useRef<PostureFeatures[]>([]);
  const calibrationRejectedFramesRef = useRef(0);
  const calibrationStartedRef = useRef(0);
  const lastReportRef = useRef(0);
  const modeRef = useRef<TrackingMode>("stopped");
  const powerStateRef = useRef<PowerState>({
    onBattery: false,
    updatedAt: 0,
  });
  const finishCalibrationRef = useRef<() => Promise<void>>(() =>
    Promise.resolve(),
  );
  const startTrackingRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const pauseTrackingRef = useRef<() => void>(() => undefined);
  const beginCalibrationRef = useRef<() => Promise<void>>(() =>
    Promise.resolve(),
  );
  const cancelCalibrationRef = useRef<() => void>(() => undefined);
  const recoverCameraRef = useRef<
    (cameraId: string, mode: "tracking" | "calibrating") => Promise<void>
  >(() => Promise.resolve());
  const activeCalibrationRef = useRef<Calibration | null>(null);

  const reportMode = useCallback(
    (
      mode: TrackingMode,
      cameraId: string | null = streamRef.current
        ?.getVideoTracks()[0]
        ?.getSettings().deviceId ?? null,
      calibrationId: string | null = activeCalibrationRef.current?.id ?? null,
      errorCode: string | null = null,
    ) => {
      modeRef.current = mode;
      setTrackingMode(mode);
      window.upright.tracking.reportRuntimeState({
        schemaVersion: 1,
        mode,
        cameraId,
        calibrationId,
        errorCode,
      });
    },
    [setTrackingMode],
  );

  const refreshDevices = useCallback(
    async (activeStream?: MediaStream | null) => {
      const all = await navigator.mediaDevices.enumerateDevices();
      const cameras = normalizeCameraDevices(all, activeStream);
      setDevices(cameras);
      return cameras;
    },
    [],
  );

  const clearWatchdog = useCallback(() => {
    if (watchdogTimerRef.current !== null)
      window.clearTimeout(watchdogTimerRef.current);
    watchdogTimerRef.current = null;
  }, []);

  const stopSampler = useCallback(() => {
    if (samplerTimerRef.current !== null)
      window.clearTimeout(samplerTimerRef.current);
    samplerTimerRef.current = null;
    clearWatchdog();
    frameBusyRef.current = false;
  }, [clearWatchdog]);

  const stopCameraTracks = useCallback(() => {
    stopSampler();
    if (muteTimerRef.current !== null)
      window.clearTimeout(muteTimerRef.current);
    muteTimerRef.current = null;
    const current = streamRef.current;
    streamRef.current = null;
    current?.getTracks().forEach((track) => track.stop());
    setStream(null);
    if (videoRef.current) videoRef.current.srcObject = null;
    videoRef.current = null;
    cameraOwnerRef.current = "none";
    setDiagnostics((current) => ({ ...current, cameraOwner: "none" }));
  }, [stopSampler]);

  const disposeWorker = useCallback(async (): Promise<void> => {
    const worker = workerRef.current;
    if (!worker) return;
    workerRef.current = null;
    workerReadyRef.current = false;
    workerDeferredRef.current = null;
    inFlightRequestIdRef.current = null;
    setWorkerReady(false);
    clearWatchdog();
    const request: PoseWorkerRequest = {
      protocolVersion: POSE_WORKER_PROTOCOL_VERSION,
      requestId: ++requestIdRef.current,
      type: "dispose",
    };
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        worker.removeEventListener("message", onDisposed);
        worker.terminate();
        resolve();
      };
      const onDisposed = (event: MessageEvent<unknown>): void => {
        try {
          const response = parsePoseWorkerResponse(event.data);
          if (
            response.type === "disposed" &&
            response.requestId === request.requestId
          )
            finish();
        } catch {
          // An invalid acknowledgement is ignored until the bounded timeout.
        }
      };
      const timeout = window.setTimeout(finish, 750);
      worker.addEventListener("message", onDisposed);
      try {
        worker.postMessage(request);
      } catch {
        finish();
      }
    });
  }, [clearWatchdog]);

  const stopCamera = useCallback(() => {
    stopCameraTracks();
    void disposeWorker();
  }, [disposeWorker, stopCameraTracks]);

  const closePreview = useCallback(() => {
    if (modeRef.current !== "preview" && modeRef.current !== "calibrating")
      return;
    reportMode("stopped", null, null);
    setCalibrating(false);
    setCalibrationProgress(0);
    calibrationSamplesRef.current = [];
    calibrationRejectedFramesRef.current = 0;
    stopCamera();
  }, [reportMode, stopCamera]);

  const measuredFps = useCallback((now: number): number => {
    resultTimesRef.current.push(now);
    resultTimesRef.current = resultTimesRef.current.filter(
      (timestamp) => now - timestamp <= 10_000,
    );
    if (resultTimesRef.current.length < 2) return 0;
    const duration = now - resultTimesRef.current[0];
    return duration <= 0
      ? 0
      : Math.round(
          ((resultTimesRef.current.length - 1) / duration) * 1_000 * 10,
        ) / 10;
  }, []);

  const rollingDropRate = useCallback((now: number): number => {
    resultTimesRef.current = resultTimesRef.current.filter(
      (timestamp) => now - timestamp <= 10_000,
    );
    droppedFrameTimesRef.current = droppedFrameTimesRef.current.filter(
      (timestamp) => now - timestamp <= 10_000,
    );
    const attemptedFrames =
      droppedFrameTimesRef.current.length + resultTimesRef.current.length;
    return attemptedFrames === 0
      ? 0
      : droppedFrameTimesRef.current.length / attemptedFrames;
  }, []);

  const handleWorkerResult = useCallback(
    (message: Extract<PoseWorkerResponse, { type: "result" }>) => {
      frameBusyRef.current = false;
      inFlightRequestIdRef.current = null;
      clearWatchdog();
      frameFailureCountRef.current = 0;
      latencyEwmaRef.current =
        latencyEwmaRef.current === null
          ? message.inferenceMs
          : latencyEwmaRef.current * 0.8 + message.inferenceMs * 0.2;
      const sampledFps = measuredFps(message.timestamp);
      const featureResult = message.landmarks
        ? extractPostureFeaturesDetailed(message.landmarks)
        : ({ ok: false, reason: "missing-head" } as const);
      const features = featureResult.ok ? featureResult.features : null;
      const now = performance.now();
      workerStableSinceRef.current ??= now;
      if (now - workerStableSinceRef.current >= 60_000)
        workerRestartCountRef.current = 0;
      inferenceSamplesRef.current.push({ at: now, value: message.inferenceMs });
      inferenceSamplesRef.current = inferenceSamplesRef.current.filter(
        (sample) => now - sample.at <= 10_000,
      );
      const latencyValues = inferenceSamplesRef.current.map(
        (sample) => sample.value,
      );
      setDiagnostics({
        targetFps: adaptiveSamplingRef.current.current,
        measuredFps: sampledFps,
        inferenceMedianMs: percentile(latencyValues, 0.5),
        inferenceP95Ms: percentile(latencyValues, 0.95),
        dropRate: rollingDropRate(now),
        workerRestarts: workerRestartCountRef.current,
        cameraOwner: cameraOwnerRef.current,
        featureReliability: featureResult.ok ? featureResult.reliability : null,
      });

      if (modeRef.current === "calibrating") {
        if (features) calibrationSamplesRef.current.push(features);
        else calibrationRejectedFramesRef.current += 1;
        const elapsed = performance.now() - calibrationStartedRef.current;
        setCalibrationProgress(
          Math.min(100, Math.round((elapsed / 10_000) * 100)),
        );
        if (elapsed >= 10_000) void finishCalibrationRef.current();
        return;
      }

      if (modeRef.current !== "tracking" || !activeCalibrationRef.current)
        return;
      const snapshot = classifierRef.current.update(
        features,
        activeCalibrationRef.current,
        useAppStore.getState().settings,
        message.inferenceMs,
        sampledFps,
        message.timestamp,
      );
      setSnapshot(snapshot);
      if (message.timestamp - lastReportRef.current >= 750) {
        lastReportRef.current = message.timestamp;
        reportSnapshotToMain(snapshot);
      }
    },
    [clearWatchdog, measuredFps, rollingDropRate, setSnapshot],
  );

  const initializeWorker = useCallback(async (): Promise<void> => {
    if (workerReadyRef.current) return;
    if (workerDeferredRef.current) return workerDeferredRef.current.promise;

    const deferred = createDeferred();
    workerDeferredRef.current = deferred;
    const worker = new Worker(
      new URL("../workers/pose.worker.ts", import.meta.url),
    );
    workerRef.current = worker;
    worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      let message: PoseWorkerResponse;
      try {
        message = parsePoseWorkerResponse(event.data);
      } catch {
        clearWatchdog();
        initializeRequestIdRef.current = null;
        inFlightRequestIdRef.current = null;
        frameBusyRef.current = false;
        setCameraError("The pose worker returned an invalid response.");
        void restartWorkerRef.current();
        return;
      }
      if (message.type === "ready") {
        if (message.requestId !== initializeRequestIdRef.current) return;
        initializeRequestIdRef.current = null;
        workerReadyRef.current = true;
        setWorkerReady(true);
        workerDeferredRef.current?.resolve();
        workerDeferredRef.current = null;
        return;
      }
      if (message.type === "fatal-error") {
        if (
          message.requestId !== initializeRequestIdRef.current &&
          message.requestId !== inFlightRequestIdRef.current
        )
          return;
        initializeRequestIdRef.current = null;
        inFlightRequestIdRef.current = null;
        frameBusyRef.current = false;
        workerDeferredRef.current?.reject(new Error(message.message));
        workerDeferredRef.current = null;
        workerReadyRef.current = false;
        if (workerRef.current === worker) workerRef.current = null;
        worker.terminate();
        setWorkerReady(false);
        setCameraError(message.message);
        return;
      }
      if (message.type === "recoverable-error") {
        if (message.requestId !== inFlightRequestIdRef.current) return;
        inFlightRequestIdRef.current = null;
        frameBusyRef.current = false;
        clearWatchdog();
        frameFailureCountRef.current += 1;
        if (frameFailureCountRef.current >= 3) {
          setCameraError(
            "Pose inference stopped responding. Upright will restart it.",
          );
          void restartWorkerRef.current();
        }
        return;
      }
      if (message.type === "result") {
        if (message.requestId !== inFlightRequestIdRef.current) return;
        handleWorkerResult(message);
      }
    });
    worker.addEventListener("error", (event) => {
      clearWatchdog();
      initializeRequestIdRef.current = null;
      inFlightRequestIdRef.current = null;
      frameBusyRef.current = false;
      workerReadyRef.current = false;
      if (workerRef.current === worker) workerRef.current = null;
      worker.terminate();
      setWorkerReady(false);
      const error = new Error(event.message || "The pose worker crashed.");
      workerDeferredRef.current?.reject(error);
      workerDeferredRef.current = null;
      setCameraError(error.message);
      if (modeRef.current === "tracking" || modeRef.current === "calibrating")
        void restartWorkerRef.current();
    });

    const requestId = ++requestIdRef.current;
    initializeRequestIdRef.current = requestId;
    workerStableSinceRef.current = null;
    const request: PoseWorkerRequest = {
      protocolVersion: POSE_WORKER_PROTOCOL_VERSION,
      requestId,
      type: "initialize",
      ...(__UPRIGHT_E2E_FIXTURE__ &&
      new URLSearchParams(window.location.search).get("fixture") ===
        "deterministic"
        ? { fixture: "deterministic" as const }
        : {}),
    };
    worker.postMessage(request);
    return deferred.promise;
  }, [clearWatchdog, handleWorkerResult, setCameraError]);

  const targetFps = useCallback((): 3 | 5 | 8 => {
    const now = performance.now();
    return adaptiveSamplingRef.current.next(
      {
        onBattery: powerStateRef.current.onBattery,
        reduceOnBattery: settings.reduceOnBattery,
        latencyEwmaMs: latencyEwmaRef.current,
        dropRate: rollingDropRate(now),
      },
      now,
    );
  }, [rollingDropRate, settings.reduceOnBattery]);

  const restartWorker = useCallback(async () => {
    if (restartInProgressRef.current) return restartInProgressRef.current;
    const restart = async (): Promise<void> => {
      if (workerRestartCountRef.current >= 3) {
        reportMode("error", undefined, undefined, "worker-restart-limit");
        setCameraError(
          "Pose tracking could not recover. Pause tracking, then try again.",
        );
        stopSampler();
        return;
      }
      workerRestartCountRef.current += 1;
      workerStableSinceRef.current = null;
      setDiagnostics((current) => ({
        ...current,
        workerRestarts: workerRestartCountRef.current,
      }));
      clearWatchdog();
      inFlightRequestIdRef.current = null;
      frameBusyRef.current = false;
      await disposeWorker();
      try {
        await initializeWorker();
      } catch {
        return;
      }
    };
    const pending = restart().finally(() => {
      if (restartInProgressRef.current === pending)
        restartInProgressRef.current = null;
    });
    restartInProgressRef.current = pending;
    return pending;
  }, [
    clearWatchdog,
    disposeWorker,
    initializeWorker,
    reportMode,
    setCameraError,
    stopSampler,
  ]);

  useEffect(() => {
    restartWorkerRef.current = restartWorker;
  }, [restartWorker]);

  const sampleFrameRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const scheduleSample = useCallback(() => {
    if (samplerTimerRef.current !== null)
      window.clearTimeout(samplerTimerRef.current);
    if (modeRef.current !== "tracking" && modeRef.current !== "calibrating")
      return;
    samplerTimerRef.current = window.setTimeout(
      () => void sampleFrameRef.current(),
      Math.round(1_000 / targetFps()),
    );
  }, [targetFps]);

  const sampleFrame = useCallback(async () => {
    let bitmap: ImageBitmap | null = null;
    let transferred = false;
    try {
      if (
        !workerReadyRef.current ||
        !videoRef.current ||
        videoRef.current.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
      )
        return;
      if (frameBusyRef.current) {
        droppedFrameTimesRef.current.push(performance.now());
        return;
      }
      frameBusyRef.current = true;
      const video = videoRef.current;
      if (navigator.userAgent.includes("Linux")) {
        const canvas = frameCanvasRef.current ?? new OffscreenCanvas(640, 480);
        frameCanvasRef.current = canvas;
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context)
          throw new Error("A camera frame canvas could not be created.");
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        bitmap = canvas.transferToImageBitmap();
      } else {
        bitmap = await createImageBitmap(video);
      }
      const worker = workerRef.current;
      if (!worker) {
        frameBusyRef.current = false;
        return;
      }
      const requestId = ++requestIdRef.current;
      const request: PoseWorkerRequest = {
        protocolVersion: POSE_WORKER_PROTOCOL_VERSION,
        requestId,
        type: "frame",
        bitmap,
        timestamp: performance.now(),
      };
      worker.postMessage(request, [bitmap]);
      transferred = true;
      inFlightRequestIdRef.current = requestId;
      clearWatchdog();
      watchdogTimerRef.current = window.setTimeout(() => {
        frameBusyRef.current = false;
        void restartWorker();
      }, 2_500);
    } catch (error) {
      frameBusyRef.current = false;
      frameFailureCountRef.current += 1;
      if (frameFailureCountRef.current >= 3)
        setCameraError(
          `Camera frames could not be sampled: ${
            error instanceof Error ? error.message : "unknown frame error"
          }`,
        );
    } finally {
      if (bitmap && !transferred) bitmap.close();
      scheduleSample();
    }
  }, [clearWatchdog, restartWorker, scheduleSample, setCameraError]);

  useEffect(() => {
    sampleFrameRef.current = sampleFrame;
  }, [sampleFrame]);

  const startSampler = useCallback(() => {
    stopSampler();
    droppedFrameTimesRef.current = [];
    resultTimesRef.current = [];
    inferenceSamplesRef.current = [];
    latencyEwmaRef.current = null;
    adaptiveSamplingRef.current.reset(performance.now());
    scheduleSample();
  }, [scheduleSample, stopSampler]);

  const attachTrackRecovery = useCallback(
    (media: MediaStream) => {
      const track = media.getVideoTracks()[0];
      const cameraId = track?.getSettings().deviceId;
      if (!track || !cameraId) return;
      track.addEventListener("ended", () => {
        if (streamRef.current !== media) return;
        if (modeRef.current === "calibrating") {
          cancelCalibrationRef.current();
          setCameraError(
            "Calibration was cancelled because the camera disconnected.",
          );
        } else if (modeRef.current === "tracking")
          void recoverCameraRef.current(cameraId, "tracking");
        else {
          reportMode("error", cameraId, null, "camera-disconnected");
          setCameraError("The selected camera was disconnected.");
          stopCameraTracks();
        }
      });
      track.addEventListener("mute", () => {
        if (streamRef.current !== media) return;
        if (modeRef.current === "calibrating") {
          cancelCalibrationRef.current();
          setCameraError(
            "Calibration was cancelled because the camera signal stopped.",
          );
          return;
        }
        if (modeRef.current === "tracking") {
          stopSampler();
          reportMode(
            "recovering",
            cameraId,
            activeCalibrationRef.current?.id ?? null,
            "camera-muted",
          );
          if (muteTimerRef.current !== null)
            window.clearTimeout(muteTimerRef.current);
          muteTimerRef.current = window.setTimeout(() => {
            muteTimerRef.current = null;
            if (streamRef.current === media && modeRef.current === "recovering")
              void recoverCameraRef.current(cameraId, "tracking");
          }, 1_500);
        }
      });
      track.addEventListener("unmute", () => {
        if (streamRef.current !== media || modeRef.current !== "recovering")
          return;
        if (muteTimerRef.current !== null)
          window.clearTimeout(muteTimerRef.current);
        muteTimerRef.current = null;
        reportMode(
          "tracking",
          cameraId,
          activeCalibrationRef.current?.id ?? null,
        );
        startSampler();
      });
    },
    [reportMode, setCameraError, startSampler, stopCameraTracks, stopSampler],
  );

  const openCamera = useCallback(
    async (
      cameraId?: string | null,
      allowFallback = false,
      desiredMode: "preview" | "tracking" | "calibrating" = "preview",
      recovering = false,
      previewOwner: Extract<
        CameraOwner,
        "onboarding-preview" | "diagnostics-preview"
      > = useAppStore.getState().settings.onboardingComplete
        ? "diagnostics-preview"
        : "onboarding-preview",
    ) => {
      stopCameraTracks();
      setCameraError(null);
      setCameraFailureCode(null);
      if (!recovering)
        reportMode("requesting-permission", cameraId ?? null, null);
      let media: MediaStream | null = null;
      let workerInitialized = false;
      let failureOverride: CameraFailureCode | null = null;
      let requestedAccessStatus: CameraAccessStatus = "unknown";
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new DOMException(
            "This system does not expose camera access to Upright.",
            "NotSupportedError",
          );
        }
        const accessStatus = await window.upright.camera.requestAccess();
        requestedAccessStatus = accessStatus;
        setCameraAccessStatus(accessStatus);
        if (accessStatus !== "granted") {
          const message =
            accessStatus === "denied" || accessStatus === "restricted"
              ? "Camera access is off. Allow Upright in your system privacy settings, then try again."
              : "Camera access was not granted. Allow camera access to continue.";
          throw new DOMException(message, "NotAllowedError");
        }
        const workerPromise = initializeWorker();
        const mediaPromise = navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            deviceId: cameraId ? { exact: cameraId } : undefined,
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30, max: 30 },
          },
        });
        const [workerResult, mediaResult] = await Promise.allSettled([
          workerPromise,
          mediaPromise,
        ]);
        if (mediaResult.status === "fulfilled") media = mediaResult.value;
        if (workerResult.status === "fulfilled") workerInitialized = true;
        if (workerResult.status === "rejected") {
          failureOverride = "worker-init-failed";
          throw workerResult.reason;
        }
        if (mediaResult.status === "rejected") throw mediaResult.reason;
        const openedMedia = media;
        if (!openedMedia)
          throw new DOMException(
            "No camera stream was created.",
            "NotFoundError",
          );
        media = openedMedia;
        const video = document.createElement("video");
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        video.srcObject = openedMedia;
        failureOverride = "playback-failed";
        await video.play();
        failureOverride = null;
        const activeTrackSettings = openedMedia
          .getVideoTracks()[0]
          ?.getSettings();
        if (
          desiredMode === "tracking" &&
          activeCalibrationRef.current &&
          !isCalibrationCompatible(activeCalibrationRef.current, {
            width: activeTrackSettings?.width ?? 640,
            height: activeTrackSettings?.height ?? 480,
          })
        ) {
          throw new DOMException(
            "This camera framing changed. Recalibrate before tracking.",
            "InvalidStateError",
          );
        }
        videoRef.current = video;
        streamRef.current = openedMedia;
        setStream(openedMedia);
        attachTrackRecovery(openedMedia);
        const cameras = await refreshDevices(openedMedia);
        const activeId =
          openedMedia.getVideoTracks()[0]?.getSettings().deviceId ??
          cameras[0]?.deviceId ??
          null;
        if (
          activeId &&
          activeId !== useAppStore.getState().settings.selectedCameraId
        )
          await updateSettings({ selectedCameraId: activeId });
        setCameraAccessStatus("granted");
        setCameraFailureCode(null);
        cameraOwnerRef.current =
          desiredMode === "tracking"
            ? "tracking"
            : desiredMode === "calibrating"
              ? "calibration"
              : previewOwner;
        setDiagnostics((current) => ({
          ...current,
          cameraOwner: cameraOwnerRef.current,
        }));
        reportMode(
          desiredMode,
          activeId,
          desiredMode === "tracking"
            ? (activeCalibrationRef.current?.id ?? null)
            : null,
        );
        if (desiredMode === "calibrating")
          calibrationStartedRef.current = performance.now();
        if (desiredMode === "tracking" || desiredMode === "calibrating")
          startSampler();
        return activeId;
      } catch (error) {
        media?.getTracks().forEach((track) => track.stop());
        if (videoRef.current?.srcObject === media)
          videoRef.current.srcObject = null;
        if (streamRef.current === media) streamRef.current = null;
        setStream((current) => (current === media ? null : current));
        if (workerInitialized) await disposeWorker();
        stopSampler();
        if (
          allowFallback &&
          cameraId &&
          error instanceof DOMException &&
          (error.name === "OverconstrainedError" ||
            error.name === "NotFoundError")
        ) {
          await updateSettings({ selectedCameraId: null });
          return openCamera(null, false, desiredMode, recovering, previewOwner);
        }
        if (error instanceof DOMException && error.name === "NotAllowedError")
          setCameraAccessStatus(
            requestedAccessStatus === "restricted" ? "restricted" : "denied",
          );
        const message =
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "Camera access is off. Allow Upright in your system privacy settings, then try again."
            : error instanceof DOMException && error.name === "NotReadableError"
              ? "The camera is already in use by another application."
              : error instanceof DOMException && error.name === "NotFoundError"
                ? "No camera was found. Connect a camera and try again."
                : error instanceof DOMException &&
                    error.name === "InvalidStateError"
                  ? error.message
                  : "Upright could not open this camera. Check the connection and try again.";
        const failureCode: CameraFailureCode =
          failureOverride ??
          (error instanceof DOMException && error.name === "NotAllowedError"
            ? requestedAccessStatus === "restricted"
              ? "permission-restricted"
              : "permission-denied"
            : error instanceof DOMException && error.name === "NotReadableError"
              ? "device-busy"
              : error instanceof DOMException && error.name === "NotFoundError"
                ? "no-device"
                : error instanceof DOMException &&
                    error.name === "NotSupportedError"
                  ? "unsupported"
                  : "unknown");
        setCameraFailureCode(failureCode);
        setCameraError(message);
        if (!recovering)
          reportMode(
            "error",
            cameraId ?? null,
            activeCalibrationRef.current?.id ?? null,
            failureCode,
          );
        throw error;
      }
    },
    [
      attachTrackRecovery,
      disposeWorker,
      initializeWorker,
      refreshDevices,
      reportMode,
      setCameraError,
      startSampler,
      stopCameraTracks,
      stopSampler,
      updateSettings,
    ],
  );

  const recoverCamera = useCallback(
    async (cameraId: string, previousMode: "tracking" | "calibrating") => {
      reportMode(
        "recovering",
        cameraId,
        activeCalibrationRef.current?.id ?? null,
        "camera-disconnected",
      );
      stopCameraTracks();
      for (const delay of [500, 1_500, 3_000]) {
        await wait(delay);
        if (modeRef.current !== "recovering") return;
        try {
          await openCamera(cameraId, false, previousMode, true);
          setCameraError(null);
          return;
        } catch {
          // Bounded retries continue below.
        }
      }
      reportMode(
        "error",
        cameraId,
        activeCalibrationRef.current?.id ?? null,
        "camera-recovery-failed",
      );
      setCameraError(
        "The selected camera is unavailable. Choose another camera and recalibrate.",
      );
    },
    [openCamera, reportMode, setCameraError, stopCameraTracks],
  );

  useEffect(() => {
    recoverCameraRef.current = recoverCamera;
  }, [recoverCamera]);

  const startTracking = useCallback(async () => {
    const cameraId = useAppStore.getState().settings.selectedCameraId;
    const calibration = calibrations.find(
      (entry): entry is Calibration =>
        entry.schemaVersion === 2 &&
        entry.compatibility === "compatible" &&
        entry.cameraId === cameraId,
    );
    if (!calibration) {
      setCalibrationError("Calibrate this camera before starting a session.");
      reportMode("error", cameraId, null, "calibration-required");
      return;
    }
    activeCalibrationRef.current = calibration;
    classifierRef.current = new PostureClassifier();
    workerRestartCountRef.current = 0;
    if (!streamRef.current?.active) {
      await openCamera(calibration.cameraId, false, "tracking");
      return;
    }
    const activeSettings = streamRef.current.getVideoTracks()[0]?.getSettings();
    if (
      !isCalibrationCompatible(calibration, {
        width: activeSettings?.width ?? 640,
        height: activeSettings?.height ?? 480,
      })
    ) {
      setCalibrationError(
        "Camera orientation or framing changed. Recalibrate before tracking.",
      );
      reportMode(
        "error",
        calibration.cameraId,
        calibration.id,
        "calibration-incompatible",
      );
      stopCamera();
      return;
    }
    await initializeWorker();
    cameraOwnerRef.current = "tracking";
    setDiagnostics((current) => ({ ...current, cameraOwner: "tracking" }));
    reportMode("tracking", calibration.cameraId, calibration.id);
    startSampler();
  }, [
    calibrations,
    initializeWorker,
    openCamera,
    reportMode,
    startSampler,
    stopCamera,
  ]);

  const pauseTracking = useCallback(() => {
    reportMode("paused", null, activeCalibrationRef.current?.id ?? null);
    stopCamera();
    const snapshot = classifierRef.current.paused();
    setSnapshot(snapshot);
    reportSnapshotToMain(snapshot);
  }, [reportMode, setSnapshot, stopCamera]);

  const cancelCalibration = useCallback(() => {
    if (modeRef.current !== "calibrating") return;
    stopSampler();
    setCalibrating(false);
    setCalibrationProgress(0);
    calibrationSamplesRef.current = [];
    calibrationRejectedFramesRef.current = 0;
    setCalibrationError(null);
    const cameraId =
      streamRef.current?.getVideoTracks()[0]?.getSettings().deviceId ?? null;
    reportMode("stopped", cameraId, null, "calibration-cancelled");
    stopCamera();
  }, [reportMode, stopCamera, stopSampler]);

  useEffect(() => {
    cancelCalibrationRef.current = cancelCalibration;
  }, [cancelCalibration]);

  const beginCalibration = useCallback(async () => {
    setCalibrationError(null);
    setCalibrationProgress(0);
    workerRestartCountRef.current = 0;
    calibrationSamplesRef.current = [];
    calibrationRejectedFramesRef.current = 0;
    setCalibrating(true);
    try {
      if (!streamRef.current?.active) {
        const cameraId = await openCamera(
          useAppStore.getState().settings.selectedCameraId,
          false,
          "calibrating",
        );
        if (!cameraId) throw new Error("No camera was found.");
      } else {
        await initializeWorker();
        cameraOwnerRef.current = "calibration";
        setDiagnostics((current) => ({
          ...current,
          cameraOwner: "calibration",
        }));
        reportMode(
          "calibrating",
          streamRef.current.getVideoTracks()[0]?.getSettings().deviceId ?? null,
          null,
        );
        calibrationStartedRef.current = performance.now();
        startSampler();
      }
    } catch (error) {
      setCalibrating(false);
      throw error;
    }
  }, [initializeWorker, openCamera, reportMode, startSampler]);

  const finishCalibration = useCallback(async () => {
    if (modeRef.current !== "calibrating") return;
    stopSampler();
    setCalibrating(false);
    try {
      const track = streamRef.current?.getVideoTracks()[0];
      const trackSettings = track?.getSettings();
      const cameraId =
        trackSettings?.deviceId ??
        useAppStore.getState().settings.selectedCameraId;
      if (!cameraId) throw new Error("No camera is selected.");
      const calibration = buildCalibration(
        calibrationSamplesRef.current,
        cameraId,
        {
          width: trackSettings?.width ?? 640,
          height: trackSettings?.height ?? 480,
        },
        "pose-landmarker-lite-0.10.35",
        {
          elapsedMs: performance.now() - calibrationStartedRef.current,
          rejectedFrameCount: calibrationRejectedFramesRef.current,
        },
      );
      const next = await window.upright.calibrations.save(calibration);
      setCalibrations(next);
      activeCalibrationRef.current = calibration;
      setCalibrationProgress(100);
      cameraOwnerRef.current = useAppStore.getState().settings
        .onboardingComplete
        ? "diagnostics-preview"
        : "onboarding-preview";
      setDiagnostics((current) => ({
        ...current,
        cameraOwner: cameraOwnerRef.current,
      }));
      reportMode("preview", cameraId, calibration.id);
    } catch (error) {
      setCalibrationError(
        error instanceof Error
          ? error.message
          : "Calibration was not stable enough.",
      );
      setCalibrationProgress(0);
      reportMode(
        "preview",
        streamRef.current?.getVideoTracks()[0]?.getSettings().deviceId ?? null,
        null,
      );
    }
  }, [reportMode, setCalibrations, stopSampler]);

  useEffect(() => {
    finishCalibrationRef.current = finishCalibration;
  }, [finishCalibration]);

  const selectCamera = useCallback(
    async (cameraId: string) => {
      await updateSettings({ selectedCameraId: cameraId });
      activeCalibrationRef.current = null;
      if (streamRef.current?.active) await openCamera(cameraId, false);
    },
    [openCamera, updateSettings],
  );

  useEffect(() => {
    startTrackingRef.current = startTracking;
    pauseTrackingRef.current = pauseTracking;
    beginCalibrationRef.current = beginCalibration;
  }, [beginCalibration, pauseTracking, startTracking]);

  useEffect(() => {
    let disposed = false;
    reportMode("stopped", null, null);
    void window.upright.app.getPowerState().then((state) => {
      if (!disposed) powerStateRef.current = state;
    });
    const unsubscribePower = window.upright.app.onPowerStateChanged((state) => {
      powerStateRef.current = state;
    });
    const unsubscribeCommand = window.upright.tracking.onCommand(
      (command: TrackingCommand) => {
        if (command.type === "start" || command.type === "resume")
          void startTrackingRef.current().catch(() => undefined);
        if (command.type === "pause" || command.type === "stop") {
          if (modeRef.current === "calibrating") cancelCalibration();
          else pauseTrackingRef.current();
        }
        if (command.type === "cancel-calibration") cancelCalibration();
        if (command.type === "window-hidden") {
          if (modeRef.current !== "tracking" && modeRef.current !== "paused")
            closePreview();
        }
        if (command.type === "recalibrate") {
          setView("diagnostics");
          void beginCalibrationRef.current().catch(() => undefined);
        }
        if (command.type === "open-settings") {
          closePreview();
          setView("settings");
        }
      },
    );
    const onDeviceChange = (): void => {
      void (async () => {
        const current = streamRef.current;
        const all = await navigator.mediaDevices.enumerateDevices();
        setDevices(normalizeCameraDevices(all, current));
        if (!current) return;
        const cameraId = current.getVideoTracks()[0]?.getSettings().deviceId;
        if (
          !cameraId ||
          all.some(
            (device) =>
              device.kind === "videoinput" && device.deviceId === cameraId,
          )
        )
          return;
        setCameraFailureCode("device-disconnected");
        if (modeRef.current === "calibrating") {
          cancelCalibrationRef.current();
          setCameraError(
            "Calibration was cancelled because the camera disconnected.",
          );
        } else if (modeRef.current === "tracking") {
          await recoverCameraRef.current(cameraId, "tracking");
        } else {
          reportMode("error", cameraId, null, "device-disconnected");
          setCameraError("The selected camera was disconnected.");
          stopCameraTracks();
        }
      })().catch(() => {
        setCameraError("Upright could not refresh the camera list.");
      });
    };
    navigator.mediaDevices?.addEventListener("devicechange", onDeviceChange);
    const onVisibilityChange = (): void => {
      if (document.hidden) closePreview();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      disposed = true;
      unsubscribePower();
      unsubscribeCommand();
      navigator.mediaDevices?.removeEventListener(
        "devicechange",
        onDeviceChange,
      );
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reportMode("stopped", null, null);
      stopCamera();
    };
  }, [
    cancelCalibration,
    closePreview,
    reportMode,
    setCameraError,
    setView,
    stopCamera,
    stopCameraTracks,
  ]);

  const openSystemPrivacySettings = useCallback(async () => {
    try {
      await window.upright.camera.openSystemPrivacySettings();
    } catch {
      setCameraError(
        "Upright could not open camera settings. Open your system privacy settings manually.",
      );
    }
  }, [setCameraError]);

  return {
    stream,
    devices,
    cameraAccessStatus,
    cameraFailureCode,
    workerReady,
    calibrating,
    calibrationProgress,
    calibrationError,
    diagnostics,
    openCamera,
    stopCamera,
    closePreview,
    cancelCalibration,
    openSystemPrivacySettings,
    startTracking,
    pauseTracking,
    beginCalibration,
    selectCamera,
    refreshDevices,
  };
}
