import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAdvisorMarkdown } from './advisorMarkdown.ts';
import type { Garment } from '../types/styling.ts';

const testGarments: Garment[] = [
  {
    id: 'garment_ivory_knit',
    name: 'Ivory Merino Crewneck',
    category: 'tops',
    subCategory: 'Sweater',
    imageUrl: '/test/ivory.jpg',
    primaryColor: 'Ivory',
    colorHex: '#F3EFE6',
    secondaryColors: [],
    undertone: 'Warm',
    fabric: 'Merino wool',
    fabricWeight: 'Midweight',
    texture: 'Fine knit',
    fit: 'Tailored',
    silhouette: 'Crewneck',
    pattern: 'Solid',
    formality: 6,
    seasons: ['Autumn'],
    occasions: ['Smart Casual'],
    stylingNotes: '',
    layeringRole: 'Base',
    wearCount: 0,
    hasVector: true,
    vectorSource: 'semantic-fallback',
    createdAt: '2026-11-01T00:00:00Z',
  },
  {
    id: 'garment_charcoal_trousers',
    name: 'Charcoal Pleated Trousers',
    category: 'bottoms',
    subCategory: 'Trousers',
    imageUrl: '/test/charcoal.jpg',
    primaryColor: 'Charcoal',
    colorHex: '#3A3D40',
    secondaryColors: [],
    undertone: 'Neutral',
    fabric: 'Wool twill',
    fabricWeight: 'Midweight',
    texture: 'Smooth',
    fit: 'Tailored',
    silhouette: 'Straight',
    pattern: 'Solid',
    formality: 8,
    seasons: ['All-Season'],
    occasions: ['Smart Casual', 'Formal'],
    stylingNotes: '',
    layeringRole: 'Bottom',
    wearCount: 0,
    hasVector: true,
    vectorSource: 'semantic-fallback',
    createdAt: '2026-11-01T00:00:00Z',
  },
];

test('parseAdvisorMarkdown parses headings, bold, lists, explicit [[item:...]] links, and auto-linked names', () => {
  const md = [
    '### Verdict: **Buy Option 1**',
    '',
    '- Pairs cleanly with [[item:garment_ivory_knit|Ivory Merino Crewneck]] and your **Charcoal Pleated Trousers**.',
    '- Avoid *clashing* cool greys.',
    '',
    '1. First wear it open.',
    '2. Second try `tonal` layering.',
  ].join('\n');

  const blocks = parseAdvisorMarkdown(md, testGarments);
  assert.equal(blocks[0].type, 'heading');
  assert.equal(blocks[1].type, 'ul');
  assert.equal(blocks[2].type, 'ol');

  if (blocks[1].type === 'ul') {
    const firstBullet = blocks[1].items[0];
    assert.ok(
      firstBullet.some((t) => t.type === 'garment' && t.garmentId === 'garment_ivory_knit'),
      'Expected explicit [[item:...]] tag to become a garment link'
    );
    const boldToken = firstBullet.find((t) => t.type === 'bold');
    assert.ok(boldToken && boldToken.type === 'bold');
    assert.ok(
      boldToken.children.some(
        (c) => c.type === 'garment' && c.garmentId === 'garment_charcoal_trousers'
      ),
      'Expected wardrobe item name inside **bold** to auto-link cleanly'
    );
  }
});

test('parseAdvisorMarkdown rejects unsafe javascript: URLs and degrades deleted garment IDs cleanly', () => {
  const md = 'Check [bad](javascript:alert(1)) and [[item:deleted_id|Old Jacket]] safely.';
  const blocks = parseAdvisorMarkdown(md, testGarments);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'paragraph');
  if (blocks[0].type === 'paragraph') {
    const tokens = blocks[0].lines[0];
    assert.ok(!tokens.some((t) => t.type === 'link'), 'javascript: URL must never produce a link token');
    assert.ok(
      tokens.some((t) => t.type === 'text' && t.text.includes('Old Jacket')),
      'Deleted garment ID should fall back to readable label text'
    );
  }
});

test('parseAdvisorMarkdown prefers exact garment name when AI slips on the tag ID', () => {
  const md = 'Pair with [[item:garment_ivory_knit|Charcoal Pleated Trousers]] tonight.';
  const blocks = parseAdvisorMarkdown(md, testGarments);
  assert.equal(blocks[0].type, 'paragraph');
  if (blocks[0].type === 'paragraph') {
    const garmentToken = blocks[0].lines[0].find((t) => t.type === 'garment');
    assert.ok(garmentToken && garmentToken.type === 'garment');
    assert.equal(garmentToken.garmentId, 'garment_charcoal_trousers');
  }
});

