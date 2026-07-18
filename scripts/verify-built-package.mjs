import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const {
  FuseState,
  FuseV1Options,
  FuseVersion,
  getCurrentFuseWire,
} = require("@electron/fuses");
const execFileAsync = promisify(execFile);
const root = process.argv[2] ?? "dist";

async function findAsarFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findAsarFiles(fullPath)));
    } else if (entry.name === "app.asar") {
      files.push(fullPath);
    }
  }
  return files;
}

async function findExistingFile(candidates) {
  for (const candidate of candidates) {
    try {
      const entries = await readdir(path.dirname(candidate));
      if (entries.includes(path.basename(candidate))) return candidate;
    } catch {
      // Continue trying platform-specific candidates.
    }
  }
  return null;
}

async function inferExecutableFromAsar(asar) {
  const parts = asar.split(path.sep);
  const appIndex = parts.findIndex((part) => part.endsWith(".app"));
  if (appIndex >= 0) {
    const appRoot = parts.slice(0, appIndex + 1).join(path.sep);
    const productName = path.basename(parts[appIndex], ".app");
    return findExistingFile([
      path.join(appRoot, "Contents", "MacOS", productName),
    ]);
  }

  const resources = path.dirname(asar);
  const appRoot = path.dirname(resources);
  const entries = await readdir(appRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (
      entry.name.endsWith(".exe") ||
      entry.name === "Upright" ||
      entry.name === "upright" ||
      entry.name === "posture-desktop"
    ) {
      return path.join(appRoot, entry.name);
    }
  }
  return null;
}

async function verifyFuses(executable) {
  const current = await getCurrentFuseWire(executable);
  if (current.version !== FuseVersion.V1) {
    throw new Error(`Unexpected Electron fuse version in ${executable}`);
  }
  const expected = {
    [FuseV1Options.RunAsNode]: FuseState.DISABLE,
    [FuseV1Options.EnableCookieEncryption]: FuseState.ENABLE,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: FuseState.DISABLE,
    [FuseV1Options.EnableNodeCliInspectArguments]: FuseState.DISABLE,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: FuseState.ENABLE,
    [FuseV1Options.OnlyLoadAppFromAsar]: FuseState.ENABLE,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: FuseState.DISABLE,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: FuseState.DISABLE,
  };

  for (const [option, state] of Object.entries(expected)) {
    if (current[option] !== state) {
      const name = FuseV1Options[option];
      throw new Error(
        `${name} fuse mismatch in ${executable}: expected ${FuseState[state]}, got ${
          FuseState[current[option]]
        }`,
      );
    }
  }
  console.log(`Verified Electron fuses for ${executable}.`);
}

async function smokeTest(executable) {
  const { stdout } = await execFileAsync(executable, ["--smoke-test"], {
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: "0",
    },
  });
  const receiptLine = stdout
    .split(/\r?\n/)
    .find((line) => line.includes('"uprightSmoke":true'));
  if (!receiptLine)
    throw new Error(`No Upright smoke-test receipt from ${executable}.`);
  const receipt = JSON.parse(receiptLine);
  if (
    receipt.rendererReady !== true ||
    receipt.trayReady !== true ||
    typeof receipt.version !== "string" ||
    typeof receipt.architecture !== "string"
  )
    throw new Error(`Invalid Upright smoke-test receipt from ${executable}.`);
  console.log(
    `Smoke tested ${executable} (${receipt.platform}/${receipt.architecture}, v${receipt.version}).`,
  );
}

const asars = await findAsarFiles(root);
if (asars.length === 0) {
  throw new Error(`No app.asar files found under ${root}`);
}

for (const asar of asars) {
  const { stdout } = await execFileAsync("node", [
    "scripts/verify-package.mjs",
    asar,
  ]);
  process.stdout.write(stdout);
  const executable = await inferExecutableFromAsar(asar);
  if (!executable) {
    throw new Error(`Could not infer Electron executable for ${asar}`);
  }
  await verifyFuses(executable);
  await smokeTest(executable);
}

console.log(`Verified ${asars.length} packaged ASAR file(s).`);
