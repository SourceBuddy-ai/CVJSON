import type { SourceFormat } from '../types.js';
import { extractDocxText } from './docx.js';

/** Accepted input shapes. Strings are treated as already-extracted text. */
export type ParseInput = string | Uint8Array | ArrayBuffer;

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF
const ZIP_MAGIC = [0x50, 0x4b]; // PK — DOCX is a ZIP container

function toBytes(input: Uint8Array | ArrayBuffer): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((byte, i) => bytes[i] === byte);
}

/**
 * Identify the document format from its magic bytes.
 *
 * Sniffing beats trusting a filename or a client-supplied content type: both
 * are routinely wrong, and a mislabelled file would otherwise fail deep inside
 * a parser with an unhelpful error.
 */
export function detectFormat(input: ParseInput): SourceFormat {
  if (typeof input === 'string') {
    return /<\s*(?:html|body|div|p)\b/i.test(input.slice(0, 2000)) ? 'html' : 'txt';
  }
  const bytes = toBytes(input);
  if (startsWith(bytes, PDF_MAGIC)) return 'pdf';
  if (startsWith(bytes, ZIP_MAGIC)) return 'docx';

  // No magic bytes: if it decodes as mostly-printable UTF-8, treat it as text.
  const sample = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 1024));
  const printable = (sample.match(/[\p{L}\p{N}\p{P}\p{Zs}\n\r\t]/gu) ?? []).length;
  if (sample.length > 0 && printable / sample.length > 0.9) return 'txt';

  return 'unknown';
}

/**
 * Strip HTML to text, preserving the block structure that carries resume
 * meaning: list items become bullets, block elements become line breaks.
 */
export function extractHtmlText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|tr|li|section|article|header)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Extract plain text from a resume in any supported format.
 *
 * PDF support is loaded on demand: `unpdf` bundles a copy of PDF.js, and
 * callers who only ever handle DOCX or text should not pay that startup cost.
 */
export async function extractText(
  input: ParseInput,
  format: SourceFormat = detectFormat(input),
): Promise<{ text: string; format: SourceFormat }> {
  if (typeof input === 'string') {
    const text = format === 'html' ? extractHtmlText(input) : input;
    return { text, format };
  }

  const bytes = toBytes(input);

  switch (format) {
    case 'pdf': {
      const text = await extractPdfText(bytes);
      return { text, format };
    }
    case 'docx':
      return { text: extractDocxText(bytes), format };
    case 'html':
      return { text: extractHtmlText(new TextDecoder().decode(bytes)), format };
    case 'txt':
      return { text: new TextDecoder().decode(bytes), format };
    default:
      throw new Error(
        'Unsupported file format. Provide a PDF, DOCX, HTML or plain-text resume.',
      );
  }
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  let unpdf: typeof import('unpdf');
  try {
    unpdf = await import('unpdf');
  } catch (cause) {
    throw new Error(
      'PDF parsing requires the optional "unpdf" dependency. Install it with `npm install unpdf`.',
      { cause },
    );
  }

  const pdf = await unpdf.getDocumentProxy(bytes);
  // `mergePages: false` keeps page boundaries, which we join with blank lines so
  // the segmenter sees a paragraph break rather than a run-on line where one
  // page ends mid-section.
  const { text } = await unpdf.extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  return pages.join('\n\n');
}
