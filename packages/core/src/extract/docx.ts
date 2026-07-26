import { unzipSync, strFromU8 } from 'fflate';

/**
 * DOCX text extraction.
 *
 * A .docx is a ZIP holding `word/document.xml`. We unzip it and walk the
 * paragraph elements directly rather than pulling in a full OOXML library: the
 * subset of the format a resume uses is small, and a lean implementation is
 * what lets this run inside a Cloudflare Worker's memory and CPU budget.
 */

/** Paragraphs, including the properties block we need for list detection. */
const PARAGRAPH = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;

/** Text runs. `xml:space="preserve"` means the whitespace inside is significant. */
const TEXT_RUN = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;

/** Presence of a numbering reference marks the paragraph as a list item. */
const LIST_MARKER = /<w:numPr\b/;

/** Explicit line and tab breaks inside a paragraph. */
const LINE_BREAK = /<w:br\b[^>]*\/?>/g;
const TAB = /<w:tab\b[^>]*\/?>/g;

const NBSP = ' ';

const XML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decodeEntities(text: string): string {
  return text
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, (match) => XML_ENTITIES[match] ?? match)
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

/**
 * Extract plain text from a .docx buffer.
 *
 * Returns one line per paragraph, with list paragraphs prefixed by a bullet so
 * the line model downstream can recognise them — DOCX stores list-ness as a
 * style reference, not as a character, so without this the bullet structure of
 * every resume body would be lost.
 */
export function extractDocxText(buffer: Uint8Array): string {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buffer);
  } catch (cause) {
    throw new Error('Not a readable DOCX file: the archive could not be opened.', { cause });
  }

  const document = files['word/document.xml'];
  if (!document) {
    throw new Error('Not a readable DOCX file: word/document.xml is missing.');
  }

  const xml = strFromU8(document);
  const lines: string[] = [];

  for (const match of xml.matchAll(PARAGRAPH)) {
    const paragraph = match[1];
    const isListItem = LIST_MARKER.test(paragraph);

    // `<w:br/>` and `<w:tab/>` are empty elements sitting *between* text runs,
    // so turn them into real characters before collecting run text. Splitting on
    // the resulting newlines then recovers the paragraph's visual lines; a
    // paragraph without breaks simply yields one segment.
    const withBreaks = paragraph.replace(LINE_BREAK, '\n').replace(TAB, '\t');

    for (const segment of collectSegments(withBreaks)) {
      const trimmed = segment.replace(/[ \t]+$/g, '');
      if (!trimmed.trim()) {
        lines.push('');
        continue;
      }
      lines.push(isListItem ? `• ${trimmed.trim()}` : trimmed);
    }
  }

  return lines.join('\n');
}

/** Split a break-normalised paragraph into visual lines of decoded text. */
function collectSegments(paragraphWithBreaks: string): string[] {
  return paragraphWithBreaks.split('\n').map((segment) => {
    let text = '';
    for (const run of segment.matchAll(TEXT_RUN)) text += run[1];
    return decodeEntities(text).split(NBSP).join(' ').replace(/\t/g, '    ');
  });
}
