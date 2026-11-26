export interface ApiJsonOptions {
  retries?: number;
  retryDelayMs?: number;
}

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isHtmlLike(text: string): boolean {
  const trimmed = text.trimStart().slice(0, 40).toLowerCase();
  return (
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<html') ||
    trimmed.startsWith('<head') ||
    trimmed.startsWith('<body') ||
    trimmed.startsWith('<?xml')
  );
}

/**
 * Resilient JSON fetch helper for AI Studio, Cloud Run, and Vercel deployments.
 * Safely handles non-JSON HTML proxy/gateway pages (<!doctype html>...) and
 * automatically retries transient 429/502/503/504/network hiccups with backoff.
 */
export async function apiJson<T>(
  url: string,
  init?: RequestInit,
  options?: ApiJsonOptions
): Promise<T> {
  const maxRetries = options?.retries ?? 2;
  const baseDelayMs = options?.retryDelayMs ?? 800;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(init?.headers ?? {}),
        },
      });

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      const text = await res.text();

      let parsed: (T & { error?: string }) | null = null;
      if (text.trim().length > 0 && !isHtmlLike(text)) {
        try {
          parsed = JSON.parse(text) as T & { error?: string };
        } catch {
          parsed = null;
        }
      }

      if (parsed && res.ok) {
        return parsed;
      }

      const isTransientGateway =
        RETRYABLE_STATUSES.has(res.status) ||
        !parsed ||
        isHtmlLike(text) ||
        !contentType.includes('application/json');

      // Surface clean human-readable messages instead of raw JSON syntax errors
      let message = parsed?.error?.trim();
      if (!message) {
        if (res.status === 413) {
          message = 'Request payload was too large for the styling server.';
        } else if (res.status === 429) {
          message = 'AI service is briefly busy. Please try again in a few seconds.';
        } else if (isHtmlLike(text) || !parsed) {
          message = `Styling server returned a temporary non-JSON response (HTTP ${res.status}).`;
        } else {
          message = `Request failed (HTTP ${res.status}).`;
        }
      }

      lastError = new Error(message);

      if (isTransientGateway && attempt < maxRetries) {
        await sleep(baseDelayMs * Math.pow(2, attempt));
        continue;
      }

      throw lastError;
    } catch (err) {
      const isNetworkError =
        err instanceof TypeError ||
        (err instanceof Error &&
          /network|failed to fetch|load failed|aborted|timeout/i.test(err.message));

      lastError = err instanceof Error ? err : new Error(String(err));

      if (isNetworkError && attempt < maxRetries) {
        await sleep(baseDelayMs * Math.pow(2, attempt));
        continue;
      }

      throw lastError;
    }
  }

  throw lastError ?? new Error('Unable to reach the styling server.');
}
