#!/usr/bin/env node
const fs = require("fs");
const {
  CONFIG_PATH,
  CONFIG_SIG_PATH,
  UPDATE_PATH,
  UPDATE_SIG_PATH,
  signFile,
  verifyFile,
  validateRemoteConfig,
  validateAndroidUpdate,
  readJsonFile,
} = require("./automation-common");

const verifyOnly = process.argv.includes("--verify");
const configOnly = process.argv.includes("--config-only");
const updateOnly = process.argv.includes("--update-only");
if (configOnly && updateOnly) throw new Error("--config-only and --update-only are mutually exclusive");
function option(name) {
  const at = process.argv.indexOf(name);
  if (at < 0) return null;
  if (!process.argv[at + 1] || process.argv[at + 1].startsWith("--")) {
    throw new Error(`${name} requires a file path`);
  }
  return process.argv[at + 1];
}

const previousConfigPath = option("--previous-config");
const previousSignaturePath = option("--previous-signature");
if (Boolean(previousConfigPath) !== Boolean(previousSignaturePath)) {
  throw new Error("--previous-config and --previous-signature must be provided together");
}

const config = !updateOnly
  ? readJsonFile(CONFIG_PATH, validateRemoteConfig, "automation/remote-config.json")
  : null;
if (!verifyOnly && previousConfigPath) {
  if (updateOnly) throw new Error("Previous config revision checking cannot be used with --update-only");
  const previous = readJsonFile(previousConfigPath, validateRemoteConfig, "previous remote config");
  if (!verifyFile(previousConfigPath, previousSignaturePath)) {
    throw new Error("Previous remote config signature is invalid; refusing the revision comparison");
  }
  if (config.revision <= previous.revision) {
    throw new Error(`Remote config revision must increase (previous ${previous.revision}, current ${config.revision})`);
  }
  console.log(`Verified remote config revision increase: ${previous.revision} -> ${config.revision}`);
}

const files = updateOnly ? [] : [[CONFIG_PATH, CONFIG_SIG_PATH, "remote config"]];
if (!configOnly && fs.existsSync(UPDATE_PATH)) {
  readJsonFile(UPDATE_PATH, validateAndroidUpdate, "automation/android-update.json");
  files.push([UPDATE_PATH, UPDATE_SIG_PATH, "Android update manifest"]);
}
if (updateOnly && !fs.existsSync(UPDATE_PATH)) throw new Error("automation/android-update.json does not exist");

for (const [input, signature, label] of files) {
  if (!verifyOnly) signFile(input, signature);
  if (!fs.existsSync(signature) || !verifyFile(input, signature)) {
    throw new Error(`Signature verification failed for ${label}: ${input}`);
  }
  console.log(`${verifyOnly ? "Verified" : "Signed and verified"}: ${input}`);
}
