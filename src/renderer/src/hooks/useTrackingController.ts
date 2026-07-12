import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Calibration,
  PostureFeatures,
  TrackingCommand,
} from "../../../shared/contracts";
import {
  buildCalibration,
  extractPostureFeatures,
  PostureClassifier,
  type Landmark,
} from "../../../shared/posture-engine";
import { useAppStore } from "../store";

type WorkerMessage =
  | { type: "ready" }
  | {
      type: "result";
      landmarks: Landmark[] | null;
      timestamp: number;
      inferenceMs: number;
    }
  | { type: "error"; message: string };

export interface CameraDevice {
  deviceId: string;
  label: string;
}

export function useTrackingController() {
  const settings = useAppStore((state) => state.settings);
  const calibrations = useAppStore((state) => state.calibrations);
  const setCalibrations = useAppStore((state) => state.setCalibrations);
  const setSnapshot = useAppStore((state) => state.setSnapshot);
  const setTracking = useAppStore((state) => state.setTracking);
  const setCameraError = useAppStore((state) => state.setCameraError);
  const setView = useAppStore((state) => state.setView);
  const updateSettings = useAppStore((state) => state.updateSettings);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [workerReady, setWorkerReady] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const [calibrating, setCalibrating] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const timerRef = useRef<number | null>(null);
  const frameBusyRef = useRef(false);
  const classifierRef = useRef(new PostureClassifier());
  const calibrationSamplesRef = useRef<PostureFeatures[]>([]);
  const calibrationStartedRef = useRef(0);
  const lastReportRef = useRef(0);
  const finishCalibrationRef = useRef<() => Promise<void>>(() =>
    Promise.resolve(),
  );
  const startTrackingRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const pauseTrackingRef = useRef<() => void>(() => undefined);
  const beginCalibrationRef = useRef<() => Promise<void>>(() =>
    Promise.resolve(),
  );
  const activeCalibrationRef = useRef<Calibration | null>(null);
  const modeRef = useRef<"idle" | "tracking" | "calibrating">("idle");

  const refreshDevices = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    const cameras = all
      .filter((device) => device.kind === "videoinput")
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Camera ${index + 1}`,
      }));
    setDevices(cameras);
    return cameras;
  }, []);

  const stopSampler = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    frameBusyRef.current = false;
  }, []);

  const stopCamera = useCallback(() => {
    stopSampler();
    setStream((current) => {
      current?.getTracks().forEach((track) => track.stop());
      return null;
    });
    if (videoRef.current) videoRef.current.srcObject = null;
  }, [stopSampler]);

  const initializeWorker = useCallback(() => {
    if (workerRef.current) return;
    const worker = new Worker(
      new URL("../workers/pose.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;
    worker.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
      if (event.data.type === "ready") {
        setWorkerReady(true);
        return;
      }
      if (event.data.type === "error") {
        frameBusyRef.current = false;
        setCameraError(event.data.message);
        return;
      }

      frameBusyRef.current = false;
      const features = event.data.landmarks
        ? extractPostureFeatures(event.data.landmarks)
        : null;
      if (modeRef.current === "calibrating") {
        if (features) calibrationSamplesRef.current.push(features);
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
        event.data.inferenceMs,
        useAppStore.getState().settings.reduceOnBattery ? 5 : 8,
        event.data.timestamp,
      );
      setSnapshot(snapshot);
      if (event.data.timestamp - lastReportRef.current >= 750) {
        lastReportRef.current = event.data.timestamp;
        window.posture.tracking.reportSnapshot({
          ...snapshot,
          timestamp: Date.now(),
        });
      }
    });
    worker.postMessage({ type: "initialize" });
  }, [setCameraError, setSnapshot]);

  const startSampler = useCallback(() => {
    stopSampler();
    const fps = settings.reduceOnBattery ? 5 : 8;
    timerRef.current = window.setInterval(
      async () => {
        if (
          frameBusyRef.current ||
          !videoRef.current ||
          videoRef.current.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
        )
          return;
        frameBusyRef.current = true;
        try {
          const bitmap = await createImageBitmap(videoRef.current);
          workerRef.current?.postMessage(
            { type: "frame", bitmap, timestamp: performance.now() },
            [bitmap],
          );
        } catch {
          frameBusyRef.current = false;
        }
      },
      Math.round(1_000 / fps),
    );
  }, [settings.reduceOnBattery, stopSampler]);

  const openCamera = useCallback(
    async (cameraId?: string | null) => {
      stopCamera();
      setCameraError(null);
      initializeWorker();
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            deviceId: cameraId ? { exact: cameraId } : undefined,
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30, max: 30 },
          },
        });
        const video = document.createElement("video");
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        video.srcObject = media;
        await video.play();
        videoRef.current = video;
        setStream(media);
        const cameras = await refreshDevices();
        const activeId =
          media.getVideoTracks()[0]?.getSettings().deviceId ??
          cameras[0]?.deviceId ??
          null;
        if (activeId && activeId !== settings.selectedCameraId)
          await updateSettings({ selectedCameraId: activeId });
        startSampler();
        return activeId;
      } catch (error) {
        const message =
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "Camera access is off. Allow Posture in your system privacy settings, then try again."
            : error instanceof DOMException && error.name === "NotReadableError"
              ? "The camera is already in use by another application."
              : "Posture could not open this camera. Check the connection and try again.";
        setCameraError(message);
        throw error;
      }
    },
    [
      initializeWorker,
      refreshDevices,
      setCameraError,
      settings.selectedCameraId,
      startSampler,
      stopCamera,
      updateSettings,
    ],
  );

  const startTracking = useCallback(async () => {
    const cameraId = settings.selectedCameraId;
    const calibration =
      calibrations.find((entry) => entry.cameraId === cameraId) ??
      calibrations[0];
    if (!calibration) {
      setCalibrationError("Calibrate your camera before starting a session.");
      return;
    }
    activeCalibrationRef.current = calibration;
    if (!stream?.active) await openCamera(calibration.cameraId);
    classifierRef.current = new PostureClassifier();
    modeRef.current = "tracking";
    setTracking(true);
  }, [
    calibrations,
    openCamera,
    setTracking,
    settings.selectedCameraId,
    stream?.active,
  ]);

  const pauseTracking = useCallback(() => {
    modeRef.current = "idle";
    stopCamera();
    const snapshot = classifierRef.current.paused();
    setSnapshot(snapshot);
    window.posture.tracking.reportSnapshot({
      ...snapshot,
      timestamp: Date.now(),
    });
    setTracking(false);
  }, [setSnapshot, setTracking, stopCamera]);

  const beginCalibration = useCallback(async () => {
    setCalibrationError(null);
    setCalibrationProgress(0);
    const cameraId = await openCamera(settings.selectedCameraId);
    if (!cameraId) throw new Error("No camera was found.");
    calibrationSamplesRef.current = [];
    calibrationStartedRef.current = performance.now();
    modeRef.current = "calibrating";
    setCalibrating(true);
  }, [openCamera, settings.selectedCameraId]);

  const finishCalibration = useCallback(async () => {
    if (modeRef.current !== "calibrating") return;
    modeRef.current = "idle";
    setCalibrating(false);
    try {
      const track = stream?.getVideoTracks()[0];
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
      );
      const next = await window.posture.calibrations.save(calibration);
      setCalibrations(next);
      activeCalibrationRef.current = calibration;
      setCalibrationProgress(100);
    } catch (error) {
      setCalibrationError(
        error instanceof Error
          ? error.message
          : "Calibration was not stable enough.",
      );
      setCalibrationProgress(0);
    }
  }, [setCalibrations, stream]);

  useEffect(() => {
    finishCalibrationRef.current = finishCalibration;
  }, [finishCalibration]);

  const selectCamera = useCallback(
    async (cameraId: string) => {
      await updateSettings({ selectedCameraId: cameraId });
      await window.posture.calibrations.deleteForCamera(cameraId);
      if (stream?.active) await openCamera(cameraId);
    },
    [openCamera, stream?.active, updateSettings],
  );

  useEffect(() => {
    startTrackingRef.current = startTracking;
    pauseTrackingRef.current = pauseTracking;
    beginCalibrationRef.current = beginCalibration;
  }, [beginCalibration, pauseTracking, startTracking]);

  useEffect(() => {
    initializeWorker();
    const unsubscribe = window.posture.tracking.onCommand(
      (command: TrackingCommand) => {
        if (command.type === "start" || command.type === "resume")
          void startTrackingRef.current();
        if (command.type === "pause" || command.type === "stop")
          pauseTrackingRef.current();
        if (command.type === "recalibrate") {
          setView("diagnostics");
          void beginCalibrationRef.current();
        }
        if (command.type === "open-settings") setView("settings");
      },
    );
    const onDeviceChange = (): void => {
      void refreshDevices();
    };
    navigator.mediaDevices?.addEventListener("devicechange", onDeviceChange);
    return () => {
      unsubscribe();
      navigator.mediaDevices?.removeEventListener(
        "devicechange",
        onDeviceChange,
      );
      stopCamera();
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [initializeWorker, refreshDevices, setView, stopCamera]);

  return {
    stream,
    devices,
    workerReady,
    calibrating,
    calibrationProgress,
    calibrationError,
    openCamera,
    stopCamera,
    startTracking,
    pauseTracking,
    beginCalibration,
    selectCamera,
    refreshDevices,
  };
}
