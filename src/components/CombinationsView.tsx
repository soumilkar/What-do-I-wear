import { useState } from 'react';
import { Bookmark, Check, MessageSquare, SlidersHorizontal, Sparkles } from 'lucide-react';
import type {
  Garment,
  OccasionType,
  OutfitCombination,
  SeasonTag,
} from '../types/styling';
import { SmartImage } from './SmartImage';

interface CombinationsViewProps {
  garments: Garment[];
  combinations: OutfitCombination[];
  initialAnchorId?: string;
  onGenerateRankings: (opts: {
    occasion: OccasionType;
    season: SeasonTag;
    anchorItemId?: string;
  }) => Promise<void>;
  onSaveCombination: (combo: OutfitCombination) => Promise<void>;
  onCustomizeInStudio: (combo: OutfitCombination) => void;
  onDiscussWithAdvisor: (prompt: string) => void;
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

export function CombinationsView({
  garments,
  combinations,
  initialAnchorId = '',
  onGenerateRankings,
  onSaveCombination,
  onCustomizeInStudio,
  onDiscussWithAdvisor,
}: CombinationsViewProps) {
  const [occasion, setOccasion] = useState<OccasionType>('Smart Casual');
  const [season, setSeason] = useState<SeasonTag>('Autumn');
  const [anchorItemId, setAnchorItemId] = useState<string>(initialAnchorId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const handleRank = async () => {
    setError(null);
    setLoading(true);
    try {
      await onGenerateRankings({
        occasion,
        season,
        anchorItemId: anchorItemId || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to rank combinations.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (combo: OutfitCombination) => {
    setSavingId(combo.id);
    try {
      await onSaveCombination(combo);
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
            Ranked styling combinations.
          </h1>
          <p className="mt-3 text-[16px] leading-[1.6] text-[#6E6E73]">
            Vector compatibility pre-screens your entire wardrobe locally, then our hierarchical AI ranks the top pairings specifically for your proportions, undertone, and occasion.
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

      {/* Compact Control Strip */}
      <section className="surface-card rounded-2xl p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
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
            Weather & Season
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
            Select an occasion and season above, then run the stylist ranking engine across your uploaded pieces.
          </p>
        </section>
      ) : (
        <section aria-label="Ranked outfit list" className="space-y-8">
          {combinations.map((combo, idx) => {
            const rankNum = combo.rank ?? idx + 1;
            const pieces = combo.itemIds
              .map((id) => garmentMap.get(id))
              .filter((g): g is Garment => Boolean(g));

            return (
              <article
                key={combo.id}
                className="surface-card rounded-[26px] overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-stretch"
              >
                {/* Left Visual Collage of Wardrobe Pieces */}
                <div className="lg:col-span-6 bg-[#EFEFF2] p-5 grid grid-cols-2 gap-3.5 content-center">
                  {pieces.slice(0, 4).map((piece) => (
                    <div
                      key={piece.id}
                      className="rounded-2xl overflow-hidden bg-white border border-black/[0.05] flex flex-col"
                    >
                      <div className="aspect-[4/4] w-full bg-[#F5F5F7] overflow-hidden">
                        <SmartImage
                          src={piece.imageUrl}
                          alt={piece.name}
                          swatchHex={piece.colorHex}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="px-3 py-2 flex items-center justify-between gap-2">
                        <span className="text-[12px] font-medium text-[#1D1D1F] truncate">
                          {piece.name}
                        </span>
                        <span
                          className="w-2.5 h-2.5 rounded-full border border-black/15 shrink-0"
                          style={{ backgroundColor: piece.colorHex }}
                          aria-hidden="true"
                        />
                      </div>
                    </div>
                  ))}
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
                          Vector {combo.vectorHarmonyScore}%
                        </p>
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
