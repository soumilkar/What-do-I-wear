import { useEffect, useRef, useState } from 'react';
import { Camera, Check, Sparkles } from 'lucide-react';
import {
  STYLE_AESTHETIC_OPTIONS,
  STYLE_FIT_OPTIONS,
  type UserProfile,
} from '../types/styling';
import { compressClothingImage } from '../utils/imageCompress';
import { SmartImage } from './SmartImage';

interface ProfileViewProps {
  profile: UserProfile;
  onSaveProfile: (patch: Partial<UserProfile>) => Promise<void>;
  onUploadPhoto: (file: File, currentForm: UserProfile) => Promise<void>;
  onAnalyzeBlueprint: (currentForm: UserProfile) => Promise<void>;
}

const FIT_OPTIONS = [...STYLE_FIT_OPTIONS];
const AESTHETIC_OPTIONS = [...STYLE_AESTHETIC_OPTIONS];

export function ProfileView({
  profile,
  onSaveProfile,
  onUploadPhoto,
  onAnalyzeBlueprint,
}: ProfileViewProps) {
  const [form, setForm] = useState(profile);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setForm(profile);
  }, [profile]);

  const [analysisSuccess, setAnalysisSuccess] = useState<string | null>(null);

  const toggleMulti = (field: 'preferredFits' | 'styleAesthetics', value: string) => {
    setForm((prev) => {
      const current = prev[field];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : current.length < 12
          ? [...current, value]
          : current;
      return { ...prev, [field]: next };
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setAnalysisSuccess(null);
    setSaving(true);
    try {
      await onSaveProfile(form);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2600);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoChange = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setAnalysisSuccess(null);
    setUploadingPhoto(true);
    try {
      const compressed = await compressClothingImage(file, 1024);
      await onUploadPhoto(compressed, form);
      setAnalysisSuccess(
        'Portrait analyzed & saved to cloud. Your style profile, hex color palette, and all recommendations are now updated.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Portrait upload failed.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleAnalyze = async () => {
    setError(null);
    setAnalysisSuccess(null);
    setAnalyzing(true);
    try {
      // Save latest details first, then pass current form directly so AI never reads stale state
      await onSaveProfile(form);
      await onAnalyzeBlueprint(form);
      setAnalysisSuccess(
        'AI Styling Blueprint saved to cloud and actively personalizing Combinations, Studio, Wardrobe, and Advisor.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI blueprint analysis failed.');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="space-y-10">
      <section className="flex flex-col md:flex-row md:items-end justify-between gap-6 pt-2">
        <div className="max-w-2xl">
          <h1 className="text-[32px] sm:text-[42px] font-semibold tracking-[-0.03em] leading-[1.08] text-[#1D1D1F]">
            Your personal style profile.
          </h1>
          <p className="mt-3 text-[16px] leading-[1.6] text-[#6E6E73]">
            Upload your photo and our AI automatically analyzes your coloring, features, and proportions—auto-filling your style profile and deeply personalizing every outfit, companion, and shopping recommendation across the entire app.
          </p>
        </div>

        <button
          type="button"
          disabled={analyzing || uploadingPhoto}
          onClick={handleAnalyze}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#0071E3] text-white text-[14px] font-medium whitespace-nowrap hover:bg-[#0077ED] disabled:opacity-50 self-start md:self-auto shrink-0 transition-colors"
        >
          <Sparkles className={`w-4 h-4 ${analyzing || uploadingPhoto ? 'animate-spin' : ''}`} aria-hidden="true" />
          {analyzing || uploadingPhoto ? 'Analyzing Portrait & Filling Profile...' : 'Analyze My Look with AI'}
        </button>
      </section>

      {error && (
        <div
          role="alert"
          className="px-5 py-3.5 rounded-2xl bg-[#FFF2F2] border border-[#D70015]/20 text-[14px] text-[#B00012]"
        >
          {error}
        </div>
      )}

      {analysisSuccess && (
        <div
          role="status"
          className="px-5 py-3.5 rounded-2xl bg-[#F0FDF4] border border-[#16A34A]/20 text-[14px] text-[#166534] flex items-center gap-2"
        >
          <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{analysisSuccess}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Portrait & Cached AI Personal Styling Blueprint */}
        <aside className="lg:col-span-5 space-y-6">
          <section className="surface-card rounded-[26px] p-6 space-y-5">
            <div className="flex items-center gap-5">
              <div className="relative w-24 h-24 rounded-full overflow-hidden bg-[#EFEFF2] shrink-0 border border-black/[0.08]">
                <SmartImage
                  src={profile.photoUrl}
                  alt={`${profile.name || 'User'} portrait`}
                  className={
                    profile.photoUrl.includes('profile_style_portrait')
                      ? 'w-full h-full object-cover object-[50%_26%] scale-[1.52]'
                      : 'w-full h-full object-cover object-center'
                  }
                />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-[20px] font-semibold text-[#1D1D1F] truncate">
                  {profile.name || 'Your Profile'}
                </h2>
                <p className="mt-0.5 text-[13px] text-[#6E6E73]">
                  {profile.height} · {profile.bodyType}
                </p>

                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  className="hidden"
                  onChange={(e) => {
                    void handlePhotoChange(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  disabled={uploadingPhoto || analyzing}
                  onClick={() => fileRef.current?.click()}
                  className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-black/[0.12] text-[12px] font-medium text-[#1D1D1F] hover:bg-black/[0.03] disabled:opacity-40"
                >
                  <Camera className="w-3.5 h-3.5" aria-hidden="true" />
                  {uploadingPhoto ? 'Uploading & Analyzing...' : 'Upload Portrait Photo'}
                </button>
              </div>
            </div>

            {profile.blueprint ? (
              <div className="pt-5 border-t border-black/[0.06] space-y-5">
                <div className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-[15px] font-semibold text-[#1D1D1F]">
                      What Looks Best on You
                    </h3>
                    <span className="text-[12px] font-medium text-[#0071E3]">
                      {profile.blueprint.colorSeason} · {profile.blueprint.contrastLevel}
                    </span>
                  </div>
                  <p className="text-[11.5px] text-[#16A34A] flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                    {profile.blueprint.photoAnalyzed
                      ? 'Portrait analyzed & saved · Actively powering all outfits & advisor'
                      : 'Saved to cloud · Actively powering all outfits & advisor'}
                  </p>
                </div>

                {profile.blueprint.visualProfile && (
                  <div className="rounded-xl bg-[#F5F5F7] px-3.5 py-2.5 text-[13px] leading-[1.55] text-[#48484A]">
                    <span className="font-medium text-[#1D1D1F]">Portrait Read: </span>
                    {profile.blueprint.visualProfile}
                  </div>
                )}

                <p className="text-[14px] leading-[1.6] text-[#1D1D1F]">
                  {profile.blueprint.summary}
                </p>

                <div className="space-y-3.5 text-[13px]">
                  <div>
                    <p className="text-[12px] font-medium text-[#6E6E73]">Best Colors Near Your Face</p>
                    {profile.blueprint.bestColorHexes && profile.blueprint.bestColorHexes.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        {profile.blueprint.bestColorHexes.map((hex, idx) => (
                          <span
                            key={`${hex}-${idx}`}
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#F5F5F7] border border-black/[0.06] text-[12px] text-[#1D1D1F]"
                          >
                            <span
                              className="w-3 h-3 rounded-full border border-black/15 shrink-0"
                              style={{ backgroundColor: hex }}
                              aria-hidden="true"
                            />
                            {profile.blueprint?.bestColors[idx] || hex}
                          </span>
                        ))}
                      </div>
                    )}
                    {(!profile.blueprint.bestColorHexes || profile.blueprint.bestColorHexes.length === 0) && (
                      <p className="mt-0.5 text-[#1D1D1F]">
                        {profile.blueprint.bestColors.join(' · ')}
                      </p>
                    )}
                  </div>

                  {profile.blueprint.avoidColors.length > 0 && (
                    <div>
                      <p className="text-[12px] font-medium text-[#6E6E73]">Colors to Avoid / Minimize</p>
                      {profile.blueprint.avoidColorHexes && profile.blueprint.avoidColorHexes.length > 0 ? (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          {profile.blueprint.avoidColorHexes.map((hex, idx) => (
                            <span
                              key={`${hex}-${idx}`}
                              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#F5F5F7] border border-black/[0.06] text-[12px] text-[#6E6E73]"
                            >
                              <span
                                className="w-3 h-3 rounded-full border border-black/15 shrink-0"
                                style={{ backgroundColor: hex }}
                                aria-hidden="true"
                              />
                              {profile.blueprint?.avoidColors[idx] || hex}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-0.5 text-[#6E6E73]">
                          {profile.blueprint.avoidColors.join(' · ')}
                        </p>
                      )}
                    </div>
                  )}

                  <div>
                    <p className="text-[12px] font-medium text-[#6E6E73]">Ideal Silhouettes</p>
                    <ul className="mt-1 space-y-1 text-[#1D1D1F]">
                      {profile.blueprint.idealSilhouettes.map((tip) => (
                        <li key={tip}>— {tip}</li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <p className="text-[12px] font-medium text-[#6E6E73]">Proportion Guidance</p>
                    <ul className="mt-1 space-y-1 text-[#1D1D1F]">
                      {profile.blueprint.proportionTips.map((tip) => (
                        <li key={tip}>— {tip}</li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <p className="text-[12px] font-medium text-[#6E6E73]">Recommended Fabrics</p>
                    <p className="mt-0.5 text-[#1D1D1F]">
                      {profile.blueprint.recommendedFabrics.join(' · ')}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="pt-5 border-t border-black/[0.06] text-[13px] text-[#6E6E73]">
                Upload a clear portrait photo and we&rsquo;ll automatically detect your skin undertone, color season, hex palette, flattering cuts, and save them to your cloud profile to personalize recommendations everywhere.
              </div>
            )}
          </section>
        </aside>

        {/* Right: Editable Personal Details Form */}
        <form
          onSubmit={handleSave}
          className="lg:col-span-7 surface-card rounded-[26px] p-6 sm:p-8 space-y-6"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label htmlFor="profile-name" className="block text-[12px] font-medium text-[#6E6E73] mb-1.5">
                Full Name
              </label>
              <input
                id="profile-name"
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5F5F7] border border-black/[0.06] text-[14px] text-[#1D1D1F]"
              />
            </div>
            <div>
              <label htmlFor="profile-height" className="block text-[12px] font-medium text-[#6E6E73] mb-1.5">
                Height
              </label>
              <input
                id="profile-height"
                type="text"
                value={form.height}
                onChange={(e) => setForm((f) => ({ ...f, height: e.target.value }))}
                placeholder={`e.g. 5'8" (173 cm)`}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5F5F7] border border-black/[0.06] text-[14px] text-[#1D1D1F]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label htmlFor="profile-body" className="block text-[12px] font-medium text-[#6E6E73] mb-1.5">
                Body Type & Build
              </label>
              <input
                id="profile-body"
                type="text"
                value={form.bodyType}
                onChange={(e) => setForm((f) => ({ ...f, bodyType: e.target.value }))}
                placeholder="e.g. Athletic, Hourglass, Broad Shoulders, Petite"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5F5F7] border border-black/[0.06] text-[14px] text-[#1D1D1F]"
              />
            </div>
            <div>
              <label htmlFor="profile-undertone" className="block text-[12px] font-medium text-[#6E6E73] mb-1.5">
                Skin Undertone
              </label>
              <select
                id="profile-undertone"
                value={form.skinUndertone}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    skinUndertone: e.target.value as UserProfile['skinUndertone'],
                  }))
                }
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5F5F7] border border-black/[0.06] text-[14px] text-[#1D1D1F]"
              >
                <option value="Warm">Warm</option>
                <option value="Cool">Cool</option>
                <option value="Neutral">Neutral</option>
                <option value="Olive">Olive</option>
                <option value="Warm Olive">Warm Olive</option>
                <option value="Cool Olive">Cool Olive</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="profile-bio" className="block text-[12px] font-medium text-[#6E6E73] mb-1.5">
              About You & Lifestyle
            </label>
            <textarea
              id="profile-bio"
              rows={3}
              value={form.bio}
              onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
              placeholder="Share your daily environments, style inspirations, what makes you feel most confident..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5F5F7] border border-black/[0.06] text-[14px] leading-[1.6] text-[#1D1D1F]"
            />
          </div>

          {/* Interactive Fit Preference Selector (12 Fits) */}
          <fieldset className="space-y-2.5">
            <legend className="text-[12px] font-medium text-[#6E6E73]">
              Preferred Fits ({form.preferredFits.length} selected)
            </legend>
            <div className="flex flex-wrap gap-2">
              {FIT_OPTIONS.map((fit) => {
                const active = form.preferredFits.includes(fit);
                return (
                  <button
                    key={fit}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleMulti('preferredFits', fit)}
                    className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all ${
                      active
                        ? 'bg-[#1D1D1F] text-white'
                        : 'bg-[#F5F5F7] text-[#48484A] hover:bg-black/[0.08]'
                    }`}
                  >
                    {fit}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* Interactive Aesthetic Selector (18 Style Profiles) */}
          <fieldset className="space-y-2.5">
            <legend className="text-[12px] font-medium text-[#6E6E73]">
              Style Profiles &amp; Aesthetics ({form.styleAesthetics.length} selected)
            </legend>
            <div className="flex flex-wrap gap-2">
              {AESTHETIC_OPTIONS.map((style) => {
                const active = form.styleAesthetics.includes(style);
                return (
                  <button
                    key={style}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleMulti('styleAesthetics', style)}
                    className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all ${
                      active
                        ? 'bg-[#1D1D1F] text-white'
                        : 'bg-[#F5F5F7] text-[#48484A] hover:bg-black/[0.08]'
                    }`}
                  >
                    {style}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label htmlFor="profile-budget" className="block text-[12px] font-medium text-[#6E6E73] mb-1.5">
                Shopping Budget Tier
              </label>
              <select
                id="profile-budget"
                value={form.budgetRange}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    budgetRange: e.target.value as UserProfile['budgetRange'],
                  }))
                }
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5F5F7] border border-black/[0.06] text-[14px] text-[#1D1D1F]"
              >
                <option value="Accessible">Accessible</option>
                <option value="Mid-Tier">Mid-Tier</option>
                <option value="Contemporary">Contemporary</option>
                <option value="Luxury">Luxury</option>
              </select>
            </div>
            <div>
              <label htmlFor="profile-climate" className="block text-[12px] font-medium text-[#6E6E73] mb-1.5">
                Primary Climate
              </label>
              <select
                id="profile-climate"
                value={form.climate}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    climate: e.target.value as UserProfile['climate'],
                  }))
                }
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5F5F7] border border-black/[0.06] text-[14px] text-[#1D1D1F]"
              >
                <option value="Four-Season">Four-Season</option>
                <option value="Temperate">Temperate</option>
                <option value="Warm">Warm</option>
                <option value="Cold">Cold</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="profile-goals" className="block text-[12px] font-medium text-[#6E6E73] mb-1.5">
              Styling Goals
            </label>
            <input
              id="profile-goals"
              type="text"
              value={form.stylingGoals}
              onChange={(e) => setForm((f) => ({ ...f, stylingGoals: e.target.value }))}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5F5F7] border border-black/[0.06] text-[14px] text-[#1D1D1F]"
            />
          </div>

          <div className="pt-2 flex items-center justify-between gap-4">
            {savedNotice ? (
              <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#16A34A]">
                <Check className="w-4 h-4" />
                Profile saved to server
              </span>
            ) : (
              <span className="text-[12px] text-[#86868B]">
                Synced automatically with combination ranking & shopping advisor
              </span>
            )}

            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2.5 rounded-full bg-[#1D1D1F] text-white text-[14px] font-medium hover:bg-[#3A3A3C] disabled:opacity-40 transition-colors shrink-0"
            >
              {saving ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
