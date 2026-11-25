/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { onAuthStateChanged, type User } from 'firebase/auth';
import { useCallback, useEffect, useState } from 'react';
import { AdvisorView } from './components/AdvisorView';
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
  subscribeUserWorkspace,
  updateGarmentInCloud,
  updateProfileBlueprintInCloud,
  updateProfileInCloud,
  updateProfilePhotoInCloud,
} from './lib/cloudWardrobe';
import { auth, signOutUser } from './lib/firebase';
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

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const text = await res.text();
  let parsed: (T & { error?: string }) | null = null;
  try {
    parsed = JSON.parse(text) as T & { error?: string };
  } catch {
    throw new Error(`Server returned an unexpected response (${res.status}).`);
  }
  if (!res.ok) {
    throw new Error(parsed?.error || `Request failed (${res.status})`);
  }
  return parsed;
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

  // Propagate fatal Firestore permission/quota errors cleanly to ErrorBoundary
  if (syncError) {
    throw syncError;
  }

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 3200);
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) {
        setWorkspace(null);
        setInspectedGarmentId(null);
        setUploadOpen(false);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!authReady || !user) return;
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
  }, [authReady, user]);

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

  const data = workspace?.bootstrap ?? null;
  const vectors = workspace?.vectors ?? {};

  const inspectedGarment: Garment | null =
    data?.garments.find((g) => g.id === inspectedGarmentId) ?? null;

  const handleSaveAnalyzedGarments = async (entries: AnalyzedCloudGarmentEntry[]) => {
    await addGarmentsToCloud(user.uid, entries);
    setActiveTab('wardrobe');
    showToast(
      `Saved ${entries.length} new ${entries.length === 1 ? 'piece' : 'pieces'} to your cloud wardrobe.`
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
  }) => {
    if (!data) return;
    const res = await apiJson<{ combinations: OutfitCombination[]; modelUsed: string }>(
      '/api/ai/rank-combinations',
      {
        method: 'POST',
        body: JSON.stringify({
          garments: data.garments,
          vectors,
          profile: data.profile,
          ...opts,
        }),
      }
    );

    await replaceRankedCombinationsInCloud(
      user.uid,
      data.rankedCombinations.map((c) => c.id),
      res.combinations
    );
    showToast('Ranked fresh personalized combinations.');
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
    return apiJson<{
      score: number;
      rationale: string;
      fabricFitNotes: string;
      bodyTailoringNote: string;
      finishingTouch: string;
      modelUsed: string;
    }>('/api/ai/critique-outfit', {
      method: 'POST',
      body: JSON.stringify({ items, profile: data.profile, occasion }),
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

  const handleUploadProfilePhoto = async (file: File) => {
    const compressed = await compressImageToDataUrl(file, 560, 185_000);
    await updateProfilePhotoInCloud(user.uid, compressed.dataUrl);
    showToast('Portrait synced to cloud.');
  };

  const handleAnalyzeBlueprint = async () => {
    if (!data) return;
    let photoBase64: string | null = null;
    let photoMimeType: string | null = null;
    if (data.profile.photoUrl.startsWith('data:')) {
      const m = data.profile.photoUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (m) {
        photoMimeType = m[1];
        photoBase64 = m[2];
      }
    }

    const res = await apiJson<{ blueprint: AIProfileBlueprint; modelUsed: string }>(
      '/api/ai/analyze-profile',
      {
        method: 'POST',
        body: JSON.stringify({
          profile: data.profile,
          photoBase64,
          photoMimeType,
        }),
      }
    );

    await updateProfileBlueprintInCloud(user.uid, res.blueprint);
    showToast('Personal Styling Blueprint saved to cloud.');
  };

  const handleSendAdvisorMessage = async (message: string) => {
    if (!data) return;
    const reply = await apiJson<{
      content: string;
      referencedItemIds?: string[];
      sources?: GroundingSource[];
      modelUsed?: string;
    }>('/api/ai/advisor-chat', {
      method: 'POST',
      body: JSON.stringify({
        message,
        history: data.advisorMessages,
        garments: data.garments,
        savedOutfits: data.savedOutfits,
        profile: data.profile,
      }),
    });

    await addAdvisorTurnToCloud(user.uid, message, reply);
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

  return (
    <div className="min-h-screen flex flex-col bg-[#F5F5F7] text-[#1D1D1F]">
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

      <main className="flex-1 max-w-[1280px] w-full mx-auto px-5 sm:px-8 pt-8 pb-24 md:pb-16">
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
                onUploadPhoto={handleUploadProfilePhoto}
                onAnalyzeBlueprint={handleAnalyzeBlueprint}
              />
            )}
          </>
        )}
      </main>

      <footer className="hidden md:block border-t border-black/[0.06] py-6">
        <div className="max-w-[1280px] mx-auto px-8 flex items-center justify-between text-[12px] text-[#86868B]">
          <span>What do I Wear?</span>
          <span>Private Cloud Wardrobe Archive & Styling Studio</span>
        </div>
      </footer>

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
