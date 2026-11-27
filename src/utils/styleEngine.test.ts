import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeWardrobeGaps,
  classifyTopLayerRole,
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
  inferEffectiveSeason,
  isSummerUnsuitable,
  isWinterUnsuitable,
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
  assert.ok(summary.compactDossier.includes('Unworn Pieces: 1/5'));
});

test('real multi-layer outfit assembly pairs a Base shirt/tee UNDER sweaters and never emits bare sweaters when base shirts exist', () => {
  const oxfordBase: Garment = {
    ...sampleGarments[0],
    id: 'g_oxford',
    name: 'White Cotton Oxford Shirt',
    subCategory: 'Oxford Shirt',
    primaryColor: 'White',
    colorHex: '#F9F9F7',
    undertone: 'Neutral',
    fabric: 'Crisp cotton oxford weave',
    fabricWeight: 'Lightweight',
    texture: 'Crisp woven cotton',
    fit: 'Tailored',
    silhouette: 'Button-down collar shirt',
    formality: 6,
    seasons: ['Spring', 'Summer', 'Autumn', 'Winter', 'All-Season'],
    layeringRole: 'Base',
  };

  const merinoSweater: Garment = {
    ...sampleGarments[0],
    id: 'g_sweater',
    name: 'Navy Merino Crewneck Sweater',
    subCategory: 'Sweater',
    primaryColor: 'Navy',
    colorHex: '#1F2C44',
    undertone: 'Cool',
    fabric: '100% Merino wool knit',
    fabricWeight: 'Midweight',
    texture: 'Fine ribbed wool',
    fit: 'Relaxed tailored',
    silhouette: 'Classic pullover sweater',
    formality: 6,
    seasons: ['Autumn', 'Winter'],
    // Even if an older record mis-tagged a sweater as "Base", classifyTopLayerRole must catch it as Mid!
    layeringRole: 'Base',
  };

  const closet = [oxfordBase, merinoSweater, sampleGarments[1], sampleGarments[2], sampleGarments[3]];
  const vectors: Record<string, number[]> = {};
  for (const g of closet) vectors[g.id] = computeDeterministicVector(g);

  assert.equal(classifyTopLayerRole(oxfordBase), 'base');
  assert.equal(classifyTopLayerRole(merinoSweater), 'mid');

  const autumnCandidates = generateCandidateCombinations(closet, vectors, {
    occasion: 'Smart Casual',
    season: 'Autumn',
    profile: sampleProfile,
    maxCandidates: 6,
  });

  assert.ok(autumnCandidates.length >= 1);
  // Any candidate containing the sweater MUST also include the oxford base shirt under it
  const sweaterLooks = autumnCandidates.filter((c) => c.itemIds.includes('g_sweater'));
  assert.ok(sweaterLooks.length >= 1, 'Expected at least one layered sweater look in Autumn');
  for (const look of sweaterLooks) {
    assert.ok(
      look.itemIds.includes('g_oxford'),
      `Sweater look ${look.itemIds.join(',')} must include underlayer g_oxford`
    );
    // Base shirt should come before Mid sweater in dressing order
    assert.ok(
      look.itemIds.indexOf('g_oxford') < look.itemIds.indexOf('g_sweater'),
      'Expected base shirt to precede mid-layer sweater in dressing order'
    );
  }

  // Anchoring the sweater directly must still auto-pair the base shirt underneath
  const anchoredSweater = generateCandidateCombinations(closet, vectors, {
    occasion: 'Smart Casual',
    season: 'Winter',
    anchorItemId: 'g_sweater',
    profile: sampleProfile,
    maxCandidates: 4,
  });
  assert.ok(anchoredSweater.length >= 1);
  assert.ok(
    anchoredSweater.every((c) => c.itemIds.includes('g_sweater') && c.itemIds.includes('g_oxford')),
    'Anchoring a sweater must automatically layer a base shirt underneath'
  );
});

test('strict Summer thermal filtering infers Summer from customPrompt and hard-excludes sweaters, hoodies, and winter coats', () => {
  assert.equal(inferEffectiveSeason('All-Season', 'I need something to wear in the summer'), 'Summer');
  assert.equal(inferEffectiveSeason('All-Season', 'hot humid vacation beach dinner'), 'Summer');
  assert.equal(inferEffectiveSeason('All-Season', 'freezing snowy winter commute'), 'Winter');
  assert.equal(inferEffectiveSeason('Autumn', 'smart casual dinner'), 'Autumn');

  const linenShirt: Garment = {
    ...sampleGarments[0],
    id: 'g_linen',
    name: 'Sand Washed Linen Shirt',
    subCategory: 'Linen Shirt',
    primaryColor: 'Sand',
    colorHex: '#D6C8B4',
    fabric: '100% Breathable Belgian linen',
    fabricWeight: 'Lightweight',
    texture: 'Airy slubbed linen weave',
    silhouette: 'Relaxed camp-collar shirt',
    seasons: ['Spring', 'Summer'],
    layeringRole: 'Base',
  };

  const chinos: Garment = {
    ...sampleGarments[1],
    id: 'g_chinos',
    name: 'Stone Lightweight Cotton Chinos',
    subCategory: 'Chinos',
    primaryColor: 'Stone',
    colorHex: '#C8C2B8',
    fabric: 'Lightweight cotton twill',
    fabricWeight: 'Lightweight',
    seasons: ['Spring', 'Summer', 'All-Season'],
    layeringRole: 'Bottom',
  };

  // Sweater mistakenly tagged All-Season by legacy AI
  const misTaggedSweater: Garment = {
    ...sampleGarments[0],
    id: 'g_bad_sweater',
    name: 'Cable Knit Wool Sweater',
    subCategory: 'Sweater',
    fabric: 'Merino wool knit',
    fabricWeight: 'Midweight',
    seasons: ['All-Season'],
    layeringRole: 'Mid',
  };

  const shorts: Garment = {
    ...sampleGarments[1],
    id: 'g_shorts',
    name: 'Olive Linen Shorts',
    subCategory: 'Shorts',
    fabric: 'Lightweight linen',
    fabricWeight: 'Lightweight',
    seasons: ['Summer'],
    layeringRole: 'Bottom',
  };

  assert.equal(isSummerUnsuitable(misTaggedSweater), true);
  assert.equal(isSummerUnsuitable(sampleGarments[2]), true); // Heavy camel overcoat
  assert.equal(isSummerUnsuitable(linenShirt), false);
  assert.equal(isWinterUnsuitable(shorts), true);

  const mixedCloset = [
    linenShirt,
    misTaggedSweater,
    sampleGarments[0], // Ivory Merino Crewneck
    chinos,
    sampleGarments[2], // Camel Overcoat
    sampleGarments[3], // Espresso Loafers
  ];
  const vectors: Record<string, number[]> = {};
  for (const g of mixedCloset) vectors[g.id] = computeDeterministicVector(g);

  // User leaves dropdown on "All-Season" and types "something to wear in the summer"
  const summerFromPrompt = generateCandidateCombinations(mixedCloset, vectors, {
    occasion: 'Smart Casual',
    season: 'All-Season',
    customPrompt: 'Looking for something to wear in the summer',
    profile: sampleProfile,
    maxCandidates: 5,
  });

  assert.ok(summerFromPrompt.length >= 1, 'Expected breathable summer combinations');
  assert.equal(summerFromPrompt[0].effectiveSeason, 'Summer');
  for (const cand of summerFromPrompt) {
    assert.ok(!cand.itemIds.includes('g_bad_sweater'), 'Sweater must NEVER appear in Summer');
    assert.ok(!cand.itemIds.includes('g1'), 'Merino crewneck must NEVER appear in Summer');
    assert.ok(!cand.itemIds.includes('g3'), 'Heavy wool overcoat must NEVER appear in Summer');
    assert.ok(cand.itemIds.includes('g_linen'), 'Breathable linen shirt must be selected');
  }
});

test('portrait bestColorHexes, avoidColorHexes, and expanded styleAesthetics drive personal flattery scoring', () => {
  const portraitProfile: UserProfile = {
    ...sampleProfile,
    skinUndertone: 'Warm Olive',
    styleAesthetics: ['Old Money / Heritage', 'Mediterranean Resort'],
    blueprint: {
      summary: 'Warm Olive Deep Autumn look with golden undertones.',
      visualProfile: 'Medium-tan warm olive skin with dark brown hair and warm brown eyes.',
      colorSeason: 'Deep Autumn',
      contrastLevel: 'Medium-High',
      bestColors: ['Forest Olive', 'Terracotta', 'Warm Cream'],
      bestColorHexes: ['#4B5842', '#B85D3B', '#F2E8D5'],
      avoidColors: ['Icy Lilac', 'Neon Cyan'],
      avoidColorHexes: ['#D4B8F0', '#00F0FF'],
      idealSilhouettes: ['Tailored knit', 'Relaxed pleated trouser'],
      proportionTips: ['Highlight vertical line with tonal layering.'],
      recommendedFabrics: ['Linen', 'Cashmere', 'Brushed cotton'],
      photoAnalyzed: true,
      analyzedAt: '2026-11-26T00:00:00Z',
    },
  };

  const oliveLinen: Garment = {
    ...sampleGarments[0],
    id: 'g_hex_match',
    name: 'Forest Olive Linen Polo',
    primaryColor: 'Moss',
    colorHex: '#4E5B45', // Very close OKLCH to #4B5842 even though name says Moss!
    undertone: 'Warm',
    fabric: 'Washed Italian linen',
    fit: 'Tailored',
  };

  const icyLilac: Garment = {
    ...sampleGarments[0],
    id: 'g_hex_clash',
    name: 'Pale Pastel Tee',
    primaryColor: 'Lavender Mist',
    colorHex: '#D6B9F2', // Very close OKLCH to avoidColorHexes #D4B8F0
    undertone: 'Cool',
    fabric: 'Polyester jersey',
    fit: 'Oversized',
  };

  const matchScore = scoreGarmentForPerson(oliveLinen, portraitProfile);
  const clashScore = scoreGarmentForPerson(icyLilac, portraitProfile);
  assert.ok(
    matchScore >= clashScore + 22,
    `Expected OKLCH hex match (${matchScore}) >= clash (${clashScore}) + 22`
  );
});

test('44-item closet enforces global exposure caps and rotates fresh pieces across consecutive ranking batches', () => {
  const palette = [
    { name: 'Ivory', hex: '#F3EFE6', undertone: 'Warm' as const },
    { name: 'Navy', hex: '#1E2D45', undertone: 'Cool' as const },
    { name: 'Olive', hex: '#556044', undertone: 'Warm' as const },
    { name: 'Charcoal', hex: '#3A3D40', undertone: 'Neutral' as const },
    { name: 'Camel', hex: '#C29B6C', undertone: 'Warm' as const },
    { name: 'Espresso', hex: '#3B2820', undertone: 'Warm' as const },
    { name: 'Slate', hex: '#5A6978', undertone: 'Cool' as const },
    { name: 'Sand', hex: '#D6C8B4', undertone: 'Warm' as const },
  ];

  const closet: Garment[] = [];
  const makeItem = (
    id: string,
    name: string,
    category: Garment['category'],
    subCategory: string,
    layeringRole: Garment['layeringRole'],
    idx: number,
    fabric: string,
    weight: Garment['fabricWeight']
  ): Garment => {
    const c = palette[idx % palette.length];
    return {
      id,
      name: `${c.name} ${name} ${idx + 1}`,
      category,
      subCategory,
      imageUrl: `/test/${id}.jpg`,
      primaryColor: c.name,
      colorHex: c.hex,
      secondaryColors: [],
      undertone: c.undertone,
      fabric,
      fabricWeight: weight,
      texture: 'Clean weave',
      fit: idx % 2 === 0 ? 'Tailored' : 'Relaxed',
      silhouette: 'Clean modern cut',
      pattern: 'Solid',
      formality: 5 + (idx % 3),
      seasons: ['Spring', 'Autumn', 'Winter', 'All-Season'],
      occasions: ['Smart Casual', 'Everyday', 'Evening'],
      stylingNotes: 'Versatile staple.',
      layeringRole,
      wearCount: idx % 4,
      hasVector: true,
      vectorSource: 'semantic-fallback',
      createdAt: `2026-11-${String((idx % 25) + 1).padStart(2, '0')}T00:00:00Z`,
    };
  };

  for (let i = 0; i < 14; i++) {
    closet.push(makeItem(`base_${i}`, 'Oxford Shirt', 'tops', 'Oxford Shirt', 'Base', i, 'Cotton oxford', 'Lightweight'));
  }
  for (let i = 0; i < 6; i++) {
    closet.push(makeItem(`mid_${i}`, 'Merino Sweater', 'tops', 'Sweater', 'Mid', i + 2, 'Merino wool knit', 'Midweight'));
  }
  for (let i = 0; i < 10; i++) {
    closet.push(makeItem(`bot_${i}`, 'Tailored Trousers', 'bottoms', 'Trousers', 'Bottom', i + 1, 'Wool twill', 'Midweight'));
  }
  for (let i = 0; i < 6; i++) {
    closet.push(makeItem(`out_${i}`, 'Structured Jacket', 'outerwear', 'Jacket', 'Outer', i + 3, 'Brushed wool', 'Heavyweight'));
  }
  for (let i = 0; i < 6; i++) {
    closet.push(makeItem(`shoe_${i}`, 'Leather Loafers', 'footwear', 'Loafers', 'Footwear', i + 4, 'Calfskin leather', 'Midweight'));
  }
  for (let i = 0; i < 2; i++) {
    closet.push(makeItem(`acc_${i}`, 'Leather Belt', 'accessories', 'Belt', 'Accent', i, 'Full-grain leather', 'Lightweight'));
  }

  assert.equal(closet.length, 44);
  const vectors: Record<string, number[]> = {};
  for (const g of closet) vectors[g.id] = computeDeterministicVector(g);

  const batch1 = generateCandidateCombinations(closet, vectors, {
    occasion: 'Smart Casual',
    season: 'Autumn',
    profile: sampleProfile,
    rotationSeed: 101,
    maxCandidates: 10,
  });

  assert.equal(batch1.length, 10);
  const batch1UniqueItems = new Set(batch1.flatMap((c) => c.itemIds));
  assert.ok(
    batch1UniqueItems.size >= 14,
    `Expected batch 1 (10 finalists) to span >= 14 distinct garments, got ${batch1UniqueItems.size}`
  );

  // Convert top 5 of batch1 into previousCombinations and re-run with a new rotationSeed
  const prevOutfits: OutfitCombination[] = batch1.slice(0, 5).map((c, idx) => ({
    id: `prev-${idx}`,
    title: `Prev ${idx}`,
    source: 'ai',
    score: c.localScore,
    vectorHarmonyScore: c.vectorScore,
    itemIds: c.itemIds,
    occasion: 'Smart Casual',
    season: 'Autumn',
    rationale: '',
    fabricFitNotes: '',
    bodyTailoringNote: '',
    finishingTouch: '',
    wearCount: 0,
    saved: false,
    createdAt: '2026-11-26T00:00:00Z',
  }));

  const batch2 = generateCandidateCombinations(closet, vectors, {
    occasion: 'Smart Casual',
    season: 'Autumn',
    profile: sampleProfile,
    previousCombinations: prevOutfits,
    rotationSeed: 202,
    maxCandidates: 10,
  });

  const batch1Top5Set = new Set(prevOutfits.flatMap((o) => o.itemIds));
  const batch2Top5Set = new Set(batch2.slice(0, 5).flatMap((c) => c.itemIds));
  const newlyIntroduced = [...batch2Top5Set].filter((id) => !batch1Top5Set.has(id));
  assert.ok(
    newlyIntroduced.length >= 4,
    `Expected consecutive batch to introduce >= 4 fresh garments, got ${newlyIntroduced.length}`
  );
});




