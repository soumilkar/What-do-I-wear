import { LogOut, Plus } from 'lucide-react';

export type AppTab = 'wardrobe' | 'combinations' | 'studio' | 'advisor' | 'profile';

interface TopNavProps {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  onOpenUpload: () => void;
  userEmail?: string | null;
  userName?: string | null;
  userPhotoUrl?: string | null;
  onSignOut: () => void;
}

const NAV_ITEMS: Array<{ id: AppTab; label: string }> = [
  { id: 'wardrobe', label: 'Wardrobe' },
  { id: 'combinations', label: 'Combinations' },
  { id: 'studio', label: 'Studio' },
  { id: 'advisor', label: 'Advisor' },
  { id: 'profile', label: 'Profile' },
];

export function TopNav({
  activeTab,
  onSelectTab,
  onOpenUpload,
  userEmail,
  userName,
  userPhotoUrl,
  onSignOut,
}: TopNavProps) {
  const initial = (userName || userEmail || 'U').trim().charAt(0).toUpperCase();

  return (
    <>
      <header className="sticky top-0 z-40 apple-glass border-b border-black/[0.06]">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-6">
          {/* Zone 1: Single clean wordmark */}
          <button
            type="button"
            onClick={() => onSelectTab('wardrobe')}
            className="font-display text-[17px] font-semibold tracking-[-0.025em] text-[#1D1D1F] whitespace-nowrap shrink-0 hover:opacity-75 transition-opacity"
          >
            What do I Wear?
          </button>

          {/* Zone 2: 5 concise single-line text navigation links */}
          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-7"
          >
            {NAV_ITEMS.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectTab(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`relative py-5 text-[14px] font-medium whitespace-nowrap shrink-0 transition-colors ${
                    isActive
                      ? 'text-[#1D1D1F]'
                      : 'text-[#6E6E73] hover:text-[#1D1D1F]'
                  }`}
                >
                  {item.label}
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#1D1D1F] rounded-full"
                    />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Primary action + clean account controls */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onOpenUpload}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#1D1D1F] text-white text-[13px] font-medium whitespace-nowrap shrink-0 hover:bg-[#3A3A3C] active:scale-[0.98] transition-all"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              Add Clothes
            </button>

            <button
              type="button"
              onClick={() => onSelectTab('profile')}
              title={userName || userEmail || 'Account'}
              aria-label="Open personal style profile"
              className="hidden sm:flex w-8 h-8 rounded-full overflow-hidden bg-black/[0.07] items-center justify-center text-[12px] font-semibold text-[#1D1D1F] hover:ring-2 hover:ring-black/15 transition-all shrink-0"
            >
              {userPhotoUrl ? (
                <img
                  src={userPhotoUrl}
                  alt={userName || 'Account avatar'}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              ) : (
                initial
              )}
            </button>

            <button
              type="button"
              onClick={onSignOut}
              title="Sign out"
              aria-label="Sign out"
              className="w-8 h-8 rounded-full bg-black/[0.04] hover:bg-black/[0.09] flex items-center justify-center text-[#6E6E73] hover:text-[#1D1D1F] transition-colors shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile bottom tab bar — compact height */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 apple-glass border-t border-black/[0.08] px-2 py-1.5 flex items-center justify-around"
      >
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`min-h-[40px] px-2.5 text-[12px] font-medium whitespace-nowrap transition-colors ${
                isActive ? 'text-[#1D1D1F] font-semibold' : 'text-[#6E6E73]'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </>
  );
}
