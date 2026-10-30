import type { HlsConfig, RetryConfig } from "hls.js";

export function isHlsAccessRejection(status: unknown): boolean {
  return Number(status) === 403 || Number(status) === 429;
}

/** HLS errors can be nonfatal while the internal loader is scheduling a retry. */
export function hlsAccessRejectionStatus(error: unknown): 403 | 429 | null {
  if (!error || typeof error !== "object") return null;
  const data = error as { response?: { code?: unknown }; networkDetails?: { status?: unknown } };
  for (const status of [data.response?.code, data.networkDetails?.status]) {
    if (isHlsAccessRejection(status)) return Number(status) as 403 | 429;
  }
  return null;
}

function protectedRetry(config: RetryConfig | null): RetryConfig | null {
  if (!config) return null;
  return {
    ...config,
    shouldRetry: (retryConfig, count, timeout, response, retry) =>
      !isHlsAccessRejection(response?.code) &&
      (config.shouldRetry?.(retryConfig, count, timeout, response, retry) ?? retry),
  };
}

const policyNames = ["fragLoadPolicy", "keyLoadPolicy", "playlistLoadPolicy", "manifestLoadPolicy"] as const;
type MediaPolicies = Pick<HlsConfig, typeof policyNames[number]>;

/** Preserve library limits/backoff, except access checks must never be retried. */
export function protectedHlsLoadPolicies(defaults: MediaPolicies): MediaPolicies {
  return Object.fromEntries(policyNames.map(name => {
    const policy = defaults[name].default;
    return [name, { default: { ...policy,
      timeoutRetry: protectedRetry(policy.timeoutRetry), errorRetry: protectedRetry(policy.errorRetry),
    } }];
  })) as MediaPolicies;
}
