import { isLocalDownloadUrl, readLocalFile } from "./downloads";

/** hls.js loader that routes Android WebView requests through the native bridge. */
export function createCapacitorHlsLoader(getReferer: () => string | null) {
  return class CapacitorHlsLoader {
    stats: any = {
      aborted: false,
      loaded: 0,
      total: 0,
      retry: 0,
      chunkCount: 0,
      bwEstimate: 0,
      loading: { start: 0, first: 0, end: 0 },
      parsing: { start: 0, end: 0 },
      buffering: { start: 0, end: 0, first: 0 },
    };

    private aborted = false;

    load(context: any, _config: any, callbacks: any) {
      this.aborted = false;
      const { url, responseType } = context;
      const binary = responseType === "arraybuffer";
      const requestStarted = performance.now();
      this.stats.loading.start = requestStarted;

      const referer = getReferer();
      const headers = referer
        ? { Referer: referer.replace(/\/?$/, "/"), Origin: referer }
        : undefined;
      const request = isLocalDownloadUrl(url)
        ? readLocalFile(url, binary)
        : window.api.pahe.fetchUrl!(url, binary, headers);

      request.then((result) => {
        if (this.aborted) return;
        if (result.status < 200 || result.status >= 300) {
          callbacks.onError(
            { code: result.status, text: `HTTP ${result.status}` },
            context,
            null,
            this.stats,
          );
          return;
        }

        let data: string | ArrayBuffer;
        if (binary && result.binary) {
          const raw = atob(result.data);
          const buffer = new ArrayBuffer(raw.length);
          const view = new Uint8Array(buffer);
          for (let index = 0; index < raw.length; index++) view[index] = raw.charCodeAt(index);
          data = buffer;
        } else {
          data = result.data;
        }

        const loaded = binary ? (data as ArrayBuffer).byteLength : (data as string).length;
        this.stats.loaded = loaded;
        this.stats.total = loaded;
        this.stats.loading.first = requestStarted;
        this.stats.loading.end = performance.now();
        callbacks.onSuccess({ url, data }, this.stats, context, null);
      }).catch((error: unknown) => {
        if (this.aborted) return;
        this.stats.aborted = false;
        callbacks.onError({ code: 0, text: String(error) }, context, null, this.stats);
      });
    }

    abort() {
      this.aborted = true;
      this.stats.aborted = true;
    }

    destroy() {
      this.aborted = true;
    }
  };
}
