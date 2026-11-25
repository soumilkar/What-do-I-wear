import { useState } from 'react';
import { Layers, ShieldCheck, Sparkles } from 'lucide-react';
import { signInWithGoogle } from '../lib/firebase';

const PREVIEW_CARDS = [
  {
    src: '/src/assets/images/garment_camel_overcoat_1795548620677.jpg',
    label: 'Camel Wool Overcoat',
    meta: 'Heavyweight · Structured',
  },
  {
    src: '/src/assets/images/garment_ivory_sweater_1795548634934.jpg',
    label: 'Ivory Merino Crewneck',
    meta: 'Fine-gauge · Relaxed',
  },
  {
    src: '/src/assets/images/garment_charcoal_trousers_1795548618728.jpg',
    label: 'Charcoal Wool Trousers',
    meta: 'Worsted · High-rise',
  },
];

export function AuthScreen() {
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setError(null);
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      if (code === 'auth/popup-closed-by-user') {
        setError('Sign-in was canceled. Click below whenever you are ready.');
      } else if (code === 'auth/popup-blocked') {
        setError('Your browser blocked the sign-in popup. Please allow popups and try again.');
      } else {
        setError(err instanceof Error ? err.message : 'Unable to sign in right now.');
      }
      setSigningIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F7] text-[#1D1D1F] flex flex-col">
      <header className="h-16 max-w-[1280px] w-full mx-auto px-6 sm:px-8 flex items-center justify-between">
        <span className="font-display text-[17px] font-semibold tracking-[-0.025em]">
          What do I Wear?
        </span>
        <button
          type="button"
          disabled={signingIn}
          onClick={() => void handleGoogleSignIn()}
          className="px-4 py-2 rounded-full bg-[#1D1D1F] text-white text-[13px] font-medium hover:bg-[#3A3A3C] disabled:opacity-50 transition-colors"
        >
          {signingIn ? 'Signing in...' : 'Sign In'}
        </button>
      </header>

      <main className="flex-1 max-w-[1200px] w-full mx-auto px-6 sm:px-8 py-10 lg:py-16 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
        {/* Left editorial copy & Google Auth CTA */}
        <div className="lg:col-span-6 space-y-7">
          <div className="space-y-4">
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6E6E73]">
              Personal AI Wardrobe Studio
            </p>
            <h1 className="font-display text-[42px] sm:text-[54px] font-semibold leading-[1.04] tracking-[-0.035em] text-[#1D1D1F]">
              Your closet in the cloud. Styled to perfection.
            </h1>
            <p className="text-[16px] sm:text-[17px] leading-relaxed text-[#6E6E73] max-w-[490px]">
              Upload up to 50 garments at once. Every fabric, fit, and image vector is saved privately to your account so you get ranked combinations and shopping advice anywhere.
            </p>
          </div>

          <div className="space-y-3 max-w-[380px]">
            <button
              type="button"
              disabled={signingIn}
              onClick={() => void handleGoogleSignIn()}
              className="w-full flex items-center justify-center gap-3 px-6 py-3.5 rounded-full bg-[#1D1D1F] text-white text-[15px] font-medium hover:bg-[#3A3A3C] active:scale-[0.99] disabled:opacity-50 transition-all shadow-sm"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#FFFFFF"
                  d="M21.35 11.1h-9.18v2.98h5.27c-.23 1.48-1.69 4.35-5.27 4.35-3.17 0-5.76-2.63-5.76-5.87s2.59-5.87 5.76-5.87c1.81 0 3.02.77 3.71 1.43l2.53-2.45C16.79 4.16 14.68 3.2 12.17 3.2 7.21 3.2 3.2 7.22 3.2 12.18s4.01 8.98 8.97 8.98c5.18 0 8.61-3.64 8.61-8.77 0-.59-.06-1.04-.14-1.29z"
                />
              </svg>
              {signingIn ? 'Opening Google Sign-In...' : 'Continue with Google'}
            </button>

            {error && (
              <div
                role="alert"
                className="px-4 py-3 rounded-2xl bg-[#FFF2F2] border border-[#D70015]/20 text-[13px] text-[#B00012]"
              >
                {error}
              </div>
            )}

            <p className="text-[12px] text-[#86868B] pl-1">
              Sign in or create your account in one step. Your wardrobe stays strictly private to your login.
            </p>
          </div>

          <div className="pt-4 border-t border-black/[0.07] grid grid-cols-1 sm:grid-cols-3 gap-5">
            <div className="space-y-1.5">
              <Layers className="w-4 h-4 text-[#1D1D1F]" aria-hidden="true" />
              <p className="text-[13px] font-semibold text-[#1D1D1F]">Cloud Synced</p>
              <p className="text-[12px] text-[#6E6E73] leading-relaxed">
                Clothes, vectors, and lookbooks persist across every device.
              </p>
            </div>
            <div className="space-y-1.5">
              <Sparkles className="w-4 h-4 text-[#1D1D1F]" aria-hidden="true" />
              <p className="text-[13px] font-semibold text-[#1D1D1F]">Ranked Styling</p>
              <p className="text-[12px] text-[#6E6E73] leading-relaxed">
                Accurate outfit scores tailored to your portrait and body profile.
              </p>
            </div>
            <div className="space-y-1.5">
              <ShieldCheck className="w-4 h-4 text-[#1D1D1F]" aria-hidden="true" />
              <p className="text-[13px] font-semibold text-[#1D1D1F]">Private Archive</p>
              <p className="text-[12px] text-[#6E6E73] leading-relaxed">
                Locked strictly to your verified Google account.
              </p>
            </div>
          </div>
        </div>

        {/* Right visual editorial showcase */}
        <div className="lg:col-span-6">
          <div className="grid grid-cols-3 gap-4 items-end">
            {PREVIEW_CARDS.map((card, idx) => (
              <div
                key={card.label}
                className={`surface-card rounded-[24px] overflow-hidden ${
                  idx === 1 ? 'lg:-translate-y-5' : ''
                }`}
              >
                <div className="aspect-[3/4] bg-[#ECECE6] overflow-hidden">
                  <img
                    src={card.src}
                    alt={card.label}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-3.5">
                  <p className="text-[12px] font-semibold text-[#1D1D1F] truncate">
                    {card.label}
                  </p>
                  <p className="text-[11px] text-[#6E6E73] truncate mt-0.5">{card.meta}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
