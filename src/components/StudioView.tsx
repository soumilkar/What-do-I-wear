import { useEffect, useMemo, useState } from 'react';
import { Check, Plus, Sparkles, Trash2 } from 'lucide-react';
import type {
  Garment,
  GarmentCategory,
  OccasionType,
  OutfitCombination,
  SeasonTag,
  UserProfile,
} from '../types/styling';
import {
  classifyTopLayerRole,
  computeDeterministicVector,
  evaluateOutfitLocalHarmony,
} from '../utils/styleEngine';
import { SmartImage } from './SmartImage';

interface StudioViewProps {
  garments: Garment[];
  vectors: Record<string, number[]>;
  profile: UserProfile;
  savedOutfits: OutfitCombination[];
  draftSeed?: OutfitCombination | null;
  onClearDraftSeed: () => void;
  onSaveOutfit: (payload: Partial<OutfitCombination>) => Promise<void>;
  onCritiqueOutfit: (
    itemIds: string[],
    occasion: OccasionType
  ) => Promise<{
    score: number;
    rationale: string;
    fabricFitNotes: string;
    bodyTailoringNote: string;
    finishingTouch: string;
    modelUsed: string;
  }>;
  onLogWear: (outfitId: string) => Promise<void>;
  onDeleteOutfit: (outfitId: string) => Promise<void>;
}

type StudioSlotKey = 'base' | 'mid' | 'bottoms' | 'outerwear' | 'footwear' | 'accessories';

const SLOTS: Array<{
  key: StudioSlotKey;
  label: string;
  matches: (g: Garment) => boolean;
}> = [
  {
    key: 'base',
    label: 'Base Layer (Shirt / Tee / Polo)',
    matches: (g) => g.category === 'tops' && classifyTopLayerRole(g) === 'base',
  },
  {
    key: 'mid',
    label: 'Mid Layer (Sweater / Cardigan / Knit)',
    matches: (g) => g.category === 'tops' && classifyTopLayerRole(g) === 'mid',
  },
  {
    key: 'bottoms',
    label: 'Bottoms',
    matches: (g) => g.category === 'bottoms',
  },
  {
    key: 'outerwear',
    label: 'Outerwear',
    matches: (g) => g.category === 'outerwear',
  },
  {
    key: 'footwear',
    label: 'Footwear',
    matches: (g) => g.category === 'footwear',
  },
  {
    key: 'accessories',
    label: 'Accessories',
    matches: (g) => g.category === 'accessories',
  },
];

function slotKeyForGarment(g: Garment): StudioSlotKey {
  if (g.category === 'tops') {
    return classifyTopLayerRole(g) === 'mid' ? 'mid' : 'base';
  }
  return g.category;
}

export function StudioView({
  garments,
  vectors,
  profile,
  savedOutfits,
  draftSeed,
  onClearDraftSeed,
  onSaveOutfit,
  onCritiqueOutfit,
  onLogWear,
  onDeleteOutfit,
}: StudioViewProps) {
  const [mode, setMode] = useState<'builder' | 'lookbook'>('builder');
  const [lookbookFilter, setLookbookFilter] = useState<'all' | 'custom' | 'ai'>('all');

  const [selectedBySlot, setSelectedBySlot] = useState<Partial<Record<StudioSlotKey, string>>>({});
  const [title, setTitle] = useState('');
  const [occasion, setOccasion] = useState<OccasionType>('Smart Casual');
  const [season, setSeason] = useState<SeasonTag>('All-Season');
  const [critique, setCritique] = useState<{
    score: number;
    rationale: string;
    fabricFitNotes: string;
    bodyTailoringNote: string;
    finishingTouch: string;
    modelUsed: string;
  } | null>(null);
  const [critiquing, setCritiquing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const garmentMap = useMemo(() => new Map(garments.map((g) => [g.id, g])), [garments]);

  // Pre-fill Studio when user clicks "Customize in Studio" from Combinations (preserves Base + Mid layers!)
  useEffect(() => {
    if (!draftSeed) return;
    const nextSlots: Partial<Record<StudioSlotKey, string>> = {};
    for (const id of draftSeed.itemIds) {
      const g = garmentMap.get(id);
      if (g) {
        const key = slotKeyForGarment(g);
        if (!nextSlots[key]) {
          nextSlots[key] = g.id;
        }
      }
    }
    setSelectedBySlot(nextSlots);
    setTitle(`${draftSeed.title} (Custom)`);
    setOccasion(draftSeed.occasion);
    setSeason(draftSeed.season);
    setCritique(null);
    setMode('builder');
    onClearDraftSeed();
  }, [draftSeed, garmentMap, onClearDraftSeed]);

  const selectedItems = useMemo(() => {
    return SLOTS.map((s) => selectedBySlot[s.key])
      .filter((id): id is string => Boolean(id))
      .map((id) => garmentMap.get(id))
      .filter((g): g is Garment => Boolean(g));
  }, [selectedBySlot, garmentMap]);

  const resolvedVectors = useMemo(() => {
    const map: Record<string, number[]> = {};
    for (const g of garments) {
      map[g.id] =
        Array.isArray(vectors[g.id]) && vectors[g.id].length > 0
          ? vectors[g.id]
          : computeDeterministicVector(g);
    }
    return map;
  }, [garments, vectors]);

  const liveHarmony = useMemo(
    () => evaluateOutfitLocalHarmony(selectedItems, resolvedVectors, profile, { occasion }),
    [selectedItems, resolvedVectors, profile, occasion]
  );

  const toggleSlotItem = (slotKey: StudioSlotKey, garmentId: string) => {
    setCritique(null);
    setError(null);
    setSelectedBySlot((prev) => ({
      ...prev,
      [slotKey]: prev[slotKey] === garmentId ? undefined : garmentId,
    }));
  };

  const handleCritique = async () => {
    if (selectedItems.length < 2) {
      setError('Select at least 2 garments to run an AI critique.');
      return;
    }
    setError(null);
    setCritiquing(true);
    try {
      const res = await onCritiqueOutfit(
        selectedItems.map((i) => i.id),
        occasion
      );
      setCritique(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to critique outfit.');
    } finally {
      setCritiquing(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedItems.length < 2) {
      setError('Select at least 2 garments before saving your custom outfit.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSaveOutfit({
        title: title.trim() || `My ${occasion} Look`,
        source: 'custom',
        score: critique?.score ?? liveHarmony.overallScore,
        vectorHarmonyScore: liveHarmony.vectorScore,
        itemIds: selectedItems.map((i) => i.id),
        occasion,
        season,
        rationale: critique?.rationale ?? liveHarmony.feedback,
        fabricFitNotes: critique?.fabricFitNotes,
        bodyTailoringNote: critique?.bodyTailoringNote,
        finishingTouch: critique?.finishingTouch,
        modelUsed: critique?.modelUsed,
      });
      setTitle('');
      setSelectedBySlot({});
      setCritique(null);
      setMode('lookbook');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save outfit.');
    } finally {
      setSaving(false);
    }
  };

  const filteredLookbook = savedOutfits.filter((o) => {
    if (lookbookFilter === 'all') return true;
    return o.source === lookbookFilter;
  });

  return (
    <div className="space-y-9">
      {/* Header + Segmented Mode Switcher */}
      <section className="flex flex-col md:flex-row md:items-end justify-between gap-6 pt-2">
        <div className="max-w-2xl">
          <h1 className="text-[32px] sm:text-[42px] font-semibold tracking-[-0.03em] leading-[1.08] text-[#1D1D1F]">
            Outfit Studio &amp; Lookbook.
          </h1>
          <p className="mt-2 text-[15px] leading-[1.6] text-[#6E6E73]">
            Build custom outfits, get stylist critique, and manage saved looks.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Studio workspace view"
          className="inline-flex items-center gap-1 p-1 bg-black/[0.05] rounded-xl self-start md:self-auto shrink-0"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'builder'}
            onClick={() => setMode('builder')}
            className={`px-4 py-2 text-[13px] font-medium rounded-lg whitespace-nowrap transition-all ${
              mode === 'builder'
                ? 'bg-white text-[#1D1D1F] shadow-xs'
                : 'text-[#6E6E73] hover:text-[#1D1D1F]'
            }`}
          >
            Create Custom Outfit
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'lookbook'}
            onClick={() => setMode('lookbook')}
            className={`px-4 py-2 text-[13px] font-medium rounded-lg whitespace-nowrap transition-all ${
              mode === 'lookbook'
                ? 'bg-white text-[#1D1D1F] shadow-xs'
                : 'text-[#6E6E73] hover:text-[#1D1D1F]'
            }`}
          >
            Saved Lookbook
            <span className="ml-1.5 text-[11px] text-[#86868B] tabular-nums">
              {savedOutfits.length}
            </span>
          </button>
        </div>
      </section>

      {mode === 'builder' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left: Category Slot Pickers */}
          <div className="lg:col-span-7 space-y-7">
            {SLOTS.map((slot) => {
              const itemsInSlot = garments.filter((g) => slot.matches(g));
              const selectedId = selectedBySlot[slot.key];
              return (
                <section key={slot.key} className="space-y-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className="text-[16px] font-semibold text-[#1D1D1F]">
                      {slot.label}
                    </h2>
                    <span className="text-[12px] text-[#6E6E73] tabular-nums shrink-0">
                      {itemsInSlot.length}
                    </span>
                  </div>

                  {itemsInSlot.length === 0 ? (
                    <p className="text-[13px] text-[#86868B] py-4 border-y border-black/[0.06]">
                      No {slot.label.toLowerCase()} pieces in your wardrobe yet.
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5">
                      {itemsInSlot.map((g) => {
                        const isPicked = selectedId === g.id;
                        return (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() => toggleSlotItem(slot.key, g.id)}
                            aria-pressed={isPicked}
                            className={`text-left rounded-2xl overflow-hidden bg-white transition-all ${
                              isPicked
                                ? 'ring-2 ring-[#0071E3] shadow-sm'
                                : 'border border-black/[0.07] hover:border-black/[0.18]'
                            }`}
                          >
                            <div className="relative aspect-[4/4] bg-[#F2F2F4]">
                              <SmartImage
                                src={g.imageUrl}
                                alt={g.name}
                                swatchHex={g.colorHex}
                              />
                              {isPicked && (
                                <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-[#0071E3] text-white flex items-center justify-center">
                                  <Check className="w-3.5 h-3.5" />
                                </span>
                              )}
                            </div>
                            <div className="p-3">
                              <p className="text-[13px] font-medium text-[#1D1D1F] truncate">
                                {g.name}
                              </p>
                              <p className="mt-0.5 text-[11px] text-[#6E6E73] truncate">
                                {g.primaryColor} · {g.fit}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </div>

          {/* Right: Live Assembled Lookboard & Save Form */}
          <aside className="lg:col-span-5 lg:sticky lg:top-24 surface-card rounded-[26px] p-6 sm:p-7 space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-[#1D1D1F]">
                  Live Lookboard
                </h2>
                <p className="text-[13px] text-[#6E6E73] tabular-nums">
                  {selectedItems.length} pieces selected
                </p>
              </div>

              {selectedItems.length >= 2 && (
                <div className="text-right">
                  <p className="font-mono text-[26px] font-semibold leading-none text-[#1D1D1F] tabular-nums">
                    {critique ? critique.score : liveHarmony.overallScore}
                  </p>
                  <p className="mt-1 text-[11px] text-[#6E6E73] tabular-nums">
                    {critique ? 'AI Score' : 'Style Score'}
                  </p>
                </div>
              )}
            </div>

            {selectedItems.length === 0 ? (
              <div className="rounded-2xl bg-[#F5F5F7] py-12 px-6 text-center">
                <Plus className="w-5 h-5 text-[#86868B] mx-auto mb-2" aria-hidden="true" />
                <p className="text-[14px] font-medium text-[#1D1D1F]">
                  Select garments to build a look
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {selectedItems.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl overflow-hidden bg-[#F5F5F7] border border-black/[0.05]"
                  >
                    <div className="aspect-[4/4]">
                      <SmartImage
                        src={item.imageUrl}
                        alt={item.name}
                        swatchHex={item.colorHex}
                      />
                    </div>
                    <p className="px-2.5 py-2 text-[12px] font-medium text-[#1D1D1F] truncate bg-white">
                      {item.name}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Instant Multi-Objective OKLCH, Proportion & Personal Fit Breakdown */}
            {selectedItems.length >= 2 && (
              <div className="space-y-3 border-y border-black/[0.06] py-4 text-[13px]">
                <div className="grid grid-cols-4 gap-2 py-2 px-2.5 rounded-xl bg-[#F5F5F7] text-center">
                  <div>
                    <p className="font-mono text-[13px] font-semibold text-[#1D1D1F] tabular-nums">
                      {liveHarmony.personalScore}%
                    </p>
                    <p className="text-[10px] text-[#6E6E73]">Personal</p>
                  </div>
                  <div>
                    <p className="font-mono text-[13px] font-semibold text-[#1D1D1F] tabular-nums">
                      {liveHarmony.colorScore}%
                    </p>
                    <p className="text-[10px] text-[#6E6E73]">Color</p>
                  </div>
                  <div>
                    <p className="font-mono text-[13px] font-semibold text-[#1D1D1F] tabular-nums">
                      {liveHarmony.proportionScore}%
                    </p>
                    <p className="text-[10px] text-[#6E6E73]">Proportion</p>
                  </div>
                  <div>
                    <p className="font-mono text-[13px] font-semibold text-[#1D1D1F] tabular-nums">
                      {liveHarmony.vectorScore}%
                    </p>
                    <p className="text-[10px] text-[#6E6E73]">Cohesion</p>
                  </div>
                </div>
                <p className="text-[#1D1D1F] leading-[1.55]">
                  {critique ? critique.rationale : liveHarmony.feedback}
                </p>
                {critique && (
                  <div className="pt-2 space-y-1.5 text-[13px] text-[#48484A]">
                    <p>
                      <span className="font-medium text-[#1D1D1F]">Fabric & Fit: </span>
                      {critique.fabricFitNotes}
                    </p>
                    <p>
                      <span className="font-medium text-[#1D1D1F]">Finishing Tip: </span>
                      {critique.finishingTouch}
                    </p>
                  </div>
                )}
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="px-3.5 py-2.5 rounded-xl bg-[#FFF2F2] border border-[#D70015]/20 text-[13px] text-[#B00012]"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label htmlFor="studio-title" className="block text-[12px] font-medium text-[#6E6E73] mb-1">
                  Outfit Name
                </label>
                <input
                  id="studio-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Friday Gallery Dinner"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5F5F7] border border-black/[0.06] text-[14px] text-[#1D1D1F]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="studio-occasion" className="block text-[12px] font-medium text-[#6E6E73] mb-1">
                    Occasion
                  </label>
                  <select
                    id="studio-occasion"
                    value={occasion}
                    onChange={(e) => setOccasion(e.target.value as OccasionType)}
                    className="w-full px-3 py-2.5 rounded-xl bg-[#F5F5F7] border border-black/[0.06] text-[13px] text-[#1D1D1F]"
                  >
                    <option value="Smart Casual">Smart Casual</option>
                    <option value="Everyday">Everyday</option>
                    <option value="Formal">Formal</option>
                    <option value="Evening">Evening</option>
                    <option value="Travel">Travel</option>
                    <option value="Streetwear">Streetwear</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="studio-season" className="block text-[12px] font-medium text-[#6E6E73] mb-1">
                    Season
                  </label>
                  <select
                    id="studio-season"
                    value={season}
                    onChange={(e) => setSeason(e.target.value as SeasonTag)}
                    className="w-full px-3 py-2.5 rounded-xl bg-[#F5F5F7] border border-black/[0.06] text-[13px] text-[#1D1D1F]"
                  >
                    <option value="All-Season">All-Season</option>
                    <option value="Spring">Spring</option>
                    <option value="Summer">Summer</option>
                    <option value="Autumn">Autumn</option>
                    <option value="Winter">Winter</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={selectedItems.length < 2 || critiquing}
                  onClick={handleCritique}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full border border-black/[0.12] text-[13px] font-medium text-[#1D1D1F] hover:bg-black/[0.03] disabled:opacity-40"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${critiquing ? 'animate-spin' : ''}`} />
                  {critiquing ? 'Reviewing...' : 'AI Critique'}
                </button>

                <button
                  type="submit"
                  disabled={selectedItems.length < 2 || saving}
                  className="flex-1 px-5 py-2.5 rounded-full bg-[#1D1D1F] text-white text-[13px] font-medium hover:bg-[#3A3A3C] disabled:opacity-40 transition-colors"
                >
                  {saving ? 'Saving...' : 'Save Outfit'}
                </button>
              </div>
            </form>
          </aside>
        </div>
      ) : (
        /* Saved Lookbook View */
        <div className="space-y-6">
          <div className="inline-flex items-center gap-1 p-1 bg-black/[0.04] rounded-xl">
            {(
              [
                { id: 'all', label: 'All Saved' },
                { id: 'custom', label: 'My Creations' },
                { id: 'ai', label: 'AI Suggested' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setLookbookFilter(tab.id)}
                className={`px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-all ${
                  lookbookFilter === tab.id
                    ? 'bg-white text-[#1D1D1F] shadow-xs'
                    : 'text-[#6E6E73] hover:text-[#1D1D1F]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {filteredLookbook.length === 0 ? (
            <section className="surface-card rounded-3xl p-12 text-center max-w-xl mx-auto">
              <h2 className="text-[20px] font-semibold text-[#1D1D1F]">
                No saved looks in this view yet
              </h2>
              <p className="mt-2 text-[14px] text-[#6E6E73]">
                Create a custom combination in the builder or save any AI-ranked suggestion.
              </p>
              <button
                type="button"
                onClick={() => setMode('builder')}
                className="mt-5 px-5 py-2.5 rounded-full bg-[#1D1D1F] text-white text-[13px] font-medium hover:bg-[#3A3A3C]"
              >
                Open Outfit Builder
              </button>
            </section>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6" data-testid="saved-lookbook-grid">
              {filteredLookbook.map((outfit) => {
                const pieces = outfit.itemIds
                  .map((id) => garmentMap.get(id))
                  .filter((g): g is Garment => Boolean(g));
                return (
                  <article
                    key={outfit.id}
                    className="surface-card rounded-[24px] overflow-hidden flex flex-col justify-between"
                  >
                    <div>
                      <div className="bg-[#EFEFF2] p-4 grid grid-cols-3 gap-2.5">
                        {pieces.slice(0, 3).map((piece) => (
                          <div
                            key={piece.id}
                            className="aspect-[3/4] rounded-xl overflow-hidden bg-white"
                          >
                            <SmartImage
                              src={piece.imageUrl}
                              alt={piece.name}
                              swatchHex={piece.colorHex}
                            />
                          </div>
                        ))}
                      </div>

                      <div className="p-6 space-y-3">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-[12px] text-[#6E6E73]">
                              {outfit.source === 'custom' ? 'My Creation' : 'AI Suggested'} ·{' '}
                              {outfit.occasion} · {outfit.season}
                            </p>
                            <h3 className="mt-1 text-[20px] font-semibold text-[#1D1D1F]">
                              {outfit.title}
                            </h3>
                          </div>
                          <span className="font-mono text-[20px] font-semibold text-[#1D1D1F] tabular-nums shrink-0">
                            {outfit.score}
                          </span>
                        </div>

                        <p className="text-[14px] leading-[1.6] text-[#48484A]">
                          {outfit.rationale}
                        </p>
                      </div>
                    </div>

                    <div className="px-6 py-4 border-t border-black/[0.06] flex items-center justify-between gap-3 text-[13px]">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => onLogWear(outfit.id)}
                          className="px-3.5 py-1.5 rounded-full bg-[#F5F5F7] hover:bg-black/[0.08] font-medium text-[#1D1D1F] transition-colors"
                        >
                          Wear Today
                        </button>
                        <span className="text-[12px] text-[#6E6E73] tabular-nums">
                          Worn {outfit.wearCount}×
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => onDeleteOutfit(outfit.id)}
                        aria-label={`Delete outfit ${outfit.title}`}
                        className="p-2 rounded-full text-[#86868B] hover:text-[#D70015] hover:bg-black/[0.04] transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
