import { describe, expect, it } from "vitest";
import { normalizeCameraDevices } from "./useTrackingController";

const device = (
  kind: MediaDeviceKind,
  deviceId: string,
  label = "",
): MediaDeviceInfo =>
  ({
    kind,
    deviceId,
    label,
    groupId: "",
    toJSON: () => ({}),
  }) as MediaDeviceInfo;

describe("camera device normalization", () => {
  it("keeps video devices only and supplies private labels", () => {
    expect(
      normalizeCameraDevices([
        device("audioinput", "mic", "Microphone"),
        device("videoinput", "camera-1"),
      ]),
    ).toEqual([{ deviceId: "camera-1", label: "Camera 1" }]);
  });

  it("merges the active stream when enumeration omits it", () => {
    const track = {
      label: "Active camera",
      getSettings: () => ({ deviceId: "active-camera" }),
    } as MediaStreamTrack;
    const stream = {
      getVideoTracks: () => [track],
    } as MediaStream;
    expect(normalizeCameraDevices([], stream)).toEqual([
      { deviceId: "active-camera", label: "Active camera" },
    ]);
  });
});
