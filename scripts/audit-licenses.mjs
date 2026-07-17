import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const pnpmLicenseArgs = ["licenses", "list", "--json"];

const blockedLicensePatterns = [
  /\bAGPL\b/i,
  /\bGPL\b/i,
  /\bLGPL\b/i,
  /\bSSPL\b/i,
  /\bBUSL\b/i,
  /Commons Clause/i,
  /Proprietary/i,
  /UNLICENSED/i,
  /UNKNOWN/i,
];

function licenseText(manifest) {
  if (typeof manifest.license === "string") return manifest.license;
  if (
    manifest.license &&
    typeof manifest.license === "object" &&
    typeof manifest.license.type === "string"
  ) {
    return manifest.license.type;
  }
  if (Array.isArray(manifest.licenses)) {
    const licenses = manifest.licenses
      .map((license) => (typeof license === "string" ? license : license?.type))
      .filter(Boolean);
    if (licenses.length > 0) return licenses.join(" OR ");
  }
  return "UNKNOWN";
}

function addPackage(inventory, manifest) {
  const name = manifest.name;
  const version = manifest.version;
  if (typeof name !== "string" || typeof version !== "string") return;
  const license = licenseText(manifest);
  const packages = inventory[license] ?? [];
  const existing = packages.find((entry) => entry.name === name);
  if (existing) {
    if (!existing.versions.includes(version)) existing.versions.push(version);
  } else {
    packages.push({ name, versions: [version] });
  }
  inventory[license] = packages;
}

async function readManifest(packageDirectory) {
  try {
    return JSON.parse(await readFile(join(packageDirectory, "package.json")));
  } catch {
    return null;
  }
}

async function readInstalledPackageInventory() {
  const inventory = {};
  const pnpmRoot = join(process.cwd(), "node_modules", ".pnpm");
  const packageEntries = await readdir(pnpmRoot, { withFileTypes: true });

  for (const packageEntry of packageEntries) {
    if (!packageEntry.isDirectory() || packageEntry.name === "node_modules") {
      continue;
    }
    const modulesRoot = join(pnpmRoot, packageEntry.name, "node_modules");
    let modules;
    try {
      modules = await readdir(modulesRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const moduleEntry of modules) {
      if (!moduleEntry.isDirectory()) continue;
      const modulePath = join(modulesRoot, moduleEntry.name);
      if (moduleEntry.name.startsWith("@")) {
        const scopedPackages = await readdir(modulePath, {
          withFileTypes: true,
        });
        for (const scopedPackage of scopedPackages) {
          if (!scopedPackage.isDirectory()) continue;
          const manifest = await readManifest(
            join(modulePath, scopedPackage.name),
          );
          if (manifest) addPackage(inventory, manifest);
        }
      } else {
        const manifest = await readManifest(modulePath);
        if (manifest) addPackage(inventory, manifest);
      }
    }
  }

  return inventory;
}

function resolvePnpmInvocation() {
  const npmExecPath = process.env.npm_execpath;

  if (npmExecPath && npmExecPath.toLowerCase().includes("pnpm")) {
    return {
      file: process.execPath,
      args: [npmExecPath, ...pnpmLicenseArgs],
      options: {},
    };
  }

  return {
    file: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    args: pnpmLicenseArgs,
    options: { shell: process.platform === "win32" },
  };
}

const pnpmInvocation = resolvePnpmInvocation();
let inventory;
try {
  const { stdout } = await execFileAsync(
    pnpmInvocation.file,
    pnpmInvocation.args,
    {
      ...pnpmInvocation.options,
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  inventory = JSON.parse(stdout);
} catch (error) {
  const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  if (!output.includes("ERR_PNPM_MISSING_PACKAGE_INDEX_FILE")) throw error;
  console.warn(
    "pnpm license index is unavailable; falling back to installed package manifests.",
  );
  inventory = await readInstalledPackageInventory();
}
const failures = [];

for (const [license, packages] of Object.entries(inventory)) {
  if (!blockedLicensePatterns.some((pattern) => pattern.test(license))) {
    continue;
  }
  const names = packages
    .map((entry) => `${entry.name}@${entry.versions.join(",")}`)
    .join(", ");
  failures.push(`${license}: ${names}`);
}

if (failures.length > 0) {
  throw new Error(
    `Blocked dependency licenses found:\n- ${failures.join("\n- ")}`,
  );
}

const packageCount = Object.values(inventory).reduce(
  (total, packages) => total + packages.length,
  0,
);
console.log(
  `License audit passed for ${packageCount} package entries across ${Object.keys(inventory).length} license groups.`,
);
