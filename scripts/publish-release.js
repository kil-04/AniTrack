#!/usr/bin/env node
const {
  pkg,
  owner,
  repo,
  tag,
  request,
  releaseByTag,
  assertDraftRelease,
} = require("./github-release-common");
const { readAndroidMetadata } = require("./android-release-common");

function assertCompleteAssetSet(release) {
  if (pkg.build?.win?.artifactName !== "AniTrack-Setup-${version}.${ext}") {
    throw new Error("Desktop artifactName must remain the exact versioned release template");
  }
  const { versionName } = readAndroidMetadata();
  const required = new Map([
    [`AniTrack-Setup-${pkg.version}.exe`, 1_000_000],
    [`AniTrack-Setup-${pkg.version}.exe.blockmap`, 100],
    ["latest.yml", 50],
    [`AniTrack-Android-Next-${versionName}.apk`, 1_000_000],
    ["anitrack-next-update.json", 100],
    ["anitrack-next-update.sig", 50],
  ]);
  const assets = Array.isArray(release.assets) ? release.assets : [];
  if (assets.length !== required.size || assets.some((asset) => !required.has(asset.name))) {
    const unexpected = assets.filter((asset) => !required.has(asset.name)).map((asset) => asset.name);
    throw new Error(
      `Draft ${tag} must contain only the ${required.size} approved assets` +
      (unexpected.length ? `; unexpected: ${unexpected.join(", ")}` : ""),
    );
  }
  for (const [name, minimumSize] of required) {
    const matching = assets.filter((asset) => asset.name === name);
    if (matching.length !== 1) throw new Error(`Draft ${tag} must contain exactly one required asset named ${name}`);
    const asset = matching[0];
    if (asset.state !== "uploaded" || !Number.isSafeInteger(asset.size) || asset.size < minimumSize) {
      throw new Error(`Required draft asset ${name} is incomplete or unexpectedly small`);
    }
  }
  console.log(`Verified all ${required.size} required exact-name release assets.`);
}

async function main() {
  const release = await releaseByTag();
  assertDraftRelease(release);
  assertCompleteAssetSet(release);
  console.log(`Publishing verified draft ${tag} (release ${release.id})...`);
  const body = Buffer.from(JSON.stringify({ draft: false }), "utf8");
  const result = await request(
    "api.github.com",
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/${release.id}`,
    "PATCH",
    body,
    { "Content-Type": "application/json", "Content-Length": String(body.length) },
  );
  if (!result || result.tag_name !== tag || result.draft !== false) {
    throw new Error(`GitHub did not confirm publication of ${tag}`);
  }
  console.log(`Published ${tag}: ${result.html_url}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = { assertCompleteAssetSet };
