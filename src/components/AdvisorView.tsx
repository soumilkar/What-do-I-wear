import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  ExternalLink,
  ImagePlus,
  PanelLeft,
  RotateCcw,
  Shirt,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  AdvisorMessage,
  Garment,
  OutfitCombination,
  UserProfile,
  WardrobeGap,
} from '../types/styling';
import { compressImageToDataUrl } from '../utils/imageCompress';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  classifyTopLayerRole,
  computeWardrobeIntelligenceSummary,
} from '../utils/styleEngine';
import { AdvisorMessageContent } from './AdvisorMessageContent';
import { SmartImage } from './SmartImage';

export interface AdvisorAttachedImage {
  id: string;
  dataUrl: string;
  base64: string;
  mimeType: string;
  label: string;
}

interface AdvisorViewProps {
  messages: AdvisorMessage[];
  garments: Garment[];
  savedOutfits: OutfitCombination[];
  profile: UserProfile;
  wardrobeGaps: WardrobeGap[];
  prefillPrompt?: string;
  onClearPrefill: () => void;
  onSendMessage: (message: string, images?: AdvisorAttachedImage[]) => Promise<void>;
  onClearHistory: () => Promise<void>;
  onInspectGarment: (g: Garment) => void;
}

const MAX_ADVISOR_IMAGES = 4;

const CONSULTATION_STARTERS = [
  {
    label: 'Outfit Multiplier Buy',
    prompt:
      'Which 2 high-ROI pieces under my budget would unlock the highest number of new outfits with my existing wardrobe and color season?',
  },
  {
    label: '2026 Trends for Me',
    prompt:
      'Which current 2026 fashion trends genuinely flatter my color season, proportions, and closet—and which trends should I skip?',
  },
  {
    label: 'Wardrobe Color Audit',
    prompt:
      'Audit my wardrobe color balance against my personal palette and tell me which exact shade and fabric I should buy next.',
  },
];

export function AdvisorView({
  messages,
  garments,
  savedOutfits,
  profile,
  wardrobeGaps,
  prefillPrompt,
  onClearPrefill,
  onSendMessage,
  onClearHistory,
  onInspectGarment,
}: AdvisorViewProps) {
  const [input, setInput] = useState('');
  const [attachedImages, setAttachedImages] = useState<AdvisorAttachedImage[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewGarment, setPreviewGarment] = useState<Garment | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const prevCountRef = useRef(messages.length);

  const garmentMap = useMemo(() => new Map(garments.map((g) => [g.id, g])), [garments]);
  const dna = useMemo(
    () => computeWardrobeIntelligenceSummary(garments, savedOutfits, profile),
    [garments, savedOutfits, profile]
  );

  const filteredMentionGarments = useMemo(() => {
    const q = mentionQuery.trim().toLowerCase();
    if (!q) return garments.slice(0, 120);
    return garments
      .filter(
        (g) =>
          g.name.toLowerCase().includes(q) ||
          g.primaryColor.toLowerCase().includes(q) ||
          g.category.toLowerCase().includes(q) ||
          g.subCategory.toLowerCase().includes(q)
      )
      .slice(0, 120);
  }, [garments, mentionQuery]);

  useEffect(() => {
    if (!previewGarment && !sidebarOpen && !mentionPickerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (previewGarment) setPreviewGarment(null);
        else if (mentionPickerOpen) setMentionPickerOpen(false);
        else if (sidebarOpen) setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewGarment, sidebarOpen, mentionPickerOpen]);

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

  const handleAddFiles = async (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;
    setError(null);

    const remainingSlots = MAX_ADVISOR_IMAGES - attachedImages.length;
    if (remainingSlots <= 0) {
      setError(`You can attach up to ${MAX_ADVISOR_IMAGES} item photos per message to compare.`);
      return;
    }

    const selected = incoming.slice(0, remainingSlots);
    const validFiles = selected.filter((f) =>
      ALLOWED_IMAGE_MIME_TYPES.has((f.type || '').toLowerCase())
    );
    if (validFiles.length === 0) {
      setError('Please upload JPEG, PNG, WebP, or AVIF photos of items you are considering buying.');
      return;
    }

    setAttaching(true);
    try {
      const compressedList: AdvisorAttachedImage[] = [];
      for (let i = 0; i < validFiles.length; i++) {
        const file = validFiles[i];
        const compressed = await compressImageToDataUrl(file, 520, 115_000);
        const optionNum = attachedImages.length + compressedList.length + 1;
        compressedList.push({
          id: `${Date.now()}_${optionNum}_${Math.random().toString(36).slice(2, 7)}`,
          dataUrl: compressed.dataUrl,
          base64: compressed.base64,
          mimeType: compressed.mimeType,
          label: `Option ${optionNum}`,
        });
      }
      setAttachedImages((prev) =>
        [...prev, ...compressedList]
          .slice(0, MAX_ADVISOR_IMAGES)
          .map((item, idx) => ({ ...item, label: `Option ${idx + 1}` }))
      );
      setSidebarOpen(false);
      if (incoming.length > remainingSlots) {
        setError(
          `Added the first ${remainingSlots} photo${remainingSlots === 1 ? '' : 's'} (limit is ${MAX_ADVISOR_IMAGES} per message).`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to process the selected photo.');
    } finally {
      setAttaching(false);
    }
  };

  const removeAttachedImage = (id: string) => {
    setAttachedImages((prev) =>
      prev
        .filter((img) => img.id !== id)
        .map((item, idx) => ({ ...item, label: `Option ${idx + 1}` }))
    );
  };

  const insertGarmentMention = (garment: Garment) => {
    setInput((prev) => {
      const sep = prev.trim().length > 0 && !prev.endsWith(' ') ? ' ' : '';
      return `${prev}${sep}${garment.name}`;
    });
    setMentionPickerOpen(false);
    setMentionQuery('');
    inputRef.current?.focus();
  };

  const sendText = async (text: string, imagesToSend: AdvisorAttachedImage[] = attachedImages) => {
    const clean = text.trim();
    if ((!clean && imagesToSend.length === 0) || sending || attaching) return;

    const savedDraftText = clean;
    const savedDraftImages = [...imagesToSend];

    setError(null);
    setSidebarOpen(false);
    setMentionPickerOpen(false);
    setSending(true);
    setInput('');
    setAttachedImages([]);
    try {
      await onSendMessage(clean, savedDraftImages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Advisor failed to respond.');
      setInput(savedDraftText);
      setAttachedImages(savedDraftImages);
    } finally {
      setSending(false);
    }
  };

  const renderSidebarContent = () => (
    <div className="p-5 space-y-5">
      {/* Live Wardrobe DNA Telemetry Card */}
      <section className="rounded-2xl bg-white border border-black/[0.06] p-4 space-y-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[13px] font-semibold text-[#1D1D1F]">
            Wardrobe DNA
          </h2>
          <span className="text-[11.5px] font-medium text-[#0071E3] truncate">
            {profile.blueprint?.colorSeason || `${profile.skinUndertone} Undertone`}
          </span>
        </div>

        {dna.dominantSwatches.length > 0 ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              {dna.dominantSwatches.map((sw) => (
                <span
                  key={sw.color}
                  className="w-5 h-5 rounded-full border border-black/15 shrink-0"
                  style={{ backgroundColor: sw.hex }}
                  title={`${sw.color} (${sw.count})`}
                />
              ))}
            </div>
            <p className="text-[11.5px] text-[#6E6E73]">
              Tops {dna.categoryCounts.tops} · Bottoms {dna.categoryCounts.bottoms} · Outer{' '}
              {dna.categoryCounts.outerwear} · Shoes {dna.categoryCounts.footwear}
            </p>
          </div>
        ) : (
          <p className="text-[12px] text-[#6E6E73]">
            Upload clothes to unlock live palette &amp; silhouette intelligence.
          </p>
        )}

        {dna.totalItems > 0 && (
          <div className="pt-2.5 border-t border-black/[0.06] flex items-center justify-between text-[12px]">
            <span className="text-[#6E6E73]">Palette Alignment</span>
            <span className="font-mono font-semibold text-[#1D1D1F] tabular-nums">
              {dna.blueprintAlignmentAvg}%
            </span>
          </div>
        )}

        {dna.unwornCount > 0 && (
          <button
            type="button"
            disabled={sending}
            onClick={() =>
              void sendText(
                `Build 3 fresh, flattering outfits featuring some of my ${dna.unwornCount} unworn pieces and hyperlink every item.`,
                []
              )
            }
            className="w-full text-left px-3 py-2 rounded-xl bg-[#F5F5F7] hover:bg-black/[0.07] text-[12px] font-medium text-[#1D1D1F] flex items-center justify-between gap-2 transition-colors disabled:opacity-40"
          >
            <span>Style {dna.unwornCount} unworn pieces</span>
            <Sparkles className="w-3.5 h-3.5 text-[#0071E3] shrink-0" aria-hidden="true" />
          </button>
        )}
      </section>

      {/* Compare Store Finds Card */}
      <section className="rounded-2xl bg-white border border-black/[0.06] p-4 space-y-3">
        <div>
          <h2 className="text-[14px] font-semibold text-[#1D1D1F]">
            Deciding What to Buy?
          </h2>
          <p className="mt-1 text-[12.5px] leading-[1.5] text-[#6E6E73]">
            Upload 1–4 store photos to compare against your closet.
          </p>
        </div>
        <button
          type="button"
          disabled={sending || attaching || attachedImages.length >= MAX_ADVISOR_IMAGES}
          onClick={() => fileInputRef.current?.click()}
          className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-[#1D1D1F] text-white text-[13px] font-medium hover:bg-[#3A3A3C] disabled:opacity-40 transition-colors"
        >
          <ImagePlus className="w-4 h-4" aria-hidden="true" />
          Compare Store Photos ({attachedImages.length}/{MAX_ADVISOR_IMAGES})
        </button>
      </section>

      {/* Detected High-ROI Wardrobe Gaps */}
      <section className="space-y-3">
        <div className="px-1">
          <h2 className="text-[13px] font-semibold text-[#1D1D1F]">
            Wardrobe Gaps
          </h2>
        </div>

        <div className="space-y-2.5">
          {wardrobeGaps.map((gap) => (
            <div
              key={gap.id}
              className="rounded-2xl bg-white border border-black/[0.06] p-4 space-y-1.5"
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-[13px] font-semibold text-[#1D1D1F]">
                  {gap.title}
                </h3>
                <span className="text-[11px] font-medium text-[#6E6E73] shrink-0">
                  {gap.priority}
                </span>
              </div>
              <p className="text-[12.5px] leading-[1.5] text-[#6E6E73]">{gap.reason}</p>
              <button
                type="button"
                disabled={sending}
                onClick={() => void sendText(gap.suggestedPrompt, [])}
                className="pt-0.5 text-[12px] font-medium text-[#0071E3] hover:underline disabled:opacity-40"
              >
                Ask advisor what to buy →
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Curated Consultations */}
      <section className="space-y-2">
        <p className="text-[12px] font-medium text-[#6E6E73] px-1">
          Curated Consultations
        </p>
        {CONSULTATION_STARTERS.map((item) => (
          <button
            key={item.label}
            type="button"
            disabled={sending}
            onClick={() => void sendText(item.prompt, [])}
            className="w-full text-left px-3.5 py-2.5 rounded-xl bg-white border border-black/[0.06] hover:border-black/[0.18] transition-colors disabled:opacity-40"
          >
            <p className="text-[12.5px] font-semibold text-[#1D1D1F]">{item.label}</p>
            <p className="mt-0.5 text-[11.5px] leading-[1.4] text-[#6E6E73] line-clamp-2">
              {item.prompt}
            </p>
          </button>
        ))}
      </section>
    </div>
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files?.length) {
          void handleAddFiles(e.dataTransfer.files);
        }
      }}
      className={`flex-1 min-h-0 w-full flex bg-white relative ${
        dragging ? 'ring-2 ring-inset ring-[#0071E3]' : ''
      }`}
    >
      {/* Desktop Left Sidebar — Full Viewport Height */}
      <aside
        aria-label="Wardrobe DNA and advisor tools"
        className="hidden lg:block w-[320px] xl:w-[350px] shrink-0 border-r border-black/[0.06] bg-[#FAFAFC] overflow-y-auto"
      >
        {renderSidebarContent()}
      </aside>

      {/* Mobile / Tablet Slide-Over Insights Drawer */}
      {sidebarOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Wardrobe DNA and shopping prompts"
          onClick={() => setSidebarOpen(false)}
          className="lg:hidden fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex"
        >
          <aside
            onClick={(e) => e.stopPropagation()}
            className="w-[310px] max-w-[86vw] h-full bg-[#FAFAFC] shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="px-5 h-14 border-b border-black/[0.06] bg-white flex items-center justify-between shrink-0">
              <span className="text-[14px] font-semibold text-[#1D1D1F]">
                Wardrobe DNA &amp; Gaps
              </span>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                aria-label="Close insights panel"
                className="w-8 h-8 rounded-full hover:bg-black/[0.05] flex items-center justify-center text-[#6E6E73]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{renderSidebarContent()}</div>
          </aside>
        </div>
      )}

      {/* Full-Screen Conversation Column */}
      <section
        aria-label="Shopping advisor conversation"
        className="flex-1 min-w-0 flex flex-col h-full bg-white"
      >
        {/* Compact Full-Width Advisor Subheader */}
        <div className="shrink-0 h-14 px-4 sm:px-6 border-b border-black/[0.06] flex items-center justify-between gap-3 bg-white">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open wardrobe DNA and quick prompts"
              className="lg:hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#F5F5F7] text-[12px] font-medium text-[#1D1D1F] hover:bg-black/[0.08] shrink-0"
            >
              <PanelLeft className="w-3.5 h-3.5" aria-hidden="true" />
              Wardrobe DNA
            </button>
            <div className="min-w-0">
              <h1 className="text-[15px] sm:text-[16px] font-semibold tracking-[-0.015em] text-[#1D1D1F] truncate">
                Shopping &amp; Trend Advisor
              </h1>
            </div>
            <span className="hidden sm:inline text-[12px] text-[#86868B] whitespace-nowrap">
              · {garments.length} {garments.length === 1 ? 'piece' : 'pieces'}
              {profile.blueprint?.colorSeason ? ` · ${profile.blueprint.colorSeason}` : ''}
            </span>
          </div>

          <button
            type="button"
            onClick={onClearHistory}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-black/[0.1] text-[12px] font-medium text-[#1D1D1F] hover:bg-black/[0.04] shrink-0 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            New Thread
          </button>
        </div>

        {/* Full-Height Scrollable Message Feed */}
        <div ref={chatScrollRef} className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-3xl mx-auto w-full px-4 sm:px-8 py-6 sm:py-8 space-y-6">
            {messages.map((msg) => {
              const isUser = msg.role === 'user';
              const refPieces = (msg.referencedItemIds ?? [])
                .map((id) => garmentMap.get(id))
                .filter((g): g is Garment => Boolean(g));
              const msgImages = msg.attachedImages ?? [];

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                >
                  {isUser && msgImages.length > 0 && (
                    <div
                      className={`mb-2 grid gap-2 max-w-[85%] ${
                        msgImages.length === 1 ? 'grid-cols-1 w-44' : 'grid-cols-2 sm:grid-cols-4'
                      }`}
                    >
                      {msgImages.map((imgUrl, idx) => (
                        <div
                          key={`${msg.id}_img_${idx}`}
                          className="relative aspect-[3/4] rounded-xl overflow-hidden bg-[#EFEFF2] border border-black/[0.08]"
                        >
                          <img
                            src={imgUrl}
                            alt={`Shopping option ${idx + 1}`}
                            className="w-full h-full object-cover"
                          />
                          {msgImages.length > 1 && (
                            <span className="absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded-md bg-black/70 text-white text-[10px] font-medium">
                              Option {idx + 1}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div
                    className={`max-w-[92%] sm:max-w-[85%] rounded-2xl px-5 py-3.5 text-[14.5px] leading-[1.65] ${
                      isUser
                        ? 'bg-[#1D1D1F] text-white'
                        : 'bg-[#F5F5F7] text-[#1D1D1F]'
                    }`}
                  >
                    <AdvisorMessageContent
                      content={msg.content}
                      garments={garments}
                      isUser={isUser}
                      onSelectGarment={(piece) => setPreviewGarment(piece)}
                    />
                  </div>

                  {/* Referenced Owned Garments */}
                  {!isUser && refPieces.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-2 max-w-[92%]">
                      {refPieces.map((piece) => {
                        const roleLabel =
                          piece.category === 'tops'
                            ? classifyTopLayerRole(piece) === 'mid'
                              ? 'Mid'
                              : 'Base'
                            : piece.category === 'outerwear'
                              ? 'Outer'
                              : piece.category === 'bottoms'
                                ? 'Bottom'
                                : piece.category === 'footwear'
                                  ? 'Shoes'
                                  : 'Accent';
                        return (
                          <button
                            key={piece.id}
                            type="button"
                            onClick={() => setPreviewGarment(piece)}
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
                            <span className="text-[10.5px] text-[#86868B]">
                              {roleLabel}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Grounded Web Trend Sources */}
                  {!isUser && msg.sources && msg.sources.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[#6E6E73] max-w-[90%]">
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

            {/* Clean inline starter shortcuts when thread is fresh */}
            {messages.length <= 1 && !sending && (
              <div className="pt-2 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {CONSULTATION_STARTERS.map((starter) => (
                  <button
                    key={starter.label}
                    type="button"
                    onClick={() => void sendText(starter.prompt, [])}
                    className="text-left p-3.5 rounded-2xl bg-[#FAFAFC] border border-black/[0.06] hover:border-black/[0.18] transition-colors"
                  >
                    <p className="text-[13px] font-semibold text-[#1D1D1F]">{starter.label}</p>
                    <p className="mt-1 text-[12px] leading-[1.45] text-[#6E6E73] line-clamp-2">
                      {starter.prompt}
                    </p>
                  </button>
                ))}
              </div>
            )}

            {sending && (
              <div className="flex items-start">
                <div className="rounded-2xl bg-[#F5F5F7] px-5 py-3.5 text-[14px] text-[#6E6E73]">
                  Thinking...
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Bottom Docked Composer + Optional Quick Garment Mention Picker */}
        <div className="shrink-0 border-t border-black/[0.06] bg-white relative">
          <div className="max-w-3xl mx-auto w-full px-4 sm:px-6 relative">
            {/* Popover to reference a specific closet item in your question */}
            {mentionPickerOpen && garments.length > 0 && (
              <div className="absolute bottom-full left-4 right-4 sm:left-6 sm:right-6 mb-2 rounded-2xl bg-white border border-black/[0.1] shadow-xl p-3 space-y-2.5 z-20">
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="text"
                    value={mentionQuery}
                    onChange={(e) => setMentionQuery(e.target.value)}
                    placeholder="Filter your wardrobe pieces to mention..."
                    autoFocus
                    className="flex-1 px-3 py-1.5 rounded-lg bg-[#F5F5F7] text-[13px] text-[#1D1D1F] placeholder:text-[#86868B] focus:outline-none focus:ring-2 focus:ring-[#0071E3]"
                  />
                  <button
                    type="button"
                    onClick={() => setMentionPickerOpen(false)}
                    aria-label="Close piece picker"
                    className="w-7 h-7 rounded-full hover:bg-black/[0.05] flex items-center justify-center text-[#6E6E73]"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="max-h-48 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {filteredMentionGarments.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => insertGarmentMention(g)}
                      className="flex items-center gap-2.5 p-1.5 rounded-xl hover:bg-[#F5F5F7] text-left transition-colors"
                    >
                      <div className="w-8 h-9 rounded-lg overflow-hidden bg-[#EFEFF2] shrink-0">
                        <SmartImage
                          src={g.imageUrl}
                          alt={g.name}
                          swatchHex={g.colorHex}
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-medium text-[#1D1D1F] truncate">
                          {g.name}
                        </p>
                        <p className="text-[11px] text-[#6E6E73] truncate">
                          {g.primaryColor} · {g.category}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="mt-3 px-4 py-2.5 rounded-xl bg-[#FFF2F2] border border-[#D70015]/20 text-[13px] text-[#B00012]"
              >
                {error}
              </div>
            )}

            {attachedImages.length > 0 && (
              <div className="pt-3 pb-1">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11.5px] font-medium text-[#6E6E73]">
                    {attachedImages.length === 1
                      ? '1 item photo attached — send now or add up to 3 more to compare'
                      : `${attachedImages.length} options attached — AI will compare and pick the #1 buy`}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAttachedImages([])}
                    className="text-[11.5px] font-medium text-[#6E6E73] hover:text-[#1D1D1F]"
                  >
                    Clear photos
                  </button>
                </div>
                <div className="flex items-center gap-2.5 overflow-x-auto pb-1">
                  {attachedImages.map((img) => (
                    <div
                      key={img.id}
                      className="relative w-16 h-20 rounded-xl overflow-hidden bg-[#EFEFF2] border border-black/[0.08] shrink-0"
                    >
                      <img
                        src={img.dataUrl}
                        alt={img.label}
                        className="w-full h-full object-cover"
                      />
                      {attachedImages.length > 1 && (
                        <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/70 text-white text-[9px] font-medium">
                          {img.label}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeAttachedImage(img.id)}
                        aria-label={`Remove ${img.label}`}
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-black"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void sendText(input);
              }}
              className="py-3.5 flex items-center gap-2"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) {
                    void handleAddFiles(e.target.files);
                  }
                  e.target.value = '';
                }}
              />

              <button
                type="button"
                disabled={sending || attaching || attachedImages.length >= MAX_ADVISOR_IMAGES}
                onClick={() => fileInputRef.current?.click()}
                aria-label="Upload item photos to compare"
                title="Upload up to 4 item photos to compare"
                className="w-11 h-11 rounded-full bg-[#F5F5F7] text-[#1D1D1F] flex items-center justify-center shrink-0 hover:bg-black/[0.08] disabled:opacity-35 transition-colors"
              >
                <ImagePlus className="w-4 h-4" />
              </button>

              {garments.length > 0 && (
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => setMentionPickerOpen((v) => !v)}
                  aria-label="Reference an item from your wardrobe"
                  title="Reference a wardrobe item in your question"
                  className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-colors disabled:opacity-35 ${
                    mentionPickerOpen
                      ? 'bg-[#1D1D1F] text-white'
                      : 'bg-[#F5F5F7] text-[#1D1D1F] hover:bg-black/[0.08]'
                  }`}
                >
                  <Shirt className="w-4 h-4" />
                </button>
              )}

              <label htmlFor="advisor-input" className="sr-only">
                Message your shopping advisor
              </label>
              <input
                ref={inputRef}
                id="advisor-input"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onPaste={(e) => {
                  const pastedImages = Array.from(e.clipboardData?.files ?? []).filter((f) =>
                    ALLOWED_IMAGE_MIME_TYPES.has((f.type || '').toLowerCase())
                  );
                  if (pastedImages.length > 0) {
                    e.preventDefault();
                    void handleAddFiles(pastedImages);
                  }
                }}
                placeholder={
                  attachedImages.length > 1
                    ? 'Optional note (e.g. "Which works better for smart casual dinners?") or hit send...'
                    : attachedImages.length === 1
                      ? 'Optional note (e.g. "Should I buy this for $120?") or hit send...'
                      : 'Ask what to buy, mention a closet item, or upload up to 4 store photos...'
                }
                className="flex-1 px-4 py-3 rounded-full bg-[#F5F5F7] text-[14px] text-[#1D1D1F] placeholder:text-[#86868B] focus:outline-none focus:ring-2 focus:ring-[#0071E3]"
              />
              <button
                type="submit"
                disabled={(!input.trim() && attachedImages.length === 0) || sending || attaching}
                aria-label="Send message to shopping advisor"
                className="w-11 h-11 rounded-full bg-[#1D1D1F] text-white flex items-center justify-center shrink-0 hover:bg-[#3A3A3C] disabled:opacity-35 transition-colors"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* Quick Garment Image Preview Popup */}
      {previewGarment && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="advisor-garment-preview-title"
          onClick={() => setPreviewGarment(null)}
          className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-[26px] bg-white shadow-2xl overflow-hidden border border-black/[0.08]"
          >
            <div className="relative bg-[#F2F2F4] aspect-[4/5] max-h-[62vh] w-full overflow-hidden">
              <SmartImage
                src={previewGarment.imageUrl}
                alt={previewGarment.name}
                swatchHex={previewGarment.colorHex}
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => setPreviewGarment(null)}
                aria-label="Close garment photo preview"
                className="absolute top-3.5 right-3.5 w-9 h-9 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-black transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12px] text-[#6E6E73] capitalize">
                    {previewGarment.category} · {previewGarment.subCategory}
                  </p>
                  <h2
                    id="advisor-garment-preview-title"
                    className="mt-0.5 text-[18px] font-semibold tracking-[-0.015em] text-[#1D1D1F]"
                  >
                    {previewGarment.name}
                  </h2>
                </div>
                <span
                  className="w-5 h-5 rounded-full border border-black/15 shrink-0 mt-1"
                  style={{ backgroundColor: previewGarment.colorHex }}
                  title={previewGarment.primaryColor}
                  aria-hidden="true"
                />
              </div>

              <p className="text-[13px] text-[#48484A] leading-[1.5]">
                {previewGarment.primaryColor} · {previewGarment.fabric} · {previewGarment.fit} fit
              </p>

              <div className="flex items-center justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    const target = previewGarment;
                    setPreviewGarment(null);
                    onInspectGarment(target);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-black/[0.12] text-[13px] font-medium text-[#1D1D1F] hover:bg-black/[0.04] transition-colors"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
                  Full Details
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewGarment(null)}
                  className="px-4 py-2 rounded-full bg-[#1D1D1F] text-white text-[13px] font-medium hover:bg-[#3A3A3C] transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
