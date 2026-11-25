import type {
  CompanionMatch,
  Garment,
  GarmentCategory,
  OccasionType,
  OutfitCombination,
  SeasonTag,
  UserProfile,
  WardrobeGap,
} from '../types/styling.ts';

export const MAX_BATCH_UPLOAD_FILES = 50;
export const MAX_SINGLE_FILE_BYTES = 10 * 1024 * 1024; // 10MB
export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/avif',
]);

export interface UploadValidationResult {
  valid: boolean;
  errors: string[];
  acceptedCount: number;
}

export function validateUploadBatch(
  files: Array<{ name: string; type: string; size: number }>
): UploadValidationResult {
  const errors: string[] = [];

  if (files.length === 0) {
    return { valid: false, errors: ['Select at least one clothing photo to upload.'], acceptedCount: 0 };
  }

  if (files.length > MAX_BATCH_UPLOAD_FILES) {
    errors.push(
      `You selected ${files.length} items. Maximum ${MAX_BATCH_UPLOAD_FILES} clothing items can be uploaded at once.`
    );
  }

  let acceptedCount = 0;
  for (const file of files.slice(0, MAX_BATCH_UPLOAD_FILES)) {
    const mime = (file.type || '').toLowerCase();
    if (!ALLOWED_IMAGE_MIME_TYPES.has(mime)) {
      errors.push(`"${file.name}" is not a supported image format (JPEG, PNG, WebP, or AVIF).`);
      continue;
    }
    if (file.size <= 0 || file.size > MAX_SINGLE_FILE_BYTES) {
      errors.push(`"${file.name}" exceeds the 10 MB per-photo limit.`);
      continue;
    }
    acceptedCount += 1;
  }

  return {
    valid: errors.length === 0 && acceptedCount > 0,
    errors,
    acceptedCount,
  };
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return Math.max(-1, Math.min(1, dot / denom));
}

export function normalizeVector(vec: number[]): number[] {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) sumSq += vec[i] * vec[i];
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return vec.map(() => 0);
  return vec.map((v) => v / norm);
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }

  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/**
 * Computes fashion-calibrated color harmony (0-100) between two garment hex colors.
 * Neutrals pair gracefully with almost everything; tonal contrast & analogous/complementary pairs score high.
 */
export function computeColorHarmony(hexA: string, hexB: string): number {
  const a = hexToHsl(hexA);
  const b = hexToHsl(hexB);

  const aNeutral = a.s <= 20 || a.l <= 14 || a.l >= 90;
  const bNeutral = b.s <= 20 || b.l <= 14 || b.l >= 90;
  const lumDiff = Math.abs(a.l - b.l);

  if (aNeutral && bNeutral) {
    // Two neutrals with healthy tonal separation look crisp and editorial
    return Math.min(96, 80 + Math.round(lumDiff * 0.22));
  }

  if (aNeutral || bNeutral) {
    // Neutral anchored against a chromatic garment is a foundational wardrobe win
    return Math.min(95, 84 + Math.round(Math.min(lumDiff, 45) * 0.2));
  }

  const rawHueDiff = Math.abs(a.h - b.h);
  const hueDiff = Math.min(rawHueDiff, 360 - rawHueDiff);

  if (hueDiff <= 25) {
    // Monochromatic / tonal
    return lumDiff >= 18 ? 92 : 76;
  }
  if (hueDiff <= 55) {
    // Analogous harmony
    return 87;
  }
  if (hueDiff >= 150 && hueDiff <= 210) {
    // Complementary contrast
    return lumDiff >= 15 ? 89 : 78;
  }
  if (hueDiff >= 105 && hueDiff <= 140) {
    // Triadic / split-complementary
    return 82;
  }
  return 68;
}

/**
 * Generates a deterministic 64-dim L2-normalized fashion attribute vector for items
 * when live multimodal embeddings are unavailable (e.g., offline preview or seed items).
 */
export function computeDeterministicVector(garment: Pick<
  Garment,
  | 'category'
  | 'colorHex'
  | 'undertone'
  | 'fabricWeight'
  | 'formality'
  | 'pattern'
  | 'fit'
  | 'seasons'
  | 'occasions'
  | 'fabric'
>): number[] {
  const vec = new Array<number>(64).fill(0);
  const hsl = hexToHsl(garment.colorHex);

  // Color wheel & luminance encoding (dims 0..7)
  const rad = (hsl.h * Math.PI) / 180;
  vec[0] = Math.cos(rad) * (hsl.s / 100);
  vec[1] = Math.sin(rad) * (hsl.s / 100);
  vec[2] = hsl.s / 100;
  vec[3] = hsl.l / 100;
  vec[4] = garment.undertone === 'Warm' ? 1 : garment.undertone === 'Cool' ? -1 : 0.25;
  vec[5] = garment.formality / 10;
  vec[6] =
    garment.fabricWeight === 'Heavyweight'
      ? 1
      : garment.fabricWeight === 'Midweight'
      ? 0.55
      : 0.2;
  vec[7] = garment.pattern.toLowerCase().includes('solid') ? 0.9 : 0.35;

  // Categories (dims 8..12)
  const cats: GarmentCategory[] = ['tops', 'bottoms', 'outerwear', 'footwear', 'accessories'];
  const catIdx = cats.indexOf(garment.category);
  if (catIdx >= 0) vec[8 + catIdx] = 0.6;

  // Seasons (dims 13..17)
  const seasons: SeasonTag[] = ['Spring', 'Summer', 'Autumn', 'Winter', 'All-Season'];
  for (const s of garment.seasons) {
    const idx = seasons.indexOf(s);
    if (idx >= 0) vec[13 + idx] = 0.75;
  }

  // Occasions (dims 18..23)
  const occasions: OccasionType[] = [
    'Everyday',
    'Smart Casual',
    'Formal',
    'Evening',
    'Travel',
    'Streetwear',
  ];
  for (const o of garment.occasions) {
    const idx = occasions.indexOf(o);
    if (idx >= 0) vec[18 + idx] = 0.85;
  }

  // Hash fabric + fit + pattern tokens into dims 24..63 for consistent semantic texture proximity
  const tokens = `${garment.fabric} ${garment.fit} ${garment.pattern}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  for (const tok of tokens) {
    let hash = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      hash ^= tok.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const bucket = 24 + (Math.abs(hash) % 40);
    vec[bucket] += 0.45;
  }

  return normalizeVector(vec);
}

export function scorePairCompatibility(
  itemA: Garment,
  itemB: Garment,
  vecA?: number[],
  vecB?: number[]
): { score: number; vectorSimilarity: number; colorHarmony: number; reason: string } {
  const colorHarmony = computeColorHarmony(itemA.colorHex, itemB.colorHex);

  const formalityDiff = Math.abs(itemA.formality - itemB.formality);
  const formalityScore = Math.max(35, 100 - formalityDiff * 11);

  const sharedSeasons = itemA.seasons.filter(
    (s) =>
      itemB.seasons.includes(s) ||
      itemA.seasons.includes('All-Season') ||
      itemB.seasons.includes('All-Season')
  );
  const seasonScore = sharedSeasons.length > 0 ? 94 : 62;

  // Pattern balance: avoid clashing two busy prints
  const aSolid = itemA.pattern.toLowerCase().includes('solid') || itemA.pattern.toLowerCase().includes('subtle');
  const bSolid = itemB.pattern.toLowerCase().includes('solid') || itemB.pattern.toLowerCase().includes('subtle');
  const patternScore = aSolid || bSolid ? 94 : 68;

  // Vector similarity (if real embeddings exist and match dimension, map [-1,1] -> [0,100])
  let vectorSimilarity = 78;
  if (vecA && vecB && vecA.length > 0 && vecA.length === vecB.length) {
    const rawCos = cosineSimilarity(vecA, vecB);
    // Fashion vectors in embedding space typically cluster between 0.35 and 0.95
    vectorSimilarity = Math.round(Math.max(40, Math.min(99, 55 + rawCos * 45)));
  }

  // Texture contrast bonus (e.g., wool + cotton, knit + denim, wool + leather)
  const textureBonus =
    itemA.fabric.toLowerCase() !== itemB.fabric.toLowerCase() ? 4 : 0;

  const score = Math.min(
    96,
    Math.round(
      colorHarmony * 0.3 +
        vectorSimilarity * 0.28 +
        formalityScore * 0.24 +
        seasonScore * 0.1 +
        patternScore * 0.08 +
        textureBonus * 0.5
    )
  );

  const reasons: string[] = [];
  if (colorHarmony >= 88) reasons.push(`balanced ${itemA.primaryColor.toLowerCase()} & ${itemB.primaryColor.toLowerCase()} palette`);
  if (formalityDiff <= 2) reasons.push('aligned formality');
  if (textureBonus > 0) reasons.push(`${itemA.fabric.split(' ')[0].toLowerCase()}-on-${itemB.fabric.split(' ')[0].toLowerCase()} texture contrast`);
  if (reasons.length === 0) reasons.push('cohesive silhouette pairing');

  return {
    score,
    vectorSimilarity,
    colorHarmony,
    reason: reasons.slice(0, 2).join(' · '),
  };
}

export function findBestCompanions(
  targetId: string,
  items: Garment[],
  vectors: Record<string, number[]>,
  limit = 4
): CompanionMatch[] {
  const target = items.find((g) => g.id === targetId);
  if (!target) return [];

  const targetVec = vectors[targetId] ?? computeDeterministicVector(target);

  return items
    .filter((other) => other.id !== targetId && other.category !== target.category)
    .map((other) => {
      const otherVec = vectors[other.id] ?? computeDeterministicVector(other);
      const res = scorePairCompatibility(target, other, targetVec, otherVec);
      return {
        garmentId: other.id,
        score: res.score,
        vectorSimilarity: res.vectorSimilarity,
        colorHarmony: res.colorHarmony,
        reason: res.reason,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function evaluateOutfitLocalHarmony(
  selectedItems: Garment[],
  vectors: Record<string, number[]>
): {
  overallScore: number;
  vectorScore: number;
  colorScore: number;
  formalitySpread: number;
  feedback: string;
} {
  if (selectedItems.length < 2) {
    return {
      overallScore: selectedItems.length === 1 ? 65 : 0,
      vectorScore: 0,
      colorScore: 0,
      formalitySpread: 0,
      feedback:
        selectedItems.length === 0
          ? 'Select at least a top and bottom to evaluate outfit harmony.'
          : 'Add a bottom or outerwear piece to calculate vector & color harmony.',
    };
  }

  let totalScore = 0;
  let totalVec = 0;
  let totalColor = 0;
  let pairs = 0;

  for (let i = 0; i < selectedItems.length; i++) {
    for (let j = i + 1; j < selectedItems.length; j++) {
      const a = selectedItems[i];
      const b = selectedItems[j];
      const res = scorePairCompatibility(
        a,
        b,
        vectors[a.id] ?? computeDeterministicVector(a),
        vectors[b.id] ?? computeDeterministicVector(b)
      );
      totalScore += res.score;
      totalVec += res.vectorSimilarity;
      totalColor += res.colorHarmony;
      pairs += 1;
    }
  }

  const formalities = selectedItems.map((i) => i.formality);
  const formalitySpread = Math.max(...formalities) - Math.min(...formalities);

  const overallScore = Math.round(totalScore / pairs);
  const vectorScore = Math.round(totalVec / pairs);
  const colorScore = Math.round(totalColor / pairs);

  let feedback = 'Balanced proportions, cohesive textures, and editorial color separation.';
  if (formalitySpread >= 5) {
    feedback = 'High formality contrast — consider swapping one piece to tighten dress-code cohesion.';
  } else if (colorScore < 76) {
    feedback = 'Color temperatures compete slightly; anchoring with a neutral layer will elevate the look.';
  } else if (overallScore >= 90) {
    feedback = 'Exceptional studio-grade pairing with strong fabric interplay and tonal clarity.';
  }

  return { overallScore, vectorScore, colorScore, formalitySpread, feedback };
}

export interface CandidateCombination {
  itemIds: string[];
  items: Garment[];
  localScore: number;
  vectorScore: number;
  colorScore: number;
}

/**
 * Deterministically enumerates and pre-ranks the strongest complete outfit combinations
 * locally (0 AI tokens), so Gemini only evaluates the top curated finalists.
 */
export function generateCandidateCombinations(
  items: Garment[],
  vectors: Record<string, number[]>,
  options: {
    occasion?: OccasionType;
    season?: SeasonTag;
    anchorItemId?: string;
    maxCandidates?: number;
  } = {}
): CandidateCombination[] {
  const { occasion, season, anchorItemId, maxCandidates = 6 } = options;

  const tops = items.filter((i) => i.category === 'tops');
  const bottoms = items.filter((i) => i.category === 'bottoms');
  const outerwear = items.filter((i) => i.category === 'outerwear');
  const footwear = items.filter((i) => i.category === 'footwear');
  const accessories = items.filter((i) => i.category === 'accessories');

  if (tops.length === 0 || bottoms.length === 0) {
    return [];
  }

  const candidates: CandidateCombination[] = [];
  const seenKeys = new Set<string>();

  const outerOptions: Array<Garment | null> =
    season === 'Summer' ? [null, ...outerwear.slice(0, 1)] : [...outerwear, null];
  const shoeOptions: Array<Garment | null> = footwear.length > 0 ? footwear : [null];

  for (const top of tops) {
    for (const bottom of bottoms) {
      for (const outer of outerOptions) {
        for (const shoe of shoeOptions) {
          const comboItems = [top, bottom, outer, shoe].filter(
            (x): x is Garment => x !== null
          );

          // Add best matching accessory if available
          if (accessories.length > 0) {
            const topAcc = accessories[0];
            comboItems.push(topAcc);
          }

          if (anchorItemId && !comboItems.some((c) => c.id === anchorItemId)) {
            continue;
          }

          const key = comboItems
            .map((c) => c.id)
            .sort()
            .join('|');
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);

          const evalRes = evaluateOutfitLocalHarmony(comboItems, vectors);
          let bonus = 0;

          if (occasion) {
            const occasionHits = comboItems.filter((c) =>
              c.occasions.includes(occasion)
            ).length;
            bonus += Math.round((occasionHits / comboItems.length) * 5) - 2;
          }

          if (season && season !== 'All-Season') {
            const seasonHits = comboItems.filter(
              (c) => c.seasons.includes(season) || c.seasons.includes('All-Season')
            ).length;
            bonus += Math.round((seasonHits / comboItems.length) * 4) - 2;
          }

          // Prefer 3-4 piece layered looks for cooler seasons
          if (outer && (season === 'Autumn' || season === 'Winter')) {
            bonus += 3;
          } else if (!outer && (season === 'Autumn' || season === 'Winter')) {
            bonus -= 2;
          }

          // Reward tighter formality cohesion across the whole outfit
          bonus -= Math.max(0, evalRes.formalitySpread - 2);

          candidates.push({
            itemIds: comboItems.map((c) => c.id),
            items: comboItems,
            localScore: Math.max(55, Math.min(97, evalRes.overallScore + bonus)),
            vectorScore: evalRes.vectorScore,
            colorScore: evalRes.colorScore,
          });
        }
      }
    }
  }

  // Sort by score and ensure visual diversity across top combinations
  candidates.sort((a, b) => b.localScore - a.localScore);

  const diverse: CandidateCombination[] = [];
  for (const cand of candidates) {
    if (diverse.length >= maxCandidates) break;
    // Avoid picking near-identical combinations unless we have very few items
    const tooSimilar = diverse.some((existing) => {
      const overlap = cand.itemIds.filter((id) => existing.itemIds.includes(id)).length;
      return overlap === cand.itemIds.length && existing.itemIds.length === cand.itemIds.length;
    });
    if (!tooSimilar) {
      diverse.push(cand);
    }
  }

  return diverse;
}

export function buildLocalFallbackCombinations(
  candidates: CandidateCombination[],
  profile: UserProfile,
  occasion: OccasionType,
  season: SeasonTag
): OutfitCombination[] {
  const fitPref = profile.preferredFits[0] ?? 'balanced tailored';
  return candidates.map((cand, index) => {
    const names = cand.items.map((i) => i.name);
    const fabrics = [...new Set(cand.items.map((i) => i.fabric.split(',')[0]))].slice(0, 3);
    const hasOuter = cand.items.some((i) => i.category === 'outerwear');
    const titlePrefix = hasOuter ? 'Layered' : 'Refined';
    const topItem = cand.items.find((i) => i.category === 'tops');
    const bottomItem = cand.items.find((i) => i.category === 'bottoms');

    return {
      id: `combo-local-${Date.now()}-${index + 1}`,
      title: `${titlePrefix} ${topItem?.primaryColor ?? 'Neutral'} & ${bottomItem?.primaryColor ?? 'Tailored'} Edit`,
      source: 'ai',
      rank: index + 1,
      score: cand.localScore,
      vectorHarmonyScore: cand.vectorScore,
      itemIds: cand.itemIds,
      occasion,
      season,
      rationale: `Pairs ${names.slice(0, 2).join(' with ')}${
        names.length > 2 ? `, finished with ${names.slice(2).join(' and ')}` : ''
      } for cohesive ${occasion.toLowerCase()} polish.`,
      fabricFitNotes: `Contrasts ${fabrics.join(', ')} with crisp silhouette balance and clean tonal separation.`,
      bodyTailoringNote: `Aligned with your ${profile.bodyType || 'natural'} frame and preference for ${fitPref.toLowerCase()} proportions.`,
      finishingTouch: hasOuter
        ? 'Leave the outer layer unbuttoned to create a clean vertical line.'
        : 'Keep sleeves crisply cuffed and anchor with minimal metallic hardware.',
      wearCount: 0,
      saved: false,
      modelUsed: 'vector-style-engine',
      createdAt: new Date().toISOString(),
    };
  });
}

export function analyzeWardrobeGaps(
  items: Garment[],
  profile: UserProfile
): WardrobeGap[] {
  const gaps: WardrobeGap[] = [];
  const counts: Record<GarmentCategory, number> = {
    tops: 0,
    bottoms: 0,
    outerwear: 0,
    footwear: 0,
    accessories: 0,
  };

  for (const item of items) {
    counts[item.category] = (counts[item.category] ?? 0) + 1;
  }

  if (counts.footwear < 2) {
    gaps.push({
      id: 'gap-footwear',
      title: 'Versatile Secondary Footwear',
      category: 'footwear',
      priority: 'High',
      reason: `You currently have ${counts.footwear} footwear piece${counts.footwear === 1 ? '' : 's'}. Adding a crisp minimalist sneaker or suede boot unlocks casual-to-evening versatility.`,
      suggestedPrompt:
        'Based on my current trousers and denim, what second pair of versatile footwear should I invest in next?',
    });
  }

  if (counts.outerwear < 2) {
    gaps.push({
      id: 'gap-outerwear',
      title: 'Transitional Midweight Jacket',
      category: 'outerwear',
      priority: 'High',
      reason: 'A breathable unlined blazer, overshirt, or cropped suede jacket bridges spring and autumn effortlessly.',
      suggestedPrompt:
        'What transitional jacket or blazer style fits my body proportions and pairs with all my tops and bottoms?',
    });
  }

  if (counts.accessories === 0) {
    gaps.push({
      id: 'gap-accessories',
      title: 'Finishing Leather Belt & Hardware',
      category: 'accessories',
      priority: 'Medium',
      reason: 'Structured accessories tie footwear leather tones to waistlines and elevate minimalist outfits.',
      suggestedPrompt:
        'Recommend 2 timeless accessories (belt, watch, or bag) that unify the colors already in my wardrobe.',
    });
  }

  const hasWarmWeatherTop = items.some(
    (i) => i.category === 'tops' && i.fabricWeight === 'Lightweight'
  );
  if (!hasWarmWeatherTop) {
    gaps.push({
      id: 'gap-light-top',
      title: 'Breathable Warm-Weather Knit or Linen Shirt',
      category: 'tops',
      priority: 'Medium',
      reason: `Ideal for ${profile.climate.toLowerCase()} transitions and easy layering under structured coats.`,
      suggestedPrompt:
        'What breathable summer or layering tops are trending right now that match my skin undertone and aesthetic?',
    });
  }

  if (gaps.length === 0) {
    gaps.push({
      id: 'gap-statement',
      title: 'Textured Statement Layer',
      category: 'outerwear',
      priority: 'Medium',
      reason: 'Your core capsule is well balanced. A textured statement piece adds seasonal dimension.',
      suggestedPrompt:
        'My wardrobe foundation is solid—what one trending statement piece would multiply my outfit combinations most?',
    });
  }

  return gaps.slice(0, 3);
}
