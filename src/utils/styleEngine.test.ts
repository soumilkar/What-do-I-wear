import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeWardrobeGaps,
  computeColorHarmony,
  computeDeterministicVector,
  computeTasteCentroid,
  computeWardrobeIntelligenceSummary,
  cosineSimilarity,
  evaluateOutfitLocalHarmony,
  evaluateOutfitPaletteHarmony,
  evaluateProportionAndLayering,
  findBestCompanions,
  generateCandidateCombinations,
  hexToOklch,
  MAX_BATCH_UPLOAD_FILES,
  scoreGarmentForPerson,
  scoreOutfitForPerson,
  validateUploadBatch,
} from './styleEngine';
import type { Garment, OutfitCombination, UserProfile } from '../types/styling';

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

test('scoreGarmentForPerson and scoreOutfitForPerson deeply reward blueprint bestColors and penalize avoidColors', () => {
  const richProfile: UserProfile = {
    ...sampleProfile,
    skinUndertone: 'Warm',
    preferredFits: ['Tailored', 'Relaxed'],
    blueprint: {
      summary: 'Deep Autumn warm contrast with crisp tailored lines.',
      colorSeason: 'Deep Autumn',
      contrastLevel: 'High',
      bestColors: ['Camel', 'Ivory', 'Espresso'],
      avoidColors: ['Icy Neon Pink', 'Stark Cool Grey'],
      idealSilhouettes: ['Structured tailored', 'Double-pleat straight leg'],
      proportionTips: ['Elongate leg line with high-waisted trousers.'],
      recommendedFabrics: ['Merino wool', 'Brushed camel wool', 'Full-grain leather'],
      analyzedAt: '2026-11-01T00:00:00Z',
    },
  };

  const flatteringTop = sampleGarments[0]; // Ivory merino warm relaxed tailored
  const unflatteringTop: Garment = {
    ...flatteringTop,
    id: 'g_clash',
    name: 'Icy Neon Pink Boxy Poly Tee',
    primaryColor: 'Icy Neon Pink',
    colorHex: '#FF66CC',
    undertone: 'Cool',
    fabric: 'Shiny synthetic polyester',
    fit: 'Boxy oversized',
    silhouette: 'Wide shapeless',
  };

  const goodScore = scoreGarmentForPerson(flatteringTop, richProfile);
  const badScore = scoreGarmentForPerson(unflatteringTop, richProfile);
  assert.ok(goodScore > badScore + 20, `Expected ${goodScore} > ${badScore} + 20`);

  const goodOutfitScore = scoreOutfitForPerson([flatteringTop, sampleGarments[1]], richProfile);
  const badOutfitScore = scoreOutfitForPerson([unflatteringTop, sampleGarments[1]], richProfile);
  assert.ok(goodOutfitScore > badOutfitScore + 10);
});

test('generateCandidateCombinations respects customPrompt "no jacket" and accessory anchoring', () => {
  const accessory: Garment = {
    id: 'g5',
    name: 'Gold Minimalist Watch',
    category: 'accessories',
    subCategory: 'Watch',
    imageUrl: '/test/watch.jpg',
    primaryColor: 'Warm Gold',
    colorHex: '#C5A059',
    secondaryColors: [],
    undertone: 'Warm',
    fabric: 'Brushed gold steel',
    fabricWeight: 'Lightweight',
    texture: 'Brushed metallic',
    fit: 'Classic',
    silhouette: 'Slim dress watch',
    pattern: 'Solid',
    formality: 7,
    seasons: ['All-Season'],
    occasions: ['Smart Casual', 'Formal', 'Evening'],
    stylingNotes: 'Refined warm metallic accent.',
    layeringRole: 'Accent',
    wearCount: 3,
    hasVector: true,
    vectorSource: 'semantic-fallback',
    createdAt: '2026-11-01T00:00:00Z',
  };

  const wardrobe = [...sampleGarments, accessory];
  const vectors: Record<string, number[]> = {};
  for (const g of wardrobe) {
    vectors[g.id] = computeDeterministicVector(g);
  }

  const noJacket = generateCandidateCombinations(wardrobe, vectors, {
    occasion: 'Smart Casual',
    season: 'Autumn',
    customPrompt: 'Relaxed dinner without jacket',
    profile: sampleProfile,
    maxCandidates: 4,
  });
  assert.ok(noJacket.length >= 1);
  assert.ok(
    noJacket.every((c) => !c.itemIds.includes('g3')),
    'Expected outerwear g3 to be excluded when prompt asks for "without jacket"'
  );

  const anchoredAccessory = generateCandidateCombinations(wardrobe, vectors, {
    occasion: 'Smart Casual',
    season: 'All-Season',
    anchorItemId: 'g5',
    profile: sampleProfile,
    maxCandidates: 4,
  });
  assert.ok(anchoredAccessory.length >= 1, 'Expected candidates when anchoring an accessory');
  assert.ok(
    anchoredAccessory.every((c) => c.itemIds.includes('g5')),
    'Expected every candidate to include the anchored accessory'
  );
});

test('OKLCH color science guards dark near-miss clashes and rewards 60-30-10 + sandwich echo', () => {
  const black = hexToOklch('#0B0B0C');
  const white = hexToOklch('#FAFAFA');
  assert.ok(black.L < 0.2 && white.L > 0.95);

  // Dark near-miss clash (jet black vs very dark navy) scores significantly lower than ivory + charcoal
  const darkNearMiss = computeColorHarmony('#0B0B0C', '#141B2D');
  const crispNeutral = computeColorHarmony('#F3EFE6', '#3A3D40');
  assert.ok(
    darkNearMiss <= 72 && crispNeutral >= 90,
    `Expected darkNearMiss (${darkNearMiss}) <= 72 and crispNeutral (${crispNeutral}) >= 90`
  );

  // Sandwich echo: Espresso top + Ivory trousers + Espresso loafers
  const espressoTop: Garment = {
    ...sampleGarments[0],
    id: 'g_esp_top',
    name: 'Espresso Cashmere Polo',
    primaryColor: 'Espresso',
    colorHex: '#3A261E',
  };
  const ivoryTrouser: Garment = {
    ...sampleGarments[1],
    id: 'g_ivo_bot',
    name: 'Ivory Pleated Trousers',
    primaryColor: 'Ivory',
    colorHex: '#F3EFE6',
  };
  const palette = evaluateOutfitPaletteHarmony([espressoTop, ivoryTrouser, sampleGarments[3]]);
  assert.equal(palette.hasSandwichEcho, true);
  assert.ok(palette.paletteBonus >= 5, `Expected paletteBonus >= 5, got ${palette.paletteBonus}`);
});

test('evaluateProportionAndLayering rewards silhouette balance and weight-stepped layering while penalizing inverted weights', () => {
  const fittedLightTop: Garment = {
    ...sampleGarments[0],
    id: 'g_fit_top',
    fit: 'Slim fitted',
    silhouette: 'Clean fitted tee',
    fabricWeight: 'Lightweight',
    fabric: 'Fine cotton jersey',
  };
  const wideRelaxedBottom: Garment = {
    ...sampleGarments[1],
    id: 'g_wide_bot',
    fit: 'Wide-leg pleated',
    silhouette: 'Relaxed wide-leg trouser',
    fabricWeight: 'Midweight',
  };
  const heavyCoat = sampleGarments[2]; // Heavyweight brushed camel wool overcoat

  const wellLayered = evaluateProportionAndLayering(
    [fittedLightTop, wideRelaxedBottom, heavyCoat, sampleGarments[3]],
    'Smart Casual'
  );

  const chunkySweater: Garment = {
    ...sampleGarments[0],
    id: 'g_chunky',
    fit: 'Oversized boxy',
    silhouette: 'Slouchy chunky cable knit',
    fabricWeight: 'Heavyweight',
    fabric: 'Chunky merino wool knit',
  };
  const thinShellOuter: Garment = {
    ...sampleGarments[2],
    id: 'g_thin_outer',
    fit: 'Oversized',
    silhouette: 'Thin nylon windbreaker',
    fabricWeight: 'Lightweight',
    fabric: 'Lightweight technical nylon',
  };
  const invertedLayered = evaluateProportionAndLayering(
    [chunkySweater, wideRelaxedBottom, thinShellOuter],
    'Smart Casual'
  );

  assert.ok(
    wellLayered.score > invertedLayered.score + 15,
    `Expected wellLayered (${wellLayered.score}) > invertedLayered (${invertedLayered.score}) + 15`
  );
});

test('computeTasteCentroid, fresh exploration mode, prompt exclusions, and MMR diversity work together', () => {
  const unwornOliveTop: Garment = {
    ...sampleGarments[0],
    id: 'g_unworn_top',
    name: 'Olive Linen Shirt',
    primaryColor: 'Olive',
    colorHex: '#636B46',
    fabric: 'Washed Belgian linen',
    fabricWeight: 'Lightweight',
    wearCount: 0,
  };
  const denimBottom: Garment = {
    ...sampleGarments[1],
    id: 'g_denim',
    name: 'Indigo Selvedge Jeans',
    subCategory: 'Denim Jeans',
    primaryColor: 'Indigo',
    colorHex: '#25354C',
    fabric: 'Raw selvedge denim',
    formality: 4,
    wearCount: 10,
  };
  const whiteSneaker: Garment = {
    ...sampleGarments[3],
    id: 'g_sneaker',
    name: 'White Leather Sneakers',
    subCategory: 'Minimalist Sneakers',
    primaryColor: 'White',
    colorHex: '#F7F7F5',
    formality: 3,
    wearCount: 12,
  };

  const closet = [...sampleGarments, unwornOliveTop, denimBottom, whiteSneaker];
  const vectors: Record<string, number[]> = {};
  for (const g of closet) {
    vectors[g.id] = computeDeterministicVector(g);
  }

  const savedLook: OutfitCombination = {
    id: 'saved-1',
    title: 'Saved Classic',
    source: 'ai',
    rank: 1,
    score: 92,
    vectorHarmonyScore: 90,
    itemIds: ['g1', 'g2', 'g3', 'g4'],
    occasion: 'Smart Casual',
    season: 'Autumn',
    rationale: 'Classic warm neutral palette.',
    fabricFitNotes: 'Wool and merino.',
    bodyTailoringNote: 'Clean line.',
    finishingTouch: 'Minimal watch.',
    wearCount: 3,
    saved: true,
    createdAt: '2026-11-01T00:00:00Z',
  };

  const centroid = computeTasteCentroid(closet, vectors, [savedLook]);
  assert.ok(centroid && centroid.length === 64, 'Expected 64-dim normalized taste centroid');

  const noDenimNoSneaker = generateCandidateCombinations(closet, vectors, {
    occasion: 'Smart Casual',
    season: 'Autumn',
    customPrompt: 'polished dinner without denim and no sneakers',
    profile: sampleProfile,
    savedOutfits: [savedLook],
    explorationMode: 'fresh',
    maxCandidates: 5,
  });

  assert.ok(noDenimNoSneaker.length >= 2);
  assert.ok(
    noDenimNoSneaker.every((c) => !c.itemIds.includes('g_denim') && !c.itemIds.includes('g_sneaker')),
    'Expected denim and sneakers to be excluded by customPrompt'
  );
  // Fresh mode should surface the unworn olive top in top candidates
  assert.ok(
    noDenimNoSneaker.some((c) => c.itemIds.includes('g_unworn_top')),
    'Expected fresh exploration mode to surface unworn piece g_unworn_top'
  );
});

test('computeWardrobeIntelligenceSummary produces accurate category counts, unworn metrics, and dossier', () => {
  const unwornItem: Garment = {
    ...sampleGarments[0],
    id: 'g_new',
    name: 'Rust Silk Camp Shirt',
    primaryColor: 'Rust',
    colorHex: '#A64B2A',
    wearCount: 0,
  };
  const summary = computeWardrobeIntelligenceSummary(
    [...sampleGarments, unwornItem],
    [],
    sampleProfile
  );
  assert.equal(summary.totalItems, 5);
  assert.equal(summary.categoryCounts.tops, 2);
  assert.equal(summary.unwornCount, 1);
  assert.equal(summary.unwornSample[0].id, 'g_new');
  assert.ok(summary.dominantSwatches.length >= 4);
  assert.ok(summary.blueprintAlignmentAvg >= 60);
  assert.ok(summary.compactDossier.includes('g_new|Rust Silk Camp Shirt'));
});


