#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const packagePath = path.join(root, "package.json");
const lockPath = path.join(root, "package-lock.json");
const gradlePath = path.join(root, "apps", "android", "app", "build.gradle.kts");
const checkOnly = process.argv.includes("--check");

function tagExists(tag) {
  return execFileSync("git", ["tag", "--list", tag], { cwd: root, encoding: "utf8" }).trim() === tag;
}

const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(pkg.version);
if (!match) throw new Error(`Continuous deployment requires a stable x.y.z version, found ${pkg.version}`);
// A version declared in package.json but never tagged (a deliberate minor or
// major release such as 7.1.0) is released as declared. Otherwise the last
// released version is bumped by one patch.
const releaseDeclared = !tagExists(`v${match[0]}`);
const nextVersion = releaseDeclared ? match[0] : `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
if (!releaseDeclared && tagExists(`v${nextVersion}`)) {
  throw new Error(`Release tag v${nextVersion} already exists; declare the intended version in package.json`);
}

const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
pkg.version = nextVersion;
lock.version = nextVersion;
if (!lock.packages?.[""]) throw new Error("package-lock.json is missing the root package entry");
lock.packages[""].version = nextVersion;

let gradle = fs.readFileSync(gradlePath, "utf8");
const codeMatches = [...gradle.matchAll(/\bversionCode\s*=\s*(\d+)/g)];
const nameMatches = [...gradle.matchAll(/\bversionName\s*=\s*"([^"]+)"/g)];
if (codeMatches.length !== 1 || nameMatches.length !== 1) {
  throw new Error("Expected exactly one Android versionCode and versionName");
}
if (nameMatches[0][1] !== match[0]) {
  throw new Error(`Android ${nameMatches[0][1]} does not match package ${match[0]}`);
}
// A declared release already carries its own (higher) versionCode.
const nextCode = Number(codeMatches[0][1]) + (releaseDeclared ? 0 : 1);
if (!Number.isSafeInteger(nextCode)) throw new Error("Android versionCode overflow");
gradle = gradle
  .replace(/\bversionCode\s*=\s*\d+/, `versionCode = ${nextCode}`)
  .replace(/\bversionName\s*=\s*"[^"]+"/, `versionName = "${nextVersion}"`);

if (!checkOnly) {
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  fs.writeFileSync(gradlePath, gradle);
}
console.log(`Prepared ${releaseDeclared ? "declared" : "continuous"} release v${nextVersion} (Android code ${nextCode})`);
