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
import { computeDeterministicVector, normalizeVector } from '../src/utils/styleEngine.ts';

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
    id: 'gemini-4-hydrogen (fast)',
    model: 'gemini-4-hydrogen',
    thinkingLevel: ThinkingLevel.LOW,
    supportsSearch: true,
  },
  {
    id: 'gemini-3.1-flash-lite (minimal)',
    model: 'gemini-3.1-flash-lite',
    thinkingLevel: ThinkingLevel.MINIMAL,
    supportsSearch: false,
  },
  {
    id: 'gemini-4-hydrogen (direct)',
    model: 'gemini-4-hydrogen',
    thinkingLevel: ThinkingLevel.LOW,
    supportsSearch: false,
  },
];

// Circuit-breaker cooldown map so rate-limited or unavailable models are skipped immediately
const modelCooldowns = new Map<string, number>();
const TRANSIENT_COOLDOWN_MS = 60_000;
const UNAVAILABLE_COOLDOWN_MS = 10 * 60_000;

export function clearModelCooldowns(): void {
  modelCooldowns.clear();
}

function getCooldownMsForError(message: string): number {
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
    upper.includes('QUOTA') ||
    upper.includes('503') ||
    upper.includes('UNAVAILABLE') ||
    upper.includes('OVERLOADED')
  ) {
    return TRANSIENT_COOLDOWN_MS;
  }
  return 0;
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
    console.warn(
      '[AI Hierarchy] Live model discovery unavailable, using verified static free-tier lineup:',
      err instanceof Error ? err.message : String(err)
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
  const now = Date.now();

  // Prioritize tiers whose model is not currently on cooldown; if all are cooling down, try all
  const healthyTiers = tiers.filter((t) => (modelCooldowns.get(t.model) ?? 0) <= now);
  const orderedTiers = healthyTiers.length > 0 ? healthyTiers : tiers;

  for (const tier of orderedTiers) {
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
      console.warn(`[AI Hierarchy] ${tier.id} failed, cascading to next model:`, msg);
    }
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
      `Blueprint:${profile.blueprint.colorSeason}; best:${profile.blueprint.bestColors.slice(0, 5).join(',')}; silhouettes:${profile.blueprint.idealSilhouettes.slice(0, 3).join(',')}; proportions:${profile.blueprint.proportionTips.slice(0, 2).join('; ')}`
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

  const prompt = `Forensically inspect this clothing item photo${fileNameHint ? ` (filename hint: ${fileNameHint})` : ''}. Identify exact garment type, fabric weave, weight, texture, fit/silhouette, pattern, primary color hex, undertone, formality (1-10), seasons, occasions, and concise styling guidance (<=20 words). Keep every field crisp and accurate.`;

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
          'You are a master fashion archivist and textile specialist. Output accurate, concise structured garment metadata with zero fluff.',
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
    try {
      const result = await ai.models.embedContent({
        model: attempt.model,
        contents: attempt.contents,
      });

      const values = result.embeddings?.[0]?.values;
      if (Array.isArray(values) && values.length > 0) {
        return {
          vector: normalizeVector(values),
          source: 'gemini-embedding-2',
        };
      }
    } catch (err) {
      console.warn(
        `[Vector Engine] ${attempt.model} failed, trying next vector fallback:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  return {
    vector: computeDeterministicVector(garment),
    source: 'semantic-fallback',
  };
}

/**
 * Ranks pre-screened vector-compatible outfit combinations using minimal tokens
 * (sends compact text lines only — never resends raw wardrobe photos).
 */
export async function rankCombinationsWithAI(
  candidates: CandidateCombination[],
  profile: UserProfile,
  occasion: OccasionType,
  season: SeasonTag
): Promise<{ combinations: OutfitCombination[]; modelUsed: string }> {
  const ai = getGenAIClient();
  const tiers = await resolveFullHierarchy(DEEP_REASONING_HIERARCHY, ai);

  const candidateLines = candidates.map((cand, idx) => {
    const itemDesc = cand.items.map((g) => compactGarmentLine(g)).join(' + ');
    return `C${idx + 1} [vecScore:${cand.vectorScore}, colorScore:${cand.colorScore}]: ${itemDesc}`;
  });

  const prompt = `Profile: ${compactProfileSummary(profile)}
Target Occasion: ${occasion} | Season: ${season}

Candidate outfits (pre-screened via image vector harmony):
${candidateLines.join('\n')}

Rank ALL ${candidates.length} candidates from best (rank 1) to lowest for THIS specific user's body proportions, undertone, fabric interplay, and occasion. Keep every explanation concise (1-2 crisp sentences max). Return valid JSON array sorted by rank ascending.`;

  const res = await executeWithModelHierarchy(tiers, async (tier) => {
    const response = await ai.models.generateContent({
      model: tier.model,
      contents: prompt,
      config: {
        systemInstruction:
          'You are an elite personal fashion stylist. Evaluate fabric weight harmony, fit/proportion balance, color undertone alignment, and occasion fit. Be sharp, specific, and concise to minimize tokens.',
        ...buildThinkingConfig(tier),
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              candidateIndex: { type: Type.INTEGER, description: '1-based index matching C1..CN' },
              title: { type: Type.STRING, description: 'Editorial 3-5 word look name' },
              score: { type: Type.INTEGER, description: 'Stylist accuracy score 60-99' },
              rationale: { type: Type.STRING, description: 'Why these pieces work together (<=24 words)' },
              fabricFitNotes: { type: Type.STRING, description: 'Fabric weight & silhouette interplay (<=20 words)' },
              bodyTailoringNote: { type: Type.STRING, description: 'How proportions flatter the user profile (<=20 words)' },
              finishingTouch: { type: Type.STRING, description: 'One actionable styling cue (<=16 words)' },
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
      mapped.push({
        id: `combo-${Date.now()}-${mapped.length + 1}`,
        title: entry.title || `Curated ${occasion} Look ${mapped.length + 1}`,
        source: 'ai',
        rank: mapped.length + 1,
        score: Math.max(55, Math.min(99, Math.round(Number(entry.score) || cand.localScore))),
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
    }

    return mapped.sort((a, b) => b.score - a.score).map((item, i) => ({ ...item, rank: i + 1 }));
  });

  return { combinations: res.data, modelUsed: res.modelUsed };
}

/**
 * Analyzes user's portrait photo + written profile ONCE and caches a compact Personal Styling Blueprint.
 */
export async function analyzeUserProfileWithAI(
  profile: UserProfile,
  photoBase64: string | null,
  photoMimeType: string | null
): Promise<{ blueprint: AIProfileBlueprint; modelUsed: string }> {
  const ai = getGenAIClient();
  const tiers = await resolveFullHierarchy(DEEP_REASONING_HIERARCHY, ai);

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
  if (photoBase64 && photoMimeType) {
    parts.push({ inlineData: { mimeType: photoMimeType, data: photoBase64 } });
  }
  parts.push({
    text: `Analyze this user's personal styling profile${photoBase64 ? ' and portrait photo' : ''}:
${compactProfileSummary(profile)}
Derive an encouraging, high-precision Personal Styling Blueprint covering color season, contrast level, best & avoid colors, ideal silhouettes, proportion tailoring tips, and recommended fabric weights. Keep every item crisp and actionable.`,
  });

  const res = await executeWithModelHierarchy(tiers, async (tier) => {
    const response = await ai.models.generateContent({
      model: tier.model,
      contents: { parts },
      config: {
        systemInstruction:
          'You are a respectful, observant personal image consultant. Focus on flattering color harmony, proportion geometry, and fabric drape tailored to the user.',
        ...buildThinkingConfig(tier),
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING, description: '2 crisp sentences summarizing their style signature' },
            colorSeason: { type: Type.STRING, description: 'e.g. Deep Autumn, Soft Summer, True Winter' },
            contrastLevel: { type: Type.STRING, description: 'Low, Medium, or High contrast' },
            bestColors: { type: Type.ARRAY, items: { type: Type.STRING } },
            avoidColors: { type: Type.ARRAY, items: { type: Type.STRING } },
            idealSilhouettes: { type: Type.ARRAY, items: { type: Type.STRING } },
            proportionTips: { type: Type.ARRAY, items: { type: Type.STRING } },
            recommendedFabrics: { type: Type.ARRAY, items: { type: Type.STRING } },
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
          ],
        },
      },
    });

    const parsed = safeParseJson<Omit<AIProfileBlueprint, 'analyzedAt' | 'modelUsed'>>(
      response.text,
      'Empty profile blueprint response'
    );

    return {
      ...parsed,
      bestColors: parsed.bestColors.slice(0, 6),
      avoidColors: parsed.avoidColors.slice(0, 4),
      idealSilhouettes: parsed.idealSilhouettes.slice(0, 4),
      proportionTips: parsed.proportionTips.slice(0, 4),
      recommendedFabrics: parsed.recommendedFabrics.slice(0, 5),
      analyzedAt: new Date().toISOString(),
      modelUsed: tier.id,
    } satisfies AIProfileBlueprint;
  });

  return { blueprint: res.data, modelUsed: res.modelUsed };
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

/**
 * Trend-aware Shopping Advisor with full compact wardrobe + profile visibility
 * and Google Search grounding on Tier 1, cascading smoothly across free-plan models.
 */
export async function chatWithShoppingAdvisor(
  userMessage: string,
  history: AdvisorMessage[],
  garments: Garment[],
  savedOutfits: OutfitCombination[],
  profile: UserProfile
): Promise<{
  content: string;
  referencedItemIds: string[];
  sources: GroundingSource[];
  modelUsed: string;
}> {
  const ai = getGenAIClient();
  const tiers = await resolveFullHierarchy(FAST_HIERARCHY, ai);

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
    .map((m) => `${m.role === 'user' ? 'User' : 'Advisor'}: ${m.content.slice(0, 400)}`)
    .join('\n');

  const systemInstruction = `You are the private Shopping & Trend Advisor inside "What do I Wear?".
You have complete visibility into the user's wardrobe, saved looks, and personal profile.
USER PROFILE: ${compactProfileSummary(profile)}
USER WARDROBE (${garments.length} items):
${compactWardrobe}
SAVED LOOKS: ${compactSaved}

Guidelines:
- Give sharp, honest, taste-driven shopping and trend advice grounded in what the user ALREADY owns (name their actual pieces!).
- Suggest specific silhouettes, fabrics, colors, and price-appropriate purchase targets that maximize outfit combinations per dollar.
- Keep responses crisp, structured with clean short paragraphs or simple dashes (under 220 words unless asked for more) so token usage stays lean and reading is effortless.`;

  const prompt = `${recentTurns ? `Recent conversation:\n${recentTurns}\n\n` : ''}User: ${userMessage}`;

  const res = await executeWithModelHierarchy(tiers, async (tier) => {
    const response = await ai.models.generateContent({
      model: tier.model,
      contents: prompt,
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

    // Detect which owned wardrobe items the advisor referenced by name
    const lower = content.toLowerCase();
    const referencedItemIds = garments
      .filter((g) => {
        const words = g.name
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length >= 4);
        return lower.includes(g.name.toLowerCase()) || words.filter((w) => lower.includes(w)).length >= 2;
      })
      .map((g) => g.id)
      .slice(0, 4);

    return { content, referencedItemIds, sources: sources.slice(0, 4) };
  });

  return { ...res.data, modelUsed: res.modelUsed };
}
