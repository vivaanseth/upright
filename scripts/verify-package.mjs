import { extractFile, listPackage } from "@electron/asar";
import { access, readdir } from "node:fs/promises";
import path from "node:path";

const archivePath = process.argv[2];
if (!archivePath) {
  throw new Error("Usage: pnpm verify:package <path-to-app.asar>");
}

await access(archivePath);
const entries = listPackage(archivePath, { isPack: false }).map((entry) =>
  entry.replaceAll("\\", "/"),
);
const failures = [];

const reject = (description, predicate) => {
  const matches = entries.filter(predicate);
  if (matches.length > 0)
    failures.push(`${description}: ${matches.join(", ")}`);
};

reject("runtime node_modules are packaged", (entry) =>
  entry.includes("/node_modules/"),
);
reject("production source maps are packaged", (entry) =>
  entry.endsWith(".map"),
);
reject(
  "development source or metadata is packaged",
  (entry) =>
    entry.endsWith(".ts") ||
    entry.endsWith(".tsx") ||
    entry.includes("/.git") ||
    entry.includes("/tests/") ||
    entry.includes("/coverage/"),
);

const models = entries.filter((entry) => entry.endsWith(".task"));
if (models.length !== 1) {
  failures.push(`expected one pose model, found ${models.length}`);
}

const wasmEntries = entries.filter((entry) => entry.endsWith(".wasm"));
const uniqueWasmNames = new Set(
  wasmEntries.map((entry) => path.basename(entry)),
);
if (wasmEntries.length === 0 || uniqueWasmNames.size !== wasmEntries.length) {
  failures.push("MediaPipe WASM files are missing or duplicated");
}

for (const required of [
  "/out/main/index.js",
  "/out/preload/index.js",
  "/out/preload/nudge.js",
  "/out/renderer/index.html",
  "/package.json",
  "/LICENSE",
  "/THIRD_PARTY_NOTICES.md",
]) {
  if (!entries.includes(required)) failures.push(`missing ${required}`);
}

for (const preload of ["out/preload/index.js", "out/preload/nudge.js"]) {
  const source = extractFile(archivePath, preload).toString("utf8");
  const unsupportedRequires = [...source.matchAll(/require\(([^)]+)\)/g)]
    .map((match) => match[1])
    .filter((request) => request !== '"electron"' && request !== "'electron'");
  if (unsupportedRequires.length)
    failures.push(
      `${preload} contains sandbox-incompatible external require calls: ${unsupportedRequires.join(", ")}`,
    );
}

const rendererScripts = entries.filter(
  (entry) => entry.startsWith("/out/renderer/assets/") && entry.endsWith(".js"),
);
for (const entry of rendererScripts) {
  const source = extractFile(archivePath, entry.slice(1)).toString("utf8");
  if (!entry.includes("pose.worker") && source.includes("deterministic"))
    failures.push(
      `production renderer exposes a deterministic test switch: ${entry}`,
    );
  if (
    entry.includes("pose.worker") &&
    /deterministicFixture\s*=\s*true/.test(source)
  )
    failures.push(
      `production worker enables deterministic landmarks: ${entry}`,
    );
}

const unpackedPath = `${archivePath}.unpacked`;
try {
  const unpacked = await readdir(unpackedPath);
  if (unpacked.length > 0) {
    failures.push(`unexpected unpacked ASAR contents: ${unpacked.join(", ")}`);
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

if (failures.length > 0) {
  throw new Error(
    `Package manifest validation failed:\n- ${failures.join("\n- ")}`,
  );
}

console.log(
  `Validated ${entries.length} ASAR entries, ${wasmEntries.length} WASM variants, and one bundled model.`,
);
