import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type {
  AIProfileBlueprint,
  AdvisorMessage,
  AppBootstrapData,
  Garment,
  GarmentCategory,
  GroundingSource,
  OccasionType,
  OutfitCombination,
  SeasonTag,
  UserProfile,
} from '../types/styling';
import {
  analyzeWardrobeGaps,
  computeDeterministicVector,
  evaluateOutfitLocalHarmony,
  findBestCompanions,
} from '../utils/styleEngine';
import { db, handleFirestoreError, OperationType } from './firebase';

export interface CloudWorkspaceState {
  bootstrap: AppBootstrapData;
  vectors: Record<string, number[]>;
}

const VALID_CATEGORIES: GarmentCategory[] = [
  'tops',
  'bottoms',
  'outerwear',
  'footwear',
  'accessories',
];
const VALID_UNDERTONES = ['Warm', 'Cool', 'Neutral'] as const;
const VALID_SKIN_UNDERTONES = ['Warm', 'Cool', 'Neutral', 'Olive'] as const;
const VALID_WEIGHTS = ['Lightweight', 'Midweight', 'Heavyweight'] as const;
const VALID_ROLES = ['Base', 'Mid', 'Outer', 'Bottom', 'Footwear', 'Accent'] as const;
const VALID_OCCASIONS: OccasionType[] = [
  'Everyday',
  'Smart Casual',
  'Formal',
  'Evening',
  'Travel',
  'Streetwear',
];
const VALID_SEASONS: SeasonTag[] = ['Spring', 'Summer', 'Autumn', 'Winter', 'All-Season'];
const VALID_BUDGETS = ['Accessible', 'Mid-Tier', 'Contemporary', 'Luxury'] as const;
const VALID_CLIMATES = ['Temperate', 'Warm', 'Cold', 'Four-Season'] as const;

function makeDocId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 14)
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

function toIsoString(value: unknown): string {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  return new Date().toISOString();
}

function clampString(val: unknown, maxLen: number, fallback = ''): string {
  const s = typeof val === 'string' ? val.trim() : fallback;
  return s.slice(0, maxLen);
}

function sanitizeStringList(val: unknown, maxItems: number, maxLen = 80): string[] {
  if (!Array.isArray(val)) return [];
  return val
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim().slice(0, maxLen))
    .slice(0, maxItems);
}

function sanitizeVector(val: unknown, fallbackGarment?: Parameters<typeof computeDeterministicVector>[0]): number[] {
  if (Array.isArray(val) && val.length > 0) {
    const clean = val
      .slice(0, 256)
      .map((n) => (typeof n === 'number' && Number.isFinite(n) ? Number(n.toFixed(6)) : 0));
    if (clean.length > 0) return clean;
  }
  return fallbackGarment ? computeDeterministicVector(fallbackGarment) : [];
}

function sanitizeBlueprint(bp: AIProfileBlueprint | null): AIProfileBlueprint | null {
  if (!bp) return null;
  const out: AIProfileBlueprint = {
    summary: clampString(bp.summary, 600, 'Balanced personal style profile.'),
    colorSeason: clampString(bp.colorSeason, 80, 'Neutral Balanced'),
    contrastLevel: clampString(bp.contrastLevel, 40, 'Medium'),
    bestColors: sanitizeStringList(bp.bestColors, 8, 40),
    avoidColors: sanitizeStringList(bp.avoidColors, 6, 40),
    idealSilhouettes: sanitizeStringList(bp.idealSilhouettes, 6, 120),
    proportionTips: sanitizeStringList(bp.proportionTips, 6, 160),
    recommendedFabrics: sanitizeStringList(bp.recommendedFabrics, 8, 60),
    analyzedAt: clampString(bp.analyzedAt, 64, new Date().toISOString()),
  };
  if (bp.modelUsed) {
    out.modelUsed = clampString(bp.modelUsed, 100);
  }
  return out;
}

const LEGACY_SEED_GARMENT_IDS = new Set([
  'seed_camel_overcoat',
  'seed_ivory_sweater',
  'seed_sky_oxford',
  'seed_charcoal_trousers',
  'seed_indigo_denim',
  'seed_espresso_loafers',
]);

const LEGACY_SEED_COMBO_IDS = new Set([
  'seed_combo_1',
  'seed_combo_2',
  'seed_combo_3',
  'seed_combo_4',
]);

const LEGACY_SEED_SAVED_IDS = new Set(['seed_saved_1']);

async function cleanupLegacySeededClothes(uid: string): Promise<void> {
  try {
    const [garmentsSnap, combosSnap, savedSnap] = await Promise.all([
      getDocs(query(collection(db, 'users', uid, 'garments'), where('ownerId', '==', uid))),
      getDocs(query(collection(db, 'users', uid, 'combinations'), where('ownerId', '==', uid))),
      getDocs(query(collection(db, 'users', uid, 'savedOutfits'), where('ownerId', '==', uid))),
    ]);

    const batch = writeBatch(db);
    let deleteCount = 0;

    garmentsSnap.forEach((docSnap) => {
      if (LEGACY_SEED_GARMENT_IDS.has(docSnap.id)) {
        batch.delete(docSnap.ref);
        deleteCount += 1;
      }
    });
    combosSnap.forEach((docSnap) => {
      if (LEGACY_SEED_COMBO_IDS.has(docSnap.id)) {
        batch.delete(docSnap.ref);
        deleteCount += 1;
      }
    });
    savedSnap.forEach((docSnap) => {
      if (LEGACY_SEED_SAVED_IDS.has(docSnap.id)) {
        batch.delete(docSnap.ref);
        deleteCount += 1;
      }
    });

    if (deleteCount > 0) {
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `users/${uid}/seed_cleanup`);
  }
}

function buildGarmentFirestoreDoc(
  uid: string,
  garment: Omit<Garment, 'id' | 'createdAt'>,
  vector: number[]
) {
  const category = VALID_CATEGORIES.includes(garment.category) ? garment.category : 'tops';
  const undertone = VALID_UNDERTONES.includes(garment.undertone) ? garment.undertone : 'Neutral';
  const fabricWeight = VALID_WEIGHTS.includes(garment.fabricWeight)
    ? garment.fabricWeight
    : 'Midweight';
  const layeringRole = VALID_ROLES.includes(garment.layeringRole) ? garment.layeringRole : 'Base';
  const colorHex = /^#[0-9A-Fa-f]{6}$/.test(garment.colorHex || '') ? garment.colorHex : '#6E6E73';
  const seasons = sanitizeStringList(garment.seasons, 5, 30);
  const occasions = sanitizeStringList(garment.occasions, 6, 30);

  const payload: Record<string, unknown> = {
    ownerId: uid,
    name: clampString(garment.name, 100, 'Untitled Piece'),
    category,
    subCategory: clampString(garment.subCategory, 80, 'Apparel'),
    imageUrl: clampString(garment.imageUrl, 250000, '/src/assets/images/garment_ivory_sweater_1795548634934.jpg'),
    primaryColor: clampString(garment.primaryColor, 60, 'Neutral'),
    colorHex,
    secondaryColors: sanitizeStringList(garment.secondaryColors, 5, 40),
    undertone,
    fabric: clampString(garment.fabric, 140, 'Cotton blend'),
    fabricWeight,
    texture: clampString(garment.texture, 80, 'Smooth matte'),
    fit: clampString(garment.fit, 80, 'Tailored'),
    silhouette: clampString(garment.silhouette, 120, 'Clean classic'),
    pattern: clampString(garment.pattern, 60, 'Solid'),
    formality: Math.max(1, Math.min(10, Math.round(Number(garment.formality) || 5))),
    seasons: seasons.length > 0 ? seasons : ['All-Season'],
    occasions: occasions.length > 0 ? occasions : ['Smart Casual'],
    stylingNotes: clampString(garment.stylingNotes, 300, ''),
    layeringRole,
    wearCount: Math.max(0, Math.min(10000, Math.round(Number(garment.wearCount) || 0))),
    hasVector: true,
    vectorSource:
      garment.vectorSource === 'gemini-embedding-2' ? 'gemini-embedding-2' : 'semantic-fallback',
    vector: sanitizeVector(vector, garment),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (garment.brand && garment.brand.trim()) {
    payload.brand = clampString(garment.brand, 80);
  }
  if (garment.modelUsed && garment.modelUsed.trim()) {
    payload.modelUsed = clampString(garment.modelUsed, 100);
  }

  return payload;
}

function buildOutfitFirestoreDoc(uid: string, outfit: Omit<OutfitCombination, 'id' | 'createdAt'>) {
  const occasion = VALID_OCCASIONS.includes(outfit.occasion) ? outfit.occasion : 'Smart Casual';
  const season = VALID_SEASONS.includes(outfit.season) ? outfit.season : 'All-Season';
  const payload: Record<string, unknown> = {
    ownerId: uid,
    title: clampString(outfit.title, 100, 'Curated Look'),
    source: outfit.source === 'ai' ? 'ai' : 'custom',
    score: Math.max(0, Math.min(100, Math.round(Number(outfit.score) || 85))),
    vectorHarmonyScore: Math.max(
      0,
      Math.min(100, Math.round(Number(outfit.vectorHarmonyScore) || 85))
    ),
    itemIds: sanitizeStringList(outfit.itemIds, 10, 128),
    occasion,
    season,
    rationale: clampString(outfit.rationale, 400, ''),
    fabricFitNotes: clampString(outfit.fabricFitNotes, 320, ''),
    bodyTailoringNote: clampString(outfit.bodyTailoringNote, 320, ''),
    finishingTouch: clampString(outfit.finishingTouch, 240, ''),
    wearCount: Math.max(0, Math.min(10000, Math.round(Number(outfit.wearCount) || 0))),
    saved: Boolean(outfit.saved),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (typeof outfit.rank === 'number' && Number.isFinite(outfit.rank)) {
    payload.rank = Math.max(1, Math.min(50, Math.round(outfit.rank)));
  }
  if (outfit.modelUsed && outfit.modelUsed.trim()) {
    payload.modelUsed = clampString(outfit.modelUsed, 100);
  }

  return payload;
}

/**
 * Ensures a signed-in user has their own private cloud profile (with zero pre-uploaded clothes)
 * and removes any legacy pre-uploaded starter clothes from earlier sessions.
 */
export async function ensureUserWorkspaceSeeded(user: User): Promise<void> {
  const uid = user.uid;
  const userPath = `users/${uid}`;
  const userRef = doc(db, 'users', uid);

  let snap;
  try {
    snap = await getDoc(userRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, userPath);
  }

  if (snap.exists()) {
    await cleanupLegacySeededClothes(uid);
    return;
  }

  const displayName = clampString(
    user.displayName || user.email?.split('@')[0] || 'Style Member',
    80,
    'Style Member'
  );
  const photoUrl = clampString(user.photoURL || '', 250000);

  // Step 1: Create parent /users/{uid} document first
  try {
    await setDoc(userRef, {
      ownerId: uid,
      name: displayName,
      photoUrl,
      bio: '',
      height: '',
      bodyType: 'Balanced',
      skinUndertone: 'Neutral',
      preferredFits: ['Tailored', 'Relaxed'],
      styleAesthetics: ['Quiet Luxury', 'Modern Tailoring'],
      budgetRange: 'Contemporary',
      climate: 'Four-Season',
      stylingGoals: 'Maximize effortless outfit combinations from my cloud wardrobe.',
      blueprint: null,
      seeded: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, userPath);
  }

  // Step 2: Add a clean Shopping Advisor welcome message (no pre-uploaded clothes)
  try {
    await setDoc(doc(db, 'users', uid, 'advisorMessages', 'seed_msg_1'), {
      ownerId: uid,
      role: 'assistant',
      content: `Welcome to your private cloud wardrobe, ${displayName}. Tap Add Clothes to upload up to 50 pieces from your closet—every fabric, fit, and image vector is saved securely to your account across devices.`,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `${userPath}/advisorMessages/seed_msg_1`);
  }
}

/**
 * Subscribes in real time to all private cloud collections for the signed-in user.
 * Computes local vector companions & wardrobe gaps on the fly for zero-lag navigation.
 */
export function subscribeUserWorkspace(
  uid: string,
  onUpdate: (state: CloudWorkspaceState) => void,
  onError: (err: Error) => void
): () => void {
  let profile: UserProfile | null = null;
  let garments: Garment[] = [];
  let vectors: Record<string, number[]> = {};
  let rankedCombinations: OutfitCombination[] = [];
  let savedOutfits: OutfitCombination[] = [];
  let advisorMessages: AdvisorMessage[] = [];

  let readyProfile = false;
  let readyGarments = false;
  let readyCombos = false;
  let readySaved = false;
  let readyMessages = false;

  const emitIfReady = () => {
    if (!readyProfile || !readyGarments || !readyCombos || !readySaved || !readyMessages || !profile) {
      return;
    }

    const companionsByGarment: AppBootstrapData['companionsByGarment'] = {};
    for (const g of garments) {
      companionsByGarment[g.id] = findBestCompanions(g.id, garments, vectors, 3);
    }
    const wardrobeGaps = analyzeWardrobeGaps(garments, profile);

    onUpdate({
      bootstrap: {
        garments,
        profile,
        rankedCombinations,
        savedOutfits,
        advisorMessages,
        companionsByGarment,
        wardrobeGaps,
      },
      vectors,
    });
  };

  const userPath = `users/${uid}`;
  const unsubProfile = onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        profile = {
          name: String(d.name ?? ''),
          photoUrl: String(d.photoUrl ?? ''),
          bio: String(d.bio ?? ''),
          height: String(d.height ?? ''),
          bodyType: String(d.bodyType ?? ''),
          skinUndertone: (d.skinUndertone ?? 'Neutral') as UserProfile['skinUndertone'],
          preferredFits: Array.isArray(d.preferredFits) ? d.preferredFits : [],
          styleAesthetics: Array.isArray(d.styleAesthetics) ? d.styleAesthetics : [],
          budgetRange: (d.budgetRange ?? 'Contemporary') as UserProfile['budgetRange'],
          climate: (d.climate ?? 'Four-Season') as UserProfile['climate'],
          stylingGoals: String(d.stylingGoals ?? ''),
          blueprint: (d.blueprint ?? null) as AIProfileBlueprint | null,
          updatedAt: toIsoString(d.updatedAt),
        };
      }
      readyProfile = true;
      emitIfReady();
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.GET, userPath);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );

  const garmentsPath = `users/${uid}/garments`;
  const unsubGarments = onSnapshot(
    query(collection(db, 'users', uid, 'garments'), where('ownerId', '==', uid)),
    (snap) => {
      const nextGarments: Garment[] = [];
      const nextVectors: Record<string, number[]> = {};
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        const item: Garment = {
          id: docSnap.id,
          name: String(d.name ?? 'Untitled'),
          category: (d.category ?? 'tops') as GarmentCategory,
          subCategory: String(d.subCategory ?? 'Apparel'),
          imageUrl: String(d.imageUrl ?? ''),
          primaryColor: String(d.primaryColor ?? 'Neutral'),
          colorHex: String(d.colorHex ?? '#6E6E73'),
          secondaryColors: Array.isArray(d.secondaryColors) ? d.secondaryColors : [],
          undertone: (d.undertone ?? 'Neutral') as Garment['undertone'],
          fabric: String(d.fabric ?? ''),
          fabricWeight: (d.fabricWeight ?? 'Midweight') as Garment['fabricWeight'],
          texture: String(d.texture ?? ''),
          fit: String(d.fit ?? ''),
          silhouette: String(d.silhouette ?? ''),
          pattern: String(d.pattern ?? 'Solid'),
          formality: Number(d.formality ?? 5),
          seasons: Array.isArray(d.seasons) ? d.seasons : ['All-Season'],
          occasions: Array.isArray(d.occasions) ? d.occasions : ['Smart Casual'],
          stylingNotes: String(d.stylingNotes ?? ''),
          layeringRole: (d.layeringRole ?? 'Base') as Garment['layeringRole'],
          brand: typeof d.brand === 'string' ? d.brand : undefined,
          wearCount: Number(d.wearCount ?? 0),
          hasVector: Boolean(d.hasVector ?? true),
          vectorSource:
            d.vectorSource === 'gemini-embedding-2' ? 'gemini-embedding-2' : 'semantic-fallback',
          modelUsed: typeof d.modelUsed === 'string' ? d.modelUsed : undefined,
          createdAt: toIsoString(d.createdAt),
        };
        nextGarments.push(item);
        nextVectors[item.id] =
          Array.isArray(d.vector) && d.vector.length > 0
            ? d.vector
            : computeDeterministicVector(item);
      });
      nextGarments.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      garments = nextGarments;
      vectors = nextVectors;
      readyGarments = true;
      emitIfReady();
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, garmentsPath);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );

  const combosPath = `users/${uid}/combinations`;
  const unsubCombos = onSnapshot(
    query(collection(db, 'users', uid, 'combinations'), where('ownerId', '==', uid)),
    (snap) => {
      const list: OutfitCombination[] = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        list.push({
          id: docSnap.id,
          title: String(d.title ?? 'Curated Look'),
          source: d.source === 'custom' ? 'custom' : 'ai',
          rank: typeof d.rank === 'number' ? d.rank : undefined,
          score: Number(d.score ?? 85),
          vectorHarmonyScore: Number(d.vectorHarmonyScore ?? 85),
          itemIds: Array.isArray(d.itemIds) ? d.itemIds : [],
          occasion: (d.occasion ?? 'Smart Casual') as OccasionType,
          season: (d.season ?? 'All-Season') as SeasonTag,
          rationale: String(d.rationale ?? ''),
          fabricFitNotes: String(d.fabricFitNotes ?? ''),
          bodyTailoringNote: String(d.bodyTailoringNote ?? ''),
          finishingTouch: String(d.finishingTouch ?? ''),
          wearCount: Number(d.wearCount ?? 0),
          saved: Boolean(d.saved),
          modelUsed: typeof d.modelUsed === 'string' ? d.modelUsed : undefined,
          createdAt: toIsoString(d.createdAt),
        });
      });
      list.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || b.score - a.score);
      rankedCombinations = list;
      readyCombos = true;
      emitIfReady();
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, combosPath);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );

  const savedPath = `users/${uid}/savedOutfits`;
  const unsubSaved = onSnapshot(
    query(collection(db, 'users', uid, 'savedOutfits'), where('ownerId', '==', uid)),
    (snap) => {
      const list: OutfitCombination[] = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        list.push({
          id: docSnap.id,
          title: String(d.title ?? 'Saved Look'),
          source: d.source === 'ai' ? 'ai' : 'custom',
          rank: typeof d.rank === 'number' ? d.rank : undefined,
          score: Number(d.score ?? 85),
          vectorHarmonyScore: Number(d.vectorHarmonyScore ?? 85),
          itemIds: Array.isArray(d.itemIds) ? d.itemIds : [],
          occasion: (d.occasion ?? 'Smart Casual') as OccasionType,
          season: (d.season ?? 'All-Season') as SeasonTag,
          rationale: String(d.rationale ?? ''),
          fabricFitNotes: String(d.fabricFitNotes ?? ''),
          bodyTailoringNote: String(d.bodyTailoringNote ?? ''),
          finishingTouch: String(d.finishingTouch ?? ''),
          wearCount: Number(d.wearCount ?? 0),
          saved: true,
          modelUsed: typeof d.modelUsed === 'string' ? d.modelUsed : undefined,
          createdAt: toIsoString(d.createdAt),
        });
      });
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      savedOutfits = list;
      readySaved = true;
      emitIfReady();
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, savedPath);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );

  const messagesPath = `users/${uid}/advisorMessages`;
  const unsubMessages = onSnapshot(
    query(collection(db, 'users', uid, 'advisorMessages'), where('ownerId', '==', uid)),
    (snap) => {
      const list: AdvisorMessage[] = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        list.push({
          id: docSnap.id,
          role: d.role === 'user' ? 'user' : 'assistant',
          content: String(d.content ?? ''),
          referencedItemIds: Array.isArray(d.referencedItemIds) ? d.referencedItemIds : undefined,
          sources: Array.isArray(d.sources) ? (d.sources as GroundingSource[]) : undefined,
          modelUsed: typeof d.modelUsed === 'string' ? d.modelUsed : undefined,
          createdAt: toIsoString(d.createdAt),
        });
      });
      list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      advisorMessages = list;
      readyMessages = true;
      emitIfReady();
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, messagesPath);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );

  return () => {
    unsubProfile();
    unsubGarments();
    unsubCombos();
    unsubSaved();
    unsubMessages();
  };
}

export async function addGarmentsToCloud(
  uid: string,
  entries: Array<{ garment: Omit<Garment, 'id' | 'createdAt'>; vector: number[] }>
): Promise<void> {
  if (entries.length === 0) return;
  const path = `users/${uid}/garments`;
  const batch = writeBatch(db);
  for (const entry of entries) {
    const id = makeDocId('garment');
    batch.set(
      doc(db, 'users', uid, 'garments', id),
      buildGarmentFirestoreDoc(uid, entry.garment, entry.vector)
    );
  }
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateGarmentInCloud(
  uid: string,
  current: Garment,
  patch: Partial<Garment>
): Promise<void> {
  const path = `users/${uid}/garments/${current.id}`;
  const updates: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (typeof patch.name === 'string' && patch.name.trim()) {
    updates.name = clampString(patch.name, 100);
  }
  if (patch.category && VALID_CATEGORIES.includes(patch.category)) {
    updates.category = patch.category;
  }
  if (typeof patch.fabric === 'string' && patch.fabric.trim()) {
    updates.fabric = clampString(patch.fabric, 140);
  }
  if (typeof patch.fit === 'string' && patch.fit.trim()) {
    updates.fit = clampString(patch.fit, 80);
  }
  if (typeof patch.primaryColor === 'string' && patch.primaryColor.trim()) {
    updates.primaryColor = clampString(patch.primaryColor, 60);
  }
  if (typeof patch.pattern === 'string' && patch.pattern.trim()) {
    updates.pattern = clampString(patch.pattern, 60);
  }
  if (typeof patch.formality === 'number') {
    updates.formality = Math.max(1, Math.min(10, Math.round(patch.formality)));
  }
  if (typeof patch.stylingNotes === 'string') {
    updates.stylingNotes = clampString(patch.stylingNotes, 300);
  }

  if (current.vectorSource !== 'gemini-embedding-2') {
    updates.vector = computeDeterministicVector({ ...current, ...patch });
  }

  try {
    await updateDoc(doc(db, 'users', uid, 'garments', current.id), updates);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function reanalyzeGarmentInCloud(
  uid: string,
  garmentId: string,
  analyzed: Omit<
    Garment,
    'id' | 'imageUrl' | 'wearCount' | 'hasVector' | 'vectorSource' | 'modelUsed' | 'createdAt'
  >,
  vector: number[],
  vectorSource: 'gemini-embedding-2' | 'semantic-fallback',
  modelUsed: string
): Promise<void> {
  const path = `users/${uid}/garments/${garmentId}`;
  const seasons = sanitizeStringList(analyzed.seasons, 5, 30);
  const occasions = sanitizeStringList(analyzed.occasions, 6, 30);
  const payload = {
    name: clampString(analyzed.name, 100, 'Untitled Piece'),
    category: VALID_CATEGORIES.includes(analyzed.category) ? analyzed.category : 'tops',
    subCategory: clampString(analyzed.subCategory, 80, 'Apparel'),
    primaryColor: clampString(analyzed.primaryColor, 60, 'Neutral'),
    colorHex: /^#[0-9A-Fa-f]{6}$/.test(analyzed.colorHex || '') ? analyzed.colorHex : '#6E6E73',
    secondaryColors: sanitizeStringList(analyzed.secondaryColors, 5, 40),
    undertone: VALID_UNDERTONES.includes(analyzed.undertone) ? analyzed.undertone : 'Neutral',
    fabric: clampString(analyzed.fabric, 140, 'Cotton blend'),
    fabricWeight: VALID_WEIGHTS.includes(analyzed.fabricWeight)
      ? analyzed.fabricWeight
      : 'Midweight',
    texture: clampString(analyzed.texture, 80, 'Smooth matte'),
    fit: clampString(analyzed.fit, 80, 'Tailored'),
    silhouette: clampString(analyzed.silhouette, 120, 'Clean classic'),
    pattern: clampString(analyzed.pattern, 60, 'Solid'),
    formality: Math.max(1, Math.min(10, Math.round(Number(analyzed.formality) || 5))),
    seasons: seasons.length > 0 ? seasons : ['All-Season'],
    occasions: occasions.length > 0 ? occasions : ['Smart Casual'],
    stylingNotes: clampString(analyzed.stylingNotes, 300, ''),
    layeringRole: VALID_ROLES.includes(analyzed.layeringRole) ? analyzed.layeringRole : 'Base',
    hasVector: true,
    vectorSource,
    vector: sanitizeVector(vector, analyzed),
    modelUsed: clampString(modelUsed, 100),
    updatedAt: serverTimestamp(),
  };

  try {
    await updateDoc(doc(db, 'users', uid, 'garments', garmentId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteGarmentFromCloud(
  uid: string,
  garmentId: string,
  combinations: OutfitCombination[],
  savedOutfits: OutfitCombination[]
): Promise<void> {
  const path = `users/${uid}/garments/${garmentId}`;
  const batch = writeBatch(db);
  batch.delete(doc(db, 'users', uid, 'garments', garmentId));

  for (const c of combinations) {
    if (c.itemIds.includes(garmentId)) {
      batch.delete(doc(db, 'users', uid, 'combinations', c.id));
    }
  }
  for (const s of savedOutfits) {
    if (s.itemIds.includes(garmentId)) {
      batch.delete(doc(db, 'users', uid, 'savedOutfits', s.id));
    }
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function replaceRankedCombinationsInCloud(
  uid: string,
  existingIds: string[],
  combinations: OutfitCombination[]
): Promise<void> {
  const path = `users/${uid}/combinations`;
  const batch = writeBatch(db);
  for (const oldId of existingIds) {
    batch.delete(doc(db, 'users', uid, 'combinations', oldId));
  }
  for (const combo of combinations) {
    const id = makeDocId('combo');
    const { id: _id, createdAt: _c, ...rest } = combo;
    batch.set(doc(db, 'users', uid, 'combinations', id), buildOutfitFirestoreDoc(uid, rest));
  }
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function saveOutfitToCloud(
  uid: string,
  payload: Partial<OutfitCombination>,
  garments: Garment[],
  vectors: Record<string, number[]>,
  profile: UserProfile,
  existingSavedCount: number,
  rankedCombinations: OutfitCombination[]
): Promise<void> {
  const validItemIds = Array.isArray(payload.itemIds)
    ? payload.itemIds.filter((id) => garments.some((g) => g.id === id)).slice(0, 10)
    : [];

  if (validItemIds.length < 2) {
    throw new Error('Select at least 2 garments to save an outfit.');
  }

  const items = validItemIds
    .map((id) => garments.find((g) => g.id === id)!)
    .filter(Boolean);
  const localEval = evaluateOutfitLocalHarmony(items, vectors);

  const id = makeDocId('outfit');
  const path = `users/${uid}/savedOutfits/${id}`;
  const docData = buildOutfitFirestoreDoc(uid, {
    title:
      typeof payload.title === 'string' && payload.title.trim()
        ? payload.title.trim().slice(0, 100)
        : `Studio Look #${existingSavedCount + 1}`,
    source: payload.source === 'ai' ? 'ai' : 'custom',
    score: typeof payload.score === 'number' ? payload.score : localEval.overallScore,
    vectorHarmonyScore:
      typeof payload.vectorHarmonyScore === 'number'
        ? payload.vectorHarmonyScore
        : localEval.vectorScore,
    itemIds: validItemIds,
    occasion: payload.occasion || 'Smart Casual',
    season: payload.season || 'All-Season',
    rationale:
      typeof payload.rationale === 'string' && payload.rationale.trim()
        ? payload.rationale.trim()
        : localEval.feedback,
    fabricFitNotes:
      typeof payload.fabricFitNotes === 'string' && payload.fabricFitNotes.trim()
        ? payload.fabricFitNotes.trim()
        : `Built from ${items.map((i) => i.fabric.split(',')[0]).join(' + ')}.`,
    bodyTailoringNote:
      typeof payload.bodyTailoringNote === 'string' && payload.bodyTailoringNote.trim()
        ? payload.bodyTailoringNote.trim()
        : `Curated for your ${profile.bodyType || 'personal'} silhouette.`,
    finishingTouch:
      typeof payload.finishingTouch === 'string' && payload.finishingTouch.trim()
        ? payload.finishingTouch.trim()
        : 'Balance hem length and cuff exposure for sharp proportions.',
    wearCount: 0,
    saved: true,
    modelUsed: payload.modelUsed,
  });

  const batch = writeBatch(db);
  batch.set(doc(db, 'users', uid, 'savedOutfits', id), docData);

  if (payload.id && rankedCombinations.some((c) => c.id === payload.id)) {
    batch.update(doc(db, 'users', uid, 'combinations', payload.id), {
      saved: true,
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function logOutfitWearInCloud(
  uid: string,
  outfit: OutfitCombination,
  garments: Garment[]
): Promise<void> {
  const path = `users/${uid}/savedOutfits/${outfit.id}`;
  const batch = writeBatch(db);
  batch.update(doc(db, 'users', uid, 'savedOutfits', outfit.id), {
    wearCount: Math.min(10000, outfit.wearCount + 1),
    updatedAt: serverTimestamp(),
  });

  for (const gid of outfit.itemIds) {
    const g = garments.find((item) => item.id === gid);
    if (g) {
      batch.update(doc(db, 'users', uid, 'garments', g.id), {
        wearCount: Math.min(10000, g.wearCount + 1),
        updatedAt: serverTimestamp(),
      });
    }
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteSavedOutfitFromCloud(uid: string, outfitId: string): Promise<void> {
  const path = `users/${uid}/savedOutfits/${outfitId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'savedOutfits', outfitId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function updateProfileInCloud(
  uid: string,
  patch: Partial<UserProfile>
): Promise<void> {
  const path = `users/${uid}`;
  const updates: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (typeof patch.name === 'string') updates.name = clampString(patch.name, 80);
  if (typeof patch.bio === 'string') updates.bio = clampString(patch.bio, 600);
  if (typeof patch.height === 'string') updates.height = clampString(patch.height, 40);
  if (typeof patch.bodyType === 'string') updates.bodyType = clampString(patch.bodyType, 60);
  if (patch.skinUndertone && VALID_SKIN_UNDERTONES.includes(patch.skinUndertone)) {
    updates.skinUndertone = patch.skinUndertone;
  }
  if (Array.isArray(patch.preferredFits)) {
    updates.preferredFits = sanitizeStringList(patch.preferredFits, 6, 40);
  }
  if (Array.isArray(patch.styleAesthetics)) {
    updates.styleAesthetics = sanitizeStringList(patch.styleAesthetics, 6, 50);
  }
  if (patch.budgetRange && VALID_BUDGETS.includes(patch.budgetRange)) {
    updates.budgetRange = patch.budgetRange;
  }
  if (patch.climate && VALID_CLIMATES.includes(patch.climate)) {
    updates.climate = patch.climate;
  }
  if (typeof patch.stylingGoals === 'string') {
    updates.stylingGoals = clampString(patch.stylingGoals, 300);
  }

  try {
    await updateDoc(doc(db, 'users', uid), updates);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateProfilePhotoInCloud(uid: string, photoUrl: string): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      photoUrl: clampString(photoUrl, 250000),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateProfileBlueprintInCloud(
  uid: string,
  blueprint: AIProfileBlueprint
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      blueprint: sanitizeBlueprint(blueprint),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function addAdvisorTurnToCloud(
  uid: string,
  userContent: string,
  assistantReply: {
    content: string;
    referencedItemIds?: string[];
    sources?: GroundingSource[];
    modelUsed?: string;
  }
): Promise<void> {
  const path = `users/${uid}/advisorMessages`;
  const userIdDoc = makeDocId('msg_u');
  const assistantIdDoc = makeDocId('msg_a');

  const userPayload = {
    ownerId: uid,
    role: 'user',
    content: clampString(userContent, 4000, 'Question'),
    createdAt: serverTimestamp(),
  };

  const assistantPayload: Record<string, unknown> = {
    ownerId: uid,
    role: 'assistant',
    content: clampString(assistantReply.content, 4000, 'Here is my styling advice.'),
    createdAt: serverTimestamp(),
  };

  if (assistantReply.referencedItemIds && assistantReply.referencedItemIds.length > 0) {
    assistantPayload.referencedItemIds = sanitizeStringList(assistantReply.referencedItemIds, 6, 128);
  }
  if (assistantReply.sources && assistantReply.sources.length > 0) {
    assistantPayload.sources = assistantReply.sources.slice(0, 6).map((s) => ({
      title: clampString(s.title, 120, 'Source'),
      uri: clampString(s.uri, 500),
    }));
  }
  if (assistantReply.modelUsed) {
    assistantPayload.modelUsed = clampString(assistantReply.modelUsed, 100);
  }

  try {
    // Write user message first, then assistant message so createdAt order is strictly preserved
    await setDoc(doc(db, 'users', uid, 'advisorMessages', userIdDoc), userPayload);
    await setDoc(doc(db, 'users', uid, 'advisorMessages', assistantIdDoc), assistantPayload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function clearAdvisorHistoryInCloud(
  uid: string,
  existingIds: string[],
  profileName: string,
  garmentCount: number
): Promise<void> {
  const path = `users/${uid}/advisorMessages`;
  const batch = writeBatch(db);
  for (const id of existingIds) {
    batch.delete(doc(db, 'users', uid, 'advisorMessages', id));
  }
  const welcomeId = makeDocId('msg_welcome');
  batch.set(doc(db, 'users', uid, 'advisorMessages', welcomeId), {
    ownerId: uid,
    role: 'assistant',
    content: `Fresh styling thread ready${profileName ? `, ${profileName}` : ''}. I have all ${garmentCount} pieces from your cloud wardrobe in view—ask about trends, wardrobe gaps, or anything you are considering buying.`,
    createdAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
