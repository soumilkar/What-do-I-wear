import { Fragment, useMemo } from 'react';
import type { Garment } from '../types/styling';
import {
  type InlineToken,
  parseAdvisorMarkdown,
} from '../utils/advisorMarkdown';

interface AdvisorMessageContentProps {
  content: string;
  garments: Garment[];
  isUser?: boolean;
  onSelectGarment: (garment: Garment) => void;
}

export function AdvisorMessageContent({
  content,
  garments,
  isUser = false,
  onSelectGarment,
}: AdvisorMessageContentProps) {
  const garmentMap = useMemo(() => new Map(garments.map((g) => [g.id, g])), [garments]);
  const blocks = useMemo(
    () => parseAdvisorMarkdown(content, garments),
    [content, garments]
  );

  const renderInline = (tokens: InlineToken[], keyPrefix: string) =>
    tokens.map((token, idx) => {
      const key = `${keyPrefix}_${idx}`;
      switch (token.type) {
        case 'text':
          return <Fragment key={key}>{token.text}</Fragment>;
        case 'bold':
          return (
            <strong key={key} className="font-semibold">
              {renderInline(token.children, `${key}_b`)}
            </strong>
          );
        case 'italic':
          return (
            <em key={key} className="italic">
              {renderInline(token.children, `${key}_i`)}
            </em>
          );
        case 'code':
          return (
            <code
              key={key}
              className={`px-1.5 py-0.5 rounded-md font-mono text-[12.5px] ${
                isUser ? 'bg-white/15 text-white' : 'bg-black/[0.06] text-[#1D1D1F]'
              }`}
            >
              {token.text}
            </code>
          );
        case 'link':
          return (
            <a
              key={key}
              href={token.href}
              target="_blank"
              rel="noopener noreferrer"
              className={`underline underline-offset-2 ${
                isUser
                  ? 'text-[#7CC4FF] hover:text-white'
                  : 'text-[#0071E3] hover:text-[#005BB5]'
              }`}
            >
              {token.label}
            </a>
          );
        case 'garment': {
          const piece = garmentMap.get(token.garmentId);
          if (!piece) {
            return <Fragment key={key}>{token.label}</Fragment>;
          }
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectGarment(piece)}
              title={`View photo of ${piece.name}`}
              className={`inline items-baseline gap-1 font-medium underline underline-offset-[3px] decoration-[1.5px] cursor-pointer transition-colors ${
                isUser
                  ? 'text-[#9AD0FF] decoration-[#9AD0FF]/60 hover:text-white hover:decoration-white'
                  : 'text-[#0071E3] decoration-[#0071E3]/45 hover:text-[#0051A8] hover:decoration-[#0051A8]'
              }`}
            >
              <span
                className="inline-block w-2 h-2 rounded-full border border-black/20 mr-1 align-middle -translate-y-[0.5px]"
                style={{ backgroundColor: piece.colorHex || '#86868B' }}
                aria-hidden="true"
              />
              {token.label}
            </button>
          );
        }
      }
    });

  return (
    <div className="space-y-2.5 break-words">
      {blocks.map((block, bIdx) => {
        const bKey = `blk_${bIdx}`;
        switch (block.type) {
          case 'hr':
            return (
              <hr
                key={bKey}
                className={isUser ? 'border-white/20 my-2' : 'border-black/[0.08] my-2'}
              />
            );
          case 'heading': {
            const cls =
              block.level === 1
                ? 'text-[16px] font-semibold tracking-[-0.015em] pt-1'
                : block.level === 2
                  ? 'text-[15px] font-semibold tracking-[-0.01em] pt-1'
                  : 'text-[14px] font-semibold pt-0.5';
            return (
              <p key={bKey} className={cls}>
                {renderInline(block.tokens, bKey)}
              </p>
            );
          }
          case 'ul':
            return (
              <ul key={bKey} className="list-disc pl-5 space-y-1.5">
                {block.items.map((itemTokens, iIdx) => (
                  <li key={`${bKey}_li_${iIdx}`} className="leading-[1.6]">
                    {renderInline(itemTokens, `${bKey}_li_${iIdx}`)}
                  </li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={bKey} className="list-decimal pl-5 space-y-1.5">
                {block.items.map((itemTokens, iIdx) => (
                  <li key={`${bKey}_oli_${iIdx}`} className="leading-[1.6]">
                    {renderInline(itemTokens, `${bKey}_oli_${iIdx}`)}
                  </li>
                ))}
              </ol>
            );
          case 'paragraph':
            return (
              <p key={bKey} className="leading-[1.65]">
                {block.lines.map((lineTokens, lIdx) => (
                  <Fragment key={`${bKey}_l_${lIdx}`}>
                    {lIdx > 0 && <br />}
                    {renderInline(lineTokens, `${bKey}_l_${lIdx}`)}
                  </Fragment>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}
