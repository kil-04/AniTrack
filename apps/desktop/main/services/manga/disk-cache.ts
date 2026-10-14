import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

/**
 * Small JSON files under userData/manga_cache, so title pages open at once (and
 * offline) from the last answers while fresh ones load. Writes go through a temp
 * file; anything unreadable counts as missing.
 */

const MAX_FILES = 200;
const NAME = /^[a-z0-9_-]{1,100}$/;
let writes = 0;

const folder = () => path.join(app.getPath("userData"), "manga_cache");

function fileFor(name: string): string {
  if (!NAME.test(name)) throw new Error("Invalid cache name");
  return path.join(folder(), `${name}.json`);
}

export async function readCached<T>(name: string): Promise<{ at: number; value: T } | null> {
  try {
    const saved = JSON.parse(await fs.promises.readFile(fileFor(name), "utf-8")) as { at?: unknown; value?: unknown };
    return typeof saved.at === "number" && saved.value != null ? { at: saved.at, value: saved.value as T } : null;
  } catch {
    return null;
  }
}

export async function writeCached(name: string, value: unknown): Promise<void> {
  const file = fileFor(name);
  try {
    await fs.promises.mkdir(folder(), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await fs.promises.writeFile(temp, JSON.stringify({ at: Date.now(), value }));
    await fs.promises.rename(temp, file);
    if (++writes % 20 === 0) await prune();
  } catch {
    /* a cache that can't be written is just a slower page */
  }
}

/** Keeps the newest [MAX_FILES] chapter lists (one file per title and source). */
async function prune(): Promise<void> {
  const names = (await fs.promises.readdir(folder()).catch(() => [] as string[])).filter((n) => n.startsWith("chapters-") && n.endsWith(".json"));
  if (names.length <= MAX_FILES) return;
  const dated = await Promise.all(names.map(async (n) => ({ n, t: (await fs.promises.stat(path.join(folder(), n)).catch(() => null))?.mtimeMs ?? 0 })));
  dated.sort((a, b) => b.t - a.t);
  await Promise.all(dated.slice(MAX_FILES).map(({ n }) => fs.promises.rm(path.join(folder(), n), { force: true }).catch(() => {})));
}
