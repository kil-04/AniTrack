export interface PlaybackRequest {
  readonly revision: number;
  readonly context: string;
}

/** Only the newest selection may attach media or finish its loading state. */
export class PlaybackRequestGate {
  private revision = 0;
  private active: PlaybackRequest | null = null;

  begin(context: string): PlaybackRequest {
    this.active = { revision: ++this.revision, context };
    return this.active;
  }

  current(): PlaybackRequest | null {
    return this.active;
  }

  isCurrent(request: PlaybackRequest | null, context: string): boolean {
    return request !== null && request.revision === this.revision && request.context === context;
  }

  invalidate(): void {
    this.revision++;
    this.active = null;
  }
}

export function capturePlaybackPosition(live: number | undefined, pending: number | null): number {
  // A pending seek is cleared once applied, so while one exists the element is
  // still near 0 on a freshly attached source: that seek is the real position.
  if (pending !== null && Number.isFinite(pending) && pending >= 0) return pending;
  return live !== undefined && Number.isFinite(live) && live > 0 ? live : 0;
}

/** An explicit switch position, including zero, wins over older saved progress. */
export function chooseResumePosition(explicit: number | undefined, saved: number | null): number | null {
  if (explicit !== undefined && Number.isFinite(explicit) && explicit >= 0) return explicit;
  return saved !== null && Number.isFinite(saved) && saved > 0 ? saved : null;
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "";
}

// Electron wraps invoke failures and does not preserve custom Error fields.
const MANUAL_ACCESS_ERROR = /\b(?:PAHE_SECURITY_CHECK|PAHE_RATE_LIMITED|ANIKOTO_SECURITY_CHECK|ANIKOTO_RATE_LIMITED|ANIKOTO_COOLDOWN):\s*/;

export function requiresManualProviderRetry(error: unknown): boolean {
  return MANUAL_ACCESS_ERROR.test(errorMessage(error));
}

export function providerPlaybackErrorMessage(error: unknown, fallback = "The stream is unavailable. Retry or choose another provider."): string {
  const message = errorMessage(error);
  const marker = MANUAL_ACCESS_ERROR.exec(message);
  return (marker ? message.slice(marker.index + marker[0].length) : message).trim() || fallback;
}

/** A damaged media stream must eventually reach server fallback. */
export class HlsRecoveryBudget {
  private mediaRetries = 0;
  private networkRetries = 0;

  nextMediaRetry(): number | null {
    return this.mediaRetries < 2 ? ++this.mediaRetries : null;
  }

  nextNetworkRetry(): number | null {
    return this.networkRetries < 3 ? ++this.networkRetries : null;
  }
}
