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

function isLightPastel(c: OklchColor): boolean {
  return !isPerceptualNeutral(c) && c.L >= 0.7 && c.C >= 0.036 && c.C <= 0.19;
}

/**
 * Perceptually calibrated OKLCH fashion color harmony (0-100) between two garment hex colors.
 * Guards against accidental near-match dark clashes (e.g. black + near-black navy),
 * rewards airy light-on-light pastel harmony (e.g. mint + white/stone/light denim) over harsh black contrast,
 * and rewards editorial neutral/earth anchors, tonal stepping, analogous, and balanced complementary pairs.
 */
export function computeColorHarmony(hexA: string, hexB: string): number {
  const a = hexToOklch(hexA);
  const b = hexToOklch(hexB);

  const aNeutral = isPerceptualNeutral(a);
  const bNeutral = isPerceptualNeutral(b);
  const aEarth = isEarthNeutral(a);
  const bEarth = isEarthNeutral(b);
  const aPastel = isLightPastel(a);
  const bPastel = isLightPastel(b);

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
    const neutral = aNeutral ? a : b;
    const chrom = aNeutral ? b : a;
    // Light airy pastels (mint, sky, blush, butter) harmonize best with light/stone neutrals
    // rather than stark jet black or heavy faded black contrast.
    if (isLightPastel(chrom)) {
      if (neutral.L >= 0.72) return 95; // White, ivory, ecru, stone, light grey
      if (neutral.L >= 0.44) return 88; // Medium grey, taupe, soft slate
      return 78; // Stark dark charcoal / black creates harsh seasonal contrast
    }
    const chromaPenalty = chrom.C > 0.24 ? -3 : 0; // Ultra-neon slightly harder to anchor
    return Math.min(96, Math.max(76, Math.round(86 + Math.min(0.5, lumDiff) * 18 + chromaPenalty)));
  }

  // Both earth-neutrals (e.g. camel + navy, espresso + olive, khaki + burgundy)
  if (aEarth && bEarth) {
    return Math.min(95, Math.round(86 + Math.min(0.45, lumDiff) * 18));
  }

  // One earth-neutral + one chromatic piece
  if (aEarth || bEarth) {
    const earth = aEarth ? a : b;
    const other = aEarth ? b : a;
    if (isLightPastel(other)) {
      if (earth.L >= 0.62) return 93; // Light sand, khaki, stone, warm cream-beige
      if (earth.L >= 0.42) return 86; // Olive, mid-camel, soft brown
      return 80; // Very dark raw indigo / espresso creates heavy visual weight contrast
    }
    return Math.min(93, Math.round(83 + Math.min(0.4, lumDiff) * 16));
  }

  // Airy pastel + light-wash analogous tone (e.g. mint green + light-wash denim)
  if ((aPastel || bPastel) && a.L >= 0.66 && b.L >= 0.66 && hueDiff <= 85) {
    return 92;
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

// ============================================================================
// 2B. REAL-WORLD LAYERING ROLES & SEASONAL THERMAL PHYSICS
// ============================================================================

const MID_LAYER_REGEX =
  /\b(sweater|pullover|cardigan|knitwear|knit\s+(sweater|crew(neck)?|v-?neck|vest|jumper|cardigan|pullover|half[- ]?zip|quarter[- ]?zip)|chunky\s*knit|cable[- ]?knit|jumper|hoodie|sweatshirt|quarter[- ]?zip|half[- ]?zip|sweater[- ]?vest|knit[- ]?vest|gilet|fleece|shrug|poncho|crewneck\s*knit)\b/i;

const STANDALONE_BASE_REGEX =
  /\b(t-?shirt|tee|oxford|dress\s*shirt|button[- ]?(down|up)|poplin\s*shirt|linen\s*shirt|camp\s*shirt|cuban\s*collar|polo|tank|singlet|camisole|blouse|henley|bodysuit|undershirt)\b/i;

const COLLARED_OR_CRISP_BASE_REGEX =
  /\b(oxford|button[- ]?(down|up)|dress\s*shirt|poplin|chambray|t-?shirt|tee|polo|henley|collared)\b/i;

const OPEN_OR_HEAVY_MID_REGEX =
  /\b(cardigan|vest|gilet|quarter[- ]?zip|half[- ]?zip|zip[- ]?(up|sweater)|hoodie|sweatshirt|sweater|pullover|jumper|cable[- ]?knit|fleece)\b/i;

const COLD_WEATHER_GARMENT_REGEX =
  /\b(sweater|pullover|cardigan|knitwear|jumper|turtleneck|hoodie|sweatshirt|fleece|cashmere|merino|mohair|alpaca|chunky\s*knit|cable\s*knit|wool\s*(coat|overcoat|blazer|sweater|knit|pant|trouser|jacket)|flannel|tweed|corduroy|velvet|shearling|puffer|parka|overcoat|peacoat|topcoat|trench|bomber|leather\s*jacket|suede\s*jacket|beanie|scarf|gloves|winter\s*boot|chelsea\s*boot)\b/i;

const SUMMER_ONLY_GARMENT_REGEX =
  /\b(shorts?|tank\s*top|sleeveless|camisole|sandals?|flip[- ]?flops?|slides?|espadrilles?|halter|tube\s*top|swim)\b/i;

/**
 * Classifies a 'tops' garment into its real-world dressing layer:
 * - 'base': shirts, tees, oxfords, polos, tanks, blouses worn directly against skin
 * - 'mid': sweaters, pullovers, cardigans, knit vests, hoodies, sweatshirts layered over a base
 */
export function classifyTopLayerRole(garment: Garment): 'base' | 'mid' {
  if (garment.category !== 'tops') {
    return garment.layeringRole === 'Mid' ? 'mid' : 'base';
  }
  const nameAndSub = `${garment.name} ${garment.subCategory}`;
  const fullText = `${nameAndSub} ${garment.silhouette} ${garment.texture}`;

  // Explicit mid-layer garments (sweaters, cardigans, hoodies, vests, pullovers) take top priority
  if (MID_LAYER_REGEX.test(nameAndSub)) {
    return 'mid';
  }
  // Explicit base garments (shirts, tees, polos, oxfords, henleys, tanks, blouses) stay 'base'
  // even when their texture mentions "fine knit" or "ribbed knit"
  if (STANDALONE_BASE_REGEX.test(nameAndSub)) {
    return 'base';
  }
  if (MID_LAYER_REGEX.test(fullText)) {
    return 'mid';
  }
  if (STANDALONE_BASE_REGEX.test(fullText)) {
    return 'base';
  }
  if (garment.layeringRole === 'Mid') {
    return 'mid';
  }
  if (garment.layeringRole === 'Base') {
    return 'base';
  }
  // Thick wool/cashmere/knit tops without shirt/tee/polo keywords default to mid-layer
  if (
    garment.fabricWeight === 'Heavyweight' &&
    /\b(wool|cashmere|merino|knit|fleece|alpaca|mohair)\b/i.test(`${garment.fabric} ${garment.texture}`)
  ) {
    return 'mid';
  }
  return 'base';
}

/**
 * Returns the canonical UI & styling layeringRole for any garment, correcting stale
 * legacy AI tags (e.g., a casual button-down shirt mistakenly saved as "Mid" -> "Base").
 */
export function getCanonicalLayerRole(
  garment: Pick<
    Garment,
    'category' | 'name' | 'subCategory' | 'silhouette' | 'texture' | 'fabric' | 'fabricWeight' | 'layeringRole'
  >
): Garment['layeringRole'] {
  switch (garment.category) {
    case 'tops':
      return classifyTopLayerRole(garment as Garment) === 'mid' ? 'Mid' : 'Base';
    case 'outerwear':
      return 'Outer';
    case 'bottoms':
      return 'Bottom';
    case 'footwear':
      return 'Footwear';
    case 'accessories':
      return 'Accent';
    default:
      return garment.layeringRole || 'Base';
  }
}

/**
 * True when a top is a sweater, cardigan, vest, hoodie, or knit mid-layer that should be worn
 * WITH a base underlayer (shirt/tee) beneath it whenever the user owns base tops.
 */
export function requiresUnderlayer(garment: Garment): boolean {
  if (garment.category !== 'tops') return false;
  if (classifyTopLayerRole(garment) !== 'mid') return false;
  const text = `${garment.name} ${garment.subCategory} ${garment.silhouette}`;
  // Slim lightweight fine-gauge turtlenecks can stand alone if needed; all sweaters/cardigans/vests/hoodies layer
  if (/\bturtleneck\b/i.test(text) && garment.fabricWeight === 'Lightweight') {
    return false;
  }
  return OPEN_OR_HEAVY_MID_REGEX.test(text) || garment.layeringRole === 'Mid';
}

/**
 * Evaluates whether a specific owned Base top (shirt/tee/polo) can physically and stylistically
 * be layered UNDER a specific owned Mid-layer (sweater/cardigan/hoodie/vest).
 */
export function evaluateBaseUnderMidCompatibility(
  base: Garment,
  mid: Garment
): { compatible: boolean; score: number; reason: string } {
  const baseW = FABRIC_WEIGHT_RANK[base.fabricWeight] ?? 1;
  const midW = FABRIC_WEIGHT_RANK[mid.fabricWeight] ?? 2;
  const volOrder: Record<SilhouetteVolume, number> = {
    slim: 1,
    tailored: 2,
    relaxed: 3,
    oversized: 4,
  };
  const baseVol = volOrder[classifyVolume(base)];
  const midVol = volOrder[classifyVolume(mid)];

  if (baseW > midW) {
    return {
      compatible: false,
      score: 28,
      reason: `${base.fabricWeight.toLowerCase()} ${base.fabric} bulks and bunches under a ${mid.fabricWeight.toLowerCase()} mid-layer`,
    };
  }
  if (baseVol > midVol + 1) {
    return {
      compatible: false,
      score: 34,
      reason: `${base.fit.toLowerCase()} volume bunches underneath a ${mid.fit.toLowerCase()} outer knit`,
    };
  }

  const baseText = `${base.name} ${base.subCategory} ${base.fabric} ${base.silhouette}`.toLowerCase();
  const midText = `${mid.name} ${mid.subCategory} ${mid.silhouette}`.toLowerCase();

  // Formal spread & collar realism
  const formDiff = Math.abs(base.formality - mid.formality);
  if (formDiff >= 5) {
    return {
      compatible: false,
      score: 42,
      reason: `wide formality clash (${base.formality}/10 base under ${mid.formality}/10 mid-layer)`,
    };
  }

  // Camp/resort linen shirts generally look sloppy under closed crewnecks/sweaters/hoodies
  if (
    /\b(camp|cuban|hawaiian|resort)\b/.test(baseText) &&
    /\b(crew(neck)?|sweater|pullover|hoodie|sweatshirt|quarter[- ]?zip|half[- ]?zip)\b/.test(midText)
  ) {
    return {
      compatible: false,
      score: 46,
      reason: `open camp collar fights a closed ${mid.subCategory.toLowerCase()} neckline`,
    };
  }

  const colorHarmony = computeColorHarmony(base.colorHex, mid.colorHex);
  const baseSolid = /solid|subtle|micro/i.test(base.pattern);
  const midSolid = /solid|subtle|micro/i.test(mid.pattern);
  const patternClash = !baseSolid && !midSolid;

  let score = Math.round(colorHarmony * 0.55 + Math.max(40, 100 - formDiff * 11) * 0.3 + 15);
  if (baseW < midW) score += 6;
  if (baseVol <= midVol) score += 5;
  if (COLLARED_OR_CRISP_BASE_REGEX.test(baseText)) score += 5;
  if (patternClash) score -= 18;
  if (colorHarmony <= 72) score -= 12;

  const finalScore = Math.max(30, Math.min(98, score));
  if (patternClash) {
    return {
      compatible: false,
      score: finalScore,
      reason: `competing patterns (${base.pattern} under ${mid.pattern}) clash at the neckline`,
    };
  }
  if (colorHarmony <= 72) {
    return {
      compatible: false,
      score: finalScore,
      reason: `${base.primaryColor} and ${mid.primaryColor} have low tonal separation or undertone clash`,
    };
  }

  const collarHint = /\b(oxford|button|dress\s*shirt|poplin|chambray|polo)\b/.test(baseText)
    ? 'clean collar peek at the neckline'
    : 'smooth crewneck/tee base layer without collar bulk';
  return {
    compatible: finalScore >= 68,
    score: finalScore,
    reason: `${base.fabricWeight.toLowerCase()} ${base.fabric} drapes cleanly under ${mid.fabric} (${collarHint})`,
  };
}

/**
 * Infers the effective season by respecting explicit weather/season intent written in customPrompt
 * (e.g. typing "something for summer" overrides a default "All-Season" dropdown).
 */
export function inferEffectiveSeason(selectedSeason: SeasonTag, customPrompt?: string): SeasonTag {
  const prompt = (customPrompt || '').trim().toLowerCase();
  if (prompt) {
    if (
      /\b(summer|hot|humid|heatwave|heat|tropical|beach|sweltering|warm\s*weather|sunny|resort|vacation|30\s*c|35\s*c|90\s*f|85\s*f)\b/.test(
        prompt
      )
    ) {
      return 'Summer';
    }
    if (
      /\b(winter|cold|freezing|snow|icy|subzero|bundle\s*up|chilly\s*winter|frost|below\s*zero)\b/.test(
        prompt
      )
    ) {
      return 'Winter';
    }
    if (/\b(autumn|fall\s*(vibe|look|outfit|weather|season)?|crisp\s*fall|cool\s*autumn)\b/.test(prompt)) {
      return 'Autumn';
    }
    if (/\b(spring|mild\s*weather|transitional\s*spring)\b/.test(prompt)) {
      return 'Spring';
    }
  }
  return selectedSeason;
}

/**
 * Strict thermal check: returns true if a garment is thermally unsuitable for hot Summer weather
 * (sweaters, knitwear, hoodies, fleece, wool/cashmere layers, heavy coats, corduroy/flannel, heavyweight fabrics).
 */
export function isSummerUnsuitable(garment: Garment): boolean {
  const text = `${garment.name} ${garment.subCategory} ${garment.fabric} ${garment.texture} ${garment.silhouette}`;

  // Any sweater / knit / cardigan / hoodie / fleece / mid-layer top is unsuitable for Summer
  if (garment.category === 'tops' && classifyTopLayerRole(garment) === 'mid') {
    return true;
  }

  // Heavyweight items are always unsuitable for Summer
  if (garment.fabricWeight === 'Heavyweight') {
    return true;
  }

  // Outerwear in Summer is only viable if explicitly lightweight & breathable (e.g. linen overshirt)
  if (garment.category === 'outerwear') {
    if (garment.fabricWeight !== 'Lightweight') return true;
    if (COLD_WEATHER_GARMENT_REGEX.test(text)) return true;
    const summerTagged = garment.seasons.includes('Summer') || garment.seasons.includes('All-Season');
    return !summerTagged;
  }

  // Cold-weather fabrics/items (wool knit, cashmere, flannel, corduroy, tweed, fleece, shearling, puffer)
  if (COLD_WEATHER_GARMENT_REGEX.test(text)) {
    // Allow lightweight tropical/summer worsted wool trousers if explicitly Lightweight + Summer/All-Season
    const isLightTropicalTrouser =
      garment.category === 'bottoms' &&
      garment.fabricWeight === 'Lightweight' &&
      (garment.seasons.includes('Summer') || garment.seasons.includes('All-Season')) &&
      !/\b(flannel|tweed|corduroy|fleece|velvet|heavy)\b/i.test(text);
    if (!isLightTropicalTrouser) return true;
  }

  // Strictly Autumn/Winter tagged garments with neither Summer nor All-Season
  if (
    garment.seasons.length > 0 &&
    !garment.seasons.includes('Summer') &&
    !garment.seasons.includes('All-Season') &&
    (garment.seasons.includes('Winter') || garment.seasons.includes('Autumn'))
  ) {
    return true;
  }

  return false;
}

/**
 * Strict thermal check: returns true if a garment is unsuitable for cold Winter weather
 * (shorts, tank tops, sleeveless tops, sandals, purely Summer-tagged pieces).
 */
export function isWinterUnsuitable(garment: Garment): boolean {
  const text = `${garment.name} ${garment.subCategory} ${garment.silhouette}`;
  if (SUMMER_ONLY_GARMENT_REGEX.test(text)) {
    return true;
  }
  if (
    garment.seasons.length === 1 &&
    garment.seasons[0] === 'Summer'
  ) {
    return true;
  }
  return false;
}

/**
 * Orders outfit garments in natural dressing order:
 * Base Top -> Mid Layer (Sweater/Cardigan/Vest) -> Outerwear -> Bottom -> Footwear -> Accessory.
 */
export function sortOutfitByDressingOrder(items: Garment[]): Garment[] {
  const rank = (g: Garment): number => {
    if (g.category === 'tops') return classifyTopLayerRole(g) === 'base' ? 1 : 2;
    if (g.category === 'outerwear') return 3;
    if (g.category === 'bottoms') return 4;
    if (g.category === 'footwear') return 5;
    return 6;
  };
  return [...items].sort((a, b) => rank(a) - rank(b));
}

/**
 * Evaluates full-outfit Silhouette Balance (Big-over-Fitted / Rule of Thirds),
 * Multi-Layer Physics (Base under Mid under Outer), and Tactile Material Matrix (0-100).
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

  const tops = items.filter((i) => i.category === 'tops');
  const baseTop = tops.find((t) => classifyTopLayerRole(t) === 'base') ?? tops[0];
  const midLayer = tops.find((t) => classifyTopLayerRole(t) === 'mid');
  const bottom = items.find((i) => i.category === 'bottoms');
  const outer = items.find((i) => i.category === 'outerwear');
  const footwear = items.find((i) => i.category === 'footwear');
  const isStreetwear = occasion === 'Streetwear';

  // Dominant upper-body piece for top-to-bottom proportion comparison
  const visibleTop = midLayer ?? baseTop;

  // 1. Top-to-Bottom Volume Balance (Editorial Rule of Proportions)
  if (visibleTop && bottom) {
    const topVol = classifyVolume(visibleTop);
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

  // 2A. Base-under-Mid Layering Physics (Shirt/Tee under Sweater/Cardigan/Vest)
  if (midLayer && baseTop && baseTop.id !== midLayer.id) {
    const baseW = FABRIC_WEIGHT_RANK[baseTop.fabricWeight] ?? 1;
    const midW = FABRIC_WEIGHT_RANK[midLayer.fabricWeight] ?? 2;
    const volOrder: Record<SilhouetteVolume, number> = {
      slim: 1,
      tailored: 2,
      relaxed: 3,
      oversized: 4,
    };
    const baseVolRank = volOrder[classifyVolume(baseTop)];
    const midVolRank = volOrder[classifyVolume(midLayer)];

    if (baseW > midW) {
      score -= 10;
      notes.push('inner shirt is heavier than outer knit layer');
    } else {
      score += 6;
      notes.push('intentional base-under-knit layering');
    }

    if (baseVolRank > midVolRank + 1) {
      score -= 12;
      notes.push('inner base layer is too bulky under slim mid-layer');
    } else if (baseVolRank <= midVolRank) {
      score += 5;
    }

    const baseText = `${baseTop.name} ${baseTop.subCategory} ${baseTop.silhouette}`;
    if (COLLARED_OR_CRISP_BASE_REGEX.test(baseText)) {
      score += 4;
    }
  } else if (midLayer && (!baseTop || baseTop.id === midLayer.id) && requiresUnderlayer(midLayer)) {
    // Bare sweater/cardigan/vest with no underlayer
    score -= 11;
    notes.push('missing a shirt or tee underlayer beneath knitwear');
  }

  // 2B. Outerwear Weight Physics: Outerwear weight >= inner top/mid weight
  const innerRef = midLayer ?? baseTop;
  if (innerRef && outer) {
    const innerW = FABRIC_WEIGHT_RANK[innerRef.fabricWeight] ?? 2;
    const outerW = FABRIC_WEIGHT_RANK[outer.fabricWeight] ?? 2;
    if (outerW < innerW) {
      score -= 10;
      notes.push('outer layer is lighter than inner layer');
    } else if (outerW > innerW) {
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

function isWarmWeatherAiryPiece(garment: Garment): boolean {
  const hasWarmSeason =
    garment.seasons.includes('Summer') || garment.seasons.includes('Spring');
  const hasColdSeason =
    garment.seasons.includes('Winter') || garment.seasons.includes('Autumn');
  return garment.fabricWeight === 'Lightweight' && hasWarmSeason && !hasColdSeason;
}

export function scorePairCompatibility(
  itemA: Garment,
  itemB: Garment,
  vecA?: number[],
  vecB?: number[]
): { score: number; vectorSimilarity: number; colorHarmony: number; reason: string } {
  const colorHarmony = computeColorHarmony(itemA.colorHex, itemB.colorHex);
  const oklchA = hexToOklch(itemA.colorHex);
  const oklchB = hexToOklch(itemB.colorHex);

  const formalityDiff = Math.abs(itemA.formality - itemB.formality);
  const formalityScore = Math.max(35, 100 - formalityDiff * 11);

  const explicitSharedSeasons = itemA.seasons.filter(
    (s) => s !== 'All-Season' && itemB.seasons.includes(s)
  );
  const sharedSeasons = itemA.seasons.filter(
    (s) =>
      itemB.seasons.includes(s) ||
      itemA.seasons.includes('All-Season') ||
      itemB.seasons.includes('All-Season')
  );
  const seasonScore =
    explicitSharedSeasons.length > 0 ? 96 : sharedSeasons.length > 0 ? 86 : 58;

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

  // Seasonal & fabric-weight realism adjustment
  const wA = FABRIC_WEIGHT_RANK[itemA.fabricWeight] ?? 2;
  const wB = FABRIC_WEIGHT_RANK[itemB.fabricWeight] ?? 2;
  const isOuterwearLayering =
    itemA.category === 'outerwear' || itemB.category === 'outerwear';
  let thermalWeightDelta = 0;

  if (!isOuterwearLayering && Math.abs(wA - wB) >= 2) {
    // e.g. Lightweight summer poplin shirt paired with Heavyweight raw denim or heavy winter wool
    thermalWeightDelta -= 8;
  }

  const aWarmAiry = isWarmWeatherAiryPiece(itemA);
  const bWarmAiry = isWarmWeatherAiryPiece(itemB);
  if (aWarmAiry !== bWarmAiry) {
    const airy = aWarmAiry ? itemA : itemB;
    const partner = aWarmAiry ? itemB : itemA;
    const partnerOklch = aWarmAiry ? oklchB : oklchA;
    const airyOklch = aWarmAiry ? oklchA : oklchB;

    if (isSummerUnsuitable(partner)) {
      thermalWeightDelta -= 12;
    } else if (
      isLightPastel(airyOklch) &&
      partnerOklch.L < 0.36 &&
      partner.fabricWeight !== 'Lightweight'
    ) {
      // Heavy dark black/raw indigo bottoms visually weigh down airy Spring/Summer pastel shirts
      thermalWeightDelta -= 6;
    } else if (
      isLightPastel(airyOklch) &&
      partnerOklch.L >= 0.68 &&
      partner.fabricWeight !== 'Heavyweight'
    ) {
      // Crisp light neutral / light-wash warm-weather partner
      thermalWeightDelta += 4;
    }
  } else if (aWarmAiry && bWarmAiry) {
    thermalWeightDelta += 4;
  }

  const rawScore =
    colorHarmony * 0.34 +
    vectorSimilarity * 0.24 +
    formalityScore * 0.22 +
    seasonScore * 0.12 +
    patternScore * 0.08 +
    matDelta * 0.6 +
    thermalWeightDelta;

  const score = Math.min(97, Math.max(40, Math.round(rawScore)));

  const reasons: string[] = [];
  if (colorHarmony >= 91 && oklchA.L >= 0.66 && oklchB.L >= 0.66) {
    reasons.push('crisp light tonal harmony');
  } else if (colorHarmony >= 88) {
    reasons.push(
      `balanced ${itemA.primaryColor.toLowerCase()} & ${itemB.primaryColor.toLowerCase()} pairing`
    );
  } else if (colorHarmony < 82) {
    reasons.push(
      `high-contrast ${itemA.primaryColor.toLowerCase()} & ${itemB.primaryColor.toLowerCase()} anchor`
    );
  }

  if (aWarmAiry && bWarmAiry) {
    reasons.push('matching lightweight season');
  } else if (thermalWeightDelta <= -8) {
    reasons.push('heavier fabric contrast');
  } else if (matDelta >= 5) {
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

function scoreAestheticAlignment(garment: Garment, aesthetics: string[]): number {
  if (!aesthetics || aesthetics.length === 0) return 0;
  const text = `${garment.name} ${garment.subCategory} ${garment.fabric} ${garment.fit} ${garment.silhouette} ${garment.pattern}`.toLowerCase();
  const vol = classifyVolume(garment);
  const oklch = hexToOklch(garment.colorHex);
  const neutralOrEarth = isPerceptualNeutral(oklch) || isEarthNeutral(oklch);
  let bestDelta = 0;

  for (const raw of aesthetics) {
    const a = raw.toLowerCase();
    let d = 0;
    if (a.includes('quiet luxury') || a.includes('old money') || a.includes('heritage')) {
      if (neutralOrEarth && garment.formality >= 5 && /\b(wool|cashmere|merino|linen|silk|calfskin|suede|cotton|twill|oxford|loafer|trouser|blazer|overcoat)\b/.test(text)) d += 6;
      else if (/\b(graphic|neon|distressed|ripped|mesh)\b/.test(text)) d -= 5;
    } else if (a.includes('tailor') || a.includes('ivy') || a.includes('preppy') || a.includes('smart casual')) {
      if (garment.formality >= 5 && (vol === 'tailored' || vol === 'slim' || /\b(oxford|blazer|chino|trouser|loafer|polo|cardigan|knit)\b/.test(text))) d += 6;
    } else if (a.includes('streetwear')) {
      if (garment.formality <= 6 && (vol === 'oversized' || vol === 'relaxed' || /\b(hoodie|sneaker|denim|cargo|bomber|tee|sweatshirt|wide|boxy)\b/.test(text))) d += 6;
    } else if (a.includes('minimal') || a.includes('scandi')) {
      if (neutralOrEarth && garment.pattern.toLowerCase().includes('solid')) d += 6;
    } else if (a.includes('dark academia')) {
      if (oklch.L <= 0.55 && /\b(wool|tweed|corduroy|oxford|knit|loafer|blazer|trouser|cardigan|plaid|herringbone)\b/.test(text)) d += 6;
    } else if (a.includes('workwear') || a.includes('utilitarian')) {
      if (/\b(denim|canvas|twill|chore|chino|heavy|boot|flannel|corduroy|cargo|overshirt|cotton)\b/.test(text)) d += 6;
    } else if (a.includes('mediterranean') || a.includes('resort') || a.includes('bohemian')) {
      if (/\b(linen|cotton|camp|relaxed|flowy|draped|loafer|espadrille|knitted\s*polo|ivory|cream|sand|olive|terracotta)\b/.test(text)) d += 6;
    } else if (a.includes('techwear') || a.includes('gorpcore') || a.includes('athleisure') || a.includes('sporty')) {
      if (/\b(nylon|technical|shell|fleece|zip|sneaker|runner|jogger|track|stretch|jersey|hoodie)\b/.test(text)) d += 6;
    } else if (a.includes('rock') || a.includes('edgy') || a.includes('avant-garde')) {
      if (oklch.L <= 0.35 || /\b(leather|black|boot|denim|structured|draped|asymmetrical|silver)\b/.test(text)) d += 6;
    } else if (a.includes('vintage') || a.includes('retro')) {
      if (/\b(denim|corduroy|suede|pleated|camp|knit|polo|bomber|leather|loafer)\b/.test(text)) d += 5;
    }
    if (d > bestDelta) bestDelta = d;
  }

  return bestDelta;
}

/**
 * Scores how flattering a single garment is for THIS specific person (0-100) based on
 * skin undertone, 12-season AI Portrait Color Blueprint (both name & perceptual OKLCH hex matching),
 * preferred fits, style aesthetics, ideal silhouettes, and recommended fabrics.
 */
export function scoreGarmentForPerson(garment: Garment, profile?: UserProfile | null): number {
  if (!profile) return 75;

  let score = 71;

  // 1. Skin undertone vs. garment undertone alignment
  const skin = profile.skinUndertone;
  if (skin === 'Warm' || skin === 'Warm Olive') {
    if (garment.undertone === 'Warm') score += 9;
    else if (garment.undertone === 'Neutral') score += 5;
    else score -= 5;
  } else if (skin === 'Cool' || skin === 'Cool Olive') {
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
  const preferredFits = Array.isArray(profile.preferredFits) ? profile.preferredFits : [];
  if (
    preferredFits.some((f) => {
      const words = f.toLowerCase().split(/[\s/]+/).filter((w) => w.length >= 3);
      return words.some((w) => fitText.includes(w));
    })
  ) {
    score += 7;
  }

  // 2B. Style aesthetics alignment
  score += scoreAestheticAlignment(
    garment,
    Array.isArray(profile.styleAesthetics) ? profile.styleAesthetics : []
  );

  // 3. AI Portrait Styling Blueprint deep personalization (12-season colors + OKLCH hex distance + silhouettes + fabrics)
  const bp = profile.blueprint;
  if (bp) {
    const colorText = `${garment.primaryColor} ${(garment.secondaryColors || []).join(' ')}`.toLowerCase();
    const fabricText = `${garment.fabric} ${garment.texture}`.toLowerCase();
    const oklch = hexToOklch(garment.colorHex);
    const bestColors = Array.isArray(bp.bestColors) ? bp.bestColors : [];
    const avoidColors = Array.isArray(bp.avoidColors) ? bp.avoidColors : [];

    const matchesBestColorName = bestColors.some((c) => {
      const words = c.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
      return words.some((w) => colorText.includes(w));
    });
    const matchesAvoidColorName = avoidColors.some((c) => {
      const words = c.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
      return words.some((w) => colorText.includes(w));
    });

    // Perceptual OKLCH Delta-E against portrait-derived best/avoid hex swatches
    let matchesBestHex = false;
    let matchesAvoidHex = false;
    if (Array.isArray(bp.bestColorHexes) && bp.bestColorHexes.length > 0) {
      const validHexes = bp.bestColorHexes.filter((h) => /^#[0-9A-Fa-f]{6}$/.test(h));
      if (validHexes.some((h) => oklchDeltaE(oklch, hexToOklch(h)) <= 0.16)) {
        matchesBestHex = true;
      }
    }
    if (Array.isArray(bp.avoidColorHexes) && bp.avoidColorHexes.length > 0) {
      const validHexes = bp.avoidColorHexes.filter((h) => /^#[0-9A-Fa-f]{6}$/.test(h));
      if (validHexes.some((h) => oklchDeltaE(oklch, hexToOklch(h)) <= 0.14)) {
        matchesAvoidHex = true;
      }
    }

    if (matchesBestColorName || matchesBestHex) {
      score += matchesBestColorName && matchesBestHex ? 15 : 13;
    }
    if (matchesAvoidColorName || matchesAvoidHex) {
      score -= 17;
    }

    // 12-Season chroma/depth alignment via OKLCH
    const seasonLower = (bp.colorSeason || '').toLowerCase();
    if (seasonLower.includes('deep') || seasonLower.includes('dark')) {
      if (oklch.L <= 0.55) score += 3;
      else if (oklch.L >= 0.85 && oklch.C > 0.08) score -= 3;
    } else if (seasonLower.includes('soft') || seasonLower.includes('muted')) {
      if (oklch.C <= 0.13) score += 3;
      else if (oklch.C >= 0.21) score -= 4;
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

  return Math.max(36, Math.min(99, Math.round(score)));
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
      // Keep direct pair compatibility dominant so personalFit never inflates a mismatched dark/heavy companion to 96%
      const blendedScore = profile
        ? Math.min(97, Math.round(res.score * 0.72 + propScore * 0.14 + personalFit * 0.14))
        : Math.min(97, Math.round(res.score * 0.84 + propScore * 0.16));
      return {
        garmentId: other.id,
        score: blendedScore,
        vectorSimilarity: res.vectorSimilarity,
        colorHarmony: res.colorHarmony,
        reason:
          profile && personalFit >= 86 && res.colorHarmony >= 85
            ? `${res.reason} · flatters your palette`
            : res.reason,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export interface CrossVerifiedGuidance {
  primaryGuidance: string;
  closetGapNote: string | null;
}

const LIGHT_PRESCRIPTION_REGEX =
  /\b(white|ivory|cream|ecru|off[- ]?white|stone|beige|sand|khaki|pale|light[- ]?wash|light[- ]?colored?|light\s+(chinos?|trousers?|pants?|denim|jeans))\b/i;

const DARK_PRESCRIPTION_REGEX =
  /\b(black|charcoal|dark[- ]?wash|dark\s+(denim|jeans|trousers?|chinos?|pants?)|raw\s+indigo|midnight\s+navy)\b/i;

function isLightColoredGarment(g: Garment): boolean {
  const l = hexToOklch(g.colorHex).L;
  if (l >= 0.68) return true;
  return /\b(white|ivory|cream|ecru|stone|beige|sand|light[- ]?wash|off[- ]?white|khaki|oat|bone)\b/i.test(
    `${g.primaryColor} ${g.name}`
  );
}

function isDarkColoredGarment(g: Garment): boolean {
  const l = hexToOklch(g.colorHex).L;
  if (l <= 0.36) return true;
  return /\b(black|charcoal|dark|raw\s+indigo|jet|obsidian|midnight)\b/i.test(
    `${g.primaryColor} ${g.name}`
  );
}

/**
 * Cross-verifies a garment's Styling Guidance against its actual Best Pairings and the user's
 * real owned wardrobe so the Inspector NEVER tells the user to wear "white chinos" while
 * recommending "Faded Black Denim" right underneath without reconciling the two.
 */
export function buildCrossVerifiedStylingGuidance(
  garment: Garment,
  companions: CompanionMatch[],
  allGarments: Garment[]
): CrossVerifiedGuidance {
  const canonicalRole = getCanonicalLayerRole(garment);
  const rawNotes = (garment.stylingNotes || '').trim();

  const resolvedCompanions = companions
    .map((m) => ({
      match: m,
      item: allGarments.find((g) => g.id === m.garmentId) ?? null,
    }))
    .filter((entry): entry is { match: CompanionMatch; item: Garment } => Boolean(entry.item));

  const topItems = resolvedCompanions.map((r) => r.item);
  const topNames = topItems.slice(0, 2).map((i) => i.name);

  if (topItems.length === 0) {
    return {
      primaryGuidance:
        rawNotes ||
        `Wear as a ${canonicalRole.toLowerCase()} piece for ${garment.seasons.join(' / ')} ${garment.occasions[0]?.toLowerCase() || 'everyday'} outfits.`,
      closetGapNote: null,
    };
  }

  const notesPrescribeLight = LIGHT_PRESCRIPTION_REGEX.test(rawNotes);
  const notesPrescribeDark = DARK_PRESCRIPTION_REGEX.test(rawNotes);
  const hasLightInTop = topItems.some(isLightColoredGarment);
  const hasDarkInTop = topItems.some(isDarkColoredGarment);

  // Detect real contradiction: upload-time notes prescribe light bottoms/companions,
  // while top matched owned pairings are darker/earth pieces because light bottoms aren't in the closet
  const lightContradiction = notesPrescribeLight && !hasLightInTop;
  const darkContradiction = notesPrescribeDark && !hasDarkInTop && hasLightInTop;

  const targetOklch = hexToOklch(garment.colorHex);
  const airyPastelTop =
    garment.category === 'tops' &&
    isLightPastel(targetOklch) &&
    isWarmWeatherAiryPiece(garment);
  const ownedLightBottoms = allGarments.filter(
    (g) => g.category === 'bottoms' && isLightColoredGarment(g)
  );

  // Mid-layer sweater/cardigan/hoodie underlayer cross-check
  const isMidLayerTop = garment.category === 'tops' && canonicalRole === 'Mid';
  const ownedBaseTops = allGarments.filter(
    (g) => g.category === 'tops' && g.id !== garment.id && classifyTopLayerRole(g) === 'base'
  );

  if (isMidLayerTop) {
    const compatibleBases = ownedBaseTops
      .map((base) => ({ base, eval: evaluateBaseUnderMidCompatibility(base, garment) }))
      .filter((entry) => entry.eval.compatible)
      .sort((a, b) => b.eval.score - a.eval.score);

    if (compatibleBases.length > 0) {
      const bestBase = compatibleBases[0].base.name;
      const companionTail =
        topNames.length > 0 ? ` and finish with ${topNames.join(' or ')}` : '';
      return {
        primaryGuidance: `Layer as a Mid piece over your ${bestBase}${companionTail}.`,
        closetGapNote: null,
      };
    }

    return {
      primaryGuidance: `Wear as a Mid layer${topNames.length > 0 ? ` alongside your ${topNames.join(' or ')}` : ''}.`,
      closetGapNote:
        'Underlayer gap: You do not have a compatible lightweight base shirt or tee uploaded yet to wear underneath this knit.',
    };
  }

  if (lightContradiction || (airyPastelTop && ownedLightBottoms.length === 0)) {
    const seasonPhrase = garment.seasons.slice(0, 2).join('/');
    const pairPhrase =
      topNames.length >= 2
        ? `${topNames[0]} or ${topNames[1]}`
        : topNames[0];
    const stylingTip =
      garment.category === 'tops'
        ? ' Roll cuffs slightly or keep the front untucked/half-tucked to keep the lighter top balanced against deeper bottoms.'
        : '';

    return {
      primaryGuidance: `Wear as a ${canonicalRole} layer in ${seasonPhrase}. From your current wardrobe, your strongest pairings are ${pairPhrase}.${stylingTip}`,
      closetGapNote:
        'Closet gap: You do not have white/stone chinos or light-wash denim uploaded yet—adding a light neutral bottom would unlock an even crisper warm-weather pairing.',
    };
  }

  if (darkContradiction) {
    const pairPhrase =
      topNames.length >= 2
        ? `${topNames[0]} or ${topNames[1]}`
        : topNames[0];
    return {
      primaryGuidance: `Wear as a ${canonicalRole} piece; from your current closet, it pairs most naturally with your ${pairPhrase}.`,
      closetGapNote:
        'Closet gap: Adding dark charcoal trousers or dark-wash denim would also give this piece a sharper high-contrast anchor.',
    };
  }

  // No contradiction: keep crisp garment note and anchor it to actual top owned pairings if note is generic
  const mentionsOwnedName = topItems.some((item) =>
    rawNotes.toLowerCase().includes(item.primaryColor.toLowerCase())
  );
  if (rawNotes && (!notesPrescribeLight || hasLightInTop) && (!notesPrescribeDark || hasDarkInTop)) {
    if (mentionsOwnedName) {
      return { primaryGuidance: rawNotes, closetGapNote: null };
    }
    const pairPhrase =
      topNames.length >= 2 ? `${topNames[0]} or ${topNames[1]}` : topNames[0];
    return {
      primaryGuidance: `${rawNotes} From your closet, best paired with your ${pairPhrase}.`,
      closetGapNote: null,
    };
  }

  const pairPhrase =
    topNames.length >= 2 ? `${topNames[0]} or ${topNames[1]}` : topNames[0];
  return {
    primaryGuidance: `Wear as a ${canonicalRole} piece in ${garment.seasons.slice(0, 2).join('/')}, paired from your closet with ${pairPhrase}.`,
    closetGapNote: null,
  };
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
  effectiveSeason: SeasonTag;
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
  if (/\b(light|breathable|breezy|hot|humid|warm\s*weather|summer|beach|sunny|resort)\b/.test(rawPrompt)) {
    if (garment.fabricWeight === 'Lightweight') boost += 4;
    if (isSummerUnsuitable(garment)) boost -= 14;
  }
  if (/\b(cozy|layer|layered|cold|rainy|chilly|freezing|winter|snow)\b/.test(rawPrompt)) {
    if (garment.fabricWeight === 'Heavyweight' || garment.category === 'outerwear' || classifyTopLayerRole(garment) === 'mid') {
      boost += 3;
    }
    if (garment.fabricWeight === 'Lightweight' && garment.category === 'outerwear') boost -= 2;
  }
  if (/\b(minimal|clean|quiet\s*luxury|monochrome|tonal|classic|old\s*money)\b/.test(rawPrompt)) {
    if (garment.pattern.toLowerCase().includes('solid')) boost += 1.5;
    if (isPerceptualNeutral(hexToOklch(garment.colorHex)) || isEarthNeutral(hexToOklch(garment.colorHex))) {
      boost += 1.5;
    }
  }
  if (/\b(bold|statement|pop\s*of\s*color|vibrant|colorful|stand\s*out)\b/.test(rawPrompt)) {
    if (hexToOklch(garment.colorHex).C >= 0.12) boost += 3;
  }
  if (/\b(oversized|baggy|street|streetwear|edgy)\b/.test(rawPrompt)) {
    if (classifyVolume(garment) === 'oversized' || classifyVolume(garment) === 'relaxed') boost += 2;
  }

  return boost;
}

/**
 * Stage-1 Next-Gen Candidate Retriever:
 * - Infers effective season from both dropdown AND natural-language prompt ("summer", "hot", "winter")
 * - Hard-filters thermally inappropriate pieces (NEVER sweaters/wool coats in Summer!)
 * - Generates REAL multi-layer outfits (Base shirt/tee UNDER sweater/cardigan/hoodie/vest + Outer + Bottom + Footwear)
 * - Never leaves a cardigan/sweater bare without a base shirt when base tops exist
 * - Selects diverse finalists via Maximal Marginal Relevance (MMR)
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
    previousCombinations?: OutfitCombination[];
    explorationMode?: 'best' | 'fresh';
    rotationSeed?: number;
    maxCandidates?: number;
  } = {}
): CandidateCombination[] {
  const {
    occasion,
    season = 'All-Season',
    anchorItemId,
    customPrompt = '',
    profile,
    savedOutfits = [],
    previousCombinations = [],
    explorationMode = 'best',
    rotationSeed = 0,
    maxCandidates = 10,
  } = options;

  const cleanPrompt = customPrompt.trim().toLowerCase();
  const effectiveSeason = inferEffectiveSeason(season, cleanPrompt);

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
  const avoidSweaters = /\b(no|without)\s+(sweater|sweaters|knit|knitwear|hoodie|cardigan|layers?)\b/.test(cleanPrompt);
  const avoidSneakers = /\b(no|without)\s+(sneakers?|trainers?|runners?)\b/.test(cleanPrompt);
  const avoidDenim = /\b(no|without)\s+(jeans?|denim)\b/.test(cleanPrompt);
  const wantLayers =
    !avoidSweaters &&
    /\b(layer|layered|layering|underlayer|shirt\s*under|over\s*a\s*shirt|sweater|cardigan|pullover|hoodie|vest|knitwear)\b/.test(
      cleanPrompt
    );
  const preferMonochrome = /\b(monochrome|all[- ]black|all[- ]white|tonal)\b/.test(cleanPrompt);

  const tasteCentroid = computeTasteCentroid(items, vectors, savedOutfits);
  const savedKeys = new Set(
    savedOutfits.map((o) => [...o.itemIds].sort().join('|'))
  );
  const prevComboKeys = new Set(
    previousCombinations.map((o) => [...o.itemIds].sort().join('|'))
  );
  const prevItemCounts = new Map<string, number>();
  for (const prev of previousCombinations) {
    for (const id of prev.itemIds) {
      prevItemCounts.set(id, (prevItemCounts.get(id) ?? 0) + 1);
    }
  }
  const hashRotation = (id: string): number => {
    const s = `${rotationSeed}:${cleanPrompt.slice(0, 24)}:${id}`;
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 1000) / 1000;
  };

  const anchoredGarment = anchorItemId ? items.find((i) => i.id === anchorItemId) : undefined;

  // Split tops into real dressing roles: Base (shirts/tees/polos) vs Mid-Layer (sweaters/cardigans/vests/hoodies)
  const allTops = items.filter((i) => i.category === 'tops');
  let baseTops = allTops.filter((t) => classifyTopLayerRole(t) === 'base');
  let midLayers = allTops.filter((t) => classifyTopLayerRole(t) === 'mid');
  let bottoms = items.filter((i) => i.category === 'bottoms');
  let outerwear = items.filter((i) => i.category === 'outerwear');
  let footwear = items.filter((i) => i.category === 'footwear');
  const accessories = items.filter((i) => i.category === 'accessories');

  // Strict seasonal thermal filtering (preserving anchored piece if user explicitly picked it)
  if (effectiveSeason === 'Summer') {
    const summerBaseTops = baseTops.filter((g) => g.id === anchorItemId || !isSummerUnsuitable(g));
    if (summerBaseTops.length > 0) baseTops = summerBaseTops;

    // NEVER stack sweaters/hoodies/knits in Summer unless explicitly anchored by the user
    midLayers = midLayers.filter((g) => g.id === anchorItemId);

    const summerBottoms = bottoms.filter((g) => g.id === anchorItemId || !isSummerUnsuitable(g));
    if (summerBottoms.length > 0) bottoms = summerBottoms;

    // Only keep lightweight breathable summer outerwear (e.g. linen overshirt) or anchored piece
    outerwear = outerwear.filter((g) => g.id === anchorItemId || !isSummerUnsuitable(g));

    const summerFootwear = footwear.filter((g) => g.id === anchorItemId || !isSummerUnsuitable(g));
    if (summerFootwear.length > 0) footwear = summerFootwear;
  } else if (effectiveSeason === 'Winter') {
    const winterBaseTops = baseTops.filter((g) => g.id === anchorItemId || !isWinterUnsuitable(g));
    if (winterBaseTops.length > 0) baseTops = winterBaseTops;

    const winterBottoms = bottoms.filter((g) => g.id === anchorItemId || !isWinterUnsuitable(g));
    if (winterBottoms.length > 0) bottoms = winterBottoms;

    const winterFootwear = footwear.filter((g) => g.id === anchorItemId || !isWinterUnsuitable(g));
    if (winterFootwear.length > 0) footwear = winterFootwear;
  }

  if (avoidSweaters) {
    midLayers = midLayers.filter((g) => g.id === anchorItemId);
  }
  if (avoidDenim) {
    const nonDenimBottoms = bottoms.filter(
      (b) => b.id === anchorItemId || !/\b(denim|jeans?)\b/i.test(`${b.name} ${b.fabric} ${b.subCategory}`)
    );
    if (nonDenimBottoms.length > 0) bottoms = nonDenimBottoms;
  }
  if (avoidSneakers) {
    const nonSneakers = footwear.filter(
      (f) => f.id === anchorItemId || !/\b(sneakers?|trainers?|runners?)\b/i.test(`${f.name} ${f.subCategory}`)
    );
    if (nonSneakers.length > 0) footwear = nonSneakers;
  }

  // Fallback: if closet has ONLY mid-layers and zero base tops (rare), allow mid-layers as fallback
  if ((baseTops.length === 0 && midLayers.length === 0) || bottoms.length === 0) {
    return [];
  }

  /**
   * Stratified slot selection:
   * Takes top context/personal performers (60% of cap) PLUS least-recently-exposed garments (40% of cap)
   * so large 40-100+ item closets rotate through EVERY garment instead of locking onto the same 5-6 items!
   */
  const rankSlotByContext = (list: Garment[], cap: number): Garment[] => {
    if (list.length <= cap) return list;
    const scoreItem = (g: Garment, includeRotationJitter: boolean) => {
      let s = scoreGarmentPromptRelevance(g, promptTokens, cleanPrompt);
      if (profile) s += (scoreGarmentForPerson(g, profile) - 70) * 0.35;
      if (occasion && g.occasions.includes(occasion)) s += 3.5;
      if (
        effectiveSeason !== 'All-Season' &&
        (g.seasons.includes(effectiveSeason) || g.seasons.includes('All-Season'))
      ) {
        s += 3;
      }
      if (explorationMode === 'fresh' && g.wearCount === 0) s += 3.5;
      // Apply previous-batch rotation cooldown so consecutive generations surface fresh garments
      const prevHits = prevItemCounts.get(g.id) ?? 0;
      if (prevHits > 0 && g.id !== anchorItemId) {
        s -= explorationMode === 'fresh' ? prevHits * 14 : prevHits * 9;
      }
      if (includeRotationJitter) {
        s += (hashRotation(g.id) - 0.5) * (explorationMode === 'fresh' ? 9 : 5);
      }
      return s;
    };

    const primaryCount = prevItemCounts.size > 0 ? Math.ceil(cap * 0.5) : Math.ceil(cap * 0.6);
    const byQuality = [...list].sort((a, b) => scoreItem(b, true) - scoreItem(a, true));
    const chosen = byQuality.slice(0, primaryCount);
    const chosenIds = new Set(chosen.map((g) => g.id));

    // Reserve remaining slot pool for under-exposed / unshown items across the rest of the closet
    const remaining = list
      .filter((g) => !chosenIds.has(g.id))
      .sort((a, b) => {
        const aPrev = prevItemCounts.get(a.id) ?? 0;
        const bPrev = prevItemCounts.get(b.id) ?? 0;
        if (aPrev !== bPrev) return aPrev - bPrev;
        const aScore = scoreItem(a, true) + (a.wearCount === 0 ? 3 : 0);
        const bScore = scoreItem(b, true) + (b.wearCount === 0 ? 3 : 0);
        return bScore - aScore;
      })
      .slice(0, cap - chosen.length);

    return [...chosen, ...remaining];
  };

  // Pre-filter anchored slot before enumeration
  const anchoredTopRole =
    anchoredGarment?.category === 'tops' ? classifyTopLayerRole(anchoredGarment) : null;

  if (anchoredGarment) {
    if (anchoredGarment.category === 'tops' && anchoredTopRole === 'base') {
      baseTops = [anchoredGarment];
    } else if (anchoredGarment.category === 'tops' && anchoredTopRole === 'mid') {
      midLayers = [anchoredGarment];
    } else if (anchoredGarment.category === 'bottoms') {
      bottoms = [anchoredGarment];
    } else if (anchoredGarment.category === 'outerwear') {
      outerwear = [anchoredGarment];
    } else if (anchoredGarment.category === 'footwear') {
      footwear = [anchoredGarment];
    }
  }

  // Build valid Upper-Body Stacks with wider full-closet coverage:
  // 1. Standalone Base Top: [base] (shirts, tees, polos — great for Summer, Spring, smart casual)
  // 2. Layered Base + Mid: [base, mid] (shirt/tee UNDER sweater/cardigan/vest/hoodie — real layering!)
  // 3. Standalone Mid ONLY if the user has zero base tops in their entire closet OR thin standalone turtleneck
  const cappedBase = rankSlotByContext(baseTops, 14);
  const cappedMid = rankSlotByContext(midLayers, 8);
  const cappedBottoms = rankSlotByContext(bottoms, 11);
  const cappedOuter = rankSlotByContext(outerwear, 6);
  const cappedShoes = rankSlotByContext(footwear, 6);
  const cappedAccessories = rankSlotByContext(accessories, 6);

  // Pre-compute vectors once for all capped garments to keep 44+ item scoring super fast (<100ms)
  const resolvedVectors: Record<string, number[]> = { ...vectors };
  for (const g of [
    ...cappedBase,
    ...cappedMid,
    ...cappedBottoms,
    ...cappedOuter,
    ...cappedShoes,
    ...cappedAccessories,
  ]) {
    if (!resolvedVectors[g.id]) {
      resolvedVectors[g.id] = computeDeterministicVector(g);
    }
  }

  const upperStacks: Garment[][] = [];

  // A) Base + Mid layered pairs (when mid-layers exist and not Summer)
  if (cappedBase.length > 0 && cappedMid.length > 0) {
    for (const base of cappedBase) {
      for (const mid of cappedMid) {
        if (base.id === mid.id) continue;
        // Skip physically impossible layering (heavy base under lightweight mid)
        if (FABRIC_WEIGHT_RANK[base.fabricWeight] > FABRIC_WEIGHT_RANK[mid.fabricWeight]) {
          continue;
        }
        upperStacks.push([base, mid]);
      }
    }
  }

  // B) Standalone Base Top stacks (unless user specifically anchored a mid-layer)
  if (anchoredTopRole !== 'mid') {
    for (const base of cappedBase) {
      upperStacks.push([base]);
    }
  }

  // C) Standalone Mid ONLY when closet literally has no base tops or piece is a lightweight turtleneck
  for (const mid of cappedMid) {
    if (cappedBase.length === 0 || !requiresUnderlayer(mid)) {
      upperStacks.push([mid]);
    }
  }

  if (upperStacks.length === 0) {
    return [];
  }

  // Cap upper stacks cleanly while preventing any 1-2 tops from monopolizing all stacks
  const rankedUpperStacks = (() => {
    const stackCap = 26;
    if (upperStacks.length <= stackCap) return upperStacks;
    const scoredStacks = [...upperStacks].sort((a, b) => {
      const evalStack = (stack: Garment[]) => {
        let s = 0;
        for (const g of stack) {
          s += scoreGarmentPromptRelevance(g, promptTokens, cleanPrompt);
          if (profile) s += (scoreGarmentForPerson(g, profile) - 70) * 0.3;
          const prevHits = prevItemCounts.get(g.id) ?? 0;
          if (prevHits > 0 && g.id !== anchorItemId) {
            s -= explorationMode === 'fresh' ? prevHits * 10 : prevHits * 6;
          }
          s += (hashRotation(g.id) - 0.5) * 4;
        }
        if (stack.length === 2) {
          const pair = scorePairCompatibility(
            stack[0],
            stack[1],
            resolvedVectors[stack[0].id],
            resolvedVectors[stack[1].id]
          );
          s += (pair.score - 75) * 0.6;
          if (effectiveSeason === 'Autumn' || effectiveSeason === 'Winter' || wantLayers) {
            s += 6;
          }
        }
        return s;
      };
      return evalStack(b) - evalStack(a);
    });

    const diverseStacks: Garment[][] = [];
    const stackItemUses = new Map<string, number>();
    for (const stack of scoredStacks) {
      if (diverseStacks.length >= stackCap) break;
      const overloaded = stack.some(
        (g) => g.id !== anchorItemId && (stackItemUses.get(g.id) ?? 0) >= 3
      );
      if (overloaded) continue;
      diverseStacks.push(stack);
      for (const g of stack) {
        stackItemUses.set(g.id, (stackItemUses.get(g.id) ?? 0) + 1);
      }
    }
    return diverseStacks.length > 0 ? diverseStacks : scoredStacks.slice(0, stackCap);
  })();

  const candidates: CandidateCombination[] = [];
  const seenKeys = new Set<string>();

  const outerOptions: Array<Garment | null> =
    anchoredGarment?.category === 'outerwear'
      ? [anchoredGarment]
      : avoidOuterwear
        ? [null]
        : effectiveSeason === 'Summer'
          ? wantLayers && cappedOuter.length > 0
            ? [null, cappedOuter[0]]
            : [null]
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

  for (const upperStack of rankedUpperStacks) {
    const primaryUpper = upperStack[upperStack.length - 1];
    const hasMidLayer = upperStack.length >= 2;

    // Pre-select best-matching outerwear & footwear subsets for this upper stack to avoid 40k+ Cartesian blowup
    const localOuterOptions: Array<Garment | null> =
      outerOptions.length <= 3
        ? outerOptions
        : (() => {
            const nonNull = outerOptions.filter((o): o is Garment => o !== null);
            const rankedOuter = [...nonNull].sort((a, b) => {
              const sA =
                scorePairCompatibility(
                  primaryUpper,
                  a,
                  resolvedVectors[primaryUpper.id],
                  resolvedVectors[a.id]
                ).score -
                (a.id !== anchorItemId ? (prevItemCounts.get(a.id) ?? 0) * 6 : 0) +
                (hashRotation(`${primaryUpper.id}:${a.id}`) - 0.5) * 8;
              const sB =
                scorePairCompatibility(
                  primaryUpper,
                  b,
                  resolvedVectors[primaryUpper.id],
                  resolvedVectors[b.id]
                ).score -
                (b.id !== anchorItemId ? (prevItemCounts.get(b.id) ?? 0) * 6 : 0) +
                (hashRotation(`${primaryUpper.id}:${b.id}`) - 0.5) * 8;
              return sB - sA;
            });
            const picked: Array<Garment | null> = rankedOuter.slice(0, 2);
            if (outerOptions.includes(null)) picked.push(null);
            return picked;
          })();

    for (const bottom of cappedBottoms) {
      const localShoeOptions: Array<Garment | null> =
        shoeOptions.length <= 3
          ? shoeOptions
          : (() => {
              const nonNull = shoeOptions.filter((s): s is Garment => s !== null);
              const rankedShoes = [...nonNull].sort((a, b) => {
                const sA =
                  scorePairCompatibility(
                    bottom,
                    a,
                    resolvedVectors[bottom.id],
                    resolvedVectors[a.id]
                  ).score -
                  (a.id !== anchorItemId ? (prevItemCounts.get(a.id) ?? 0) * 6 : 0) +
                  (hashRotation(`${bottom.id}:${a.id}`) - 0.5) * 8;
                const sB =
                  scorePairCompatibility(
                    bottom,
                    b,
                    resolvedVectors[bottom.id],
                    resolvedVectors[b.id]
                  ).score -
                  (b.id !== anchorItemId ? (prevItemCounts.get(b.id) ?? 0) * 6 : 0) +
                  (hashRotation(`${bottom.id}:${b.id}`) - 0.5) * 8;
                return sB - sA;
              });
              return rankedShoes.slice(0, 3);
            })();

      // Pick best accessory once per (upperStack, bottom) pair instead of inside every inner combo
      let bestPairAccessory: Garment | null = null;
      if (anchoredGarment?.category === 'accessories') {
        bestPairAccessory = anchoredGarment;
      } else if (cappedAccessories.length > 0) {
        let bestAccScore = 76;
        for (const acc of cappedAccessories) {
          if (effectiveSeason === 'Summer' && isSummerUnsuitable(acc)) continue;
          const s =
            scorePairCompatibility(
              primaryUpper,
              acc,
              resolvedVectors[primaryUpper.id],
              resolvedVectors[acc.id]
            ).score -
            (prevItemCounts.get(acc.id) ?? 0) * 4 +
            (hashRotation(`${primaryUpper.id}:${bottom.id}:${acc.id}`) - 0.5) * 5;
          if (s > bestAccScore) {
            bestAccScore = s;
            bestPairAccessory = acc;
          }
        }
      }

      for (const outer of localOuterOptions) {
        // Avoid over-stacking in Spring if already wearing Base + Mid + Heavy Coat
        if (
          effectiveSeason === 'Spring' &&
          hasMidLayer &&
          outer &&
          outer.fabricWeight === 'Heavyweight' &&
          outer.id !== anchorItemId
        ) {
          continue;
        }

        for (const shoe of localShoeOptions) {
          const comboItemsRaw = [...upperStack, bottom, outer, shoe, bestPairAccessory].filter(
            (x): x is Garment => x !== null
          );

          if (anchorItemId && !comboItemsRaw.some((c) => c.id === anchorItemId)) {
            continue;
          }

          const comboItems = sortOutfitByDressingOrder(comboItemsRaw);

          const key = comboItems
            .map((c) => c.id)
            .sort()
            .join('|');
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);

          const evalRes = evaluateOutfitLocalHarmony(comboItems, resolvedVectors, profile, {
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

          // Season & real thermal appropriateness
          if (effectiveSeason !== 'All-Season') {
            const seasonHits = comboItems.filter(
              (c) => c.seasons.includes(effectiveSeason) || c.seasons.includes('All-Season')
            ).length;
            bonus += Math.round((seasonHits / comboItems.length) * 5) - 2;

            if (effectiveSeason === 'Summer') {
              const badSummer = comboItems.filter((c) => isSummerUnsuitable(c)).length;
              bonus -= badSummer * 14;
              const lightCount = comboItems.filter((c) => c.fabricWeight === 'Lightweight').length;
              bonus += Math.min(5, lightCount * 2);
            }
          }

          // Reward real multi-layering (Base + Mid, or Base + Outer, or Base + Mid + Outer) in cool weather or when asked
          const layerCount = (hasMidLayer ? 2 : 1) + (outer ? 1 : 0);
          if (wantLayers) {
            bonus += layerCount >= 2 ? 7 : -4;
          } else if (effectiveSeason === 'Winter') {
            bonus += layerCount >= 3 ? 6 : layerCount === 2 ? 4 : -4;
          } else if (effectiveSeason === 'Autumn') {
            bonus += layerCount >= 2 ? 5 : -2;
          } else if (effectiveSeason === 'All-Season' && hasMidLayer) {
            // Reward real shirt-under-sweater layering over bare tops
            bonus += 3;
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

          // Closet rotation, previous-batch cooldown & freshness score
          const avgWear =
            comboItems.reduce((acc, g) => acc + g.wearCount, 0) / comboItems.length;
          const isAlreadySaved = savedKeys.has(key);
          const isExactPrevRepeat = prevComboKeys.has(key);
          let freshnessScore = Math.max(55, Math.min(98, Math.round(92 - avgWear * 5)));
          if (isAlreadySaved) freshnessScore = Math.max(45, freshnessScore - 18);
          if (isExactPrevRepeat) freshnessScore = Math.max(40, freshnessScore - 22);

          // Rotate decisively away from garments shown in the immediately preceding batch
          let prevExposureHits = 0;
          for (const g of comboItems) {
            if (g.id !== anchorItemId && (prevItemCounts.get(g.id) ?? 0) > 0) {
              prevExposureHits += 1;
            }
          }
          if (prevExposureHits > 0) {
            const perItemPenalty = explorationMode === 'fresh' ? 7 : 4.5;
            bonus -= Math.min(22, Math.round(prevExposureHits * perItemPenalty));
          }
          if (isExactPrevRepeat) {
            bonus -= explorationMode === 'fresh' ? 16 : 10;
          }

          if (explorationMode === 'fresh') {
            bonus += Math.round((freshnessScore - 75) * 0.28);
            if (isAlreadySaved) bonus -= 6;
          } else if (isAlreadySaved) {
            bonus -= 3;
          }

          // Formality spread penalty
          bonus -= Math.max(0, evalRes.formalitySpread - 2);

          candidates.push({
            itemIds: comboItems.map((c) => c.id),
            items: comboItems,
            localScore: Math.max(48, Math.min(98, evalRes.overallScore + bonus)),
            vectorScore: evalRes.vectorScore,
            colorScore: evalRes.colorScore,
            proportionScore: evalRes.proportionScore,
            personalScore: evalRes.personalScore,
            freshnessScore,
            paletteSummary: evalRes.paletteSummary,
            effectiveSeason,
          });
        }
      }
    }
  }

  candidates.sort((a, b) => b.localScore - a.localScore);

  // Global-Exposure-Aware MMR Selection:
  // Balances outfit quality with BOTH pairwise novelty AND a global per-item exposure cap
  // so 5-10 ranked outfits showcase 15-25+ distinct garments instead of recycling the same 5-6 items!
  const pool = candidates.slice(0, Math.min(candidates.length, 320));
  const selected: CandidateCombination[] = [];
  const globalItemExposure = new Map<string, number>();
  const lambda = explorationMode === 'fresh' ? 0.56 : 0.66;

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
        const effectiveSim =
          anchorItemId && setA.has(anchorItemId) && setB.has(anchorItemId)
            ? Math.max(0, (inter - 1) / Math.max(1, union - 1))
            : jaccard;
        if (effectiveSim > maxJaccard) maxJaccard = effectiveSim;
      }

      // Global exposure pressure: strongly discourage any single top/bottom/shoe from dominating every look
      let exposurePenalty = 0;
      let freshItemBonus = 0;
      let prevBatchPenalty = 0;
      for (const id of cand.itemIds) {
        if (id === anchorItemId) continue;
        const usedCount = globalItemExposure.get(id) ?? 0;
        if (usedCount === 0) {
          freshItemBonus += 0.045;
        } else if (usedCount === 1) {
          exposurePenalty += 0.08;
        } else {
          // Hard pressure against appearing 3+ times across the finalist slate
          exposurePenalty += 0.18 * usedCount;
        }

        if (prevItemCounts.size > 0) {
          const prevHits = prevItemCounts.get(id) ?? 0;
          if (prevHits > 0) {
            prevBatchPenalty += explorationMode === 'fresh' ? 0.12 : 0.075;
          } else {
            freshItemBonus += 0.025;
          }
        }
      }

      const normRel = cand.localScore / 100;
      const mmr =
        lambda * normRel -
        (1 - lambda) * maxJaccard -
        exposurePenalty -
        prevBatchPenalty +
        Math.min(0.2, freshItemBonus);
      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestIdx = i;
      }
    }

    const winner = pool.splice(bestIdx, 1)[0];
    selected.push(winner);
    for (const id of winner.itemIds) {
      globalItemExposure.set(id, (globalItemExposure.get(id) ?? 0) + 1);
    }
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
    `Personal Blueprint Alignment Avg: ${blueprintAlignmentAvg}/100 | Saved Looks: ${savedOutfits.length} | Unworn Pieces: ${unworn.length}/${garments.length}`,
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
      reason: `Ideal for ${(profile.climate || 'seasonal').toLowerCase()} transitions and weight-stepped layering.`,
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
