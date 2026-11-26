import type { Garment } from '../types/styling';

export type InlineToken =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: InlineToken[] }
  | { type: 'italic'; children: InlineToken[] }
  | { type: 'code'; text: string }
  | { type: 'link'; label: string; href: string }
  | { type: 'garment'; garmentId: string; label: string; emphasized?: boolean };

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; tokens: InlineToken[] }
  | { type: 'ul'; items: InlineToken[][] }
  | { type: 'ol'; items: InlineToken[][] }
  | { type: 'hr' }
  | { type: 'paragraph'; lines: InlineToken[][] };

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isSafeHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

interface GarmentMatcher {
  byId: Map<string, Garment>;
  byLowerName: Map<string, Garment>;
  nameRegex: RegExp | null;
}

export function buildGarmentMatcher(garments: Garment[]): GarmentMatcher {
  const byId = new Map<string, Garment>();
  const byLowerName = new Map<string, Garment>();

  // Sort longest names first so specific titles match before shorter substrings
  const sorted = [...garments]
    .filter((g) => g.id && g.name && g.name.trim().length >= 3)
    .sort((a, b) => b.name.trim().length - a.name.trim().length);

  const escapedNames: string[] = [];
  for (const g of garments) {
    byId.set(g.id, g);
  }
  for (const g of sorted) {
    const clean = g.name.trim();
    const lower = clean.toLowerCase();
    if (!byLowerName.has(lower)) {
      byLowerName.set(lower, g);
      escapedNames.push(escapeRegex(clean));
    }
  }

  const nameRegex =
    escapedNames.length > 0
      ? new RegExp(`(?<![a-zA-Z0-9])(${escapedNames.join('|')})(?![a-zA-Z0-9])`, 'gi')
      : null;

  return { byId, byLowerName, nameRegex };
}

function autoLinkPlainText(text: string, matcher: GarmentMatcher): InlineToken[] {
  if (!text) return [];
  if (!matcher.nameRegex) return [{ type: 'text', text }];

  const tokens: InlineToken[] = [];
  matcher.nameRegex.lastIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = matcher.nameRegex.exec(text)) !== null) {
    const matchedText = match[1];
    const garment = matcher.byLowerName.get(matchedText.toLowerCase());
    if (!garment) continue;

    if (match.index > lastIndex) {
      tokens.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }
    tokens.push({
      type: 'garment',
      garmentId: garment.id,
      label: matchedText,
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', text: text.slice(lastIndex) });
  }

  return tokens.length > 0 ? tokens : [{ type: 'text', text }];
}

/**
 * Parses inline markdown (**bold**, *italic*, `code`, [label](https://...), and [[item:id|label]])
 * plus automatically hyperlinks any wardrobe garment names found in text.
 */
export function parseInlineMarkdown(
  input: string,
  matcher: GarmentMatcher,
  depth = 0
): InlineToken[] {
  if (!input) return [];

  // Order matters: explicit garment tags, external links, inline code, bold, italic
  const inlineRegex =
    /\[\[(?:item|garment):([a-zA-Z0-9_-]+)(?:\|([^\]]+))?\]\]|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|`([^`\n]+)`|\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|(?<!\*)\*([^*\n]+?)\*(?!\*)/g;

  const tokens: InlineToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = inlineRegex.exec(input)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(...autoLinkPlainText(input.slice(lastIndex, match.index), matcher));
    }

    const [
      ,
      tagGarmentId,
      tagGarmentLabel,
      linkLabel,
      linkHref,
      codeText,
      boldAsterisk,
      boldUnderscore,
      italicText,
    ] = match;

    if (tagGarmentId) {
      const byId = matcher.byId.get(tagGarmentId);
      const byLabel = tagGarmentLabel
        ? matcher.byLowerName.get(tagGarmentLabel.trim().toLowerCase())
        : undefined;
      const found = byLabel ?? byId;
      const displayLabel = (tagGarmentLabel || found?.name || tagGarmentId).trim();
      if (found) {
        tokens.push({
          type: 'garment',
          garmentId: found.id,
          label: displayLabel,
        });
      } else {
        tokens.push({ type: 'text', text: displayLabel });
      }
    } else if (linkLabel && linkHref) {
      if (isSafeHttpUrl(linkHref)) {
        tokens.push({ type: 'link', label: linkLabel, href: linkHref });
      } else {
        tokens.push({ type: 'text', text: linkLabel });
      }
    } else if (codeText !== undefined) {
      tokens.push({ type: 'code', text: codeText });
    } else if (boldAsterisk !== undefined || boldUnderscore !== undefined) {
      const inner = boldAsterisk ?? boldUnderscore ?? '';
      const children =
        depth < 2 ? parseInlineMarkdown(inner, matcher, depth + 1) : [{ type: 'text' as const, text: inner }];
      tokens.push({ type: 'bold', children });
    } else if (italicText !== undefined) {
      const children =
        depth < 2 ? parseInlineMarkdown(italicText, matcher, depth + 1) : [{ type: 'text' as const, text: italicText }];
      tokens.push({ type: 'italic', children });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < input.length) {
    tokens.push(...autoLinkPlainText(input.slice(lastIndex), matcher));
  }

  return tokens;
}

/**
 * Parses block-level Markdown (headings, bullet/ordered lists, horizontal rules, paragraphs)
 * into a safe AST for pure-React rendering.
 */
export function parseAdvisorMarkdown(content: string, garments: Garment[]): MarkdownBlock[] {
  const matcher = buildGarmentMatcher(garments);
  const rawLines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];

  let i = 0;
  while (i < rawLines.length) {
    const trimmed = rawLines[i].trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Horizontal rule
    if (/^(?:---+|\*\*\*+)$/.test(trimmed)) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    // Heading (#, ##, ###)
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = Math.min(3, headingMatch[1].length) as 1 | 2 | 3;
      blocks.push({
        type: 'heading',
        level,
        tokens: parseInlineMarkdown(headingMatch[2].trim(), matcher),
      });
      i += 1;
      continue;
    }

    // Unordered list (-, *, •)
    if (/^[-*•]\s+/.test(trimmed)) {
      const items: InlineToken[][] = [];
      while (i < rawLines.length && /^\s*[-*•]\s+/.test(rawLines[i])) {
        const itemText = rawLines[i].replace(/^\s*[-*•]\s+/, '').trim();
        items.push(parseInlineMarkdown(itemText, matcher));
        i += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    // Ordered list (1., 2., etc.)
    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: InlineToken[][] = [];
      while (i < rawLines.length && /^\s*\d+[.)]\s+/.test(rawLines[i])) {
        const itemText = rawLines[i].replace(/^\s*\d+[.)]\s+/, '').trim();
        items.push(parseInlineMarkdown(itemText, matcher));
        i += 1;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    // Paragraph (consecutive non-empty plain lines)
    const paragraphLines: InlineToken[][] = [];
    while (
      i < rawLines.length &&
      rawLines[i].trim() &&
      !/^(#{1,3})\s+/.test(rawLines[i].trim()) &&
      !/^[-*•]\s+/.test(rawLines[i].trim()) &&
      !/^\d+[.)]\s+/.test(rawLines[i].trim()) &&
      !/^(?:---+|\*\*\*+)$/.test(rawLines[i].trim())
    ) {
      paragraphLines.push(parseInlineMarkdown(rawLines[i].trim(), matcher));
      i += 1;
    }
    if (paragraphLines.length > 0) {
      blocks.push({ type: 'paragraph', lines: paragraphLines });
    }
  }

  return blocks;
}
