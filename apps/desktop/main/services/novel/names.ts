import { createHash } from "node:crypto";

/*
 * File and folder names for novel ids. NovelBuddy ids are case-sensitive and
 * Windows file names aren't, so ids are hex-encoded; Novel Phoenix ids are
 * address slugs of up to 120 characters, whose hex would overrun Windows' path
 * limit, so a long id keeps the start of its hex and ends in a hash of the whole
 * id. Short ids (every NovelBuddy and NovelArchive id) are named exactly as before.
 */

const HEX_MAX = 96;

export const hex = (value: string) => Buffer.from(value, "utf-8").toString("hex");
export const unhex = (value: string) => Buffer.from(value, "hex").toString("utf-8");

const digest = (value: string) => createHash("sha256").update(value, "utf-8").digest("hex");

/** A name for [id] that is safe on every file system, the same on every run, and never shared by two ids. */
export function fileStem(id: string): string {
  const full = hex(id);
  // Plain hex never contains "-", so the two forms can't collide.
  return full.length <= HEX_MAX ? full : `${full.slice(0, 64)}-${digest(id).slice(0, 32)}`;
}

/**
 * A short lower-case name for a slug id (letters, digits and hyphens only), for the
 * disk cache's 100-character names: the slug itself, or its start and a hash.
 */
export function slugStem(slug: string): string {
  // Slugs never contain "_", so the two forms can't collide.
  return slug.length <= 60 ? slug : `${slug.slice(0, 40)}_${digest(slug).slice(0, 24)}`;
}
