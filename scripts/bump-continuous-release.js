#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const packagePath = path.join(root, "package.json");
const lockPath = path.join(root, "package-lock.json");
const gradlePath = path.join(root, "apps", "android", "app", "build.gradle.kts");
const checkOnly = process.argv.includes("--check");

const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(pkg.version);
if (!match) throw new Error(`Continuous deployment requires a stable x.y.z version, found ${pkg.version}`);
const nextVersion = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;

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
const nextCode = Number(codeMatches[0][1]) + 1;
if (!Number.isSafeInteger(nextCode)) throw new Error("Android versionCode overflow");
gradle = gradle
  .replace(/\bversionCode\s*=\s*\d+/, `versionCode = ${nextCode}`)
  .replace(/\bversionName\s*=\s*"[^"]+"/, `versionName = "${nextVersion}"`);

if (!checkOnly) {
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  fs.writeFileSync(gradlePath, gradle);
}
console.log(`Prepared continuous release v${nextVersion} (Android code ${nextCode})`);
