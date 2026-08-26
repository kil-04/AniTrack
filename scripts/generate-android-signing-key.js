#!/usr/bin/env node
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { ROOT, loadLocalEnv, setEnvValue } = require("./automation-common");

loadLocalEnv();
const secretDir = path.join(ROOT, ".release-secrets");
const keyPath = path.join(secretDir, "anitrack-next.jks");
const signingVariables = [
  "ANITRACK_ANDROID_KEYSTORE_FILE",
  "ANITRACK_ANDROID_KEYSTORE_PASSWORD",
  "ANITRACK_ANDROID_KEY_ALIAS",
  "ANITRACK_ANDROID_KEY_PASSWORD",
];
if (fs.existsSync(keyPath) || signingVariables.some((name) => Boolean(process.env[name]))) {
  console.error("Android release signing material already exists. Refusing to replace it.");
  console.error("Replacing this key would permanently break updates for every installed release build.");
  process.exit(1);
}

fs.mkdirSync(secretDir, { recursive: true });
const temporaryKeyPath = path.join(
  secretDir,
  `.anitrack-next-${process.pid}-${crypto.randomBytes(8).toString("hex")}.jks.tmp`,
);
const password = crypto.randomBytes(36).toString("base64url");
const alias = "anitrack-next";
function findKeytool() {
  const executable = process.platform === "win32" ? "keytool.exe" : "keytool";
  const candidates = [];
  if (process.env.JAVA_HOME) candidates.push(path.join(process.env.JAVA_HOME, "bin", executable));
  const java = spawnSync("java", ["-XshowSettings:properties", "-version"], { encoding: "utf8" });
  const home = /java\.home\s*=\s*([^\r\n]+)/.exec(`${java.stdout || ""}\n${java.stderr || ""}`)?.[1]?.trim();
  if (home) candidates.push(path.join(home, "bin", executable));
  if (process.platform === "win32") {
    candidates.push("C:\\Program Files\\Android\\Android Studio\\jbr\\bin\\keytool.exe");
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) || "keytool";
}

const result = spawnSync(findKeytool(), [
  "-genkeypair",
  "-keystore", temporaryKeyPath,
  "-storetype", "PKCS12",
  "-storepass", password,
  "-keypass", password,
  "-alias", alias,
  "-keyalg", "RSA",
  "-keysize", "4096",
  "-validity", "10000",
  "-dname", "CN=AniTrack, OU=Release, O=AniTrack, L=Unknown, ST=Unknown, C=IN",
], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });

if (result.status !== 0) {
  // This is a unique temporary file created by this invocation. The permanent
  // path is never opened, overwritten, or removed by the generator.
  try { fs.rmSync(temporaryKeyPath, { force: true }); } catch {}
  console.error("keytool failed:", (result.error?.message || result.stderr || result.stdout || "unknown error").trim());
  process.exit(result.status || 1);
}

let copyError = null;
try {
  fs.copyFileSync(temporaryKeyPath, keyPath, fs.constants.COPYFILE_EXCL);
} catch (error) {
  copyError = error;
} finally {
  try { fs.rmSync(temporaryKeyPath, { force: true }); } catch {}
}
if (copyError) {
  console.error(`Refusing to replace the permanent Android keystore: ${copyError.message}`);
  process.exit(1);
}

setEnvValue("ANITRACK_ANDROID_KEYSTORE_FILE", "../../.release-secrets/anitrack-next.jks");
setEnvValue("ANITRACK_ANDROID_KEYSTORE_PASSWORD", password);
setEnvValue("ANITRACK_ANDROID_KEY_ALIAS", alias);
setEnvValue("ANITRACK_ANDROID_KEY_PASSWORD", password);
console.log(`Created permanent Android release keystore at ${path.relative(ROOT, keyPath)}.`);
console.log("Passwords were stored in .env and were not printed. Back up both files securely.");
