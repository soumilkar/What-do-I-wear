/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { onAuthStateChanged, type User } from 'firebase/auth';
import { useCallback, useEffect, useState } from 'react';
import { type AdvisorAttachedImage, AdvisorView } from './components/AdvisorView';
import { AuthScreen } from './components/AuthScreen';
import {
  type AnalyzedCloudGarmentEntry,
  BatchUploadModal,
} from './components/BatchUploadModal';
import { CombinationsView } from './components/CombinationsView';
import { GarmentInspector } from './components/GarmentInspector';
import { ProfileView } from './components/ProfileView';
import { StudioView } from './components/StudioView';
import { AppTab, TopNav } from './components/TopNav';
import { WardrobeView } from './components/WardrobeView';
import {
  addAdvisorTurnToCloud,
  addGarmentsToCloud,
  clearAdvisorHistoryInCloud,
  type CloudWorkspaceState,
  deleteGarmentFromCloud,
  deleteSavedOutfitFromCloud,
  ensureUserWorkspaceSeeded,
  logOutfitWearInCloud,
  reanalyzeGarmentInCloud,
  replaceRankedCombinationsInCloud,
  saveOutfitToCloud,
  saveProfileAnalysisInCloud,
  subscribeUserWorkspace,
  updateGarmentInCloud,
  updateProfileInCloud,
  updateProfilePhotoInCloud,
} from './lib/cloudWardrobe';
import { apiJson } from './lib/apiClient';
import {
  auth,
  reloadAndRefreshUser,
  resendVerificationEmail,
  signOutUser,
} from './lib/firebase';
import type {
  AIProfileBlueprint,
  Garment,
  GroundingSource,
  OccasionType,
  OutfitCombination,
  SeasonTag,
  UserProfile,
} from './types/styling';
import { compressImageToDataUrl } from './utils/imageCompress';

/**
 * Strips heavy base64 data URLs before sending wardrobe metadata to AI endpoints
 * so 45-100 item cloud wardrobes send ~25 KB instead of 8-18 MB (avoiding 413 Payload Too Large).
 */
function stripGarmentImages(garments: Garment[]): Garment[] {
  return garments.map((g) => ({ ...g, imageUrl: '' }));
}

function stripProfilePhoto(profile: UserProfile): UserProfile {
  return { ...profile, photoUrl: '' };
}

/**
 * Extracts a compact portrait image payload from the user's cloud-saved portrait data URL
 * so Combinations, Studio Critique, and Shopping Advisor can actually see the user multimodally.
 */
function extractPortraitPayload(
  profile: UserProfile
): { base64: string; mimeType: string } | null {
  if (!profile.photoUrl || !profile.photoUrl.startsWith('data:')) return null;
  const m = profile.photoUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) return null;
  if (m[2].length > 250_000) return null;
  return { mimeType: m[1], base64: m[2] };
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [workspace, setWorkspace] = useState<CloudWorkspaceState | null>(null);
  const [syncError, setSyncError] = useState<Error | null>(null);

  const [activeTab, setActiveTab] = useState<AppTab>('wardrobe');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [inspectedGarmentId, setInspectedGarmentId] = useState<string | null>(null);
  const [anchorForCombos, setAnchorForCombos] = useState<string>('');
  const [studioDraft, setStudioDraft] = useState<OutfitCombination | null>(null);
  const [advisorPrefill, setAdvisorPrefill] = useState<string>('');
  const [toast, setToast] = useState<string | null>(null);

  const [emailVerifiedFlag, setEmailVerifiedFlag] = useState(false);
  const [checkingVerify, setCheckingVerify] = useState(false);
  const [resendingVerify, setResendingVerify] = useState(false);
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null);

  // Propagate fatal Firestore permission/quota errors cleanly to ErrorBoundary
  if (syncError) {
    throw syncError;
  }

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 3600);
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setEmailVerifiedFlag(Boolean(nextUser?.emailVerified));
      setAuthReady(true);
      if (!nextUser) {
        setWorkspace(null);
        setInspectedGarmentId(null);
        setUploadOpen(false);
        setVerifyNotice(null);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!authReady || !user || !emailVerifiedFlag) return;
    let active = true;
    let unsubscribe: (() => void) | null = null;

    const bootCloudWorkspace = async () => {
      try {
        await ensureUserWorkspaceSeeded(user);
        if (!active) return;
        unsubscribe = subscribeUserWorkspace(
          user.uid,
          (state) => {
            if (active) setWorkspace(state);
          },
          (err) => {
            if (active) setSyncError(err);
          }
        );
      } catch (err) {
        if (active) {
          setSyncError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    };

    void bootCloudWorkspace();

    return () => {
      active = false;
      if (unsubscribe) unsubscribe();
    };
  }, [authReady, user, emailVerifiedFlag]);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#F5F5F7] flex items-center justify-center">
        <div className="text-center space-y-2 animate-pulse">
          <p className="font-display text-[20px] font-semibold tracking-[-0.025em] text-[#1D1D1F]">
            What do I Wear?
          </p>
          <p className="text-[13px] text-[#6E6E73]">Connecting to your cloud wardrobe...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  if (!emailVerifiedFlag) {
    return (
      <div className="min-h-screen bg-[#F5F5F7] text-[#1D1D1F] flex items-center justify-center p-6">
        <div className="surface-card rounded-[26px] p-7 sm:p-9 max-w-md w-full space-y-5 text-center">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6E6E73]">
            Verify Your Email
          </p>
          <h1 className="font-display text-[26px] font-semibold tracking-[-0.025em] text-[#1D1D1F]">
            Check your inbox to unlock your private wardrobe.
          </h1>
          <p className="text-[14px] leading-relaxed text-[#6E6E73]">
            We sent a verification link to{' '}
            <span className="font-medium text-[#1D1D1F]">{user.email}</span>. Click that link so
            your private cloud wardrobe stays protected, then tap continue below.
          </p>

          {verifyNotice && (
            <div className="px-4 py-2.5 rounded-xl bg-[#F5F5F7] border border-black/[0.08] text-[13px] text-[#1D1D1F]">
              {verifyNotice}
            </div>
          )}

          <div className="space-y-2.5 pt-1">
            <button
              type="button"
              disabled={checkingVerify}
              onClick={async () => {
                setCheckingVerify(true);
                setVerifyNotice(null);
                try {
                  const ok = await reloadAndRefreshUser(user);
                  if (ok) {
                    setEmailVerifiedFlag(true);
                  } else {
                    setVerifyNotice(
                      'Not verified yet. Open the link in your email (check spam too), then tap again.'
                    );
                  }
                } catch (err) {
                  setVerifyNotice(
                    err instanceof Error ? err.message : 'Unable to check verification status.'
                  );
                } finally {
                  setCheckingVerify(false);
                }
              }}
              className="w-full py-3 rounded-full bg-[#1D1D1F] text-white text-[14px] font-medium hover:bg-[#3A3A3C] disabled:opacity-50 transition-colors"
            >
              {checkingVerify ? 'Checking verification...' : "I've Verified — Continue"}
            </button>

            <button
              type="button"
              disabled={resendingVerify}
              onClick={async () => {
                setResendingVerify(true);
                setVerifyNotice(null);
                try {
                  await resendVerificationEmail(user);
                  setVerifyNotice(`Fresh verification email sent to ${user.email}.`);
                } catch (err) {
                  setVerifyNotice(
                    err instanceof Error ? err.message : 'Wait a moment before resending.'
                  );
                } finally {
                  setResendingVerify(false);
                }
              }}
              className="w-full py-2.5 rounded-full border border-black/[0.12] text-[13px] font-medium text-[#1D1D1F] hover:bg-black/[0.03] disabled:opacity-50 transition-colors"
            >
              {resendingVerify ? 'Sending...' : 'Resend Verification Email'}
            </button>

            <button
              type="button"
              onClick={() => void signOutUser()}
              className="w-full py-2 text-[13px] font-medium text-[#6E6E73] hover:text-[#1D1D1F]"
            >
              Sign out &amp; use another account
            </button>
          </div>
        </div>
      </div>
    );
  }

  const data = workspace?.bootstrap ?? null;
  const vectors = workspace?.vectors ?? {};

  const inspectedGarment: Garment | null =
    data?.garments.find((g) => g.id === inspectedGarmentId) ?? null;

  const handleSaveAnalyzedGarments = async (
    entries: AnalyzedCloudGarmentEntry[],
    options?: { silent?: boolean }
  ) => {
    await addGarmentsToCloud(user.uid, entries);
    if (!options?.silent) {
      setActiveTab('wardrobe');
      showToast(
        `Saved ${entries.length} new ${entries.length === 1 ? 'piece' : 'pieces'} to your cloud wardrobe.`
      );
    }
  };

  const handleBatchUploadComplete = (savedCount: number) => {
    setActiveTab('wardrobe');
    showToast(
      `Saved ${savedCount} new ${savedCount === 1 ? 'piece' : 'pieces'} to your cloud wardrobe.`
    );
  };

  const handleUpdateGarment = async (id: string, patch: Partial<Garment>) => {
    const current = data?.garments.find((g) => g.id === id);
    if (!current) return;
    await updateGarmentInCloud(user.uid, current, patch);
    showToast('Garment details synced to cloud.');
  };

  const handleReanalyzeGarment = async (id: string) => {
    const current = data?.garments.find((g) => g.id === id);
    if (!current) return;
    try {
      const payload: Record<string, string> = { fileName: current.name };
      if (current.imageUrl.startsWith('data:')) {
        const m = current.imageUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
        if (m) {
          payload.mimeType = m[1];
          payload.base64 = m[2];
        }
      } else {
        payload.imageUrl = current.imageUrl;
      }

      const res = await apiJson<{
        analyzed: Omit<
          Garment,
          'id' | 'imageUrl' | 'wearCount' | 'hasVector' | 'vectorSource' | 'modelUsed' | 'createdAt'
        >;
        vector: number[];
        vectorSource: 'gemini-embedding-2' | 'semantic-fallback';
        modelUsed: string;
      }>('/api/ai/analyze-garment', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      await reanalyzeGarmentInCloud(
        user.uid,
        id,
        res.analyzed,
        res.vector,
        res.vectorSource,
        res.modelUsed
      );
      showToast('Re-inspected garment and refreshed cloud image vector.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Re-analysis failed.');
    }
  };

  const handleDeleteGarment = async (id: string) => {
    if (!data) return;
    await deleteGarmentFromCloud(user.uid, id, data.rankedCombinations, data.savedOutfits);
    showToast('Removed garment from cloud wardrobe.');
  };

  const handleGenerateRankings = async (opts: {
    occasion: OccasionType;
    season: SeasonTag;
    anchorItemId?: string;
    customPrompt?: string;
    explorationMode?: 'best' | 'fresh';
  }) => {
    if (!data) return;
    const portraitImage = extractPortraitPayload(data.profile);
    const res = await apiJson<{
      combinations: OutfitCombination[];
      modelUsed: string;
      effectiveSeason?: SeasonTag;
    }>('/api/ai/rank-combinations', {
      method: 'POST',
      body: JSON.stringify({
        garments: stripGarmentImages(data.garments),
        vectors,
        profile: stripProfilePhoto(data.profile),
        portraitImage,
        savedOutfits: data.savedOutfits,
        ...opts,
      }),
    });

    await replaceRankedCombinationsInCloud(
      user.uid,
      data.rankedCombinations.map((c) => c.id),
      res.combinations
    );
    showToast(
      res.effectiveSeason && res.effectiveSeason !== opts.season
        ? `Ranked ${res.effectiveSeason} combinations tailored to your profile.`
        : 'Ranked fresh personalized combinations.'
    );
  };

  const handleSaveOutfit = async (payload: Partial<OutfitCombination>) => {
    if (!data) return;
    await saveOutfitToCloud(
      user.uid,
      payload,
      data.garments,
      vectors,
      data.profile,
      data.savedOutfits.length,
      data.rankedCombinations
    );
    showToast('Saved to your cloud Lookbook.');
  };

  const handleCritiqueOutfit = async (itemIds: string[], occasion: OccasionType) => {
    if (!data) {
      throw new Error('Wardrobe is still loading.');
    }
    const items = itemIds
      .map((id) => data.garments.find((g) => g.id === id))
      .filter((g): g is Garment => Boolean(g));
    const portraitImage = extractPortraitPayload(data.profile);
    return apiJson<{
      score: number;
      rationale: string;
      fabricFitNotes: string;
      bodyTailoringNote: string;
      finishingTouch: string;
      modelUsed: string;
    }>('/api/ai/critique-outfit', {
      method: 'POST',
      body: JSON.stringify({
        items: stripGarmentImages(items),
        profile: stripProfilePhoto(data.profile),
        portraitImage,
        occasion,
      }),
    });
  };

  const handleLogWear = async (outfitId: string) => {
    if (!data) return;
    const outfit = data.savedOutfits.find((o) => o.id === outfitId);
    if (!outfit) return;
    await logOutfitWearInCloud(user.uid, outfit, data.garments);
    showToast('Logged as worn today.');
  };

  const handleDeleteOutfit = async (outfitId: string) => {
    await deleteSavedOutfitFromCloud(user.uid, outfitId);
    showToast('Removed from Lookbook.');
  };

  const handleSaveProfile = async (patch: Partial<UserProfile>) => {
    await updateProfileInCloud(user.uid, patch);
  };

  const handleAnalyzeBlueprint = async (options?: {
    overridePhoto?: { base64: string; mimeType: string; dataUrl?: string };
    profileSnapshot?: UserProfile;
  }) => {
    if (!data) return;
    const activeProfile = options?.profileSnapshot ?? data.profile;
    let photoBase64: string | null = options?.overridePhoto?.base64 ?? null;
    let photoMimeType: string | null = options?.overridePhoto?.mimeType ?? null;

    if (!photoBase64 && activeProfile.photoUrl.startsWith('data:')) {
      const m = activeProfile.photoUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (m) {
        photoMimeType = m[1];
        photoBase64 = m[2];
      }
    }

    const res = await apiJson<{
      blueprint: AIProfileBlueprint;
      suggestedProfile?: {
        skinUndertone?: UserProfile['skinUndertone'];
        bodyType?: string;
        preferredFits?: string[];
        styleAesthetics?: string[];
        stylingGoals?: string;
      };
      modelUsed: string;
    }>('/api/ai/analyze-profile', {
      method: 'POST',
      body: JSON.stringify({
        profile: photoBase64 ? stripProfilePhoto(activeProfile) : activeProfile,
        photoBase64,
        photoMimeType,
      }),
    });

    // Single atomic Firestore write so photo, AI blueprint, and auto-filled profile fields are saved together
    await saveProfileAnalysisInCloud(user.uid, {
      photoUrl: options?.overridePhoto?.dataUrl,
      blueprint: res.blueprint,
      suggestedProfile: res.suggestedProfile,
    });

    showToast(
      res.blueprint.photoAnalyzed
        ? 'Portrait analyzed & saved to cloud—your style profile and all recommendations are now deeply personalized.'
        : 'Style profile analyzed & saved to cloud—all recommendations updated.'
    );
  };

  const handleUploadProfilePhoto = async (file: File, currentForm?: UserProfile) => {
    const compressed = await compressImageToDataUrl(file, 560, 185_000);
    // Persist photo immediately first so it is never lost even if AI is rate-limited
    await updateProfilePhotoInCloud(user.uid, compressed.dataUrl);
    try {
      await handleAnalyzeBlueprint({
        overridePhoto: {
          base64: compressed.base64,
          mimeType: compressed.mimeType,
          dataUrl: compressed.dataUrl,
        },
        profileSnapshot: currentForm
          ? { ...currentForm, photoUrl: compressed.dataUrl }
          : undefined,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'AI analysis failed';
      throw new Error(
        `Portrait saved to cloud, but automatic AI analysis could not finish (${reason}). Tap "Analyze My Look with AI" to retry.`
      );
    }
  };

  const handleSendAdvisorMessage = async (
    message: string,
    images?: AdvisorAttachedImage[]
  ) => {
    if (!data) return;
    const safeImages = Array.isArray(images) ? images.slice(0, 4) : [];
    const effectiveMessage =
      message.trim() ||
      (safeImages.length > 1
        ? 'Compare these items and tell me which one is the best buy for my wardrobe, colors, and proportions.'
        : 'Should I buy this item? Analyze how well it fits my wardrobe, colors, and proportions.');

    const strippedHistory = data.advisorMessages.map(({ attachedImages: _imgs, ...rest }) => rest);
    const portraitImage = extractPortraitPayload(data.profile);

    const reply = await apiJson<{
      content: string;
      referencedItemIds?: string[];
      sources?: GroundingSource[];
      modelUsed?: string;
    }>('/api/ai/advisor-chat', {
      method: 'POST',
      body: JSON.stringify({
        message: effectiveMessage,
        history: strippedHistory,
        garments: stripGarmentImages(data.garments),
        savedOutfits: data.savedOutfits,
        profile: stripProfilePhoto(data.profile),
        portraitImage,
        images: safeImages.map((img, idx) => ({
          base64: img.base64,
          mimeType: img.mimeType,
          label: img.label || `Option ${idx + 1}`,
        })),
      }),
    });

    await addAdvisorTurnToCloud(
      user.uid,
      effectiveMessage,
      reply,
      safeImages.map((img) => img.dataUrl)
    );
  };

  const handleClearAdvisorHistory = async () => {
    if (!data) return;
    await clearAdvisorHistoryInCloud(
      user.uid,
      data.advisorMessages.map((m) => m.id),
      data.profile.name,
      data.garments.length
    );
    showToast('Started a fresh advisor thread.');
  };

  const handleSignOut = async () => {
    await signOutUser();
  };

  const isFullScreenAdvisor = activeTab === 'advisor' && Boolean(data);

  return (
    <div
      className={`${
        isFullScreenAdvisor
          ? 'h-[100dvh] overflow-hidden bg-white'
          : 'min-h-screen bg-[#F5F5F7]'
      } flex flex-col text-[#1D1D1F]`}
    >
      <TopNav
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setActiveTab(tab);
          window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
        }}
        onOpenUpload={() => setUploadOpen(true)}
        userEmail={user.email}
        userName={data?.profile.name || user.displayName}
        userPhotoUrl={data?.profile.photoUrl || user.photoURL}
        onSignOut={() => void handleSignOut()}
      />

      <main
        className={
          isFullScreenAdvisor
            ? 'flex-1 min-h-0 w-full flex flex-col pb-[53px] md:pb-0'
            : 'flex-1 max-w-[1280px] w-full mx-auto px-5 sm:px-8 pt-8 pb-24 md:pb-16'
        }
      >
        {!data ? (
          <div className="space-y-8 animate-pulse" aria-busy="true" aria-label="Loading cloud wardrobe">
            <div className="h-12 w-80 bg-black/[0.06] rounded-2xl" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-7">
              {[1, 2, 3].map((n) => (
                <div key={n} className="aspect-[4/5] rounded-[22px] bg-black/[0.05]" />
              ))}
            </div>
          </div>
        ) : (
          <>
            {activeTab === 'wardrobe' && (
              <WardrobeView
                garments={data.garments}
                profile={data.profile}
                savedOutfitCount={data.savedOutfits.length}
                rankedCount={data.rankedCombinations.length}
                companionsByGarment={data.companionsByGarment}
                onSelectGarment={(g) => setInspectedGarmentId(g.id)}
                onOpenUpload={() => setUploadOpen(true)}
                onGoToCombinations={() => setActiveTab('combinations')}
              />
            )}

            {activeTab === 'combinations' && (
              <CombinationsView
                garments={data.garments}
                vectors={vectors}
                profile={data.profile}
                combinations={data.rankedCombinations}
                initialAnchorId={anchorForCombos}
                onGenerateRankings={handleGenerateRankings}
                onSaveCombination={handleSaveOutfit}
                onCustomizeInStudio={(combo) => {
                  setStudioDraft(combo);
                  setActiveTab('studio');
                }}
                onDiscussWithAdvisor={(prompt) => {
                  setAdvisorPrefill(prompt);
                  setActiveTab('advisor');
                }}
              />
            )}

            {activeTab === 'studio' && (
              <StudioView
                garments={data.garments}
                vectors={vectors}
                profile={data.profile}
                savedOutfits={data.savedOutfits}
                draftSeed={studioDraft}
                onClearDraftSeed={() => setStudioDraft(null)}
                onSaveOutfit={handleSaveOutfit}
                onCritiqueOutfit={handleCritiqueOutfit}
                onLogWear={handleLogWear}
                onDeleteOutfit={handleDeleteOutfit}
              />
            )}

            {activeTab === 'advisor' && (
              <AdvisorView
                messages={data.advisorMessages}
                garments={data.garments}
                savedOutfits={data.savedOutfits}
                profile={data.profile}
                wardrobeGaps={data.wardrobeGaps}
                prefillPrompt={advisorPrefill}
                onClearPrefill={() => setAdvisorPrefill('')}
                onSendMessage={handleSendAdvisorMessage}
                onClearHistory={handleClearAdvisorHistory}
                onInspectGarment={(g) => setInspectedGarmentId(g.id)}
              />
            )}

            {activeTab === 'profile' && (
              <ProfileView
                profile={data.profile}
                onSaveProfile={handleSaveProfile}
                onUploadPhoto={(file, currentForm) => handleUploadProfilePhoto(file, currentForm)}
                onAnalyzeBlueprint={(currentForm) =>
                  handleAnalyzeBlueprint({ profileSnapshot: currentForm })
                }
              />
            )}
          </>
        )}
      </main>

      {!isFullScreenAdvisor && (
        <footer className="hidden md:block border-t border-black/[0.06] py-6">
          <div className="max-w-[1280px] mx-auto px-8 flex items-center justify-between text-[12px] text-[#86868B]">
            <span>What do I Wear?</span>
            <span>Private Cloud Wardrobe Archive & Styling Studio</span>
          </div>
        </footer>
      )}

      <GarmentInspector
        garment={inspectedGarment}
        allGarments={data?.garments ?? []}
        companions={
          inspectedGarment ? data?.companionsByGarment[inspectedGarment.id] ?? [] : []
        }
        onClose={() => setInspectedGarmentId(null)}
        onSelectGarment={(g) => setInspectedGarmentId(g.id)}
        onUpdateGarment={handleUpdateGarment}
        onReanalyzeGarment={handleReanalyzeGarment}
        onDeleteGarment={handleDeleteGarment}
        onStyleAroundGarment={(gid) => {
          setAnchorForCombos(gid);
          setActiveTab('combinations');
        }}
      />

      <BatchUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSaveAnalyzedGarments={handleSaveAnalyzedGarments}
        onBatchComplete={handleBatchUploadComplete}
      />

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-20 md:bottom-6 right-5 z-50 px-4 py-2.5 rounded-full bg-[#1D1D1F] text-white text-[13px] font-medium shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
