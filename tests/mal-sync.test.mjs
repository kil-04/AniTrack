import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire, registerHooks } from "node:module";

// The real mal.ts and db.ts (SQLite in a temp folder) against an in-memory auth
// store and a fake MyAnimeList. These hooks never load the installed app's tokens
// or database, and nothing reaches MyAnimeList.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "anitrack-mal-test-"));
let closeDb = () => {};
after(() => {
  try {
    closeDb();
    fs.rmSync(userData, { recursive: true, force: true });
  } catch { /* the OS cleans its temp folder */ }
});
const fixture = { userData, store: {}, requests: [], respond: null, mal: {} };
globalThis.__malFixture = fixture;
const sqlite = createRequire(import.meta.url).resolve("node-sqlite3-wasm");

const mocks = {
  electron: `
    export class BrowserWindow {}
    export const app = { getPath: () => globalThis.__malFixture.userData };
  `,
  store: `
    export class SimpleStore {
      get(key) { return globalThis.__malFixture.store[key]; }
      set(key, value) { globalThis.__malFixture.store[key] = value; }
      delete(key) { delete globalThis.__malFixture.store[key]; }
    }
  `,
  anilist: "export const getByMalIds = async () => new Map();",
  "remote-config": "export const getRuntimeConfig = () => ({ features: { malSync: true } });",
  // The real SQLite library; it is CommonJS, which the app's own build requires.
  "node-sqlite3-wasm": `
    import { createRequire } from "node:module";
    export const { Database } = createRequire(${JSON.stringify(import.meta.url)})(${JSON.stringify(sqlite)});
  `,
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    const key = specifier === "electron" ? "electron" : specifier.split("/").at(-1);
    if (key in mocks) return { url: `mal-fixture:${key}`, shortCircuit: true };
    try { return nextResolve(specifier, context); } catch (error) {
      if (/^\.{1,2}\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
      throw error;
    }
  },
  load(url, context, nextLoad) {
    if (url.startsWith("mal-fixture:")) return {
      format: "module", source: mocks[url.slice("mal-fixture:".length)], shortCircuit: true,
    };
    return nextLoad(url, context);
  },
});

globalThis.fetch = async (url, init = {}) => {
  const request = {
    url: String(url), method: init.method ?? "GET",
    auth: new Headers(init.headers).get("Authorization"), body: String(init.body ?? ""),
  };
  fixture.requests.push(request);
  return fixture.respond(request);
};

const { flushDirty, getState, disconnect, markEpisodeWatched, onMalStateChange, pullList } =
  await import("../apps/desktop/main/services/mal.ts");
const { getDb, getListEntry, isListEntryDirty, setListEntry, upsertAnime } =
  await import("../apps/desktop/main/services/db.ts");
closeDb = () => getDb().close();

const states = [];
onMalStateChange((state) => states.push(state));

const TOKEN_URL = "https://myanimelist.net/v1/oauth2/token";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const refused = () => json(401, { error: "invalid_token" });
const granted = () => json(200, { access_token: "fresh", refresh_token: "r2", expires_in: 2_678_400 });
const sent = () => fixture.requests.map((r) => `${r.method} ${r.url.replace("https://api.myanimelist.net/v2", "")} ${r.auth ?? "-"}`);
const patches = () => fixture.requests.filter((r) => r.method === "PATCH").map((r) => r.body);
const read = (malId, auth) => `GET /anime/${malId}?fields=my_list_status ${auth}`;
const write = (malId, auth) => `PATCH /anime/${malId}/my_list_status ${auth}`;

/** MyAnimeList taking only `accept` as the access token; `fixture.mal` is the account's list by MAL id. */
function fakeMal({ accept = "fresh", token = granted } = {}) {
  return ({ url, method, auth, body }) => {
    if (url === TOKEN_URL) return token();
    if (auth !== `Bearer ${accept}`) return refused();
    const { pathname } = new URL(url);
    const entry = /^\/v2\/anime\/(\d+)$/.exec(pathname);
    if (entry) {
      const listed = fixture.mal[entry[1]];
      return json(200, { id: Number(entry[1]), ...(listed && { my_list_status: listed }) });
    }
    const update = /^\/v2\/anime\/(\d+)\/my_list_status$/.exec(pathname);
    if (update && method === "PATCH") {
      const form = new URLSearchParams(body);
      fixture.mal[update[1]] = { status: form.get("status"), num_episodes_watched: Number(form.get("num_watched_episodes")) };
      return json(200, fixture.mal[update[1]]);
    }
    if (pathname === "/v2/users/@me/animelist") return json(200, { data: [], paging: {} });
    throw new Error(`unexpected MAL request: ${method} ${url}`);
  };
}

/** Shows 1..n (MAL ids 101..) with unsent local changes: watching, n episodes in. */
function reset(t, { dirty = 1, accessToken = "dead" } = {}) {
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  fixture.store = {
    malTokens: { access_token: accessToken, refresh_token: "r1", expires_at: Date.now() + 86_400_000, username: "kil-04" },
  };
  fixture.requests.length = 0;
  fixture.mal = {};
  states.length = 0;
  getDb().run("DELETE FROM list_entry");
  getDb().run("DELETE FROM anime");
  for (let id = 1; id <= dirty; id++) local(id, "watching", id);
}

function local(id, status, episodesWatched, updatedAt = 1_000 + id) {
  upsertAnime({ id, malId: 100 + id, title: `Show ${id}`, episodes: 12, genres: [], studios: [] });
  setListEntry({ animeId: id, status, episodesWatched, score: null, updatedAt }, { markDirty: true });
}

const dirtyIds = () => [1, 2, 3, 4].filter((id) => isListEntryDirty(id));

// 15 Oct 2026: MAL refused a token whose recorded expiry was still a day away.
test("a token MAL refuses early is refreshed once, and the request is sent again", async (t) => {
  reset(t, { dirty: 3 });
  fixture.respond = fakeMal();

  assert.deepEqual(await flushDirty(), { pushed: 3, errors: 0 });
  assert.deepEqual(sent(), [
    read(101, "Bearer dead"),
    `POST ${TOKEN_URL} -`,
    read(101, "Bearer fresh"), write(101, "Bearer fresh"),
    read(102, "Bearer fresh"), write(102, "Bearer fresh"),
    read(103, "Bearer fresh"), write(103, "Bearer fresh"),
  ]);
  const refresh = fixture.requests[1];
  assert.match(refresh.body, /grant_type=refresh_token/);
  assert.match(refresh.body, /refresh_token=r1/);
  assert.match(patches()[0], /status=watching&num_watched_episodes=1/);
  assert.deepEqual(
    { ...fixture.store.malTokens, expires_at: undefined },
    { access_token: "fresh", refresh_token: "r2", expires_at: undefined, username: "kil-04" },
  );
  assert.deepEqual(dirtyIds(), []);
  assert.deepEqual(states, [], "still signed in: the renderer has nothing to repaint");
  assert.equal(getState().connected, true);
});

test("requests refused at the same time share one refresh (MAL rotates refresh tokens)", async (t) => {
  reset(t);
  let release;
  const bothRefused = new Promise((resolve) => { release = resolve; });
  let deadSent = 0;
  const mal = fakeMal({ token: async () => { await bothRefused; return granted(); } });
  fixture.respond = (request) => {
    if (request.auth === "Bearer dead" && ++deadSent === 2) release();
    return mal(request);
  };

  const [flushed, pulled] = await Promise.all([flushDirty(), pullList()]);
  assert.deepEqual(flushed, { pushed: 1, errors: 0 });
  assert.deepEqual(pulled, { imported: 0 });
  assert.equal(deadSent, 2);
  assert.equal(fixture.requests.filter((r) => r.url === TOKEN_URL).length, 1, "one refresh for both");
  assert.equal(fixture.store.malTokens.refresh_token, "r2");
});

test("MAL refusing the refresh signs out once, tells the renderer, and retries nothing", async (t) => {
  reset(t, { dirty: 3 });
  fixture.respond = fakeMal({ token: () => json(400, { error: "invalid_grant" }) });

  assert.deepEqual(await flushDirty(), { pushed: 0, errors: 1 });
  assert.deepEqual(sent(), [read(101, "Bearer dead"), `POST ${TOKEN_URL} -`]);
  assert.equal(fixture.store.malTokens, undefined);
  assert.deepEqual(dirtyIds(), [1, 2, 3], "unsent changes wait for the reconnect");
  const signedOut = { connected: false, username: null, expiresAt: null, needsReconnect: true };
  assert.deepEqual(states, [signedOut]);
  assert.deepEqual(getState(), signedOut, "Settings asks to reconnect after a restart too");

  // No loop: later flushes don't touch the network.
  fixture.requests.length = 0;
  assert.deepEqual(await flushDirty(), { pushed: 0, errors: 0 });
  await assert.rejects(pullList(), /Not authenticated with MAL/);
  assert.deepEqual(fixture.requests, []);
  assert.equal(states.length, 1);

  disconnect();
  assert.equal(getState().needsReconnect, false, "Disconnect leaves a plain Connect button");
});

test("a token refused right after MAL issued it ends the sign-in instead of refreshing again", async (t) => {
  reset(t, { dirty: 3 });
  fixture.respond = fakeMal({ accept: "nothing" });

  assert.deepEqual(await flushDirty(), { pushed: 0, errors: 1 });
  assert.deepEqual(sent(), [read(101, "Bearer dead"), `POST ${TOKEN_URL} -`, read(101, "Bearer fresh")]);
  assert.equal(fixture.store.malTokens, undefined);
  assert.deepEqual(states.map((s) => s.needsReconnect), [true]);
  fixture.requests.length = 0;
  assert.deepEqual(await flushDirty(), { pushed: 0, errors: 0 });
  assert.deepEqual(fixture.requests, []);
});

test("a refresh that can't reach MAL keeps the sign-in for the next flush", async (t) => {
  reset(t, { dirty: 3 });
  fixture.respond = fakeMal({ token: () => { throw new TypeError("fetch failed"); } });

  assert.deepEqual(await flushDirty(), { pushed: 0, errors: 1 });
  assert.deepEqual(sent(), [read(101, "Bearer dead"), `POST ${TOKEN_URL} -`]);
  assert.equal(fixture.store.malTokens.access_token, "dead");
  assert.deepEqual(dirtyIds(), [1, 2, 3]);
  assert.deepEqual(states, []);
  assert.equal(getState().connected, true);
});

test("a desktop copy that is behind MAL never moves MAL backwards", async (t) => {
  reset(t, { dirty: 0, accessToken: "fresh" });
  fixture.respond = fakeMal();
  // The tablet sent these to MAL; this copy is a day behind.
  fixture.mal = {
    101: { status: "completed", num_episodes_watched: 12 },
    102: { status: "watching", num_episodes_watched: 8 },
    104: { status: "watching", num_episodes_watched: 6 },
  };
  local(1, "watching", 11); // finished on the tablet, rewatched here
  local(2, "watching", 5); // the tablet is 3 episodes further
  local(3, "watching", 3); // not on MAL yet
  local(4, "on_hold", 2); // put on hold here by hand

  assert.deepEqual(await flushDirty(), { pushed: 4, errors: 0 });
  assert.deepEqual(fixture.mal, {
    101: { status: "completed", num_episodes_watched: 12 },
    102: { status: "watching", num_episodes_watched: 8 },
    103: { status: "watching", num_episodes_watched: 3 },
    104: { status: "on_hold", num_episodes_watched: 6 },
  });
  // This copy catches up with what MAL has.
  assert.deepEqual([1, 2, 3, 4].map((id) => [getListEntry(id).status, getListEntry(id).episodesWatched]), [
    ["completed", 12], ["watching", 8], ["watching", 3], ["on_hold", 6],
  ]);
  assert.deepEqual(dirtyIds(), []);
});

test("a change made while the flush was sending stays queued for the next one", async (t) => {
  reset(t, { dirty: 0, accessToken: "fresh" });
  local(1, "watching", 4);
  const mal = fakeMal();
  fixture.respond = (request) => {
    // Episode 5 finishes on this PC while episode 4 is on its way to MAL.
    if (request.method === "PATCH" && getListEntry(1).episodesWatched === 4) {
      setListEntry({ animeId: 1, status: "watching", episodesWatched: 5, score: null, updatedAt: 9_000 }, { markDirty: true });
    }
    return mal(request);
  };

  assert.deepEqual(await flushDirty(), { pushed: 1, errors: 0 });
  assert.equal(fixture.mal[101].num_episodes_watched, 4);
  assert.equal(getListEntry(1).episodesWatched, 5);
  assert.deepEqual(dirtyIds(), [1]);

  assert.deepEqual(await flushDirty(), { pushed: 1, errors: 0 });
  assert.equal(fixture.mal[101].num_episodes_watched, 5);
  assert.deepEqual(dirtyIds(), []);
});

test("starting a show MAL already has as completed doesn't reopen it or rewrite its dates", async (t) => {
  reset(t, { dirty: 0, accessToken: "fresh" });
  fixture.respond = fakeMal();
  fixture.mal = { 101: { status: "completed", num_episodes_watched: 12 } };
  upsertAnime({ id: 1, malId: 101, title: "Show 1", episodes: 12, genres: [], studios: [] });

  await markEpisodeWatched(1, 1); // not on this PC's list: looks like a first watch
  for (let i = 0; i < 50 && patches().length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(patches(), ["status=completed&num_watched_episodes=12"]);
  assert.deepEqual(fixture.mal[101], { status: "completed", num_episodes_watched: 12 });
});
