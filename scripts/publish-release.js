const fs = require("fs");
const path = require("path");
const https = require("https");

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));
const version = pkg.version;
const token = process.env.GH_TOKEN;
const owner = pkg.build.publish.owner;
const repo = pkg.build.publish.repo;

if (!token) {
  console.error("GH_TOKEN environment variable is not set.");
  process.exit(1);
}

function apiRequest(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.github.com",
      path: urlPath,
      method: method,
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "anitrack-publish",
      },
    };
    if (body) {
      options.headers["Content-Type"] = "application/json";
      options.headers["Content-Length"] = Buffer.byteLength(JSON.stringify(body));
    }
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });
    req.on("error", reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function main() {
  console.log(`Finding release for v${version}...`);
  const releases = await apiRequest("GET", `/repos/${owner}/${repo}/releases`);
  if (!Array.isArray(releases)) {
    console.error("Failed to fetch releases:", releases);
    process.exit(1);
  }
  const release = releases.find((r) => r.tag_name === `v${version}`);
  if (!release) {
    console.error(`No GitHub release found for v${version}.`);
    process.exit(1);
  }

  if (!release.draft) {
    console.log(`Release v${version} is already published!`);
    return;
  }

  console.log(`Updating release v${version} (ID: ${release.id}) draft status to false...`);
  const result = await apiRequest("PATCH", `/repos/${owner}/${repo}/releases/${release.id}`, {
    draft: false
  });
  
  if (result.draft === false) {
    console.log(`Successfully published release: ${result.html_url}`);
  } else {
    console.error("Failed to publish release:", result);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
