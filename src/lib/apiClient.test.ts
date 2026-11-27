import test from 'node:test';
import assert from 'node:assert/strict';
import {
  apiJson,
  extractApiErrorMessage,
  SseStreamEndedError,
  streamSsePost,
} from './apiClient';

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

test('streamSsePost parses split SSE delta/status/done frames, salvages partial streams, and throws SseStreamEndedError on empty EOF', async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();

  try {
    // Case 1: Chunked SSE stream with heartbeat comments + split frames
    globalThis.fetch = (async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(': connected\n\n'));
          controller.enqueue(encoder.encode('event: status\ndata: {"phase":"memory"}\n\n'));
          controller.enqueue(encoder.encode(': ping\n\n'));
          controller.enqueue(encoder.encode('event: delta\ndata: {"text":"Yes, pair "}\n'));
          controller.enqueue(encoder.encode('\nevent: delta\ndata: {"text":"navy chinos."}\n\n'));
          controller.enqueue(
            encoder.encode(
              'event: done\ndata: {"content":"Yes, pair navy chinos.","referencedItemIds":["bot_1"],"memorySummary":"- Prefers loafers","summarizedCount":4}\n\n'
            )
          );
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      });
    }) as typeof fetch;

    const deltas: string[] = [];
    const statuses: string[] = [];
    const done = await streamSsePost<{
      content: string;
      referencedItemIds: string[];
      memorySummary: string;
      summarizedCount: number;
    }>(
      '/api/ai/advisor-chat-stream',
      { message: 'test' },
      {
        onDelta: (t) => deltas.push(t),
        onStatus: (p) => statuses.push(p),
      }
    );

    assert.deepEqual(statuses, ['memory']);
    assert.deepEqual(deltas, ['Yes, pair ', 'navy chinos.']);
    assert.equal(done.content, 'Yes, pair navy chinos.');
    assert.equal(done.summarizedCount, 4);

    // Case 2: Stream drops after meaningful text arrived (no done frame) -> salvage gracefully!
    globalThis.fetch = (async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'event: delta\ndata: {"text":"BUY (8/10) — Warm chestnut suede pairs cleanly with your olive chinos."}\n\n'
            )
          );
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      });
    }) as typeof fetch;

    const salvaged = await streamSsePost<{ content: string; partial?: boolean }>(
      '/api/ai/advisor-chat-stream',
      { message: 'should I buy this' }
    );
    assert.equal(salvaged.partial, true);
    assert.match(salvaged.content, /BUY \(8\/10\)/);

    // Case 3: Stream drops with zero text received -> throws typed SseStreamEndedError so caller can fall back to JSON
    globalThis.fetch = (async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(': connected\n\n: ping\n\n'));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      });
    }) as typeof fetch;

    await assert.rejects(
      () => streamSsePost('/api/ai/advisor-chat-stream', { message: 'should I buy this' }),
      (err: unknown) => err instanceof SseStreamEndedError && err.receivedText === ''
    );

    // Case 4: Mid-stream SSE error event
    globalThis.fetch = (async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('event: error\ndata: {"error":"Upstream overloaded"}\n\n'));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }) as typeof fetch;

    await assert.rejects(
      () => streamSsePost('/api/ai/advisor-chat-stream', { message: 'test' }),
      /Upstream overloaded/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
