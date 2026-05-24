#!/usr/bin/env node
// Uploads the Android release APK to the matching GitHub release.
// Reads version from package.json and GH_TOKEN from env.
// Usage: node scripts/upload-apk.js

const fs   = require("fs");
const path = require("path");
const https = require("https");

const pkg     = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));
const version = pkg.version;
const token   = process.env.GH_TOKEN;
const owner   = pkg.build.publish.owner;
const repo    = pkg.build.publish.repo;

const apkPath = path.join(
  __dirname,
  "../android/app/build/outputs/apk/release/app-release.apk"
);

if (!token) {
  console.error("GH_TOKEN environment variable is not set.");
  process.exit(1);
}

if (!fs.existsSync(apkPath)) {
  console.error("APK not found at", apkPath);
  process.exit(1);
}

function apiGet(urlPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.github.com",
      path: urlPath,
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "anitrack-publish",
      },
    };
    https.get(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(JSON.parse(data)));
    }).on("error", reject);
  });
}

function uploadAsset(releaseId, fileName, filePath) {
  return new Promise((resolve, reject) => {
    const fileData = fs.readFileSync(filePath);
    const options = {
      hostname: "uploads.github.com",
      path: `/repos/${owner}/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(fileName)}`,
      method: "POST",
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/vnd.android.package-archive",
        "Content-Length": fileData.length,
        "User-Agent": "anitrack-publish",
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        const json = JSON.parse(data);
        if (json.browser_download_url) resolve(json.browser_download_url);
        else reject(new Error(`Upload failed: ${data}`));
      });
    });
    req.on("error", reject);
    req.write(fileData);
    req.end();
  });
}

async function main() {
  console.log(`Publishing AniTrack v${version} APK...`);

  const releases = await apiGet(`/repos/${owner}/${repo}/releases`);
  const release  = releases.find((r) => r.tag_name === `v${version}`);
  if (!release) {
    console.error(`No GitHub release found for v${version}. Run 'npm run publish' first.`);
    process.exit(1);
  }

  // Delete existing APK asset if present (re-publish scenario)
  const existing = (release.assets || []).find((a) => a.name.endsWith(".apk"));
  if (existing) {
    console.log(`Deleting existing asset: ${existing.name}`);
    await new Promise((resolve, reject) => {
      const options = {
        hostname: "api.github.com",
        path: `/repos/${owner}/${repo}/releases/assets/${existing.id}`,
        method: "DELETE",
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "anitrack-publish",
        },
      };
      https.request(options, (res) => {
        res.resume();
        res.on("end", resolve);
      }).on("error", reject).end();
    });
  }

  const apkSize = (fs.statSync(apkPath).size / 1024 / 1024).toFixed(1);
  console.log(`Uploading AniTrack-${version}.apk (${apkSize} MB)...`);
  const url = await uploadAsset(release.id, `AniTrack-${version}.apk`, apkPath);
  console.log(`Done: ${url}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
