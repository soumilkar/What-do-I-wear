import { useMemo, useState } from 'react';
import { ArrowUpRight, MessageSquare, Search, Upload } from 'lucide-react';
import type {
  CompanionMatch,
  Garment,
  GarmentCategory,
  SeasonTag,
  UserProfile,
} from '../types/styling';
import {
  computeWardrobeIntelligenceSummary,
  scoreGarmentForPerson,
} from '../utils/styleEngine';
import { SmartImage } from './SmartImage';

interface WardrobeViewProps {
  garments: Garment[];
  profile: UserProfile;
  savedOutfitCount: number;
  rankedCount: number;
  companionsByGarment: Record<string, CompanionMatch[]>;
  onSelectGarment: (garment: Garment) => void;
  onOpenUpload: () => void;
  onGoToCombinations: () => void;
  onAskAdvisor: (prompt?: string) => void;
}

const CATEGORY_TABS: Array<{ id: 'all' | GarmentCategory; label: string }> = [
  { id: 'all', label: 'All Pieces' },
  { id: 'tops', label: 'Tops' },
  { id: 'bottoms', label: 'Bottoms' },
  { id: 'outerwear', label: 'Outerwear' },
  { id: 'footwear', label: 'Footwear' },
  { id: 'accessories', label: 'Accessories' },
];

export function WardrobeView({
  garments,
  profile,
  savedOutfitCount,
  rankedCount,
  companionsByGarment,
  onSelectGarment,
  onOpenUpload,
  onGoToCombinations,
  onAskAdvisor,
}: WardrobeViewProps) {
  const [category, setCategory] = useState<'all' | GarmentCategory>('all');
  const [seasonFilter, setSeasonFilter] = useState<'all' | 'unworn' | SeasonTag>('all');
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'flattery' | 'formality' | 'worn'>('newest');

  const personalScores = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of garments) {
      map.set(g.id, scoreGarmentForPerson(g, profile));
    }
    return map;
  }, [garments, profile]);

  const wardrobeDna = useMemo(
    () => computeWardrobeIntelligenceSummary(garments, [], profile),
    [garments, profile]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = garments.filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (seasonFilter === 'unworn' && item.wearCount > 0) return false;
      if (
        seasonFilter !== 'all' &&
        seasonFilter !== 'unworn' &&
        !item.seasons.includes(seasonFilter) &&
        !item.seasons.includes('All-Season')
      ) {
        return false;
      }
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.fabric.toLowerCase().includes(q) ||
        item.primaryColor.toLowerCase().includes(q) ||
        item.fit.toLowerCase().includes(q) ||
        item.subCategory.toLowerCase().includes(q)
      );
    });

    if (sortBy === 'flattery') {
      return [...list].sort(
        (a, b) => (personalScores.get(b.id) ?? 75) - (personalScores.get(a.id) ?? 75)
      );
    }
    if (sortBy === 'formality') {
      return [...list].sort((a, b) => b.formality - a.formality);
    }
    if (sortBy === 'worn') {
      return [...list].sort((a, b) => b.wearCount - a.wearCount);
    }
    return list;
  }, [garments, category, seasonFilter, query, sortBy, personalScores]);

  const unwornCount = garments.filter((g) => g.wearCount === 0).length;

  return (
    <div className="space-y-10">
      {/* Editorial Hero Header & Quantitative Wardrobe Summary */}
      <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pt-2">
        <div className="max-w-2xl">
          <h1 className="text-[32px] sm:text-[42px] font-semibold tracking-[-0.03em] leading-[1.08] text-[#1D1D1F]">
            Wardrobe.
          </h1>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onGoToCombinations}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#0071E3] text-white text-[14px] font-medium whitespace-nowrap hover:bg-[#0077ED] active:scale-[0.98] transition-all"
          >
            Rank Today&apos;s Outfits
            <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </section>

      {/* Clean Unboxed KPI Strip with Hairline Dividers */}
      <section
        aria-label="Wardrobe metrics"
        className="grid grid-cols-2 sm:grid-cols-4 gap-y-4 border-y border-black/[0.08] py-5"
      >
        <div className="sm:pr-6 sm:border-r sm:border-black/[0.08]">
          <p className="text-[12px] font-medium text-[#6E6E73]">Pieces</p>
          <p className="mt-1 font-display text-[28px] font-semibold tracking-[-0.02em] text-[#1D1D1F] tabular-nums">
            {garments.length}
          </p>
        </div>
        <div className="sm:px-6 sm:border-r sm:border-black/[0.08]">
          <p className="text-[12px] font-medium text-[#6E6E73]">Unworn</p>
          <p className="mt-1 font-display text-[28px] font-semibold tracking-[-0.02em] text-[#1D1D1F] tabular-nums">
            {unwornCount}
          </p>
        </div>
        <div className="sm:px-6 sm:border-r sm:border-black/[0.08]">
          <p className="text-[12px] font-medium text-[#6E6E73]">Ranked Combinations</p>
          <p className="mt-1 font-display text-[28px] font-semibold tracking-[-0.02em] text-[#1D1D1F] tabular-nums">
            {rankedCount}
          </p>
        </div>
        <div className="sm:pl-6">
          <p className="text-[12px] font-medium text-[#6E6E73]">Saved Lookbook</p>
          <p className="mt-1 font-display text-[28px] font-semibold tracking-[-0.02em] text-[#1D1D1F] tabular-nums">
            {savedOutfitCount}
          </p>
        </div>
      </section>

      {/* Clean Unboxed Palette & Advisor Intelligence Strip */}
      {garments.length > 0 && wardrobeDna.dominantSwatches.length > 0 && (
        <section
          aria-label="Closet color palette summary"
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 -mt-4 pb-2 border-b border-black/[0.06]"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-[#6E6E73]">
            <span className="font-medium text-[#1D1D1F]">Closet Palette</span>
            <div className="flex items-center gap-1.5">
              {wardrobeDna.dominantSwatches.map((sw) => (
                <span
                  key={sw.color}
                  className="w-4 h-4 rounded-full border border-black/15"
                  style={{ backgroundColor: sw.hex }}
                  title={`${sw.color} (${sw.count})`}
                />
              ))}
            </div>
            <span className="tabular-nums">
              {wardrobeDna.blueprintAlignmentAvg}% palette match
              {profile.blueprint?.colorSeason ? ` · ${profile.blueprint.colorSeason}` : ''}
            </span>
          </div>

          <button
            type="button"
            onClick={() =>
              onAskAdvisor(
                unwornCount >= 3
                  ? `Give me 2 fresh outfits using my unworn pieces and tell me the #1 gap in my closet.`
                  : 'Audit my wardrobe color balance and tell me what single piece would unlock the most outfits.'
              )
            }
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#0071E3] hover:underline whitespace-nowrap shrink-0 self-start sm:self-auto"
          >
            <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
            Ask Advisor about my closet
          </button>
        </section>
      )}

      {/* Filter & Search Toolbar */}
      <section className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div
          role="tablist"
          aria-label="Filter wardrobe by category"
          className="inline-flex items-center gap-1 p-1 bg-black/[0.04] rounded-xl overflow-x-auto max-w-full"
        >
          {CATEGORY_TABS.map((tab) => {
            const active = category === tab.id;
            const count =
              tab.id === 'all'
                ? garments.length
                : garments.filter((g) => g.category === tab.id).length;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setCategory(tab.id)}
                className={`px-3.5 py-2 text-[13px] font-medium rounded-lg whitespace-nowrap shrink-0 transition-all ${
                  active
                    ? 'bg-white text-[#1D1D1F] shadow-xs'
                    : 'text-[#6E6E73] hover:text-[#1D1D1F]'
                }`}
              >
                {tab.label}
                <span className="ml-1.5 text-[11px] text-[#86868B] tabular-nums">
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[180px] sm:w-56">
            <Search
              className="w-4 h-4 text-[#86868B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <label htmlFor="wardrobe-search" className="sr-only">
              Search wardrobe
            </label>
            <input
              id="wardrobe-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search fabric, color, fit..."
              className="w-full pl-9 pr-3.5 py-2 bg-white border border-black/[0.08] rounded-xl text-[14px] text-[#1D1D1F] placeholder:text-[#86868B] focus:border-[#0071E3] focus:outline-none transition-colors"
            />
          </div>

          <label htmlFor="wardrobe-season" className="sr-only">
            Filter by season or wear status
          </label>
          <select
            id="wardrobe-season"
            value={seasonFilter}
            onChange={(e) =>
              setSeasonFilter(e.target.value as 'all' | 'unworn' | SeasonTag)
            }
            className="px-3 py-2 bg-white border border-black/[0.08] rounded-xl text-[13px] font-medium text-[#1D1D1F] focus:border-[#0071E3] focus:outline-none"
          >
            <option value="all">All Seasons</option>
            <option value="Summer">Summer</option>
            <option value="Spring">Spring</option>
            <option value="Autumn">Autumn</option>
            <option value="Winter">Winter</option>
            <option value="unworn">Unworn Only ({unwornCount})</option>
          </select>

          <label htmlFor="wardrobe-sort" className="sr-only">
            Sort garments
          </label>
          <select
            id="wardrobe-sort"
            value={sortBy}
            onChange={(e) =>
              setSortBy(e.target.value as 'newest' | 'flattery' | 'formality' | 'worn')
            }
            className="px-3 py-2 bg-white border border-black/[0.08] rounded-xl text-[13px] font-medium text-[#1D1D1F] focus:border-[#0071E3] focus:outline-none"
          >
            <option value="newest">Recently Added</option>
            <option value="flattery">Best for Me</option>
            <option value="formality">Highest Formality</option>
            <option value="worn">Most Worn</option>
          </select>
        </div>
      </section>

      {/* Garment Studio Grid */}
      {filtered.length === 0 ? (
        <section className="surface-card rounded-3xl p-12 text-center max-w-xl mx-auto">
          <div className="w-12 h-12 rounded-2xl bg-[#F5F5F7] flex items-center justify-center mx-auto mb-4">
            <Upload className="w-5 h-5 text-[#1D1D1F]" aria-hidden="true" />
          </div>
          <h2 className="text-[20px] font-semibold text-[#1D1D1F]">
            {garments.length === 0 ? 'Your wardrobe is ready for photos' : 'No matching pieces found'}
          </h2>
          <p className="mt-2 text-[14px] text-[#6E6E73]">
            {garments.length === 0
              ? 'Upload up to 50 clothing photos at once to build your closet.'
              : 'Try clearing your search or switching back to All Pieces.'}
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            {garments.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setCategory('all');
                  setSeasonFilter('all');
                  setQuery('');
                }}
                className="px-4 py-2 rounded-full border border-black/[0.12] text-[13px] font-medium text-[#1D1D1F] hover:bg-black/[0.03]"
              >
                Reset Filters
              </button>
            )}
            <button
              type="button"
              onClick={onOpenUpload}
              className="px-5 py-2 rounded-full bg-[#1D1D1F] text-white text-[13px] font-medium hover:bg-[#3A3A3C]"
            >
              Upload Clothes (Up to 50)
            </button>
          </div>
        </section>
      ) : (
        <section
          aria-label="Wardrobe catalog"
          data-testid="wardrobe-grid"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-7"
        >
          {filtered.map((item) => {
            const topMatch = companionsByGarment[item.id]?.[0];
            const flatteryScore = personalScores.get(item.id) ?? 75;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectGarment(item)}
                className="group text-left surface-card surface-card-hover rounded-[22px] overflow-hidden flex flex-col"
              >
                <div className="relative aspect-[4/5] w-full bg-[#EFEFEF] overflow-hidden">
                  <SmartImage
                    src={item.imageUrl}
                    alt={item.name}
                    swatchHex={item.colorHex}
                    className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300 ease-out"
                  />
                  {profile.blueprint && (
                    <span className="absolute top-3 right-3 px-2 py-0.5 rounded-md bg-white/90 backdrop-blur-xs text-[11px] font-mono font-medium text-[#1D1D1F] border border-black/[0.06] tabular-nums">
                      {flatteryScore}% fit
                    </span>
                  )}
                </div>

                <div className="p-5 flex-1 flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-center justify-between gap-2 text-[12px] text-[#6E6E73]">
                      <span className="capitalize truncate">
                        {item.subCategory} · {item.fit}
                      </span>
                      <span className="font-mono tabular-nums text-[#86868B] shrink-0">
                        {item.formality}/10
                      </span>
                    </div>

                    <h3 className="mt-1.5 text-[17px] font-semibold tracking-[-0.015em] text-[#1D1D1F] group-hover:text-[#0071E3] transition-colors line-clamp-1">
                      {item.name}
                    </h3>

                    <p className="mt-1 text-[13px] text-[#6E6E73] line-clamp-1">
                      {item.fabric}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-black/[0.06] flex items-center justify-between gap-2 text-[12px] text-[#6E6E73]">
                    <span className="inline-flex items-center gap-2 min-w-0">
                      <span
                        className="w-3 h-3 rounded-full border border-black/15 shrink-0"
                        style={{ backgroundColor: item.colorHex }}
                        aria-hidden="true"
                      />
                      <span className="truncate">
                        {item.primaryColor} · {item.seasons[0]}
                      </span>
                    </span>
                    {topMatch && (
                      <span className="font-mono text-[11px] text-[#1D1D1F] tabular-nums shrink-0">
                        {topMatch.score}% match
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </section>
      )}
    </div>
  );
}
