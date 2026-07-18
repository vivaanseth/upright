import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
await readFile("pnpm-lock.yaml", "utf8");

const platform = process.argv[2] ?? process.platform;
const output =
  process.argv[3] ??
  `dist/Upright-v${packageJson.version}-${platform}-sbom.cdx.json`;
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const { stdout } = await execFileAsync(
  pnpm,
  ["list", "--prod", "--json", "--depth", "Infinity"],
  { maxBuffer: 16 * 1024 * 1024 },
);
const tree = JSON.parse(stdout)[0];
if (!tree?.dependencies)
  throw new Error("pnpm did not return a production dependency graph.");

const purl = (name, version) => {
  if (name.startsWith("@")) {
    const [scope, packageName] = name.split("/");
    return `pkg:npm/${encodeURIComponent(scope)}/${encodeURIComponent(packageName)}@${version}`;
  }
  return `pkg:npm/${encodeURIComponent(name)}@${version}`;
};

const components = new Map();
const relationships = new Map();
const visit = async (name, node) => {
  if (name.startsWith("@types/")) return null;
  if (!node?.version) throw new Error(`Missing locked version for ${name}.`);
  const ref = purl(name, node.version);
  if (!components.has(ref)) {
    let license = null;
    if (node.path) {
      try {
        const metadata = JSON.parse(
          await readFile(join(node.path, "package.json"), "utf8"),
        );
        if (typeof metadata.license === "string") license = metadata.license;
      } catch {
        // The graph remains useful when a package omits readable metadata.
      }
    }
    components.set(ref, {
      type: "library",
      "bom-ref": ref,
      name,
      version: node.version,
      purl: ref,
      ...(license ? { licenses: [{ license: { id: license } }] } : {}),
    });
  }
  const children = node.dependencies ?? {};
  const dependsOn = [];
  for (const [childName, child] of Object.entries(children)) {
    const childRef = await visit(childName, child);
    if (childRef) dependsOn.push(childRef);
  }
  relationships.set(
    ref,
    [...new Set([...(relationships.get(ref) ?? []), ...dependsOn])].sort(),
  );
  return ref;
};

const rootRef = purl(packageJson.name, packageJson.version);
const rootDependencies = [];
for (const [name, node] of Object.entries(tree.dependencies)) {
  const dependency = await visit(name, node);
  if (dependency) rootDependencies.push(dependency);
}

const electronVersion = packageJson.devDependencies?.electron;
if (!electronVersion)
  throw new Error("package.json does not pin the packaged Electron runtime.");
const electronRef = purl("electron", electronVersion);
components.set(electronRef, {
  type: "framework",
  "bom-ref": electronRef,
  name: "electron",
  version: electronVersion,
  purl: electronRef,
  licenses: [{ license: { id: "MIT" } }],
  externalReferences: [
    { type: "vcs", url: "https://github.com/electron/electron" },
  ],
  properties: [{ name: "upright:packaged-runtime", value: "true" }],
});
relationships.set(electronRef, []);

const modelPath = "src/renderer/public/models/pose_landmarker_lite.task";
const modelHash = createHash("sha256")
  .update(await readFile(modelPath))
  .digest("hex");
const modelRef = "urn:upright:model:mediapipe-pose-landmarker-lite:0.10.35";
components.set(modelRef, {
  type: "machine-learning-model",
  "bom-ref": modelRef,
  name: "MediaPipe Pose Landmarker Lite",
  version: "0.10.35",
  hashes: [{ alg: "SHA-256", content: modelHash }],
  licenses: [{ license: { id: "Apache-2.0" } }],
  externalReferences: [
    {
      type: "documentation",
      url: "https://developers.google.com/mediapipe/solutions/vision/pose_landmarker",
    },
    {
      type: "vcs",
      url: "https://github.com/google-ai-edge/mediapipe",
    },
  ],
  properties: [
    { name: "upright:asset-path", value: modelPath },
    { name: "upright:processing", value: "local-only" },
  ],
});
relationships.set(modelRef, []);
relationships.set(
  rootRef,
  [...new Set([...rootDependencies, electronRef, modelRef])].sort(),
);

const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: {
      components: [
        {
          type: "application",
          name: "Upright runtime SBOM generator",
          version: packageJson.version,
        },
      ],
    },
    component: {
      type: "application",
      "bom-ref": rootRef,
      name: "Upright",
      version: packageJson.version,
      purl: rootRef,
    },
    properties: [
      { name: "upright:target-platform", value: platform },
      {
        name: "upright:pnpm-lock-sha256",
        value: createHash("sha256")
          .update(await readFile("pnpm-lock.yaml"))
          .digest("hex"),
      },
    ],
  },
  components: [...components.values()].sort((a, b) =>
    a["bom-ref"].localeCompare(b["bom-ref"]),
  ),
  dependencies: [...relationships.entries()]
    .map(([ref, dependsOn]) => ({ ref, dependsOn }))
    .sort((a, b) => a.ref.localeCompare(b.ref)),
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(sbom, null, 2)}\n`, "utf8");
console.log(
  `Generated ${output} with ${sbom.components.length} components and ${sbom.dependencies.length} relationships.`,
);
