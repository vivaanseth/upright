const path = require("node:path");
const fs = require("node:fs/promises");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");

exports.default = async function afterPack(context) {
  const name = context.packager.appInfo.productFilename;
  if (context.electronPlatformName === "darwin") {
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
          "\t<string>Posture uses your camera to estimate upper-body landmarks locally. Frames are never saved or uploaded.</string>",
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

  const executable =
    context.electronPlatformName === "darwin"
      ? path.join(context.appOutDir, `${name}.app`, "Contents", "MacOS", name)
      : path.join(
          context.appOutDir,
          `${name}${context.electronPlatformName === "win32" ? ".exe" : ""}`,
        );

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
