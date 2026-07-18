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
  `Upright-${version}-mac-universal.dmg`,
  `Upright-${version}-mac-universal.zip`,
  `Upright-${version}-win-x64.exe`,
  `Upright-${version}-win-x64.zip`,
  `Upright-${version}-linux-x86_64.AppImage`,
  `Upright-${version}-linux-amd64.deb`,
  `Upright-${version}-linux-x86_64.rpm`,
  `Upright-${version}-linux-x64.tar.gz`,
  `Upright-v${version}-macos-sbom.cdx.json`,
  `Upright-v${version}-windows-sbom.cdx.json`,
  `Upright-v${version}-linux-sbom.cdx.json`,
  "SHASUMS256.txt",
];

const actual = new Set(await readdir(directory));
const missing = expected.filter((entry) => !actual.has(entry));
if (missing.length > 0) {
  throw new Error(`Missing release assets:\n- ${missing.join("\n- ")}`);
}
const unexpected = [...actual].filter((entry) => !expected.includes(entry));
if (unexpected.length > 0) {
  throw new Error(`Unexpected release assets:\n- ${unexpected.join("\n- ")}`);
}

const manifest = await readFile(path.join(directory, "SHASUMS256.txt"), "utf8");
for (const file of expected.filter((entry) => entry !== "SHASUMS256.txt")) {
  if (!manifest.includes(file)) {
    throw new Error(`Checksum manifest does not include ${file}`);
  }
}

console.log(`Release asset manifest is complete for ${version}.`);
