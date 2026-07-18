import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Onboarding } from "./Onboarding";

afterEach(cleanup);

const renderOnboarding = (
  overrides: Partial<React.ComponentProps<typeof Onboarding>> = {},
) => {
  const props: React.ComponentProps<typeof Onboarding> = {
    stream: null,
    devices: [],
    selectedCameraId: null,
    progress: 0,
    calibrating: false,
    cameraAccessStatus: "unknown",
    cameraFailureCode: null,
    workerReady: false,
    canOpenCameraSettings: true,
    error: null,
    hasCalibration: false,
    onOpenCamera: vi.fn(),
    onCloseCamera: vi.fn(),
    onOpenCameraSettings: vi.fn(),
    onSelectCamera: vi.fn(),
    onCalibrate: vi.fn(),
    onCancelCalibration: vi.fn(),
    onTestReminder: vi.fn().mockResolvedValue(undefined),
    onComplete: vi.fn(),
    ...overrides,
  };
  render(<Onboarding {...props} />);
  return props;
};

const advanceToCamera = (): void => {
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
};

describe("Onboarding", () => {
  it("requests camera shutdown when navigating back from camera setup", () => {
    const props = renderOnboarding();
    advanceToCamera();
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(props.onCloseCamera).toHaveBeenCalledOnce();
  });

  it("offers system recovery for denied camera access", () => {
    const props = renderOnboarding({
      cameraAccessStatus: "denied",
      error: "Camera access is off.",
    });
    advanceToCamera();
    fireEvent.click(
      screen.getByRole("button", { name: /open camera privacy settings/i }),
    );
    expect(props.onOpenCameraSettings).toHaveBeenCalledOnce();
  });

  it("exposes calibration progress semantics", () => {
    renderOnboarding({
      stream: {} as MediaStream,
      devices: [{ deviceId: "camera-1", label: "Camera 1" }],
      selectedCameraId: "camera-1",
      progress: 42,
    });
    advanceToCamera();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "42",
    );
  });

  it("cancels calibration when navigating back from calibration", () => {
    const props = renderOnboarding({
      stream: {} as MediaStream,
      devices: [{ deviceId: "camera-1", label: "Camera 1" }],
      selectedCameraId: "camera-1",
      calibrating: true,
      progress: 50,
    });
    advanceToCamera();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(props.onCancelCalibration).toHaveBeenCalledOnce();
  });
});
