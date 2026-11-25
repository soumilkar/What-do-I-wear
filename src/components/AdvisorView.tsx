import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ExternalLink, RotateCcw } from 'lucide-react';
import type { AdvisorMessage, Garment, WardrobeGap } from '../types/styling';
import { SmartImage } from './SmartImage';

interface AdvisorViewProps {
  messages: AdvisorMessage[];
  garments: Garment[];
  wardrobeGaps: WardrobeGap[];
  prefillPrompt?: string;
  onClearPrefill: () => void;
  onSendMessage: (message: string) => Promise<void>;
  onClearHistory: () => Promise<void>;
  onInspectGarment: (g: Garment) => void;
}

const TREND_PROMPTS = [
  'What 2026 quiet-luxury trends pair seamlessly with the clothes I already own?',
  'Which 3 high-ROI pieces would multiply my outfit combinations most under my budget?',
  'Audit my wardrobe color palette and tell me what color to buy next.',
];

export function AdvisorView({
  messages,
  garments,
  wardrobeGaps,
  prefillPrompt,
  onClearPrefill,
  onSendMessage,
  onClearHistory,
  onInspectGarment,
}: AdvisorViewProps) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const prevCountRef = useRef(messages.length);

  const garmentMap = new Map(garments.map((g) => [g.id, g]));

  useEffect(() => {
    if (prefillPrompt) {
      setInput(prefillPrompt);
      onClearPrefill();
    }
  }, [prefillPrompt, onClearPrefill]);

  useEffect(() => {
    if (messages.length > prevCountRef.current || sending) {
      const el = chatScrollRef.current;
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      }
    }
    prevCountRef.current = messages.length;
  }, [messages.length, sending]);

  const sendText = async (text: string) => {
    const clean = text.trim();
    if (!clean || sending) return;
    setError(null);
    setSending(true);
    setInput('');
    try {
      await onSendMessage(clean);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Advisor failed to respond.');
      setInput(clean);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-8">
      <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pt-2">
        <div className="max-w-2xl">
          <h1 className="text-[32px] sm:text-[42px] font-semibold tracking-[-0.03em] leading-[1.08] text-[#1D1D1F]">
            Shopping & Trend Advisor.
          </h1>
          <p className="mt-3 text-[16px] leading-[1.6] text-[#6E6E73]">
            Full visibility into every garment, fabric, and proportion in your studio—grounded in live fashion trends to guide smarter purchases.
          </p>
        </div>

        <button
          type="button"
          onClick={onClearHistory}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-black/[0.12] text-[13px] font-medium text-[#1D1D1F] hover:bg-black/[0.03] self-start sm:self-auto shrink-0"
        >
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
          New Thread
        </button>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Intelligence Rail: Wardrobe Gaps + Quick Prompts */}
        <aside className="lg:col-span-4 space-y-6">
          <section className="surface-card rounded-[24px] p-6 space-y-4">
            <div>
              <h2 className="text-[16px] font-semibold text-[#1D1D1F]">
                Detected Wardrobe Gaps
              </h2>
              <p className="mt-0.5 text-[12px] text-[#6E6E73]">
                Computed from your {garments.length} cataloged pieces
              </p>
            </div>

            <div className="divide-y divide-black/[0.06]">
              {wardrobeGaps.map((gap) => (
                <div key={gap.id} className="py-4 first:pt-1 last:pb-0 space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-[14px] font-semibold text-[#1D1D1F]">
                      {gap.title}
                    </h3>
                    <span className="text-[11px] font-medium text-[#6E6E73] shrink-0">
                      {gap.priority} Priority
                    </span>
                  </div>
                  <p className="text-[13px] leading-[1.55] text-[#6E6E73]">{gap.reason}</p>
                  <button
                    type="button"
                    disabled={sending}
                    onClick={() => sendText(gap.suggestedPrompt)}
                    className="text-[12px] font-medium text-[#0071E3] hover:underline disabled:opacity-40"
                  >
                    Ask advisor what to buy →
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-2.5">
            <p className="text-[12px] font-medium text-[#6E6E73] px-1">
              Curated Consultations
            </p>
            {TREND_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={sending}
                onClick={() => sendText(prompt)}
                className="w-full text-left px-4 py-3 rounded-2xl bg-white border border-black/[0.06] text-[13px] leading-[1.45] text-[#1D1D1F] hover:border-black/[0.18] transition-colors disabled:opacity-40"
              >
                {prompt}
              </button>
            ))}
          </section>
        </aside>

        {/* Right Conversation Canvas */}
        <section
          aria-label="Shopping advisor conversation"
          className="lg:col-span-8 surface-card rounded-[26px] flex flex-col h-[640px] overflow-hidden"
        >
          <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-6 sm:p-7 space-y-6">
            {messages.map((msg) => {
              const isUser = msg.role === 'user';
              const refPieces = (msg.referencedItemIds ?? [])
                .map((id) => garmentMap.get(id))
                .filter((g): g is Garment => Boolean(g));

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-5 py-3.5 text-[14px] leading-[1.65] whitespace-pre-wrap ${
                      isUser
                        ? 'bg-[#1D1D1F] text-white'
                        : 'bg-[#F5F5F7] text-[#1D1D1F]'
                    }`}
                  >
                    {msg.content}
                  </div>

                  {/* Referenced Owned Garments */}
                  {!isUser && refPieces.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-2 max-w-[88%]">
                      {refPieces.map((piece) => (
                        <button
                          key={piece.id}
                          type="button"
                          onClick={() => onInspectGarment(piece)}
                          className="inline-flex items-center gap-2 pr-3 pl-1.5 py-1 rounded-xl bg-white border border-black/[0.08] hover:border-black/[0.2] transition-colors"
                        >
                          <div className="w-6 h-7 rounded-md overflow-hidden bg-[#EFEFF2] shrink-0">
                            <SmartImage
                              src={piece.imageUrl}
                              alt={piece.name}
                              swatchHex={piece.colorHex}
                            />
                          </div>
                          <span className="text-[12px] font-medium text-[#1D1D1F]">
                            {piece.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Grounded Web Trend Sources */}
                  {!isUser && msg.sources && msg.sources.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[#6E6E73] max-w-[88%]">
                      <span>Sources:</span>
                      {msg.sources.map((src) => (
                        <a
                          key={src.uri}
                          href={src.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[#0071E3] hover:underline truncate max-w-[240px]"
                        >
                          <span className="truncate">{src.title}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {sending && (
              <div className="flex items-start">
                <div className="rounded-2xl bg-[#F5F5F7] px-5 py-3.5 text-[14px] text-[#6E6E73]">
                  Reviewing your wardrobe & current trends...
                </div>
              </div>
            )}
          </div>

          {error && (
            <div
              role="alert"
              className="mx-6 mb-2 px-4 py-2.5 rounded-xl bg-[#FFF2F2] border border-[#D70015]/20 text-[13px] text-[#B00012]"
            >
              {error}
            </div>
          )}

          {/* Input Composer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendText(input);
            }}
            className="p-4 border-t border-black/[0.06] bg-white flex items-center gap-3"
          >
            <label htmlFor="advisor-input" className="sr-only">
              Message your shopping advisor
            </label>
            <input
              id="advisor-input"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about trends, what to buy next, or whether an item fits your closet..."
              className="flex-1 px-4 py-3 rounded-full bg-[#F5F5F7] text-[14px] text-[#1D1D1F] placeholder:text-[#86868B] focus:outline-none focus:ring-2 focus:ring-[#0071E3]"
            />
            <button
              type="submit"
              disabled={!input.trim() || sending}
              aria-label="Send message to shopping advisor"
              className="w-11 h-11 rounded-full bg-[#1D1D1F] text-white flex items-center justify-center shrink-0 hover:bg-[#3A3A3C] disabled:opacity-35 transition-colors"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
