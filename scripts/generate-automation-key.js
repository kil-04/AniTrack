#!/usr/bin/env node
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  TRUST_PATH,
  loadLocalEnv,
  setEnvValue,
} = require("./automation-common");

loadLocalEnv();
if ((process.env.ANITRACK_AUTOMATION_PRIVATE_KEY_B64 || fs.existsSync(TRUST_PATH)) &&
    !process.argv.includes("--force")) {
  console.error("Automation signing material already exists. Refusing to replace the trust root.");
  console.error("Use --force only before any build containing the old public key has been distributed.");
  process.exit(1);
}

const pair = crypto.generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
  publicKeyEncoding: { type: "spki", format: "der" },
  privateKeyEncoding: { type: "pkcs8", format: "der" },
});

setEnvValue("ANITRACK_AUTOMATION_PRIVATE_KEY_B64", pair.privateKey.toString("base64"));
fs.mkdirSync(path.dirname(TRUST_PATH), { recursive: true });
const trust = {
  schemaVersion: 1,
  algorithm: "ECDSA_P256_SHA256",
  publicKeySpkiBase64: pair.publicKey.toString("base64"),
  configUrl: "https://raw.githubusercontent.com/kil-04/AniTrack/main/automation/remote-config.json",
  configSignatureUrl: "https://raw.githubusercontent.com/kil-04/AniTrack/main/automation/remote-config.sig",
  androidUpdateManifestUrl: "https://github.com/kil-04/AniTrack/releases/latest/download/anitrack-next-update.json",
  androidUpdateSignatureUrl: "https://github.com/kil-04/AniTrack/releases/latest/download/anitrack-next-update.sig"
};
fs.writeFileSync(TRUST_PATH, JSON.stringify(trust, null, 2) + "\n");
const fingerprint = crypto.createHash("sha256").update(pair.publicKey).digest("hex");
console.log(`Created automation trust key. Public-key SHA-256: ${fingerprint}`);
console.log("The private key was stored in .env and was not printed. Back up .env securely.");
