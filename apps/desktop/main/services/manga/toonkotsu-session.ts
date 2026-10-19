import { app, BrowserWindow } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOONKOTSU, toonkotsuPageRef } from '../../../../../packages/shared/toonkotsu';
import { VerifiedPageSession } from '../providers/verified-page-session';

const page = new VerifiedPageSession({ origin: TOONKOTSU.ORIGIN, partition: 'persist:toonkotsu', label: 'Toonkotsu', world: 1215,
  maxBodyBytes: TOONKOTSU.MAX_BYTES, allowedResourceHosts: ['toonkotsu.com', 'challenges.cloudflare.com'] });
let tail: Promise<unknown> = Promise.resolve();
let pending = 0;
let connectionUrl = TOONKOTSU.ORIGIN + '/';
let script: string | undefined;
const images = new Map<string, { bytes: Buffer; type: string }>();
let imageBytes = 0;
let cooldownUntil = 0;
let verificationNeeded = false;
function program(request: unknown): string {
  script ??= readFileSync(join(app.getAppPath(), 'apps/android/app/src/main/assets/toonkotsu_page.js'), 'utf8');
  return script.replace('/*ANITRACK_REQUEST*/', JSON.stringify(request));
}
function queue<T>(work: () => Promise<T>): Promise<T> {
  if (pending >= 32) return Promise.reject(new Error('Toonkotsu is busy. Retry in a moment.'));
  pending++;
  const run = tail.then(() => {
    if (Date.now() < cooldownUntil) throw new ToonkotsuSessionError(false, 'Toonkotsu is limiting requests. Wait a minute, then retry.');
    return work();
  }).finally(() => { pending--; });
  tail = run.catch(() => {});
  return run;
}
export class ToonkotsuSessionError extends Error {
  constructor(readonly verify: boolean, message: string) { super(message); }
}
function result(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new Error('Toonkotsu sent an unreadable page.');
  const r = value as Record<string, unknown>;
  if (r.error === 'check') { verificationNeeded = true; throw new ToonkotsuSessionError(true, 'Toonkotsu needs a quick check. Use Connect Toonkotsu, complete it, close the window, then retry.'); }
  if (r.error) throw new ToonkotsuSessionError(false, r.error === 'rate' ? 'Toonkotsu is limiting requests. Wait a minute, then retry.' : 'Toonkotsu could not load this page. Retry or choose another source.');
  return r;
}
export function toonkotsuGet(url: string): Promise<string> {
  return queue(async () => {
    const r = await page.get(url, 'application/json', ['retry-after', 'cf-mitigated']);
    if (r.status === 429) {
      const retry = r.headers['retry-after'];
      const delay = /^\d+$/.test(retry ?? '') ? Number(retry) * 1000 : Date.parse(retry ?? '') - Date.now();
      cooldownUntil = Date.now() + Math.min(24 * 60 * 60_000, Math.max(60_000, Number.isFinite(delay) ? delay : 60_000));
      throw new ToonkotsuSessionError(false, 'Toonkotsu is limiting requests. Wait a minute, then retry.');
    }
    if ([401,403,503].includes(r.status) || r.headers['cf-mitigated'] === 'challenge' || /<html|<!doctype/i.test(r.body?.slice(0,100) ?? '')) { verificationNeeded = true; throw new ToonkotsuSessionError(true, 'Toonkotsu needs a quick check. Use Connect Toonkotsu, complete it, then retry.'); }
    if (r.status !== 200 || r.body == null) throw new Error('Toonkotsu could not load its catalogue.');
    return r.body;
  });
}
export function fetchToonkotsuImage(url: URL, signal?: AbortSignal): Promise<Response> | null {
  const ref = toonkotsuPageRef(url);
  if (!ref) return null;
  return queue(async () => {
    signal?.throwIfAborted();
    if (verificationNeeded) throw new ToonkotsuSessionError(true, 'Toonkotsu needs a quick check. Use Connect Toonkotsu, complete it, then retry.');
    const saved = images.get(url.href);
    if (saved) { images.delete(url.href); images.set(url.href, saved); return new Response(saved.bytes, { headers: { 'Content-Type': saved.type } }); }
    connectionUrl = url.href;
    const r = result(await page.readPage(url.href, program({ operation: 'image', ...ref })));
    signal?.throwIfAborted();
    if (r.chapterId !== ref.chapterId || r.page !== ref.page || typeof r.data !== 'string' || r.data.length > TOONKOTSU.MAX_BYTES * 1.34 + 100) throw new Error('Toonkotsu sent an invalid page.');
    const m = /^data:(image\/(?:jpeg|png|webp|avif|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(r.data);
    if (!m) throw new Error('Toonkotsu sent an invalid image.');
    const bytes = Buffer.from(m[2], 'base64');
    if (!bytes.length || bytes.length > TOONKOTSU.MAX_BYTES) throw new Error('Toonkotsu image is too large.');
    images.set(url.href, { bytes, type: m[1] }); imageBytes += bytes.length;
    while (imageBytes > 32 * 1024 * 1024) { const key = images.keys().next().value!; imageBytes -= images.get(key)!.bytes.length; images.delete(key); }
    return new Response(bytes, { headers: { 'Content-Type': m[1] } });
  });
}
export function connectToonkotsu(parent: BrowserWindow | null): Promise<boolean> {
  return queue(async () => { await page.connect(connectionUrl, parent); verificationNeeded = false; images.clear(); imageBytes = 0; return true; });
}
