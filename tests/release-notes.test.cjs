const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSubject, formatReleaseNotes } = require("../scripts/release-notes.js");

test("commit subjects become release-note lines by kind and app", () => {
  assert.deepEqual(parseSubject("feat: background music in both apps"), { kind: "feat", line: "Background music in both apps" });
  assert.deepEqual(parseSubject("fix(android): keep the search box usable"), { kind: "fix", line: "Android: Keep the search box usable" });
  assert.deepEqual(parseSubject("perf(desktop): faster Latest Episodes"), { kind: "perf", line: "Desktop: Faster Latest Episodes" });
  // Unknown scopes stay out of the line; release bumps and chores are not user-facing.
  assert.equal(parseSubject("fix(manga): reader").line, "Reader");
  assert.equal(parseSubject("chore(release): v9.0.1"), null);
  assert.equal(parseSubject("docs: readme"), null);
  assert.equal(parseSubject("Merge branch 'main'"), null);
});

test("notes group new, faster and fixed, oldest first, with downloads and the comparison", () => {
  const notes = formatReleaseNotes(
    [
      "perf(desktop): faster, shorter Latest Episodes",
      "fix(android): keep the search box usable while the music controls show",
      "feat: background music in both apps, with a built-in piano track",
      "fix(desktop): merge duplicate My List entries from MAL imports",
      "chore(release): v9.0.1",
      "fix(desktop): keep completed anime completed while rewatching",
    ],
    { owner: "kil-04", repo: "AniTrack", tag: "v9.0.2", previous: "v9.0.1" },
  );
  assert.match(notes, /^### New\n\n- Background music in both apps, with a built-in piano track\n\n### Faster\n\n- Desktop: Faster, shorter Latest Episodes\n\n### Fixed\n\n/);
  const fixed = notes.split("### Fixed\n\n")[1].split("\n\n")[0].split("\n");
  assert.deepEqual(fixed, [
    "- Desktop: Keep completed anime completed while rewatching",
    "- Desktop: Merge duplicate My List entries from MAL imports",
    "- Android: Keep the search box usable while the music controls show",
  ]);
  assert.match(notes, /`AniTrack-Setup-9\.0\.2\.exe`/);
  assert.match(notes, /`AniTrack-Android-Next-9\.0\.2\.apk`/);
  assert.match(notes, /compare\/v9\.0\.1\.\.\.v9\.0\.2$/);
});

test("a release with nothing user-facing still says something", () => {
  const notes = formatReleaseNotes(["chore(release): v9.0.3"], { owner: "o", repo: "r", tag: "v9.0.3", previous: null });
  assert.match(notes, /^Maintenance release/);
  assert.doesNotMatch(notes, /Full changelog/);
});
