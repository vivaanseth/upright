import { _electron as electron, expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const launch = async (
  userData: string,
  environment: Record<string, string> = {},
) => {
  const linuxSandboxArgs = process.platform === "linux" ? ["--no-sandbox"] : [];
  return electron.launch({
    args: [
      ...linuxSandboxArgs,
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
    await expect(window.locator("body")).not.toContainText("undefined");
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("shows permission recovery when camera access is denied", async () => {
  const userData = await mkdtemp(join(tmpdir(), "posture-e2e-denied-"));
  const app = await launch(userData, { POSTURE_TEST_CAMERA_STATUS: "denied" });

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
