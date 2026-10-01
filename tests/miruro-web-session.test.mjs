import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// Exercise the locally authored Android GET script against mocks, never a live site.
const kotlin = readFileSync(new URL('../apps/android/app/src/main/java/com/sanjay/anitrack/next/data/providers/connectors/miruro/MiruroWebSessionTransport.kt', import.meta.url), 'utf8')
const template = kotlin.match(/evaluate\("""([\s\S]*?)"""\.trimIndent\(\)\)/)?.[1]
assert.ok(template, 'Find the reviewed same-session request script')
const origin = 'https://www.miruro.ru'
const url = `${origin}/api/secure/pipe?e=synthetic`

async function run(fetch, { pageOrigin = origin, cap = 128 } = {}) {
  const window = {}
  const script = template.replaceAll('$origin', JSON.stringify(origin))
    .replaceAll('$slot', '"probe"').replaceAll('$quotedUrl', JSON.stringify(url))
    .replaceAll('$maximumBytes', String(cap))
  const started = vm.runInNewContext(script, {
    window, location: { origin: pageOrigin }, fetch, AbortController,
    TextDecoder, Uint8Array, setTimeout: () => 1, clearTimeout: () => {},
  }, { timeout: 1000 })
  for (let index = 0; started && !window.probe.done && index < 100; index++) {
    await new Promise(setImmediate)
  }
  if (started) assert.equal(window.probe.done, true, 'Mock request must finish')
  return { started, state: window.probe }
}

function response({ status = 200, text = '{"test":true}', length = null, cancel = () => {} } = {}) {
  let sent = false
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: name => name === 'content-length' ? length : null },
    body: { cancel, getReader: () => ({ cancel, read: async () => sent
      ? { done: true }
      : (sent = true, { done: false, value: new TextEncoder().encode(text) }) }) },
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
  assert.equal(state.result.text, '{"test":true}')
  assert.equal(state.result.status, 200)
})

test('leaving the approved page origin prevents the GET entirely', async () => {
  const { started } = await run(() => { throw Error('must not fetch') }, { pageOrigin: 'https://example.com' })
  assert.equal(started, false)
})

test('security status reaches the native cooldown without reading the challenge body', async () => {
  let cancelled = false
  let calls = 0
  const { state } = await run(async () => {
    calls++
    return response({ status: 403, text: 'must not read', cancel: () => { cancelled = true } })
  })
  assert.equal(state.result.status, 403)
  assert.equal(state.result.text, '')
  assert.equal(cancelled, true)
  assert.equal(calls, 1)
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

test('network failures expose no error details and are never retried', async () => {
  let calls = 0
  const { state } = await run(async () => { calls++; throw Error('private request data') })
  assert.equal(state.failed, true)
  assert.equal(state.result, undefined)
  assert.equal(calls, 1)
})
