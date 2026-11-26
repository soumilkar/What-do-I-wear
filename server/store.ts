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
  findBestCompanions,
} from '../src/utils/styleEngine.ts';

export interface PersistedStore {
  garments: Garment[];
  profile: UserProfile;
  rankedCombinations: OutfitCombination[];
  savedOutfits: OutfitCombination[];
  advisorMessages: AdvisorMessage[];
}

function resolveWritableDataDir(): string {
  if (process.env.VERCEL) {
    const vercelTmp = path.join(os.tmpdir(), 'what-do-i-wear-data');
    fs.mkdirSync(vercelTmp, { recursive: true });
    return vercelTmp;
  }
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

  const garments: Garment[] = [];
  const vectors: Record<string, number[]> = {};

  const profile: UserProfile = {
    name: '',
    photoUrl: '',
    bio: '',
    height: '',
    bodyType: 'Balanced',
    skinUndertone: 'Neutral',
    preferredFits: ['Tailored', 'Relaxed'],
    styleAesthetics: ['Quiet Luxury', 'Modern Tailoring'],
    budgetRange: 'Contemporary',
    climate: 'Four-Season',
    stylingGoals: 'Maximize effortless outfit combinations across work, dinners, and travel.',
    blueprint: null,
    updatedAt: now,
  };

  const rankedCombinations: OutfitCombination[] = [];
  const savedOutfits: OutfitCombination[] = [];

  const advisorMessages: AdvisorMessage[] = [
    {
      id: 'seed-msg-1',
      role: 'assistant',
      content:
        'Welcome to your styling studio. Upload your clothes to begin indexing fabrics, fits, and image vectors—then ask anytime for ranked outfits, trend updates, or smart shopping recommendations.',
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
      const legacyGarmentIds = new Set([
        'seed-camel-overcoat',
        'seed-ivory-sweater',
        'seed-sky-oxford',
        'seed-charcoal-trousers',
        'seed-indigo-denim',
        'seed-espresso-loafers',
      ]);
      const legacyComboIds = new Set(['seed-combo-1', 'seed-combo-2', 'seed-combo-3', 'seed-combo-4']);
      const legacySavedIds = new Set(['seed-saved-1']);

      const prevCount =
        parsedStore.garments.length +
        parsedStore.rankedCombinations.length +
        parsedStore.savedOutfits.length;

      parsedStore.garments = parsedStore.garments.filter((g) => !legacyGarmentIds.has(g.id));
      parsedStore.rankedCombinations = parsedStore.rankedCombinations.filter(
        (c) => !legacyComboIds.has(c.id)
      );
      parsedStore.savedOutfits = parsedStore.savedOutfits.filter(
        (s) => !legacySavedIds.has(s.id)
      );
      for (const id of legacyGarmentIds) {
        delete parsedVectors[id];
      }

      memoryStore = parsedStore;
      memoryVectors = parsedVectors;
      if (
        parsedStore.garments.length +
          parsedStore.rankedCombinations.length +
          parsedStore.savedOutfits.length !==
        prevCount
      ) {
        atomicWriteJson(STORE_FILE, memoryStore);
        atomicWriteJson(VECTORS_FILE, memoryVectors);
      }
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
  if (imageUrl.startsWith('data:')) {
    const match = imageUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (match) {
      return { mimeType: match[1], base64: match[2] };
    }
    return null;
  }

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
