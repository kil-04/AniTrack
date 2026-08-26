#!/usr/bin/env node
const path = require("path");
const { spawnSync } = require("child_process");
const { ROOT, loadLocalEnv } = require("./automation-common");

loadLocalEnv();
const androidRoot = path.join(ROOT, "apps", "android");
const command = path.join(androidRoot, process.platform === "win32" ? "gradlew.bat" : "gradlew");
const args = process.argv.slice(2);
if (!args.length) args.push(":app:assembleRelease");
const result = spawnSync(command, args, {
  cwd: androidRoot,
  env: process.env,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
