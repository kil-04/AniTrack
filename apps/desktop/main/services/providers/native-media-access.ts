import type { StreamAuthorization } from "./stream-authorization";

interface NativeMediaRequest {
  id: number;
  url: string;
  resourceType: string;
  webContentsId?: number;
}

/** Bounded per-request receipts; never exports URLs, credentials or headers. */
export class NativeMediaAccessObserver {
  private readonly requests = new Map<number, { accessId: string; webContentsId: number }>();
  private readonly authorization: (url: string) => StreamAuthorization | null;
  private readonly reject: (accessId: string, status: number) => void;
  private readonly maxRequests: number;

  constructor(
    authorization: (url: string) => StreamAuthorization | null,
    reject: (accessId: string, status: number) => void,
    maxRequests = 500,
  ) {
    this.authorization = authorization;
    this.reject = reject;
    this.maxRequests = maxRequests;
  }

  begin(request: NativeMediaRequest, trustedWebContentsId: number | undefined): void {
    // Redirects/repeated notifications must not rebind an existing request to
    // a newer resolution of the same URL.
    if (this.requests.has(request.id)) return;
    if (typeof trustedWebContentsId !== "number" || typeof request.webContentsId !== "number"
      || request.resourceType !== "media" || request.webContentsId !== trustedWebContentsId) return;
    const accessId = this.authorization(request.url)?.mediaAccessId;
    if (!accessId) return;
    this.requests.set(request.id, { accessId, webContentsId: request.webContentsId });
    while (this.requests.size > this.maxRequests) this.requests.delete(this.requests.keys().next().value!);
  }

  response(request: { id: number; webContentsId?: number; statusCode: number }): void {
    const receipt = this.requests.get(request.id);
    if (!receipt || receipt.webContentsId !== request.webContentsId) return;
    if (request.statusCode === 403 || request.statusCode === 429) this.reject(receipt.accessId, request.statusCode);
  }

  finish(requestId: number): void { this.requests.delete(requestId); }
  clear(): void { this.requests.clear(); }
}
