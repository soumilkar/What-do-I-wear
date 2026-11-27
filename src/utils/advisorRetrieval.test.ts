import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAdvisorWardrobeContext,
  detectAdvisorIntent,
  ensureGarmentHyperlinks,
  extractExplicitlyAskedIds,
  extractRecentlyMentionedIds,
  formatCompactHistoryForAdvisor,
} from './advisorRetrieval';
import type { AdvisorMessage, Garment, UserProfile } from '../types/styling';

function make44ItemCloset(): Garment[] {
  const items: Garment[] = [];
  const colors = [
    { name: 'Ivory', hex: '#F3EFE6', undertone: 'Warm' as const },
    { name: 'Navy', hex: '#1E2C42', undertone: 'Cool' as const },
    { name: 'Olive', hex: '#556046', undertone: 'Warm' as const },
    { name: 'Charcoal', hex: '#3A3D40', undertone: 'Neutral' as const },
    { name: 'Sand', hex: '#D4C5AE', undertone: 'Warm' as const },
    { name: 'Burgundy', hex: '#5E242D', undertone: 'Warm' as const },
    { name: 'Slate Blue', hex: '#4A6278', undertone: 'Cool' as const },
    { name: 'Espresso', hex: '#3A261E', undertone: 'Warm' as const },
    { name: 'Black', hex: '#141416', undertone: 'Neutral' as const },
    { name: 'Forest Green', hex: '#274233', undertone: 'Warm' as const },
  ];

  // 14 Base tops
  for (let i = 0; i < 14; i++) {
    const c = colors[i % colors.length];
    items.push({
      id: `base_${i + 1}`,
      name: `${c.name} Cotton Oxford Shirt ${i + 1}`,
      category: 'tops',
      subCategory: i % 2 === 0 ? 'Oxford Shirt' : 'Linen Tee',
      imageUrl: '',
      primaryColor: c.name,
      colorHex: c.hex,
      secondaryColors: [],
      undertone: c.undertone,
      fabric: i % 2 === 0 ? 'Crisp cotton oxford' : 'Breathable linen jersey',
      fabricWeight: 'Lightweight',
      texture: 'Crisp woven',
      fit: 'Tailored',
      silhouette: 'Clean button shirt',
      pattern: 'Solid',
      formality: 5 + (i % 3),
      seasons: ['Spring', 'Summer', 'Autumn', 'All-Season'],
      occasions: ['Smart Casual', 'Everyday'],
      stylingNotes: 'Versatile base layer.',
      layeringRole: 'Base',
      wearCount: 0,
      hasVector: true,
      vectorSource: 'semantic-fallback',
      createdAt: `2026-11-${String(28 - (i % 20)).padStart(2, '0')}T00:00:00Z`,
    });
  }

  // 8 Mid-layer sweaters
  for (let i = 0; i < 8; i++) {
    const c = colors[(i + 2) % colors.length];
    items.push({
      id: `mid_${i + 1}`,
      name: `${c.name} Merino Crewneck Sweater ${i + 1}`,
      category: 'tops',
      subCategory: 'Sweater',
      imageUrl: '',
      primaryColor: c.name,
      colorHex: c.hex,
      secondaryColors: [],
      undertone: c.undertone,
      fabric: 'Merino wool knit',
      fabricWeight: 'Midweight',
      texture: 'Fine ribbed wool',
      fit: 'Relaxed',
      silhouette: 'Classic sweater',
      pattern: 'Solid',
      formality: 6,
      seasons: ['Autumn', 'Winter'],
      occasions: ['Smart Casual', 'Everyday'],
      stylingNotes: 'Mid-layer knit.',
      layeringRole: 'Mid',
      wearCount: 0,
      hasVector: true,
      vectorSource: 'semantic-fallback',
      createdAt: `2026-11-${String(20 - i).padStart(2, '0')}T00:00:00Z`,
    });
  }

  // 10 Bottoms
  for (let i = 0; i < 10; i++) {
    const c = colors[(i + 3) % colors.length];
    items.push({
      id: `bot_${i + 1}`,
      name: `${c.name} Tailored Chinos ${i + 1}`,
      category: 'bottoms',
      subCategory: i % 3 === 0 ? 'Wool Trousers' : 'Chinos',
      imageUrl: '',
      primaryColor: c.name,
      colorHex: c.hex,
      secondaryColors: [],
      undertone: c.undertone,
      fabric: i % 3 === 0 ? 'Lightweight wool twill' : 'Cotton twill',
      fabricWeight: 'Lightweight',
      texture: 'Smooth drape',
      fit: 'Tailored',
      silhouette: 'Straight leg',
      pattern: 'Solid',
      formality: 6 + (i % 2),
      seasons: ['Spring', 'Summer', 'Autumn', 'All-Season'],
      occasions: ['Smart Casual', 'Everyday', 'Formal'],
      stylingNotes: 'Clean leg line.',
      layeringRole: 'Bottom',
      wearCount: 0,
      hasVector: true,
      vectorSource: 'semantic-fallback',
      createdAt: `2026-11-${String(25 - i).padStart(2, '0')}T00:00:00Z`,
    });
  }

  // 6 Outerwear
  for (let i = 0; i < 6; i++) {
    const c = colors[(i + 1) % colors.length];
    items.push({
      id: `out_${i + 1}`,
      name: `${c.name} Structured Coat ${i + 1}`,
      category: 'outerwear',
      subCategory: 'Overcoat',
      imageUrl: '',
      primaryColor: c.name,
      colorHex: c.hex,
      secondaryColors: [],
      undertone: c.undertone,
      fabric: 'Brushed wool',
      fabricWeight: 'Heavyweight',
      texture: 'Soft twill',
      fit: 'Structured',
      silhouette: 'Longline',
      pattern: 'Solid',
      formality: 8,
      seasons: ['Autumn', 'Winter'],
      occasions: ['Smart Casual', 'Formal'],
      stylingNotes: 'Warm outer layer.',
      layeringRole: 'Outer',
      wearCount: 0,
      hasVector: true,
      vectorSource: 'semantic-fallback',
      createdAt: `2026-11-${String(18 - i).padStart(2, '0')}T00:00:00Z`,
    });
  }

  // 4 Footwear + 2 Accessories = 44 total!
  for (let i = 0; i < 4; i++) {
    const c = colors[(i + 7) % colors.length];
    items.push({
      id: `shoe_${i + 1}`,
      name: `${c.name} Leather Loafers ${i + 1}`,
      category: 'footwear',
      subCategory: i % 2 === 0 ? 'Loafers' : 'Minimalist Sneakers',
      imageUrl: '',
      primaryColor: c.name,
      colorHex: c.hex,
      secondaryColors: [],
      undertone: c.undertone,
      fabric: 'Calfskin leather',
      fabricWeight: 'Midweight',
      texture: 'Smooth leather',
      fit: 'Classic',
      silhouette: 'Sleek profile',
      pattern: 'Solid',
      formality: i % 2 === 0 ? 7 : 4,
      seasons: ['All-Season'],
      occasions: ['Smart Casual', 'Everyday'],
      stylingNotes: 'Clean anchor.',
      layeringRole: 'Footwear',
      wearCount: 0,
      hasVector: true,
      vectorSource: 'semantic-fallback',
      createdAt: `2026-11-${String(15 - i).padStart(2, '0')}T00:00:00Z`,
    });
  }

  for (let i = 0; i < 2; i++) {
    items.push({
      id: `acc_${i + 1}`,
      name: i === 0 ? 'Gold Dress Watch' : 'Espresso Leather Belt',
      category: 'accessories',
      subCategory: i === 0 ? 'Watch' : 'Belt',
      imageUrl: '',
      primaryColor: i === 0 ? 'Gold' : 'Espresso',
      colorHex: i === 0 ? '#C5A059' : '#3A261E',
      secondaryColors: [],
      undertone: 'Warm',
      fabric: i === 0 ? 'Brushed steel' : 'Full-grain leather',
      fabricWeight: 'Lightweight',
      texture: 'Smooth',
      fit: 'Classic',
      silhouette: 'Minimalist',
      pattern: 'Solid',
      formality: 7,
      seasons: ['All-Season'],
      occasions: ['Smart Casual', 'Formal'],
      stylingNotes: 'Subtle accent.',
      layeringRole: 'Accent',
      wearCount: 0,
      hasVector: true,
      vectorSource: 'semantic-fallback',
      createdAt: '2026-11-10T00:00:00Z',
    });
  }

  return items;
}

const sampleProfile: UserProfile = {
  name: 'Soumil',
  photoUrl: '',
  bio: 'Smart casual and quiet luxury wardrobe',
  height: '5ft 10in',
  bodyType: 'Balanced Athletic',
  skinUndertone: 'Warm Olive',
  preferredFits: ['Tailored', 'Relaxed'],
  styleAesthetics: ['Quiet Luxury', 'Old Money / Heritage'],
  budgetRange: 'Contemporary',
  climate: 'Four-Season',
  stylingGoals: 'Rotate my entire wardrobe effortlessly',
  blueprint: null,
  updatedAt: '2026-11-26T00:00:00Z',
};

test('extractRecentlyMentionedIds detects both [[item:...]] tags and exact names with recency weighting', () => {
  const closet = make44ItemCloset();
  assert.equal(closet.length, 44);

  const history: AdvisorMessage[] = [
    {
      id: 'm1',
      role: 'assistant',
      content: 'Try pairing [[item:base_1|Ivory Cotton Oxford Shirt 1]] with Charcoal Tailored Chinos 1.',
      referencedItemIds: ['base_1'],
      createdAt: '2026-11-26T09:00:00Z',
    },
    {
      id: 'm2',
      role: 'assistant',
      content: 'Again wear [[item:base_1|Ivory Cotton Oxford Shirt 1]] and [[item:shoe_1|Espresso Leather Loafers 1]].',
      referencedItemIds: ['base_1', 'shoe_1'],
      createdAt: '2026-11-26T09:05:00Z',
    },
  ];

  const counts = extractRecentlyMentionedIds(history, closet);
  assert.ok((counts.get('base_1') ?? 0) >= 5, 'Expected base_1 mentioned in both turns to have high weight');
  assert.ok((counts.get('bot_1') ?? 0) >= 2, 'Expected bot_1 matched by name');
  assert.ok((counts.get('shoe_1') ?? 0) >= 3, 'Expected shoe_1 matched in latest turn');
});

test('buildAdvisorWardrobeContext rotates spotlight away from recently repeated items across a 44-item closet', () => {
  const closet = make44ItemCloset();
  const history: AdvisorMessage[] = [
    {
      id: 'm1',
      role: 'assistant',
      content:
        'Wear [[item:base_1|Ivory Cotton Oxford Shirt 1]], [[item:base_2|Navy Cotton Oxford Shirt 2]], [[item:mid_1|Olive Merino Crewneck Sweater 1]], [[item:bot_1|Charcoal Tailored Chinos 1]], [[item:out_1|Navy Structured Coat 1]], and [[item:shoe_1|Espresso Leather Loafers 1]].',
      referencedItemIds: ['base_1', 'base_2', 'mid_1', 'bot_1', 'out_1', 'shoe_1'],
      createdAt: '2026-11-26T10:00:00Z',
    },
  ];

  const ctx = buildAdvisorWardrobeContext(
    closet,
    history,
    'Give me fresh smart casual outfit ideas from my closet',
    sampleProfile
  );

  // None of the 6 recently repeated items should be in the fresh spotlight!
  for (const repeatedId of ['base_1', 'base_2', 'mid_1', 'bot_1', 'out_1', 'shoe_1']) {
    assert.ok(
      !ctx.spotlightIds.includes(repeatedId),
      `Expected repeated item ${repeatedId} to be rotated OUT of fresh spotlight`
    );
    assert.ok(
      ctx.recentlyMentionedIds.includes(repeatedId),
      `Expected ${repeatedId} to be tracked in recentlyMentionedIds`
    );
  }
  assert.equal(ctx.unexploredCount, 38);
  assert.ok(ctx.spotlightIds.length >= 10, 'Expected rich multi-category spotlight of fresh pieces');
  // Every single one of the 44 items must still be present in the categorized catalog
  for (const g of closet) {
    assert.ok(ctx.categorizedCatalog.includes(`${g.id}|`), `Catalog missing ${g.id}`);
  }
});

test('buildAdvisorWardrobeContext respects explicit user item request AND strips sweaters from Summer spotlight', () => {
  const closet = make44ItemCloset();
  const history: AdvisorMessage[] = [
    {
      id: 'm1',
      role: 'assistant',
      content: 'Try [[item:base_1|Ivory Cotton Oxford Shirt 1]] with [[item:bot_1|Charcoal Tailored Chinos 1]].',
      referencedItemIds: ['base_1', 'bot_1'],
      createdAt: '2026-11-26T10:00:00Z',
    },
  ];

  const asked = extractExplicitlyAskedIds('How should I style Ivory Cotton Oxford Shirt 1 for summer?', closet);
  assert.equal(asked.has('base_1'), true);

  const summerCtx = buildAdvisorWardrobeContext(
    closet,
    history,
    'How should I style Ivory Cotton Oxford Shirt 1 for summer?',
    sampleProfile
  );

  assert.equal(summerCtx.effectiveSeason, 'Summer');
  assert.ok(summerCtx.spotlightIds.includes('base_1'), 'Explicitly asked item must stay in spotlight');
  assert.ok(
    !summerCtx.spotlightIds.some((id) => id.startsWith('mid_') || id.startsWith('out_')),
    'Sweaters and wool coats must NEVER enter Summer spotlight'
  );
  assert.ok(
    summerCtx.verifiedBlueprintsSection.includes('Blueprint 1'),
    'Expected pre-computed verified outfit blueprints'
  );
  assert.ok(
    !summerCtx.verifiedBlueprintsSection.includes('Merino Crewneck Sweater'),
    'Verified blueprints in Summer must NEVER include wool sweaters'
  );
});

test('detectAdvisorIntent gates web search only for trend/shopping queries and infers occasion accurately', () => {
  const closetQuery = detectAdvisorIntent('What should I wear to a dinner date tonight from my closet?');
  assert.equal(closetQuery.needsWebSearch, false);
  assert.equal(closetQuery.wantsOutfits, true);
  assert.equal(closetQuery.inferredOccasion, 'Evening');

  const trendQuery = detectAdvisorIntent('Which 2026 fashion trends flatter me and which brands should I shop?');
  assert.equal(trendQuery.needsWebSearch, true);
  assert.equal(trendQuery.wantsShoppingAdvice, true);

  const photoQuery = detectAdvisorIntent('Should I buy this jacket?', true);
  assert.equal(photoQuery.needsWebSearch, false);
  assert.equal(photoQuery.wantsShoppingAdvice, true);
});

test('ensureGarmentHyperlinks auto-links plain garment mentions, fixes labels, and strips hallucinated IDs', () => {
  const closet = make44ItemCloset();
  const raw =
    'Pair Ivory Cotton Oxford Shirt 1 with [[item:bot_1|Wrong Label]] and [[item:fake_999|Imaginary Belt]].';
  const result = ensureGarmentHyperlinks(raw, closet);

  assert.ok(result.content.includes('[[item:base_1|Ivory Cotton Oxford Shirt 1]]'));
  assert.ok(result.content.includes('[[item:bot_1|Charcoal Tailored Chinos 1]]'));
  assert.ok(!result.content.includes('fake_999'));
  assert.ok(result.content.includes('Imaginary Belt'));
  assert.deepEqual(result.referencedItemIds.sort(), ['base_1', 'bot_1']);

  const compactHist = formatCompactHistoryForAdvisor([
    {
      id: 'h1',
      role: 'assistant',
      content: 'Try [[item:base_1|Ivory Cotton Oxford Shirt 1]] today.',
      createdAt: '2026-11-26T10:00:00Z',
    },
  ]);
  assert.ok(compactHist.includes('do NOT repeat those same pieces'));
  assert.ok(!compactHist.includes('[[item:'));
});

test('classifyTopLayerRole keeps knit polos/tees as base and evaluateBaseUnderMidCompatibility flags incompatible underlayers', async () => {
  const { classifyTopLayerRole, evaluateBaseUnderMidCompatibility } = await import('./styleEngine');
  const closet = make44ItemCloset();

  const knitPolo: Garment = {
    ...closet[0],
    id: 'knit_polo',
    name: 'Charcoal Fine Knit Polo',
    subCategory: 'Polo Shirt',
    texture: 'Fine ribbed knit',
    fabric: 'Fine merino cotton',
    fabricWeight: 'Lightweight',
    layeringRole: 'Base',
  };
  assert.equal(classifyTopLayerRole(knitPolo), 'base', 'Knit polo must stay a Base top, not Mid');

  const heavyBase: Garment = {
    ...closet[0],
    id: 'heavy_base',
    name: 'Heavy Flannel Overshirt Base',
    subCategory: 'Button-Down Shirt',
    fabricWeight: 'Heavyweight',
    fit: 'Oversized',
  };
  const campShirt: Garment = {
    ...closet[0],
    id: 'camp_base',
    name: 'Olive Camp Collar Linen Shirt',
    subCategory: 'Camp Shirt',
    fabricWeight: 'Lightweight',
    fit: 'Relaxed',
  };
  const sweater = closet.find((g) => g.id === 'mid_1')!;

  const goodRes = evaluateBaseUnderMidCompatibility(closet[0], sweater);
  assert.equal(goodRes.compatible, true, 'Lightweight oxford should be compatible under midweight sweater');

  const heavyRes = evaluateBaseUnderMidCompatibility(heavyBase, sweater);
  assert.equal(heavyRes.compatible, false, 'Heavyweight base must be rejected under midweight sweater');

  const campRes = evaluateBaseUnderMidCompatibility(campShirt, sweater);
  assert.equal(campRes.compatible, false, 'Open camp collar must be rejected under closed crewneck sweater');
});

test('buildAdvisorWardrobeContext builds owned layering guide, flags missing base slots, and excludes What-NOT-to-Wear items from recommended chips', () => {
  const closet = make44ItemCloset();
  const ctx = buildAdvisorWardrobeContext(
    closet,
    [],
    'How should I wear my Olive Merino Crewneck Sweater 1?',
    sampleProfile
  );
  assert.ok(ctx.ownedInventorySummary.includes('BASE TOPS'));
  assert.ok(
    ctx.layeringGuideSection.includes('Under [[item:mid_1|Olive Merino Crewneck Sweater 1]]'),
    'Expected deterministic owned underlayer guide for requested sweater'
  );
  assert.ok(
    ctx.layeringGuideSection.includes('BEST OWNED UNDERLAYERS'),
    'Expected exact owned base underlayer recommendations'
  );

  // When a closet has ZERO base tops, inventory & layering guide must warn NOT to invent a shirt
  const sweaterOnlyCloset = closet.filter((g) => !g.id.startsWith('base_'));
  const noBaseCtx = buildAdvisorWardrobeContext(
    sweaterOnlyCloset,
    [],
    'Style my Olive Merino Crewneck Sweater 1',
    sampleProfile
  );
  assert.ok(noBaseCtx.ownedInventorySummary.includes('ZERO UPLOADED — DO NOT INVENT A SHIRT'));
  assert.ok(noBaseCtx.layeringGuideSection.includes('OWNED BASE UNDERLAYERS = NONE UPLOADED'));

  // What NOT to Wear items stay clickable inline in markdown, but are excluded from recommended outfit chips
  const replyWithAvoid = [
    '### Outfit 1',
    '- **Base Layer**: [[item:base_1|Ivory Cotton Oxford Shirt 1]]',
    '- **Mid Layer**: [[item:mid_1|Olive Merino Crewneck Sweater 1]]',
    '- **Bottoms**: [[item:bot_1|Charcoal Tailored Chinos 1]]',
    '- **Footwear**: [[item:shoe_1|Espresso Leather Loafers 1]]',
    '',
    '### What NOT to Wear With This',
    '- Avoid layering [[item:base_2|Navy Cotton Oxford Shirt 2]] under this knit.',
  ].join('\n');

  const linked = ensureGarmentHyperlinks(replyWithAvoid, closet);
  assert.ok(linked.content.includes('[[item:base_2|Navy Cotton Oxford Shirt 2]]'), 'Inline link for avoid item stays clickable');
  assert.ok(!linked.referencedItemIds.includes('base_2'), 'Avoid-only item must NOT appear in recommended outfit chip tray');
  assert.deepEqual(linked.referencedItemIds, ['base_1', 'mid_1', 'bot_1', 'shoe_1']);
});


