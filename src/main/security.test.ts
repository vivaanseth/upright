import { describe, expect, it } from "vitest";
import {
  isTrustedRendererUrl,
  isVideoOnlyMediaRequest,
  resolveRendererAsset,
} from "./security";

describe("renderer trust boundary", () => {
  it("accepts only the exact packaged application origin", () => {
    const packaged = { isPackaged: true };
    expect(isTrustedRendererUrl("app://posture/index.html", packaged)).toBe(
      true,
    );
    expect(isTrustedRendererUrl("app://postureevil/index.html", packaged)).toBe(
      false,
    );
    expect(isTrustedRendererUrl("https://posture/index.html", packaged)).toBe(
      false,
    );
  });

  it("accepts only the configured development origin", () => {
    const development = {
      isPackaged: false,
      developmentUrl: "http://localhost:5173",
    };
    expect(isTrustedRendererUrl("http://localhost:5173/", development)).toBe(
      true,
    );
    expect(isTrustedRendererUrl("http://localhost:5174/", development)).toBe(
      false,
    );
    expect(isTrustedRendererUrl("http://127.0.0.1:5173/", development)).toBe(
      false,
    );
  });
});

describe("application protocol", () => {
  it("keeps resolved assets inside the renderer root", () => {
    expect(resolveRendererAsset("/app/renderer", "app://posture/")).toBe(
      "/app/renderer/index.html",
    );
    expect(
      resolveRendererAsset(
        "/app/renderer",
        "app://posture/assets/index.js?cache=1",
      ),
    ).toBe("/app/renderer/assets/index.js");
    expect(
      resolveRendererAsset("/app/renderer", "app://posture/%2e%2e%2fsecret"),
    ).toBeNull();
    expect(
      resolveRendererAsset("/app/renderer", "app://postureevil/index.html"),
    ).toBeNull();
    expect(
      resolveRendererAsset("/app/renderer", "app://posture/%E0%A4%A"),
    ).toBeNull();
  });
});

describe("media permission scope", () => {
  it("allows video-only requests and rejects audio", () => {
    expect(isVideoOnlyMediaRequest(undefined)).toBe(true);
    expect(isVideoOnlyMediaRequest([])).toBe(true);
    expect(isVideoOnlyMediaRequest(["video"])).toBe(true);
    expect(isVideoOnlyMediaRequest(["audio"])).toBe(false);
    expect(isVideoOnlyMediaRequest(["video", "audio"])).toBe(false);
  });
});
