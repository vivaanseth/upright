import { readFile } from "node:fs/promises";
import process from "node:process";

const files = process.argv.slice(2);
if (!files.length)
  throw new Error("Usage: node scripts/verify-sbom.mjs <sbom> [sbom...]");

const requiredPackages = [
  "@mediapipe/tasks-vision",
  "react",
  "react-dom",
  "zod",
  "zustand",
];

for (const file of files) {
  const sbom = JSON.parse(await readFile(file, "utf8"));
  if (sbom.bomFormat !== "CycloneDX" || sbom.specVersion !== "1.6")
    throw new Error(`${file} is not a CycloneDX 1.6 document.`);
  if (!Array.isArray(sbom.components) || sbom.components.length < 7)
    throw new Error(`${file} has an unexpectedly small runtime inventory.`);
  const names = new Set(sbom.components.map((component) => component.name));
  const missing = requiredPackages.filter((name) => !names.has(name));
  if (missing.length)
    throw new Error(
      `${file} is missing runtime packages: ${missing.join(", ")}`,
    );
  if (
    !sbom.components.some(
      (component) =>
        component.type === "machine-learning-model" &&
        component.name === "MediaPipe Pose Landmarker Lite" &&
        component.hashes?.some((hash) => hash.alg === "SHA-256"),
    )
  )
    throw new Error(`${file} is missing the checksummed model component.`);
  if (
    !Array.isArray(sbom.dependencies) ||
    sbom.dependencies.length < 2 ||
    !sbom.dependencies.some((entry) => entry.dependsOn?.length)
  )
    throw new Error(`${file} has no usable dependency relationships.`);
  const rootRef = sbom.metadata?.component?.["bom-ref"];
  if (typeof rootRef !== "string")
    throw new Error(`${file} has no metadata root bom-ref.`);
  const refs = new Set([rootRef]);
  for (const component of sbom.components) {
    if (
      !component ||
      typeof component["bom-ref"] !== "string" ||
      typeof component.name !== "string" ||
      typeof component.version !== "string"
    )
      throw new Error(`${file} contains an invalid component.`);
    if (refs.has(component["bom-ref"]))
      throw new Error(
        `${file} contains duplicate bom-ref ${component["bom-ref"]}.`,
      );
    refs.add(component["bom-ref"]);
  }
  const dependencyRefs = new Set();
  for (const relationship of sbom.dependencies) {
    if (!refs.has(relationship.ref))
      throw new Error(
        `${file} references missing component ${relationship.ref}.`,
      );
    if (dependencyRefs.has(relationship.ref))
      throw new Error(
        `${file} repeats dependency relationship ${relationship.ref}.`,
      );
    dependencyRefs.add(relationship.ref);
    for (const dependency of relationship.dependsOn ?? [])
      if (!refs.has(dependency))
        throw new Error(`${file} depends on missing component ${dependency}.`);
  }
  if (!dependencyRefs.has(rootRef))
    throw new Error(`${file} has no root dependency relationship.`);
  if (!names.has("electron"))
    throw new Error(`${file} is missing the packaged Electron runtime.`);
  console.log(
    `Validated ${file}: ${sbom.components.length} components, ${sbom.dependencies.length} relationships.`,
  );
}
