const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../apps/android/app/src/main/assets/pahe_player.html'), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];

function fixture() {
  const instances = [], errors = [];
  const video = { currentTime: 32.5, pause() {}, play: () => Promise.resolve(), addEventListener() {} };
  class Hls {
    static Events = { MANIFEST_PARSED: 'manifest', ERROR: 'error' };
    static isSupported() { return true; }
    constructor() { this.events = {}; this.retries = 0; this.recoveries = 0; this.destroyed = 0; instances.push(this); }
    on(event, callback) { this.events[event] = callback; }
    loadSource() {}
    attachMedia() {}
    startLoad() { this.retries++; }
    recoverMediaError() { this.recoveries++; }
    destroy() { this.destroyed++; }
    fail(data) { this.events.error(null, data); }
  }
  const context = vm.createContext({ Hls, Android: { onError: message => errors.push(message) },
    document: { getElementById: () => video }, setInterval() {} });
  context.window = context;
  vm.runInContext(script, context, { timeout: 1000 });
  return { context, instances, errors, video };
}

test('tablet AnimePahe stops nonfatal HTTP denials without network/media recovery', () => {
  for (const status of [403, 429]) {
    const f = fixture(); f.context.load('fixture', 0, true);
    const hls = f.instances[0];
    hls.fail({ fatal: false, type: 'networkError', response: { code: status }, details: 'private-url' });
    hls.fail({ fatal: true, type: 'networkError', networkDetails: { status } });
    assert.equal(hls.destroyed, 1); assert.equal(hls.retries, 0); assert.equal(hls.recoveries, 0);
    assert.deepEqual(f.errors, ['networkError:accessDenied']);
    assert.equal(f.video.currentTime, 32.5);
  }
});

test('tablet AnimePahe bounds network and decoder recovery per selected load', () => {
  for (const type of ['networkError', 'mediaError']) {
    const f = fixture(); f.context.load('fixture', 0, true);
    const hls = f.instances[0];
    hls.fail({ fatal: true, type });
    assert.equal(hls.destroyed, 0);
    hls.fail({ fatal: true, type });
    assert.equal(hls.retries + hls.recoveries, 1);
    assert.equal(hls.destroyed, 1); assert.equal(f.errors.length, 1);
  }
});

test('tablet AnimePahe ignores stale errors and allows an explicit fresh load', () => {
  const f = fixture(); f.context.load('first', 0, true);
  const first = f.instances[0];
  f.context.load('second', 32.5, true);
  const second = f.instances[1];
  first.fail({ fatal: true, type: 'networkError', response: { code: 403 } });
  assert.equal(second.destroyed, 0); assert.equal(f.errors.length, 0);
  second.fail({ fatal: false, type: 'networkError', response: { code: 429 } });
  f.context.load('manual retry', 32.5, true);
  assert.equal(f.context.hls, f.instances[2]);
});
