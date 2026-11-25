import { useState } from 'react';
import { Shirt } from 'lucide-react';

interface SmartImageProps {
  src: string;
  alt: string;
  className?: string;
  fallbackLabel?: string;
  swatchHex?: string;
}

export function SmartImage({
  src,
  alt,
  className = 'w-full h-full object-cover',
  fallbackLabel,
  swatchHex,
}: SmartImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed || !src) {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center bg-[#EFEFF2] text-[#6E6E73] p-4 text-center"
        role="img"
        aria-label={alt}
      >
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center mb-2 border border-black/8"
          style={{ backgroundColor: swatchHex ? `${swatchHex}22` : '#FFFFFF' }}
        >
          <Shirt className="w-5 h-5 text-[#1D1D1F]" />
        </div>
        <span className="text-xs font-medium text-[#48484A] line-clamp-2">
          {fallbackLabel || alt}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
