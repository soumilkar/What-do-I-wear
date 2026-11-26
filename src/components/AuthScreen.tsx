import { useState } from 'react';
import { Eye, EyeOff, Layers, Lock, Mail, ShieldCheck, Sparkles, User } from 'lucide-react';
import {
  resetPasswordWithEmail,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
} from '../lib/firebase';

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

type AuthMode = 'signin' | 'signup' | 'reset';

function mapAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/popup-closed-by-user':
      return 'Google sign-in was canceled. Try again whenever you are ready.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in popup. Please allow popups and try again.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password. Double-check your credentials or reset your password.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Switch to Sign In instead.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters long.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a moment and try again.';
    case 'auth/operation-not-allowed':
      return 'Email/Password sign-in is not yet enabled in Firebase Console (Authentication → Sign-in method → Email/Password → Enable).';
    default:
      return err instanceof Error ? err.message : 'Unable to authenticate right now.';
  }
}

export function AuthScreen() {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const busy = submitting || googleLoading;

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError(null);
    setNotice(null);
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setNotice(null);
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(mapAuthError(err));
      setGoogleLoading(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Enter your email address.');
      return;
    }

    if (mode === 'reset') {
      setSubmitting(true);
      try {
        await resetPasswordWithEmail(trimmedEmail);
        setNotice(
          `Password reset link sent to ${trimmedEmail}. Check your inbox (and spam folder) to set a new password.`
        );
      } catch (err) {
        setError(mapAuthError(err));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'signup') {
        await signUpWithEmail(trimmedEmail, password, fullName);
      } else {
        await signInWithEmail(trimmedEmail, password);
      }
    } catch (err) {
      setError(mapAuthError(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F7] text-[#1D1D1F] flex flex-col">
      <header className="h-16 max-w-[1280px] w-full mx-auto px-6 sm:px-8 flex items-center justify-between">
        <span className="font-display text-[17px] font-semibold tracking-[-0.025em]">
          What do I Wear?
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => switchMode(mode === 'signup' ? 'signin' : 'signup')}
            className="px-3.5 py-2 rounded-full text-[13px] font-medium text-[#1D1D1F] hover:bg-black/[0.05] disabled:opacity-50 transition-colors"
          >
            {mode === 'signup' ? 'Sign In' : 'Create Account'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleGoogleSignIn()}
            className="px-4 py-2 rounded-full bg-[#1D1D1F] text-white text-[13px] font-medium hover:bg-[#3A3A3C] disabled:opacity-50 transition-colors"
          >
            {googleLoading ? 'Signing in...' : 'Google Sign In'}
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-[1200px] w-full mx-auto px-6 sm:px-8 py-4 lg:py-6 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
        {/* Left editorial copy & Auth Card */}
        <div className="lg:col-span-6 space-y-4">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6E6E73]">
              Personal AI Wardrobe Studio
            </p>
            <h1 className="font-display text-[34px] sm:text-[42px] font-semibold leading-[1.06] tracking-[-0.035em] text-[#1D1D1F]">
              Your closet in the cloud. Styled to perfection.
            </h1>
            <p className="text-[14.5px] leading-relaxed text-[#6E6E73] max-w-[490px]">
              Upload your wardrobe and portrait once. Get season-accurate layered outfits, OKLCH color matching, and shopping advice personalized to what actually looks best on you.
            </p>
          </div>

          {/* Auth Card: Email & Password + Google */}
          <div className="surface-card rounded-[22px] p-5 space-y-3.5 max-w-[440px]">
            {/* Mode Switcher */}
            {mode !== 'reset' ? (
              <div
                role="tablist"
                aria-label="Authentication mode"
                className="grid grid-cols-2 p-1 rounded-xl bg-[#F5F5F7] border border-black/[0.06]"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'signin'}
                  onClick={() => switchMode('signin')}
                  className={`py-2 rounded-lg text-[13px] font-medium transition-all ${
                    mode === 'signin'
                      ? 'bg-white text-[#1D1D1F] shadow-xs'
                      : 'text-[#6E6E73] hover:text-[#1D1D1F]'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'signup'}
                  onClick={() => switchMode('signup')}
                  className={`py-2 rounded-lg text-[13px] font-medium transition-all ${
                    mode === 'signup'
                      ? 'bg-white text-[#1D1D1F] shadow-xs'
                      : 'text-[#6E6E73] hover:text-[#1D1D1F]'
                  }`}
                >
                  Create Account
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <h2 className="text-[16px] font-semibold text-[#1D1D1F]">Reset Password</h2>
                <button
                  type="button"
                  onClick={() => switchMode('signin')}
                  className="text-[12px] font-medium text-[#0071E3] hover:underline"
                >
                  Back to Sign In
                </button>
              </div>
            )}

            <form onSubmit={handleEmailSubmit} className="space-y-3.5" noValidate>
              {mode === 'signup' && (
                <div>
                  <label htmlFor="auth-name" className="block text-[12px] font-medium text-[#6E6E73] mb-1">
                    Full Name
                  </label>
                  <div className="relative">
                    <User
                      className="w-4 h-4 text-[#86868B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      id="auth-name"
                      type="text"
                      autoComplete="name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Alex Rivera"
                      className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[#F5F5F7] border border-black/[0.08] text-[14px] text-[#1D1D1F] placeholder:text-[#86868B] focus:outline-none focus:ring-2 focus:ring-[#0071E3]"
                    />
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="auth-email" className="block text-[12px] font-medium text-[#6E6E73] mb-1">
                  Email Address
                </label>
                <div className="relative">
                  <Mail
                    className="w-4 h-4 text-[#86868B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    id="auth-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[#F5F5F7] border border-black/[0.08] text-[14px] text-[#1D1D1F] placeholder:text-[#86868B] focus:outline-none focus:ring-2 focus:ring-[#0071E3]"
                  />
                </div>
              </div>

              {mode !== 'reset' && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor="auth-password" className="text-[12px] font-medium text-[#6E6E73]">
                      Password
                    </label>
                    {mode === 'signin' && (
                      <button
                        type="button"
                        onClick={() => switchMode('reset')}
                        className="text-[12px] font-medium text-[#0071E3] hover:underline"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Lock
                      className="w-4 h-4 text-[#86868B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      id="auth-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={mode === 'signup' ? 'Create a password (min 6 chars)' : 'Enter your password'}
                      className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-[#F5F5F7] border border-black/[0.08] text-[14px] text-[#1D1D1F] placeholder:text-[#86868B] focus:outline-none focus:ring-2 focus:ring-[#0071E3]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#86868B] hover:text-[#1D1D1F]"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="px-3.5 py-2.5 rounded-xl bg-[#FFF2F2] border border-[#D70015]/20 text-[13px] text-[#B00012]"
                >
                  {error}
                </div>
              )}

              {notice && (
                <div
                  role="status"
                  className="px-3.5 py-2.5 rounded-xl bg-[#F0FDF4] border border-[#16A34A]/20 text-[13px] text-[#166534]"
                >
                  {notice}
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full py-3 rounded-full bg-[#1D1D1F] text-white text-[14px] font-medium hover:bg-[#3A3A3C] active:scale-[0.99] disabled:opacity-50 transition-all shadow-xs"
              >
                {submitting
                  ? mode === 'signup'
                    ? 'Creating Account...'
                    : mode === 'reset'
                      ? 'Sending Reset Link...'
                      : 'Signing In...'
                  : mode === 'signup'
                    ? 'Create Account with Email'
                    : mode === 'reset'
                      ? 'Send Password Reset Email'
                      : 'Sign In with Email'}
              </button>
            </form>

            {mode !== 'reset' && (
              <>
                <div className="relative flex items-center py-0.5">
                  <div className="flex-1 border-t border-black/[0.08]" />
                  <span className="px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-[#86868B]">
                    or
                  </span>
                  <div className="flex-1 border-t border-black/[0.08]" />
                </div>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleGoogleSignIn()}
                  className="w-full flex items-center justify-center gap-2.5 px-5 py-2.5 rounded-full bg-white border border-black/[0.12] text-[#1D1D1F] text-[14px] font-medium hover:bg-[#F5F5F7] active:scale-[0.99] disabled:opacity-50 transition-all"
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#4285F4"
                      d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
                    />
                  </svg>
                  {googleLoading ? 'Opening Google Sign-In...' : 'Continue with Google'}
                </button>
              </>
            )}

            <p className="text-[11.5px] text-[#86868B] text-center">
              Your wardrobe, portrait analysis, and lookbooks stay strictly private to your verified account.
            </p>
          </div>

          <div className="pt-3 border-t border-black/[0.07] grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Layers className="w-4 h-4 text-[#1D1D1F]" aria-hidden="true" />
              <p className="text-[12.5px] font-semibold text-[#1D1D1F]">Real Layering</p>
              <p className="text-[11.5px] text-[#6E6E73] leading-snug">
                Base shirts under knits, seasonal guards, and complete stacks.
              </p>
            </div>
            <div className="space-y-1">
              <Sparkles className="w-4 h-4 text-[#1D1D1F]" aria-hidden="true" />
              <p className="text-[12.5px] font-semibold text-[#1D1D1F]">Portrait Personalization</p>
              <p className="text-[11.5px] text-[#6E6E73] leading-snug">
                Your photo and 12-season palette power every outfit and tip.
              </p>
            </div>
            <div className="space-y-1">
              <ShieldCheck className="w-4 h-4 text-[#1D1D1F]" aria-hidden="true" />
              <p className="text-[12.5px] font-semibold text-[#1D1D1F]">Private Cloud Sync</p>
              <p className="text-[11.5px] text-[#6E6E73] leading-snug">
                Sign in with Email &amp; Password or Google on any device.
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
