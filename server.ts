import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import {
  analyzeGarmentWithAI,
  analyzeUserProfileWithAI,
  chatWithShoppingAdvisor,
  critiqueCustomOutfitWithAI,
  generateGarmentVector,
  rankCombinationsWithAI,
} from './server/aiRouter.ts';
import {
  getBootstrapPayload,
  loadStore,
  readImageAsBase64,
  resolveSafeUploadPath,
  saveStore,
  saveVectors,
  UPLOADS_DIR,
} from './server/store.ts';
import type {
  AdvisorMessage,
  Garment,
  GarmentCategory,
  OccasionType,
  OutfitCombination,
  SeasonTag,
} from './src/types/styling.ts';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  computeDeterministicVector,
  evaluateOutfitLocalHarmony,
  generateCandidateCombinations,
  MAX_BATCH_UPLOAD_FILES,
  MAX_SINGLE_FILE_BYTES,
} from './src/utils/styleEngine.ts';

const PORT = Number(process.env.PORT) || 3000;

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
    fileSize: MAX_SINGLE_FILE_BYTES,
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

async function startServer() {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '4mb' }));

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
          const imageUrl = `/uploads/${file.filename}`;

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
      maxCandidates: 5,
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
        body.occasion || 'Smart Casual'
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
      ['Warm', 'Cool', 'Neutral', 'Olive'].includes(body.skinUndertone)
    ) {
      store.profile.skinUndertone = body.skinUndertone;
    }
    if (Array.isArray(body.preferredFits)) {
      store.profile.preferredFits = body.preferredFits
        .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
        .slice(0, 6);
    }
    if (Array.isArray(body.styleAesthetics)) {
      store.profile.styleAesthetics = body.styleAesthetics
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .slice(0, 6);
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

      store.profile.photoUrl = `/uploads/${file.filename}`;
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

  // Mount Vite middleware in development or static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`What do I Wear? server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
