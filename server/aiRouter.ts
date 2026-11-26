import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  AIProfileBlueprint,
  AdvisorMessage,
  Garment,
  GarmentCategory,
  GroundingSource,
  OccasionType,
  OutfitCombination,
  SeasonTag,
  UserProfile,
} from '../src/types/styling.ts';
import type { CandidateCombination } from '../src/utils/styleEngine.ts';
import {
  computeDeterministicVector,
  computeWardrobeIntelligenceSummary,
  normalizeVector,
} from '../src/utils/styleEngine.ts';

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
    thinkingLevel: ThinkingLevel.MEDIUM,
    supportsSearch: true,
  },
  {
    id: 'gemini-4-hydrogen (fast)',
    model: 'gemini-4-hydrogen',
    thinkingLevel: ThinkingLevel.LOW,
    supportsSearch: true,
  },
  {
    id: 'gemini-3.1-flash-lite (reasoned)',
    model: 'gemini-3.1-flash-lite',
    thinkingLevel: ThinkingLevel.LOW,
    supportsSearch: false,
  },
  {
    id: 'gemini-3.1-flash-lite (minimal)',
    model: 'gemini-3.1-flash-lite',
    thinkingLevel: ThinkingLevel.MINIMAL,
    supportsSearch: false,
  },
];

export const FAST_HIERARCHY: ModelTier[] = [
  {
    id: 'gemini-3.1-flash-lite (minimal)',
    model: 'gemini-3.1-flash-lite',
    thinkingLevel: ThinkingLevel.MINIMAL,
    supportsSearch: false,
  },
  {
    id: 'gemini-3.1-flash-lite (reasoned)',
    model: 'gemini-3.1-flash-lite',
    thinkingLevel: ThinkingLevel.LOW,
    supportsSearch: false,
  },
  {
    id: 'gemini-4-hydrogen (fast)',
    model: 'gemini-4-hydrogen',
    thinkingLevel: ThinkingLevel.LOW,
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
  const lines = [
    `Name:${profile.name || 'User'}`,
    `Height:${profile.height || 'unspecified'}`,
    `Body:${profile.bodyType || 'unspecified'}`,
    `Undertone:${profile.skinUndertone}`,
    `Fits:${profile.preferredFits.join(',') || 'balanced'}`,
    `Style:${profile.styleAesthetics.join(',') || 'modern'}`,
    `Budget:${profile.budgetRange}`,
    `Climate:${profile.climate}`,
    profile.bio ? `Bio:${profile.bio.slice(0, 220)}` : '',
    profile.stylingGoals ? `Goals:${profile.stylingGoals.slice(0, 140)}` : '',
  ].filter(Boolean);

  if (profile.blueprint) {
    lines.push(
      `Blueprint:${profile.blueprint.colorSeason}(${profile.blueprint.contrastLevel} contrast); best:${profile.blueprint.bestColors.slice(0, 6).join(',')}; avoid:${profile.blueprint.avoidColors.slice(0, 4).join(',')}; silhouettes:${profile.blueprint.idealSilhouettes.slice(0, 3).join(',')}; proportions:${profile.blueprint.proportionTips.slice(0, 2).join('; ')}; fabrics:${profile.blueprint.recommendedFabrics.slice(0, 4).join(',')}`
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
  explorationMode: 'best' | 'fresh' = 'best'
): Promise<{ combinations: OutfitCombination[]; modelUsed: string }> {
  const ai = getGenAIClient();
  const tiers = await resolveFullHierarchy(DEEP_REASONING_HIERARCHY, ai);

  const targetCount = Math.min(5, candidates.length);
  const candidateLines = candidates.map((cand, idx) => {
    const itemDesc = cand.items.map((g) => compactGarmentLine(g)).join(' + ');
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

  const prompt = `USER STYLE PROFILE & 12-SEASON BLUEPRINT:
${compactProfileSummary(profile)}${savedTasteLine}

TARGET CONTEXT: Occasion=${occasion} | Season=${season} | ${modeNote}${cleanBrief ? `\nEXACT USER REQUEST / VIBE: "${cleanBrief}"` : ''}

PRE-SCREENED MMR CANDIDATE OUTFITS (OKLCH color, proportion/layering physics, 12-season personal fit, and 128-dim visual vectors):
${candidateLines.join('\n')}

TASK:
Act as an elite editorial personal stylist cross-encoder. Critically compare all ${candidates.length} candidates for THIS specific person's skin undertone, 12-season color palette (especially tops/outerwear near the face), natural contrast level, body proportions, fabric-weight layering physics, and occasion${cleanBrief ? ' + exact user request' : ''}.
- Select and rank the BEST ${targetCount} distinct outfits from rank 1 (strongest) to rank ${targetCount}${candidates.length > targetCount ? ` (drop the ${candidates.length - targetCount} weakest or most redundant candidates)` : ''}.
- Differentiate scores honestly (e.g. 95, 91, 87, 84, 80 — do NOT give every outfit the same inflated score).
- Make every explanation concrete and visual: reference real garment fabrics, color temperature near the face, silhouette/Rule-of-Thirds proportion balance, and one actionable styling cue (tucking, cuffing, open layer, or shoe/belt echo).
Return a valid JSON array of exactly ${targetCount} objects sorted by rank ascending.`;

  const res = await executeWithModelHierarchy(tiers, async (tier) => {
    const response = await ai.models.generateContent({
      model: tier.model,
      contents: prompt,
      config: {
        systemInstruction:
          'You are a world-class personal fashion director and 12-season color analyst. Judge outfits rigorously on complexion flattery near the face, OKLCH tonal/60-30-10 harmony, big-over-fitted silhouette balance, fabric-weight layering physics, and occasion precision. Be specific, editorial, and concise.',
        ...buildThinkingConfig(tier),
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              candidateIndex: { type: Type.INTEGER, description: '1-based index matching C1..CN' },
              title: { type: Type.STRING, description: 'Editorial 3-5 word look name' },
              score: { type: Type.INTEGER, description: 'Calibrated stylist score 65-98' },
              rationale: { type: Type.STRING, description: 'Why these pieces look great on this person (<=28 words)' },
              fabricFitNotes: { type: Type.STRING, description: 'Fabric texture, weight layering & volume interplay (<=24 words)' },
              bodyTailoringNote: { type: Type.STRING, description: 'How colors near the face & proportions flatter their profile (<=24 words)' },
              finishingTouch: { type: Type.STRING, description: 'One concrete styling move e.g. French tuck, rolled cuff, unbuttoned drape (<=18 words)' },
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
        season,
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

const PROFILE_FIT_OPTIONS = ['Tailored', 'Relaxed', 'Structured', 'Oversized', 'Slim', 'Cropped'];
const PROFILE_AESTHETIC_OPTIONS = [
  'Quiet Luxury',
  'Architectural Minimalism',
  'Modern Tailoring',
  'Smart Streetwear',
  'Classic Ivy',
  'Avant-Garde',
];
const PROFILE_SKIN_UNDERTONES: Array<UserProfile['skinUndertone']> = [
  'Warm',
  'Cool',
  'Neutral',
  'Olive',
];

/**
 * Analyzes user's portrait photo + written profile ONCE, caches a compact Personal Styling Blueprint,
 * AND infers flattering style profile fields (skin undertone, body proportions, best fits, aesthetics, styling goals)
 * to auto-fill the user's style profile and personalize recommendations site-wide.
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
    text: `Analyze this user's personal styling profile${photoBase64 ? ' and portrait photo carefully (inspect skin undertone, hair/eye contrast, face & shoulder proportions, and natural vibe)' : ''}:
${compactProfileSummary(profile)}
Derive an encouraging, high-precision Personal Styling Blueprint covering what will look BEST on THIS specific person: color season, contrast level, best & avoid colors, ideal silhouettes, proportion tailoring tips, and recommended fabric weights.
ALSO auto-fill their ideal style profile fields:
- detectedSkinUndertone: one of Warm, Cool, Neutral, Olive
- detectedBodyType: concise 2-4 word frame/build note (e.g. "Balanced Athletic", "Lean Proportional", "Broad Shoulders")
- recommendedFits: 2-3 choices ONLY from [${PROFILE_FIT_OPTIONS.join(', ')}]
- recommendedAesthetics: 2-3 choices ONLY from [${PROFILE_AESTHETIC_OPTIONS.join(', ')}]
- personalizedStylingGoal: 1 crisp sentence describing what looks sharpest on them.`,
  });

  const res = await executeWithModelHierarchy(tiers, async (tier) => {
    const response = await ai.models.generateContent({
      model: tier.model,
      contents: { parts },
      config: {
        systemInstruction:
          'You are a respectful, observant master image consultant and color analyst. Focus on flattering color harmony, skin undertone accuracy, proportion geometry, and fabric drape tailored specifically to this individual.',
        ...buildThinkingConfig(tier),
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING, description: '2 crisp sentences summarizing what looks best on this person' },
            colorSeason: { type: Type.STRING, description: 'e.g. Deep Autumn, Soft Summer, True Winter' },
            contrastLevel: { type: Type.STRING, description: 'Low, Medium, or High contrast' },
            bestColors: { type: Type.ARRAY, items: { type: Type.STRING } },
            avoidColors: { type: Type.ARRAY, items: { type: Type.STRING } },
            idealSilhouettes: { type: Type.ARRAY, items: { type: Type.STRING } },
            proportionTips: { type: Type.ARRAY, items: { type: Type.STRING } },
            recommendedFabrics: { type: Type.ARRAY, items: { type: Type.STRING } },
            detectedSkinUndertone: { type: Type.STRING, description: 'One of: Warm, Cool, Neutral, Olive' },
            detectedBodyType: { type: Type.STRING, description: 'Concise respectful frame/build note' },
            recommendedFits: { type: Type.ARRAY, items: { type: Type.STRING } },
            recommendedAesthetics: { type: Type.ARRAY, items: { type: Type.STRING } },
            personalizedStylingGoal: { type: Type.STRING, description: '1 crisp sentence tailored to what looks best on them' },
          },
          required: [
            'summary',
            'colorSeason',
            'contrastLevel',
            'bestColors',
            'avoidColors',
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

    const blueprint: AIProfileBlueprint = {
      summary: parsed.summary,
      colorSeason: parsed.colorSeason,
      contrastLevel: parsed.contrastLevel,
      bestColors: (parsed.bestColors ?? []).slice(0, 6),
      avoidColors: (parsed.avoidColors ?? []).slice(0, 4),
      idealSilhouettes: (parsed.idealSilhouettes ?? []).slice(0, 4),
      proportionTips: (parsed.proportionTips ?? []).slice(0, 4),
      recommendedFabrics: (parsed.recommendedFabrics ?? []).slice(0, 5),
      analyzedAt: new Date().toISOString(),
      modelUsed: tier.id,
    };

    const matchedUndertone = PROFILE_SKIN_UNDERTONES.find(
      (u) => u.toLowerCase() === (parsed.detectedSkinUndertone ?? '').trim().toLowerCase()
    );
    const matchedFits = (parsed.recommendedFits ?? [])
      .map((f) => PROFILE_FIT_OPTIONS.find((opt) => opt.toLowerCase() === f.trim().toLowerCase()))
      .filter((f): f is string => Boolean(f))
      .slice(0, 3);
    const matchedAesthetics = (parsed.recommendedAesthetics ?? [])
      .map((a) =>
        PROFILE_AESTHETIC_OPTIONS.find((opt) => opt.toLowerCase() === a.trim().toLowerCase())
      )
      .filter((a): a is string => Boolean(a))
      .slice(0, 3);

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
  occasion: OccasionType
): Promise<{
  score: number;
  rationale: string;
  fabricFitNotes: string;
  bodyTailoringNote: string;
  finishingTouch: string;
  modelUsed: string;
}> {
  const ai = getGenAIClient();
  const tiers = await resolveFullHierarchy(FAST_HIERARCHY, ai);
  const prompt = `Profile: ${compactProfileSummary(profile)}
Occasion: ${occasion}
Custom outfit selected by user:
${items.map((g) => compactGarmentLine(g)).join('\n')}
Evaluate this custom combination with honest, constructive precision.`;

  const res = await executeWithModelHierarchy(tiers, async (tier) => {
    const response = await ai.models.generateContent({
      model: tier.model,
      contents: prompt,
      config: {
        systemInstruction:
          'You are an expert personal stylist reviewing a client-built outfit. Be concise, accurate, and actionable.',
        ...buildThinkingConfig(tier),
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.INTEGER },
            rationale: { type: Type.STRING },
            fabricFitNotes: { type: Type.STRING },
            bodyTailoringNote: { type: Type.STRING },
            finishingTouch: { type: Type.STRING },
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
      score: Math.max(40, Math.min(99, Math.round(Number(parsed.score) || 82))),
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
 * Engine-Backed Editorial Shopping & Trend Advisor:
 * Injects real-time Wardrobe DNA telemetry (OKLCH color/undertone balance, formality mix,
 * unworn pieces, blueprint alignment, high-ROI gaps) + full compact wardrobe + multimodal
 * store-item photo comparison (up to 4 photos) + Google Search grounding.
 */
export async function chatWithShoppingAdvisor(
  userMessage: string,
  history: AdvisorMessage[],
  garments: Garment[],
  savedOutfits: OutfitCombination[],
  profile: UserProfile,
  attachedImages: AdvisorImageInput[] = []
): Promise<{
  content: string;
  referencedItemIds: string[];
  sources: GroundingSource[];
  modelUsed: string;
}> {
  const ai = getGenAIClient();
  const tiers = await resolveFullHierarchy(DEEP_REASONING_HIERARCHY, ai);

  const wardrobeDna = computeWardrobeIntelligenceSummary(garments, savedOutfits, profile);

  const compactWardrobe =
    garments.length > 0
      ? garments.map((g) => compactGarmentLine(g)).join('\n')
      : 'Wardrobe is currently empty.';

  const compactSaved =
    savedOutfits.length > 0
      ? savedOutfits
          .slice(0, 6)
          .map((o) => `${o.title} (${o.occasion}, score ${o.score}): [${o.itemIds.join(',')}]`)
          .join('; ')
      : 'None saved yet.';

  const recentTurns = history
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'Advisor'}: ${m.content.slice(0, 420)}`)
    .join('\n');

  const hasImages = attachedImages.length > 0;
  const imageRules = hasImages
    ? `\nPHOTO BUY/COMPARE PROTOCOL (${attachedImages.length} item${attachedImages.length > 1 ? 's' : ''} uploaded: Option 1${attachedImages.length > 1 ? `..Option ${attachedImages.length}` : ''}):
- Visually inspect each uploaded item's color temperature, saturation, fabric drape/weight, silhouette volume, and formality.
- Structure your response cleanly in Markdown:
  1. **### Verdict** — Clear **BUY**, **SKIP**, or **#1 Winner: Option X** plus a calibrated **X/10 Wardrobe Fit** score.
  2. **Why It Works (or Doesn't) on You** — Evaluate against their exact 12-season color palette, skin undertone, natural contrast level, and body proportions.
  3. **Outfits You Can Build Immediately** — Give 2–3 specific, wear-ready outfits pairing the recommended buy with their actual owned pieces using [[item:GARMENT_ID|Exact Garment Name]] links.
  4. **Duplicate & ROI Check** — Flag if they already own something redundant (link the owned item!) or confirm which wardrobe gap it solves.`
    : '';

  const systemInstruction = `You are the Private Editorial Stylist & Shopping Advisor inside "What do I Wear?".
You combine 12-season color theory, proportion geometry, live fashion trends, and strict cost-per-wear / outfit-multiplier discipline.

USER PROFILE & PERSONAL BLUEPRINT:
${compactProfileSummary(profile)}

WARDROBE DNA TELEMETRY (computed live):
${wardrobeDna.compactDossier}

USER WARDROBE (${garments.length} items — format: ID|Name|Category/Sub|Color(Hex,Undertone)|Fabric|Fit|Pattern|Formality|Seasons):
${compactWardrobe}

SAVED LOOKS:
${compactSaved}

Guidelines:
- Give decisive, honest, taste-driven advice grounded strictly in what looks BEST on THIS specific person and what they ALREADY own.
- ALWAYS hyperlink any clothing piece you mention from USER WARDROBE using the exact syntax [[item:GARMENT_ID|Exact Garment Name]] (for example: [[item:garment_abc123|Ivory Merino Crewneck]]). Only use real GARMENT_IDs listed above—never invent IDs for items they do not own.
- Use clean Markdown formatting (**bold** for verdicts and key takeaways, ### headings when structuring sections, *italics* for styling nuances, and "-" bullet points).
- Whenever recommending a purchase, specify exact color/undertone, fabric/weight, silhouette cut, and how many new outfits it unlocks with their current closet.${imageRules}
- Keep responses sharp, editorial, and effortless to scan (under ${hasImages ? '340' : '270'} words unless the user asks for an in-depth audit).`;

  const textPrompt = `${recentTurns ? `Recent conversation:\n${recentTurns}\n\n` : ''}User: ${userMessage}`;

  const multimodalParts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [];

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
    multimodalParts.push({ text: textPrompt });
  }

  const res = await executeWithModelHierarchy(tiers, async (tier) => {
    const response = await ai.models.generateContent({
      model: tier.model,
      contents: hasImages ? { parts: multimodalParts } : textPrompt,
      config: {
        systemInstruction,
        ...buildThinkingConfig(tier),
        ...(tier.supportsSearch ? { tools: [{ googleSearch: {} }] } : {}),
      },
    });

    const content = (response.text ?? '').trim();
    if (!content) throw new Error('Empty advisor reply');

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

    // Detect which owned wardrobe items the advisor referenced (explicit [[item:ID|Name]] tags first, then exact/name fallback)
    const validGarmentIds = new Set(garments.map((g) => g.id));
    const referencedSet = new Set<string>();
    const tagRegex = /\[\[(?:item|garment):([a-zA-Z0-9_-]+)(?:\|[^\]]+)?\]\]/g;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = tagRegex.exec(content)) !== null) {
      if (validGarmentIds.has(tagMatch[1])) {
        referencedSet.add(tagMatch[1]);
      }
    }

    const lower = content.toLowerCase();
    for (const g of garments) {
      if (referencedSet.size >= 6) break;
      if (referencedSet.has(g.id)) continue;
      const words = g.name
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length >= 4);
      if (
        lower.includes(g.name.toLowerCase()) ||
        (words.length >= 2 && words.filter((w) => lower.includes(w)).length >= 2)
      ) {
        referencedSet.add(g.id);
      }
    }
    const referencedItemIds = Array.from(referencedSet).slice(0, 6);

    return { content, referencedItemIds, sources: sources.slice(0, 4) };
  });

  return { ...res.data, modelUsed: res.modelUsed };
}
