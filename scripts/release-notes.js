#!/usr/bin/env node
/**
 * Release notes from the commit subjects between two release tags, grouped by
 * kind (Conventional Commits): what's new, what got faster, what was fixed.
 * Only user-facing kinds are listed; release bumps and chores are left out.
 *
 *   node scripts/release-notes.js v9.0.2   (prints the notes for that tag)
 */
const { execFileSync } = require("node:child_process");

const SECTIONS = [
  ["feat", "New"],
  ["perf", "Faster"],
  ["fix", "Fixed"],
];
const SCOPES = { desktop: "Desktop", android: "Android" };
const SUBJECT = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;

/** One commit subject → { kind, line } (null when it isn't user-facing). */
function parseSubject(subject) {
  const match = SUBJECT.exec(String(subject).trim());
  if (!match) return null;
  const [, kind, scope, , text] = match;
  if (!SECTIONS.some(([k]) => k === kind)) return null;
  const app = scope ? SCOPES[scope.toLowerCase()] : null;
  const sentence = text.charAt(0).toUpperCase() + text.slice(1);
  return { kind, line: app ? `${app}: ${sentence}` : sentence };
}

/**
 * Markdown notes for [tag] from its commit [subjects] (newest first, as git log
 * prints them). [previous] links the full comparison when known.
 */
function formatReleaseNotes(subjects, { owner, repo, tag, previous }) {
  const groups = new Map(SECTIONS.map(([kind]) => [kind, []]));
  for (const subject of subjects) {
    const parsed = parseSubject(subject);
    if (parsed && !groups.get(parsed.kind).includes(parsed.line)) groups.get(parsed.kind).push(parsed.line);
  }
  const parts = [];
  for (const [kind, title] of SECTIONS) {
    // Oldest first reads like a story of the release.
    const lines = groups.get(kind).slice().reverse();
    if (lines.length) parts.push(`### ${title}\n\n${lines.map((line) => `- ${line}`).join("\n")}`);
  }
  if (!parts.length) parts.push("Maintenance release: behind-the-scenes improvements.");
  const version = String(tag).replace(/^v/, "");
  parts.push(
    "### Download\n\n" +
      `- **Windows:** \`AniTrack-Setup-${version}.exe\`\n` +
      `- **Android:** \`AniTrack-Android-Next-${version}.apk\`\n\n` +
      "Already installed? Both apps update themselves.",
  );
  if (previous) parts.push(`**Full changelog:** https://github.com/${owner}/${repo}/compare/${previous}...${tag}`);
  return parts.join("\n\n");
}

/** The release tag before [tag] (null for the first release). */
function previousTag(tag, cwd = process.cwd()) {
  try {
    return execFileSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v*", `${tag}^`], { cwd, encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

/** Notes for [tag], read from this repository's history. */
function releaseNotesFor({ owner, repo, tag, cwd = process.cwd() }) {
  const previous = previousTag(tag, cwd);
  const range = previous ? `${previous}..${tag}` : tag;
  const log = execFileSync("git", ["log", "--no-merges", "--format=%s", range], { cwd, encoding: "utf8" });
  return formatReleaseNotes(log.split(/\r?\n/).filter(Boolean), { owner, repo, tag, previous });
}

if (require.main === module) {
  const tag = process.argv[2];
  if (!tag) {
    console.error("Usage: node scripts/release-notes.js <tag>");
    process.exit(1);
  }
  console.log(releaseNotesFor({ owner: "kil-04", repo: "AniTrack", tag }));
}

module.exports = { parseSubject, formatReleaseNotes, previousTag, releaseNotesFor };
