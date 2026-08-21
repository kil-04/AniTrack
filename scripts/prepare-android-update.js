#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const https = require("https");
const {
  ROOT,
  TRUST_PATH,
  UPDATE_PATH,
  UPDATE_SIG_PATH,
  signFile,
  verifyFile,
  verifyBytes,
  validateAndroidUpdate,
  readJsonFile,
} = require("./automation-common");
const {
  verifyAndroidArtifact,
  assertManifestMatchesArtifact,
} = require("./android-release-common");

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

function fetchBytes(url, redirectsLeft = 5, maxBytes = 128 * 1024) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return reject(new Error(`Refusing non-HTTPS release metadata URL: ${url}`));
    const client = https;
    const request = client.get(parsed, {
      headers: {
        Accept: "application/octet-stream, application/json, text/plain",
        "User-Agent": "anitrack-release-preflight",
      },
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (redirectsLeft <= 0) return reject(new Error(`Too many redirects fetching ${url}`));
        return resolve(fetchBytes(new URL(response.headers.location, parsed).toString(), redirectsLeft - 1, maxBytes));
      }
      const chunks = [];
      let received = 0;
      let tooLarge = false;
      response.on("data", (chunk) => {
        received += chunk.length;
        if (received > maxBytes) {
          tooLarge = true;
          response.destroy();
          reject(new Error(`Release metadata exceeded ${maxBytes} bytes`));
        }
        else chunks.push(chunk);
      });
      response.on("error", (error) => {
        if (!tooLarge) reject(error);
      });
      response.on("end", () => {
        if (tooLarge) return;
        const bytes = Buffer.concat(chunks);
        if (response.statusCode === 404) return resolve(null);
        if (response.statusCode < 200 || response.statusCode >= 300) {
          return reject(new Error(`GET ${url} failed (${response.statusCode}): ${bytes.toString("utf8", 0, 500)}`));
        }
        resolve(bytes);
      });
    });
    request.setTimeout(30000, () => request.destroy(new Error(`Timed out fetching ${url}`)));
    request.on("error", reject);
  });
}

function assertVersionIncrease(previous, artifact) {
  validateAndroidUpdate(previous, "previously published Android update manifest");
  if (artifact.versionCode <= previous.versionCode) {
    throw new Error(
      `Android versionCode must increase beyond the signed published manifest ` +
      `(published ${previous.versionCode}/${previous.versionName}, current ${artifact.versionCode}/${artifact.versionName})`,
    );
  }
}

async function assertNewerThanPublished(artifact) {
  const trust = JSON.parse(fs.readFileSync(TRUST_PATH, "utf8"));
  const manifestUrl = trust.androidUpdateManifestUrl;
  const signatureUrl = trust.androidUpdateSignatureUrl;
  if (typeof manifestUrl !== "string" || typeof signatureUrl !== "string") {
    throw new Error("Android update URLs are missing from shared/automation-trust.json");
  }
  const previousBytes = await fetchBytes(manifestUrl);
  if (previousBytes === null) {
    console.log("No previously published Android update manifest found; monotonic version check starts here.");
    return;
  }
  const previousSignature = await fetchBytes(signatureUrl);
  if (previousSignature === null) {
    throw new Error("A previous Android update manifest exists without its detached signature");
  }
  if (!verifyBytes(previousBytes, previousSignature.toString("utf8"))) {
    throw new Error("Previously published Android update manifest has an invalid signature");
  }
  let previous;
  try { previous = JSON.parse(previousBytes.toString("utf8")); }
  catch (error) { throw new Error(`Previously published Android update manifest is invalid JSON: ${error.message}`); }
  assertVersionIncrease(previous, artifact);
  console.log(`Verified Android version increase: ${previous.versionCode} -> ${artifact.versionCode}`);
}

async function main() {
  const artifact = verifyAndroidArtifact();
  console.log(
    `Verified release APK ${artifact.applicationId} ${artifact.versionCode}/${artifact.versionName} ` +
    `with pinned certificate ${artifact.signerSha256}.`,
  );
  await assertNewerThanPublished(artifact);

  const assetName = `AniTrack-Android-Next-${artifact.versionName}.apk`;
  const manifest = {
    schemaVersion: 1,
    sequence: artifact.versionCode,
    issuedAt: new Date().toISOString(),
    applicationId: artifact.applicationId,
    versionCode: artifact.versionCode,
    versionName: artifact.versionName,
    apkUrl: `https://github.com/${pkg.build.publish.owner}/${pkg.build.publish.repo}/releases/download/v${pkg.version}/${assetName}`,
    sha256: artifact.sha256,
    sizeBytes: artifact.sizeBytes,
    mandatory: false,
    notes: process.env.ANITRACK_ANDROID_RELEASE_NOTES ||
      `AniTrack ${artifact.versionName} reliability and automation update.`,
  };
  validateAndroidUpdate(manifest);
  assertManifestMatchesArtifact(manifest, artifact);
  fs.writeFileSync(UPDATE_PATH, JSON.stringify(manifest, null, 2) + "\n");
  signFile(UPDATE_PATH, UPDATE_SIG_PATH);
  readJsonFile(UPDATE_PATH, validateAndroidUpdate, "automation/android-update.json");
  if (!verifyFile(UPDATE_PATH, UPDATE_SIG_PATH)) throw new Error("Generated update manifest failed signature verification");
  console.log(`Prepared signed Android update manifest for ${assetName}.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = { fetchBytes, assertVersionIncrease, assertNewerThanPublished };
