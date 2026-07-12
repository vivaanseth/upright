const fs = require("node:fs/promises");

exports.default = async function afterAllArtifactBuild(result) {
  await Promise.all(
    result.artifactPaths
      .filter((artifactPath) => artifactPath.endsWith(".blockmap"))
      .map((artifactPath) => fs.rm(artifactPath, { force: true })),
  );
  return [];
};
