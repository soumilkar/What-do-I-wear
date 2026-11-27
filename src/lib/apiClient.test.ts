import test from 'node:test';
import assert from 'node:assert/strict';
import { apiJson, extractApiErrorMessage } from './apiClient';

test('extractApiErrorMessage handles string errors, nested Vercel error objects, and fallback messages safely', () => {
  assert.equal(extractApiErrorMessage({ error: '  Bad image format  ' }), 'Bad image format');
  assert.equal(
    extractApiErrorMessage({
      error: { code: 'FUNCTION_INVOCATION_TIMEOUT', message: 'Timed out' },
    }),
    'The styling server timed out while processing this photo. Please try again.'
  );
  assert.equal(
    extractApiErrorMessage({
      error: { message: 'Upstream quota exceeded' },
    }),
    'Upstream quota exceeded'
  );
  assert.equal(
    extractApiErrorMessage({
      error: { code: 'CUSTOM_502' },
    }),
    'Styling server error (CUSTOM_502).'
  );
  assert.equal(extractApiErrorMessage({ message: 'Top-level message' }), 'Top-level message');
  assert.equal(extractApiErrorMessage({ error: 12345 }), null);
  assert.equal(extractApiErrorMessage(null), null);
});

test('apiJson handles object-shaped error responses without throwing trim TypeError or wasting retries on 500/400', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  try {
    // Case 1: Vercel-style nested error object with HTTP 500 -> must NOT throw trim error and must NOT retry 500
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          error: {
            code: 'FUNCTION_INVOCATION_FAILED',
            message: 'Serverless function crashed while parsing photo.',
          },
        }),
        { status: 500, headers: { 'content-type': 'application/json' } }
      );
    }) as typeof fetch;

    await assert.rejects(
      () => apiJson('/api/ai/analyze-garment', { method: 'POST' }, { retries: 2, retryDelayMs: 5 }),
      /Serverless function crashed while parsing photo\./
    );
    assert.equal(calls, 1, 'Expected 0 wasted retries on hard HTTP 500 JSON error');

    // Case 2: HTTP 400 validation error -> 0 retries
    calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: 'Missing image payload' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    await assert.rejects(
      () => apiJson('/api/ai/analyze-garment', { method: 'POST' }, { retries: 2, retryDelayMs: 5 }),
      /Missing image payload/
    );
    assert.equal(calls, 1, 'Expected 0 retries on HTTP 400');

    // Case 3: Transient HTTP 504 timeout -> retries once and succeeds
    calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(
          JSON.stringify({ error: { code: 'FUNCTION_INVOCATION_TIMEOUT', message: 'Timeout' } }),
          { status: 504, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const result = await apiJson<{ ok: boolean }>(
      '/api/ai/analyze-garment',
      { method: 'POST' },
      { retries: 1, retryDelayMs: 5 }
    );
    assert.equal(result.ok, true);
    assert.equal(calls, 2, 'Expected exactly 1 retry after transient HTTP 504');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
