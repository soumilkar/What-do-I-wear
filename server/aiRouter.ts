import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  STYLE_AESTHETIC_OPTIONS,
  STYLE_FIT_OPTIONS,
  type AIProfileBlueprint,
  type AdvisorMessage,
  type Garment,
  type GarmentCategory,
  type GroundingSource,
  type OccasionType,
  type OutfitCombination,
  type SeasonTag,
  type UserProfile,
} from '../src/types/styling.ts';
import type { CandidateCombination } from '../src/utils/styleEngine.ts';
import {
  classifyTopLayerRole,
  computeDeterministicVector,
  computeWardrobeIntelligenceSummary,
  evaluateOutfitLocalHarmony,
  normalizeVector,
} from '../src/utils/styleEngine.ts';
import {
  buildAdvisorWardrobeContext,
  ensureGarmentHyperlinks,
  formatCompactHistoryForAdvisor,
} from '../src/utils/advisorRetrieval.ts';

export interface ModelTier {
  id: string;
  model: string;
  thinkingLevel?: ThinkingLevel;
  supportsSearch: boolean;
  discovered?: boolean;
}

/**
 * Verified free-plan Gemini model cascade (strictly excludes deprecated 1.5/2.0 and paid-only models).
 * Additional active free-tier Gemini models exposed by the user's API key are dynamically discovered
 * via `ai.models.list()` and appended automatically as failover tiers.
 */
export const DEEP_REASONING_HIERARCHY: ModelTier[] = [
  {
    id: 'gemini-4-hydrogen (balanced)',
    model: 'gemini-4-hydrogen',
    thinkingLevel: ThinkingLevel.HIGH,
    supportsSearch: true,
  },
  {
    id: 'gemini-4-hydrogen (fast)',
    model: 'gemini-4-hydrogen',
    thinkingLevel: ThinkingLevel.MEDIUM,
    supportsSearch: true,
  },
  {
    id: 'gemini-3.1-flash-lite (reasoned)',
    model: 'gemini-3.1-flash-lite',
    thinkingLevel: ThinkingLevel.HIGH,
    supportsSearch: false,
  },
  {
    id: 'gemini-3.1-flash-lite (minimal)',
    model: 'gemini-3.1-flash-lite',
    thinkingLevel: ThinkingLevel.MEDIUM,
    supportsSearch: false,
  },
];

export const FAST_HIERARCHY: ModelTier[] = [
  {
    id: 'gemini-3.1-flash-lite (minimal)',
    model: 'gemini-3.1-flash-lite',
    thinkingLevel: ThinkingLevel.MEDIUM,
    supportsSearch: false,
  },
  {
    id: 'gemini-3.1-flash-lite (reasoned)',
    model: 'gemini-3.1-flash-lite',
    thinkingLevel: ThinkingLevel.HIGH,
    supportsSearch: false,
  },
  {
    id: 'gemini-4-hydrogen (fast)',
    model: 'gemini-4-hydrogen',
    thinkingLevel: ThinkingLevel.MEDIUM,
    supportsSearch: true,
  },
];

// Circuit-breaker cooldown maps so rate-limited or unavailable models are skipped immediately
const modelCooldowns = new Map<string, number>();
const embeddingCooldowns = new Map<string, number>();
const TRANSIENT_COOLDOWN_MS = 90_000;
const UNAVAILABLE_COOLDOWN_MS = 15 * 60_000;
const DAILY_QUOTA_DEFAULT_COOLDOWN_MS = 6 * 60 * 60_000;
const MAX_QUOTA_COOLDOWN_MS = 12 * 60 * 60_000;

export function clearModelCooldowns(): void {
  modelCooldowns.clear();
  embeddingCooldowns.clear();
}

export function getCooldownMsForError(message: string): number {
  const upper = message.toUpperCase();
  if (
    upper.includes('404') ||
    upper.includes('NOT_FOUND') ||
    upper.includes('403') ||
    upper.includes('PERMISSION_DENIED') ||
    upper.includes('UNSUPPORTED')
  ) {
    return UNAVAILABLE_COOLDOWN_MS;
  }
  if (
    upper.includes('429') ||
    upper.includes('RESOURCE_EXHAUSTED') ||
    upper.includes('QUOTA')
  ) {
    // Respect server-provided retryDelay (e.g. "retryDelay":"79705s" for Free Tier daily caps)
    const retrySecMatch = message.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i);
    if (retrySecMatch) {
      const parsedMs = Math.ceil(Number(retrySecMatch[1]) * 1000);
      if (Number.isFinite(parsedMs) && parsedMs > 0) {
        return Math.min(MAX_QUOTA_COOLDOWN_MS, Math.max(TRANSIENT_COOLDOWN_MS, parsedMs));
      }
    }
    if (
      upper.includes('PERDAY') ||
      upper.includes('PER DAY') ||
      upper.includes('GENERATEREQUESTSPERDAY') ||
      upper.includes('DAILY')
    ) {
      return DAILY_QUOTA_DEFAULT_COOLDOWN_MS;
    }
    return TRANSIENT_COOLDOWN_MS;
  }
  if (
    upper.includes('503') ||
    upper.includes('UNAVAILABLE') ||
    upper.includes('OVERLOADED')
  ) {
    return TRANSIENT_COOLDOWN_MS;
  }
  return 0;
}

function summarizeErrorForLog(msg: string): string {
  const upper = msg.toUpperCase();
  if (upper.includes('PERDAY') || upper.includes('GENERATEREQUESTSPERDAY')) {
    return 'Free-tier daily quota reached; switching to fallback model';
  }
  if (upper.includes('429') || upper.includes('RESOURCE_EXHAUSTED')) {
    return 'Rate limit reached (429); switching to fallback model';
  }
  if (upper.includes('503') || upper.includes('OVERLOADED') || upper.includes('UNAVAILABLE')) {
    return 'Model temporarily busy (503); switching to fallback model';
  }
  return msg.slice(0, 140);
}

const EXCLUDED_MODEL_PATTERNS = [
  /^gemini-1\./i,
  /^gemini-2\.0/i,
  /^gemini-pro(?:-|$)/i,
  /^gemini-ultra/i,
  /^gemini-4-(?:neon|carbon|argon)/i,
  /-pro(?:-|$)/i,
  /image|nano-banana|live|tts|transcribe|translate|audio|omni|veo|lyria|genie|embedding|decision|robotics|computer-use|deep-research|aqa|exp$/i,
];

/**
 * Pure filter + ranker for dynamically discovered free-tier Gemini models from `ai.models.list()`.
 * Keeps only modern free-plan-compatible Flash / Flash-Lite / Hydrogen models supporting `generateContent`.
 */
export function selectDiscoveredFreeModels(
  rawModels: Array<{ name?: string; supportedActions?: string[] }>,
  existingModelIds: Set<string>,
  maxAdditional = 6
): ModelTier[] {
  const seen = new Set<string>(existingModelIds);
  const candidates: Array<{ model: string; rankScore: number }> = [];

  for (const entry of rawModels) {
    const rawName = (entry.name ?? '').trim();
    if (!rawName) continue;
    const model = rawName.replace(/^models\//i, '');
    if (!model.toLowerCase().startsWith('gemini-')) continue;
    if (seen.has(model)) continue;

    if (
      Array.isArray(entry.supportedActions) &&
      entry.supportedActions.length > 0 &&
      !entry.supportedActions.includes('generateContent')
    ) {
      continue;
    }

    if (EXCLUDED_MODEL_PATTERNS.some((re) => re.test(model))) {
      continue;
    }

    // Keep only modern flash / flash-lite / hydrogen free-tier families
    if (!/(?:hydrogen|flash)/i.test(model)) {
      continue;
    }

    seen.add(model);

    // Score newest & cleanest aliases highest
    const verMatch = model.match(/^gemini-(\d+)(?:\.(\d+))?/i);
    const major = verMatch ? Number(verMatch[1]) : 0;
    const minor = verMatch && verMatch[2] ? Number(verMatch[2]) : 0;
    const isLite = /lite/i.test(model);
    const isDated = /-\d{2,4}(?:-\d{2})?$/.test(model);
    const isPreview = /preview/i.test(model);

    const rankScore =
      major * 1000 +
      minor * 100 +
      (isLite ? -20 : 20) +
      (isPreview ? -5 : 5) +
      (isDated ? -10 : 10);

    candidates.push({ model, rankScore });
  }

  candidates.sort((a, b) => b.rankScore - a.rankScore);

  return candidates.slice(0, maxAdditional).map(({ model }) => {
    const supportsThinkingLevel = /^gemini-(?:3|4)/i.test(model);
    const isLite = /lite/i.test(model);
    const thinkingLevel = supportsThinkingLevel
      ? isLite
        ? ThinkingLevel.MINIMAL
        : ThinkingLevel.LOW
      : undefined;

    return {
      id: `${model} (auto-fallback)`,
      model,
      thinkingLevel,
      supportsSearch: false,
      discovered: true,
    };
  });
}

let cachedDiscoveredTiers: ModelTier[] | null = null;
let cachedDiscoveredEmbeddingModels: string[] | null = null;
let lastDiscoveryAt = 0;
const DISCOVERY_CACHE_TTL_MS = 15 * 60_000;

async function refreshLiveModelDiscovery(ai: GoogleGenAI): Promise<{
  generationTiers: ModelTier[];
  embeddingModels: string[];
}> {
  const now = Date.now();
  if (
    cachedDiscoveredTiers &&
    cachedDiscoveredEmbeddingModels &&
    now - lastDiscoveryAt < DISCOVERY_CACHE_TTL_MS
  ) {
    return {
      generationTiers: cachedDiscoveredTiers,
      embeddingModels: cachedDiscoveredEmbeddingModels,
    };
  }

  try {
    const pager = await ai.models.list({ config: { pageSize: 100 } });
    const rawModels: Array<{ name?: string; supportedActions?: string[] }> = [];
    for await (const m of pager) {
      rawModels.push({
        name: m.name,
        supportedActions: m.supportedActions,
      });
      if (rawModels.length >= 120) break;
    }

    const staticIds = new Set<string>([
      ...DEEP_REASONING_HIERARCHY.map((t) => t.model),
      ...FAST_HIERARCHY.map((t) => t.model),
    ]);

    cachedDiscoveredTiers = selectDiscoveredFreeModels(rawModels, staticIds, 6);
    cachedDiscoveredEmbeddingModels = rawModels
      .filter((m) => {
        const name = (m.name ?? '').replace(/^models\//i, '');
        const supportsEmbed =
          !Array.isArray(m.supportedActions) ||
          m.supportedActions.length === 0 ||
          m.supportedActions.includes('embedContent');
        return (
          supportsEmbed &&
          /^gemini-embedding-/i.test(name) &&
          name !== 'gemini-embedding-2'
        );
      })
      .map((m) => (m.name ?? '').replace(/^models\//i, ''))
      .slice(0, 3);
    lastDiscoveryAt = now;
  } catch (err) {
    console.info(
      '[AI Hierarchy] Live model discovery unavailable, using verified static free-tier lineup:',
      err instanceof Error ? summarizeErrorForLog(err.message) : String(err)
    );
    cachedDiscoveredTiers = cachedDiscoveredTiers ?? [];
    cachedDiscoveredEmbeddingModels = cachedDiscoveredEmbeddingModels ?? [];
    lastDiscoveryAt = now;
  }

  return {
    generationTiers: cachedDiscoveredTiers,
    embeddingModels: cachedDiscoveredEmbeddingModels,
  };
}

async function resolveFullHierarchy(baseTiers: ModelTier[], ai: GoogleGenAI): Promise<ModelTier[]> {
  const { generationTiers } = await refreshLiveModelDiscovery(ai);
  if (generationTiers.length === 0) return baseTiers;

  const existingIds = new Set(baseTiers.map((t) => t.id));
  const extra = generationTiers.filter((t) => !existingIds.has(t.id));
  return [...baseTiers, ...extra];
}

export interface HierarchyExecutionResult<T> {
  data: T;
  modelUsed: string;
  attemptedModels: string[];
}

export async function executeWithModelHierarchy<T>(
  tiers: ModelTier[],
  executor: (tier: ModelTier) => Promise<T>
): Promise<HierarchyExecutionResult<T>> {
  const attemptedModels: string[] = [];
  let lastError: unknown;
  const startNow = Date.now();

  // Prioritize tiers whose model is not currently on cooldown; if all are cooling down, try unique models once
  const healthyTiers = tiers.filter((t) => (modelCooldowns.get(t.model) ?? 0) <= startNow);
  const usingHealthyList = healthyTiers.length > 0;
  const orderedTiers = usingHealthyList
    ? healthyTiers
    : tiers.filter((t, idx, arr) => arr.findIndex((x) => x.model === t.model) === idx);

  for (const tier of orderedTiers) {
    // Re-check live cooldown inside the loop so a 429/503 on one tier skips other tiers sharing the same model immediately
    if (usingHealthyList && (modelCooldowns.get(tier.model) ?? 0) > Date.now()) {
      continue;
    }

    attemptedModels.push(tier.id);
    try {
      const data = await executor(tier);
      modelCooldowns.delete(tier.model);
      return {
        data,
        modelUsed: tier.id,
        attemptedModels,
      };
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      // Do not keep hammering if API key itself is invalid or missing
      if (msg.includes('API_KEY_INVALID') || msg.includes('GEMINI_API_KEY is not configured')) {
        throw err;
      }
      const cooldownMs = getCooldownMsForError(msg);
      if (cooldownMs > 0) {
        modelCooldowns.set(tier.model, Date.now() + cooldownMs);
      }
      console.info(`[AI Hierarchy] ${tier.id}: ${summarizeErrorForLog(msg)}`);
    }
  }

  const finalMsg = lastError instanceof Error ? lastError.message : '';
  const finalUpper = finalMsg.toUpperCase();
  if (
    finalUpper.includes('429') ||
    finalUpper.includes('RESOURCE_EXHAUSTED') ||
    finalUpper.includes('QUOTA')
  ) {
    throw new Error(
      'All free-tier Gemini models have temporarily reached their rate or daily quota limit. Please wait a minute and retry, or select a billing-enabled Gemini API key in Settings > Secrets for higher limits.'
    );
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('All models in the AI hierarchy failed to respond.');
}

function buildThinkingConfig(tier: ModelTier): { thinkingConfig: { thinkingLevel: ThinkingLevel } } | Record<string, never> {
  if (!tier.thinkingLevel) return {};
  return { thinkingConfig: { thinkingLevel: tier.thinkingLevel } };
}

let cachedClient: GoogleGenAI | null = null;

function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Add your Gemini API key in Settings > Secrets to run live AI analysis.'
    );
  }
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedClient;
}

/**
 * Compacts wardrobe items into dense pipe-delimited descriptors to slash AI token usage by ~80%.
 */
export function compactGarmentLine(g: Garment): string {
  return `${g.id}|${g.name}|${g.category}/${g.subCategory}|${g.primaryColor}(${g.colorHex},${g.undertone})|${g.fabric}(${g.fabricWeight},${g.texture})|fit:${g.fit}|pat:${g.pattern}|form:${g.formality}/10|seas:${g.seasons.join(',')}`;
}

export function compactProfileSummary(profile: UserProfile): string {
  const fits = Array.isArray(profile.preferredFits) ? profile.preferredFits : [];
  const aesthetics = Array.isArray(profile.styleAesthetics) ? profile.styleAesthetics : [];
  const lines = [
    `Name:${profile.name || 'User'}`,
    `Height:${profile.height || 'unspecified'}`,
    `Body:${profile.bodyType || 'unspecified'}`,
    `Undertone:${profile.skinUndertone || 'Neutral'}`,
    `Fits:${fits.join(',') || 'balanced'}`,
    `Style:${aesthetics.join(',') || 'modern'}`,
    `Budget:${profile.budgetRange || 'Mid-Range'}`,
    `Climate:${profile.climate || 'Four-Season'}`,
    profile.bio ? `Bio:${profile.bio.slice(0, 220)}` : '',
    profile.stylingGoals ? `Goals:${profile.stylingGoals.slice(0, 140)}` : '',
  ].filter(Boolean);

  if (profile.blueprint) {
    if (profile.blueprint.visualProfile) {
      lines.push(`PortraitVisualProfile:${profile.blueprint.visualProfile.slice(0, 320)}`);
    }
    const bestColors = Array.isArray(profile.blueprint.bestColors) ? profile.blueprint.bestColors : [];
    const avoidColors = Array.isArray(profile.blueprint.avoidColors) ? profile.blueprint.avoidColors : [];
    const idealSilhouettes = Array.isArray(profile.blueprint.idealSilhouettes) ? profile.blueprint.idealSilhouettes : [];
    const proportionTips = Array.isArray(profile.blueprint.proportionTips) ? profile.blueprint.proportionTips : [];
    const recommendedFabrics = Array.isArray(profile.blueprint.recommendedFabrics) ? profile.blueprint.recommendedFabrics : [];
    const bestHexes = profile.blueprint.bestColorHexes?.length
      ? `(${profile.blueprint.bestColorHexes.slice(0, 6).join(',')})`
      : '';
    const avoidHexes = profile.blueprint.avoidColorHexes?.length
      ? `(${profile.blueprint.avoidColorHexes.slice(0, 4).join(',')})`
      : '';
    lines.push(
      `Blueprint:${profile.blueprint.colorSeason || 'Balanced'}(${profile.blueprint.contrastLevel || 'Medium'} contrast); best:${bestColors.slice(0, 6).join(',')}${bestHexes}; avoid:${avoidColors.slice(0, 4).join(',')}${avoidHexes}; silhouettes:${idealSilhouettes.slice(0, 3).join(',')}; proportions:${proportionTips.slice(0, 2).join('; ')}; fabrics:${recommendedFabrics.slice(0, 4).join(',')}`
    );
  }
  return lines.join(' | ');
}

function safeParseJson<T>(raw: string | undefined, fallbackMsg: string): T {
  const text = (raw ?? '').trim();
  if (!text) throw new Error(fallbackMsg);
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  return JSON.parse(cleaned) as T;
}

const VALID_CATEGORIES: GarmentCategory[] = [
  'tops',
  'bottoms',
  'outerwear',
  'footwear',
  'accessories',
];

export interface AnalyzedGarmentPayload {
  name: string;
  category: GarmentCategory;
  subCategory: string;
  primaryColor: string;
  colorHex: string;
  secondaryColors: string[];
  undertone: 'Warm' | 'Cool' | 'Neutral';
  fabric: string;
  fabricWeight: 'Lightweight' | 'Midweight' | 'Heavyweight';
  texture: string;
  fit: string;
  silhouette: string;
  pattern: string;
  formality: number;
  seasons: SeasonTag[];
  occasions: OccasionType[];
  stylingNotes: string;
  layeringRole: 'Base' | 'Mid' | 'Outer' | 'Bottom' | 'Footwear' | 'Accent';
}

/**
 * Forensic single-garment vision analysis using strict compact JSON schema for minimal tokens.
 */
export async function analyzeGarmentWithAI(
  base64Image: string,
  mimeType: string,
  fileNameHint?: string
): Promise<{ garment: AnalyzedGarmentPayload; modelUsed: string }> {
  const ai = getGenAIClient();
  const tiers = await resolveFullHierarchy(FAST_HIERARCHY, ai);

  const prompt = `Forensically inspect this clothing item photo${fileNameHint ? ` (filename hint: ${fileNameHint})` : ''}.
- Ignore background surfaces (bedsheets, floors, hangers, walls) when extracting the true dominant garment primaryColor and 6-digit colorHex.
- Classify exact fabric weave, weight (Lightweight/Midweight/Heavyweight), tactile texture, silhouette volume (slim, tailored, relaxed, wide-leg, oversized, cropped, longline), pattern, and undertone (Warm/Cool/Neutral).
- STRICT layeringRole accuracy:
  * Shirts, t-shirts, oxfords, button-downs, polos, tanks, henleys, blouses -> layeringRole: "Base"
  * Sweaters, pullovers, knitwear, cardigans, hoodies, sweatshirts, sweater vests, quarter-zips, fleeces -> layeringRole: "Mid"
  * Jackets, coats, blazers, overshirts, trenches, parkas -> layeringRole: "Outer"
  * Pants, trousers, jeans, chinos, shorts, skirts -> layeringRole: "Bottom"
  * Shoes, boots, sneakers, loafers, sandals -> layeringRole: "Footwear"
  * Belts, watches, bags, scarves, hats, jewelry -> layeringRole: "Accent"
- STRICT season accuracy: NEVER tag wool/cashmere/merino sweaters, hoodies, fleeces, heavy knits, corduroy, flannel, or winter coats as "Summer" or "All-Season" — tag them accurately as ["Autumn", "Winter"] (or ["Spring", "Autumn", "Winter"] for light cotton knits).
- Calibrate formality accurately: 1-2=gym/loungewear, 3-4=graphic tee/hoodie/joggers, 5=everyday denim/casual knit, 6-7=smart casual shirt/chinos/loafers/overshirt, 8=tailored blazer/pleated wool trousers, 9-10=formal suiting/black-tie.
- Keep every field concise, accurate, and high-signal for outfit matching.`;

  const res = await executeWithModelHierarchy(tiers, async (tier) => {
    const response = await ai.models.generateContent({
      model: tier.model,
      contents: {
        parts: [
          { inlineData: { mimeType, data: base64Image } },
          { text: prompt },
        ],
      },
      config: {
        systemInstruction:
          'You are a master fashion archivist, colorist, and textile specialist. Output accurate, concise structured garment metadata with zero fluff.',
        ...buildThinkingConfig(tier),
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: 'Concise 2-5 word title, e.g. Charcoal Wool Pleated Trousers' },
            category: { type: Type.STRING, description: 'One of: tops, bottoms, outerwear, footwear, accessories' },
            subCategory: { type: Type.STRING, description: 'Specific garment type e.g. Oxford Shirt, Penny Loafer, Trench Coat' },
            primaryColor: { type: Type.STRING },
            colorHex: { type: Type.STRING, description: '6-digit hex color code e.g. #2E3440' },
            secondaryColors: { type: Type.ARRAY, items: { type: Type.STRING } },
            undertone: { type: Type.STRING, description: 'Warm, Cool, or Neutral' },
            fabric: { type: Type.STRING, description: 'Specific material & weave e.g. Brushed cotton Oxford, Worsted wool twill' },
            fabricWeight: { type: Type.STRING, description: 'Lightweight, Midweight, or Heavyweight' },
            texture: { type: Type.STRING, description: '2-4 words describing tactile surface' },
            fit: { type: Type.STRING, description: 'e.g. Tailored slim, Relaxed boxy, Straight leg' },
            silhouette: { type: Type.STRING, description: 'Short silhouette description' },
            pattern: { type: Type.STRING, description: 'e.g. Solid, Fine pinstripe, Herringbone, Plaid' },
            formality: { type: Type.INTEGER, description: 'Integer 1-10' },
            seasons: { type: Type.ARRAY, items: { type: Type.STRING } },
            occasions: { type: Type.ARRAY, items: { type: Type.STRING } },
            stylingNotes: { type: Type.STRING, description: 'One crisp sentence on best pairing/drape' },
            layeringRole: { type: Type.STRING, description: 'Base, Mid, Outer, Bottom, Footwear, or Accent' },
          },
          required: [
            'name',
            'category',
            'subCategory',
            'primaryColor',
            'colorHex',
            'undertone',
            'fabric',
            'fabricWeight',
            'texture',
            'fit',
            'silhouette',
            'pattern',
            'formality',
            'seasons',
            'occasions',
            'stylingNotes',
            'layeringRole',
          ],
        },
      },
    });

    const parsed = safeParseJson<AnalyzedGarmentPayload>(
      response.text,
      'Empty garment analysis response'
    );

    const normalizedCat = parsed.category?.toLowerCase() as GarmentCategory;
    parsed.category = VALID_CATEGORIES.includes(normalizedCat) ? normalizedCat : 'tops';
    parsed.formality = Math.max(1, Math.min(10, Math.round(Number(parsed.formality) || 5)));
    if (!/^#[0-9A-Fa-f]{6}$/.test(parsed.colorHex || '')) {
      parsed.colorHex = '#6E6E73';
    }
    parsed.secondaryColors = Array.isArray(parsed.secondaryColors) ? parsed.secondaryColors.slice(0, 3) : [];
    parsed.seasons = (Array.isArray(parsed.seasons) && parsed.seasons.length > 0
      ? parsed.seasons
      : ['All-Season']) as SeasonTag[];
    parsed.occasions = (Array.isArray(parsed.occasions) && parsed.occasions.length > 0
      ? parsed.occasions
      : ['Smart Casual']) as OccasionType[];

    return parsed;
  });

  return { garment: res.data, modelUsed: res.modelUsed };
}

/**
 * Generates a normalized multimodal image + attribute embedding vector via `gemini-embedding-2`
 * with automatic fallback to text-only embedding, any live-discovered Gemini embedding model,
 * and deterministic semantic vectors so uploads remain resilient.
 */
export async function generateGarmentVector(
  base64Image: string | null,
  mimeType: string | null,
  garment: Pick<
    Garment,
    | 'name'
    | 'category'
    | 'subCategory'
    | 'primaryColor'
    | 'colorHex'
    | 'undertone'
    | 'fabric'
    | 'fabricWeight'
    | 'texture'
    | 'fit'
    | 'pattern'
    | 'formality'
    | 'seasons'
    | 'occasions'
  >
): Promise<{ vector: number[]; source: 'gemini-embedding-2' | 'semantic-fallback' }> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return {
      vector: computeDeterministicVector(garment),
      source: 'semantic-fallback',
    };
  }

  const ai = getGenAIClient();
  const descriptor = `${garment.name} ${garment.category} ${garment.subCategory} ${garment.primaryColor} ${garment.undertone} ${garment.fabric} ${garment.texture} ${garment.fit} ${garment.pattern} formality:${garment.formality}`;
  const { embeddingModels } = await refreshLiveModelDiscovery(ai);

  const attempts: Array<{
    model: string;
    contents: Array<string | { inlineData: { data: string; mimeType: string } }>;
  }> = [];

  if (base64Image && mimeType) {
    attempts.push({
      model: 'gemini-embedding-2',
      contents: [descriptor, { inlineData: { data: base64Image, mimeType } }],
    });
  }
  attempts.push({
    model: 'gemini-embedding-2',
    contents: [descriptor],
  });
  for (const discoveredModel of embeddingModels) {
    attempts.push({
      model: discoveredModel,
      contents: [descriptor],
    });
  }

  for (const attempt of attempts) {
    if ((embeddingCooldowns.get(attempt.model) ?? 0) > Date.now()) {
      continue;
    }
    try {
      const result = await ai.models.embedContent({
        model: attempt.model,
        contents: attempt.contents,
        config: {
          outputDimensionality: 128,
        },
      });

      const values = result.embeddings?.[0]?.values;
      if (Array.isArray(values) && values.length > 0) {
        embeddingCooldowns.delete(attempt.model);
        return {
          vector: normalizeVector(values.slice(0, 256)),
          source: 'gemini-embedding-2',
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const cd = getCooldownMsForError(msg);
      if (cd > 0) {
        embeddingCooldowns.set(attempt.model, Date.now() + cd);
      }
      console.info(
        `[Vector Engine] ${attempt.model}: ${summarizeErrorForLog(msg)}`
      );
    }
  }

  return {
    vector: computeDeterministicVector(garment),
    source: 'semantic-fallback',
  };
}

/**
 * Stage-2 Cross-Encoder Stylist Reranker:
 * Evaluates up to 8 MMR-diverse candidates (enriched with OKLCH color, proportion/drape,
 * 12-season personal flattery, vector, and freshness sub-scores), prunes weaker pairings,
 * and outputs the top 5 deeply personalized outfits with editorial styling guidance.
 */
export async function rankCombinationsWithAI(
  candidates: CandidateCombination[],
  profile: UserProfile,
  occasion: OccasionType,
  season: SeasonTag,
  customPrompt?: string,
  savedOutfits: OutfitCombination[] = [],
  explorationMode: 'best' | 'fresh' = 'best',
  portraitImage?: { base64: string; mimeType: string } | null
): Promise<{ combinations: OutfitCombination[]; modelUsed: string }> {
  const ai = getGenAIClient();
  const tiers = await resolveFullHierarchy(DEEP_REASONING_HIERARCHY, ai);

  const effectiveSeason = candidates[0]?.effectiveSeason ?? season;
  const targetCount = Math.min(5, candidates.length);
  const labelLayer = (g: Garment): string => {
    if (g.category === 'tops') return classifyTopLayerRole(g) === 'mid' ? 'MID-LAYER' : 'BASE';
    if (g.category === 'outerwear') return 'OUTER';
    if (g.category === 'bottoms') return 'BOTTOM';
    if (g.category === 'footwear') return 'FOOTWEAR';
    return 'ACCENT';
  };

  const candidateLines = candidates.map((cand, idx) => {
    const itemDesc = cand.items.map((g) => `[${labelLayer(g)}] ${compactGarmentLine(g)}`).join(' + ');
    return `C${idx + 1} [local:${cand.localScore}, personal:${cand.personalScore}, oklchColor:${cand.colorScore}(${cand.paletteSummary}), proportion:${cand.proportionScore}, vec:${cand.vectorScore}, fresh:${cand.freshnessScore}]: ${itemDesc}`;
  });

  const savedTasteLine =
    savedOutfits.length > 0
      ? `\nUser's Favorite Saved Looks (taste signal): ${savedOutfits
          .slice(0, 4)
          .map((o) => `${o.title} (${o.occasion})`)
          .join('; ')}`
      : '';

  const cleanBrief = customPrompt?.trim().slice(0, 320);
  const modeNote =
    explorationMode === 'fresh'
      ? 'Exploration Mode: FRESH ROTATION — prioritize inventive, under-worn combinations over predictable repeats.'
      : 'Exploration Mode: BEST MATCH — prioritize highest flattery, proportion precision, and effortless polish.';

  const thermalNote =
    effectiveSeason === 'Summer'
      ? 'THERMAL RULE: Target weather is SUMMER (hot/breathable). Penalize or drop any candidate with warm wool/sweaters/heavy layers; reward breathable shirts/tees/lightweight fabrics.'
      : effectiveSeason === 'Autumn' || effectiveSeason === 'Winter'
        ? 'LAYERING RULE: Target weather is COOL/COLD. Strongly reward intentional multi-layer outfits ([BASE] shirt/tee UNDER [MID-LAYER] sweater/cardigan/knit and/or [OUTER]). Never reward bare sweaters without an underlayer when layered candidates exist.'
        : 'LAYERING RULE: When a candidate includes a [BASE] shirt/tee under a [MID-LAYER] sweater/cardigan/vest, explicitly explain how to style the collar, cuffs, or hem peek.';

  const promptText = `USER STYLE PROFILE & STORED PORTRAIT ANALYSIS${portraitImage ? ' (User portrait photo attached — inspect their actual skin tone, hair/eye contrast, and face/shoulder frame directly!)' : ''}:
${compactProfileSummary(profile)}${savedTasteLine}

TARGET CONTEXT: Occasion=${occasion} | EffectiveSeason=${effectiveSeason} | ${modeNote}${cleanBrief ? `\nEXACT USER REQUEST / VIBE: "${cleanBrief}"` : ''}
${thermalNote}

PRE-SCREENED MMR CANDIDATE OUTFITS (OKLCH color, multi-layer & proportion physics, 12-season personal fit, and 128-dim visual vectors):
${candidateLines.join('\n')}

TASK:
Act as a senior luxury menswear/womenswear creative director and master 12-season color analyst. Critically compare all ${candidates.length} candidates for THIS specific person's real coloring, portrait features, 12-season palette (especially [BASE]/[MID-LAYER]/[OUTER] near the face), natural contrast level, body proportions, multi-layer dressing physics, and ${effectiveSeason} ${occasion} suitability${cleanBrief ? ' + exact user request' : ''}.
- Select and rank the BEST ${targetCount} distinct outfits from rank 1 (strongest) to rank ${targetCount}${candidates.length > targetCount ? ` (drop the ${candidates.length - targetCount} weakest or most redundant candidates)` : ''}.
- FULL-CLOSET VARIETY RULE: Maximize wardrobe breadth across your 5 picks. Avoid reusing the same non-anchored top, bottom, jacket, or shoe more than twice across Ranks #1–#${targetCount}. Each look must have a distinct silhouette, color mood, or layering architecture.
- Differentiate scores honestly (e.g. 95, 91, 87, 83, 79 — never give every look the same inflated score).
- ZERO AMATEUR CLICHÉS: NEVER use lazy filler like "elevates your look", "effortless chic", "versatile staple", "ties the outfit together", "adds a pop of color", or "perfect for any occasion".
- WRITE LIKE A REAL FASHION DIRECTOR: Give concrete garment-specific mechanics — name exact textures/weaves (e.g. "matte brushed flannel against crisp cotton poplin"), exact collar/cuff/hem styling (e.g. "leave the oxford top button open so the collar tips sit inside the crewneck", "half-tuck the boxy hem to raise the visual waist"), and exact complexion physics (why the face-framing shade sharpens THIS person's undertone and contrast).
Return a valid JSON array of exactly ${targetCount} objects sorted by rank ascending.`;

  const contentsPayload = portraitImage
    ? {
        parts: [
          { text: '[User Portrait Photo — use for skin tone, hair/eye contrast, and frame flattery]' },
          { inlineData: { mimeType: portraitImage.mimeType, data: portraitImage.base64 } },
          { text: promptText },
        ],
      }
    : promptText;

  const res = await executeWithModelHierarchy(tiers, async (tier) => {
    const response = await ai.models.generateContent({
      model: tier.model,
      contents: contentsPayload,
      config: {
        systemInstruction:
          'You are a world-class editorial fashion director and 12-season colorist. Judge outfits with surgical precision on real-world layering (base shirts/tees under sweaters & cardigans), thermal season realism (never sweaters in summer), face-framing complexion harmony, OKLCH tonal/60-30-10 balance, and proportion geometry. Never write generic AI fashion clichés; every sentence must name concrete fabrics, cuts, colors, and styling mechanics.',
        ...buildThinkingConfig(tier),
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              candidateIndex: { type: Type.INTEGER, description: '1-based index matching C1..CN' },
              title: { type: Type.STRING, description: 'Specific editorial 3-5 word look name (no clichés)' },
              score: { type: Type.INTEGER, description: 'Calibrated stylist score 65-98' },
              rationale: { type: Type.STRING, description: 'Specific sartorial reason these exact pieces work on this person (<=34 words)' },
              fabricFitNotes: { type: Type.STRING, description: 'Concrete fabric contrast, weight stepping & silhouette balance (<=28 words)' },
              bodyTailoringNote: { type: Type.STRING, description: 'Exact face-framing color effect & body proportion geometry for their profile (<=28 words)' },
              finishingTouch: { type: Type.STRING, description: 'One actionable physical styling move: tuck, collar break, cuff roll, sleeve push, or belt/hem adjustment (<=22 words)' },
            },
            required: [
              'candidateIndex',
              'title',
              'score',
              'rationale',
              'fabricFitNotes',
              'bodyTailoringNote',
              'finishingTouch',
            ],
          },
        },
      },
    });

    type RawRank = {
      candidateIndex: number;
      title: string;
      score: number;
      rationale: string;
      fabricFitNotes: string;
      bodyTailoringNote: string;
      finishingTouch: string;
    };

    const parsed = safeParseJson<RawRank[]>(response.text, 'Empty outfit ranking response');
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('Ranking response did not include combinations');
    }

    const mapped: OutfitCombination[] = [];
    const used = new Set<number>();

    for (const entry of parsed) {
      const idx = Math.max(0, Math.min(candidates.length - 1, (entry.candidateIndex || 1) - 1));
      if (used.has(idx)) continue;
      used.add(idx);
      const cand = candidates[idx];
      // Blend AI judgment (70%) with deterministic OKLCH/proportion/personal score (30%) for calibrated stability
      const rawAiScore = Math.max(60, Math.min(98, Math.round(Number(entry.score) || cand.localScore)));
      const calibratedScore = Math.max(
        60,
        Math.min(98, Math.round(rawAiScore * 0.7 + cand.localScore * 0.3))
      );
      mapped.push({
        id: `combo-${Date.now()}-${mapped.length + 1}`,
        title: entry.title || `Curated ${occasion} Look ${mapped.length + 1}`,
        source: 'ai',
        rank: mapped.length + 1,
        score: calibratedScore,
        vectorHarmonyScore: cand.vectorScore,
        itemIds: cand.itemIds,
        occasion,
        season: effectiveSeason,
        rationale: entry.rationale,
        fabricFitNotes: entry.fabricFitNotes,
        bodyTailoringNote: entry.bodyTailoringNote,
        finishingTouch: entry.finishingTouch,
        wearCount: 0,
        saved: false,
        modelUsed: tier.id,
        createdAt: new Date().toISOString(),
      });
      if (mapped.length >= targetCount) break;
    }

    return mapped.sort((a, b) => b.score - a.score).map((item, i) => ({ ...item, rank: i + 1 }));
  });

  return { combinations: res.data, modelUsed: res.modelUsed };
}

export interface SuggestedProfileFields {
  bodyType?: string;
  skinUndertone?: UserProfile['skinUndertone'];
  preferredFits?: string[];
  styleAesthetics?: string[];
  stylingGoals?: string;
}

const PROFILE_FIT_OPTIONS = [...STYLE_FIT_OPTIONS];
const PROFILE_AESTHETIC_OPTIONS = [...STYLE_AESTHETIC_OPTIONS];
const PROFILE_SKIN_UNDERTONES: Array<UserProfile['skinUndertone']> = [
  'Warm',
  'Cool',
  'Neutral',
  'Olive',
  'Warm Olive',
  'Cool Olive',
];

/**
 * Analyzes user's portrait photo + written profile, produces a comprehensive Personal Styling Blueprint
 * (including visualProfile description and perceptual best/avoid hex codes), AND auto-fills flattering
 * style profile fields stored on the server/cloud and used across every recommendation surface.
 */
export async function analyzeUserProfileWithAI(
  profile: UserProfile,
  photoBase64: string | null,
  photoMimeType: string | null
): Promise<{
  blueprint: AIProfileBlueprint;
  suggestedProfile: SuggestedProfileFields;
  modelUsed: string;
}> {
  const ai = getGenAIClient();
  const tiers = await resolveFullHierarchy(DEEP_REASONING_HIERARCHY, ai);

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
  if (photoBase64 && photoMimeType) {
    parts.push({ inlineData: { mimeType: photoMimeType, data: photoBase64 } });
  }
  parts.push({
    text: `Analyze this user's personal styling profile${photoBase64 ? ' AND uploaded portrait photo in forensic detail (inspect actual skin tone depth & undertone, hair color/depth, eye/brow contrast, face shape, neckline/shoulder proportions, and natural presence)' : ''}:
${compactProfileSummary(profile)}
Derive a high-precision Personal Styling Blueprint covering what will look BEST on THIS specific person:
- visualProfile: 1-2 factual, respectful sentences describing their observed skin depth/undertone, hair & eye contrast, face shape, and shoulder/frame proportions (this is stored and injected into every outfit & shopping AI prompt!).
- colorSeason: exact 12-season label (e.g. Deep Autumn, Warm Autumn, Soft Autumn, True Winter, Deep Winter, Bright Winter, True Summer, Soft Summer, Light Summer, True Spring, Warm Spring, Bright Spring).
- contrastLevel: Low, Medium, Medium-High, or High.
- bestColors: 5-6 specific flattering color names near their face.
- bestColorHexes: 5-6 corresponding 6-digit hex codes (e.g. "#2E4034", "#C19A6B") used for mathematical OKLCH garment matching!
- avoidColors: 3-4 specific colors that wash them out or clash.
- avoidColorHexes: 3-4 corresponding 6-digit hex codes to penalize near their face!
- idealSilhouettes, proportionTips, recommendedFabrics tailored to their exact build.
ALSO auto-fill their ideal style profile fields:
- detectedSkinUndertone: one of [${PROFILE_SKIN_UNDERTONES.join(', ')}]
- detectedBodyType: concise 2-4 word frame/build note (e.g. "Balanced Athletic", "Lean Proportional", "Broad Shoulders")
- recommendedFits: 2-4 choices ONLY from [${PROFILE_FIT_OPTIONS.join(', ')}]
- recommendedAesthetics: 2-4 choices ONLY from [${PROFILE_AESTHETIC_OPTIONS.join(', ')}]
- personalizedStylingGoal: 1 crisp sentence describing what looks sharpest on them.`,
  });

  const res = await executeWithModelHierarchy(tiers, async (tier) => {
    const response = await ai.models.generateContent({
      model: tier.model,
      contents: { parts },
      config: {
        systemInstruction:
          'You are a respectful, observant master image consultant and 12-season color analyst. Extract concrete, photo-grounded skin undertone, contrast, hex palettes, and proportion geometry tailored specifically to this individual—never generic boilerplate.',
        ...buildThinkingConfig(tier),
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING, description: '2 crisp sentences summarizing what looks best on this person' },
            visualProfile: { type: Type.STRING, description: '1-2 factual sentences of visual coloring, hair/eye contrast, face & shoulder proportions observed from photo/profile' },
            colorSeason: { type: Type.STRING, description: 'Exact 12-season label e.g. Deep Autumn, True Winter' },
            contrastLevel: { type: Type.STRING, description: 'Low, Medium, Medium-High, or High' },
            bestColors: { type: Type.ARRAY, items: { type: Type.STRING } },
            bestColorHexes: { type: Type.ARRAY, items: { type: Type.STRING }, description: '6-digit hex codes matching bestColors' },
            avoidColors: { type: Type.ARRAY, items: { type: Type.STRING } },
            avoidColorHexes: { type: Type.ARRAY, items: { type: Type.STRING }, description: '6-digit hex codes matching avoidColors' },
            idealSilhouettes: { type: Type.ARRAY, items: { type: Type.STRING } },
            proportionTips: { type: Type.ARRAY, items: { type: Type.STRING } },
            recommendedFabrics: { type: Type.ARRAY, items: { type: Type.STRING } },
            detectedSkinUndertone: { type: Type.STRING, description: 'One of: Warm, Cool, Neutral, Olive, Warm Olive, Cool Olive' },
            detectedBodyType: { type: Type.STRING, description: 'Concise respectful frame/build note' },
            recommendedFits: { type: Type.ARRAY, items: { type: Type.STRING } },
            recommendedAesthetics: { type: Type.ARRAY, items: { type: Type.STRING } },
            personalizedStylingGoal: { type: Type.STRING, description: '1 crisp sentence tailored to what looks best on them' },
          },
          required: [
            'summary',
            'visualProfile',
            'colorSeason',
            'contrastLevel',
            'bestColors',
            'bestColorHexes',
            'avoidColors',
            'avoidColorHexes',
            'idealSilhouettes',
            'proportionTips',
            'recommendedFabrics',
            'detectedSkinUndertone',
            'detectedBodyType',
            'recommendedFits',
            'recommendedAesthetics',
            'personalizedStylingGoal',
          ],
        },
      },
    });

    const parsed = safeParseJson<
      Omit<AIProfileBlueprint, 'analyzedAt' | 'modelUsed'> & {
        detectedSkinUndertone?: string;
        detectedBodyType?: string;
        recommendedFits?: string[];
        recommendedAesthetics?: string[];
        personalizedStylingGoal?: string;
      }
    >(response.text, 'Empty profile blueprint response');

    const cleanHexes = (arr: unknown, max: number): string[] =>
      Array.isArray(arr)
        ? arr
            .filter((h): h is string => typeof h === 'string' && /^#[0-9A-Fa-f]{6}$/.test(h.trim()))
            .map((h) => h.trim().toUpperCase())
            .slice(0, max)
        : [];

    const blueprint: AIProfileBlueprint = {
      summary: (parsed.summary || 'Balanced personal style profile.').slice(0, 600),
      visualProfile: (parsed.visualProfile || '').trim().slice(0, 600),
      colorSeason: (parsed.colorSeason || 'Neutral Balanced').slice(0, 80),
      contrastLevel: (parsed.contrastLevel || 'Medium').slice(0, 40),
      bestColors: (parsed.bestColors ?? []).slice(0, 6),
      bestColorHexes: cleanHexes(parsed.bestColorHexes, 6),
      avoidColors: (parsed.avoidColors ?? []).slice(0, 4),
      avoidColorHexes: cleanHexes(parsed.avoidColorHexes, 4),
      idealSilhouettes: (parsed.idealSilhouettes ?? []).slice(0, 5),
      proportionTips: (parsed.proportionTips ?? []).slice(0, 5),
      recommendedFabrics: (parsed.recommendedFabrics ?? []).slice(0, 6),
      photoAnalyzed: Boolean(photoBase64),
      analyzedAt: new Date().toISOString(),
      modelUsed: tier.id,
    };

    const matchedUndertone = PROFILE_SKIN_UNDERTONES.find(
      (u) => u.toLowerCase() === (parsed.detectedSkinUndertone ?? '').trim().toLowerCase()
    );
    const matchedFits = (parsed.recommendedFits ?? [])
      .map((f) => PROFILE_FIT_OPTIONS.find((opt) => opt.toLowerCase() === f.trim().toLowerCase()))
      .filter((f): f is (typeof STYLE_FIT_OPTIONS)[number] => Boolean(f))
      .slice(0, 4);
    const matchedAesthetics = (parsed.recommendedAesthetics ?? [])
      .map((a) =>
        PROFILE_AESTHETIC_OPTIONS.find((opt) => opt.toLowerCase() === a.trim().toLowerCase())
      )
      .filter((a): a is (typeof STYLE_AESTHETIC_OPTIONS)[number] => Boolean(a))
      .slice(0, 4);

    const suggestedProfile: SuggestedProfileFields = {};
    if (matchedUndertone) suggestedProfile.skinUndertone = matchedUndertone;
    if (parsed.detectedBodyType && parsed.detectedBodyType.trim()) {
      suggestedProfile.bodyType = parsed.detectedBodyType.trim().slice(0, 60);
    }
    if (matchedFits.length > 0) suggestedProfile.preferredFits = matchedFits;
    if (matchedAesthetics.length > 0) suggestedProfile.styleAesthetics = matchedAesthetics;
    if (parsed.personalizedStylingGoal && parsed.personalizedStylingGoal.trim()) {
      suggestedProfile.stylingGoals = parsed.personalizedStylingGoal.trim().slice(0, 280);
    }

    return { blueprint, suggestedProfile };
  });

  return {
    blueprint: res.data.blueprint,
    suggestedProfile: res.data.suggestedProfile,
    modelUsed: res.modelUsed,
  };
}

/**
 * AI critique for a user-built custom outfit in Studio.
 */
export async function critiqueCustomOutfitWithAI(
  items: Garment[],
  profile: UserProfile,
  occasion: OccasionType,
  portraitImage?: { base64: string; mimeType: string } | null,
  allGarments: Garment[] = []
): Promise<{
  score: number;
  rationale: string;
  fabricFitNotes: string;
  bodyTailoringNote: string;
  finishingTouch: string;
  modelUsed: string;
}> {
  const ai = getGenAIClient();
  const tiers = await resolveFullHierarchy(DEEP_REASONING_HIERARCHY, ai);

  const vectors: Record<string, number[]> = {};
  for (const g of items) {
    vectors[g.id] = computeDeterministicVector(g);
  }
  const localMetrics = evaluateOutfitLocalHarmony(items, vectors, profile, { occasion });

  const hasMidLayer = items.some((g) => g.category === 'tops' && classifyTopLayerRole(g) === 'mid');
  const hasBaseLayer = items.some((g) => g.category === 'tops' && classifyTopLayerRole(g) === 'base');
  const layeringDiagnostics: string[] = [];
  if (hasMidLayer && !hasBaseLayer) {
    layeringDiagnostics.push(
      'WARNING: A mid-layer sweater/cardigan/hoodie is worn with NO base shirt or tee underneath — call this out honestly and specify the best underlayer.'
    );
  }
  const selectedIds = new Set(items.map((g) => g.id));
  const swapPool = allGarments
    .filter((g) => !selectedIds.has(g.id))
    .slice(0, 18)
    .map((g) => compactGarmentLine(g))
    .join('\n');

  const prompt = `Profile: ${compactProfileSummary(profile)}
Occasion: ${occasion}
Objective Harmony Diagnostics: Overall=${localMetrics.overallScore}/100 | PersonalFlattery=${localMetrics.personalScore}% | OKLCHColor=${localMetrics.colorScore}% (${localMetrics.paletteSummary}) | ProportionLayering=${localMetrics.proportionScore}%
${layeringDiagnostics.length > 0 ? `${layeringDiagnostics.join('\n')}\n` : ''}
Custom outfit selected by user:
${items
  .map(
    (g) =>
      `[${
        g.category === 'tops'
          ? classifyTopLayerRole(g) === 'mid'
            ? 'MID-LAYER'
            : 'BASE'
          : g.category.toUpperCase()
      }] ${compactGarmentLine(g)}`
  )
  .join('\n')}${swapPool ? `\n\nOTHER PIECES IN USER'S CLOSET (suggest a concrete swap or underlayer from here if it improves the look):\n${swapPool}` : ''}

Evaluate this custom combination with brutally honest, expert fashion-director precision for THIS specific person's coloring, proportions, fabric interplay, and occasion fit.
- Do NOT flatter a weak outfit: if colors clash, formality gaps are wide, fabrics fight, or a sweater lacks an underlayer, drop the score honestly (50-75) and state the exact fix.
- Zero generic clichés ("elevate", "effortless", "ties it together"). Be concrete and actionable.`;

  const contents =
    portraitImage && portraitImage.base64 && portraitImage.mimeType
      ? {
          parts: [
            { inlineData: { mimeType: portraitImage.mimeType, data: portraitImage.base64 } },
            { text: prompt },
          ],
        }
      : prompt;

  const res = await executeWithModelHierarchy(tiers, async (tier) => {
    const response = await ai.models.generateContent({
      model: tier.model,
      contents,
      config: {
        systemInstruction:
          'You are a candid, world-class personal fashion director reviewing a client-built outfit. Use their portrait/visual blueprint and objective color/proportion diagnostics to deliver sharp, honest, actionable critique—never sycophantic fluff.',
        ...buildThinkingConfig(tier),
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.INTEGER, description: 'Honest calibrated score 40-98' },
            rationale: { type: Type.STRING, description: 'Direct verdict on what works and what breaks in this exact pairing (<=40 words)' },
            fabricFitNotes: { type: Type.STRING, description: 'Specific fabric weight, texture contrast & silhouette critique (<=32 words)' },
            bodyTailoringNote: { type: Type.STRING, description: 'Face-framing color impact & body proportion read for their profile (<=32 words)' },
            finishingTouch: { type: Type.STRING, description: 'Most impactful styling adjustment OR exact garment swap/addition from their closet (<=28 words)' },
          },
          required: ['score', 'rationale', 'fabricFitNotes', 'bodyTailoringNote', 'finishingTouch'],
        },
      },
    });

    const parsed = safeParseJson<{
      score: number;
      rationale: string;
      fabricFitNotes: string;
      bodyTailoringNote: string;
      finishingTouch: string;
    }>(response.text, 'Empty critique response');

    return {
      ...parsed,
      score: Math.max(40, Math.min(99, Math.round(Number(parsed.score) || localMetrics.overallScore))),
    };
  });

  return { ...res.data, modelUsed: res.modelUsed };
}

export interface AdvisorImageInput {
  base64: string;
  mimeType: string;
  label?: string;
}

/**
 * Engine-Backed Editorial Stylist & Shopping Advisor:
 * Combines anti-repetition full-closet retrieval, pre-computed OKLCH + multi-layer verified outfit blueprints,
 * live Wardrobe DNA telemetry, multimodal store-item comparison (up to 4 photos), intent-gated Google Search,
 * and deterministic garment hyperlink verification.
 */
export async function chatWithShoppingAdvisor(
  userMessage: string,
  history: AdvisorMessage[],
  garments: Garment[],
  savedOutfits: OutfitCombination[],
  profile: UserProfile,
  attachedImages: AdvisorImageInput[] = [],
  portraitImage?: { base64: string; mimeType: string } | null
): Promise<{
  content: string;
  referencedItemIds: string[];
  sources: GroundingSource[];
  modelUsed: string;
}> {
  const ai = getGenAIClient();
  const tiers = await resolveFullHierarchy(DEEP_REASONING_HIERARCHY, ai);

  const hasImages = attachedImages.length > 0;
  const hasPortrait = Boolean(portraitImage?.base64 && portraitImage?.mimeType);

  const wardrobeDna = computeWardrobeIntelligenceSummary(garments, savedOutfits, profile);
  const advisorCtx = buildAdvisorWardrobeContext(
    garments,
    history,
    userMessage,
    profile,
    hasImages
  );

  const compactSaved =
    savedOutfits.length > 0
      ? savedOutfits
          .slice(0, 6)
          .map((o) => `${o.title} (${o.occasion}, score ${o.score})`)
          .join('; ')
      : 'None saved yet.';

  const recentTurns = formatCompactHistoryForAdvisor(history);

  const imageRules = hasImages
    ? `\nPHOTO BUY/COMPARE PROTOCOL (${attachedImages.length} item${attachedImages.length > 1 ? 's' : ''} uploaded: Option 1${attachedImages.length > 1 ? `..Option ${attachedImages.length}` : ''}):
- Visually inspect each uploaded item's exact color temperature, saturation, fabric drape/weight, construction quality, silhouette volume, and formality — and evaluate directly against the user's portrait & 12-season coloring.
- Structure your response cleanly in Markdown:
  1. **### Verdict** — Decisive **BUY**, **SKIP**, or **#1 Winner: Option X** with an honest **X/10 Wardrobe Fit** score (do not hesitate to say SKIP if it clashes, duplicates, or has poor proportions).
  2. **Why It Works (or Fails) on You** — Concrete color temperature, contrast, and silhouette geometry for THIS person.
  3. **Outfits You Can Build Immediately** — 2–3 real, properly layered outfits pairing the recommended buy with FRESH owned pieces from FRESH CLOSET SPOTLIGHT using [[item:GARMENT_ID|Exact Garment Name]] links.
  4. **Duplicate & ROI Check** — Call out overlap with existing owned pieces (link them!) or confirm the exact wardrobe gap it closes.`
    : '';

  const seasonRule =
    advisorCtx.effectiveSeason === 'Summer'
      ? '- STRICT SUMMER RULE: User is asking for Summer / hot weather. NEVER suggest sweaters, wool/merino/cashmere knits, hoodies, fleeces, corduroy, or winter coats. Only breathable shirts, tees, polos, linen, lightweight trousers/shorts, and light footwear.'
      : '- REAL-WORLD LAYERING RULE: Whenever you recommend a sweater, cardigan, pullover, vest, hoodie, or jacket, ALWAYS pair a concrete BASE underlayer (shirt, oxford, tee, or polo) underneath it and explain how the collar, cuffs, or hem interact.';

  const systemInstruction = `You are a sharp, opinionated, world-class Private Fashion Director & Shopping Advisor inside "What do I Wear?".
You have the taste of a senior editorial stylist from Milan/Paris/Tokyo combined with 12-season color analysis, proportion geometry, multi-layer dressing mastery, and ruthless wardrobe ROI discipline.

USER PROFILE & STORED PORTRAIT ANALYSIS${hasPortrait ? ' (User portrait photo attached — inspect their real skin undertone, hair/eye contrast, and frame directly)' : ''}:
${compactProfileSummary(profile)}

WARDROBE INTELLIGENCE SUMMARY (${garments.length} total pieces | ${advisorCtx.unexploredCount} pieces NOT YET discussed in this thread):
${wardrobeDna.compactDossier}

FRESH CLOSET SPOTLIGHT FOR THIS REQUEST (Top fresh, unexplored, ${advisorCtx.effectiveSeason}-appropriate matches — PRIORITIZE THESE FIRST):
${advisorCtx.spotlightSection}

PRE-VERIFIED MULTI-LAYER FRESH OUTFIT BLUEPRINTS (Already scored for OKLCH color harmony, proportion physics, 12-season flattery, thermal realism & anti-repetition — draw from or remix these when recommending outfits):
${advisorCtx.verifiedBlueprintsSection}

RECENTLY DISCUSSED ITEMS — COOLDOWN LIST (DO NOT REPEAT THESE unless the user explicitly asked about them in this message):
${advisorCtx.cooldownSection}

COMPLETE CATEGORIZED WARDROBE (${garments.length} items — ordered freshest & most query-relevant FIRST inside each category; items tagged |RECENTLY_USED are at the end):
${advisorCtx.categorizedCatalog}

SAVED LOOKS:
${compactSaved}

NON-NEGOTIABLE STYLING & INTELLIGENCE RULES:
1. **ZERO REPETITION / FULL-CLOSET MASTERY**: The user owns ${garments.length} distinct garments. Actively mine FRESH CLOSET SPOTLIGHT, PRE-VERIFIED BLUEPRINTS, and unexplored items across ALL categories. NEVER recycle items on the COOLDOWN LIST or marked |RECENTLY_USED unless the user explicitly named them in their message.
2. **NO 5-YEAR-OLD AI CLICHÉS**: Strictly FORBIDDEN phrases: "elevates your look", "effortless chic", "versatile staple", "ties everything together", "adds a pop of color", "perfect for any occasion", "balances the silhouette" (without explaining the exact cut/hem physics), or robotic filler intros ("Great question!", "I'd love to help!"). Jump straight into decisive, insightful styling advice.
3. **SARTORIAL PRECISION**: Talk like a real luxury stylist. Name exact fabrics, weights, color undertones, and physical styling moves (e.g., "unbutton the collar so the crisp poplin frames your jaw", "half-tuck to lengthen the leg line", "matte suede softens the crisp wool crease"). Give honest pushback when an idea or purchase doesn't suit them.
4. ${seasonRule}
5. **MANDATORY CLICKABLE HYPERLINKS**: Whenever you mention ANY piece from the user's wardrobe, ALWAYS format it as [[item:GARMENT_ID|Exact Garment Name]] using ONLY real GARMENT_IDs from the catalog above (never invent IDs for items they don't own).
6. **CLEAN MARKDOWN**: Use **bold** verdicts, ### section headers, and crisp bullet lists.
7. **SHOPPING RIGOR**: When recommending what to buy, specify exact shade/undertone, fabric/weight, cut/rise, price tier aligned to their ${profile.budgetRange} budget, and name specific owned pieces it unlocks.${imageRules}
8. Stay tight, high-signal, and scannable (under ${hasImages ? '360' : '310'} words unless they ask for a deep full-closet audit).`;

  const textPrompt = `${recentTurns ? `Recent conversation context:\n${recentTurns}\n\n` : ''}Current user request: ${userMessage}`;

  const multimodalParts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [];

  if (hasPortrait && portraitImage) {
    multimodalParts.push({
      text: '[User Stored Portrait Photo — reference their real skin tone, hair/eye contrast, and frame]',
    });
    multimodalParts.push({
      inlineData: {
        mimeType: portraitImage.mimeType,
        data: portraitImage.base64,
      },
    });
  }

  if (hasImages) {
    attachedImages.slice(0, 4).forEach((img, idx) => {
      const label = img.label?.trim() || `Option ${idx + 1}`;
      multimodalParts.push({ text: `[Uploaded Shopping Item — ${label}]` });
      multimodalParts.push({
        inlineData: {
          mimeType: img.mimeType,
          data: img.base64,
        },
      });
    });
  }

  if (multimodalParts.length > 0) {
    multimodalParts.push({ text: textPrompt });
  }

  const useWebSearch = advisorCtx.intent.needsWebSearch;

  const res = await executeWithModelHierarchy(tiers, async (tier) => {
    const response = await ai.models.generateContent({
      model: tier.model,
      contents: multimodalParts.length > 0 ? { parts: multimodalParts } : textPrompt,
      config: {
        systemInstruction,
        ...buildThinkingConfig(tier),
        ...(tier.supportsSearch && useWebSearch ? { tools: [{ googleSearch: {} }] } : {}),
      },
    });

    const rawContent = (response.text ?? '').trim();
    if (!rawContent) throw new Error('Empty advisor reply');

    // Extract Google Search grounding sources if present
    const rawChunks =
      response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const sources: GroundingSource[] = [];
    const seenUris = new Set<string>();
    for (const chunk of rawChunks) {
      const web = (chunk as { web?: { uri?: string; title?: string } }).web;
      if (web?.uri && !seenUris.has(web.uri)) {
        try {
          const parsedUrl = new URL(web.uri);
          if (parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:') {
            seenUris.add(web.uri);
            sources.push({
              title: web.title || parsedUrl.hostname,
              uri: parsedUrl.toString(),
            });
          }
        } catch {
          // Skip malformed URIs
        }
      }
    }

    // Validate & auto-repair all [[item:ID|Name]] hyperlinks so every mentioned garment is clickable
    const { content, referencedItemIds } = ensureGarmentHyperlinks(rawContent, garments);

    return { content, referencedItemIds, sources: sources.slice(0, 4) };
  });

  return { ...res.data, modelUsed: res.modelUsed };
}
