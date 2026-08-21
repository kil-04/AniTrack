#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const {
  ROOT,
  UPDATE_PATH,
  UPDATE_SIG_PATH,
  verifyFile,
  validateAndroidUpdate,
  readJsonFile,
} = require("./automation-common");
const {
  verifyAndroidArtifact,
  assertManifestMatchesArtifact,
} = require("./android-release-common");
const {
  owner,
  repo,
  tag,
  request,
  releaseByTag,
  assertDraftRelease,
} = require("./github-release-common");

async function main() {
  const artifact = verifyAndroidArtifact();
  const manifest = readJsonFile(UPDATE_PATH, validateAndroidUpdate, "automation/android-update.json");
  if (!fs.existsSync(UPDATE_SIG_PATH) || !verifyFile(UPDATE_PATH, UPDATE_SIG_PATH)) {
    throw new Error("Android update manifest signature is missing or invalid");
  }
  assertManifestMatchesArtifact(manifest, artifact);
  const apkAssetName = `AniTrack-Android-Next-${artifact.versionName}.apk`;
  const expectedUrl = `https://github.com/${owner}/${repo}/releases/download/${tag}/${apkAssetName}`;
  if (manifest.apkUrl !== expectedUrl) throw new Error(`Android update apkUrl must be exactly ${expectedUrl}`);

  const assets = [
    { name: apkAssetName, file: artifact.apkPath, type: "application/vnd.android.package-archive" },
    { name: "anitrack-next-update.json", file: UPDATE_PATH, type: "application/json" },
    { name: "anitrack-next-update.sig", file: UPDATE_SIG_PATH, type: "text/plain" },
  ];
  for (const asset of assets) {
    if (!fs.existsSync(asset.file) || !fs.statSync(asset.file).isFile()) throw new Error(`Missing release asset: ${asset.file}`);
    if (path.basename(asset.name) !== asset.name) throw new Error(`Unsafe release asset name: ${asset.name}`);
  }

  const release = await releaseByTag();
  assertDraftRelease(release);
  const existingAssets = release.assets || [];
  for (const asset of assets) {
    const matching = existingAssets.filter((existing) => existing.name === asset.name);
    if (matching.length > 1) throw new Error(`Draft ${tag} contains duplicate exact-name assets: ${asset.name}`);
  }

  for (const asset of assets) {
    const existing = existingAssets.find((candidate) => candidate.name === asset.name);
    if (existing) {
      await request(
        "api.github.com",
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/assets/${existing.id}`,
        "DELETE",
      );
      console.log(`Removed only the exact draft asset ${asset.name}.`);
    }
    const bytes = fs.readFileSync(asset.file);
    const uploaded = await request(
      "uploads.github.com",
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/${release.id}/assets?name=${encodeURIComponent(asset.name)}`,
      "POST",
      bytes,
      { "Content-Type": asset.type, "Content-Length": String(bytes.length) },
    );
    if (!uploaded || uploaded.name !== asset.name) throw new Error(`GitHub did not confirm exact asset upload: ${asset.name}`);
    console.log(`Uploaded exact draft asset ${asset.name}.`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
