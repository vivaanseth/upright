import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("launches the secure onboarding flow", async () => {
  const userData = await mkdtemp(join(tmpdir(), "posture-e2e-"));
  const linuxSandboxArgs = process.platform === "linux" ? ["--no-sandbox"] : [];
  const app = await electron.launch({
    args: [
      ...linuxSandboxArgs,
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--user-data-dir=${userData}`,
      ".",
    ],
    env: { ...process.env, NODE_ENV: "test" },
  });

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
    await expect(window.locator("body")).not.toContainText("undefined");
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
