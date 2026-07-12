import { execFile } from "node:child_process";
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
const { stdout } = await execFileAsync(
  pnpmInvocation.file,
  pnpmInvocation.args,
  {
    ...pnpmInvocation.options,
    maxBuffer: 20 * 1024 * 1024,
  },
);
const inventory = JSON.parse(stdout);
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
