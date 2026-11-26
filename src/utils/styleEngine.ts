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
    if (file.size <= 0) {
      errors.push(`"${file.name}" appears to be an empty file.`);
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

// ============================================================================
// 1. PERCEPTUALLY UNIFORM OKLAB / OKLCH COLOR SCIENCE (Björn Ottosson)
// ============================================================================

export interface OklchColor {
  L: number; // Perceptual lightness [0, 1]
  C: number; // Perceptual chroma [0, ~0.37]
  H: number; // Hue angle [0, 360)
  a: number; // Green (-) to Red (+)
  b: number; // Blue (-) to Yellow (+)
}

function parseHexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = (hex || '#6E6E73').replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return {
    r: Number.isFinite(r) ? r / 255 : 0.43,
    g: Number.isFinite(g) ? g / 255 : 0.43,
    b: Number.isFinite(b) ? b / 255 : 0.45,
  };
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Converts sRGB hex to perceptually uniform OKLab / OKLCH.
 * Unlike HSL, OKLCH accurately represents human-perceived lightness, chroma, and contrast.
 */
export function hexToOklch(hex: string): OklchColor {
  const { r: sr, g: sg, b: sb } = parseHexToRgb(hex);
  const r = srgbToLinear(sr);
  const g = srgbToLinear(sg);
  const b = srgbToLinear(sb);

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l_ = Math.cbrt(Math.max(0, l));
  const m_ = Math.cbrt(Math.max(0, m));
  const s_ = Math.cbrt(Math.max(0, s));

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bLab = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const C = Math.sqrt(a * a + bLab * bLab);
  let H = (Math.atan2(bLab, a) * 180) / Math.PI;
  if (H < 0) H += 360;

  return {
    L: Math.max(0, Math.min(1, L)),
    C,
    H: Number.isFinite(H) ? H : 0,
    a,
    b: bLab,
  };
}

export function oklchDeltaE(c1: OklchColor, c2: OklchColor): number {
  const dL = c1.L - c2.L;
  const da = c1.a - c2.a;
  const db = c1.b - c2.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

export function isPerceptualNeutral(c: OklchColor): boolean {
  // True achromatic neutrals (black, charcoal, grey, white, cream, stone, taupe)
  return c.C <= 0.036 || c.L <= 0.18 || (c.L >= 0.91 && c.C <= 0.055);
}

export function isEarthNeutral(c: OklchColor): boolean {
  // Fashion-staple muted earth tones (camel, khaki, olive, espresso, cognac, navy)
  const isWarmEarth = c.H >= 40 && c.H <= 115 && c.C <= 0.11;
  const isDeepNavy = c.H >= 235 && c.H <= 275 && c.L <= 0.4 && c.C <= 0.11;
  return isWarmEarth || isDeepNavy;
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = parseHexToRgb(hex);
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
 * Perceptually calibrated OKLCH fashion color harmony (0-100) between two garment hex colors.
 * Guards against accidental near-match dark clashes (e.g. black + near-black navy),
 * rewards editorial neutral/earth anchors, tonal stepping, analogous, and balanced complementary pairs.
 */
export function computeColorHarmony(hexA: string, hexB: string): number {
  const a = hexToOklch(hexA);
  const b = hexToOklch(hexB);

  const aNeutral = isPerceptualNeutral(a);
  const bNeutral = isPerceptualNeutral(b);
  const aEarth = isEarthNeutral(a);
  const bEarth = isEarthNeutral(b);

  const lumDiff = Math.abs(a.L - b.L);
  const deltaE = oklchDeltaE(a, b);
  const rawHueDiff = Math.abs(a.H - b.H);
  const hueDiff = Math.min(rawHueDiff, 360 - rawHueDiff);

  // Guard against accidental dark near-miss (e.g. jet black + very dark navy/brown with low separation)
  const bothVeryDark = a.L < 0.3 && b.L < 0.3;
  if (bothVeryDark && deltaE >= 0.035 && deltaE <= 0.11 && (a.C > 0.025 || b.C > 0.025)) {
    return 70;
  }

  // Two pure neutrals: crisp tonal separation or true intentional black-on-black
  if (aNeutral && bNeutral) {
    if (deltaE < 0.03) return 90; // Deliberate tonal/monochrome match
    return Math.min(97, Math.round(83 + Math.min(0.65, lumDiff) * 22));
  }

  // One pure neutral + one chromatic/earth tone: foundational editorial anchor
  if (aNeutral || bNeutral) {
    const chrom = aNeutral ? b : a;
    const chromaPenalty = chrom.C > 0.24 ? -3 : 0; // Ultra-neon slightly harder to anchor
    return Math.min(96, Math.max(76, Math.round(86 + Math.min(0.5, lumDiff) * 18 + chromaPenalty)));
  }

  // Both earth-neutrals (e.g. camel + navy, espresso + olive, khaki + burgundy)
  if (aEarth && bEarth) {
    return Math.min(95, Math.round(86 + Math.min(0.45, lumDiff) * 18));
  }

  // One earth-neutral + one chromatic piece
  if (aEarth || bEarth) {
    return Math.min(93, Math.round(83 + Math.min(0.4, lumDiff) * 16));
  }

  // Two chromatic garments — judge by perceptual OKLCH hue & chroma balance
  const bothHighChroma = a.C > 0.16 && b.C > 0.16;

  if (hueDiff <= 22) {
    // True tonal / monochromatic color story
    return lumDiff >= 0.15 ? 93 : 78;
  }
  if (hueDiff <= 55) {
    // Analogous harmony (looks elevated when one is deeper or muted)
    return bothHighChroma ? 80 : 89;
  }
  if (hueDiff >= 155 && hueDiff <= 205) {
    // Complementary contrast — strong when one color carries lower chroma or distinct luminance
    if (bothHighChroma && lumDiff < 0.15) return 71;
    return lumDiff >= 0.14 ? 89 : 81;
  }
  if (hueDiff >= 115 && hueDiff <= 150) {
    // Split-complementary / triadic
    return bothHighChroma ? 73 : 84;
  }
  // Awkward mid-wheel clash (65-110 deg) with competing chroma
  return bothHighChroma ? 60 : 72;
}

/**
 * Whole-outfit OKLCH palette harmony: evaluates 60-30-10 color discipline,
 * color-sandwich echoing (footwear/outer matching top/accent), and temperature cohesion.
 */
export function evaluateOutfitPaletteHarmony(items: Garment[]): {
  paletteBonus: number;
  chromaticCount: number;
  hasSandwichEcho: boolean;
  paletteSummary: string;
} {
  if (items.length < 2) {
    return { paletteBonus: 0, chromaticCount: 0, hasSandwichEcho: false, paletteSummary: 'Single piece' };
  }

  const parsed = items.map((item) => ({
    item,
    oklch: hexToOklch(item.colorHex),
  }));

  const chromatics = parsed.filter((p) => !isPerceptualNeutral(p.oklch) && !isEarthNeutral(p.oklch));

  // Cluster chromatic hues (within 32 deg = same hue family)
  const hueFamilies: number[] = [];
  for (const c of chromatics) {
    const exists = hueFamilies.some((h) => {
      const diff = Math.abs(h - c.oklch.H);
      return Math.min(diff, 360 - diff) <= 32;
    });
    if (!exists) hueFamilies.push(c.oklch.H);
  }

  let paletteBonus = 0;
  let paletteSummary = 'Balanced neutral & tonal palette';

  if (hueFamilies.length === 0) {
    // Pure neutral / earth editorial palette — reward luminance range
    const lums = parsed.map((p) => p.oklch.L);
    const spread = Math.max(...lums) - Math.min(...lums);
    paletteBonus += spread >= 0.22 ? 4 : 2;
    paletteSummary = spread >= 0.3 ? 'High-clarity neutral contrast' : 'Refined tonal monochrome';
  } else if (hueFamilies.length === 1) {
    // Classic 60-30-10: neutrals anchored by one focused accent family
    paletteBonus += 4;
    paletteSummary = '60-30-10 neutral anchor with focused accent';
  } else if (hueFamilies.length === 2) {
    paletteBonus += 1;
    paletteSummary = 'Dual-tone balanced palette';
  } else {
    // 3+ competing chromatic hue families feels noisy
    paletteBonus -= 7;
    paletteSummary = 'Too many competing accent colors';
  }

  // Color-Sandwich Method: top/outerwear echoes footwear or accessory in OKLCH space
  const upperPieces = parsed.filter(
    (p) => p.item.category === 'tops' || p.item.category === 'outerwear'
  );
  const groundingPieces = parsed.filter(
    (p) => p.item.category === 'footwear' || p.item.category === 'accessories'
  );

  let hasSandwichEcho = false;
  for (const up of upperPieces) {
    for (const gr of groundingPieces) {
      if (oklchDeltaE(up.oklch, gr.oklch) <= 0.16) {
        hasSandwichEcho = true;
        break;
      }
    }
    if (hasSandwichEcho) break;
  }

  if (hasSandwichEcho) {
    paletteBonus += 3;
    paletteSummary += ' · cohesive sandwich echo';
  }

  return {
    paletteBonus,
    chromaticCount: hueFamilies.length,
    hasSandwichEcho,
    paletteSummary,
  };
}

// ============================================================================
// 2. SILHOUETTE VOLUME, RULE-OF-THIRDS PROPORTIONS & FABRIC PHYSICS MATRIX
// ============================================================================

export type SilhouetteVolume = 'slim' | 'tailored' | 'relaxed' | 'oversized';
type FabricFamily = 'wool' | 'knit' | 'denim' | 'cotton' | 'linen' | 'silk' | 'leather' | 'tech' | 'other';

export function classifyVolume(garment: Pick<Garment, 'fit' | 'silhouette' | 'subCategory'>): SilhouetteVolume {
  const text = `${garment.fit} ${garment.silhouette} ${garment.subCategory}`.toLowerCase();
  if (/\b(oversized|boxy|baggy|wide[- ]?leg|palazzo|balloon|slouchy|drop[- ]?shoulder|cocoon)\b/.test(text)) {
    return 'oversized';
  }
  if (/\b(relaxed|loose|straight|flowy|draped|easy|boyfriend|pleated|regular)\b/.test(text)) {
    return 'relaxed';
  }
  if (/\b(slim|skinny|fitted|bodycon|tight|compression|pencil|sleek|tapered)\b/.test(text)) {
    return 'slim';
  }
  return 'tailored';
}

function classifyFabricFamily(garment: Pick<Garment, 'fabric' | 'texture' | 'subCategory'>): FabricFamily {
  const text = `${garment.fabric} ${garment.texture} ${garment.subCategory}`.toLowerCase();
  if (/\b(leather|suede|calfskin|nubuck|patent|shearling)\b/.test(text)) return 'leather';
  if (/\b(denim|chambray|selvedge|jean)\b/.test(text)) return 'denim';
  if (/\b(linen|hemp|ramie|seersucker)\b/.test(text)) return 'linen';
  if (/\b(silk|satin|velvet|chiffon|organza|cupro)\b/.test(text)) return 'silk';
  if (/\b(cashmere|merino|knit|ribbed|cable|boucle|mohair|alpaca|sweater|cardigan)\b/.test(text)) return 'knit';
  if (/\b(wool|tweed|flannel|worsted|gabardine|melton|herringbone)\b/.test(text)) return 'wool';
  if (/\b(nylon|polyester|gore[- ]?tex|ripstop|fleece|mesh|spandex|neoprene|technical|shell)\b/.test(text)) return 'tech';
  if (/\b(cotton|poplin|oxford|twill|chino|canvas|jersey|corduroy)\b/.test(text)) return 'cotton';
  return 'other';
}

const FABRIC_WEIGHT_RANK: Record<Garment['fabricWeight'], number> = {
  Lightweight: 1,
  Midweight: 2,
  Heavyweight: 3,
};

// Editorial tactile pairing matrix (delta points for intentional material contrast vs clashes)
const MATERIAL_PAIR_DELTA: Partial<Record<FabricFamily, Partial<Record<FabricFamily, number>>>> = {
  knit: { wool: 6, denim: 5, leather: 6, silk: 5, cotton: 4, linen: -1 },
  wool: { knit: 6, cotton: 5, silk: 6, leather: 6, denim: 4, linen: -5, tech: -3 },
  denim: { leather: 6, knit: 5, cotton: 4, wool: 4, linen: 4, silk: 3, denim: 1 },
  cotton: { denim: 4, wool: 5, leather: 5, linen: 5, knit: 4, tech: 3 },
  linen: { cotton: 5, leather: 4, denim: 4, silk: 4, wool: -5, tech: -3 },
  silk: { wool: 6, knit: 5, leather: 5, denim: 3, linen: 4, tech: -6 },
  leather: { knit: 6, wool: 6, denim: 6, cotton: 5, silk: 5, linen: 4 },
  tech: { cotton: 3, denim: 2, knit: 1, wool: -3, silk: -6, linen: -3 },
};

/**
 * Evaluates full-outfit Silhouette Balance (Big-over-Fitted / Rule of Thirds),
 * Layering Fabric-Weight Physics, and Tactile Material Matrix (0-100).
 */
export function evaluateProportionAndLayering(
  items: Garment[],
  occasion?: OccasionType
): { score: number; note: string } {
  if (items.length < 2) {
    return { score: 78, note: 'Add complementary layers to evaluate silhouette balance.' };
  }

  let score = 80;
  const notes: string[] = [];

  const top = items.find((i) => i.category === 'tops');
  const bottom = items.find((i) => i.category === 'bottoms');
  const outer = items.find((i) => i.category === 'outerwear');
  const footwear = items.find((i) => i.category === 'footwear');
  const isStreetwear = occasion === 'Streetwear';

  // 1. Top-to-Bottom Volume Balance (Editorial Rule of Proportions)
  if (top && bottom) {
    const topVol = classifyVolume(top);
    const botVol = classifyVolume(bottom);

    if (
      (topVol === 'oversized' && (botVol === 'slim' || botVol === 'tailored')) ||
      ((topVol === 'slim' || topVol === 'tailored') && (botVol === 'oversized' || botVol === 'relaxed'))
    ) {
      score += 9;
      notes.push('classic fitted-to-relaxed silhouette balance');
    } else if (topVol === 'tailored' && botVol === 'tailored') {
      score += 7;
      notes.push('sharp tailored line');
    } else if (topVol === 'relaxed' && botVol === 'relaxed') {
      score += isStreetwear ? 7 : 3;
    } else if (topVol === 'oversized' && botVol === 'oversized') {
      if (isStreetwear) {
        score += 5;
        notes.push('intentional streetwear volume');
      } else {
        score -= 8;
        notes.push('double-oversized volume may overwhelm proportions');
      }
    } else if (topVol === 'slim' && botVol === 'slim') {
      score += 1;
    }
  }

  // 2. Layering Physics: Outerwear weight >= inner top weight
  if (top && outer) {
    const topW = FABRIC_WEIGHT_RANK[top.fabricWeight] ?? 2;
    const outerW = FABRIC_WEIGHT_RANK[outer.fabricWeight] ?? 2;
    if (outerW < topW) {
      score -= 10;
      notes.push('outer layer is lighter than inner knit');
    } else if (outerW > topW) {
      score += 6;
      notes.push('structured weight-stepped layering');
    } else {
      score += 3;
    }
  }

  // 3. Tactile Fabric Interplay across all pairs
  let matDeltaSum = 0;
  let matPairs = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const fA = classifyFabricFamily(items[i]);
      const fB = classifyFabricFamily(items[j]);
      const delta = MATERIAL_PAIR_DELTA[fA]?.[fB] ?? (fA !== fB ? 2 : 0);
      matDeltaSum += delta;
      matPairs += 1;
    }
  }
  if (matPairs > 0) {
    const avgMat = matDeltaSum / matPairs;
    score += Math.round(avgMat * 1.4);
    if (avgMat >= 4.5) {
      notes.push('rich tactile fabric contrast');
    } else if (avgMat <= -2.5) {
      notes.push('fabric weights/seasons slightly conflict');
    }
  }

  // 4. Footwear-to-Bottom Formality & Hem Alignment
  if (bottom && footwear) {
    const diff = Math.abs(bottom.formality - footwear.formality);
    if (diff <= 2) {
      score += 4;
    } else if (diff >= 5 && !isStreetwear) {
      score -= 8;
      notes.push('footwear formality clashes with bottom');
    }
  }

  return {
    score: Math.max(45, Math.min(99, Math.round(score))),
    note: notes[0] || 'clean proportion and drape interplay',
  };
}

// ============================================================================
// 3. DETERMINISTIC 64-DIM FASHION EMBEDDING & LEARNED TASTE CENTROID
// ============================================================================

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
  const oklch = hexToOklch(garment.colorHex);

  // Perceptual OKLCH & structural attributes (dims 0..7)
  vec[0] = oklch.L;
  vec[1] = oklch.a * 2.5;
  vec[2] = oklch.b * 2.5;
  vec[3] = oklch.C * 2.5;
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

/**
 * Learns a user's personal style centroid vector from their saved Lookbook outfits
 * and worn garments (zero extra AI tokens). Aligns future suggestions with proven taste.
 */
export function computeTasteCentroid(
  garments: Garment[],
  vectors: Record<string, number[]>,
  savedOutfits: OutfitCombination[] = []
): number[] | null {
  const weights = new Map<string, number>();

  for (const outfit of savedOutfits) {
    const outfitWeight = 1.5 + Math.min(3, outfit.wearCount * 0.5);
    for (const id of outfit.itemIds) {
      weights.set(id, (weights.get(id) ?? 0) + outfitWeight);
    }
  }
  for (const g of garments) {
    if (g.wearCount > 0) {
      weights.set(g.id, (weights.get(g.id) ?? 0) + Math.min(2.5, g.wearCount * 0.4));
    }
  }

  if (weights.size === 0) return null;

  // Group vectors by dominant dimensionality so we only average compatible embedding spaces
  const dimCounts = new Map<number, number>();
  for (const id of weights.keys()) {
    const v = vectors[id];
    if (Array.isArray(v) && v.length > 0) {
      dimCounts.set(v.length, (dimCounts.get(v.length) ?? 0) + 1);
    }
  }
  let targetDim = 0;
  let bestCount = 0;
  for (const [dim, count] of dimCounts.entries()) {
    if (count > bestCount) {
      bestCount = count;
      targetDim = dim;
    }
  }
  if (targetDim === 0) return null;

  const centroid = new Array<number>(targetDim).fill(0);
  let totalW = 0;
  for (const [id, w] of weights.entries()) {
    const v = vectors[id];
    if (Array.isArray(v) && v.length === targetDim) {
      for (let i = 0; i < targetDim; i++) {
        centroid[i] += v[i] * w;
      }
      totalW += w;
    }
  }

  return totalW > 0 ? normalizeVector(centroid) : null;
}

// ============================================================================
// 4. PAIRWISE & DEEP 12-SEASON PERSONAL FLATTERY SCORING
// ============================================================================

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
  const seasonScore = sharedSeasons.length > 0 ? 94 : 60;

  // Pattern balance: avoid clashing two busy prints
  const aSolid =
    itemA.pattern.toLowerCase().includes('solid') ||
    itemA.pattern.toLowerCase().includes('subtle') ||
    itemA.pattern.toLowerCase().includes('micro');
  const bSolid =
    itemB.pattern.toLowerCase().includes('solid') ||
    itemB.pattern.toLowerCase().includes('subtle') ||
    itemB.pattern.toLowerCase().includes('micro');
  const patternScore = aSolid || bSolid ? 95 : 64;

  // Vector similarity (map cosine similarity in fashion embedding space to 0-100)
  let vectorSimilarity = 78;
  if (vecA && vecB && vecA.length > 0 && vecA.length === vecB.length) {
    const rawCos = cosineSimilarity(vecA, vecB);
    vectorSimilarity = Math.round(Math.max(40, Math.min(99, 55 + rawCos * 45)));
  }

  // Tactile material matrix bonus
  const famA = classifyFabricFamily(itemA);
  const famB = classifyFabricFamily(itemB);
  const matDelta = MATERIAL_PAIR_DELTA[famA]?.[famB] ?? (famA !== famB ? 2 : 0);

  const score = Math.min(
    97,
    Math.max(
      40,
      Math.round(
        colorHarmony * 0.3 +
          vectorSimilarity * 0.27 +
          formalityScore * 0.23 +
          seasonScore * 0.1 +
          patternScore * 0.1 +
          matDelta * 0.6
      )
    )
  );

  const reasons: string[] = [];
  if (colorHarmony >= 88) {
    reasons.push(`balanced ${itemA.primaryColor.toLowerCase()} & ${itemB.primaryColor.toLowerCase()} contrast`);
  }
  if (matDelta >= 5) {
    reasons.push(`${famA}-on-${famB} texture depth`);
  } else if (formalityDiff <= 2) {
    reasons.push('aligned formality');
  }
  if (reasons.length === 0) reasons.push('cohesive silhouette pairing');

  return {
    score,
    vectorSimilarity,
    colorHarmony,
    reason: reasons.slice(0, 2).join(' · '),
  };
}

/**
 * Scores how flattering a single garment is for THIS specific person (0-100) based on
 * skin undertone, 12-season AI Color Blueprint (best vs. avoid colors), preferred fits,
 * ideal silhouettes, and recommended fabrics.
 */
export function scoreGarmentForPerson(garment: Garment, profile?: UserProfile | null): number {
  if (!profile) return 75;

  let score = 72;

  // 1. Skin undertone vs. garment undertone alignment
  const skin = profile.skinUndertone;
  if (skin === 'Warm') {
    if (garment.undertone === 'Warm') score += 9;
    else if (garment.undertone === 'Neutral') score += 5;
    else score -= 5;
  } else if (skin === 'Cool') {
    if (garment.undertone === 'Cool') score += 9;
    else if (garment.undertone === 'Neutral') score += 5;
    else score -= 5;
  } else if (skin === 'Olive') {
    if (garment.undertone === 'Warm' || garment.undertone === 'Neutral') score += 8;
    else score -= 3;
  } else {
    score += 6;
  }

  // 2. Preferred fits match
  const fitText = `${garment.fit} ${garment.silhouette}`.toLowerCase();
  if (profile.preferredFits.some((f) => fitText.includes(f.toLowerCase()))) {
    score += 7;
  }

  // 3. AI Styling Blueprint deep personalization (12-season best/avoid colors, silhouettes, fabrics)
  const bp = profile.blueprint;
  if (bp) {
    const colorText = `${garment.primaryColor} ${garment.secondaryColors.join(' ')}`.toLowerCase();
    const fabricText = `${garment.fabric} ${garment.texture}`.toLowerCase();

    const matchesBestColor = bp.bestColors.some((c) => {
      const words = c.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
      return words.some((w) => colorText.includes(w));
    });
    const matchesAvoidColor = bp.avoidColors.some((c) => {
      const words = c.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
      return words.some((w) => colorText.includes(w));
    });

    if (matchesBestColor) score += 13;
    if (matchesAvoidColor) score -= 16;

    // 12-Season chroma/depth alignment via OKLCH
    const oklch = hexToOklch(garment.colorHex);
    const seasonLower = bp.colorSeason.toLowerCase();
    if (seasonLower.includes('deep') || seasonLower.includes('dark')) {
      if (oklch.L <= 0.55) score += 3;
      else if (oklch.L >= 0.85 && oklch.C > 0.08) score -= 2; // Chalky pastels wash out Deep seasons
    } else if (seasonLower.includes('soft') || seasonLower.includes('muted')) {
      if (oklch.C <= 0.13) score += 3;
      else if (oklch.C >= 0.21) score -= 3; // Neon overpowers Soft seasons
    } else if (seasonLower.includes('bright') || seasonLower.includes('clear')) {
      if (oklch.C >= 0.12 || oklch.L <= 0.22 || oklch.L >= 0.9) score += 3;
    } else if (seasonLower.includes('light')) {
      if (oklch.L >= 0.55) score += 3;
    }

    const matchesSilhouette = bp.idealSilhouettes.some((s) => {
      const words = s.toLowerCase().split(/\s+/).filter((w) => w.length >= 4);
      return words.some((w) => fitText.includes(w) || garment.subCategory.toLowerCase().includes(w));
    });
    if (matchesSilhouette) score += 7;

    const matchesFabric = bp.recommendedFabrics.some((f) => {
      const words = f.toLowerCase().split(/\s+/).filter((w) => w.length >= 4);
      return words.some((w) => fabricText.includes(w));
    });
    if (matchesFabric) score += 6;
  }

  return Math.max(38, Math.min(99, Math.round(score)));
}

/**
 * Evaluates how well a full outfit's colors, silhouettes, fabrics, and perceptual OKLCH
 * luminance contrast flatter the user's personal profile & AI blueprint.
 */
export function scoreOutfitForPerson(items: Garment[], profile?: UserProfile | null): number {
  if (!profile || items.length === 0) return 78;

  // Weight tops & outerwear 1.5x highest because colors near the face dominate complexion harmony
  let weightedSum = 0;
  let totalWeight = 0;
  for (const item of items) {
    const weight =
      item.category === 'tops' || item.category === 'outerwear' ? 1.5 : 1.0;
    weightedSum += scoreGarmentForPerson(item, profile) * weight;
    totalWeight += weight;
  }
  let score = weightedSum / totalWeight;

  // Match perceptual OKLCH luminance spread against user's AI contrastLevel (High / Medium / Low)
  const contrastLevel = profile.blueprint?.contrastLevel?.toLowerCase() ?? '';
  if (contrastLevel && items.length >= 2) {
    const lums = items.map((i) => hexToOklch(i.colorHex).L);
    const lumSpread = Math.max(...lums) - Math.min(...lums);
    if (contrastLevel.includes('high')) {
      score += lumSpread >= 0.42 ? 6 : lumSpread < 0.18 ? -5 : 1;
    } else if (contrastLevel.includes('low')) {
      score += lumSpread <= 0.34 ? 6 : lumSpread > 0.62 ? -5 : 0;
    } else if (contrastLevel.includes('medium')) {
      score += lumSpread >= 0.2 && lumSpread <= 0.58 ? 5 : 0;
    }
  }

  return Math.max(42, Math.min(99, Math.round(score)));
}

export function findBestCompanions(
  targetId: string,
  items: Garment[],
  vectors: Record<string, number[]>,
  limit = 4,
  profile?: UserProfile | null
): CompanionMatch[] {
  const target = items.find((g) => g.id === targetId);
  if (!target) return [];

  const targetVec = vectors[targetId] ?? computeDeterministicVector(target);

  return items
    .filter((other) => other.id !== targetId && other.category !== target.category)
    .map((other) => {
      const otherVec = vectors[other.id] ?? computeDeterministicVector(other);
      const res = scorePairCompatibility(target, other, targetVec, otherVec);
      const propScore = evaluateProportionAndLayering([target, other]).score;
      const personalFit = profile ? scoreGarmentForPerson(other, profile) : res.score;
      const blendedScore = profile
        ? Math.min(98, Math.round(res.score * 0.64 + propScore * 0.16 + personalFit * 0.2))
        : Math.min(98, Math.round(res.score * 0.8 + propScore * 0.2));
      return {
        garmentId: other.id,
        score: blendedScore,
        vectorSimilarity: res.vectorSimilarity,
        colorHarmony: res.colorHarmony,
        reason:
          profile && personalFit >= 86
            ? `${res.reason} · flatters your palette`
            : res.reason,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ============================================================================
// 5. FULL-OUTFIT MULTI-OBJECTIVE EVALUATOR
// ============================================================================

export function evaluateOutfitLocalHarmony(
  selectedItems: Garment[],
  vectors: Record<string, number[]>,
  profile?: UserProfile | null,
  options: { occasion?: OccasionType; tasteCentroid?: number[] | null } = {}
): {
  overallScore: number;
  vectorScore: number;
  colorScore: number;
  proportionScore: number;
  personalScore: number;
  tasteScore: number;
  formalitySpread: number;
  paletteSummary: string;
  feedback: string;
} {
  if (selectedItems.length < 2) {
    return {
      overallScore: selectedItems.length === 1 ? 65 : 0,
      vectorScore: 0,
      colorScore: 0,
      proportionScore: 0,
      personalScore:
        selectedItems.length === 1 ? scoreGarmentForPerson(selectedItems[0], profile) : 0,
      tasteScore: 0,
      formalitySpread: 0,
      paletteSummary: 'Select 2+ items',
      feedback:
        selectedItems.length === 0
          ? 'Select at least a top and bottom to evaluate outfit harmony.'
          : 'Add a bottom or outerwear piece to calculate OKLCH color, proportion & personal harmony.',
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

  const pairAvg = Math.round(totalScore / pairs);
  const vectorScore = Math.round(totalVec / pairs);
  const paletteEval = evaluateOutfitPaletteHarmony(selectedItems);
  const colorScore = Math.max(45, Math.min(99, Math.round(totalColor / pairs + paletteEval.paletteBonus)));
  const proportionEval = evaluateProportionAndLayering(selectedItems, options.occasion);
  const proportionScore = proportionEval.score;
  const personalScore = scoreOutfitForPerson(selectedItems, profile);

  // Learned taste alignment (if user has saved outfits / wear history)
  let tasteScore = 78;
  if (options.tasteCentroid && options.tasteCentroid.length > 0) {
    let simSum = 0;
    let simCount = 0;
    for (const item of selectedItems) {
      const v = vectors[item.id];
      if (v && v.length === options.tasteCentroid.length) {
        simSum += cosineSimilarity(v, options.tasteCentroid);
        simCount += 1;
      }
    }
    if (simCount > 0) {
      tasteScore = Math.round(Math.max(50, Math.min(99, 62 + (simSum / simCount) * 38)));
    }
  }

  const baseOverall = profile
    ? pairAvg * 0.34 +
      colorScore * 0.2 +
      proportionScore * 0.2 +
      personalScore * 0.26
    : pairAvg * 0.48 + colorScore * 0.26 + proportionScore * 0.26;

  const overallScore = Math.max(
    45,
    Math.min(
      98,
      Math.round(
        options.tasteCentroid ? baseOverall * 0.92 + tasteScore * 0.08 : baseOverall
      )
    )
  );

  let feedback = `${paletteEval.paletteSummary} with ${proportionEval.note}.`;
  if (formalitySpread >= 5) {
    feedback =
      'High formality contrast — swap one piece to tighten dress-code cohesion across the look.';
  } else if (proportionScore < 70) {
    feedback = `Silhouette alert: ${proportionEval.note}. Try pairing a structured or fitted anchor to sharpen proportions.`;
  } else if (profile?.blueprint && personalScore < 68) {
    feedback = `Colors near your face lean away from your ${profile.blueprint.colorSeason} palette — anchor the top half with one of your best colors.`;
  } else if (colorScore < 74) {
    feedback = 'Color temperatures or accent hues compete — anchor with a crisp neutral layer.';
  } else if (overallScore >= 90) {
    feedback = profile?.blueprint
      ? `Editorial match for your ${profile.blueprint.colorSeason} coloring: ${paletteEval.paletteSummary.toLowerCase()} with ${proportionEval.note}.`
      : `Studio-grade harmony: ${paletteEval.paletteSummary.toLowerCase()} and ${proportionEval.note}.`;
  }

  return {
    overallScore,
    vectorScore,
    colorScore,
    proportionScore,
    personalScore,
    tasteScore,
    formalitySpread,
    paletteSummary: paletteEval.paletteSummary,
    feedback,
  };
}

// ============================================================================
// 6. STAGE-1 MULTI-OBJECTIVE RETRIEVAL + MMR DIVERSITY SELECTION
// ============================================================================

export interface CandidateCombination {
  itemIds: string[];
  items: Garment[];
  localScore: number;
  vectorScore: number;
  colorScore: number;
  proportionScore: number;
  personalScore: number;
  freshnessScore: number;
  paletteSummary: string;
}

const OCCASION_FORMALITY_BAND: Record<OccasionType, [number, number]> = {
  Streetwear: [1, 5],
  Everyday: [2, 6],
  Travel: [3, 6],
  'Smart Casual': [5, 8],
  Evening: [6, 9],
  Formal: [7, 10],
};

function scoreGarmentPromptRelevance(
  garment: Garment,
  tokens: string[],
  rawPrompt: string
): number {
  if (tokens.length === 0 && !rawPrompt) return 0;
  const haystack = [
    garment.name,
    garment.category,
    garment.subCategory,
    garment.primaryColor,
    ...garment.secondaryColors,
    garment.undertone,
    garment.fabric,
    garment.fabricWeight,
    garment.texture,
    garment.fit,
    garment.silhouette,
    garment.pattern,
    garment.stylingNotes,
    ...garment.seasons,
    ...garment.occasions,
  ]
    .join(' ')
    .toLowerCase();

  let hits = 0;
  for (const tok of tokens) {
    if (haystack.includes(tok)) {
      hits += 1;
    }
  }

  let boost = Math.min(9, hits * 3);

  // Rich natural-language intent & weather cues
  if (/\b(relaxed|comfy|cozy|laid[- ]?back|chill|casual|weekend|coffee|errand)\b/.test(rawPrompt)) {
    if (garment.formality <= 5) boost += 2.5;
  }
  if (/\b(sharp|sleek|dressy|date|dinner|formal|interview|wedding|elevated|chic|cocktail|gala)\b/.test(rawPrompt)) {
    if (garment.formality >= 6) boost += 2.5;
  }
  if (/\b(light|breathable|breezy|hot|humid|warm weather|summer|beach)\b/.test(rawPrompt)) {
    if (garment.fabricWeight === 'Lightweight') boost += 3;
    if (garment.fabricWeight === 'Heavyweight') boost -= 4;
  }
  if (/\b(cozy|layer|layered|cold|rainy|chilly|freezing|winter|snow)\b/.test(rawPrompt)) {
    if (garment.fabricWeight === 'Heavyweight' || garment.category === 'outerwear') boost += 3;
    if (garment.fabricWeight === 'Lightweight' && garment.category === 'outerwear') boost -= 2;
  }
  if (/\b(minimal|clean|quiet luxury|monochrome|tonal|classic|old money)\b/.test(rawPrompt)) {
    if (garment.pattern.toLowerCase().includes('solid')) boost += 1.5;
    if (isPerceptualNeutral(hexToOklch(garment.colorHex)) || isEarthNeutral(hexToOklch(garment.colorHex))) {
      boost += 1.5;
    }
  }
  if (/\b(bold|statement|pop of color|vibrant|colorful|stand out)\b/.test(rawPrompt)) {
    if (hexToOklch(garment.colorHex).C >= 0.12) boost += 3;
  }
  if (/\b(oversized|baggy|street|streetwear|edgy)\b/.test(rawPrompt)) {
    if (classifyVolume(garment) === 'oversized' || classifyVolume(garment) === 'relaxed') boost += 2;
  }

  return boost;
}

/**
 * Stage-1 Next-Gen Candidate Retriever:
 * Scores combinations across 6 objectives (OKLCH color, 128-dim vector + learned taste,
 * silhouette/layering proportion, 12-season personal flattery, occasion/weather/prompt intent,
 * and under-worn rotation) then selects diverse finalists via Maximal Marginal Relevance (MMR).
 */
export function generateCandidateCombinations(
  items: Garment[],
  vectors: Record<string, number[]>,
  options: {
    occasion?: OccasionType;
    season?: SeasonTag;
    anchorItemId?: string;
    customPrompt?: string;
    profile?: UserProfile | null;
    savedOutfits?: OutfitCombination[];
    explorationMode?: 'best' | 'fresh';
    maxCandidates?: number;
  } = {}
): CandidateCombination[] {
  const {
    occasion,
    season,
    anchorItemId,
    customPrompt = '',
    profile,
    savedOutfits = [],
    explorationMode = 'best',
    maxCandidates = 8,
  } = options;

  const cleanPrompt = customPrompt.trim().toLowerCase();
  const stopWords = new Set([
    'with', 'that', 'this', 'from', 'for', 'the', 'and', 'but', 'look', 'looks',
    'outfit', 'outfits', 'wear', 'wearing', 'something', 'want', 'need', 'like',
    'good', 'nice', 'style', 'styled', 'vibe', 'vibes', 'some', 'very', 'more',
    'into', 'going', 'today', 'tonight', 'please', 'make', 'give', 'without',
  ]);
  const promptTokens = cleanPrompt
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w))
    .slice(0, 14);

  const avoidOuterwear = /\b(no|without)\s+(jacket|coat|outerwear|blazer|layers?)\b/.test(cleanPrompt);
  const avoidSneakers = /\b(no|without)\s+(sneakers?|trainers?|runners?)\b/.test(cleanPrompt);
  const avoidDenim = /\b(no|without)\s+(jeans?|denim)\b/.test(cleanPrompt);
  const preferMonochrome = /\b(monochrome|all[- ]black|all[- ]white|tonal)\b/.test(cleanPrompt);

  const tasteCentroid = computeTasteCentroid(items, vectors, savedOutfits);
  const savedKeys = new Set(
    savedOutfits.map((o) => [...o.itemIds].sort().join('|'))
  );

  const rankSlotByContext = (list: Garment[], cap: number): Garment[] => {
    if (list.length <= cap) return list;
    return [...list]
      .sort((a, b) => {
        const scoreItem = (g: Garment) => {
          let s = scoreGarmentPromptRelevance(g, promptTokens, cleanPrompt);
          if (profile) s += (scoreGarmentForPerson(g, profile) - 70) * 0.3;
          if (occasion && g.occasions.includes(occasion)) s += 3.5;
          if (
            season &&
            season !== 'All-Season' &&
            (g.seasons.includes(season) || g.seasons.includes('All-Season'))
          ) {
            s += 2.5;
          }
          if (explorationMode === 'fresh' && g.wearCount === 0) s += 3;
          return s;
        };
        return scoreItem(b) - scoreItem(a);
      })
      .slice(0, cap);
  };

  let tops = items.filter((i) => i.category === 'tops');
  let bottoms = items.filter((i) => i.category === 'bottoms');
  let outerwear = items.filter((i) => i.category === 'outerwear');
  let footwear = items.filter((i) => i.category === 'footwear');
  const accessories = items.filter((i) => i.category === 'accessories');

  if (avoidDenim) {
    const nonDenimBottoms = bottoms.filter(
      (b) => !/\b(denim|jeans?)\b/i.test(`${b.name} ${b.fabric} ${b.subCategory}`)
    );
    if (nonDenimBottoms.length > 0) bottoms = nonDenimBottoms;
  }
  if (avoidSneakers) {
    const nonSneakers = footwear.filter(
      (f) => !/\b(sneakers?|trainers?|runners?)\b/i.test(`${f.name} ${f.subCategory}`)
    );
    if (nonSneakers.length > 0) footwear = nonSneakers;
  }

  if (tops.length === 0 || bottoms.length === 0) {
    return [];
  }

  // Pre-filter anchored slot before cartesian enumeration
  const anchoredGarment = anchorItemId ? items.find((i) => i.id === anchorItemId) : undefined;
  if (anchoredGarment) {
    if (anchoredGarment.category === 'tops') tops = [anchoredGarment];
    else if (anchoredGarment.category === 'bottoms') bottoms = [anchoredGarment];
    else if (anchoredGarment.category === 'outerwear') outerwear = [anchoredGarment];
    else if (anchoredGarment.category === 'footwear') footwear = [anchoredGarment];
  }

  // Bounded search for 50-100+ item cloud wardrobes (<25ms)
  const cappedTops = rankSlotByContext(tops, 14);
  const cappedBottoms = rankSlotByContext(bottoms, 12);
  const cappedOuter = rankSlotByContext(outerwear, 6);
  const cappedShoes = rankSlotByContext(footwear, 6);

  const candidates: CandidateCombination[] = [];
  const seenKeys = new Set<string>();

  const outerOptions: Array<Garment | null> =
    anchoredGarment?.category === 'outerwear'
      ? [anchoredGarment]
      : avoidOuterwear
        ? [null]
        : season === 'Summer'
          ? [null, ...cappedOuter.slice(0, 1)]
          : [...cappedOuter, null];

  const shoeOptions: Array<Garment | null> =
    anchoredGarment?.category === 'footwear'
      ? [anchoredGarment]
      : cappedShoes.length > 0
        ? cappedShoes
        : [null];

  const [targetFormMin, targetFormMax] = occasion
    ? OCCASION_FORMALITY_BAND[occasion]
    : [3, 8];

  for (const top of cappedTops) {
    for (const bottom of cappedBottoms) {
      for (const outer of outerOptions) {
        for (const shoe of shoeOptions) {
          const comboItems = [top, bottom, outer, shoe].filter(
            (x): x is Garment => x !== null
          );

          // Include anchored accessory, or best-matching accessory if available
          if (anchoredGarment?.category === 'accessories') {
            comboItems.push(anchoredGarment);
          } else if (accessories.length > 0) {
            let bestAcc: Garment | null = null;
            let bestAccScore = 76; // Only add an accessory if it genuinely harmonizes
            for (const acc of accessories.slice(0, 6)) {
              const s = scorePairCompatibility(
                top,
                acc,
                vectors[top.id] ?? computeDeterministicVector(top),
                vectors[acc.id] ?? computeDeterministicVector(acc)
              ).score;
              if (s > bestAccScore) {
                bestAccScore = s;
                bestAcc = acc;
              }
            }
            if (bestAcc) comboItems.push(bestAcc);
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

          const evalRes = evaluateOutfitLocalHarmony(comboItems, vectors, profile, {
            occasion,
            tasteCentroid,
          });
          let bonus = 0;

          // Occasion tag + formality target band alignment
          if (occasion) {
            const occasionHits = comboItems.filter((c) =>
              c.occasions.includes(occasion)
            ).length;
            bonus += Math.round((occasionHits / comboItems.length) * 5) - 2;

            const avgForm =
              comboItems.reduce((acc, g) => acc + g.formality, 0) / comboItems.length;
            if (avgForm >= targetFormMin && avgForm <= targetFormMax) {
              bonus += 3;
            } else {
              const dist =
                avgForm < targetFormMin ? targetFormMin - avgForm : avgForm - targetFormMax;
              bonus -= Math.min(7, Math.round(dist * 2.5));
            }
          }

          // Season & thermal appropriateness
          if (season && season !== 'All-Season') {
            const seasonHits = comboItems.filter(
              (c) => c.seasons.includes(season) || c.seasons.includes('All-Season')
            ).length;
            bonus += Math.round((seasonHits / comboItems.length) * 4) - 2;

            if (season === 'Summer') {
              const heavyCount = comboItems.filter((c) => c.fabricWeight === 'Heavyweight').length;
              bonus -= heavyCount * 4;
            }
          }

          // Prefer 3-4 piece layered looks for cooler seasons unless user excluded outerwear
          if (!avoidOuterwear) {
            if (outer && (season === 'Autumn' || season === 'Winter')) {
              bonus += 3;
            } else if (!outer && (season === 'Autumn' || season === 'Winter')) {
              bonus -= 2;
            }
          }

          // Custom style brief alignment
          if (cleanPrompt.length > 0) {
            const avgPromptBoost =
              comboItems.reduce(
                (acc, g) => acc + scoreGarmentPromptRelevance(g, promptTokens, cleanPrompt),
                0
              ) / comboItems.length;
            bonus += Math.min(11, Math.round(avgPromptBoost * 1.5));

            if (preferMonochrome) {
              const lums = comboItems.map((g) => hexToOklch(g.colorHex));
              const maxHueSpread = lums.reduce((mx, c1) => {
                return Math.max(
                  mx,
                  ...lums.map((c2) => {
                    if (isPerceptualNeutral(c1) || isPerceptualNeutral(c2)) return 0;
                    const d = Math.abs(c1.H - c2.H);
                    return Math.min(d, 360 - d);
                  })
                );
              }, 0);
              if (maxHueSpread <= 28) bonus += 5;
            }
          }

          // Closet rotation & freshness score (rewards under-worn pieces, avoids exact saved duplicates)
          const avgWear =
            comboItems.reduce((acc, g) => acc + g.wearCount, 0) / comboItems.length;
          const isAlreadySaved = savedKeys.has(key);
          let freshnessScore = Math.max(55, Math.min(98, Math.round(92 - avgWear * 5)));
          if (isAlreadySaved) freshnessScore = Math.max(45, freshnessScore - 18);

          if (explorationMode === 'fresh') {
            bonus += Math.round((freshnessScore - 75) * 0.25);
            if (isAlreadySaved) bonus -= 6;
          } else if (isAlreadySaved) {
            bonus -= 3;
          }

          // Formality spread penalty
          bonus -= Math.max(0, evalRes.formalitySpread - 2);

          candidates.push({
            itemIds: comboItems.map((c) => c.id),
            items: comboItems,
            localScore: Math.max(50, Math.min(98, evalRes.overallScore + bonus)),
            vectorScore: evalRes.vectorScore,
            colorScore: evalRes.colorScore,
            proportionScore: evalRes.proportionScore,
            personalScore: evalRes.personalScore,
            freshnessScore,
            paletteSummary: evalRes.paletteSummary,
          });
        }
      }
    }
  }

  candidates.sort((a, b) => b.localScore - a.localScore);

  // Maximal Marginal Relevance (MMR) selection: balances top quality with genuine variety
  const pool = candidates.slice(0, Math.min(candidates.length, 160));
  const selected: CandidateCombination[] = [];
  const lambda = explorationMode === 'fresh' ? 0.62 : 0.72;

  while (selected.length < maxCandidates && pool.length > 0) {
    let bestIdx = 0;
    let bestMmr = -Infinity;

    for (let i = 0; i < pool.length; i++) {
      const cand = pool[i];
      let maxJaccard = 0;
      for (const picked of selected) {
        const setA = new Set(cand.itemIds);
        const setB = new Set(picked.itemIds);
        let inter = 0;
        for (const id of setA) {
          if (setB.has(id)) inter += 1;
        }
        const union = setA.size + setB.size - inter;
        const jaccard = union > 0 ? inter / union : 0;
        // Adjust overlap penalty when an anchor item is intentionally shared across all combos
        const effectiveSim =
          anchorItemId && setA.has(anchorItemId) && setB.has(anchorItemId)
            ? Math.max(0, (inter - 1) / Math.max(1, union - 1))
            : jaccard;
        if (effectiveSim > maxJaccard) maxJaccard = effectiveSim;
      }

      const normRel = cand.localScore / 100;
      const mmr = lambda * normRel - (1 - lambda) * maxJaccard;
      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestIdx = i;
      }
    }

    selected.push(pool.splice(bestIdx, 1)[0]);
  }

  return selected;
}

// ============================================================================
// 7. WARDROBE DNA INTELLIGENCE & GAP ANALYSIS (FOR ADVISOR + AI DOSSIER)
// ============================================================================

export interface WardrobeDnaSummary {
  totalItems: number;
  categoryCounts: Record<GarmentCategory, number>;
  undertoneSplit: { warm: number; cool: number; neutral: number };
  formalityBand: { casual: number; smartCasual: number; formal: number };
  unwornCount: number;
  unwornSample: Array<{ id: string; name: string; primaryColor: string }>;
  dominantSwatches: Array<{ hex: string; color: string; count: number }>;
  blueprintAlignmentAvg: number;
  compactDossier: string;
}

export function computeWardrobeIntelligenceSummary(
  garments: Garment[],
  savedOutfits: OutfitCombination[],
  profile?: UserProfile | null
): WardrobeDnaSummary {
  const categoryCounts: Record<GarmentCategory, number> = {
    tops: 0,
    bottoms: 0,
    outerwear: 0,
    footwear: 0,
    accessories: 0,
  };
  const undertoneSplit = { warm: 0, cool: 0, neutral: 0 };
  const formalityBand = { casual: 0, smartCasual: 0, formal: 0 };
  const swatchMap = new Map<string, { hex: string; color: string; count: number }>();

  let alignSum = 0;
  const unworn: Garment[] = [];

  for (const g of garments) {
    categoryCounts[g.category] = (categoryCounts[g.category] ?? 0) + 1;
    if (g.undertone === 'Warm') undertoneSplit.warm += 1;
    else if (g.undertone === 'Cool') undertoneSplit.cool += 1;
    else undertoneSplit.neutral += 1;

    if (g.formality <= 4) formalityBand.casual += 1;
    else if (g.formality <= 7) formalityBand.smartCasual += 1;
    else formalityBand.formal += 1;

    if (g.wearCount === 0) unworn.push(g);
    alignSum += scoreGarmentForPerson(g, profile);

    const key = g.primaryColor.trim().toLowerCase();
    const existing = swatchMap.get(key);
    if (existing) existing.count += 1;
    else swatchMap.set(key, { hex: g.colorHex, color: g.primaryColor, count: 1 });
  }

  const dominantSwatches = Array.from(swatchMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 7);

  const blueprintAlignmentAvg =
    garments.length > 0 ? Math.round(alignSum / garments.length) : 0;

  const gaps = profile ? analyzeWardrobeGaps(garments, profile) : [];

  const compactDossier = [
    `Categories: tops=${categoryCounts.tops}, bottoms=${categoryCounts.bottoms}, outerwear=${categoryCounts.outerwear}, footwear=${categoryCounts.footwear}, accessories=${categoryCounts.accessories}`,
    `Undertones: Warm=${undertoneSplit.warm}, Cool=${undertoneSplit.cool}, Neutral=${undertoneSplit.neutral}`,
    `Formality Mix: Casual(1-4)=${formalityBand.casual}, SmartCasual(5-7)=${formalityBand.smartCasual}, Formal(8-10)=${formalityBand.formal}`,
    `Dominant Colors: ${dominantSwatches.map((s) => `${s.color}(${s.count})`).join(', ') || 'None'}`,
    `Personal Blueprint Alignment Avg: ${blueprintAlignmentAvg}/100 | Saved Looks: ${savedOutfits.length}`,
    `Unworn Pieces (${unworn.length}): ${unworn.slice(0, 5).map((u) => `${u.id}|${u.name}`).join('; ') || 'None'}`,
    `Top Detected Gaps: ${gaps.map((g) => `${g.title} (${g.priority})`).join('; ') || 'Balanced'}`,
  ].join('\n');

  return {
    totalItems: garments.length,
    categoryCounts,
    undertoneSplit,
    formalityBand,
    unwornCount: unworn.length,
    unwornSample: unworn.slice(0, 6).map((u) => ({
      id: u.id,
      name: u.name,
      primaryColor: u.primaryColor,
    })),
    dominantSwatches,
    blueprintAlignmentAvg,
    compactDossier,
  };
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
      } — ${cand.paletteSummary.toLowerCase()} for ${occasion.toLowerCase()}.`,
      fabricFitNotes: `Contrasts ${fabrics.join(', ')} with ${cand.proportionScore}% silhouette & drape balance.`,
      bodyTailoringNote: `Scored ${cand.personalScore}% for your ${profile.blueprint?.colorSeason || profile.skinUndertone} coloring and ${fitPref.toLowerCase()} proportions.`,
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

  // Blueprint color gap check: if user has a blueprint but few tops in their bestColors
  if (profile.blueprint && profile.blueprint.bestColors.length > 0 && counts.tops >= 2) {
    const bestColorTops = items.filter(
      (g) =>
        (g.category === 'tops' || g.category === 'outerwear') &&
        profile.blueprint!.bestColors.some((bc) =>
          g.primaryColor.toLowerCase().includes(bc.toLowerCase().split(' ')[0])
        )
    );
    if (bestColorTops.length === 0) {
      const topPick = profile.blueprint.bestColors.slice(0, 2).join(' or ');
      gaps.push({
        id: 'gap-blueprint-color',
        title: `Signature ${profile.blueprint.colorSeason} Top`,
        category: 'tops',
        priority: 'High',
        reason: `None of your current tops sit squarely in your flattering ${topPick} face-framing palette.`,
        suggestedPrompt: `Recommend a high-ROI top in ${topPick} for my ${profile.blueprint.colorSeason} palette that pairs with my existing bottoms.`,
      });
    }
  }

  if (counts.accessories === 0) {
    gaps.push({
      id: 'gap-accessories',
      title: 'Finishing Leather Belt & Hardware',
      category: 'accessories',
      priority: 'Medium',
      reason: 'Structured accessories create a visual color-sandwich link between footwear and waistlines.',
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
      reason: `Ideal for ${profile.climate.toLowerCase()} transitions and effortless weight-stepped layering.`,
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
      reason: 'Your core capsule is well balanced. A textured statement piece adds seasonal dimension and fresh silhouettes.',
      suggestedPrompt:
        'My wardrobe foundation is solid—what one trending statement piece would multiply my outfit combinations most?',
    });
  }

  return gaps.slice(0, 3);
}
