import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Calibration,
  CameraAccessStatus,
  PostureFeatures,
  PowerState,
  TrackingSnapshot,
  TrackingCommand,
  TrackingMode,
} from "../../../shared/contracts";
import {
  buildCalibration,
  extractPostureFeatures,
  PostureClassifier,
} from "../../../shared/posture-engine";
import {
  POSE_WORKER_PROTOCOL_VERSION,
  type PoseWorkerRequest,
  type PoseWorkerResponse,
} from "../../../shared/worker-protocol";
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

const reportSnapshotToMain = (snapshot: TrackingSnapshot): void => {
  window.posture.tracking.reportSnapshot({
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
  const [workerReady, setWorkerReady] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const [calibrating, setCalibrating] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameCanvasRef = useRef<OffscreenCanvas | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const workerDeferredRef = useRef<WorkerDeferred | null>(null);
  const workerReadyRef = useRef(false);
  const workerRestartCountRef = useRef(0);
  const requestIdRef = useRef(0);
  const samplerTimerRef = useRef<number | null>(null);
  const watchdogTimerRef = useRef<number | null>(null);
  const frameBusyRef = useRef(false);
  const frameFailureCountRef = useRef(0);
  const droppedFrameTimesRef = useRef<number[]>([]);
  const resultTimesRef = useRef<number[]>([]);
  const latencyEwmaRef = useRef<number | null>(null);
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
      window.posture.tracking.reportRuntimeState({
        schemaVersion: 1,
        mode,
        cameraId,
        calibrationId,
        errorCode,
        updatedAt: Date.now(),
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
    const current = streamRef.current;
    streamRef.current = null;
    current?.getTracks().forEach((track) => track.stop());
    setStream(null);
    if (videoRef.current) videoRef.current.srcObject = null;
    videoRef.current = null;
  }, [stopSampler]);

  const disposeWorker = useCallback(() => {
    const worker = workerRef.current;
    if (!worker) return;
    const request: PoseWorkerRequest = {
      protocolVersion: POSE_WORKER_PROTOCOL_VERSION,
      requestId: ++requestIdRef.current,
      type: "dispose",
    };
    worker.postMessage(request);
    worker.terminate();
    workerRef.current = null;
    workerReadyRef.current = false;
    workerDeferredRef.current = null;
    setWorkerReady(false);
    clearWatchdog();
  }, [clearWatchdog]);

  const stopCamera = useCallback(() => {
    stopCameraTracks();
    disposeWorker();
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
      clearWatchdog();
      frameFailureCountRef.current = 0;
      latencyEwmaRef.current =
        latencyEwmaRef.current === null
          ? message.inferenceMs
          : latencyEwmaRef.current * 0.8 + message.inferenceMs * 0.2;
      const sampledFps = measuredFps(message.timestamp);
      const features = message.landmarks
        ? extractPostureFeatures(message.landmarks)
        : null;

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
    [clearWatchdog, measuredFps, setSnapshot],
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
    worker.addEventListener(
      "message",
      (event: MessageEvent<PoseWorkerResponse>) => {
        const message = event.data;
        if (message.protocolVersion !== POSE_WORKER_PROTOCOL_VERSION) return;
        if (message.type === "ready") {
          workerReadyRef.current = true;
          setWorkerReady(true);
          workerDeferredRef.current?.resolve();
          workerDeferredRef.current = null;
          return;
        }
        if (message.type === "fatal-error") {
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
          frameBusyRef.current = false;
          clearWatchdog();
          frameFailureCountRef.current += 1;
          if (frameFailureCountRef.current >= 3)
            setCameraError(
              "Pose inference stopped responding. Posture will restart it.",
            );
          return;
        }
        if (message.type === "result") handleWorkerResult(message);
      },
    );
    worker.addEventListener("error", (event) => {
      frameBusyRef.current = false;
      workerReadyRef.current = false;
      if (workerRef.current === worker) workerRef.current = null;
      worker.terminate();
      setWorkerReady(false);
      const error = new Error(event.message || "The pose worker crashed.");
      workerDeferredRef.current?.reject(error);
      workerDeferredRef.current = null;
      setCameraError(error.message);
    });

    const request: PoseWorkerRequest = {
      protocolVersion: POSE_WORKER_PROTOCOL_VERSION,
      requestId: ++requestIdRef.current,
      type: "initialize",
    };
    worker.postMessage(request);
    return deferred.promise;
  }, [clearWatchdog, handleWorkerResult, setCameraError]);

  const targetFps = useCallback((): number => {
    if (
      (settings.reduceOnBattery && powerStateRef.current.onBattery) ||
      (latencyEwmaRef.current ?? 0) > 150 ||
      rollingDropRate(performance.now()) > 0.2
    )
      return 3;
    const oldestResult = resultTimesRef.current[0];
    const hasTenSecondsOfHeadroom =
      oldestResult !== undefined && performance.now() - oldestResult >= 10_000;
    if (
      !powerStateRef.current.onBattery &&
      resultTimesRef.current.length >= 20 &&
      hasTenSecondsOfHeadroom &&
      (latencyEwmaRef.current ?? Number.POSITIVE_INFINITY) < 80 &&
      rollingDropRate(performance.now()) < 0.05
    )
      return 8;
    return 5;
  }, [rollingDropRate, settings.reduceOnBattery]);

  const restartWorker = useCallback(async () => {
    if (workerRestartCountRef.current >= 3) {
      reportMode("error", undefined, undefined, "worker-restart-limit");
      setCameraError(
        "Pose tracking could not recover. Pause tracking, then try again.",
      );
      stopSampler();
      return;
    }
    workerRestartCountRef.current += 1;
    disposeWorker();
    try {
      await initializeWorker();
    } catch {
      return;
    }
  }, [
    disposeWorker,
    initializeWorker,
    reportMode,
    setCameraError,
    stopSampler,
  ]);

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
      let bitmap: ImageBitmap;
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
        bitmap.close();
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
    scheduleSample();
  }, [scheduleSample, stopSampler]);

  const attachTrackRecovery = useCallback(
    (media: MediaStream) => {
      const track = media.getVideoTracks()[0];
      const cameraId = track?.getSettings().deviceId;
      if (!track || !cameraId) return;
      track.addEventListener("ended", () => {
        if (streamRef.current !== media) return;
        if (modeRef.current === "tracking" || modeRef.current === "calibrating")
          void recoverCameraRef.current(cameraId, modeRef.current);
        else {
          reportMode("error", cameraId, null, "camera-disconnected");
          setCameraError("The selected camera was disconnected.");
          stopCameraTracks();
        }
      });
      track.addEventListener("mute", () => {
        if (streamRef.current !== media) return;
        if (modeRef.current === "tracking")
          reportMode(
            "recovering",
            cameraId,
            activeCalibrationRef.current?.id ?? null,
            "camera-muted",
          );
      });
      track.addEventListener("unmute", () => {
        if (streamRef.current !== media || modeRef.current !== "recovering")
          return;
        reportMode(
          "tracking",
          cameraId,
          activeCalibrationRef.current?.id ?? null,
        );
        startSampler();
      });
    },
    [reportMode, setCameraError, startSampler, stopCameraTracks],
  );

  const openCamera = useCallback(
    async (
      cameraId?: string | null,
      allowFallback = true,
      desiredMode: "preview" | "tracking" | "calibrating" = "preview",
      recovering = false,
    ) => {
      stopCameraTracks();
      setCameraError(null);
      if (!recovering)
        reportMode("requesting-permission", cameraId ?? null, null);
      let media: MediaStream | null = null;
      let workerInitialized = false;
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new DOMException(
            "This system does not expose camera access to Posture.",
            "NotSupportedError",
          );
        }
        const accessStatus = await window.posture.camera.requestAccess();
        setCameraAccessStatus(accessStatus);
        if (accessStatus !== "granted") {
          const message =
            accessStatus === "denied" || accessStatus === "restricted"
              ? "Camera access is off. Allow Posture in your system privacy settings, then try again."
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
        if (workerResult.status === "rejected") throw workerResult.reason;
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
        await video.play();
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
        reportMode(
          desiredMode,
          activeId,
          desiredMode === "tracking"
            ? (activeCalibrationRef.current?.id ?? null)
            : null,
        );
        if (desiredMode === "tracking" || desiredMode === "calibrating")
          startSampler();
        return activeId;
      } catch (error) {
        media?.getTracks().forEach((track) => track.stop());
        if (videoRef.current?.srcObject === media)
          videoRef.current.srcObject = null;
        if (streamRef.current === media) streamRef.current = null;
        setStream((current) => (current === media ? null : current));
        if (workerInitialized) disposeWorker();
        stopSampler();
        if (
          allowFallback &&
          cameraId &&
          error instanceof DOMException &&
          (error.name === "OverconstrainedError" ||
            error.name === "NotFoundError")
        ) {
          await updateSettings({ selectedCameraId: null });
          return openCamera(null, false, desiredMode, recovering);
        }
        if (error instanceof DOMException && error.name === "NotAllowedError")
          setCameraAccessStatus("denied");
        const message =
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "Camera access is off. Allow Posture in your system privacy settings, then try again."
            : error instanceof DOMException && error.name === "NotReadableError"
              ? "The camera is already in use by another application."
              : error instanceof DOMException && error.name === "NotFoundError"
                ? "No camera was found. Connect a camera and try again."
                : "Posture could not open this camera. Check the connection and try again.";
        setCameraError(message);
        if (!recovering)
          reportMode(
            "error",
            cameraId ?? null,
            activeCalibrationRef.current?.id ?? null,
            error instanceof DOMException ? error.name : "camera-open-failed",
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
    await initializeWorker();
    reportMode("tracking", calibration.cameraId, calibration.id);
    startSampler();
  }, [calibrations, initializeWorker, openCamera, reportMode, startSampler]);

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

  const beginCalibration = useCallback(async () => {
    setCalibrationError(null);
    setCalibrationProgress(0);
    workerRestartCountRef.current = 0;
    calibrationSamplesRef.current = [];
    calibrationRejectedFramesRef.current = 0;
    calibrationStartedRef.current = performance.now();
    setCalibrating(true);
    try {
      if (!streamRef.current?.active) {
        const cameraId = await openCamera(
          useAppStore.getState().settings.selectedCameraId,
          true,
          "calibrating",
        );
        if (!cameraId) throw new Error("No camera was found.");
      } else {
        await initializeWorker();
        reportMode(
          "calibrating",
          streamRef.current.getVideoTracks()[0]?.getSettings().deviceId ?? null,
          null,
        );
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
      const next = await window.posture.calibrations.save(calibration);
      setCalibrations(next);
      activeCalibrationRef.current = calibration;
      setCalibrationProgress(100);
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
      if (streamRef.current?.active) await openCamera(cameraId);
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
    void window.posture.app.getPowerState().then((state) => {
      if (!disposed) powerStateRef.current = state;
    });
    const unsubscribePower = window.posture.app.onPowerStateChanged((state) => {
      powerStateRef.current = state;
    });
    const unsubscribeCommand = window.posture.tracking.onCommand(
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
      void refreshDevices(streamRef.current);
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
    refreshDevices,
    reportMode,
    setView,
    stopCamera,
  ]);

  const openSystemPrivacySettings = useCallback(async () => {
    try {
      await window.posture.camera.openSystemPrivacySettings();
    } catch {
      setCameraError(
        "Posture could not open camera settings. Open your system privacy settings manually.",
      );
    }
  }, [setCameraError]);

  return {
    stream,
    devices,
    cameraAccessStatus,
    workerReady,
    calibrating,
    calibrationProgress,
    calibrationError,
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
