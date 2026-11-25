import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let friendly = 'Something interrupted your cloud wardrobe session. Please try reloading.';
    try {
      const parsed = JSON.parse(error.message) as { error?: string };
      if (parsed?.error) {
        if (parsed.error.toLowerCase().includes('quota exceeded')) {
          friendly =
            'Daily cloud database quota has been reached. Quota resets tomorrow, or you can upgrade your Firebase plan.';
        } else if (parsed.error.toLowerCase().includes('permission')) {
          friendly =
            'Your session permissions could not be verified. Please sign out and sign back in with Google.';
        }
      }
    } catch {
      if (error.message && error.message.length < 180) {
        friendly = error.message;
      }
    }
    return { hasError: true, message: friendly };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Application ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F5F5F7] text-[#1D1D1F] flex items-center justify-center p-6">
          <div className="surface-card rounded-[28px] p-10 max-w-md w-full text-center space-y-5">
            <h1 className="font-display text-[24px] font-semibold tracking-[-0.025em]">
              What do I Wear?
            </h1>
            <p className="text-[14px] leading-relaxed text-[#6E6E73]">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-6 py-2.5 rounded-full bg-[#1D1D1F] text-white text-[13px] font-medium hover:bg-[#3A3A3C] transition-colors"
            >
              Reload Studio
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
