import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

registerHooks({load(url, context, next) {
  if (url.endsWith('/apps/source-service/worker-client.ts')) return {format: 'module', shortCircuit: true,
    source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}}).outputText};
  return next(url, context);
}});
const {SourceServiceClient, SourceServiceClientError} = await import('../apps/source-service/worker-client.ts');
const origin = 'https://source.example', key = 'fixture_key_'.repeat(4);
const asset = character => '/v1/assets/' + character.repeat(32);
const signed = path => '/api/source/asset?receipt=' + path.slice(11) + '&signature=fixture';
const selection = {kind: 'anime', source: 'animepahe', method: 'search', args: ['Show']};
const rpc = value => Response.json({value});
const client = (fetcher, signer = async path => signed(path)) => new SourceServiceClient({origin, key}, {fetch: fetcher, signAsset: signer});
const error = (code, status) => value => {
  assert.ok(value instanceof SourceServiceClientError);
  assert.equal(value.code, code); if (status) assert.equal(value.status, status);
  assert.equal(value.message, code); return true;
};

test('Client config is an exact public HTTPS origin and an explicit bounded key', () => {
  const options = {fetch: async () => rpc([]), signAsset: async path => signed(path)};
  for (const bad of ['http://source.example', origin + '/', origin + '/path', origin + '?x=1', origin + '#fragment',
    'https://user:password@source.example', 'https://localhost', 'https://source.local', 'https://source.internal',
    'https://source.home.arpa', 'https://localhost.example.localdomain', 'https://127.0.0.1', 'https://10.1.2.3',
    'https://169.254.169.254', 'https://100.64.0.1', 'https://192.168.1.2', 'https://172.16.2.3', 'https://198.18.0.1',
    'https://2130706433', 'https://[::1]', 'https://[::ffff:8.8.8.8]', 'https://[fc00::1]', 'https://[2001:db8::1]']) {
    assert.throws(() => new SourceServiceClient({origin: bad, key}, options), error('INVALID_SERVICE_CONFIG', 500), bad);
  }
  for (const bad of ['', 'short', 'a'.repeat(257), 'unsafe key'.repeat(5)]) assert.throws(() => new SourceServiceClient({origin, key: bad}, options), error('INVALID_SERVICE_CONFIG', 500));
  assert.doesNotThrow(() => new SourceServiceClient({origin: 'https://8.8.8.8', key}, options));
  assert.equal(JSON.stringify(new SourceServiceClient({origin, key}, options)), '{}');
});

test('Portable module runs with Web APIs and no process, require, or Node imports', async () => {
  const source = readFileSync(new URL('../apps/source-service/worker-client.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText;
  const exports = {};
  runInNewContext(output, {exports, URL, Response, Headers, AbortController, AbortSignal, ReadableStream,
    TextEncoder, TextDecoder, setTimeout, clearTimeout, fetch: async () => rpc([])});
  const portable = new exports.SourceServiceClient({origin, key}, {signAsset: async path => signed(path)});
  assert.deepEqual(JSON.parse(JSON.stringify(await portable.call(selection))), []);
});

test('Catalogue forwards only new service auth, never visitor cookies, headers or credentials', async () => {
  const calls = [];
  const api = client(async (url, init) => {calls.push({url, init}); return rpc([{title: 'Show', poster: 'https://images.example/poster.jpg'}]);});
  const result = await api.call(selection, undefined, {headers: {Cookie: 'visitor-secret', Authorization: 'visitor-token'}});
  assert.equal(result[0].poster, 'https://images.example/poster.jpg');
  const {url, init} = calls[0]; assert.equal(url, origin + '/v1/rpc'); assert.equal(init.method, 'POST');
  const headers = new Headers(init.headers);
  assert.deepEqual([...headers.keys()].sort(), ['accept', 'authorization', 'content-type']);
  assert.equal(headers.get('authorization'), 'Bearer ' + key);
  assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'manual'); assert.equal(init.cache, 'no-store');
  assert.deepEqual(JSON.parse(init.body), selection);
});

test('Allowlist validates feed, episode, resolve and manga signatures before any fetch', async () => {
  const calls = [];
  const api = client(async (_url, init) => {calls.push(JSON.parse(init.body)); return rpc([]);});
  await api.call({kind: 'anime', source: 'anikoto', method: 'feed', args: ['latest', 1000, 50]});
  await api.call({kind: 'anime', source: 'shonen', method: 'feed', args: ['top', 1, 1]});
  await api.call({kind: 'anime', source: 'anichan', method: 'resolve', args: ['a'.repeat(32)]});
  await api.call({kind: 'manga', source: 'xcomic', method: 'pages', args: [{sourceId: 'xcomic', id: 'book', title: 'Book'}, 'chapter-1']});
  assert.equal(calls.length, 4);
  for (const invalid of [
    {...selection, source: 'https://upstream.example'}, {...selection, source: 'miruro'}, {...selection, method: 'fetch'},
    {...selection, headers: {Cookie: 'secret'}}, {...selection, args: ['x'.repeat(201)]},
    {...selection, method: 'episodes', args: ['show', 0]}, {...selection, method: 'resolve', args: ['https://upstream.example/video']},
    {...selection, method: 'feed', args: ['weekly', 1, 20]}, {...selection, method: 'feed', args: ['latest', 1001, 20]},
    {...selection, method: 'feed', args: ['top', 1, 51]}, {...selection, method: 'feed', args: ['top', 1]},
    {kind: 'manga', source: 'xcomic', method: 'pages', args: [{sourceId: 'mangadot', id: 'book', title: 'Book'}, '1']},
  ]) await assert.rejects(api.call(invalid), value => value instanceof SourceServiceClientError && value.status === 400);
  assert.equal(calls.length, 4);
});

test('Catalogue signs media, page and subtitle receipts recursively without changing order or metadata', async () => {
  const paths = [], main = asset('a'), sub = asset('b');
  const original = {url: main, hls: true, intro: {start: 0, end: 90}, subtitles: [{file: sub, label: 'English', kind: 'subtitles', default: true}], pages: [{url: main, width: 800, height: 1200}], optional: {file: null}};
  const result = await client(async () => rpc(original), async path => {paths.push(path); return signed(path);}).call(selection);
  assert.deepEqual(result, {...original, url: signed(main), subtitles: [{...original.subtitles[0], file: signed(sub)}], pages: [{...original.pages[0], url: signed(main)}]});
  assert.deepEqual(paths, [main, sub]);
});

test('Unsafe media fields and malformed service envelopes are rejected without signing upstream URLs', async () => {
  let signs = 0;
  for (const url of ['https://cdn.example/video', '//cdn.example/video', 'http://127.0.0.1/secret', '/v1/assets/' + 'a'.repeat(32) + '?query=1', '/v1/assets/' + 'a'.repeat(32) + '#x', '/v1/assets/%61'.repeat(32), '../video', '', 42]) {
    await assert.rejects(client(async () => rpc({subtitles: [{file: url}]}), async () => {signs++; return '/signed';}).call(selection), error('INVALID_SERVICE_RESPONSE', 502));
  }
  assert.equal(signs, 0);
  for (const body of [{value: [], cookies: 'secret'}, {error: 'SOURCE_UNAVAILABLE'}, [], JSON.parse('{"value":{"__proto__":{"url":"secret"}}}')]) await assert.rejects(client(async () => Response.json(body)).call(selection), error('INVALID_SERVICE_RESPONSE', 502));
});

test('A signer cannot return service URLs, unsigned receipts, local URLs or playlist injection', async () => {
  for (const result of [asset('a'), origin + asset('a'), '//evil.example/video', 'http://relay.example/video', 'https://user:pass@relay.example/video', 'https://127.0.0.1/video', '/signed\n#EXT-X-KEY:URI="secret"', '/signed#fragment', '/signed"bad']) {
    await assert.rejects(client(async () => rpc({url: asset('a')}), async () => result).call(selection), error('INVALID_SIGNED_ASSET', 502));
  }
  const result = await client(async () => rpc({url: asset('a')}), async () => 'https://relay.example/media?signature=abc').call(selection);
  assert.equal(result.url, 'https://relay.example/media?signature=abc');
});

test('No catalogue or media redirect, followed redirect or response URL mismatch is accepted', async () => {
  for (const make of [() => new Response(null, {status: 302, headers: {Location: 'https://evil.example/?secret=1'}}),
    () => {const result = rpc([]); Object.defineProperty(result, 'redirected', {value: true}); return result;},
    () => {const result = rpc([]); Object.defineProperty(result, 'url', {value: 'https://evil.example/'}); return result;}]) {
    let requests = 0;
    const api = client(async () => {requests++; return make();});
    await assert.rejects(api.call(selection), error('INVALID_SERVICE_RESPONSE', 502));
    await assert.rejects(api.asset(asset('a')), error('INVALID_SERVICE_RESPONSE', 502));
    assert.equal(requests, 2);
  }
});

test('Known verification and rate codes preserve status without retrying; other error text is sanitized', async () => {
  for (const [status, code] of [[403, 'SOURCE_VERIFICATION_REQUIRED'], [429, 'SOURCE_RATE_LIMITED'], [429, 'SERVICE_BUSY'], [410, 'MEDIA_EXPIRED']]) {
    let count = 0; const api = client(async () => {count++; return Response.json({error: code, upstream: 'https://private.example/?cookie=secret'}, {status});});
    await assert.rejects(api.call(selection), error(code, status)); await assert.rejects(api.asset(asset('a')), error(code, status));
    assert.equal(count, 2);
  }
  for (const fetcher of [async () => Response.json({error: 'https://private.example/?cookie=secret'}, {status: 403}), async () => {throw Error('private cookie=' + key);}, async () => new Response('<html>secret</html>', {status: 502})]) {
    await assert.rejects(client(fetcher).call(selection), value => {assert.ok(value instanceof SourceServiceClientError); assert.equal(value.code, 'SOURCE_UNAVAILABLE'); assert.doesNotMatch(JSON.stringify(value) + value.message, /private|cookie|fixture_key/); return true;});
  }
  assert.equal(new SourceServiceClientError(200, 'secret-error').status, 502);
  assert.equal(new SourceServiceClientError(900, 'secret-error').code, 'SOURCE_UNAVAILABLE');
});

test('HLS preserves master tags, key, audio, subtitles and segment order while signing every receipt', async () => {
  const [audio, subtitles, keyPath, variant, segment, map] = ['a', 'b', 'c', 'd', 'e', 'f'].map(asset);
  const playlist = ['#EXTM3U', '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="' + audio + '"',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",URI="' + subtitles + '"',
    '#EXT-X-SESSION-KEY:METHOD=AES-128,URI="' + keyPath + '"',
    '#EXT-X-STREAM-INF:BANDWIDTH=100,AUDIO="a",SUBTITLES="s"', variant,
    '#EXT-X-MAP:URI="' + map + '",BYTERANGE="10@0"', '#EXT-X-KEY:METHOD=AES-128,URI="' + keyPath + '"',
    '#EXTINF:10,', segment, '#EXT-X-ENDLIST', ''].join('\r\n');
  const paths = [];
  const response = await client(async () => new Response(playlist, {headers: {'Content-Type': 'application/x-mpegURL', 'Content-Length': String(playlist.length), 'Set-Cookie': 'secret=1'}}), async path => {paths.push(path); return signed(path);}).asset(asset('z'));
  let expected = playlist; for (const path of [audio, subtitles, keyPath, variant, segment, map]) expected = expected.replaceAll(path, signed(path));
  assert.equal(await response.text(), expected); assert.deepEqual(paths, [audio, subtitles, keyPath, variant, map, segment]);
  assert.equal(response.headers.get('content-type'), 'application/vnd.apple.mpegurl');
  assert.equal(response.headers.get('content-length'), null); assert.equal(response.headers.get('set-cookie'), null);
});

test('Child playlists and standalone WebVTT subtitles continue through the same safe asset API', async () => {
  const segment = asset('c'), child = '#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\n' + segment + '\n#EXT-X-ENDLIST\n';
  const api = client(async url => url.endsWith(asset('a')) ? new Response(child, {headers: {'Content-Type': 'application/vnd.apple.mpegurl'}}) : new Response('WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n', {headers: {'Content-Type': 'text/vtt', 'Set-Cookie': 'nope'}}));
  assert.equal(await (await api.asset(asset('a'))).text(), child.replace(segment, signed(segment)));
  const subtitle = await api.asset(asset('b')); assert.equal(subtitle.headers.get('content-type'), 'text/vtt'); assert.match(await subtitle.text(), /Hello/); assert.equal(subtitle.headers.get('set-cookie'), null);
});

test('HLS rejects external, malformed, variable and oversized references before serving a playlist', async () => {
  for (const body of ['#EXTM3U\nhttps://cdn.example/segment.ts\n', '#EXTM3U\n#EXT-X-KEY:URI="https://cdn.example/key"\n', '#EXTM3U\n#EXT-X-KEY:URI=' + asset('a') + '\n', '#EXTM3U\n../segment\n', '#EXTM3U\n{$upstream}\n', '#EXTM3Ubad\n' + asset('a') + '\n']) {
    await assert.rejects(client(async () => new Response(body, {headers: {'Content-Type': 'application/vnd.apple.mpegurl'}})).asset(asset('a')), error('INVALID_PLAYLIST', 502));
  }
  let cancelled = false;
  const stream = new ReadableStream({cancel() {cancelled = true;}});
  await assert.rejects(client(async () => new Response(stream, {headers: {'Content-Type': 'application/vnd.apple.mpegurl', 'Content-Length': String(2 * 1024 * 1024 + 1)}})).asset(asset('a')), error('SOURCE_RESPONSE_TOO_LARGE', 502));
  assert.equal(cancelled, true);
});

test('Only exact opaque paths and well-formed single safe byte ranges can be fetched', async () => {
  const requested = [];
  const api = client(async (url, init) => {requested.push({url, headers: new Headers(init.headers)}); return new Response(new Uint8Array([0, 1, 2]), {headers: {'Content-Type': 'video/mp4'}});});
  for (const path of ['https://cdn.example/video', origin + asset('a'), asset('a') + '?url=evil', asset('a') + '#x', '//source.example' + asset('a'), '/v1/assets/short', '/v1/assets/' + 'a'.repeat(33), '/v1/assets/%61'.repeat(32)]) await assert.rejects(api.asset(path), error('INVALID_ASSET_PATH', 400));
  for (const range of ['bytes=0-1,4-5', 'bytes=5-4', 'bytes=-0', 'bytes=0-\r\nCookie:bad', 'bytes=9007199254740992-', 'bytes=--1', 'bytes= 0-1', 'items=0-1', '']) await assert.rejects(api.asset(asset('a'), {range}), error('INVALID_RANGE', 416));
  assert.equal(requested.length, 0);
  for (const range of ['bytes=0-4', 'bytes=5-', 'bytes=-10']) await (await api.asset(asset('a'), {range, headers: {Cookie: 'visitor'}})).body.cancel();
  assert.deepEqual(requested.map(row => row.headers.get('range')), ['bytes=0-4', 'bytes=5-', 'bytes=-10']);
  assert.deepEqual([...requested[0].headers.keys()].sort(), ['accept', 'authorization', 'range']);
});

test('Byte ranges stream without full buffering and forward only allowed response headers', async () => {
  let cancelled = false;
  const upstream = new ReadableStream({start(controller) {controller.enqueue(new Uint8Array([0, 1, 2, 3, 4]));}, cancel() {cancelled = true;}});
  const response = await client(async () => new Response(upstream, {status: 206, headers: {
    'Content-Type': 'video/mp4', 'Content-Length': '5', 'Content-Range': 'bytes 0-4/10', 'Accept-Ranges': 'bytes',
    'Set-Cookie': 'source-session=secret', 'Access-Control-Allow-Origin': '*', Location: 'https://upstream.example', 'X-Private': 'secret',
  }})).asset(asset('a'), {range: 'bytes=0-4'});
  assert.equal(response.status, 206); assert.deepEqual([...response.headers.keys()].sort(), ['accept-ranges', 'cache-control', 'content-length', 'content-range', 'content-type', 'x-content-type-options']);
  const reader = response.body.getReader(); assert.deepEqual((await reader.read()).value, new Uint8Array([0, 1, 2, 3, 4]));
  assert.equal(cancelled, false); await reader.cancel(); assert.equal(cancelled, true);
});

test('Catalogue response limits apply to streamed bytes, not only Content-Length', async () => {
  let cancelled = false;
  const stream = new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1));}, cancel() {cancelled = true;}});
  await assert.rejects(client(async () => new Response(stream, {headers: {'Content-Type': 'application/json'}})).call(selection), error('SOURCE_RESPONSE_TOO_LARGE', 502));
  assert.equal(cancelled, true);
});

test('Cancellation interrupts pending fetch and signing and never exposes caller abort text', async () => {
  for (const method of ['call', 'asset']) {
    const controller = new AbortController(); let outgoing;
    const api = client(async (_url, init) => {outgoing = init.signal; return new Promise(() => {});});
    const pending = method === 'call' ? api.call(selection, controller.signal) : api.asset(asset('a'), {signal: controller.signal});
    controller.abort(Error('secret visitor abort reason'));
    await assert.rejects(pending, error('REQUEST_CANCELLED', 499)); assert.equal(outgoing.aborted, true);
  }
  const controller = new AbortController(); let started;
  const signStarted = new Promise(resolve => {started = resolve;});
  const pending = client(async () => rpc({url: asset('a')}), async () => {started(); return new Promise(() => {});}).call(selection, controller.signal);
  await signStarted; controller.abort(); await assert.rejects(pending, error('REQUEST_CANCELLED', 499));
});

test('Cancellation aborts an active binary body and cancels its source reader', async () => {
  let cancelled = false;
  const upstream = new ReadableStream({cancel() {cancelled = true;}});
  const controller = new AbortController();
  const response = await client(async () => new Response(upstream, {headers: {'Content-Type': 'application/octet-stream'}})).asset(asset('a'), {signal: controller.signal});
  const pending = response.body.getReader().read(); controller.abort(Error('source-cookie-secret'));
  await assert.rejects(pending, error('REQUEST_CANCELLED', 499)); assert.equal(cancelled, true);
});
