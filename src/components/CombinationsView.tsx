import { useEffect, useState } from 'react';
import { Bookmark, Check, MessageSquare, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import type {
  Garment,
  OccasionType,
  OutfitCombination,
  SeasonTag,
  UserProfile,
} from '../types/styling';
import {
  classifyTopLayerRole,
  evaluateOutfitLocalHarmony,
} from '../utils/styleEngine';
import { SmartImage } from './SmartImage';

function formatLayerRoleLabel(garment: Garment): string {
  if (garment.category === 'tops') {
    return classifyTopLayerRole(garment) === 'mid' ? 'Mid Layer' : 'Base Layer';
  }
  switch (garment.category) {
    case 'outerwear':
      return 'Outerwear';
    case 'bottoms':
      return 'Bottom';
    case 'footwear':
      return 'Footwear';
    default:
      return 'Accent';
  }
}

interface CombinationsViewProps {
  garments: Garment[];
  vectors: Record<string, number[]>;
  profile: UserProfile;
  combinations: OutfitCombination[];
  initialAnchorId?: string;
  onGenerateRankings: (opts: {
    occasion: OccasionType;
    season: SeasonTag;
    anchorItemId?: string;
    customPrompt?: string;
    explorationMode?: 'best' | 'fresh';
  }) => Promise<void>;
  onSaveCombination: (combo: OutfitCombination) => Promise<void>;
  onCustomizeInStudio: (combo: OutfitCombination) => void;
  onDiscussWithAdvisor: (prompt: string) => void;
  onInspectGarment: (garment: Garment) => void;
}

const OCCASIONS: OccasionType[] = [
  'Smart Casual',
  'Everyday',
  'Formal',
  'Evening',
  'Travel',
  'Streetwear',
];

const SEASONS: SeasonTag[] = ['All-Season', 'Spring', 'Summer', 'Autumn', 'Winter'];

const QUICK_VIBE_PROMPTS = [
  'Breathable summer outfit',
  'Layered shirt + sweater',
  'Clean monochrome look',
  'Sharp dinner date',
  'Relaxed weekend, no jacket',
];

export function CombinationsView({
  garments,
  vectors,
  profile,
  combinations,
  initialAnchorId = '',
  onGenerateRankings,
  onSaveCombination,
  onCustomizeInStudio,
  onDiscussWithAdvisor,
  onInspectGarment,
}: CombinationsViewProps) {
  const [occasion, setOccasion] = useState<OccasionType>('Smart Casual');
  const [season, setSeason] = useState<SeasonTag>('All-Season');
  const [anchorItemId, setAnchorItemId] = useState<string>(initialAnchorId);
  const [explorationMode, setExplorationMode] = useState<'best' | 'fresh'>('best');
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (initialAnchorId && garments.some((g) => g.id === initialAnchorId)) {
      setAnchorItemId(initialAnchorId);
    }
  }, [initialAnchorId, garments]);

  useEffect(() => {
    if (anchorItemId && !garments.some((g) => g.id === anchorItemId)) {
      setAnchorItemId('');
    }
  }, [anchorItemId, garments]);

  const handleRank = async () => {
    setError(null);
    setLoading(true);
    try {
      await onGenerateRankings({
        occasion,
        season,
        anchorItemId: anchorItemId || undefined,
        customPrompt: customPrompt.trim() || undefined,
        explorationMode,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to rank combinations.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (combo: OutfitCombination) => {
    setError(null);
    setSavingId(combo.id);
    try {
      await onSaveCombination(combo);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save outfit to your lookbook.');
    } finally {
      setSavingId(null);
    }
  };

  const garmentMap = new Map(garments.map((g) => [g.id, g]));

  return (
    <div className="space-y-10">
      {/* Header */}
      <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pt-2">
        <div className="max-w-2xl">
          <h1 className="text-[32px] sm:text-[42px] font-semibold tracking-[-0.03em] leading-[1.08] text-[#1D1D1F]">
            Ranked combinations.
          </h1>
          <p className="mt-2 text-[15px] leading-[1.6] text-[#6E6E73]">
            Layered outfits tailored to your coloring, season, and occasion.
          </p>
        </div>

        <button
          type="button"
          onClick={handleRank}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-[#1D1D1F] text-white text-[14px] font-medium whitespace-nowrap hover:bg-[#3A3A3C] active:scale-[0.98] disabled:opacity-50 transition-all shrink-0"
        >
          <Sparkles className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          {loading ? 'Ranking Combinations...' : 'Generate Ranked Combinations'}
        </button>
      </section>

      {/* Compact Control Strip + Optional Outfit Prompt */}
      <section className="surface-card rounded-2xl p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label
              htmlFor="combo-occasion"
              className="block text-[12px] font-medium text-[#6E6E73] mb-1.5"
            >
              Occasion
            </label>
            <select
              id="combo-occasion"
              value={occasion}
              onChange={(e) => setOccasion(e.target.value as OccasionType)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5F5F7] border border-black/[0.06] text-[14px] font-medium text-[#1D1D1F]"
            >
              {OCCASIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="combo-season"
              className="block text-[12px] font-medium text-[#6E6E73] mb-1.5"
            >
              Weather &amp; Season
            </label>
            <select
              id="combo-season"
              value={season}
              onChange={(e) => setSeason(e.target.value as SeasonTag)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5F5F7] border border-black/[0.06] text-[14px] font-medium text-[#1D1D1F]"
            >
              {SEASONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="combo-anchor"
              className="block text-[12px] font-medium text-[#6E6E73] mb-1.5"
            >
              Anchor Piece (Optional)
            </label>
            <select
              id="combo-anchor"
              value={anchorItemId}
              onChange={(e) => setAnchorItemId(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5F5F7] border border-black/[0.06] text-[14px] font-medium text-[#1D1D1F]"
            >
              <option value="">Any piece in wardrobe</option>
              {garments.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.primaryColor})
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="block text-[12px] font-medium text-[#6E6E73] mb-1.5">
              Discovery Mode
            </span>
            <div className="grid grid-cols-2 p-1 rounded-xl bg-[#F5F5F7] border border-black/[0.06]">
              <button
                type="button"
                onClick={() => setExplorationMode('best')}
                className={`py-1.5 rounded-lg text-[13px] font-medium transition-all ${
                  explorationMode === 'best'
                    ? 'bg-white text-[#1D1D1F] shadow-xs'
                    : 'text-[#6E6E73] hover:text-[#1D1D1F]'
                }`}
              >
                Best Match
              </button>
              <button
                type="button"
                onClick={() => setExplorationMode('fresh')}
                className={`py-1.5 rounded-lg text-[13px] font-medium transition-all ${
                  explorationMode === 'fresh'
                    ? 'bg-white text-[#1D1D1F] shadow-xs'
                    : 'text-[#6E6E73] hover:text-[#1D1D1F]'
                }`}
              >
                Fresh Rotation
              </button>
            </div>
          </div>
        </div>

        {/* Optional Custom Style Request */}
        <div className="pt-4 border-t border-black/[0.06] space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
            <label
              htmlFor="combo-custom-prompt"
              className="text-[12px] font-medium text-[#6E6E73]"
            >
              Describe the vibe or outfit you want (Optional)
            </label>
            {profile.blueprint ? (
              <span className="text-[12px] text-[#0071E3]">
                {profile.blueprint.photoAnalyzed ? 'Portrait + ' : ''}
                {profile.blueprint.colorSeason} palette &amp; {profile.bodyType || 'personal'} proportions active
              </span>
            ) : (
              <span className="text-[12px] text-[#86868B]">
                Scored for your {profile.skinUndertone} undertone &amp; {profile.styleAesthetics[0] || 'preferred'} style
              </span>
            )}
          </div>

          <div className="relative flex items-center">
            <input
              id="combo-custom-prompt"
              type="text"
              maxLength={280}
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !loading) {
                  e.preventDefault();
                  void handleRank();
                }
              }}
              placeholder="e.g. Sharp dinner date look, monochrome coffee run, or relaxed office without a jacket..."
              className="w-full pl-3.5 pr-9 py-2.5 rounded-xl bg-[#F5F5F7] border border-black/[0.06] text-[14px] text-[#1D1D1F] placeholder:text-[#86868B] focus:outline-none focus:ring-2 focus:ring-[#0071E3]"
            />
            {customPrompt && (
              <button
                type="button"
                onClick={() => setCustomPrompt('')}
                aria-label="Clear outfit description"
                className="absolute right-2.5 p-1 rounded-full text-[#86868B] hover:text-[#1D1D1F] hover:bg-black/[0.05]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-[#86868B]">Quick ideas:</span>
            {QUICK_VIBE_PROMPTS.map((idea) => (
              <button
                key={idea}
                type="button"
                onClick={() => setCustomPrompt(idea)}
                className={`px-2.5 py-1 rounded-lg text-[12px] transition-colors ${
                  customPrompt === idea
                    ? 'bg-[#1D1D1F] text-white'
                    : 'bg-[#F5F5F7] text-[#48484A] hover:bg-black/[0.08]'
                }`}
              >
                {idea}
              </button>
            ))}
          </div>
        </div>
      </section>

      {error && (
        <div
          role="alert"
          className="px-5 py-3.5 rounded-2xl bg-[#FFF2F2] border border-[#D70015]/20 text-[14px] text-[#B00012]"
        >
          {error}
        </div>
      )}

      {/* Ranked Lookbook Editorial Feed */}
      {combinations.length === 0 ? (
        <section className="surface-card rounded-3xl p-12 text-center max-w-xl mx-auto">
          <h2 className="text-[20px] font-semibold text-[#1D1D1F]">
            No ranked combinations yet
          </h2>
          <p className="mt-2 text-[14px] text-[#6E6E73]">
            Pick an occasion and season above to generate outfits.
          </p>
        </section>
      ) : (
        <section aria-label="Ranked outfit list" className="space-y-8">
          {combinations.map((combo, idx) => {
            const rankNum = combo.rank ?? idx + 1;
            const pieces = combo.itemIds
              .map((id) => garmentMap.get(id))
              .filter((g): g is Garment => Boolean(g));
            const metrics = evaluateOutfitLocalHarmony(pieces, vectors, profile, {
              occasion: combo.occasion,
            });

            return (
              <article
                key={combo.id}
                className="surface-card rounded-[26px] overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-stretch"
              >
                {/* Left Visual Collage of Wardrobe Pieces (supports multi-layer Base + Mid + Outer stacks) */}
                <div className="lg:col-span-6 bg-[#EFEFF2] p-5 flex flex-col justify-center gap-3.5">
                  <div
                    className={`grid gap-3 ${
                      pieces.length >= 5 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2'
                    }`}
                  >
                    {pieces.slice(0, 6).map((piece) => (
                      <button
                        key={piece.id}
                        type="button"
                        onClick={() => onInspectGarment(piece)}
                        title={`Inspect ${piece.name}`}
                        className="group text-left rounded-2xl overflow-hidden bg-white border border-black/[0.05] hover:border-black/[0.2] transition-colors flex flex-col cursor-pointer"
                      >
                        <div className="relative aspect-[4/4] w-full bg-[#F5F5F7] overflow-hidden">
                          <SmartImage
                            src={piece.imageUrl}
                            alt={piece.name}
                            swatchHex={piece.colorHex}
                            className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                          />
                          <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-white/90 backdrop-blur-xs text-[10px] font-semibold text-[#1D1D1F] border border-black/[0.06]">
                            {formatLayerRoleLabel(piece)}
                          </span>
                        </div>
                        <div className="px-3 py-2 flex items-center justify-between gap-2 w-full">
                          <span className="text-[12px] font-medium text-[#1D1D1F] group-hover:text-[#0071E3] truncate transition-colors">
                            {piece.name}
                          </span>
                          <span
                            className="w-2.5 h-2.5 rounded-full border border-black/15 shrink-0"
                            style={{ backgroundColor: piece.colorHex }}
                            aria-hidden="true"
                          />
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Perceptual OKLCH Palette Ribbon */}
                  <div className="px-3.5 py-2 rounded-xl bg-white/80 border border-black/[0.05] flex items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5 shrink-0">
                      {pieces.map((p) => (
                        <span
                          key={`${combo.id}_sw_${p.id}`}
                          className="w-4 h-4 rounded-full border border-black/15"
                          style={{ backgroundColor: p.colorHex }}
                          title={`${p.primaryColor} (${p.undertone})`}
                        />
                      ))}
                    </div>
                    <span className="text-[11.5px] text-[#6E6E73] truncate">
                      {metrics.paletteSummary}
                    </span>
                  </div>
                </div>

                {/* Right Editorial Stylist Breakdown */}
                <div className="lg:col-span-6 p-7 sm:p-8 flex flex-col justify-between gap-6">
                  <div className="space-y-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[12px] font-medium text-[#6E6E73]">
                          Rank #{rankNum} · {combo.occasion} · {combo.season}
                        </p>
                        <h2 className="mt-1.5 text-[24px] font-semibold tracking-[-0.02em] text-[#1D1D1F]">
                          {combo.title}
                        </h2>
                      </div>

                      <div className="text-right shrink-0">
                        <p className="font-mono text-[28px] font-semibold leading-none text-[#1D1D1F] tabular-nums">
                          {combo.score}
                        </p>
                        <p className="mt-1 text-[11px] text-[#6E6E73] tabular-nums">
                          Match Score
                        </p>
                      </div>
                    </div>

                    {/* Multi-Objective 4-Factor Telemetry Strip */}
                    <div className="grid grid-cols-4 gap-2 py-2.5 px-3 rounded-xl bg-[#F5F5F7] text-center">
                      <div>
                        <p className="font-mono text-[14px] font-semibold text-[#1D1D1F] tabular-nums">
                          {metrics.personalScore}%
                        </p>
                        <p className="text-[10.5px] text-[#6E6E73]">Personal</p>
                      </div>
                      <div>
                        <p className="font-mono text-[14px] font-semibold text-[#1D1D1F] tabular-nums">
                          {metrics.colorScore}%
                        </p>
                        <p className="text-[10.5px] text-[#6E6E73]">Color</p>
                      </div>
                      <div>
                        <p className="font-mono text-[14px] font-semibold text-[#1D1D1F] tabular-nums">
                          {metrics.proportionScore}%
                        </p>
                        <p className="text-[10.5px] text-[#6E6E73]">Proportion</p>
                      </div>
                      <div>
                        <p className="font-mono text-[14px] font-semibold text-[#1D1D1F] tabular-nums">
                          {combo.vectorHarmonyScore}%
                        </p>
                        <p className="text-[10.5px] text-[#6E6E73]">Cohesion</p>
                      </div>
                    </div>

                    <p className="text-[15px] leading-[1.65] text-[#1D1D1F]">
                      {combo.rationale}
                    </p>

                    <dl className="space-y-3.5 pt-4 border-t border-black/[0.06] text-[14px]">
                      <div>
                        <dt className="text-[12px] font-medium text-[#6E6E73]">
                          Fabric & Fit Harmony
                        </dt>
                        <dd className="mt-0.5 text-[#1D1D1F]">{combo.fabricFitNotes}</dd>
                      </div>
                      <div>
                        <dt className="text-[12px] font-medium text-[#6E6E73]">
                          Tailored to Your Proportions
                        </dt>
                        <dd className="mt-0.5 text-[#1D1D1F]">{combo.bodyTailoringNote}</dd>
                      </div>
                      <div>
                        <dt className="text-[12px] font-medium text-[#6E6E73]">
                          Finishing Note
                        </dt>
                        <dd className="mt-0.5 text-[#1D1D1F]">{combo.finishingTouch}</dd>
                      </div>
                    </dl>
                  </div>

                  {/* Clean Action Footer */}
                  <div className="pt-5 border-t border-black/[0.06] flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      disabled={combo.saved || savingId === combo.id}
                      onClick={() => handleSave(combo)}
                      className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-medium transition-colors ${
                        combo.saved
                          ? 'bg-[#E8F4FD] text-[#0071E3]'
                          : 'bg-[#1D1D1F] text-white hover:bg-[#3A3A3C]'
                      }`}
                    >
                      {combo.saved ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          Saved to Lookbook
                        </>
                      ) : (
                        <>
                          <Bookmark className="w-3.5 h-3.5" />
                          {savingId === combo.id ? 'Saving...' : 'Save Look'}
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => onCustomizeInStudio(combo)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-black/[0.12] text-[13px] font-medium text-[#1D1D1F] hover:bg-black/[0.03] transition-colors"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      Customize in Studio
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        onDiscussWithAdvisor(
                          `How could I elevate "${combo.title}" (${pieces
                            .map((p) => p.name)
                            .join(', ')}) with one new trending piece or accessory?`
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-black/[0.12] text-[13px] font-medium text-[#1D1D1F] hover:bg-black/[0.03] transition-colors"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      Ask Advisor
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
