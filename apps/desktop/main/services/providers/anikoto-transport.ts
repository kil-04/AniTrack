/** Bounded catalogue/resolver transport. Media playback uses a separate path. */
export class AnikotoTransportError extends Error {
  readonly code: "SECURITY_CHECK" | "RATE_LIMITED" | "COOLDOWN" | "TIMEOUT" | "TOO_LARGE";

  constructor(code: AnikotoTransportError["code"]) {
    super(`${["SECURITY_CHECK", "RATE_LIMITED", "COOLDOWN"].includes(code) ? `ANIKOTO_${code}: ` : ""}${{
      SECURITY_CHECK: "Anikoto requested a security check. Open its homepage to complete verification yourself, or choose another provider.",
      RATE_LIMITED: "Anikoto limited requests. Please wait a minute or choose another provider.",
      COOLDOWN: "Anikoto recently rejected a request. Please wait a minute or choose another provider.",
      TIMEOUT: "Anikoto did not respond in time. Try again or choose another server.",
      TOO_LARGE: "Anikoto returned a response larger than the supported limit.",
    }[code]}`);
    this.name = "AnikotoTransportError";
    this.code = code;
  }
}

function hasSecurityChallenge(body: string): boolean {
  // Restrict detection to challenge markup/error fields, not catalogue titles.
  return /<title>\s*(?:Just a moment|Attention Required|Security Check|Verify you are human)(?:[.!|\s][^<]*)?<\/title>/i.test(body)
    || /(?:id|class)=["'][^"']*\b(?:cf-challenge|challenge-form|g-recaptcha|h-captcha)\b/i.test(body)
    || /["'](?:error|code|message)["']\s*:\s*["'](?:CAPTCHA_REQUIRED|NEED_CAPTCHA|CHALLENGE_REQUIRED|SECURITY_CHECK_REQUIRED)["']/i.test(body);
}

interface TransportOptions {
  now?: () => number;
  deadlineMillis?: number;
  maxResponseBytes?: number;
  cooldownMillis?: number;
}

export function createAnikotoTransport(
  fetcher: (url: string, options: RequestInit) => Promise<Response>,
  options: TransportOptions = {},
): (url: string, options?: RequestInit) => Promise<Response> {
  const now = options.now ?? Date.now;
  const deadlineMillis = options.deadlineMillis ?? 20_000;
  const maxResponseBytes = options.maxResponseBytes ?? 8 * 1024 * 1024;
  const cooldownMillis = options.cooldownMillis ?? 60_000;
  const queues = new Map<string, Promise<void>>();
  const blockedUntil = new Map<string, number>();

  return (url, init = {}) => {
    const origin = new URL(url).origin;
    const controller = new AbortController();
    const callerSignal = init.signal;
    const forwardAbort = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) forwardAbort();
    else callerSignal?.addEventListener("abort", forwardAbort, { once: true });
    let deadline: ReturnType<typeof setTimeout>;
    let rejectAbort: (reason: unknown) => void = () => {};
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    const onAbort = () => rejectAbort(controller.signal.reason);
    controller.signal.addEventListener("abort", onAbort, { once: true });
    if (controller.signal.aborted) onAbort();
    deadline = setTimeout(() => controller.abort(new AnikotoTransportError("TIMEOUT")), deadlineMillis);
    const previous = queues.get(origin) ?? Promise.resolve();
    const work = previous.then(async () => {
      controller.signal.throwIfAborted();
      if ((blockedUntil.get(origin) ?? 0) > now()) throw new AnikotoTransportError("COOLDOWN");
      blockedUntil.delete(origin);
      const response = await fetcher(url, { ...init, signal: controller.signal });
      controller.signal.throwIfAborted();
      if (response.status === 403 || response.status === 429) {
        blockedUntil.set(origin, now() + cooldownMillis);
        void response.body?.cancel().catch(() => {});
        throw new AnikotoTransportError(response.status === 429 ? "RATE_LIMITED" : "SECURITY_CHECK");
      }
      const declaredLength = Number(response.headers.get("content-length"));
      if (declaredLength > maxResponseBytes) {
        void response.body?.cancel().catch(() => {});
        throw new AnikotoTransportError("TOO_LARGE");
      }
      const chunks: Uint8Array[] = [];
      let length = 0;
      const reader = response.body?.getReader();
      try {
        while (reader) {
          const part = await Promise.race([reader.read(), aborted]);
          controller.signal.throwIfAborted();
          if (part.done) break;
          length += part.value.byteLength;
          if (length > maxResponseBytes) throw new AnikotoTransportError("TOO_LARGE");
          chunks.push(part.value);
        }
      } catch (error) {
        // Do not await cancellation: a stalled transport must not extend the deadline.
        void reader?.cancel().catch(() => {});
        throw error;
      } finally {
        reader?.releaseLock();
      }
      const body = Buffer.concat(chunks, length);
      if (hasSecurityChallenge(body.toString("utf8"))) {
        blockedUntil.set(origin, now() + cooldownMillis);
        throw new AnikotoTransportError("SECURITY_CHECK");
      }
      const buffered = new Response([101, 204, 205, 304].includes(response.status) ? null : body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
      Object.defineProperties(buffered, {
        url: { value: response.url || url },
        redirected: { value: response.redirected },
      });
      return buffered;
    });
    // Race the whole operation, including queueing and a fetcher ignoring abort.
    const result = Promise.race([work, aborted]);
    const tail = result.then(() => {}, () => {});
    queues.set(origin, tail);
    void tail.then(() => { if (queues.get(origin) === tail) queues.delete(origin); });
    return result.finally(() => {
      clearTimeout(deadline);
      callerSignal?.removeEventListener("abort", forwardAbort);
      controller.signal.removeEventListener("abort", onAbort);
    });
  };
}
