import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const roots = ["src/main", "src/preload", "src/shared", "src/renderer/src"];
const ignoredParts = new Set(["workers", "__snapshots__"]);
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);

const persistedContractFiles = [
  "src/main/storage.ts",
  "src/shared/contracts.ts",
];
const persistedPrivateFieldPattern =
  /\b(?:frames?|rawLandmarks|landmarks|imageData|thumbnail|video)\s*:/i;
const appNetworkPattern =
  /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/;
const analyticsPattern =
  /\b(?:analytics|telemetry|sentry|posthog|segment)\s*(?:\.|\(|=|:|from\b)/i;
const allowedNetworkLines = ["net.fetch(pathToFileURL(assetPath).toString())"];

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignoredParts.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
    } else if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

const failures = [];

for (const file of persistedContractFiles) {
  const absolute = path.join(repoRoot, file);
  const lines = (await readFile(absolute, "utf8")).split("\n");
  lines.forEach((line, index) => {
    if (persistedPrivateFieldPattern.test(line)) {
      failures.push(
        `${file}:${index + 1} declares a private media field in persisted/export code.`,
      );
    }
  });
}

for (const root of roots) {
  for (const absolute of await collectFiles(path.join(repoRoot, root))) {
    const relative = path.relative(repoRoot, absolute);
    const lines = (await readFile(absolute, "utf8")).split("\n");
    lines.forEach((line, index) => {
      const compact = line.trim();
      if (
        appNetworkPattern.test(compact) &&
        !allowedNetworkLines.some((allowed) => compact.includes(allowed))
      ) {
        failures.push(
          `${relative}:${index + 1} uses a network-capable API outside the approved local protocol path.`,
        );
      }
      if (analyticsPattern.test(compact)) {
        failures.push(
          `${relative}:${index + 1} mentions analytics or telemetry.`,
        );
      }
    });
  }
}

if (failures.length > 0) {
  throw new Error(`Privacy boundary scan failed:\n- ${failures.join("\n- ")}`);
}

console.log("Privacy boundary scan passed.");
