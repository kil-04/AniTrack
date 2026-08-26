const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  ROOT,
  TRUST_PATH,
  sha256File,
  validateAndroidUpdate,
} = require("./automation-common");

const EXPECTED_APPLICATION_ID = "com.sanjay.anitrack.next";
const ANDROID_ROOT = path.join(ROOT, "apps", "android");
const GRADLE_PATH = path.join(ANDROID_ROOT, "app", "build.gradle.kts");
const APK_PATH = path.join(ANDROID_ROOT, "app", "build", "outputs", "apk", "release", "app-release.apk");

function readAndroidMetadata() {
  const gradle = fs.readFileSync(GRADLE_PATH, "utf8");
  const codes = [...gradle.matchAll(/\bversionCode\s*=\s*(\d+)/g)].map((match) => match[1]);
  const names = [...gradle.matchAll(/\bversionName\s*=\s*"([^"]+)"/g)].map((match) => match[1]);
  if (codes.length !== 1 || names.length !== 1) {
    throw new Error("Native Android Gradle file must contain exactly one literal versionCode and versionName");
  }
  const versionCode = Number(codes[0]);
  if (!Number.isSafeInteger(versionCode) || versionCode <= 0) throw new Error("Native Android versionCode is invalid");
  return { versionCode, versionName: names[0] };
}

function decodeLocalProperties(value) {
  return value.replace(/\\:/g, ":").replace(/\\\\/g, "\\");
}

function sdkRoot() {
  const candidates = [process.env.ANDROID_SDK_ROOT, process.env.ANDROID_HOME];
  const propertiesPath = path.join(ANDROID_ROOT, "local.properties");
  if (fs.existsSync(propertiesPath)) {
    const match = /^sdk\.dir\s*=\s*(.+)$/m.exec(fs.readFileSync(propertiesPath, "utf8"));
    if (match) candidates.push(decodeLocalProperties(match[1].trim()));
  }
  const found = candidates.filter(Boolean).map((candidate) => path.resolve(candidate)).find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("Android SDK not found. Set ANDROID_SDK_ROOT/ANDROID_HOME or apps/android/local.properties");
  return found;
}

function versionParts(name) {
  return name.split(/[.-]/).map((part) => /^\d+$/.test(part) ? Number(part) : part);
}

function compareBuildTools(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const av = a[index] ?? 0;
    const bv = b[index] ?? 0;
    if (typeof av === "number" && typeof bv === "number" && av !== bv) return av - bv;
    const compared = String(av).localeCompare(String(bv));
    if (compared) return compared;
  }
  return 0;
}

function androidTools() {
  const buildTools = path.join(sdkRoot(), "build-tools");
  if (!fs.existsSync(buildTools)) throw new Error(`Android SDK build-tools directory is missing: ${buildTools}`);
  const executable = (name) => process.platform === "win32" ? `${name}.exe` : name;
  const batch = (name) => process.platform === "win32" ? `${name}.bat` : name;
  const versions = fs.readdirSync(buildTools, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareBuildTools)
    .reverse();
  for (const version of versions) {
    const directory = path.join(buildTools, version);
    let apksigner = [path.join(directory, executable("apksigner")), path.join(directory, batch("apksigner"))]
      .find((candidate) => fs.existsSync(candidate));
    const aapt = path.join(directory, executable("aapt"));
    if (apksigner && fs.existsSync(aapt)) {
      let apksignerPrefix = [];
      if (/\.(?:bat|cmd)$/i.test(apksigner)) {
        const jar = path.join(directory, "lib", "apksigner.jar");
        if (!fs.existsSync(jar)) continue;
        const javaExecutable = process.platform === "win32" ? "java.exe" : "java";
        const javaHomeTool = process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, "bin", javaExecutable);
        apksigner = javaHomeTool && fs.existsSync(javaHomeTool) ? javaHomeTool : "java";
        apksignerPrefix = ["-jar", jar];
      }
      return { apksigner, apksignerPrefix, aapt, version };
    }
  }
  throw new Error(`No single Android SDK build-tools version contains both apksigner and aapt under ${buildTools}`);
}

function runTool(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  if (result.status !== 0) throw new Error(`${label} failed (${result.status}): ${output.slice(0, 2000)}`);
  return output;
}

function normalizedSha256(value, label) {
  if (typeof value !== "string") throw new Error(`${label} is missing`);
  const normalized = value.replace(/:/g, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${label} must be a SHA-256 certificate digest`);
  return normalized;
}

function verifyAndroidArtifact(apkPath = APK_PATH) {
  if (!fs.existsSync(apkPath) || !fs.statSync(apkPath).isFile()) throw new Error(`Native release APK not found: ${apkPath}`);
  const metadata = readAndroidMetadata();
  const trust = JSON.parse(fs.readFileSync(TRUST_PATH, "utf8"));
  const pinnedCert = normalizedSha256(trust.androidReleaseCertSha256,
    "packages/shared/automation-trust.json androidReleaseCertSha256");
  const tools = androidTools();

  const signerOutput = runTool(
    tools.apksigner,
    [...tools.apksignerPrefix, "verify", "--verbose", "--print-certs", apkPath],
    "apksigner verification",
  );
  const signerDigests = [...signerOutput.matchAll(/certificate SHA-256 digest:\s*([A-Fa-f0-9:]+)/g)]
    .map((match) => normalizedSha256(match[1], "APK signer certificate digest"));
  const uniqueDigests = [...new Set(signerDigests)];
  if (uniqueDigests.length !== 1 || uniqueDigests[0] !== pinnedCert) {
    throw new Error(`APK signing certificate does not exactly match the pinned release certificate (found ${uniqueDigests.join(", ") || "none"})`);
  }

  const badging = runTool(tools.aapt, ["dump", "badging", apkPath], "aapt APK inspection");
  const packageLine = /^package:\s+name='([^']+)'\s+versionCode='([^']+)'\s+versionName='([^']+)'/m.exec(badging);
  if (!packageLine) throw new Error("aapt did not report APK package/version metadata");
  const [, applicationId, apkVersionCodeText, apkVersionName] = packageLine;
  const apkVersionCode = Number(apkVersionCodeText);
  if (applicationId !== EXPECTED_APPLICATION_ID) {
    throw new Error(`APK package is ${applicationId}; expected ${EXPECTED_APPLICATION_ID}`);
  }
  if (apkVersionCode !== metadata.versionCode || apkVersionName !== metadata.versionName) {
    throw new Error(
      `APK version ${apkVersionCode}/${apkVersionName} does not match Gradle ${metadata.versionCode}/${metadata.versionName}`,
    );
  }

  return {
    ...metadata,
    applicationId,
    apkPath,
    sha256: sha256File(apkPath),
    sizeBytes: fs.statSync(apkPath).size,
    signerSha256: pinnedCert,
    buildToolsVersion: tools.version,
  };
}

function assertManifestMatchesArtifact(manifest, artifact) {
  validateAndroidUpdate(manifest);
  if (manifest.applicationId !== artifact.applicationId ||
      manifest.versionCode !== artifact.versionCode ||
      manifest.versionName !== artifact.versionName ||
      manifest.sha256 !== artifact.sha256 ||
      manifest.sizeBytes !== artifact.sizeBytes) {
    throw new Error("Signed Android update manifest does not exactly describe the verified release APK");
  }
  const assetName = path.basename(new URL(manifest.apkUrl).pathname);
  const expectedName = `AniTrack-Android-Next-${artifact.versionName}.apk`;
  if (assetName !== expectedName) throw new Error(`Update APK asset name must be exactly ${expectedName}`);
}

if (require.main === module) {
  try {
    const artifact = verifyAndroidArtifact();
    console.log(
      `Verified Android release APK: ${artifact.applicationId} ${artifact.versionCode}/${artifact.versionName}, ` +
      `certificate ${artifact.signerSha256}, build-tools ${artifact.buildToolsVersion}`,
    );
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}

module.exports = {
  EXPECTED_APPLICATION_ID,
  APK_PATH,
  readAndroidMetadata,
  verifyAndroidArtifact,
  assertManifestMatchesArtifact,
};
