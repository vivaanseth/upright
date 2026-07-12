import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

const directory = process.argv[2] ?? "dist";
const version = process.argv[3] ?? process.env.npm_package_version;

if (!version) {
  throw new Error(
    "Usage: node scripts/verify-release-assets.mjs <dir> <version>",
  );
}

await access(directory);

const expected = [
  `Posture-${version}-mac-universal.dmg`,
  `Posture-${version}-mac-universal.zip`,
  `Posture-${version}-win-x64.exe`,
  `Posture-${version}-win-x64.zip`,
  `Posture-${version}-linux-x86_64.AppImage`,
  `Posture-${version}-linux-amd64.deb`,
  `Posture-${version}-linux-x86_64.rpm`,
  `Posture-${version}-linux-x64.tar.gz`,
  "SHASUMS256.txt",
];

const actual = new Set(await readdir(directory));
const missing = expected.filter((entry) => !actual.has(entry));
if (missing.length > 0) {
  throw new Error(`Missing release assets:\n- ${missing.join("\n- ")}`);
}

const manifest = await readFile(path.join(directory, "SHASUMS256.txt"), "utf8");
for (const file of expected.filter((entry) => entry !== "SHASUMS256.txt")) {
  if (!manifest.includes(file)) {
    throw new Error(`Checksum manifest does not include ${file}`);
  }
}

console.log(`Release asset manifest is complete for ${version}.`);
