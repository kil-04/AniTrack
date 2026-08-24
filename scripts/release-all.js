#!/usr/bin/env node
const path = require("path");
const { spawnSync } = require("child_process");
const { ROOT, loadLocalEnv } = require("./automation-common");
const { readAndroidMetadata } = require("./android-release-common");
const pkg = require(path.join(ROOT, "package.json"));

loadLocalEnv();
if (!process.env.GH_TOKEN) throw new Error("GH_TOKEN is missing from .env/CI secrets");
const expectedTag = `v${pkg.version}`;
const androidMetadata = readAndroidMetadata();
if (androidMetadata.versionName !== pkg.version) {
  throw new Error(
    `Android versionName ${androidMetadata.versionName} must match desktop/package version ${pkg.version}`,
  );
}
const expectedRepo = `${pkg.build.publish.owner}/${pkg.build.publish.repo}`.toLowerCase();
const canonicalRemote = `https://github.com/${pkg.build.publish.owner}/${pkg.build.publish.repo}.git`;
if (process.env.GITHUB_ACTIONS === "true") {
  if (process.env.GITHUB_REF_TYPE !== "tag" || process.env.GITHUB_REF_NAME !== expectedTag) {
    throw new Error(`CI releases must run from the exact package tag ${expectedTag}`);
  }
}

function git(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", windowsHide: true, shell: false });
  if (result.error || result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(result.error?.message || result.stderr || result.stdout || "unknown error").trim()}`);
  }
  // Porcelain status uses meaningful leading spaces for its two status
  // columns. Preserve those while still removing the trailing newline.
  return result.stdout.trimEnd();
}

function assertReleaseProvenance(allowGeneratedManifest = false) {
  // Local publishing uses a long-lived GH_TOKEN too, so it must have the same
  // source provenance guarantees as CI. The second check permits only the two
  // signed manifests generated from the just-built APK.
  const statusLines = git(["status", "--porcelain", "--untracked-files=all"])
    .split(/\r?\n/).filter(Boolean);
  const allowed = new Set(["automation/android-update.json", "automation/android-update.sig"]);
  const unexpected = statusLines.filter((line) => {
    const file = line.slice(3).replace(/\\/g, "/").replace(/^"|"$/g, "");
    return !allowGeneratedManifest || !allowed.has(file);
  });
  if (unexpected.length) {
    throw new Error(
      "Release checkout contains unreviewed changes; commit and review every source file before publishing:\n" +
      unexpected.join("\n"),
    );
  }
  const head = git(["rev-parse", "HEAD"]);
  const tagged = git(["rev-list", "-n", "1", expectedTag]);
  if (head !== tagged) throw new Error(`HEAD ${head} does not match release tag ${expectedTag} (${tagged})`);
  const originUrl = git(["remote", "get-url", "origin"]);
  const originMatch = /github\.com(?::|\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(originUrl);
  const originRepo = originMatch ? `${originMatch[1]}/${originMatch[2]}`.toLowerCase() : "";
  if (originRepo !== expectedRepo) {
    throw new Error(`Git origin must be the configured release repository ${expectedRepo}`);
  }
  const remoteLines = git([
    "ls-remote", "--tags", canonicalRemote, `refs/tags/${expectedTag}`, `refs/tags/${expectedTag}^{}`,
  ]).split(/\r?\n/).filter(Boolean);
  const peeled = remoteLines.find((line) => line.endsWith(`refs/tags/${expectedTag}^{}`));
  const direct = remoteLines.find((line) => line.endsWith(`refs/tags/${expectedTag}`));
  const remoteCommit = (peeled || direct)?.split(/\s+/)[0];
  if (!remoteCommit || remoteCommit !== head) {
    throw new Error(`Remote origin tag ${expectedTag} is missing or does not point to HEAD`);
  }
  const remoteMain = git(["ls-remote", canonicalRemote, "refs/heads/main"]).split(/\s+/)[0];
  if (!remoteMain || remoteMain !== head) {
    throw new Error(`Release tag ${expectedTag} must point to the exact reviewed origin/main commit`);
  }
}

function run(command, args, cwd = ROOT) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(command),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const androidRoot = path.join(ROOT, "anitrack-android");
const gradle = path.join(androidRoot, process.platform === "win32" ? "gradlew.bat" : "gradlew");
assertReleaseProvenance(false);
// This remote read is deliberately the first step: no build may upload to an
// already-published release, even if electron-builder would otherwise allow it.
run(process.execPath, [path.join(ROOT, "scripts", "preflight-release.js")]);
run(npm, ["run", "typecheck"]);
run(npm, ["run", "build"]);
run(gradle, [":app:assembleRelease"], androidRoot);
run(process.execPath, [path.join(ROOT, "scripts", "prepare-android-update.js")]);
run(process.execPath, [path.join(ROOT, "scripts", "sign-automation.js"), "--verify"]);
// Repeat immediately before the first remote mutation to close the long build window.
assertReleaseProvenance(true);
run(process.execPath, [path.join(ROOT, "scripts", "preflight-release.js")]);
run(process.execPath, [path.join(ROOT, "node_modules", "electron-builder", "cli.js"), "--publish", "always"]);
run(process.execPath, [path.join(ROOT, "scripts", "upload-next-android.js")]);
// Refuse final publication if the reviewed tag/main moved during asset upload.
assertReleaseProvenance(true);
run(process.execPath, [path.join(ROOT, "scripts", "publish-release.js")]);
console.log("\nDesktop and native Android release published successfully.");
