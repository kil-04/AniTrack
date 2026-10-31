import {authenticates, boundedJson, errorResponse, opaqueId, reject, sourceRequest, type SourceRequest} from './protocol';

export interface SourceAdapter {
  call(request: SourceRequest, signal: AbortSignal): Promise<unknown>;
  asset(id: string, request: Request): Promise<Response>;
  close?():void;
}
/** An Internet service authenticated only by the Site server, never by visitors. */
export class SourceService {
  private active = 0;
  private transfers = 0;
  private requests = new Map<string, AbortController>();
  constructor(private adapter: SourceAdapter, private secret: string, private maxConcurrent = 4, private deadline = 120000) {
    if (secret.length < 32 || secret.length > 256 || !/^[A-Za-z0-9_-]+$/.test(secret)) throw new Error('SOURCE_SERVICE_KEY must be a random base64url key of at least32characters.');
  }
  async handle(request: Request): Promise<Response> {
    try {
      const path = new URL(request.url).pathname;
      if (path === '/health' && request.method === 'GET') return Response.json({ok: true, protocol: 1}, {headers: {'Cache-Control': 'no-store'}});
      if (!authenticates(request.headers.get('authorization'), this.secret)) return reject(401, 'UNAUTHORIZED');
      // There is deliberately no browser CORS grant and no user-selected URL.
      if (request.headers.has('origin')) return reject(403, 'SERVER_REQUEST_REQUIRED');
      if (request.method === 'GET' && /^\/v1\/assets\/[A-Za-z0-9_-]{32}$/.test(path)) {
        if (this.transfers >= 16) return reject(429, 'SERVICE_BUSY');
        this.transfers++;
        let released = false;
        const release = () => {if (!released) {released=true;this.transfers--;}};
        try {
          const response = await this.adapter.asset(path.slice(11), request);
          if (!response.body) {release();return response;}
          const reader = response.body.getReader();
          const body = new ReadableStream<Uint8Array>({
            async pull(controller) {try {const chunk = await reader.read();if (chunk.done) {release();controller.close();}else controller.enqueue(chunk.value);}catch(error) {release();controller.error(error);}},
            async cancel(reason) {release();await reader.cancel(reason);},
          });
          return new Response(body, {status:response.status,headers:response.headers});
        } catch(error) {release();throw error;}
      }
      if (path !== '/v1/rpc' || request.method !== 'POST') return reject(404, 'NOT_FOUND');
      if (this.active >= this.maxConcurrent) return reject(429, 'SERVICE_BUSY');
      const input = sourceRequest(await boundedJson(request));
      // Recheck after consuming a bounded body: concurrent readers may finish together.
      if (this.active >= this.maxConcurrent) return reject(429, 'SERVICE_BUSY');
      const id = opaqueId(), controller = new AbortController();
      this.requests.set(id, controller); this.active++;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const abort = () => controller.abort(); request.signal.addEventListener('abort', abort, {once: true});
      const operation = Promise.resolve().then(() => {
        if (request.signal.aborted) return reject(499, 'REQUEST_CANCELLED');
        return this.adapter.call(input, controller.signal);
      });
      // Keep the concurrency slot until the actual connector finishes, including
      // an uninterruptible source check after the HTTP caller has timed out.
      void operation.finally(() => {this.active--; this.requests.delete(id);}).catch(() => {});
      try {
        const value = await Promise.race([operation, new Promise<never>((_, fail) => {
          timer = setTimeout(() => {controller.abort(); fail(new Error('Source operation timed out.'));}, this.deadline); timer.unref?.();
        })]);
        const encoded = JSON.stringify({value});
        if (Buffer.byteLength(encoded) > 8 * 1024 * 1024) return reject(502, 'SOURCE_RESPONSE_TOO_LARGE');
        return new Response(encoded, {headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});
      } finally {clearTimeout(timer); request.signal.removeEventListener('abort', abort);}
    } catch (error) {return errorResponse(error);}
  }
  close() {for (const request of this.requests.values()) request.abort();this.adapter.close?.();}
}
