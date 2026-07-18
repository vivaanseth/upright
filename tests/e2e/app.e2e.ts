import { _electron as electron, expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const launch = async (
  userData: string,
  environment: Record<string, string> = {},
) => {
  const linuxTestArgs =
    process.platform === "linux"
      ? ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"]
      : [];
  return electron.launch({
    args: [
      ...linuxTestArgs,
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--user-data-dir=${userData}`,
      ".",
    ],
    env: { ...process.env, NODE_ENV: "test", ...environment },
  });
};

const openCameraStep = async (window: Page): Promise<void> => {
  await window.getByRole("button", { name: "Continue" }).click();
  await window.getByRole("button", { name: "Continue" }).click();
  await expect(
    window.getByRole("heading", { name: "Choose your camera." }),
  ).toBeVisible();
};

test("launches the secure onboarding flow", async () => {
  test.setTimeout(60_000);
  const userData = await mkdtemp(join(tmpdir(), "posture-e2e-"));
  const app = await launch(userData);

  try {
    const window = await app.firstWindow();
    await expect(
      window.getByRole("heading", {
        name: "A quieter way to notice your posture.",
      }),
    ).toBeVisible();
    await expect(window.getByText("Setup takes about a minute")).toBeVisible();
    await window.getByRole("button", { name: "Continue" }).click();
    await expect(
      window.getByRole("heading", { name: "Your camera stays yours." }),
    ).toBeVisible();
    await expect(
      window.getByText(/never uploads, saves, or logs camera frames/i),
    ).toBeVisible();
    await window.getByRole("button", { name: "Continue" }).click();
    await expect(
      window.getByRole("heading", { name: "Choose your camera." }),
    ).toBeVisible();
    await expect(window.locator("video")).toBeVisible();
    await expect(window.locator("select option")).toHaveCount(2, {
      timeout: 15_000,
    });
    await expect(
      window.getByRole("button", { name: "Continue" }),
    ).toBeEnabled();
    await window.getByRole("button", { name: "Continue" }).click();
    await expect(
      window.getByRole("heading", { name: "Find your baseline." }),
    ).toBeVisible();
    await expect(
      window.getByRole("button", { name: "Start calibration" }),
    ).toBeEnabled({ timeout: 15_000 });
    await window.getByRole("button", { name: "Start calibration" }).click();
    try {
      await expect
        .poll(
          async () =>
            Number(
              await window
                .getByRole("progressbar")
                .getAttribute("aria-valuenow"),
            ),
          { timeout: 30_000 },
        )
        .toBeGreaterThan(0);
    } catch (error) {
      console.error(
        "Renderer state at inference timeout:",
        await window.locator("body").innerText(),
      );
      throw error;
    }
    await expect(
      window.getByRole("heading", { name: "You are ready." }),
    ).toBeVisible({ timeout: 20_000 });
    const nudgeWindowPromise = app.waitForEvent("window");
    await window.getByRole("button", { name: "Test reminder" }).click();
    const nudge = await nudgeWindowPromise;
    await expect(nudge.getByText("Take a moment to reset")).toBeVisible();
    await nudge.getByRole("button", { name: "Dismiss reminder" }).click();
    await expect.poll(() => nudge.isClosed()).toBe(true);
    await window
      .getByRole("button", { name: /start my first session/i })
      .click();
    await expect(
      window.getByRole("heading", { name: "Stay comfortable, not perfect." }),
    ).toBeVisible();
    await expect(window.locator("body")).not.toContainText("undefined");
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("loads the real bundled MediaPipe runtime with a fake camera", async () => {
  test.setTimeout(60_000);
  const userData = await mkdtemp(join(tmpdir(), "upright-e2e-mediapipe-"));
  const app = await launch(userData, { UPRIGHT_TEST_MEDIAPIPE: "true" });

  try {
    const window = await app.firstWindow();
    await openCameraStep(window);
    await expect(
      window.getByText("Camera and local posture model are ready."),
    ).toBeVisible({ timeout: 30_000 });
    await window.getByRole("button", { name: "Continue" }).click();
    await window.getByRole("button", { name: "Start calibration" }).click();
    await expect
      .poll(
        async () =>
          Number(
            await window.getByRole("progressbar").getAttribute("aria-valuenow"),
          ),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("shows permission recovery when camera access is denied", async () => {
  const userData = await mkdtemp(join(tmpdir(), "posture-e2e-denied-"));
  const app = await launch(userData, { UPRIGHT_TEST_CAMERA_STATUS: "denied" });

  try {
    const window = await app.firstWindow();
    await openCameraStep(window);
    await expect(window.getByRole("alert")).toContainText(
      /camera access is off/i,
    );
    await expect(
      window.getByRole("button", { name: "Try camera again" }),
    ).toBeVisible();
    await expect(window.locator("video")).toHaveCount(0);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("recovers from a stale saved camera identifier", async () => {
  const userData = await mkdtemp(join(tmpdir(), "posture-e2e-stale-"));
  await writeFile(
    join(userData, "settings.json"),
    JSON.stringify({
      schemaVersion: 1,
      selectedCameraId: "camera-that-no-longer-exists",
      sensitivity: "balanced",
      reminderDelaySeconds: 30,
      cooldownMinutes: 10,
      soundEnabled: false,
      launchAtLogin: false,
      autoStartTracking: false,
      reduceOnBattery: true,
      theme: "system",
      onboardingComplete: false,
      diagnosticsEnabled: false,
    }),
  );
  const app = await launch(userData);

  try {
    const window = await app.firstWindow();
    await openCameraStep(window);
    await expect(window.locator("video")).toBeVisible();
    await expect(window.locator("select option")).toHaveCount(2, {
      timeout: 15_000,
    });
    await expect(window.locator("select")).not.toHaveValue(
      "camera-that-no-longer-exists",
    );
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("preserves legacy profile settings while presenting Upright branding", async () => {
  const userData = await mkdtemp(join(tmpdir(), "posture-e2e-upgrade-"));
  await writeFile(
    join(userData, "settings.json"),
    JSON.stringify({
      schemaVersion: 1,
      selectedCameraId: null,
      sensitivity: "high",
      reminderDelaySeconds: 60,
      cooldownMinutes: 20,
      soundEnabled: true,
      launchAtLogin: false,
      autoStartTracking: false,
      reduceOnBattery: true,
      theme: "dark",
      onboardingComplete: true,
      diagnosticsEnabled: false,
    }),
  );
  const app = await launch(userData);

  try {
    const window = await app.firstWindow();
    await expect(
      window.getByRole("heading", { name: "Stay comfortable, not perfect." }),
    ).toBeVisible();
    await expect(window.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(window).toHaveTitle("Upright");
    await expect(
      window.getByText("This camera needs calibration"),
    ).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
