#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const https = require("https");
const sodium = require("libsodium-wrappers");
const { ROOT, loadLocalEnv } = require("./automation-common");

loadLocalEnv();

const pkg = require(path.join(ROOT, "package.json"));
const owner = pkg.build?.publish?.owner;
const repo = pkg.build?.publish?.repo;
const token = process.env.GH_TOKEN;
const environmentName = "production";

if (!owner || !repo) throw new Error("GitHub release owner/repository is missing from package.json");
if (!token) throw new Error("GH_TOKEN is missing from .env");

function request(method, requestPath, body) {
  const encoded = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.github.com",
      path: requestPath,
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "anitrack-production-setup",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(encoded ? {
          "Content-Type": "application/json",
          "Content-Length": String(encoded.length),
        } : {}),
      },
    }, (response) => {
      const chunks = [];
      let received = 0;
      response.on("data", (chunk) => {
        received += chunk.length;
        if (received > 1024 * 1024) {
          response.destroy(new Error("GitHub response exceeded 1 MiB"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed = null;
        if (text) {
          try { parsed = JSON.parse(text); }
          catch { return reject(new Error(`GitHub returned invalid JSON (${response.statusCode})`)); }
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const message = parsed?.message || `HTTP ${response.statusCode}`;
          return reject(new Error(`GitHub ${method} ${requestPath} failed: ${message}`));
        }
        resolve(parsed);
      });
    });
    req.setTimeout(30000, () => req.destroy(new Error("GitHub request timed out")));
    req.on("error", reject);
    if (encoded) req.write(encoded);
    req.end();
  });
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is missing from .env`);
  return value;
}

function resolveKeystore() {
  const configured = process.env.ANITRACK_ANDROID_KEYSTORE_FILE?.trim();
  const candidates = [
    configured && path.resolve(ROOT, configured),
    configured && path.resolve(ROOT, "anitrack-android", configured),
    path.join(ROOT, ".release-secrets", "anitrack-next.jks"),
  ].filter(Boolean);
  const keystore = candidates.find((candidate) => fs.existsSync(candidate));
  if (!keystore) throw new Error("The permanent Android release keystore could not be found");
  const bytes = fs.readFileSync(keystore);
  if (bytes.length < 100 || bytes.length > 1024 * 1024) throw new Error("Android keystore size is invalid");
  return bytes.toString("base64");
}

async function main() {
  const repository = await request("GET", `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  if (!Number.isSafeInteger(repository?.id)) throw new Error("GitHub did not return a repository ID");

  await request(
    "PUT",
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/environments/${environmentName}`,
    {},
  );
  const publicKey = await request(
    "GET",
    `/repositories/${repository.id}/environments/${environmentName}/secrets/public-key`,
  );
  if (typeof publicKey?.key !== "string" || typeof publicKey?.key_id !== "string") {
    throw new Error("GitHub did not return the environment encryption key");
  }

  const secrets = new Map([
    ["ANITRACK_AUTOMATION_PRIVATE_KEY_B64", required("ANITRACK_AUTOMATION_PRIVATE_KEY_B64")],
    ["ANITRACK_ANDROID_KEYSTORE_B64", resolveKeystore()],
    ["ANITRACK_ANDROID_KEYSTORE_PASSWORD", required("ANITRACK_ANDROID_KEYSTORE_PASSWORD")],
    ["ANITRACK_ANDROID_KEY_ALIAS", required("ANITRACK_ANDROID_KEY_ALIAS")],
    ["ANITRACK_ANDROID_KEY_PASSWORD", required("ANITRACK_ANDROID_KEY_PASSWORD")],
  ]);
  const windowsCertificate = process.env.CSC_LINK?.trim();
  const windowsPassword = process.env.CSC_KEY_PASSWORD?.trim();
  if (windowsCertificate && windowsPassword) {
    secrets.set("WINDOWS_CSC_LINK", windowsCertificate);
    secrets.set("WINDOWS_CSC_KEY_PASSWORD", windowsPassword);
  }

  await sodium.ready;
  const keyBytes = sodium.from_base64(publicKey.key, sodium.base64_variants.ORIGINAL);
  for (const [name, value] of secrets) {
    const encrypted = sodium.crypto_box_seal(sodium.from_string(value), keyBytes);
    await request(
      "PUT",
      `/repositories/${repository.id}/environments/${environmentName}/secrets/${name}`,
      {
        encrypted_value: sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL),
        key_id: publicKey.key_id,
      },
    );
    console.log(`Configured GitHub production secret: ${name}`);
  }

  console.log(`Configured the ${environmentName} environment for ${owner}/${repo}.`);
  if (!windowsCertificate || !windowsPassword) {
    console.warn("Windows Authenticode secrets were not configured; desktop releases remain unsigned.");
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
