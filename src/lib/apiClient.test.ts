import assert from 'node:assert/strict';
import test from 'node:test';
import { apiJson } from './apiClient.ts';

test('apiJson retries transient <!doctype html> proxy responses and succeeds on recovery', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) {
      return new Response('<!doctype html><html><body>502 Bad Gateway</body></html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      });
    }
    return new Response(JSON.stringify({ ok: true, count: 45 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const res = await apiJson<{ ok: boolean; count: number }>(
      '/api/ai/analyze-garment',
      { method: 'POST', body: '{}' },
      { retries: 2, retryDelayMs: 5 }
    );
    assert.equal(calls, 2);
    assert.equal(res.ok, true);
    assert.equal(res.count, 45);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('apiJson turns persistent HTML error responses into clean messages instead of JSON syntax errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('<!doctype html><html><body>Gateway Timeout</body></html>', {
      status: 504,
      headers: { 'content-type': 'text/html' },
    })) as typeof fetch;

  try {
    await assert.rejects(
      () => apiJson('/api/ai/analyze-garment', { method: 'POST' }, { retries: 1, retryDelayMs: 5 }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.doesNotMatch(err.message, /Unexpected token/i);
        assert.match(err.message, /HTTP 504/i);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
