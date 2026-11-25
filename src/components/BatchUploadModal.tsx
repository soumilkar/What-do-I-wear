import { useEffect, useRef, useState } from 'react';
import { Check, ImagePlus, Trash2, Upload, X } from 'lucide-react';
import type { Garment } from '../types/styling';
import { compressImageToDataUrl } from '../utils/imageCompress';
import { MAX_BATCH_UPLOAD_FILES, validateUploadBatch } from '../utils/styleEngine';

export interface AnalyzedCloudGarmentEntry {
  garment: Omit<Garment, 'id' | 'createdAt'>;
  vector: number[];
}

interface BatchUploadModalProps {
  open: boolean;
  onClose: () => void;
  onSaveAnalyzedGarments: (entries: AnalyzedCloudGarmentEntry[]) => Promise<void>;
}

interface QueuedPhoto {
  id: string;
  file: File;
  previewUrl: string;
}

export function BatchUploadModal({
  open,
  onClose,
  onSaveAnalyzedGarments,
}: BatchUploadModalProps) {
  const [queue, setQueue] = useState<QueuedPhoto[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; stage: string }>({
    done: 0,
    total: 0,
    stage: '',
  });
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !uploading) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, uploading, onClose]);

  useEffect(() => {
    return () => {
      for (const q of queue) {
        URL.revokeObjectURL(q.previewUrl);
      }
    };
  }, [queue]);

  if (!open) return null;

  const addFiles = (incomingList: FileList | File[]) => {
    setError(null);
    const incoming = Array.from(incomingList);
    if (incoming.length === 0) return;

    const combinedCount = queue.length + incoming.length;
    if (combinedCount > MAX_BATCH_UPLOAD_FILES) {
      setError(
        `Maximum ${MAX_BATCH_UPLOAD_FILES} clothing items per upload. You currently have ${queue.length} queued.`
      );
      return;
    }

    const validation = validateUploadBatch(
      incoming.map((f) => ({ name: f.name, type: f.type, size: f.size }))
    );

    if (!validation.valid) {
      setError(validation.errors[0]);
      return;
    }

    const nextItems: QueuedPhoto[] = incoming.map((file, idx) => ({
      id: `${Date.now()}-${idx}-${file.name}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }));

    setQueue((prev) => [...prev, ...nextItems]);
  };

  const removeQueued = (id: string) => {
    setQueue((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  const clearQueue = () => {
    for (const q of queue) URL.revokeObjectURL(q.previewUrl);
    setQueue([]);
    setError(null);
  };

  const handleUpload = async () => {
    if (queue.length === 0 || uploading) return;
    setError(null);
    setUploading(true);

    const total = queue.length;
    const readyEntries: AnalyzedCloudGarmentEntry[] = [];

    try {
      setProgress({
        done: 0,
        total,
        stage: 'Optimizing photos for cloud sync and minimal AI tokens...',
      });

      const prepared: Array<{ fileName: string; dataUrl: string; base64: string; mimeType: string }> = [];
      for (let i = 0; i < queue.length; i++) {
        const compressed = await compressImageToDataUrl(queue[i].file, 640, 185_000);
        prepared.push({ fileName: queue[i].file.name, ...compressed });
      }

      // Analyze smoothly with bounded concurrency of 3 so up to 50 items complete reliably on Vercel & Cloud Run
      let completed = 0;
      const concurrency = 3;
      let cursor = 0;

      const worker = async () => {
        while (cursor < prepared.length) {
          const idx = cursor++;
          const item = prepared[idx];

          setProgress({
            done: completed,
            total,
            stage: `Inspecting fabrics, fits & mapping image vectors (${Math.min(completed + 1, total)} of ${total})...`,
          });

          const res = await fetch('/api/ai/analyze-garment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              base64: item.base64,
              mimeType: item.mimeType,
              fileName: item.fileName,
            }),
          });

          const data = (await res.json()) as {
            analyzed?: Omit<
              Garment,
              'id' | 'imageUrl' | 'wearCount' | 'hasVector' | 'vectorSource' | 'modelUsed' | 'createdAt'
            >;
            vector?: number[];
            vectorSource?: 'gemini-embedding-2' | 'semantic-fallback';
            modelUsed?: string;
            error?: string;
          };

          if (!res.ok || !data.analyzed) {
            throw new Error(data.error || `Failed to inspect ${item.fileName}.`);
          }

          readyEntries.push({
            garment: {
              ...data.analyzed,
              imageUrl: item.dataUrl,
              wearCount: 0,
              hasVector: true,
              vectorSource: data.vectorSource ?? 'semantic-fallback',
              modelUsed: data.modelUsed,
            },
            vector: data.vector ?? [],
          });

          completed += 1;
          setProgress({
            done: completed,
            total,
            stage: `Analyzed ${completed} of ${total} pieces`,
          });
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(concurrency, prepared.length) }, () => worker())
      );

      setProgress({
        done: total,
        total,
        stage: 'Saving garments & vectors to your private cloud wardrobe...',
      });

      // Persist in Firestore chunks of 25 (well within Firestore batch limits)
      for (let start = 0; start < readyEntries.length; start += 25) {
        await onSaveAnalyzedGarments(readyEntries.slice(start, start + 25));
      }

      clearQueue();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const pct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/35 backdrop-blur-[4px]"
      role="dialog"
      aria-modal="true"
      aria-label="Upload clothing items"
      onClick={(e) => {
        if (e.target === e.currentTarget && !uploading) onClose();
      }}
    >
      <div className="w-full max-w-[680px] max-h-[88vh] bg-white rounded-[26px] shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-black/[0.06] flex items-center justify-between gap-4">
          <div>
            <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-[#1D1D1F]">
              Add Clothes to Cloud Wardrobe
            </h2>
            <p className="mt-0.5 text-[13px] text-[#6E6E73]">
              Upload up to {MAX_BATCH_UPLOAD_FILES} pieces at once. Each photo is analyzed for fabric, fit, color, and saved privately to your cloud account.
            </p>
          </div>
          <button
            type="button"
            disabled={uploading}
            onClick={onClose}
            aria-label="Close upload modal"
            className="w-9 h-9 rounded-full bg-black/[0.05] hover:bg-black/[0.1] flex items-center justify-center text-[#1D1D1F] shrink-0 disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = '';
            }}
          />

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              addFiles(e.dataTransfer.files);
            }}
            className={`rounded-2xl border border-dashed p-8 text-center transition-colors ${
              dragging
                ? 'border-[#0071E3] bg-[#0071E3]/[0.04]'
                : 'border-black/[0.14] bg-[#F5F5F7]/65'
            }`}
          >
            <div className="w-11 h-11 rounded-2xl bg-white border border-black/[0.06] flex items-center justify-center mx-auto mb-3 shadow-xs">
              <ImagePlus className="w-5 h-5 text-[#1D1D1F]" aria-hidden="true" />
            </div>
            <p className="text-[15px] font-medium text-[#1D1D1F]">
              Drop clothing photos here, or browse from your device
            </p>
            <p className="mt-1 text-[13px] text-[#6E6E73]">
              JPEG, PNG, WebP, or AVIF · Up to 50 items per batch · Synced privately to your account
            </p>
            <button
              type="button"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-black/[0.12] text-[13px] font-medium text-[#1D1D1F] hover:bg-black/[0.03] disabled:opacity-40"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              Choose Photos
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="px-4 py-3 rounded-xl bg-[#FFF2F2] border border-[#D70015]/20 text-[13px] text-[#B00012]"
            >
              {error}
            </div>
          )}

          {uploading && (
            <div className="space-y-2 py-2">
              <div className="flex items-center justify-between text-[13px]">
                <span className="font-medium text-[#1D1D1F]">{progress.stage}</span>
                <span className="font-mono text-[#6E6E73] tabular-nums">{pct}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-black/[0.06] overflow-hidden">
                <div
                  className="h-full bg-[#0071E3] transition-all duration-300"
                  style={{ width: `${Math.max(8, pct)}%` }}
                />
              </div>
            </div>
          )}

          {queue.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-[13px]">
                <span className="font-medium text-[#1D1D1F] tabular-nums">
                  {queue.length} of {MAX_BATCH_UPLOAD_FILES} selected
                </span>
                {!uploading && (
                  <button
                    type="button"
                    onClick={clearQueue}
                    className="text-[#6E6E73] hover:text-[#1D1D1F]"
                  >
                    Clear all
                  </button>
                )}
              </div>

              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2.5 max-h-[220px] overflow-y-auto pr-1">
                {queue.map((item) => (
                  <div
                    key={item.id}
                    className="relative aspect-[3/4] rounded-xl overflow-hidden bg-[#EFEFF2] group"
                  >
                    <img
                      src={item.previewUrl}
                      alt={item.file.name}
                      className="w-full h-full object-cover"
                    />
                    {!uploading && (
                      <button
                        type="button"
                        onClick={() => removeQueued(item.id)}
                        aria-label={`Remove ${item.file.name}`}
                        className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/65 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-black/[0.06] bg-[#FAFAFC] flex items-center justify-between gap-4">
          <p className="text-[12px] text-[#6E6E73]">
            AI fabric inspection + image vectors saved to cloud
          </p>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              disabled={uploading}
              onClick={onClose}
              className="px-4 py-2 rounded-full text-[13px] font-medium text-[#6E6E73] hover:text-[#1D1D1F] disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={queue.length === 0 || uploading}
              onClick={handleUpload}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full bg-[#1D1D1F] text-white text-[13px] font-medium hover:bg-[#3A3A3C] disabled:opacity-40 transition-colors"
            >
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              {uploading
                ? 'Analyzing...'
                : `Analyze & Save (${queue.length})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
