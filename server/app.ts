import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import express from 'express';
import multer from 'multer';
import {
  analyzeGarmentWithAI,
  analyzeUserProfileWithAI,
  chatWithShoppingAdvisor,
  critiqueCustomOutfitWithAI,
  generateGarmentVector,
  rankCombinationsWithAI,
  streamShoppingAdvisorChat,
} from './aiRouter.ts';
import {
  getBootstrapPayload,
  loadStore,
  readImageAsBase64,
  resolveSafeUploadPath,
  saveStore,
  saveVectors,
  UPLOADS_DIR,
} from './store.ts';
import type {
  AdvisorMessage,
  Garment,
  GarmentCategory,
  OccasionType,
  OutfitCombination,
  SeasonTag,
} from '../src/types/styling.ts';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  computeDeterministicVector,
  evaluateOutfitLocalHarmony,
  generateCandidateCombinations,
  MAX_BATCH_UPLOAD_FILES,
} from '../src/utils/styleEngine.ts';

const IS_VERCEL = Boolean(process.env.VERCEL);

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const extMap: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/avif': '.avif',
    };
    const ext = extMap[file.mimetype.toLowerCase()] ?? '.jpg';
    cb(null, `item_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}${ext}`);
  },
});

const upload = multer({
  storage: uploadStorage,
  limits: {
    files: MAX_BATCH_UPLOAD_FILES,
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function next(): Promise<void> {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await worker(items[idx], idx);
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () => next());
  await Promise.all(runners);
  return results;
}

interface PortraitPayload {
  base64: string;
  mimeType: string;
}

function parseDataUrlPortrait(url: string | undefined | null): PortraitPayload | null {
  if (!url || typeof url !== 'string' || !url.startsWith('data:')) return null;
  const match = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) return null;
  const base64 = match[2].replace(/\s+/g, '');
  // Cap at ~260KB of base64 (~195KB decoded) for lean multimodal calls
  if (!base64 || base64.length > 260_000) return null;
  return { base64, mimeType };
}

function extractPortraitImage(
  bodyPortrait?: { base64?: string; mimeType?: string } | null,
  profilePhotoUrl?: string
): PortraitPayload | null {
  if (
    bodyPortrait &&
    typeof bodyPortrait.base64 === 'string' &&
    typeof bodyPortrait.mimeType === 'string'
  ) {
    const mimeType = bodyPortrait.mimeType.trim().toLowerCase();
    const base64 = bodyPortrait.base64.trim();
    if (ALLOWED_IMAGE_MIME_TYPES.has(mimeType) && base64.length > 0 && base64.length <= 260_000) {
      return { base64, mimeType };
    }
  }
  const fromDataUrl = parseDataUrlPortrait(profilePhotoUrl);
  if (fromDataUrl) return fromDataUrl;
  if (typeof profilePhotoUrl === 'string' && profilePhotoUrl.startsWith('/uploads/')) {
    return readImageAsBase64(profilePhotoUrl);
  }
  return null;
}

async function fetchRemotePortraitImage(url: string): Promise<PortraitPayload | null> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    // Block localhost / private IP literal hosts
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return null;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      const resp = await fetch(parsed.toString(), {
        signal: controller.signal,
        headers: { Accept: 'image/*' },
      });
      if (!resp.ok) return null;
      const ct = (resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const mimeType = ALLOWED_IMAGE_MIME_TYPES.has(ct) ? ct : 'image/jpeg';
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length === 0 || buf.length > 1_200_000) return null;
      return { base64: buf.toString('base64'), mimeType };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

export function createApiApp(): express.Express {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '12mb' }));

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  // Warm the in-memory store immediately
  loadStore();

  // Securely serve user-uploaded images with strict path confinement
  app.get('/uploads/:filename', (req, res) => {
    const safePath = resolveSafeUploadPath(req.params.filename);
    if (!safePath || !fs.existsSync(safePath)) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(safePath);
  });

  // Instant single-request bootstrap for zero-lag navigation
  app.get('/api/bootstrap', (_req, res) => {
    res.json(getBootstrapPayload());
  });

  // Batch upload & forensic AI + Vector indexing (up to 50 clothing items at once)
  app.post('/api/wardrobe/upload', (req, res) => {
    upload.array('files', MAX_BATCH_UPLOAD_FILES)(req, res, async (uploadErr) => {
      if (uploadErr) {
        res.status(400).json({ error: uploadErr.message || 'Upload failed' });
        return;
      }

      const files = (req.files as Express.Multer.File[]) ?? [];
      if (files.length === 0) {
        res.status(400).json({ error: 'No valid clothing images uploaded.' });
        return;
      }

      const { store, vectors } = loadStore();

      try {
        const processed = await runWithConcurrency(files, 4, async (file) => {
          const base64 = fs.readFileSync(file.path).toString('base64');
          const mimeType = file.mimetype || 'image/jpeg';
          // On Vercel serverless, embed compressed data URLs so images render across stateless instances
          const imageUrl = IS_VERCEL
            ? `data:${mimeType};base64,${base64}`
            : `/uploads/${file.filename}`;

          if (IS_VERCEL && fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }

          const { garment: analyzed, modelUsed } = await analyzeGarmentWithAI(
            base64,
            mimeType,
            file.originalname
          );

          const { vector, source: vectorSource } = await generateGarmentVector(
            base64,
            mimeType,
            analyzed
          );

          const id = `garment_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
          const garment: Garment = {
            id,
            ...analyzed,
            imageUrl,
            wearCount: 0,
            hasVector: true,
            vectorSource,
            modelUsed,
            createdAt: new Date().toISOString(),
          };

          return { garment, vector };
        });

        for (const item of processed) {
          store.garments.unshift(item.garment);
          vectors[item.garment.id] = item.vector;
        }
        saveStore();
        saveVectors();

        res.json({
          added: processed.map((p) => p.garment),
          bootstrap: getBootstrapPayload(),
        });
      } catch (err) {
        // Clean up uploaded files if AI analysis completely failed
        for (const file of files) {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        }
        const message = err instanceof Error ? err.message : 'Garment analysis failed.';
        res.status(502).json({ error: message });
      }
    });
  });

  // Update garment metadata manually
  app.patch('/api/wardrobe/:id', (req, res) => {
    const { store, vectors } = loadStore();
    const garment = store.garments.find((g) => g.id === req.params.id);
    if (!garment) {
      res.status(404).json({ error: 'Garment not found' });
      return;
    }

    const body = req.body as Partial<Garment>;
    const validCats: GarmentCategory[] = [
      'tops',
      'bottoms',
      'outerwear',
      'footwear',
      'accessories',
    ];

    if (typeof body.name === 'string' && body.name.trim()) {
      garment.name = body.name.trim().slice(0, 80);
    }
    if (body.category && validCats.includes(body.category)) {
      garment.category = body.category;
    }
    if (typeof body.fabric === 'string' && body.fabric.trim()) {
      garment.fabric = body.fabric.trim().slice(0, 100);
    }
    if (typeof body.fit === 'string' && body.fit.trim()) {
      garment.fit = body.fit.trim().slice(0, 80);
    }
    if (typeof body.primaryColor === 'string' && body.primaryColor.trim()) {
      garment.primaryColor = body.primaryColor.trim().slice(0, 40);
    }
    if (typeof body.pattern === 'string' && body.pattern.trim()) {
      garment.pattern = body.pattern.trim().slice(0, 50);
    }
    if (typeof body.formality === 'number') {
      garment.formality = Math.max(1, Math.min(10, Math.round(body.formality)));
    }
    if (typeof body.stylingNotes === 'string') {
      garment.stylingNotes = body.stylingNotes.trim().slice(0, 240);
    }

    if (garment.vectorSource !== 'gemini-embedding-2') {
      vectors[garment.id] = computeDeterministicVector(garment);
      saveVectors();
    }
    saveStore();
    res.json({ garment, bootstrap: getBootstrapPayload() });
  });

  // Re-run deep AI garment inspection & vector indexing
  app.post('/api/wardrobe/:id/reanalyze', async (req, res) => {
    const { store, vectors } = loadStore();
    const garment = store.garments.find((g) => g.id === req.params.id);
    if (!garment) {
      res.status(404).json({ error: 'Garment not found' });
      return;
    }

    const img = readImageAsBase64(garment.imageUrl);
    if (!img) {
      res.status(404).json({ error: 'Garment image file could not be loaded on the server.' });
      return;
    }

    try {
      const { garment: analyzed, modelUsed } = await analyzeGarmentWithAI(
        img.base64,
        img.mimeType,
        garment.name
      );
      const { vector, source: vectorSource } = await generateGarmentVector(
        img.base64,
        img.mimeType,
        analyzed
      );

      Object.assign(garment, analyzed, {
        hasVector: true,
        vectorSource,
        modelUsed,
      });
      vectors[garment.id] = vector;
      saveStore();
      saveVectors();

      res.json({ garment, bootstrap: getBootstrapPayload() });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Failed to re-analyze garment.',
      });
    }
  });

  // Delete garment
  app.delete('/api/wardrobe/:id', (req, res) => {
    const { store, vectors } = loadStore();
    const idx = store.garments.findIndex((g) => g.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Garment not found' });
      return;
    }

    const [removed] = store.garments.splice(idx, 1);
    delete vectors[removed.id];

    // Remove uploaded file if it belongs to uploads/
    if (removed.imageUrl.startsWith('/uploads/')) {
      const safePath = resolveSafeUploadPath(removed.imageUrl.slice('/uploads/'.length));
      if (safePath && fs.existsSync(safePath)) {
        fs.unlinkSync(safePath);
      }
    }

    // Prune deleted garment from combinations and saved outfits
    store.rankedCombinations = store.rankedCombinations.filter(
      (c) => !c.itemIds.includes(removed.id)
    );
    store.savedOutfits = store.savedOutfits.filter(
      (c) => !c.itemIds.includes(removed.id)
    );

    saveStore();
    saveVectors();
    res.json({ bootstrap: getBootstrapPayload() });
  });

  // Generate AI-ranked outfit combinations (vector pre-screened for minimal tokens)
  app.post('/api/combinations/rank', async (req, res) => {
    const { store, vectors } = loadStore();
    const body = req.body as {
      occasion?: OccasionType;
      season?: SeasonTag;
      anchorItemId?: string;
    };

    const occasion: OccasionType = body.occasion || 'Smart Casual';
    const season: SeasonTag = body.season || 'All-Season';
    const anchorItemId =
      typeof body.anchorItemId === 'string' && body.anchorItemId.trim()
        ? body.anchorItemId.trim()
        : undefined;

    const candidates = generateCandidateCombinations(store.garments, vectors, {
      occasion,
      season,
      anchorItemId,
      profile: store.profile,
      savedOutfits: store.savedOutfits,
      previousCombinations: store.rankedCombinations,
      rotationSeed: Date.now() % 100000,
      maxCandidates: 10,
    });

    if (candidates.length === 0) {
      res.status(400).json({
        error:
          'Add at least one top and one bottom (and ensure your selected anchor piece fits) to generate combinations.',
      });
      return;
    }

    try {
      const { combinations, modelUsed } = await rankCombinationsWithAI(
        candidates,
        store.profile,
        occasion,
        season
      );

      store.rankedCombinations = combinations;
      saveStore();

      res.json({
        combinations,
        modelUsed,
        bootstrap: getBootstrapPayload(),
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Failed to rank combinations.',
      });
    }
  });

  // Save a custom or AI-suggested outfit to the Lookbook
  app.post('/api/outfits', (req, res) => {
    const { store, vectors } = loadStore();
    const body = req.body as Partial<OutfitCombination>;

    const itemIds = Array.isArray(body.itemIds)
      ? body.itemIds.filter((id): id is string =>
          store.garments.some((g) => g.id === id)
        )
      : [];

    if (itemIds.length < 2) {
      res.status(400).json({ error: 'Select at least 2 garments to save an outfit.' });
      return;
    }

    const title =
      typeof body.title === 'string' && body.title.trim()
        ? body.title.trim().slice(0, 80)
        : `Studio Look #${store.savedOutfits.length + 1}`;

    const items = itemIds
      .map((id) => store.garments.find((g) => g.id === id)!)
      .filter(Boolean);
    const localEval = evaluateOutfitLocalHarmony(items, vectors);

    const outfit: OutfitCombination = {
      id: `outfit_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
      title,
      source: body.source === 'ai' ? 'ai' : 'custom',
      score: typeof body.score === 'number' ? body.score : localEval.overallScore,
      vectorHarmonyScore:
        typeof body.vectorHarmonyScore === 'number'
          ? body.vectorHarmonyScore
          : localEval.vectorScore,
      itemIds,
      occasion: body.occasion || 'Smart Casual',
      season: body.season || 'All-Season',
      rationale:
        typeof body.rationale === 'string' && body.rationale.trim()
          ? body.rationale.trim().slice(0, 320)
          : localEval.feedback,
      fabricFitNotes:
        typeof body.fabricFitNotes === 'string' && body.fabricFitNotes.trim()
          ? body.fabricFitNotes.trim().slice(0, 260)
          : `Built from ${items.map((i) => i.fabric.split(',')[0]).join(' + ')}.`,
      bodyTailoringNote:
        typeof body.bodyTailoringNote === 'string' && body.bodyTailoringNote.trim()
          ? body.bodyTailoringNote.trim().slice(0, 260)
          : `Curated for your ${store.profile.bodyType || 'personal'} silhouette.`,
      finishingTouch:
        typeof body.finishingTouch === 'string' && body.finishingTouch.trim()
          ? body.finishingTouch.trim().slice(0, 200)
          : 'Balance hem length and cuff exposure for sharp proportions.',
      wearCount: 0,
      saved: true,
      modelUsed: body.modelUsed,
      createdAt: new Date().toISOString(),
    };

    // Mark matching ranked combo as saved if it came from AI suggestions
    if (body.id) {
      const ranked = store.rankedCombinations.find((c) => c.id === body.id);
      if (ranked) ranked.saved = true;
    }

    store.savedOutfits.unshift(outfit);
    saveStore();
    res.json({ outfit, bootstrap: getBootstrapPayload() });
  });

  // AI critique for a user-built custom outfit in Studio
  app.post('/api/outfits/critique', async (req, res) => {
    const { store } = loadStore();
    const body = req.body as { itemIds?: string[]; occasion?: OccasionType };
    const items = (body.itemIds ?? [])
      .map((id) => store.garments.find((g) => g.id === id))
      .filter((g): g is Garment => Boolean(g));

    if (items.length < 2) {
      res.status(400).json({ error: 'Select at least 2 pieces for an AI styling critique.' });
      return;
    }

    try {
      const critique = await critiqueCustomOutfitWithAI(
        items,
        store.profile,
        body.occasion || 'Smart Casual',
        null,
        store.garments
      );
      res.json(critique);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Failed to critique outfit.',
      });
    }
  });

  // Log "Worn Today" on a saved outfit (increments outfit & constituent garment wear counts)
  app.post('/api/outfits/:id/wear', (req, res) => {
    const { store } = loadStore();
    const outfit = store.savedOutfits.find((o) => o.id === req.params.id);
    if (!outfit) {
      res.status(404).json({ error: 'Saved outfit not found' });
      return;
    }
    outfit.wearCount += 1;
    for (const gid of outfit.itemIds) {
      const g = store.garments.find((item) => item.id === gid);
      if (g) g.wearCount += 1;
    }
    saveStore();
    res.json({ outfit, bootstrap: getBootstrapPayload() });
  });

  // Delete saved outfit
  app.delete('/api/outfits/:id', (req, res) => {
    const { store } = loadStore();
    const idx = store.savedOutfits.findIndex((o) => o.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Outfit not found' });
      return;
    }
    store.savedOutfits.splice(idx, 1);
    saveStore();
    res.json({ bootstrap: getBootstrapPayload() });
  });

  // Update personal style profile
  app.put('/api/profile', (req, res) => {
    const { store } = loadStore();
    const body = req.body as Partial<typeof store.profile>;

    if (typeof body.name === 'string') store.profile.name = body.name.trim().slice(0, 60);
    if (typeof body.bio === 'string') store.profile.bio = body.bio.trim().slice(0, 600);
    if (typeof body.height === 'string') store.profile.height = body.height.trim().slice(0, 40);
    if (typeof body.bodyType === 'string') store.profile.bodyType = body.bodyType.trim().slice(0, 60);
    if (
      body.skinUndertone &&
      ['Warm', 'Cool', 'Neutral', 'Olive', 'Warm Olive', 'Cool Olive'].includes(body.skinUndertone)
    ) {
      store.profile.skinUndertone = body.skinUndertone;
    }
    if (Array.isArray(body.preferredFits)) {
      store.profile.preferredFits = body.preferredFits
        .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
        .slice(0, 12);
    }
    if (Array.isArray(body.styleAesthetics)) {
      store.profile.styleAesthetics = body.styleAesthetics
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .slice(0, 12);
    }
    if (
      body.budgetRange &&
      ['Accessible', 'Mid-Tier', 'Contemporary', 'Luxury'].includes(body.budgetRange)
    ) {
      store.profile.budgetRange = body.budgetRange;
    }
    if (
      body.climate &&
      ['Temperate', 'Warm', 'Cold', 'Four-Season'].includes(body.climate)
    ) {
      store.profile.climate = body.climate;
    }
    if (typeof body.stylingGoals === 'string') {
      store.profile.stylingGoals = body.stylingGoals.trim().slice(0, 300);
    }

    store.profile.updatedAt = new Date().toISOString();
    saveStore();
    res.json({ profile: store.profile, bootstrap: getBootstrapPayload() });
  });

  // Upload user portrait photo
  app.post('/api/profile/photo', (req, res) => {
    upload.single('photo')(req, res, (uploadErr) => {
      if (uploadErr) {
        res.status(400).json({ error: uploadErr.message || 'Photo upload failed.' });
        return;
      }
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'Please select a portrait image.' });
        return;
      }
      const { store } = loadStore();
      // Remove previous uploaded portrait if present
      if (store.profile.photoUrl.startsWith('/uploads/')) {
        const oldPath = resolveSafeUploadPath(
          store.profile.photoUrl.slice('/uploads/'.length)
        );
        if (oldPath && fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }

      if (IS_VERCEL) {
        const base64 = fs.readFileSync(file.path).toString('base64');
        const mimeType = file.mimetype || 'image/jpeg';
        store.profile.photoUrl = `data:${mimeType};base64,${base64}`;
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      } else {
        store.profile.photoUrl = `/uploads/${file.filename}`;
      }

      store.profile.updatedAt = new Date().toISOString();
      saveStore();
      res.json({ profile: store.profile, bootstrap: getBootstrapPayload() });
    });
  });

  // Run one-time cached AI Appearance & Proportion Blueprint analysis
  app.post('/api/profile/analyze', async (_req, res) => {
    const { store } = loadStore();
    const img = readImageAsBase64(store.profile.photoUrl);

    try {
      const { blueprint, modelUsed } = await analyzeUserProfileWithAI(
        store.profile,
        img?.base64 ?? null,
        img?.mimeType ?? null
      );
      store.profile.blueprint = blueprint;
      store.profile.updatedAt = new Date().toISOString();
      saveStore();
      res.json({ blueprint, modelUsed, bootstrap: getBootstrapPayload() });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Failed to analyze profile.',
      });
    }
  });

  // Shopping Advisor chat (sees full compact wardrobe + profile + trends via Google Search)
  app.post('/api/advisor/chat', async (req, res) => {
    const { store } = loadStore();
    const body = req.body as { message?: string };
    const text = typeof body.message === 'string' ? body.message.trim() : '';

    if (!text) {
      res.status(400).json({ error: 'Enter a question for your shopping advisor.' });
      return;
    }

    const userMsg: AdvisorMessage = {
      id: `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
      role: 'user',
      content: text.slice(0, 1000),
      createdAt: new Date().toISOString(),
    };

    try {
      const reply = await chatWithShoppingAdvisor(
        userMsg.content,
        store.advisorMessages,
        store.garments,
        store.savedOutfits,
        store.profile
      );

      const assistantMsg: AdvisorMessage = {
        id: `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
        role: 'assistant',
        content: reply.content,
        referencedItemIds: reply.referencedItemIds,
        sources: reply.sources,
        modelUsed: reply.modelUsed,
        createdAt: new Date().toISOString(),
      };

      store.advisorMessages.push(userMsg, assistantMsg);
      // Keep server history lean (max 40 recent turns)
      if (store.advisorMessages.length > 40) {
        store.advisorMessages = store.advisorMessages.slice(-40);
      }
      saveStore();

      res.json({
        userMessage: userMsg,
        assistantMessage: assistantMsg,
        bootstrap: getBootstrapPayload(),
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Shopping advisor request failed.',
      });
    }
  });

  // Clear Shopping Advisor history
  app.delete('/api/advisor/history', (_req, res) => {
    const { store } = loadStore();
    store.advisorMessages = store.advisorMessages.slice(0, 1);
    saveStore();
    res.json({ bootstrap: getBootstrapPayload() });
  });

  // =========================================================================
  // Stateless AI Compute Endpoints (used by Firebase Cloud Wardrobe clients)
  // Zero server-side user state required — works identically on Vercel & Cloud Run
  // =========================================================================

  // Stateless single-garment forensic AI inspection + 128-dim image vector
  app.post('/api/ai/analyze-garment', async (req, res) => {
    const body = req.body as {
      base64?: string;
      mimeType?: string;
      fileName?: string;
      imageUrl?: string;
    };

    let base64 = typeof body.base64 === 'string' ? body.base64.trim() : '';
    let mimeType = typeof body.mimeType === 'string' ? body.mimeType.trim() : 'image/jpeg';

    if (!base64 && typeof body.imageUrl === 'string' && body.imageUrl.trim()) {
      const loaded = readImageAsBase64(body.imageUrl.trim());
      if (loaded) {
        base64 = loaded.base64;
        mimeType = loaded.mimeType;
      }
    }

    if (!base64 || !ALLOWED_IMAGE_MIME_TYPES.has(mimeType.toLowerCase())) {
      res.status(400).json({ error: 'Provide a valid clothing image for AI inspection.' });
      return;
    }

    try {
      const { garment: analyzed, modelUsed } = await analyzeGarmentWithAI(
        base64,
        mimeType,
        typeof body.fileName === 'string' ? body.fileName.slice(0, 120) : undefined
      );
      const { vector, source: vectorSource } = await generateGarmentVector(
        base64,
        mimeType,
        analyzed
      );
      res.json({ analyzed, vector, vectorSource, modelUsed });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Garment analysis failed.',
      });
    }
  });

  // Stateless outfit combination ranking from user's cloud wardrobe + vectors + portrait
  app.post('/api/ai/rank-combinations', async (req, res) => {
    const body = req.body as {
      garments?: Garment[];
      vectors?: Record<string, number[]>;
      profile?: import('../src/types/styling.ts').UserProfile;
      portraitImage?: { base64?: string; mimeType?: string } | null;
      occasion?: OccasionType;
      season?: SeasonTag;
      anchorItemId?: string;
      customPrompt?: string;
      savedOutfits?: OutfitCombination[];
      previousCombinations?: OutfitCombination[];
      rotationSeed?: number;
      explorationMode?: 'best' | 'fresh';
    };

    const garments = Array.isArray(body.garments) ? body.garments.slice(0, 120) : [];
    const vectors = body.vectors && typeof body.vectors === 'object' ? body.vectors : {};
    const profile = body.profile;
    const savedOutfits = Array.isArray(body.savedOutfits) ? body.savedOutfits.slice(0, 30) : [];
    const previousCombinations = Array.isArray(body.previousCombinations)
      ? body.previousCombinations.slice(0, 12)
      : [];
    const rotationSeed =
      typeof body.rotationSeed === 'number' && Number.isFinite(body.rotationSeed)
        ? Math.floor(body.rotationSeed)
        : Date.now() % 100000;
    const explorationMode: 'best' | 'fresh' =
      body.explorationMode === 'fresh' ? 'fresh' : 'best';

    if (garments.length < 2 || !profile) {
      res.status(400).json({
        error: 'Add at least one top and one bottom to generate personalized combinations.',
      });
      return;
    }

    const occasion: OccasionType = body.occasion || 'Smart Casual';
    const season: SeasonTag = body.season || 'All-Season';
    const anchorItemId =
      typeof body.anchorItemId === 'string' && body.anchorItemId.trim()
        ? body.anchorItemId.trim()
        : undefined;
    const customPrompt =
      typeof body.customPrompt === 'string' && body.customPrompt.trim()
        ? body.customPrompt.trim().slice(0, 320)
        : undefined;

    // Stage 1: Multi-objective retrieval + seasonal thermal guard + multi-layer assembly + stratified rotation + global-exposure MMR
    const candidates = generateCandidateCombinations(garments, vectors, {
      occasion,
      season,
      anchorItemId,
      customPrompt,
      profile,
      savedOutfits,
      previousCombinations,
      rotationSeed,
      explorationMode,
      maxCandidates: 10,
    });

    if (candidates.length === 0) {
      const effectivePrompt = (customPrompt || '').toLowerCase();
      const isSummer = season === 'Summer' || /\b(summer|hot|heat|humid|beach|tropical)\b/.test(effectivePrompt);
      res.status(400).json({
        error: isSummer
          ? 'No breathable summer-appropriate tops and bottoms were found in your wardrobe (heavy sweaters and winter coats are excluded in Summer). Upload lightweight shirts, tees, or polos to generate summer looks.'
          : 'Add at least one top and one bottom (and ensure your selected anchor piece fits) to generate combinations.',
      });
      return;
    }

    const portraitImage = extractPortraitImage(body.portraitImage, profile.photoUrl);

    try {
      // Stage 2: Multimodal cross-encoder stylist reranks 8 MMR finalists -> top 5 curated looks
      const { combinations, modelUsed } = await rankCombinationsWithAI(
        candidates,
        profile,
        occasion,
        season,
        customPrompt,
        savedOutfits,
        explorationMode,
        portraitImage
      );
      res.json({
        combinations,
        modelUsed,
        effectiveSeason: candidates[0]?.effectiveSeason ?? season,
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Failed to rank combinations.',
      });
    }
  });

  // Stateless AI critique for a user-built custom outfit
  app.post('/api/ai/critique-outfit', async (req, res) => {
    const body = req.body as {
      items?: Garment[];
      allGarments?: Garment[];
      profile?: import('../src/types/styling.ts').UserProfile;
      portraitImage?: { base64?: string; mimeType?: string } | null;
      occasion?: OccasionType;
    };

    const items = Array.isArray(body.items) ? body.items.slice(0, 10) : [];
    const allGarments = Array.isArray(body.allGarments) ? body.allGarments.slice(0, 120) : [];
    if (items.length < 2 || !body.profile) {
      res.status(400).json({ error: 'Select at least 2 pieces for an AI styling critique.' });
      return;
    }

    const portraitImage = extractPortraitImage(body.portraitImage, body.profile.photoUrl);

    try {
      const critique = await critiqueCustomOutfitWithAI(
        items,
        body.profile,
        body.occasion || 'Smart Casual',
        portraitImage,
        allGarments
      );
      res.json(critique);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Failed to critique outfit.',
      });
    }
  });

  // Stateless Personal Styling Blueprint analysis from profile + portrait
  app.post('/api/ai/analyze-profile', async (req, res) => {
    const body = req.body as {
      profile?: import('../src/types/styling.ts').UserProfile;
      photoBase64?: string | null;
      photoMimeType?: string | null;
    };

    if (!body.profile) {
      res.status(400).json({ error: 'Profile details are required.' });
      return;
    }

    let photoBase64 = typeof body.photoBase64 === 'string' && body.photoBase64.trim()
      ? body.photoBase64.trim()
      : null;
    let photoMimeType = typeof body.photoMimeType === 'string' && body.photoMimeType.trim()
      ? body.photoMimeType.trim().toLowerCase()
      : null;

    if (!photoBase64 && typeof body.profile.photoUrl === 'string' && body.profile.photoUrl.trim()) {
      const url = body.profile.photoUrl.trim();
      const fromData = parseDataUrlPortrait(url);
      if (fromData) {
        photoBase64 = fromData.base64;
        photoMimeType = fromData.mimeType;
      } else if (url.startsWith('https://')) {
        const fetched = await fetchRemotePortraitImage(url);
        if (fetched) {
          photoBase64 = fetched.base64;
          photoMimeType = fetched.mimeType;
        }
      } else {
        const loaded = readImageAsBase64(url);
        if (loaded) {
          photoBase64 = loaded.base64;
          photoMimeType = loaded.mimeType;
        }
      }
    }

    try {
      const { blueprint, suggestedProfile, modelUsed } = await analyzeUserProfileWithAI(
        body.profile,
        photoBase64,
        photoMimeType
      );
      res.json({ blueprint, suggestedProfile, modelUsed });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Failed to analyze profile.',
      });
    }
  });

  const parseAdvisorRequestBody = (rawBody: unknown) => {
    const body = (rawBody ?? {}) as {
      message?: string;
      history?: AdvisorMessage[];
      garments?: Garment[];
      savedOutfits?: OutfitCombination[];
      profile?: import('../src/types/styling.ts').UserProfile;
      portraitImage?: { base64?: string; mimeType?: string } | null;
      images?: Array<{ base64?: string; mimeType?: string; label?: string }>;
      memorySummary?: string;
      summarizedCount?: number;
    };

    const rawImages = Array.isArray(body.images) ? body.images.slice(0, 4) : [];
    const validImages = rawImages
      .filter(
        (img): img is { base64: string; mimeType: string; label?: string } =>
          Boolean(img) &&
          typeof img.base64 === 'string' &&
          img.base64.trim().length > 0 &&
          typeof img.mimeType === 'string' &&
          ALLOWED_IMAGE_MIME_TYPES.has(img.mimeType.trim().toLowerCase())
      )
      .map((img, idx) => ({
        base64: img.base64.trim(),
        mimeType: img.mimeType.trim().toLowerCase(),
        label:
          typeof img.label === 'string' && img.label.trim()
            ? img.label.trim().slice(0, 60)
            : `Option ${idx + 1}`,
      }));

    const text = typeof body.message === 'string' ? body.message.trim() : '';
    const effectiveQuestion =
      text ||
      (validImages.length > 1
        ? 'Compare these items and tell me which one is the best buy for my wardrobe, style, and proportions.'
        : validImages.length === 1
          ? 'Should I buy this item? Analyze how well it fits my wardrobe, colors, and proportions.'
          : '');

    const memory = {
      summary: typeof body.memorySummary === 'string' ? body.memorySummary.slice(0, 1200) : '',
      summarizedCount:
        typeof body.summarizedCount === 'number' && Number.isFinite(body.summarizedCount)
          ? Math.max(0, Math.floor(body.summarizedCount))
          : 0,
    };

    return {
      effectiveQuestion,
      profile: body.profile,
      history: Array.isArray(body.history) ? body.history.slice(-40) : [],
      garments: Array.isArray(body.garments) ? body.garments.slice(0, 120) : [],
      savedOutfits: Array.isArray(body.savedOutfits) ? body.savedOutfits.slice(0, 20) : [],
      validImages,
      portraitImage: body.profile ? extractPortraitImage(body.portraitImage, body.profile.photoUrl) : null,
      memory,
    };
  };

  // Stateless Shopping Advisor chat (JSON response, backward compatible)
  app.post('/api/ai/advisor-chat', async (req, res) => {
    const parsed = parseAdvisorRequestBody(req.body);
    if (!parsed.effectiveQuestion || !parsed.profile) {
      res.status(400).json({ error: 'Enter a question or upload an item photo for your shopping advisor.' });
      return;
    }

    try {
      const reply = await chatWithShoppingAdvisor(
        parsed.effectiveQuestion.slice(0, 1000),
        parsed.history,
        parsed.garments,
        parsed.savedOutfits,
        parsed.profile,
        parsed.validImages,
        parsed.portraitImage,
        parsed.memory
      );
      res.json(reply);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Shopping advisor request failed.',
      });
    }
  });

  // Streaming Shopping Advisor chat over Server-Sent Events (SSE) for instant word-by-word display
  app.post('/api/ai/advisor-chat-stream', async (req, res) => {
    const parsed = parseAdvisorRequestBody(req.body);
    if (!parsed.effectiveQuestion || !parsed.profile) {
      res.status(400).json({ error: 'Enter a question or upload an item photo for your shopping advisor.' });
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let clientClosed = false;
    res.on('close', () => {
      if (!res.writableEnded) {
        clientClosed = true;
      }
    });

    const writeSseEvent = (event: string, data: unknown) => {
      if (clientClosed || res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const reply = await streamShoppingAdvisorChat(
        parsed.effectiveQuestion.slice(0, 1000),
        parsed.history,
        parsed.garments,
        parsed.savedOutfits,
        parsed.profile,
        parsed.validImages,
        parsed.portraitImage,
        parsed.memory,
        {
          onStatus: (phase) => writeSseEvent('status', { phase }),
          onDelta: (text) => writeSseEvent('delta', { text }),
        }
      );

      writeSseEvent('done', reply);
      if (!res.writableEnded) res.end();
    } catch (err) {
      writeSseEvent('error', {
        error: err instanceof Error ? err.message : 'Shopping advisor stream failed.',
      });
      if (!res.writableEnded) res.end();
    }
  });

  // Never let unmatched /api/* routes fall through to Vite/SPA index.html (<!doctype html>)
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // Always serialize Express middleware errors (e.g. PayloadTooLargeError, malformed JSON) as JSON
  app.use(
    (
      err: { status?: number; statusCode?: number; type?: string; message?: string },
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (res.headersSent) {
        next(err);
        return;
      }
      if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) {
        const status =
          err.type === 'entity.too.large'
            ? 413
            : typeof err.status === 'number'
              ? err.status
              : typeof err.statusCode === 'number'
                ? err.statusCode
                : 500;
        const message =
          err.type === 'entity.too.large'
            ? 'Image or request payload is too large. Please try again with smaller images.'
            : err.message || 'Unexpected server error.';
        res.status(status).json({ error: message });
        return;
      }
      next(err);
    }
  );

  return app;
}
