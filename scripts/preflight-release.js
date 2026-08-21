#!/usr/bin/env node
const { tag, releaseByTag, assertDraftRelease } = require("./github-release-common");

async function main() {
  const release = await releaseByTag({ allowMissing: true });
  assertDraftRelease(release, { allowMissing: true });
  console.log(release
    ? `Verified ${tag} is still a draft and may receive release assets.`
    : `No existing ${tag} release found; the publisher may create a new draft.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
