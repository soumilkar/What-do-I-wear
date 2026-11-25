import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  AdvisorMessage,
  Garment,
  OutfitCombination,
  UserProfile,
} from '../src/types/styling.ts';
import {
  analyzeWardrobeGaps,
  buildLocalFallbackCombinations,
  computeDeterministicVector,
  findBestCompanions,
  generateCandidateCombinations,
} from '../src/utils/styleEngine.ts';

export interface PersistedStore {
  garments: Garment[];
  profile: UserProfile;
  rankedCombinations: OutfitCombination[];
  savedOutfits: OutfitCombination[];
  advisorMessages: AdvisorMessage[];
}

function resolveWritableDataDir(): string {
  const preferred = path.resolve(process.cwd(), 'data');
  try {
    fs.mkdirSync(preferred, { recursive: true });
    fs.accessSync(preferred, fs.constants.W_OK);
    return preferred;
  } catch {
    const fallback = path.join(os.tmpdir(), 'what-do-i-wear-data');
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

export const DATA_DIR = resolveWritableDataDir();
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const VECTORS_FILE = path.join(DATA_DIR, 'vectors.json');

function ensureDataDirs(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function createSeedStore(): { store: PersistedStore; vectors: Record<string, number[]> } {
  const now = new Date().toISOString();

  const garments: Garment[] = [
    {
      id: 'seed-camel-overcoat',
      name: 'Camel Double-Breasted Overcoat',
      category: 'outerwear',
      subCategory: 'Overcoat',
      imageUrl: '/src/assets/images/garment_camel_overcoat_1795548620677.jpg',
      primaryColor: 'Camel',
      colorHex: '#C29B6C',
      secondaryColors: ['Espresso Horn'],
      undertone: 'Warm',
      fabric: 'Brushed camel wool twill',
      fabricWeight: 'Heavyweight',
      texture: 'Soft brushed nap',
      fit: 'Structured tailored',
      silhouette: 'Longline double-breasted peak lapel',
      pattern: 'Solid',
      formality: 8,
      seasons: ['Autumn', 'Winter'],
      occasions: ['Smart Casual', 'Formal', 'Evening'],
      stylingNotes: 'Creates an elongated vertical column over fine knits and pleated wool.',
      layeringRole: 'Outer',
      brand: 'Atelier Capsule',
      wearCount: 3,
      hasVector: true,
      vectorSource: 'semantic-fallback',
      modelUsed: 'gemini-4-hydrogen (seed)',
      createdAt: now,
    },
    {
      id: 'seed-ivory-sweater',
      name: 'Ivory Fine-Gauge Merino Crewneck',
      category: 'tops',
      subCategory: 'Knitwear',
      imageUrl: '/src/assets/images/garment_ivory_sweater_1795548634934.jpg',
      primaryColor: 'Ivory',
      colorHex: '#EFECE3',
      secondaryColors: [],
      undertone: 'Warm',
      fabric: 'Extra-fine Italian merino wool',
      fabricWeight: 'Midweight',
      texture: 'Fine micro-rib knit',
      fit: 'Relaxed tailored',
      silhouette: 'Clean crew neck with ribbed cuffs',
      pattern: 'Solid',
      formality: 6,
      seasons: ['Spring', 'Autumn', 'Winter'],
      occasions: ['Everyday', 'Smart Casual', 'Travel'],
      stylingNotes: 'Brightens dark bottoms and layers cleanly beneath coats without bulk.',
      layeringRole: 'Mid',
      brand: 'Atelier Capsule',
      wearCount: 7,
      hasVector: true,
      vectorSource: 'semantic-fallback',
      modelUsed: 'gemini-4-hydrogen (seed)',
      createdAt: now,
    },
    {
      id: 'seed-sky-oxford',
      name: 'Sky Blue Brushed Cotton Oxford',
      category: 'tops',
      subCategory: 'Button-Down Shirt',
      imageUrl: '/src/assets/images/garment_sky_oxford_shirt_1795548619953.jpg',
      primaryColor: 'Sky Blue',
      colorHex: '#A7C3DE',
      secondaryColors: ['Mother-of-Pearl'],
      undertone: 'Cool',
      fabric: 'Brushed 2-ply cotton Oxford weave',
      fabricWeight: 'Midweight',
      texture: 'Crisp matte basketweave',
      fit: 'Tailored modern',
      silhouette: 'Structured collar with curved hem',
      pattern: 'Solid',
      formality: 7,
      seasons: ['All-Season'],
      occasions: ['Smart Casual', 'Formal', 'Everyday'],
      stylingNotes: 'Works untucked with raw selvedge denim or crisply tucked into wool trousers.',
      layeringRole: 'Base',
      brand: 'Atelier Capsule',
      wearCount: 9,
      hasVector: true,
      vectorSource: 'semantic-fallback',
      modelUsed: 'gemini-4-hydrogen (seed)',
      createdAt: now,
    },
    {
      id: 'seed-charcoal-trousers',
      name: 'Charcoal Double-Pleat Wool Trousers',
      category: 'bottoms',
      subCategory: 'Tailored Trousers',
      imageUrl: '/src/assets/images/garment_charcoal_trousers_1795548618728.jpg',
      primaryColor: 'Charcoal',
      colorHex: '#3E4145',
      secondaryColors: [],
      undertone: 'Neutral',
      fabric: 'High-twist worsted tropical wool',
      fabricWeight: 'Midweight',
      texture: 'Smooth fluid drape',
      fit: 'Tailored relaxed taper',
      silhouette: 'High-rise double-pleat with turn-up cuff',
      pattern: 'Solid',
      formality: 8,
      seasons: ['All-Season'],
      occasions: ['Smart Casual', 'Formal', 'Evening'],
      stylingNotes: 'High waist and pressed crease visually lengthen the lower silhouette.',
      layeringRole: 'Bottom',
      brand: 'Atelier Capsule',
      wearCount: 8,
      hasVector: true,
      vectorSource: 'semantic-fallback',
      modelUsed: 'gemini-4-hydrogen (seed)',
      createdAt: now,
    },
    {
      id: 'seed-indigo-denim',
      name: 'Raw Indigo Selvedge Straight Denim',
      category: 'bottoms',
      subCategory: 'Denim Jeans',
      imageUrl: '/src/assets/images/garment_indigo_denim_1795548621097.jpg',
      primaryColor: 'Raw Indigo',
      colorHex: '#1F2A3C',
      secondaryColors: ['Copper Stitch'],
      undertone: 'Cool',
      fabric: '14oz Japanese selvedge cotton denim',
      fabricWeight: 'Heavyweight',
      texture: 'Structured raw twill',
      fit: 'Straight leg',
      silhouette: 'Mid-rise classic straight with cuffed hem',
      pattern: 'Solid',
      formality: 4,
      seasons: ['All-Season'],
      occasions: ['Everyday', 'Smart Casual', 'Streetwear', 'Travel'],
      stylingNotes: 'Clean unwashed indigo dress-grades effortlessly with leather loafers and camel wool.',
      layeringRole: 'Bottom',
      brand: 'Atelier Capsule',
      wearCount: 11,
      hasVector: true,
      vectorSource: 'semantic-fallback',
      modelUsed: 'gemini-4-hydrogen (seed)',
      createdAt: now,
    },
    {
      id: 'seed-espresso-loafers',
      name: 'Espresso Calfskin Penny Loafers',
      category: 'footwear',
      subCategory: 'Penny Loafers',
      imageUrl: '/src/assets/images/garment_espresso_loafers_1795548620942.jpg',
      primaryColor: 'Espresso Brown',
      colorHex: '#3B2820',
      secondaryColors: [],
      undertone: 'Warm',
      fabric: 'Full-grain Italian calfskin leather',
      fabricWeight: 'Midweight',
      texture: 'Supple satin-sheen grain',
      fit: 'Structured sleek',
      silhouette: 'Almond-toe Goodyear-welted loafer',
      pattern: 'Solid',
      formality: 7,
      seasons: ['All-Season'],
      occasions: ['Smart Casual', 'Formal', 'Everyday', 'Evening'],
      stylingNotes: 'Warm espresso tone echoes camel outerwear and grounds cool charcoal or indigo.',
      layeringRole: 'Footwear',
      brand: 'Atelier Capsule',
      wearCount: 12,
      hasVector: true,
      vectorSource: 'semantic-fallback',
      modelUsed: 'gemini-4-hydrogen (seed)',
      createdAt: now,
    },
  ];

  const vectors: Record<string, number[]> = {};
  for (const g of garments) {
    vectors[g.id] = computeDeterministicVector(g);
  }

  const profile: UserProfile = {
    name: 'Elena Vance',
    photoUrl: '/src/assets/images/profile_style_portrait_1795548618654.jpg',
    bio: 'Product design lead splitting time between studio critiques, client dinners, and weekend travel. I prefer architectural minimalism, tactile natural fibers, and pieces that transition seamlessly from day to evening.',
    height: '5\'7" (170 cm)',
    bodyType: 'Balanced Athletic',
    skinUndertone: 'Warm',
    preferredFits: ['Tailored', 'Relaxed'],
    styleAesthetics: ['Quiet Luxury', 'Architectural Minimalism', 'Modern Tailoring'],
    budgetRange: 'Contemporary',
    climate: 'Four-Season',
    stylingGoals: 'Maximize effortless combinations across work, dinners, and travel without overbuying.',
    blueprint: {
      summary:
        'Your warm undertone and balanced frame shine in clean architectural silhouettes with deliberate tonal contrast. Natural matte fabrics with crisp shoulder structure anchor your modern minimalist aesthetic.',
      colorSeason: 'Soft Warm Autumn',
      contrastLevel: 'Medium-High',
      bestColors: ['Camel', 'Warm Ivory', 'Espresso', 'Charcoal', 'Deep Indigo', 'Muted Sky'],
      avoidColors: ['Neon Pastels', 'Icy Optic White', 'Harsh Fuchsia'],
      idealSilhouettes: [
        'High-rise pleated trousers with tucked or cropped knits',
        'Longline structured overcoats worn open for verticality',
        'Clean straight-leg raw denim balanced with refined footwear',
      ],
      proportionTips: [
        'Define the waistline slightly above natural hip to emphasize a 1/3 to 2/3 leg ratio.',
        'Pair heavier outer coats with fine-gauge base knits to keep shoulders sharp.',
      ],
      recommendedFabrics: ['Fine Merino Wool', 'High-Twist Worsted Wool', 'Brushed Cotton Oxford', 'Selvedge Denim'],
      analyzedAt: now,
      modelUsed: 'gemini-4-hydrogen (balanced)',
    },
    updatedAt: now,
  };

  const candidates = generateCandidateCombinations(garments, vectors, {
    occasion: 'Smart Casual',
    season: 'Autumn',
    maxCandidates: 4,
  });

  const rankedCombinations = buildLocalFallbackCombinations(
    candidates,
    profile,
    'Smart Casual',
    'Autumn'
  ).map((combo, idx) => {
    const pieces = combo.itemIds
      .map((id) => garments.find((g) => g.id === id))
      .filter((g): g is Garment => Boolean(g));
    const hasCoat = pieces.some((p) => p.category === 'outerwear');
    const top = pieces.find((p) => p.category === 'tops');
    const bottom = pieces.find((p) => p.category === 'bottoms');
    const accurateTitle = hasCoat
      ? `Camel Overcoat over ${top?.primaryColor ?? 'Fine'} & ${bottom?.primaryColor ?? 'Tailored'}`
      : `${top?.primaryColor ?? 'Refined'} ${top?.subCategory === 'Knitwear' ? 'Merino' : 'Oxford'} & ${bottom?.primaryColor ?? 'Tailored'} Edit`;

    return {
      ...combo,
      id: `seed-combo-${idx + 1}`,
      title: accurateTitle,
      saved: idx === 0,
      modelUsed: 'gemini-4-hydrogen (balanced)',
    };
  });

  const savedOutfits: OutfitCombination[] = [
    {
      ...rankedCombinations[0],
      id: 'seed-saved-1',
      saved: true,
      wearCount: 2,
    },
  ];

  const advisorMessages: AdvisorMessage[] = [
    {
      id: 'seed-msg-1',
      role: 'assistant',
      content:
        'Welcome to your styling studio, Elena. I have indexed all 6 pieces in your wardrobe along with their fabric weights, silhouettes, and image vectors.\n\nYour foundation of Camel Overcoat, Charcoal Pleated Trousers, and Espresso Loafers is exceptionally cohesive. Whenever you want trend updates, gap-filling purchase ideas, or advice on whether a new item fits your closet, just ask.',
      referencedItemIds: ['seed-camel-overcoat', 'seed-charcoal-trousers', 'seed-espresso-loafers'],
      modelUsed: 'gemini-4-hydrogen (fast)',
      createdAt: now,
    },
  ];

  return {
    store: {
      garments,
      profile,
      rankedCombinations,
      savedOutfits,
      advisorMessages,
    },
    vectors,
  };
}

let memoryStore: PersistedStore | null = null;
let memoryVectors: Record<string, number[]> | null = null;

function atomicWriteJson(filePath: string, data: unknown): void {
  ensureDataDirs();
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

export function loadStore(): { store: PersistedStore; vectors: Record<string, number[]> } {
  if (memoryStore && memoryVectors) {
    return { store: memoryStore, vectors: memoryVectors };
  }

  ensureDataDirs();

  if (fs.existsSync(STORE_FILE) && fs.existsSync(VECTORS_FILE)) {
    try {
      const parsedStore = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')) as PersistedStore;
      const parsedVectors = JSON.parse(fs.readFileSync(VECTORS_FILE, 'utf8')) as Record<string, number[]>;
      memoryStore = parsedStore;
      memoryVectors = parsedVectors;
      return { store: memoryStore, vectors: memoryVectors };
    } catch (err) {
      console.warn('[Store] Corrupted JSON detected, re-seeding starter store:', err);
    }
  }

  const seeded = createSeedStore();
  memoryStore = seeded.store;
  memoryVectors = seeded.vectors;
  atomicWriteJson(STORE_FILE, memoryStore);
  atomicWriteJson(VECTORS_FILE, memoryVectors);
  return { store: memoryStore, vectors: memoryVectors };
}

export function saveStore(): void {
  if (!memoryStore) return;
  atomicWriteJson(STORE_FILE, memoryStore);
}

export function saveVectors(): void {
  if (!memoryVectors) return;
  atomicWriteJson(VECTORS_FILE, memoryVectors);
}

export function getBootstrapPayload() {
  const { store, vectors } = loadStore();
  const companionsByGarment: Record<string, ReturnType<typeof findBestCompanions>> = {};
  for (const g of store.garments) {
    companionsByGarment[g.id] = findBestCompanions(g.id, store.garments, vectors, 3);
  }
  const wardrobeGaps = analyzeWardrobeGaps(store.garments, store.profile);

  return {
    garments: store.garments,
    profile: store.profile,
    rankedCombinations: store.rankedCombinations,
    savedOutfits: store.savedOutfits,
    advisorMessages: store.advisorMessages,
    companionsByGarment,
    wardrobeGaps,
  };
}

export function resolveSafeUploadPath(filename: string): string | null {
  if (!/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|avif)$/i.test(filename)) {
    return null;
  }
  const resolved = path.resolve(UPLOADS_DIR, filename);
  if (!resolved.startsWith(UPLOADS_DIR + path.sep)) {
    return null;
  }
  return resolved;
}

export function readImageAsBase64(imageUrl: string): { base64: string; mimeType: string } | null {
  let filePath: string | null = null;
  if (imageUrl.startsWith('/uploads/')) {
    filePath = resolveSafeUploadPath(imageUrl.slice('/uploads/'.length));
  } else if (imageUrl.startsWith('/src/assets/images/')) {
    const safeName = path.basename(imageUrl);
    const searchDirs = [
      path.resolve(process.cwd(), 'src/assets/images'),
      path.resolve(process.cwd(), 'dist/src/assets/images'),
    ];
    for (const baseDir of searchDirs) {
      const candidate = path.resolve(baseDir, safeName);
      if (candidate.startsWith(baseDir + path.sep) && fs.existsSync(candidate)) {
        filePath = candidate;
        break;
      }
    }
  }
  if (!filePath || !fs.existsSync(filePath)) return null;

  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
  };
  const mimeType = mimeMap[ext] ?? 'image/jpeg';
  const base64 = fs.readFileSync(filePath).toString('base64');
  return { base64, mimeType };
}
