import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";

const sha256 = async (url) =>
  createHash("sha256")
    .update(await readFile(url))
    .digest("hex");

const modelPath = new URL(
  "../src/renderer/public/models/pose_landmarker_lite.task",
  import.meta.url,
);
const expectedModel =
  "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a";
const actualModel = await sha256(modelPath);
if (actualModel !== expectedModel) {
  throw new Error(
    `Pose model checksum mismatch. Expected ${expectedModel}, received ${actualModel}.`,
  );
}

const wasmFiles = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_module_internal.js",
  "vision_wasm_module_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
];

for (const file of wasmFiles) {
  const bundled = new URL(
    `../src/renderer/public/wasm/${file}`,
    import.meta.url,
  );
  const vendor = new URL(
    `../node_modules/@mediapipe/tasks-vision/wasm/${file}`,
    import.meta.url,
  );
  const [bundledBytes, vendorBytes] = await Promise.all([
    readFile(bundled),
    readFile(vendor),
  ]);
  if (bundledBytes.length === 0) {
    throw new Error(`Bundled MediaPipe runtime asset is empty: ${file}`);
  }
  const bundledHash = createHash("sha256").update(bundledBytes).digest("hex");
  const vendorHash = createHash("sha256").update(vendorBytes).digest("hex");
  if (bundledHash !== vendorHash) {
    throw new Error(
      `Bundled MediaPipe runtime asset differs from the pinned package: ${file}\n` +
        `Bundled: ${fileURLToPath(bundled)}\nVendor: ${fileURLToPath(vendor)}`,
    );
  }
}

process.stdout.write(
  `Pose model and ${wasmFiles.length} MediaPipe runtime assets verified.\n`,
);
