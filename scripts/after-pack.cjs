const path = require("node:path");
const fs = require("node:fs/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const pkg = require("../package.json");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");

const execFileAsync = promisify(execFile);

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveExecutable(context, name) {
  if (context.electronPlatformName === "darwin") {
    return path.join(
      context.appOutDir,
      `${name}.app`,
      "Contents",
      "MacOS",
      name,
    );
  }

  if (context.electronPlatformName === "win32") {
    return path.join(context.appOutDir, `${name}.exe`);
  }

  const exactNames = [
    name,
    context.packager.appInfo.sanitizedName,
    context.packager.appInfo.name,
    pkg.name,
  ].filter(Boolean);

  for (const exactName of exactNames) {
    const candidatePath = path.join(context.appOutDir, exactName);
    if (await exists(candidatePath)) return candidatePath;
  }

  const candidates = await fs.readdir(context.appOutDir, {
    withFileTypes: true,
  });
  for (const candidate of candidates) {
    if (!candidate.isFile()) continue;

    const candidatePath = path.join(context.appOutDir, candidate.name);
    const mode = (await fs.stat(candidatePath)).mode;
    const isExecutable = (mode & 0o111) !== 0;
    const isElectronHelper =
      candidate.name === "chrome-sandbox" ||
      candidate.name.includes("crashpad") ||
      candidate.name.endsWith(".so") ||
      candidate.name.endsWith(".bin");

    if (isExecutable && !isElectronHelper) {
      return candidatePath;
    }
  }

  throw new Error(`Unable to find packaged executable in ${context.appOutDir}`);
}

exports.default = async function afterPack(context) {
  const name = context.packager.appInfo.productFilename;
  const resourcesPath =
    context.electronPlatformName === "darwin"
      ? path.join(context.appOutDir, `${name}.app`, "Contents", "Resources")
      : path.join(context.appOutDir, "resources");
  await fs.rm(path.join(resourcesPath, "app-update.yml"), { force: true });

  if (context.electronPlatformName === "darwin") {
    const appInfoPath = path.join(
      context.appOutDir,
      `${name}.app`,
      "Contents",
      "Info.plist",
    );
    const unusedUsageDescriptions = [
      "NSAudioCaptureUsageDescription",
      "NSBluetoothAlwaysUsageDescription",
      "NSBluetoothPeripheralUsageDescription",
      "NSMicrophoneUsageDescription",
    ];
    for (const key of unusedUsageDescriptions) {
      try {
        await execFileAsync("/usr/bin/plutil", ["-remove", key, appInfoPath]);
      } catch {
        // Electron versions do not always ship every default usage description.
      }
    }
    await execFileAsync("/usr/bin/plutil", [
      "-replace",
      "NSAppTransportSecurity",
      "-json",
      JSON.stringify({ NSAllowsArbitraryLoads: false }),
      appInfoPath,
    ]);

    const frameworks = path.join(
      context.appOutDir,
      `${name}.app`,
      "Contents",
      "Frameworks",
    );
    const helperBundles = (await fs.readdir(frameworks)).filter(
      (entry) => entry.includes("Helper") && entry.endsWith(".app"),
    );
    await Promise.all(
      helperBundles.map(async (bundle) => {
        const infoPath = path.join(
          frameworks,
          bundle,
          "Contents",
          "Info.plist",
        );
        const info = await fs.readFile(infoPath, "utf8");
        if (info.includes("NSCameraUsageDescription")) return;
        const cameraEntries = [
          "\t<key>NSCameraUsageDescription</key>",
          "\t<string>Upright uses your camera to estimate upper-body landmarks locally. Frames are never saved or uploaded.</string>",
          "\t<key>NSCameraUseContinuityCameraDeviceType</key>",
          "\t<true/>",
        ].join("\n");
        await fs.writeFile(
          infoPath,
          info.replace("</dict>", `${cameraEntries}\n</dict>`),
          "utf8",
        );
      }),
    );
  }

  const executable = await resolveExecutable(context, name);

  await flipFuses(executable, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  });
};
