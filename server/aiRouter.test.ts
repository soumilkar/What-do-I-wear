import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearModelCooldowns,
  compactGarmentLine,
  DEEP_REASONING_HIERARCHY,
  executeWithModelHierarchy,
  FAST_HIERARCHY,
  getCooldownMsForError,
  selectDiscoveredFreeModels,
} from './aiRouter.ts';
import type { Garment } from '../src/types/styling.ts';

test('executeWithModelHierarchy immediately skips other tiers of the same model on 429/503', async () => {
  clearModelCooldowns();
  const calls: string[] = [];

  const result = await executeWithModelHierarchy(DEEP_REASONING_HIERARCHY, async (tier) => {
    calls.push(tier.id);
    if (tier.model === 'gemini-4-hydrogen') {
      throw new Error(
        '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","details":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"},{"retryDelay":"79705s"}]}}'
      );
    }
    return { ranked: true };
  });

  // gemini-4-hydrogen (fast) must NOT be called after gemini-4-hydrogen (balanced) hit 429
  assert.deepEqual(calls, ['gemini-4-hydrogen (balanced)', 'gemini-3.1-flash-lite (reasoned)']);
  assert.equal(result.modelUsed, 'gemini-3.1-flash-lite (reasoned)');
  assert.deepEqual(result.data, { ranked: true });
  clearModelCooldowns();
});

test('getCooldownMsForError applies multi-hour cooldown for Free Tier daily quota exhaustion', () => {
  const withRetryDelay = getCooldownMsForError(
    '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","details":[{"retryDelay":"79705s"}]}}'
  );
  assert.ok(withRetryDelay >= 6 * 60 * 60_000, `Expected >= 6h cooldown, got ${withRetryDelay}ms`);

  const perDayNoDelay = getCooldownMsForError(
    '429 RESOURCE_EXHAUSTED GenerateRequestsPerDayPerProjectPerModel-FreeTier'
  );
  assert.ok(perDayNoDelay >= 6 * 60 * 60_000);

  const perMinute = getCooldownMsForError('429 RESOURCE_EXHAUSTED rate limit');
  assert.equal(perMinute, 90_000);

  // Batch garment indexing should prioritize flash-lite to conserve hydrogen daily quota
  assert.equal(FAST_HIERARCHY[0].model, 'gemini-3.1-flash-lite');
});

test('executeWithModelHierarchy skips models on transient cooldown for fast failover', async () => {
  clearModelCooldowns();
  const firstCalls: string[] = [];

  await executeWithModelHierarchy(DEEP_REASONING_HIERARCHY, async (tier) => {
    firstCalls.push(tier.id);
    if (tier.model === 'gemini-4-hydrogen') {
      throw new Error('429 RESOURCE_EXHAUSTED');
    }
    return { ok: true };
  });

  assert.deepEqual(firstCalls, ['gemini-4-hydrogen (balanced)', 'gemini-3.1-flash-lite (reasoned)']);

  const secondCalls: string[] = [];
  const second = await executeWithModelHierarchy(DEEP_REASONING_HIERARCHY, async (tier) => {
    secondCalls.push(tier.id);
    return { ok: true };
  });

  assert.equal(secondCalls.length, 1);
  assert.equal(second.modelUsed, 'gemini-3.1-flash-lite (reasoned)');
  clearModelCooldowns();
});

test('executeWithModelHierarchy stops immediately on invalid API key errors', async () => {
  clearModelCooldowns();
  const calls: string[] = [];

  await assert.rejects(
    executeWithModelHierarchy(DEEP_REASONING_HIERARCHY, async (tier) => {
      calls.push(tier.id);
      throw new Error('API_KEY_INVALID');
    }),
    /API_KEY_INVALID/
  );

  assert.equal(calls.length, 1);
});

test('selectDiscoveredFreeModels filters out deprecated and paid models while ranking newest free flash models first', () => {
  const existing = new Set(['gemini-4-hydrogen', 'gemini-3.1-flash-lite']);
  const discovered = selectDiscoveredFreeModels(
    [
      { name: 'models/gemini-1.5-flash', supportedActions: ['generateContent'] },
      { name: 'models/gemini-2.0-flash', supportedActions: ['generateContent'] },
      { name: 'models/gemini-4-neon', supportedActions: ['generateContent'] },
      { name: 'models/gemini-4-carbon', supportedActions: ['generateContent'] },
      { name: 'models/gemini-4-argon', supportedActions: ['generateContent'] },
      { name: 'models/gemini-3-flash-preview', supportedActions: ['generateContent'] },
      { name: 'models/gemini-2.5-flash', supportedActions: ['generateContent'] },
      { name: 'models/gemini-2.5-flash-lite', supportedActions: ['generateContent'] },
      { name: 'models/gemini-3.1-flash-lite-image', supportedActions: ['generateContent'] },
      { name: 'models/gemini-embedding-2', supportedActions: ['embedContent'] },
    ],
    existing,
    6
  );

  assert.deepEqual(
    discovered.map((d) => d.model),
    ['gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']
  );
  assert.ok(discovered[0].thinkingLevel !== undefined);
  assert.equal(discovered[1].thinkingLevel, undefined);
});

test('compactGarmentLine compresses garment metadata cleanly for minimal AI token usage', () => {
  const g: Garment = {
    id: 'g-101',
    name: 'Camel Overcoat',
    category: 'outerwear',
    subCategory: 'Overcoat',
    imageUrl: '/uploads/coat.jpg',
    primaryColor: 'Camel',
    colorHex: '#C29B6C',
    secondaryColors: [],
    undertone: 'Warm',
    fabric: 'Brushed wool',
    fabricWeight: 'Heavyweight',
    texture: 'Soft twill',
    fit: 'Structured',
    silhouette: 'Longline',
    pattern: 'Solid',
    formality: 8,
    seasons: ['Autumn', 'Winter'],
    occasions: ['Formal'],
    stylingNotes: 'Pairs cleanly with dark trousers.',
    layeringRole: 'Outer',
    wearCount: 1,
    hasVector: true,
    vectorSource: 'gemini-embedding-2',
    createdAt: '2026-11-01T00:00:00Z',
  };

  const line = compactGarmentLine(g);
  assert.ok(line.includes('g-101|Camel Overcoat|outerwear/Overcoat'));
  assert.ok(line.includes('#C29B6C'));
  assert.ok(line.length < 220, 'Compact descriptor should stay under 220 chars');
});
