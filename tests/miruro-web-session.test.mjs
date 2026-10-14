import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// Exercise the locally authored Android GET script against mocks, never a live site.
const kotlin = readFileSync(new URL('../apps/android/app/src/main/java/com/sanjay/anitrack/next/data/providers/connectors/miruro/MiruroWebSessionTransport.kt', import.meta.url), 'utf8')
const template = kotlin.match(/evaluate\("""([\s\S]*?)"""\.trimIndent\(\)\)/)?.[1]
assert.ok(template, 'Find the reviewed same-session request script')
const origin = 'https://www.miruro.ru'
const url = `${origin}/api/v1/anime?anilist_id_in=1&limit=100`

async function run(fetch, { pageOrigin = origin, cap = 128 } = {}) {
  const window = {}
  const script = template.replaceAll('$origin', JSON.stringify(origin))
    .replaceAll('$slot', '"probe"').replaceAll('$quotedUrl', JSON.stringify(url))
    .replaceAll('$maximumBytes', String(cap))
  const started = vm.runInNewContext(script, {
    window, location: { origin: pageOrigin }, fetch, AbortController,
    TextDecoder, Uint8Array, btoa, setTimeout: () => 1, clearTimeout: () => {},
  }, { timeout: 1000 })
  for (let index = 0; started && !window.probe.done && index < 100; index++) {
    await new Promise(setImmediate)
  }
  if (started) assert.equal(window.probe.done, true, 'Mock request must finish')
  return { started, state: window.probe }
}

function response({ status = 200, text = '{"test":true}', bytes = null, contentType = 'application/json',
  obfuscated = null, length = null, cancel = () => {}, read = () => {} } = {}) {
  let sent = false
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: name => ({ 'content-length': length, 'content-type': contentType, 'x-obfuscated': obfuscated })[name] ?? null },
    body: { cancel, getReader: () => { read(); return { cancel, read: async () => sent
      ? { done: true }
      : (sent = true, { done: false, value: bytes ?? new TextEncoder().encode(text) }) } } },
  }
}

test('same-session GET preserves browser credentials, disallows redirects and makes one request', async () => {
  let calls = 0
  const { state } = await run(async (actualUrl, options) => {
    calls++
    assert.equal(actualUrl, url)
    assert.equal(options.method, 'GET')
    assert.equal(options.credentials, 'same-origin')
    assert.equal(options.redirect, 'error')
    assert.equal(options.cache, 'no-store')
    assert.equal(Object.hasOwn(options.headers, 'Cookie'), false)
    assert.equal(Object.hasOwn(options.headers, 'User-Agent'), false)
    return response()
  })
  assert.equal(calls, 1)
  assert.equal(state.failed, undefined)
  assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(state.result.base64, 'base64')), '{"test":true}')
  assert.equal(state.result.contentType, 'application/json')
  assert.equal(state.result.status, 200)
  assert.equal(Object.hasOwn(state.result, 'text'), false, 'Bridge transports bytes, never lossy text')
  assert.equal(Object.hasOwn(state.result, 'cookies'), false)
})

test('Android session carries arbitrary binary bytes and Content-Type without a UTF-8 conversion', async () => {
  const bytes = Uint8Array.from([0, 255, 128, 1, 33, 200, 195, 40])
  let calls = 0
  const { state } = await run(async (_, options) => {
    calls++
    assert.equal(options.credentials, 'same-origin')
    assert.equal(options.redirect, 'error')
    assert.equal(Object.hasOwn(options.headers, 'Cookie'), false)
    assert.equal(Object.hasOwn(options.headers, 'User-Agent'), false)
    return response({ bytes, contentType: 'application/octet-stream' })
  })
  assert.equal(state.failed, undefined)
  assert.deepEqual(Buffer.from(state.result.base64, 'base64'), Buffer.from(bytes))
  assert.equal(state.result.contentType, 'application/octet-stream')
  assert.equal(calls, 1)
})

test('Android base64 bridge retains Unicode plain JSON and legacy obfuscation markers', async () => {
  const text = '{"title":"テスト – café 🎬"}'
  const plain = await run(async () => response({ text }))
  assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(plain.state.result.base64, 'base64')), text)
  // Older saved payload fixtures still use textual base64url + x-obfuscated.
  // The binary bridge must not alter that text or drop its codec marker.
  const legacy = 'H4sIAAAAAAAA_6tWKkktLlGyKikqTa0FAO-AtaYNAAAA'
  const encoded = await run(async () => response({ text: legacy, contentType: 'text/plain', obfuscated: '2' }))
  assert.equal(Buffer.from(encoded.state.result.base64, 'base64').toString('utf8'), legacy)
  assert.equal(encoded.state.result.obfuscated, '2')
  assert.equal(encoded.state.result.contentType, 'text/plain')
})

test('Android session base64 encoding crosses its 8192-byte chunks without truncation', async () => {
  const bytes = Uint8Array.from({ length: 16_385 }, (_, index) => index % 256)
  const { state } = await run(async () => response({ bytes, contentType: 'application/octet-stream' }), { cap: bytes.length })
  assert.equal(state.failed, undefined)
  assert.deepEqual(Buffer.from(state.result.base64, 'base64'), Buffer.from(bytes))
})

test('leaving the approved page origin prevents the GET entirely', async () => {
  const { started } = await run(() => { throw Error('must not fetch') }, { pageOrigin: 'https://example.com' })
  assert.equal(started, false)
})

test('security status reaches the native session policy without reading the challenge body or retrying', async () => {
  for (const status of [403, 429]) {
    let cancelled = false
    let calls = 0
    let reads = 0
    const { state } = await run(async () => {
      calls++
      return response({ status, text: 'must not read', length: '999999',
        cancel: () => { cancelled = true }, read: () => { reads++ } })
    })
    assert.equal(state.failed, undefined)
    assert.equal(state.result.status, status)
    assert.equal(state.result.base64, '')
    assert.equal(state.result.contentType, '')
    assert.equal(cancelled, true)
    assert.equal(reads, 0)
    assert.equal(calls, 1)
  }
})

test('oversized advertised bodies are rejected', async () => {
  const { state } = await run(async () => response({ length: '1000' }))
  assert.equal(state.failed, true)
  assert.equal(state.result, undefined)
})

test('chunked responses obey the byte cap even without Content-Length', async () => {
  let cancelled = false
  const { state } = await run(async () => response({ text: 'a'.repeat(129), cancel: () => { cancelled = true } }))
  assert.equal(state.failed, true)
  assert.equal(cancelled, true)
})

test('binary chunked responses obey the raw byte cap and empty response bodies stay bounded', async () => {
  let cancelled = false
  const large = await run(async () => response({ bytes: new Uint8Array(129), contentType: 'application/octet-stream',
    cancel: () => { cancelled = true } }))
  assert.equal(large.state.failed, true)
  assert.equal(large.state.result, undefined)
  assert.equal(cancelled, true)
  const empty = await run(async () => ({ status: 204, headers: { get: () => null }, body: null }))
  assert.equal(empty.state.failed, undefined)
  assert.equal(empty.state.result.base64, '')
  assert.equal(empty.state.result.status, 204)
})

test('network failures expose no error details and are never retried', async () => {
  let calls = 0
  const { state } = await run(async () => { calls++; throw Error('private request data') })
  assert.equal(state.failed, true)
  assert.equal(state.result, undefined)
  assert.equal(calls, 1)
})

// Exercise the actual Electron isolated-world GET as well. Binary catalogue
// bytes must cross as base64, not be irreversibly decoded as UTF-8 text.
// Node lazily initializes its fetch implementation. Do that outside the VM's
// script timeout: interrupting initialization can leave Response unavailable
// to subsequent tests on a busy build machine.
const DesktopResponse = globalThis.Response
new DesktopResponse(null)
const desktopSource = readFileSync(new URL('../apps/desktop/main/services/providers/verified-page-session.ts', import.meta.url), 'utf8')
const desktopTemplate = desktopSource.match(/const code = `([\s\S]*?)`;/)?.[1]
assert.ok(desktopTemplate, 'Find the reviewed desktop session GET')

async function desktopGet(fetcher, { encoding = 'base64', cap = 128 } = {}) {
  const request = { path: '/api/v1/anime?anilist_id_in=1&limit=100', accept: 'application/octet-stream',
    headers: ['content-type'], limit: cap, timeout: 15000, encoding }
  const script = desktopTemplate.replace('${JSON.stringify(request)}', JSON.stringify(request))
  const result = await vm.runInNewContext(script, {
    fetch: fetcher, location: { origin }, Blob, Uint8Array, AbortController, btoa,
    setTimeout: () => 1, clearTimeout: () => {}, URL,
  }, { timeout: 1000 })
  return JSON.parse(JSON.stringify(result))
}

function desktopResponse(body, options = {}) {
  const response = new DesktopResponse(body, options)
  Object.defineProperty(response, 'url', { value: origin + '/api/v1/anime' })
  return response
}

test('desktop same-session binary response retains exact bytes without exporting cookies', async () => {
  const bytes = Uint8Array.from([0, 255, 128, 1, 33, 200])
  let calls = 0
  const result = await desktopGet(async (url, options) => {
    calls++
    assert.equal(url, '/api/v1/anime?anilist_id_in=1&limit=100')
    assert.equal(options.redirect, 'error')
    assert.equal(options.credentials, 'same-origin')
    assert.equal(Object.hasOwn(options.headers, 'Cookie'), false)
    assert.equal(Object.hasOwn(options.headers, 'User-Agent'), false)
    return desktopResponse(bytes, { headers: { 'content-type': 'application/octet-stream' } })
  })
  assert.deepEqual(Buffer.from(result.body, 'base64'), Buffer.from(bytes))
  assert.equal(calls, 1)
})

test('desktop session stops status rejection before body reading and bounds binary responses', async () => {
  let cancelled = false
  const blocked = await desktopGet(async () => ({ status: 403, url: origin + '/api/v1/anime', headers: { get: () => null },
    body: { cancel: () => { cancelled = true }, getReader: () => { throw Error('must not read') } } }))
  assert.equal(blocked.status, 403)
  assert.equal(blocked.body, '')
  assert.equal(cancelled, true)
  const large = await desktopGet(async () => desktopResponse(Buffer.alloc(129)))
  assert.equal(large.body, null)
  const declared = await desktopGet(async () => desktopResponse('{}', { headers: { 'content-length': '1000' } }))
  assert.equal(declared.body, null)
  const plain = await desktopGet(async () => desktopResponse('{"ok":true}'), { encoding: 'utf8' })
  assert.equal(plain.body, '{"ok":true}')
})
