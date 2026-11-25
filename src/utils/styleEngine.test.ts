import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeWardrobeGaps,
  computeColorHarmony,
  computeDeterministicVector,
  cosineSimilarity,
  evaluateOutfitLocalHarmony,
  findBestCompanions,
  generateCandidateCombinations,
  MAX_BATCH_UPLOAD_FILES,
  validateUploadBatch,
} from './styleEngine';
import type { Garment, UserProfile } from '../types/styling';

const sampleGarments: Garment[] = [
  {
    id: 'g1',
    name: 'Ivory Merino Crewneck',
    category: 'tops',
    subCategory: 'Knitwear',
    imageUrl: '/test/ivory.jpg',
    primaryColor: 'Ivory',
    colorHex: '#F3EFE6',
    secondaryColors: [],
    undertone: 'Warm',
    fabric: 'Fine-gauge merino wool',
    fabricWeight: 'Midweight',
    texture: 'Ribbed fine knit',
    fit: 'Relaxed tailored',
    silhouette: 'Clean crew neck',
    pattern: 'Solid',
    formality: 6,
    seasons: ['Autumn', 'Winter', 'Spring'],
    occasions: ['Smart Casual', 'Everyday', 'Travel'],
    stylingNotes: 'Layers smoothly under structured coats.',
    layeringRole: 'Base',
    wearCount: 4,
    hasVector: true,
    vectorSource: 'semantic-fallback',
    createdAt: '2026-11-01T00:00:00Z',
  },
  {
    id: 'g2',
    name: 'Charcoal Pleated Wool Trousers',
    category: 'bottoms',
    subCategory: 'Tailored Trousers',
    imageUrl: '/test/charcoal.jpg',
    primaryColor: 'Charcoal',
    colorHex: '#3A3D40',
    secondaryColors: [],
    undertone: 'Neutral',
    fabric: 'Worsted wool twill',
    fabricWeight: 'Midweight',
    texture: 'Smooth worsted drape',
    fit: 'Tailored relaxed taper',
    silhouette: 'Double-pleat straight leg',
    pattern: 'Solid',
    formality: 8,
    seasons: ['All-Season'],
    occasions: ['Smart Casual', 'Formal', 'Evening'],
    stylingNotes: 'Elongates leg line with crisp crease.',
    layeringRole: 'Bottom',
    wearCount: 6,
    hasVector: true,
    vectorSource: 'semantic-fallback',
    createdAt: '2026-11-01T00:00:00Z',
  },
  {
    id: 'g3',
    name: 'Camel Double-Breasted Overcoat',
    category: 'outerwear',
    subCategory: 'Overcoat',
    imageUrl: '/test/camel.jpg',
    primaryColor: 'Camel',
    colorHex: '#C29B6C',
    secondaryColors: [],
    undertone: 'Warm',
    fabric: 'Brushed camel wool',
    fabricWeight: 'Heavyweight',
    texture: 'Soft brushed twill',
    fit: 'Structured tailored',
    silhouette: 'Longline double-breasted',
    pattern: 'Solid',
    formality: 8,
    seasons: ['Autumn', 'Winter'],
    occasions: ['Smart Casual', 'Formal', 'Evening'],
    stylingNotes: 'Statement tonal outer layer.',
    layeringRole: 'Outer',
    wearCount: 2,
    hasVector: true,
    vectorSource: 'semantic-fallback',
    createdAt: '2026-11-01T00:00:00Z',
  },
  {
    id: 'g4',
    name: 'Espresso Calfskin Loafers',
    category: 'footwear',
    subCategory: 'Loafers',
    imageUrl: '/test/loafers.jpg',
    primaryColor: 'Espresso Brown',
    colorHex: '#3B2820',
    secondaryColors: [],
    undertone: 'Warm',
    fabric: 'Full-grain calfskin leather',
    fabricWeight: 'Midweight',
    texture: 'Polished smooth leather',
    fit: 'Structured sleek',
    silhouette: 'Classic penny loafer',
    pattern: 'Solid',
    formality: 7,
    seasons: ['All-Season'],
    occasions: ['Smart Casual', 'Formal', 'Everyday'],
    stylingNotes: 'Bridges denim and wool tailoring.',
    layeringRole: 'Footwear',
    wearCount: 8,
    hasVector: true,
    vectorSource: 'semantic-fallback',
    createdAt: '2026-11-01T00:00:00Z',
  },
];

const sampleProfile: UserProfile = {
  name: 'Maya Chen',
  photoUrl: '/test/portrait.jpg',
  bio: 'Design director who loves clean tailoring and relaxed luxury.',
  height: '5\'7"',
  bodyType: 'Balanced Athletic',
  skinUndertone: 'Warm',
  preferredFits: ['Tailored', 'Relaxed'],
  styleAesthetics: ['Quiet Luxury', 'Minimalist'],
  budgetRange: 'Contemporary',
  climate: 'Four-Season',
  stylingGoals: 'Effortless daily polish',
  blueprint: null,
  updatedAt: '2026-11-01T00:00:00Z',
};

test('cosineSimilarity returns 1 for identical vectors and 0 for orthogonal vectors', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 0, 0], [1, 0, 0]) - 1) < 1e-6);
  assert.ok(Math.abs(cosineSimilarity([1, 0, 0], [0, 1, 0])) < 1e-6);
});

test('computeColorHarmony scores editorial neutral pairs high', () => {
  const ivoryCharcoal = computeColorHarmony('#F3EFE6', '#3A3D40');
  assert.ok(ivoryCharcoal >= 85, `Expected >= 85, got ${ivoryCharcoal}`);
});

test('validateUploadBatch enforces 50-item maximum and valid MIME types', () => {
  const validFiles = Array.from({ length: MAX_BATCH_UPLOAD_FILES }, (_, i) => ({
    name: `item-${i}.jpg`,
    type: 'image/jpeg',
    size: 200_000,
  }));
  assert.equal(validateUploadBatch(validFiles).valid, true);
  assert.equal(validateUploadBatch(validFiles).acceptedCount, 50);

  const tooMany = [...validFiles, { name: 'extra.jpg', type: 'image/jpeg', size: 100_000 }];
  assert.equal(validateUploadBatch(tooMany).valid, false);

  const largePhoto = [{ name: 'raw-dslr.jpg', type: 'image/jpeg', size: 28 * 1024 * 1024 }];
  assert.equal(validateUploadBatch(largePhoto).valid, true);

  const badType = [{ name: 'doc.pdf', type: 'application/pdf', size: 50_000 }];
  assert.equal(validateUploadBatch(badType).valid, false);
});

test('findBestCompanions returns cross-category ranked companions using vectors', () => {
  const vectors: Record<string, number[]> = {};
  for (const g of sampleGarments) {
    vectors[g.id] = computeDeterministicVector(g);
  }
  const companions = findBestCompanions('g1', sampleGarments, vectors, 3);
  assert.equal(companions.length, 3);
  assert.ok(companions.every((c) => c.garmentId !== 'g1'));
  assert.ok(companions[0].score >= companions[1].score);
});

test('generateCandidateCombinations and evaluateOutfitLocalHarmony produce ranked complete outfits', () => {
  const vectors: Record<string, number[]> = {};
  for (const g of sampleGarments) {
    vectors[g.id] = computeDeterministicVector(g);
  }
  const candidates = generateCandidateCombinations(sampleGarments, vectors, {
    occasion: 'Smart Casual',
    season: 'Autumn',
    maxCandidates: 4,
  });
  assert.ok(candidates.length >= 1);
  assert.ok(candidates[0].itemIds.includes('g1'));
  assert.ok(candidates[0].itemIds.includes('g2'));

  const localEval = evaluateOutfitLocalHarmony(sampleGarments, vectors);
  assert.ok(localEval.overallScore >= 75);
});

test('analyzeWardrobeGaps flags missing footwear variety and accessories', () => {
  const gaps = analyzeWardrobeGaps(sampleGarments, sampleProfile);
  assert.ok(gaps.length >= 2);
  assert.ok(gaps.some((g) => g.category === 'footwear'));
  assert.ok(gaps.some((g) => g.category === 'accessories'));
});
