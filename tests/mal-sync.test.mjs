import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// The real mal.ts against an in-memory auth store, list and network. These hooks
// never load the installed app's tokens or database, and nothing reaches MyAnimeList.
const fixture = { store: {}, anime: new Map(), dirty: new Map(), requests: [], respond: null };
globalThis.__malFixture = fixture;

const mocks = {
  electron: "export class BrowserWindow {}",
  store: `
    export class SimpleStore {
      get(key) { return globalThis.__malFixture.store[key]; }
      set(key, value) { globalThis.__malFixture.store[key] = value; }
      delete(key) { delete globalThis.__malFixture.store[key]; }
    }
  `,
  db: `
    const f = globalThis.__malFixture;
    export const getDirtyEntries = () => [...f.dirty.values()];
    export const clearDirty = (id) => { f.dirty.delete(id); };
    export const getAnime = (id) => f.anime.get(id) ?? null;
    export const getAnimeByMalId = () => null, getListEntry = () => null, isListEntryDirty = () => false,
      realAnimeIdForMal = () => null, setListEntry = () => {}, upsertAnime = () => {};
  `,
  anilist: "export const getByMalIds = async () => new Map();",
  "remote-config": "export const getRuntimeConfig = () => ({ features: { malSync: true } });",
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

const { flushDirty, getState, disconnect, onMalStateChange, pullList } =
  await import("../apps/desktop/main/services/mal.ts");

const states = [];
onMalStateChange((state) => states.push(state));

const TOKEN_URL = "https://myanimelist.net/v1/oauth2/token";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const refused = () => json(401, { error: "invalid_token" });
const granted = () => json(200, { access_token: "fresh", refresh_token: "r2", expires_in: 2_678_400 });
const sent = () => fixture.requests.map((r) => `${r.method} ${r.url.replace("https://api.myanimelist.net/v2", "")} ${r.auth ?? "-"}`);

// Like 15 Oct 2026: MAL refuses a token whose recorded expiry is still a day away.
function reset(t, { dirty = 1 } = {}) {
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  fixture.store = {
    malTokens: { access_token: "dead", refresh_token: "r1", expires_at: Date.now() + 86_400_000, username: "kil-04" },
  };
  fixture.anime.clear();
  fixture.dirty.clear();
  fixture.requests.length = 0;
  states.length = 0;
  for (let id = 1; id <= dirty; id++) {
    fixture.anime.set(id, { id, malId: 100 + id, title: `Show ${id}`, genres: [], studios: [] });
    fixture.dirty.set(id, { animeId: id, status: "watching", episodesWatched: id, score: null, updatedAt: 1 });
  }
}

test("a token MAL refuses early is refreshed once, and the push is sent again", async (t) => {
  reset(t, { dirty: 3 });
  fixture.respond = ({ url, auth }) => url === TOKEN_URL ? granted() : auth === "Bearer dead" ? refused() : json(200, {});

  assert.deepEqual(await flushDirty(), { pushed: 3, errors: 0 });
  assert.deepEqual(sent(), [
    "PATCH /anime/101/my_list_status Bearer dead",
    `POST ${TOKEN_URL} -`,
    "PATCH /anime/101/my_list_status Bearer fresh",
    "PATCH /anime/102/my_list_status Bearer fresh",
    "PATCH /anime/103/my_list_status Bearer fresh",
  ]);
  const [first, refresh, retry] = fixture.requests;
  assert.equal(retry.body, first.body, "the retry sends the same change");
  assert.match(refresh.body, /grant_type=refresh_token/);
  assert.match(refresh.body, /refresh_token=r1/);
  assert.deepEqual(
    { ...fixture.store.malTokens, expires_at: undefined },
    { access_token: "fresh", refresh_token: "r2", expires_at: undefined, username: "kil-04" },
  );
  assert.equal(fixture.dirty.size, 0);
  assert.deepEqual(states, [], "still signed in: the renderer has nothing to repaint");
  assert.equal(getState().connected, true);
});

test("requests refused at the same time share one refresh (MAL rotates refresh tokens)", async (t) => {
  reset(t);
  let release;
  const bothRefused = new Promise((resolve) => { release = resolve; });
  let deadSent = 0;
  fixture.respond = async ({ url, auth }) => {
    if (url === TOKEN_URL) { await bothRefused; return granted(); }
    if (auth === "Bearer dead") { if (++deadSent === 2) release(); return refused(); }
    return json(200, url.includes("/animelist") ? { data: [], paging: {} } : {});
  };

  const [flushed, pulled] = await Promise.all([flushDirty(), pullList()]);
  assert.deepEqual(flushed, { pushed: 1, errors: 0 });
  assert.deepEqual(pulled, { imported: 0 });
  assert.equal(deadSent, 2);
  assert.equal(fixture.requests.filter((r) => r.url === TOKEN_URL).length, 1, "one refresh for both");
  assert.equal(fixture.requests.filter((r) => r.auth === "Bearer fresh").length, 2, "both sent again with the new token");
  assert.equal(fixture.store.malTokens.refresh_token, "r2");
});

test("MAL refusing the refresh signs out once, tells the renderer, and retries nothing", async (t) => {
  reset(t, { dirty: 3 });
  fixture.respond = ({ url }) => url === TOKEN_URL ? json(400, { error: "invalid_grant" }) : refused();

  assert.deepEqual(await flushDirty(), { pushed: 0, errors: 1 });
  assert.deepEqual(sent(), ["PATCH /anime/101/my_list_status Bearer dead", `POST ${TOKEN_URL} -`]);
  assert.equal(fixture.store.malTokens, undefined);
  assert.equal(fixture.dirty.size, 3, "unsent changes wait for the reconnect");
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
  fixture.respond = ({ url }) => url === TOKEN_URL ? granted() : refused();

  assert.deepEqual(await flushDirty(), { pushed: 0, errors: 1 });
  assert.deepEqual(sent(), [
    "PATCH /anime/101/my_list_status Bearer dead",
    `POST ${TOKEN_URL} -`,
    "PATCH /anime/101/my_list_status Bearer fresh",
  ]);
  assert.equal(fixture.store.malTokens, undefined);
  assert.deepEqual(states.map((s) => s.needsReconnect), [true]);
  fixture.requests.length = 0;
  assert.deepEqual(await flushDirty(), { pushed: 0, errors: 0 });
  assert.deepEqual(fixture.requests, []);
});

test("a refresh that can't reach MAL keeps the sign-in for the next flush", async (t) => {
  reset(t, { dirty: 3 });
  fixture.respond = ({ url }) => { if (url === TOKEN_URL) throw new TypeError("fetch failed"); return refused(); };

  assert.deepEqual(await flushDirty(), { pushed: 0, errors: 1 });
  assert.deepEqual(sent(), ["PATCH /anime/101/my_list_status Bearer dead", `POST ${TOKEN_URL} -`]);
  assert.equal(fixture.store.malTokens.access_token, "dead");
  assert.equal(fixture.dirty.size, 3);
  assert.deepEqual(states, []);
  assert.equal(getState().connected, true);
});
