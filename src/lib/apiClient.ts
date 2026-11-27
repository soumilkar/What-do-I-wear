export interface ApiJsonOptions {
  retries?: number;
  retryDelayMs?: number;
}

const RETRYABLE_STATUSES = new Set([408, 429, 502, 503, 504]);

const FRIENDLY_ERROR_CODES: Record<string, string> = {
  FUNCTION_INVOCATION_TIMEOUT:
    'The styling server timed out while processing this photo. Please try again.',
  FUNCTION_PAYLOAD_TOO_LARGE:
    'Photo payload was too large for the server. Try uploading a smaller image.',
  FUNCTION_THROTTLED: 'The styling server is briefly busy. Please wait a moment and try again.',
};

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
 * Safely extracts a human-readable error string from any JSON error shape:
 * - { error: "string" }
 * - { error: { message: "...", code: "..." } }  (e.g. Vercel gateway / upstream API objects)
 * - { message: "..." }
 * - plain string
 * Never throws TypeError on non-string values.
 */
export function extractApiErrorMessage(parsed: unknown): string | null {
  if (typeof parsed === 'string') {
    const clean = parsed.trim();
    return clean.length > 0 ? clean : null;
  }
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const errField = record.error;

  if (typeof errField === 'string' && errField.trim().length > 0) {
    return errField.trim();
  }

  if (errField && typeof errField === 'object') {
    const nested = errField as Record<string, unknown>;
    if (typeof nested.code === 'string' && FRIENDLY_ERROR_CODES[nested.code]) {
      return FRIENDLY_ERROR_CODES[nested.code];
    }
    if (typeof nested.message === 'string' && nested.message.trim().length > 0) {
      return nested.message.trim();
    }
    if (typeof nested.error === 'string' && nested.error.trim().length > 0) {
      return nested.error.trim();
    }
    if (typeof nested.code === 'string' && nested.code.trim().length > 0) {
      return `Styling server error (${nested.code.trim()}).`;
    }
  }

  if (typeof record.message === 'string' && record.message.trim().length > 0) {
    return record.message.trim();
  }

  return null;
}

function isRetryableNetworkFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // Only retry real browser fetch/network failures — NEVER retry JS programming TypeErrors
  if (err instanceof TypeError) {
    return /failed to fetch|network|load failed|fetch|connection|socket|dns|econn/i.test(
      err.message
    );
  }
  return /network|failed to fetch|load failed|aborted|timeout|econnreset|etimedout/i.test(
    err.message
  );
}

/**
 * Resilient JSON fetch helper for AI Studio, Cloud Run, and Vercel deployments.
 * Safely handles non-JSON HTML proxy/gateway pages and object-shaped platform error payloads,
 * and retries only genuine transient gateway/network hiccups without wasting AI credits.
 */
export async function apiJson<T>(
  url: string,
  init?: RequestInit,
  options?: ApiJsonOptions
): Promise<T> {
  const maxRetries = options?.retries ?? 1;
  const baseDelayMs = options?.retryDelayMs ?? 900;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res: Response;
    let text: string;
    let contentType: string;

    try {
      res = await fetch(url, {
        ...init,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(init?.headers ?? {}),
        },
      });
      contentType = (res.headers.get('content-type') || '').toLowerCase();
      text = await res.text();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (isRetryableNetworkFailure(err) && attempt < maxRetries) {
        await sleep(baseDelayMs * Math.pow(2, attempt));
        continue;
      }
      throw lastError;
    }

    let parsed: unknown = null;
    if (text.trim().length > 0 && !isHtmlLike(text)) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }

    if (parsed !== null && res.ok) {
      return parsed as T;
    }

    const extracted = extractApiErrorMessage(parsed);
    let message = extracted;
    if (!message) {
      if (res.status === 413) {
        message = 'Request payload was too large for the styling server.';
      } else if (res.status === 429) {
        message = 'AI service is briefly busy. Please try again in a few seconds.';
      } else if (res.status === 504 || res.status === 408) {
        message = 'The styling server timed out. Please try again in a moment.';
      } else if (isHtmlLike(text) || parsed === null) {
        message = `Styling server returned a temporary non-JSON response (HTTP ${res.status}).`;
      } else {
        message = `Request failed (HTTP ${res.status}).`;
      }
    }

    lastError = new Error(message);

    // Only retry genuine transient gateway/rate-limit statuses (408, 429, 502, 503, 504)
    // or non-JSON 5xx gateway HTML pages — NEVER retry 4xx or hard 500 JSON errors to save AI credits
    const isTransientGateway =
      RETRYABLE_STATUSES.has(res.status) ||
      (res.status >= 502 && (isHtmlLike(text) || !contentType.includes('application/json')));

    if (isTransientGateway && attempt < maxRetries) {
      await sleep(baseDelayMs * Math.pow(2, attempt));
      continue;
    }

    throw lastError;
  }

  throw lastError ?? new Error('Unable to reach the styling server.');
}
