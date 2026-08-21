const fs = require("fs");
const path = require("path");
const https = require("https");
const { ROOT, loadLocalEnv } = require("./automation-common");

loadLocalEnv();
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const owner = pkg.build?.publish?.owner;
const repo = pkg.build?.publish?.repo;
const tag = `v${pkg.version}`;

function requireRepositoryMetadata() {
  if (typeof owner !== "string" || !owner || typeof repo !== "string" || !repo ||
      typeof pkg.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(pkg.version)) {
    throw new Error("package.json release repository/version metadata is invalid");
  }
}

function requireToken() {
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error("GH_TOKEN is missing. It belongs only in .env or CI secrets.");
  return token;
}

function request(hostname, apiPath, method = "GET", body, headers = {}, options = {}) {
  const token = requireToken();
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname,
      path: apiPath,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "anitrack-release-automation",
        ...headers,
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const bytes = Buffer.concat(chunks);
        if (options.allow404 && response.statusCode === 404) return resolve(null);
        if (response.statusCode < 200 || response.statusCode >= 300) {
          return reject(new Error(`${method} ${apiPath} failed (${response.statusCode}): ${bytes.toString("utf8", 0, 500)}`));
        }
        if (!bytes.length) return resolve(null);
        const type = String(response.headers["content-type"] || "");
        if (type.includes("json")) {
          try { return resolve(JSON.parse(bytes.toString("utf8"))); }
          catch (error) { return reject(new Error(`${method} ${apiPath} returned invalid JSON: ${error.message}`)); }
        }
        resolve(bytes);
      });
    });
    request.setTimeout(30000, () => request.destroy(new Error(`${method} ${apiPath} timed out`)));
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

async function listedReleaseByTag() {
  const releases = await request(
    "api.github.com",
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=100`,
  );
  if (!Array.isArray(releases)) throw new Error("GitHub returned an invalid release list");
  const matching = releases.filter((release) => release?.tag_name === tag);
  if (matching.length > 1) throw new Error(`GitHub returned duplicate releases for ${tag}`);
  return matching[0] || null;
}

async function releaseByTag({ allowMissing = false, retries = allowMissing ? 0 : 5 } = {}) {
  requireRepositoryMetadata();
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const direct = await request(
      "api.github.com",
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/tags/${encodeURIComponent(tag)}`,
      "GET",
      undefined,
      {},
      { allow404: true },
    );
    if (direct) return direct;

    // GitHub can temporarily (and for some authenticated drafts, consistently)
    // return 404 from the tag endpoint while exposing the same draft in the
    // authenticated release list.
    const listed = await listedReleaseByTag();
    if (listed) return listed;
    if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  if (allowMissing) return null;
  throw new Error(`GitHub release ${tag} does not exist after bounded retries`);
}

function assertDraftRelease(release, { allowMissing = false } = {}) {
  if (!release) {
    if (allowMissing) return;
    throw new Error(`GitHub release ${tag} does not exist`);
  }
  if (release.tag_name !== tag) throw new Error(`GitHub returned an unexpected release tag: ${release.tag_name}`);
  if (release.draft !== true) {
    throw new Error(`GitHub release ${tag} is not a draft. Refusing to mutate or republish an existing release.`);
  }
}

module.exports = {
  pkg,
  owner,
  repo,
  tag,
  request,
  listedReleaseByTag,
  releaseByTag,
  assertDraftRelease,
};
