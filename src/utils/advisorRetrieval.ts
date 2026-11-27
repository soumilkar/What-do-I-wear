import type {
  AdvisorMessage,
  Garment,
  OccasionType,
  OutfitCombination,
  SeasonTag,
  UserProfile,
} from '../types/styling.ts';
import {
  buildCrossVerifiedStylingGuidance,
  classifyTopLayerRole,
  computeDeterministicVector,
  evaluateBaseUnderMidCompatibility,
  findBestCompanions,
  generateCandidateCombinations,
  inferEffectiveSeason,
  isSummerUnsuitable,
  isWinterUnsuitable,
  scoreGarmentForPerson,
} from './styleEngine.ts';

export type AdvisorReplyMode = 'quick' | 'standard' | 'deep';

export interface AdvisorIntent {
  needsWebSearch: boolean;
  wantsOutfits: boolean;
  wantsShoppingAdvice: boolean;
  inferredOccasion: OccasionType;
}

export interface AdvisorHistoryWindow {
  recentMessages: AdvisorMessage[];
  olderMessages: AdvisorMessage[];
  newlyEvictedMessages: AdvisorMessage[];
  needsSummarization: boolean;
  totalHistoryChars: number;
  recentChars: number;
  recentFormatted: string;
}

export interface AdvisorWardrobeContext {
  intent: AdvisorIntent;
  replyMode: AdvisorReplyMode;
  effectiveSeason: SeasonTag;
  spotlightIds: string[];
  recentlyMentionedIds: string[];
  unexploredCount: number;
  ownedInventorySummary: string;
  layeringGuideSection: string;
  spotlightSection: string;
  verifiedBlueprintsSection: string;
  cooldownSection: string;
  categorizedCatalog: string;
}

function stableHash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const STOP_WORDS = new Set([
  'with', 'that', 'this', 'from', 'for', 'the', 'and', 'but', 'look', 'looks',
  'outfit', 'outfits', 'wear', 'wearing', 'something', 'want', 'need', 'like',
  'good', 'nice', 'style', 'styled', 'vibe', 'vibes', 'some', 'very', 'more',
  'into', 'going', 'today', 'tonight', 'please', 'make', 'give', 'what', 'which',
  'should', 'could', 'would', 'about', 'have', 'clothes', 'wardrobe', 'closet',
  'pieces', 'items', 'recommend', 'suggest', 'tell', 'show', 'best', 'different',
]);

function extractQueryTokens(message: string): string[] {
  return message
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t))
    .slice(0, 16);
}

/**
 * Classifies what the user is actually asking so the Advisor routes Google Search,
 * pre-computed outfit assembly, and tone intelligently instead of acting generic.
 */
export function detectAdvisorIntent(
  userMessage: string,
  hasAttachedImages = false
): AdvisorIntent {
  const lower = userMessage.toLowerCase();

  const wantsShoppingAdvice =
    hasAttachedImages ||
    /\b(buy|buying|shop|shopping|purchase|worth it|brand|brands|store|stores|price|budget|under \$|missing|gap|gaps|add to my|upgrade|invest|trend|trends|trending|2025|2026|2027|replace|dupes?|alternative)\b/.test(
      lower
    );

  // Only enable web search grounding when the user asks about live trends, brands, stores, or buying —
  // NOT on pure "what should I wear from my closet" prompts where search distracts from their 44 garments.
  const needsWebSearch =
    !hasAttachedImages &&
    /\b(trend|trends|trending|2025|2026|2027|brand|brands|where to buy|store|stores|shop for|best .+ to buy|currently in style|fashion week|runway)\b/.test(
      lower
    );

  const wantsOutfits =
    /\b(wear|outfit|outfits|look|looks|pair|pairing|style|styling|combine|combination|dress|dressed|date|dinner|wedding|interview|office|work|party|trip|vacation|travel|weekend|night out|tonight|today|tomorrow|summer|winter|spring|fall|autumn|unworn|fresh|different|layer|layered)\b/.test(
      lower
    );

  let inferredOccasion: OccasionType = 'Smart Casual';
  if (/\b(wedding|black[\s-]?tie|gala|formal|suit|interview|boardroom|ceremony)\b/.test(lower)) {
    inferredOccasion = 'Formal';
  } else if (/\b(date|dinner|evening|bar|club|cocktail|night\s*out|party|concert)\b/.test(lower)) {
    inferredOccasion = 'Evening';
  } else if (/\b(street|streetwear|skate|hype|sneaker|edgy|urban|hoodie)\b/.test(lower)) {
    inferredOccasion = 'Streetwear';
  } else if (/\b(travel|flight|airport|vacation|resort|trip|pack|packing)\b/.test(lower)) {
    inferredOccasion = 'Travel';
  } else if (/\b(casual|everyday|chill|coffee|errands|weekend|laid[\s-]?back|relaxed|hangout)\b/.test(lower)) {
    inferredOccasion = 'Everyday';
  }

  return {
    needsWebSearch,
    wantsOutfits,
    wantsShoppingAdvice,
    inferredOccasion,
  };
}

/**
 * Extracts garments recently mentioned by the Advisor across recent chat history,
 * weighted so the most recent turns carry the strongest anti-repetition cooldown.
 */
export function extractRecentlyMentionedIds(
  history: AdvisorMessage[],
  garments: Garment[]
): Map<string, number> {
  const counts = new Map<string, number>();
  const validIds = new Set(garments.map((g) => g.id));
  const assistantTurns = history.filter((m) => m.role === 'assistant').slice(-8);

  const newestFirst = [...assistantTurns].reverse();
  const tagRegex = /\[\[(?:item|garment):([a-zA-Z0-9_-]+)(?:\|[^\]]+)?\]\]/g;

  newestFirst.forEach((turn, idx) => {
    const recencyWeight = idx === 0 ? 3 : idx === 1 ? 2 : 1;
    const hitInTurn = new Set<string>();

    if (Array.isArray(turn.referencedItemIds)) {
      for (const id of turn.referencedItemIds) {
        if (validIds.has(id)) hitInTurn.add(id);
      }
    }

    const content = turn.content || '';
    tagRegex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = tagRegex.exec(content)) !== null) {
      if (validIds.has(m[1])) hitInTurn.add(m[1]);
    }

    const lower = content.toLowerCase();
    for (const g of garments) {
      const nameLower = g.name.trim().toLowerCase();
      if (nameLower.length >= 5 && lower.includes(nameLower)) {
        hitInTurn.add(g.id);
      }
    }

    for (const id of hitInTurn) {
      counts.set(id, (counts.get(id) ?? 0) + recencyWeight);
    }
  });

  return counts;
}

/**
 * Detects garments the user explicitly asked about in their current message so we NEVER
 * suppress an item they specifically requested.
 */
export function extractExplicitlyAskedIds(
  userMessage: string,
  garments: Garment[]
): Set<string> {
  const asked = new Set<string>();
  const lower = userMessage.toLowerCase();

  const tagRegex = /\[\[(?:item|garment):([a-zA-Z0-9_-]+)(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(userMessage)) !== null) {
    asked.add(m[1]);
  }

  for (const g of garments) {
    const nameLower = g.name.trim().toLowerCase();
    if (nameLower.length >= 4 && lower.includes(nameLower)) {
      asked.add(g.id);
    }
  }
  return asked;
}

/**
 * Classifies how concise or comprehensive the Advisor's answer should be so we save tokens
 * and latency when a direct, punchy answer is all the user needs.
 */
export function classifyAdvisorQueryMode(
  userMessage: string,
  history: AdvisorMessage[] = [],
  hasAttachedImages = false,
  imageCount = 0
): AdvisorReplyMode {
  const clean = userMessage.trim();
  const lower = clean.toLowerCase();

  // Deep mode: multi-photo comparison, full-closet/wardrobe audits, capsule/packing plans, or multi-outfit requests
  if (hasAttachedImages && imageCount >= 2) return 'deep';
  if (
    /\b(audit|full closet|entire wardrobe|capsule|pack|packing|week of outfits|3[\s-]?day|5[\s-]?day|7[\s-]?day|compare|versus|\bvs\.?\b|deep dive|trends? (?:for|that)|2025|2026|2027|detailed|thorough|everything i own|wardrobe gaps|rank my)\b/.test(
      lower
    )
  ) {
    return 'deep';
  }
  if (/\b(3|4|5|three|four|five|several|multiple)\s+(fresh\s+|flattering\s+|different\s+)?(outfits?|looks?|combos?|combinations?)\b/.test(lower)) {
    return 'deep';
  }

  // Standard mode: single uploaded shopping photo or explicit full outfit / shopping advice request
  if (hasAttachedImages) return 'standard';
  if (
    /\b(build|create|put together|plan|style me|what should i wear|outfit for|outfits for|look for|recommend .+ to buy|what should i buy|high[\s-]?roi|multiplier)\b/.test(
      lower
    )
  ) {
    return 'standard';
  }

  // Quick mode: crisp, direct questions, yes/no checks, color/shoe/swap tweaks, or short follow-ups
  const isShort = clean.length <= 150;
  const isDirectQuestion =
    /^(can i|should i|do |does |will |would |is |are |what color|which color|which shoe|what shoes|how about|what about|swap|instead|yes or no|quick question|does this|do these|better with|ok with|okay with|good with|tuck|untuck|roll|cuff)/i.test(
      clean
    ) ||
    (isShort &&
      history.length >= 2 &&
      !/\b(outfit|outfits|capsule|audit|pack|compare|trend|wardrobe)\b/.test(lower));

  if (isShort && isDirectQuestion) return 'quick';
  if (clean.length <= 65 && !/\b(outfit|outfits|buy|shop|audit|trend|compare)\b/.test(lower)) {
    return 'quick';
  }

  return 'standard';
}

/**
 * Splits chat history into an active verbatim sliding context window + older evicted turns
 * that should be compressed into a rolling conversation memory summary.
 */
export function partitionAdvisorHistory(
  history: AdvisorMessage[],
  options?: {
    maxRecentMessages?: number;
    maxRecentChars?: number;
    existingSummary?: string;
    summarizedCount?: number;
  }
): AdvisorHistoryWindow {
  const maxRecentMessages = Math.max(2, options?.maxRecentMessages ?? 6);
  const maxRecentChars = Math.max(600, options?.maxRecentChars ?? 2400);
  const existingSummary = (options?.existingSummary ?? '').trim();
  const prevSummarizedCount = Math.max(0, options?.summarizedCount ?? 0);

  // Exclude synthetic welcome greeting from summarization noise if present at index 0
  const meaningful = history.filter((m) => Boolean((m.content || '').trim()));
  const totalHistoryChars = meaningful.reduce((sum, m) => sum + (m.content || '').length, 0);

  // Walk backwards from most recent message to pack the active verbatim context window
  const recentReversed: AdvisorMessage[] = [];
  let recentChars = 0;

  for (let i = meaningful.length - 1; i >= 0; i--) {
    const msg = meaningful[i];
    const msgLen = (msg.content || '').length;
    const mustKeep = recentReversed.length < 2; // Always keep at least the latest exchange verbatim
    if (
      !mustKeep &&
      (recentReversed.length >= maxRecentMessages || recentChars + msgLen > maxRecentChars)
    ) {
      break;
    }
    recentReversed.push(msg);
    recentChars += msgLen;
  }

  const recentMessages = recentReversed.reverse();
  const splitIndex = Math.max(0, meaningful.length - recentMessages.length);
  const olderMessages = meaningful.slice(0, splitIndex);

  // Only summarize newly evicted turns beyond what's already captured in existingSummary
  const effectivePrevCount = existingSummary
    ? Math.min(prevSummarizedCount, olderMessages.length)
    : 0;
  const newlyEvictedMessages = olderMessages.slice(effectivePrevCount);
  const needsSummarization =
    olderMessages.length > 0 && (newlyEvictedMessages.length > 0 || !existingSummary);

  const recentFormatted = formatCompactHistoryForAdvisor(recentMessages);

  return {
    recentMessages,
    olderMessages,
    newlyEvictedMessages,
    needsSummarization,
    totalHistoryChars,
    recentChars,
    recentFormatted,
  };
}

/**
 * Deterministic extractive fallback summary used if LLM memory compression is skipped or rate-limited.
 * Captures user goals, preferences, events, dislikes, and key pieces discussed within <= 700 chars.
 */
export function buildDeterministicFallbackSummary(
  existingSummary: string,
  newlyEvictedTurns: AdvisorMessage[]
): string {
  const lines: string[] = [];
  if (existingSummary.trim()) {
    lines.push(existingSummary.trim());
  }

  for (const turn of newlyEvictedTurns) {
    const cleaned = (turn.content || '')
      .replace(/\[\[(?:item|garment):[a-zA-Z0-9_-]+\|([^\]]+)\]\]/g, '$1')
      .replace(/[#*_`]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) continue;

    if (turn.role === 'user') {
      lines.push(`- User asked/noted: ${cleaned.slice(0, 140)}`);
    } else {
      const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0] || cleaned;
      lines.push(`- Advisor advised: ${firstSentence.slice(0, 120)}`);
    }
  }

  // Keep only the most recent compact memory lines within ~720 chars
  const deduped = Array.from(new Set(lines));
  let result = deduped.slice(-7).join('\n');
  if (result.length > 720) {
    result = result.slice(result.length - 720).replace(/^[^\n]*\n/, '');
  }
  return result.trim();
}

/**
 * Sanitizes partially streamed markdown so users never see broken raw [[item:id|... syntax
 * while tokens are still arriving word-by-word.
 */
export function sanitizeStreamingMarkdown(rawText: string): string {
  if (!rawText) return '';
  // If the trailing edge has an incomplete [[item:id|Partial Name tag, show only the readable label (or hide raw id)
  return rawText.replace(/\[\[(?:item|garment):[^\]\n]*$/i, (tail) => {
    const pipeIdx = tail.indexOf('|');
    if (pipeIdx !== -1) {
      return tail.slice(pipeIdx + 1);
    }
    return '';
  });
}

/**
 * Condenses prior conversation turns so the Advisor retains conversational continuity
 * without previous garment names creating an echo chamber in the prompt.
 */
export function formatCompactHistoryForAdvisor(history: AdvisorMessage[]): string {
  const recent = history.slice(-6);
  if (recent.length === 0) return '';

  return recent
    .map((m) => {
      const raw = (m.content || '').trim();
      if (m.role === 'user') {
        return `User: ${raw.slice(0, 260)}`;
      }
      // Replace inline garment links with a short summary marker so old garment names don't hijack attention
      const stripped = raw
        .replace(/\[\[(?:item|garment):[a-zA-Z0-9_-]+\|([^\]]+)\]\]/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
      return `Advisor (prior turn — already discussed, do NOT repeat those same pieces): ${stripped.slice(0, 200)}`;
    })
    .join('\n');
}

/**
 * Post-processes Advisor markdown so:
 * 1. Valid [[item:ID|Name]] tags always display the exact garment name.
 * 2. Hallucinated [[item:BAD_ID|Name]] tags are gracefully unwrapped to plain text.
 * 3. Plain-text mentions of owned garment names are automatically upgraded into clickable [[item:ID|Name]] links.
 * 4. Returns up to 6 unique referencedItemIds for the UI chip bar while preserving unlimited inline links.
 */
export function ensureGarmentHyperlinks(
  rawContent: string,
  garments: Garment[]
): { content: string; referencedItemIds: string[] } {
  const byId = new Map(garments.map((g) => [g.id, g]));
  const referencedSet = new Set<string>();

  // Step 1: Validate existing [[item:ID|Label]] tags
  let content = rawContent.replace(
    /\[\[(?:item|garment):([a-zA-Z0-9_-]+)(?:\|([^\]]+))?\]\]/g,
    (_full, id: string, label?: string) => {
      const match = byId.get(id);
      if (match) {
        referencedSet.add(match.id);
        return `[[item:${match.id}|${match.name}]]`;
      }
      // Try exact name fallback if model hallucinated an ID for a real item name
      const cleanLabel = (label || '').trim();
      if (cleanLabel) {
        const byName = garments.find(
          (g) => g.name.trim().toLowerCase() === cleanLabel.toLowerCase()
        );
        if (byName) {
          referencedSet.add(byName.id);
          return `[[item:${byName.id}|${byName.name}]]`;
        }
        return cleanLabel;
      }
      return '';
    }
  );

  // Step 2: Upgrade plain-text mentions of exact owned garment names (longest first) outside existing [[...]] tags
  const sortedByNameLen = [...garments]
    .filter((g) => g.name.trim().length >= 5)
    .sort((a, b) => b.name.trim().length - a.name.trim().length);

  for (const g of sortedByNameLen) {
    const escapedName = g.name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nameRegex = new RegExp(`(?<![\\w|])${escapedName}(?![\\w\\]])`, 'gi');

    // Split around existing [[item:...]] spans so we never nest links
    const segments = content.split(/(\[\[(?:item|garment):[^\]]+\]\])/g);
    let mutated = false;
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].startsWith('[[')) continue;
      if (nameRegex.test(segments[i])) {
        nameRegex.lastIndex = 0;
        segments[i] = segments[i].replace(nameRegex, `[[item:${g.id}|${g.name}]]`);
        referencedSet.add(g.id);
        mutated = true;
      }
    }
    if (mutated) {
      content = segments.join('');
    }
  }

  // Step 3: Collect referencedItemIds for the clickable outfit chip bar below the message.
  // Keep ALL inline [[item:...]] links clickable in text, but exclude items mentioned ONLY inside
  // "What NOT to wear / Skip / Avoid" lines or sections from the recommended outfit chip bar.
  const recommendedSet = new Set<string>();
  const allLinkedSet = new Set<string>();
  const tagScan = /\[\[(?:item|garment):([a-zA-Z0-9_-]+)(?:\|[^\]]+)?\]\]/g;
  const avoidHeaderRe = /^#{1,4}\s*.*(what\s+not\s+to\s+wear|do\s+not\s+wear|don't\s+wear|avoid|skip|leave\s+in\s+the\s+closet)/i;
  const avoidLineRe = /(what\s+not\s+to\s+wear|do\s+not\s+wear|don't\s+wear|do\s+not\s+layer|don't\s+layer|avoid\s+pairing|avoid\s+wearing|avoid\s+layering|skip\s+wearing|skip\s+the|leave\s+.+\s+in\s+the\s+closet)/i;
  let inAvoidSection = false;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (/^#{1,4}\s+/.test(trimmed)) {
      inAvoidSection = avoidHeaderRe.test(trimmed);
    }
    const lineIsAvoid = inAvoidSection || avoidLineRe.test(trimmed);

    tagScan.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = tagScan.exec(line)) !== null) {
      const id = m[1];
      if (!byId.has(id)) continue;
      allLinkedSet.add(id);
      if (!lineIsAvoid) {
        recommendedSet.add(id);
      }
    }
  }

  const finalReferenced =
    recommendedSet.size > 0
      ? Array.from(recommendedSet).slice(0, 14)
      : Array.from(allLinkedSet.size > 0 ? allLinkedSet : referencedSet).slice(0, 14);

  return {
    content,
    referencedItemIds: finalReferenced,
  };
}

function formatCompactLine(g: Garment, recentlyUsed: boolean): string {
  const roleTag =
    g.category === 'tops'
      ? classifyTopLayerRole(g) === 'mid'
        ? 'MID'
        : 'BASE'
      : g.category.toUpperCase();
  const flag = recentlyUsed ? '|RECENTLY_USED' : '';
  return `${g.id}|${g.name}|${roleTag}/${g.subCategory}|${g.primaryColor}(${g.colorHex},${g.undertone})|${g.fabric}(${g.fabricWeight})|${g.fit}|${g.pattern}|F${g.formality}|${g.seasons.join('/')}${flag}`;
}

function scoreGarmentForAdvisorTurn(
  g: Garment,
  tokens: string[],
  lowerMsg: string,
  effectiveSeason: SeasonTag,
  profile: UserProfile,
  recentWeight: number,
  explicitlyAsked: boolean,
  turnSeed: string
): number {
  let score = scoreGarmentForPerson(g, profile);

  const blob = `${g.name} ${g.category} ${g.subCategory} ${g.primaryColor} ${g.fabric} ${g.fit} ${g.silhouette} ${g.pattern} ${g.occasions.join(' ')} ${g.seasons.join(' ')}`.toLowerCase();
  for (const token of tokens) {
    if (blob.includes(token)) score += 9;
  }

  if (/\b(formal|suit|wedding|interview|business|office|work)\b/.test(lowerMsg) && g.formality >= 7) {
    score += 10;
  }
  if (/\b(casual|chill|weekend|street|everyday|coffee|relaxed)\b/.test(lowerMsg) && g.formality <= 5) {
    score += 8;
  }
  if (/\b(date|dinner|evening|night\s*out|party|bar)\b/.test(lowerMsg) && g.formality >= 6) {
    score += 9;
  }
  if (/\b(layer|layered|layering|cold|chilly)\b/.test(lowerMsg)) {
    if (g.category === 'tops' && classifyTopLayerRole(g) === 'mid') score += 10;
    if (g.category === 'outerwear') score += 8;
  }

  if (effectiveSeason === 'Summer') {
    if (isSummerUnsuitable(g)) {
      score -= 48;
    } else if (g.fabricWeight === 'Lightweight') {
      score += 8;
    }
  } else if (effectiveSeason === 'Winter') {
    if (isWinterUnsuitable(g)) {
      score -= 36;
    } else if (g.fabricWeight === 'Heavyweight' || g.category === 'outerwear') {
      score += 6;
    }
  } else if (effectiveSeason !== 'All-Season') {
    if (g.seasons.includes(effectiveSeason) || g.seasons.includes('All-Season')) {
      score += 5;
    }
  }

  if (explicitlyAsked) {
    score += 45;
  } else if (recentWeight > 0) {
    score -= Math.min(54, 20 + recentWeight * 10);
  } else {
    score += 10;
  }

  const hashVal = stableHash(`${turnSeed}:${g.id}`) % 19;
  score += hashVal - 9;

  return score;
}

/**
 * Builds a query-aware, anti-repetition, role-categorized wardrobe briefing + mathematically verified
 * fresh outfit blueprints for the AI Shopping Advisor.
 */
export function buildAdvisorWardrobeContext(
  garments: Garment[],
  history: AdvisorMessage[],
  userMessage: string,
  profile: UserProfile,
  hasAttachedImages = false,
  options?: { replyMode?: AdvisorReplyMode; imageCount?: number }
): AdvisorWardrobeContext {
  const intent = detectAdvisorIntent(userMessage, hasAttachedImages);
  const replyMode =
    options?.replyMode ??
    classifyAdvisorQueryMode(
      userMessage,
      history,
      hasAttachedImages,
      options?.imageCount ?? (hasAttachedImages ? 1 : 0)
    );
  const effectiveSeason = inferEffectiveSeason('All-Season', userMessage);
  const recentMap = extractRecentlyMentionedIds(history, garments);
  const explicitlyAsked = extractExplicitlyAskedIds(userMessage, garments);
  const tokens = extractQueryTokens(userMessage);
  const lowerMsg = userMessage.toLowerCase();
  const turnSeed = `t${history.length}:${lowerMsg.slice(0, 40)}`;

  const scored = garments.map((g) => {
    const recentWeight = recentMap.get(g.id) ?? 0;
    const isAsked = explicitlyAsked.has(g.id);
    const turnScore = scoreGarmentForAdvisorTurn(
      g,
      tokens,
      lowerMsg,
      effectiveSeason,
      profile,
      recentWeight,
      isAsked,
      turnSeed
    );
    return {
      garment: g,
      recentWeight,
      isCooldown: recentWeight > 0 && !isAsked,
      isAsked,
      turnScore,
    };
  });

  scored.sort((a, b) => b.turnScore - a.turnScore);

  const buckets = {
    baseTops: scored.filter((s) => s.garment.category === 'tops' && classifyTopLayerRole(s.garment) === 'base'),
    midLayers: scored.filter((s) => s.garment.category === 'tops' && classifyTopLayerRole(s.garment) === 'mid'),
    outerwear: scored.filter((s) => s.garment.category === 'outerwear'),
    bottoms: scored.filter((s) => s.garment.category === 'bottoms'),
    footwear: scored.filter((s) => s.garment.category === 'footwear'),
    accessories: scored.filter((s) => s.garment.category === 'accessories'),
  };

  const pickFresh = (
    list: typeof scored,
    quota: number
  ): typeof scored => {
    const nonCooldown = list.filter(
      (s) =>
        !s.isCooldown &&
        !(effectiveSeason === 'Summer' && isSummerUnsuitable(s.garment)) &&
        !(effectiveSeason === 'Winter' && isWinterUnsuitable(s.garment))
    );
    if (nonCooldown.length >= quota) return nonCooldown.slice(0, quota);
    const fallback = list.filter(
      (s) =>
        !nonCooldown.includes(s) &&
        !(effectiveSeason === 'Summer' && isSummerUnsuitable(s.garment))
    );
    return [...nonCooldown, ...fallback].slice(0, quota);
  };

  const spotlightEntries = [
    ...pickFresh(buckets.baseTops, 4),
    ...(effectiveSeason === 'Summer' ? [] : pickFresh(buckets.midLayers, 2)),
    ...(effectiveSeason === 'Summer' ? pickFresh(buckets.outerwear, 1) : pickFresh(buckets.outerwear, 2)),
    ...pickFresh(buckets.bottoms, 3),
    ...pickFresh(buckets.footwear, 2),
    ...pickFresh(buckets.accessories, 2),
  ];

  for (const s of scored) {
    if (s.isAsked && !spotlightEntries.some((e) => e.garment.id === s.garment.id)) {
      spotlightEntries.unshift(s);
    }
  }

  const spotlightIds = spotlightEntries.map((e) => e.garment.id);
  const cooldownEntries = scored
    .filter((s) => s.isCooldown)
    .sort((a, b) => b.recentWeight - a.recentWeight);
  const recentlyMentionedIds = cooldownEntries.map((c) => c.garment.id);
  const unexploredCount = garments.length - cooldownEntries.length;

  // Pre-compute mathematically verified, multi-layer, OKLCH-checked, anti-repetition outfit blueprints
  // Save tokens in 'quick' mode by computing fewer blueprints unless outfits are requested
  let verifiedBlueprintsSection = 'Not needed for this quick question.';
  const vectors: Record<string, number[]> = {};
  for (const g of garments) {
    vectors[g.id] = computeDeterministicVector(g);
  }
  const shouldBuildBlueprints =
    garments.length >= 2 && (replyMode !== 'quick' || intent.wantsOutfits || explicitlyAsked.size > 0);

  if (shouldBuildBlueprints) {
    const syntheticPrevious: OutfitCombination[] =
      recentlyMentionedIds.length > 0
        ? [
            {
              id: 'cooldown-history',
              title: 'Recently Mentioned',
              source: 'ai',
              score: 80,
              vectorHarmonyScore: 80,
              itemIds: recentlyMentionedIds,
              occasion: intent.inferredOccasion,
              season: effectiveSeason,
              rationale: '',
              fabricFitNotes: '',
              bodyTailoringNote: '',
              finishingTouch: '',
              wearCount: 0,
              saved: false,
              createdAt: '',
            },
          ]
        : [];

    const firstAskedId = explicitlyAsked.size > 0 ? Array.from(explicitlyAsked)[0] : undefined;
    const blueprints = generateCandidateCombinations(garments, vectors, {
      occasion: intent.inferredOccasion,
      season: effectiveSeason,
      anchorItemId: firstAskedId,
      customPrompt: userMessage,
      profile,
      previousCombinations: syntheticPrevious,
      explorationMode: 'fresh',
      rotationSeed: stableHash(turnSeed),
      maxCandidates: replyMode === 'quick' ? 2 : 4,
    });

    if (blueprints.length > 0) {
      verifiedBlueprintsSection = blueprints
        .map((bp, i) => {
          const stack = bp.items
            .map((g) => {
              const role =
                g.category === 'tops'
                  ? classifyTopLayerRole(g) === 'mid'
                    ? 'MID'
                    : 'BASE'
                  : g.category.toUpperCase();
              return `[${role}] [[item:${g.id}|${g.name}]] (${g.primaryColor}, ${g.fabric}, ${g.fit})`;
            })
            .join(' + ');
          return `Blueprint ${i + 1} [Score ${bp.localScore} · Personal ${bp.personalScore}% · Color ${bp.colorScore}% (${bp.paletteSummary}) · Proportion ${bp.proportionScore}%]: ${stack}`;
        })
        .join('\n');
    } else {
      verifiedBlueprintsSection = 'Not applicable (insufficient tops/bottoms for full outfits).';
    }
  }

  const ownedInventorySummary = [
    `BASE TOPS (shirts/tees/polos worn against skin or under sweaters): ${buckets.baseTops.length}${buckets.baseTops.length === 0 ? ' [ZERO UPLOADED — DO NOT INVENT A SHIRT OR TEE!]' : ''}`,
    `MID LAYERS (sweaters/cardigans/hoodies/knits): ${buckets.midLayers.length}`,
    `OUTERWEAR (jackets/coats/blazers): ${buckets.outerwear.length}${buckets.outerwear.length === 0 ? ' [ZERO UPLOADED — DO NOT INVENT A JACKET!]' : ''}`,
    `BOTTOMS (trousers/jeans/chinos/shorts): ${buckets.bottoms.length}${buckets.bottoms.length === 0 ? ' [ZERO UPLOADED — DO NOT INVENT PANTS!]' : ''}`,
    `FOOTWEAR: ${buckets.footwear.length}${buckets.footwear.length === 0 ? ' [ZERO UPLOADED — DO NOT INVENT SHOES!]' : ''}`,
    `ACCESSORIES: ${buckets.accessories.length}`,
  ].join('\n');

  // Build deterministic Owned-Closet Layering & "What NOT to Wear" matrix for sweaters/mid-layers and season traps
  const layeringLines: string[] = [];
  if (effectiveSeason === 'Summer') {
    const summerTraps = scored
      .filter((s) => isSummerUnsuitable(s.garment))
      .slice(0, 4)
      .map((s) => `[[item:${s.garment.id}|${s.garment.name}]] (${s.garment.fabricWeight} ${s.garment.fabric})`);
    if (summerTraps.length > 0) {
      layeringLines.push(
        `DO NOT WEAR IN SUMMER (leave these owned pieces in the closet): ${summerTraps.join(', ')}.`
      );
    }
  } else if (buckets.midLayers.length > 0) {
    // Prioritize any mid-layer the user explicitly asked about, plus top fresh mid-layers
    const focusMids = [
      ...buckets.midLayers.filter((m) => m.isAsked),
      ...buckets.midLayers.filter((m) => !m.isAsked && !m.isCooldown),
      ...buckets.midLayers.filter((m) => !m.isAsked && m.isCooldown),
    ].slice(0, 4);

    for (const midEntry of focusMids) {
      const mid = midEntry.garment;
      if (buckets.baseTops.length === 0) {
        layeringLines.push(
          `For [[item:${mid.id}|${mid.name}]]: OWNED BASE UNDERLAYERS = NONE UPLOADED. Do NOT invent a shirt — tell the user honestly they have no base shirt/tee uploaded to layer underneath it.`
        );
        continue;
      }

      const evaluatedBases = buckets.baseTops.map((b) => ({
        base: b.garment,
        isCooldown: b.isCooldown,
        compat: evaluateBaseUnderMidCompatibility(b.garment, mid),
      }));

      const bestUnder = evaluatedBases
        .filter((e) => e.compat.compatible)
        .sort((a, b) => {
          const aBoost = a.isCooldown ? -8 : 0;
          const bBoost = b.isCooldown ? -8 : 0;
          return b.compat.score + bBoost - (a.compat.score + aBoost);
        })
        .slice(0, 3);

      const avoidUnder = evaluatedBases
        .filter((e) => !e.compat.compatible)
        .sort((a, b) => a.compat.score - b.compat.score)
        .slice(0, 2);

      const bestText =
        bestUnder.length > 0
          ? bestUnder
              .map((e) => `[[item:${e.base.id}|${e.base.name}]] (${e.compat.reason})`)
              .join('; ')
          : 'NONE COMPATIBLE IN UPLOADED CLOSET — tell user honestly not to layer their mismatched pieces under it and specify what base layer to add';

      const avoidText =
        avoidUnder.length > 0
          ? ` | DO NOT LAYER UNDER IT: ${avoidUnder
              .map((e) => `[[item:${e.base.id}|${e.base.name}]] (${e.compat.reason})`)
              .join('; ')}`
          : '';

      layeringLines.push(
        `Under [[item:${mid.id}|${mid.name}]] (${mid.fabricWeight} ${mid.fabric}): BEST OWNED UNDERLAYERS => ${bestText}${avoidText}`
      );
    }
  }

  if (intent.inferredOccasion === 'Formal' || intent.inferredOccasion === 'Evening') {
    const tooCasual = scored
      .filter((s) => s.garment.formality <= 3)
      .slice(0, 3)
      .map((s) => `[[item:${s.garment.id}|${s.garment.name}]] (formality ${s.garment.formality}/10)`);
    if (tooCasual.length > 0) {
      layeringLines.push(
        `TOO CASUAL FOR ${intent.inferredOccasion.toUpperCase()} (do not wear): ${tooCasual.join(', ')}.`
      );
    }
  }

  // Cross-verify explicitly asked garments against deterministic pairing engine so Advisor & GarmentInspector stay 100% consistent
  if (explicitlyAsked.size > 0 && garments.length >= 2) {
    const askedList = garments.filter((g) => explicitlyAsked.has(g.id)).slice(0, 2);
    for (const target of askedList) {
      const topCompanions = findBestCompanions(target.id, garments, vectors, 3, profile);
      const guidance = buildCrossVerifiedStylingGuidance(target, topCompanions, garments);
      if (topCompanions.length > 0) {
        const companionSummary = topCompanions
          .map((c) => {
            const match = garments.find((g) => g.id === c.garmentId);
            return match ? `[[item:${match.id}|${match.name}]] (${c.score}% match)` : null;
          })
          .filter((x): x is string => Boolean(x))
          .join(', ');
        layeringLines.push(
          `CROSS-VERIFIED BEST PAIRINGS FOR [[item:${target.id}|${target.name}]]: ${companionSummary}. Guide: ${guidance.primaryGuidance}`
        );
      }
    }
  }

  const layeringGuideSection =
    layeringLines.length > 0
      ? layeringLines.join('\n')
      : 'Use only owned pieces from the catalog; pair lighter bases cleanly under heavier outer layers.';

  const spotlightSection =
    spotlightEntries.length > 0
      ? spotlightEntries.map((e) => formatCompactLine(e.garment, false)).join('\n')
      : 'None yet.';

  const cooldownSection =
    cooldownEntries.length > 0
      ? cooldownEntries
          .slice(0, 14)
          .map((c) => `${c.garment.id}|${c.garment.name} (mentioned recently)`)
          .join('; ')
      : 'None yet — full closet is fresh.';

  // In 'quick' mode, cap each category to top query-relevant items to drastically cut prompt tokens
  // while keeping EVERY asked item + fresh top matches grounded. Full catalog is sent in 'standard' & 'deep'.
  const bucketLimit = replyMode === 'quick' ? 5 : 120;
  const formatBucket = (title: string, list: typeof scored) => {
    if (list.length === 0) return null;
    const shown = list.slice(0, bucketLimit);
    const omitted = list.length - shown.length;
    const suffix = omitted > 0 ? `\n(+${omitted} more items omitted for brevity)` : '';
    return `[${title} — ${list.length} items, ordered freshest & most relevant first]\n${shown
      .map((s) => formatCompactLine(s.garment, s.isCooldown))
      .join('\n')}${suffix}`;
  };

  const categorizedCatalog = [
    formatBucket('BASE TOPS (Shirts / Tees / Polos)', buckets.baseTops),
    formatBucket('MID LAYERS (Sweaters / Cardigans / Hoodies / Knits)', buckets.midLayers),
    formatBucket('OUTERWEAR (Jackets / Coats / Blazers)', buckets.outerwear),
    formatBucket('BOTTOMS (Trousers / Jeans / Chinos / Shorts)', buckets.bottoms),
    formatBucket('FOOTWEAR', buckets.footwear),
    formatBucket('ACCESSORIES', buckets.accessories),
  ]
    .filter((section): section is string => Boolean(section))
    .join('\n\n');

  return {
    intent,
    replyMode,
    effectiveSeason,
    spotlightIds,
    recentlyMentionedIds,
    unexploredCount,
    ownedInventorySummary,
    layeringGuideSection,
    spotlightSection,
    verifiedBlueprintsSection,
    cooldownSection,
    categorizedCatalog: categorizedCatalog || 'Wardrobe is currently empty.',
  };
}
