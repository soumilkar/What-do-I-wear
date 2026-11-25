/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { AdvisorView } from './components/AdvisorView';
import { BatchUploadModal } from './components/BatchUploadModal';
import { CombinationsView } from './components/CombinationsView';
import { GarmentInspector } from './components/GarmentInspector';
import { ProfileView } from './components/ProfileView';
import { StudioView } from './components/StudioView';
import { AppTab, TopNav } from './components/TopNav';
import { WardrobeView } from './components/WardrobeView';
import type {
  AppBootstrapData,
  Garment,
  OccasionType,
  OutfitCombination,
  SeasonTag,
  UserProfile,
} from './types/styling';

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export default function App() {
  const [data, setData] = useState<AppBootstrapData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>('wardrobe');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [inspectedGarmentId, setInspectedGarmentId] = useState<string | null>(null);
  const [anchorForCombos, setAnchorForCombos] = useState<string>('');
  const [studioDraft, setStudioDraft] = useState<OutfitCombination | null>(null);
  const [advisorPrefill, setAdvisorPrefill] = useState<string>('');
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 3200);
  }, []);

  const loadBootstrap = useCallback(async () => {
    try {
      const payload = await apiJson<AppBootstrapData>('/api/bootstrap');
      setData(payload);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unable to load studio data.');
    }
  }, []);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  const inspectedGarment: Garment | null =
    data?.garments.find((g) => g.id === inspectedGarmentId) ?? null;

  const handleUpdateGarment = async (id: string, patch: Partial<Garment>) => {
    const res = await apiJson<{ bootstrap: AppBootstrapData }>(`/api/wardrobe/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    setData(res.bootstrap);
    showToast('Garment details updated.');
  };

  const handleReanalyzeGarment = async (id: string) => {
    try {
      const res = await apiJson<{ bootstrap: AppBootstrapData }>(
        `/api/wardrobe/${id}/reanalyze`,
        { method: 'POST' }
      );
      setData(res.bootstrap);
      showToast('Re-inspected garment and refreshed server image vector.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Re-analysis failed.');
    }
  };

  const handleDeleteGarment = async (id: string) => {
    const res = await apiJson<{ bootstrap: AppBootstrapData }>(`/api/wardrobe/${id}`, {
      method: 'DELETE',
    });
    setData(res.bootstrap);
    showToast('Removed garment from wardrobe.');
  };

  const handleGenerateRankings = async (opts: {
    occasion: OccasionType;
    season: SeasonTag;
    anchorItemId?: string;
  }) => {
    const res = await apiJson<{ bootstrap: AppBootstrapData }>('/api/combinations/rank', {
      method: 'POST',
      body: JSON.stringify(opts),
    });
    setData(res.bootstrap);
    showToast('Ranked fresh personalized combinations.');
  };

  const handleSaveOutfit = async (payload: Partial<OutfitCombination>) => {
    const res = await apiJson<{ bootstrap: AppBootstrapData }>('/api/outfits', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setData(res.bootstrap);
    showToast('Saved to your Lookbook.');
  };

  const handleCritiqueOutfit = async (itemIds: string[], occasion: OccasionType) => {
    return apiJson<{
      score: number;
      rationale: string;
      fabricFitNotes: string;
      bodyTailoringNote: string;
      finishingTouch: string;
      modelUsed: string;
    }>('/api/outfits/critique', {
      method: 'POST',
      body: JSON.stringify({ itemIds, occasion }),
    });
  };

  const handleLogWear = async (outfitId: string) => {
    const res = await apiJson<{ bootstrap: AppBootstrapData }>(
      `/api/outfits/${outfitId}/wear`,
      { method: 'POST' }
    );
    setData(res.bootstrap);
    showToast('Logged as worn today.');
  };

  const handleDeleteOutfit = async (outfitId: string) => {
    const res = await apiJson<{ bootstrap: AppBootstrapData }>(
      `/api/outfits/${outfitId}`,
      { method: 'DELETE' }
    );
    setData(res.bootstrap);
    showToast('Removed from Lookbook.');
  };

  const handleSaveProfile = async (patch: Partial<UserProfile>) => {
    const res = await apiJson<{ bootstrap: AppBootstrapData }>('/api/profile', {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
    setData(res.bootstrap);
  };

  const handleUploadProfilePhoto = async (file: File) => {
    const formData = new FormData();
    formData.append('photo', file);
    const res = await fetch('/api/profile/photo', {
      method: 'POST',
      body: formData,
    });
    const json = (await res.json()) as { bootstrap?: AppBootstrapData; error?: string };
    if (!res.ok || !json.bootstrap) {
      throw new Error(json.error || 'Failed to upload portrait.');
    }
    setData(json.bootstrap);
    showToast('Portrait updated.');
  };

  const handleAnalyzeBlueprint = async () => {
    const res = await apiJson<{ bootstrap: AppBootstrapData }>('/api/profile/analyze', {
      method: 'POST',
    });
    setData(res.bootstrap);
    showToast('Personal Styling Blueprint updated.');
  };

  const handleSendAdvisorMessage = async (message: string) => {
    const res = await apiJson<{ bootstrap: AppBootstrapData }>('/api/advisor/chat', {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
    setData(res.bootstrap);
  };

  const handleClearAdvisorHistory = async () => {
    const res = await apiJson<{ bootstrap: AppBootstrapData }>('/api/advisor/history', {
      method: 'DELETE',
    });
    setData(res.bootstrap);
    showToast('Started a fresh advisor thread.');
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
      />

      <main className="flex-1 max-w-[1280px] w-full mx-auto px-5 sm:px-8 pt-8 pb-24 md:pb-16">
        {loadError ? (
          <div className="surface-card rounded-3xl p-10 max-w-lg mx-auto text-center space-y-4">
            <h1 className="text-[22px] font-semibold">Unable to connect to styling server</h1>
            <p className="text-[14px] text-[#6E6E73]">{loadError}</p>
            <button
              type="button"
              onClick={() => void loadBootstrap()}
              className="px-5 py-2.5 rounded-full bg-[#1D1D1F] text-white text-[13px] font-medium"
            >
              Retry
            </button>
          </div>
        ) : !data ? (
          <div className="space-y-8 animate-pulse" aria-busy="true" aria-label="Loading wardrobe">
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
          <span>Personal Wardrobe Archive & Styling Studio</span>
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
        onUploadComplete={(bootstrap, count) => {
          setData(bootstrap);
          setActiveTab('wardrobe');
          showToast(
            `Indexed ${count} new ${count === 1 ? 'piece' : 'pieces'} with image vectors.`
          );
        }}
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
