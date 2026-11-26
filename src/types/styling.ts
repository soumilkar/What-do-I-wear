export type GarmentCategory =
  | 'tops'
  | 'bottoms'
  | 'outerwear'
  | 'footwear'
  | 'accessories';

export type SeasonTag = 'Spring' | 'Summer' | 'Autumn' | 'Winter' | 'All-Season';

export type OccasionType =
  | 'Everyday'
  | 'Smart Casual'
  | 'Formal'
  | 'Evening'
  | 'Travel'
  | 'Streetwear';

export interface Garment {
  id: string;
  name: string;
  category: GarmentCategory;
  subCategory: string;
  imageUrl: string;
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
  formality: number; // 1 (athletic/lounge) to 10 (black-tie)
  seasons: SeasonTag[];
  occasions: OccasionType[];
  stylingNotes: string;
  layeringRole: 'Base' | 'Mid' | 'Outer' | 'Bottom' | 'Footwear' | 'Accent';
  brand?: string;
  wearCount: number;
  hasVector: boolean;
  vectorSource: 'gemini-embedding-2' | 'semantic-fallback';
  modelUsed?: string;
  createdAt: string;
}

export interface CompanionMatch {
  garmentId: string;
  score: number; // 0-100
  vectorSimilarity: number; // 0-100
  colorHarmony: number; // 0-100
  reason: string;
}

export const STYLE_FIT_OPTIONS = [
  'Tailored',
  'Relaxed',
  'Structured',
  'Oversized',
  'Slim',
  'Cropped',
  'Athletic Taper',
  'Boxy',
  'Draped / Fluid',
  'High-Waisted',
  'Classic Regular',
  'Layered',
] as const;

export const STYLE_AESTHETIC_OPTIONS = [
  'Quiet Luxury',
  'Old Money / Heritage',
  'Modern Tailoring',
  'Smart Casual',
  'Minimalist',
  'Smart Streetwear',
  'Urban Streetwear',
  'Classic Ivy / Preppy',
  'Scandi Chic',
  'Workwear / Utilitarian',
  'Mediterranean / Resort',
  'Techwear / Gorpcore',
  'Vintage / Retro',
  'Dark Academia',
  'Bohemian / Earthy',
  'Athleisure / Sporty',
  'Rock / Edgy',
  'Avant-Garde',
] as const;

export interface AIProfileBlueprint {
  summary: string;
  visualProfile?: string;
  colorSeason: string;
  contrastLevel: string;
  bestColors: string[];
  bestColorHexes?: string[];
  avoidColors: string[];
  avoidColorHexes?: string[];
  idealSilhouettes: string[];
  proportionTips: string[];
  recommendedFabrics: string[];
  photoAnalyzed?: boolean;
  analyzedAt: string;
  modelUsed?: string;
}

export interface UserProfile {
  name: string;
  photoUrl: string;
  bio: string;
  height: string;
  bodyType: string;
  skinUndertone: 'Warm' | 'Cool' | 'Neutral' | 'Olive' | 'Warm Olive' | 'Cool Olive';
  preferredFits: string[];
  styleAesthetics: string[];
  budgetRange: 'Accessible' | 'Mid-Tier' | 'Contemporary' | 'Luxury';
  climate: 'Temperate' | 'Warm' | 'Cold' | 'Four-Season';
  stylingGoals: string;
  blueprint: AIProfileBlueprint | null;
  updatedAt: string;
}

export interface OutfitCombination {
  id: string;
  title: string;
  source: 'ai' | 'custom';
  rank?: number;
  score: number; // 0-100
  vectorHarmonyScore: number; // 0-100
  itemIds: string[];
  occasion: OccasionType;
  season: SeasonTag;
  rationale: string;
  fabricFitNotes: string;
  bodyTailoringNote: string;
  finishingTouch: string;
  wearCount: number;
  saved: boolean;
  modelUsed?: string;
  createdAt: string;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface AdvisorMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachedImages?: string[];
  referencedItemIds?: string[];
  suggestedPurchases?: Array<{
    item: string;
    why: string;
    pairsWith: string;
    priceRange: string;
  }>;
  sources?: GroundingSource[];
  modelUsed?: string;
  createdAt: string;
}

export interface WardrobeGap {
  id: string;
  title: string;
  category: GarmentCategory;
  priority: 'High' | 'Medium';
  reason: string;
  suggestedPrompt: string;
}

export interface AppBootstrapData {
  garments: Garment[];
  profile: UserProfile;
  rankedCombinations: OutfitCombination[];
  savedOutfits: OutfitCombination[];
  advisorMessages: AdvisorMessage[];
  companionsByGarment: Record<string, CompanionMatch[]>;
  wardrobeGaps: WardrobeGap[];
}
