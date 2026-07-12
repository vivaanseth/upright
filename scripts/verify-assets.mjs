import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";

const expected =
  "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a";
const path = new URL(
  "../src/renderer/public/models/pose_landmarker_lite.task",
  import.meta.url,
);
const actual = createHash("sha256")
  .update(await readFile(path))
  .digest("hex");

if (actual !== expected) {
  throw new Error(
    `Pose model checksum mismatch. Expected ${expected}, received ${actual}.`,
  );
}

process.stdout.write("Pose model checksum verified.\n");
