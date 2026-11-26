import { useEffect, useState } from 'react';
import { RefreshCw, Save, Trash2, X } from 'lucide-react';
import type { CompanionMatch, Garment, GarmentCategory } from '../types/styling';
import { SmartImage } from './SmartImage';

interface GarmentInspectorProps {
  garment: Garment | null;
  allGarments: Garment[];
  companions: CompanionMatch[];
  onClose: () => void;
  onSelectGarment: (g: Garment) => void;
  onUpdateGarment: (id: string, patch: Partial<Garment>) => Promise<void>;
  onReanalyzeGarment: (id: string) => Promise<void>;
  onDeleteGarment: (id: string) => Promise<void>;
  onStyleAroundGarment: (garmentId: string) => void;
}

export function GarmentInspector({
  garment,
  allGarments,
  companions,
  onClose,
  onSelectGarment,
  onUpdateGarment,
  onReanalyzeGarment,
  onDeleteGarment,
  onStyleAroundGarment,
}: GarmentInspectorProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    category: 'tops' as GarmentCategory,
    fabric: '',
    fit: '',
    primaryColor: '',
    pattern: '',
    formality: 5,
    stylingNotes: '',
  });

  useEffect(() => {
    if (!garment) return;
    setEditing(false);
    setActionError(null);
    setForm({
      name: garment.name,
      category: garment.category,
      fabric: garment.fabric,
      fit: garment.fit,
      primaryColor: garment.primaryColor,
      pattern: garment.pattern,
      formality: garment.formality,
      stylingNotes: garment.stylingNotes,
    });
  }, [garment]);

  useEffect(() => {
    if (!garment) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [garment, onClose]);

  if (!garment) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setSaving(true);
    try {
      await onUpdateGarment(garment.id, form);
      setEditing(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  const handleReanalyze = async () => {
    setActionError(null);
    setReanalyzing(true);
    try {
      await onReanalyzeGarment(garment.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to re-inspect garment.');
    } finally {
      setReanalyzing(false);
    }
  };

  const handleDelete = async () => {
    setActionError(null);
    setDeleting(true);
    try {
      await onDeleteGarment(garment.id);
      onClose();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to remove garment.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-[3px]"
      role="dialog"
      aria-modal="true"
      aria-label={`Inspect ${garment.name}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[560px] bg-white h-full overflow-y-auto shadow-2xl flex flex-col">
        {/* Sticky Sheet Header */}
        <div className="sticky top-0 z-10 apple-glass border-b border-black/[0.06] px-6 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[12px] text-[#6E6E73] capitalize">
              {garment.category} · {garment.subCategory}
            </p>
            <h2 className="text-[18px] font-semibold tracking-[-0.015em] text-[#1D1D1F] truncate">
              {garment.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close garment inspector"
            className="w-9 h-9 rounded-full bg-black/[0.05] hover:bg-black/[0.1] flex items-center justify-center text-[#1D1D1F] shrink-0 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-8 flex-1">
          {/* Studio Preview */}
          <div className="aspect-[4/4] max-h-[360px] w-full rounded-2xl overflow-hidden bg-[#ECECE6]">
            <SmartImage
              src={garment.imageUrl}
              alt={garment.name}
              swatchHex={garment.colorHex}
              className="w-full h-full object-cover object-center"
            />
          </div>

          {/* Primary Actions Row */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                onClose();
                onStyleAroundGarment(garment.id);
              }}
              className="px-4 py-2 rounded-full bg-[#1D1D1F] text-white text-[13px] font-medium hover:bg-[#3A3A3C] transition-colors"
            >
              Build Outfits Around This
            </button>
            <button
              type="button"
              onClick={handleReanalyze}
              disabled={reanalyzing}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-black/[0.12] text-[13px] font-medium text-[#1D1D1F] hover:bg-black/[0.03] disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${reanalyzing ? 'animate-spin' : ''}`} />
              {reanalyzing ? 'Inspecting...' : 'Re-inspect with AI'}
            </button>
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="px-4 py-2 rounded-full border border-black/[0.12] text-[13px] font-medium text-[#1D1D1F] hover:bg-black/[0.03] transition-colors"
            >
              {editing ? 'Cancel Edit' : 'Edit Details'}
            </button>
          </div>

          {actionError && (
            <div
              role="alert"
              className="px-4 py-3 rounded-xl bg-[#FFF2F2] border border-[#D70015]/20 text-[13px] text-[#B00012]"
            >
              {actionError}
            </div>
          )}

          {editing ? (
            <form onSubmit={handleSave} className="space-y-4 pt-2 border-t border-black/[0.06]">
              <div>
                <label htmlFor="edit-name" className="block text-[12px] font-medium text-[#6E6E73] mb-1">
                  Garment Name
                </label>
                <input
                  id="edit-name"
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-black/[0.12] text-[14px] text-[#1D1D1F]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-cat" className="block text-[12px] font-medium text-[#6E6E73] mb-1">
                    Category
                  </label>
                  <select
                    id="edit-cat"
                    value={form.category}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, category: e.target.value as GarmentCategory }))
                    }
                    className="w-full px-3 py-2.5 rounded-xl border border-black/[0.12] text-[14px] text-[#1D1D1F] bg-white"
                  >
                    <option value="tops">Tops</option>
                    <option value="bottoms">Bottoms</option>
                    <option value="outerwear">Outerwear</option>
                    <option value="footwear">Footwear</option>
                    <option value="accessories">Accessories</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="edit-formality" className="block text-[12px] font-medium text-[#6E6E73] mb-1">
                    Formality (1–10)
                  </label>
                  <input
                    id="edit-formality"
                    type="number"
                    min={1}
                    max={10}
                    value={form.formality}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, formality: Number(e.target.value) || 5 }))
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl border border-black/[0.12] text-[14px] text-[#1D1D1F] tabular-nums"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-fabric" className="block text-[12px] font-medium text-[#6E6E73] mb-1">
                    Fabric & Weave
                  </label>
                  <input
                    id="edit-fabric"
                    type="text"
                    value={form.fabric}
                    onChange={(e) => setForm((f) => ({ ...f, fabric: e.target.value }))}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-black/[0.12] text-[14px] text-[#1D1D1F]"
                  />
                </div>
                <div>
                  <label htmlFor="edit-fit" className="block text-[12px] font-medium text-[#6E6E73] mb-1">
                    Fit & Drape
                  </label>
                  <input
                    id="edit-fit"
                    type="text"
                    value={form.fit}
                    onChange={(e) => setForm((f) => ({ ...f, fit: e.target.value }))}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-black/[0.12] text-[14px] text-[#1D1D1F]"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="edit-notes" className="block text-[12px] font-medium text-[#6E6E73] mb-1">
                  Styling Notes
                </label>
                <textarea
                  id="edit-notes"
                  rows={2}
                  value={form.stylingNotes}
                  onChange={(e) => setForm((f) => ({ ...f, stylingNotes: e.target.value }))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-black/[0.12] text-[14px] text-[#1D1D1F]"
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#0071E3] text-white text-[13px] font-medium hover:bg-[#0077ED] disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </form>
          ) : (
            <>
              {/* Forensic Fabric, Fit & Color Specifications */}
              <section className="space-y-4">
                <h3 className="text-[15px] font-semibold text-[#1D1D1F]">
                  Garment Inspection
                </h3>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-black/[0.06] py-5 text-[14px]">
                  <div>
                    <dt className="text-[12px] text-[#6E6E73]">Fabric & Weave</dt>
                    <dd className="mt-0.5 font-medium text-[#1D1D1F]">{garment.fabric}</dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-[#6E6E73]">Weight & Texture</dt>
                    <dd className="mt-0.5 font-medium text-[#1D1D1F]">
                      {garment.fabricWeight} · {garment.texture}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-[#6E6E73]">Fit & Silhouette</dt>
                    <dd className="mt-0.5 font-medium text-[#1D1D1F]">
                      {garment.fit} ({garment.silhouette})
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-[#6E6E73]">Pattern</dt>
                    <dd className="mt-0.5 font-medium text-[#1D1D1F]">{garment.pattern}</dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-[#6E6E73]">Color & Undertone</dt>
                    <dd className="mt-0.5 font-medium text-[#1D1D1F] flex items-center gap-2">
                      <span
                        className="w-3.5 h-3.5 rounded-full border border-black/15 shrink-0"
                        style={{ backgroundColor: garment.colorHex }}
                      />
                      <span>
                        {garment.primaryColor} · {garment.undertone}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-[#6E6E73]">Formality & Layer Role</dt>
                    <dd className="mt-0.5 font-medium text-[#1D1D1F] tabular-nums">
                      {garment.formality}/10 · {garment.layeringRole}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-[#6E6E73]">Seasons</dt>
                    <dd className="mt-0.5 font-medium text-[#1D1D1F]">
                      {garment.seasons.join(', ')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-[#6E6E73]">Server Vector Index</dt>
                    <dd className="mt-0.5 font-mono text-[12px] text-[#1D1D1F]">
                      {garment.vectorSource === 'gemini-embedding-2'
                        ? 'Multimodal Vector Saved'
                        : 'Attribute Vector Saved'}
                    </dd>
                  </div>
                </dl>

                <div>
                  <p className="text-[12px] text-[#6E6E73]">Styling Guidance</p>
                  <p className="mt-1 text-[14px] leading-[1.6] text-[#1D1D1F]">
                    {garment.stylingNotes}
                  </p>
                </div>
              </section>

              {/* Top Vector-Matched Companions */}
              <section className="space-y-4">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-[15px] font-semibold text-[#1D1D1F]">
                    Best Vector-Matched Pairings
                  </h3>
                  <span className="text-[12px] text-[#6E6E73]">From your wardrobe</span>
                </div>

                {companions.length === 0 ? (
                  <p className="text-[13px] text-[#6E6E73]">
                    Upload complementary categories (tops, bottoms, outerwear, or footwear) to calculate vector pairings.
                  </p>
                ) : (
                  <div className="divide-y divide-black/[0.06] border-y border-black/[0.06]">
                    {companions.map((match) => {
                      const companion = allGarments.find((g) => g.id === match.garmentId);
                      if (!companion) return null;
                      return (
                        <button
                          key={match.garmentId}
                          type="button"
                          onClick={() => onSelectGarment(companion)}
                          className="w-full py-3.5 flex items-center gap-4 text-left hover:bg-[#F5F5F7]/70 px-2 -mx-2 rounded-xl transition-colors"
                        >
                          <div className="w-14 h-16 rounded-lg overflow-hidden bg-[#EFEFF2] shrink-0">
                            <SmartImage
                              src={companion.imageUrl}
                              alt={companion.name}
                              swatchHex={companion.colorHex}
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[14px] font-medium text-[#1D1D1F] truncate">
                              {companion.name}
                            </p>
                            <p className="mt-0.5 text-[12px] text-[#6E6E73] line-clamp-1">
                              {match.reason}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-mono text-[14px] font-medium text-[#1D1D1F] tabular-nums">
                              {match.score}%
                            </p>
                            <p className="text-[11px] text-[#86868B] tabular-nums">
                              Vec {match.vectorSimilarity}%
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        {/* Footer Danger Action */}
        <div className="px-6 py-4 border-t border-black/[0.06] flex items-center justify-between text-[12px] text-[#6E6E73]">
          <span className="tabular-nums">Worn {garment.wearCount} times</span>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 text-[#D70015] hover:opacity-75 font-medium disabled:opacity-40"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {deleting ? 'Removing...' : 'Remove from Wardrobe'}
          </button>
        </div>
      </div>
    </div>
  );
}
