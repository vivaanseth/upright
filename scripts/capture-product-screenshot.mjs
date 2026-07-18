import { _electron as electron } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const userData = await mkdtemp(join(tmpdir(), "upright-screenshot-"));
const frames = join(userData, "frames");
await mkdir(frames, { recursive: true });
const execFileAsync = promisify(execFile);
const app = await electron.launch({
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--user-data-dir=${userData}`,
    ".",
  ],
  env: { ...process.env, NODE_ENV: "test" },
});

try {
  const page = await app.firstWindow();
  await page.screenshot({ path: join(frames, "frame-00.png") });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.screenshot({ path: join(frames, "frame-01.png") });
  await page.getByRole("button", { name: "Continue" }).click();
  await page
    .getByText("Camera and local posture model are ready.")
    .waitFor({ timeout: 15_000 });
  await page.screenshot({ path: join(frames, "frame-02.png") });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Start calibration" }).click();
  await page
    .getByRole("heading", { name: "You are ready." })
    .waitFor({ timeout: 20_000 });
  await page.screenshot({ path: join(frames, "frame-03.png") });
  await page.getByRole("button", { name: /start my first session/i }).click();
  await page
    .getByRole("heading", { name: "Stay comfortable, not perfect." })
    .waitFor();
  await page.waitForTimeout(1_500);
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({ path: join(frames, "frame-04.png") });
  await page.screenshot({
    path: "docs/screenshots/dashboard.png",
    animations: "disabled",
  });
  await execFileAsync(process.env.FFMPEG_PATH ?? "ffmpeg", [
    "-y",
    "-framerate",
    "0.7",
    "-i",
    join(frames, "frame-%02d.png"),
    "-vf",
    "fps=12,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer",
    "-loop",
    "0",
    "docs/screenshots/upright-demo.gif",
  ]);
  console.log("Captured deterministic Upright screenshot and product GIF.");
} finally {
  await app.close();
  await rm(userData, { recursive: true, force: true });
}
