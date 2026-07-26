import type { Line, Section, SectionKind } from '../types.js';
import { classifyHeading, normalizeHeading } from '../lexicon/headings.js';
import { looksLikeHeading, trimBlank, wordCount } from '../util/lines.js';

interface HeadingHit {
  index: number;
  kind: SectionKind;
  heading: string;
  /** Content that shared the heading's line, as in `SKILLS: Python, Go`. */
  inlineContent?: string;
}

/**
 * Labels that head a *sub-list inside* a skills section rather than a section
 * of their own: `Languages: Go, Rust` under TECHNICAL SKILLS is a category, not
 * the candidate's spoken languages.
 */
const SKILL_SUBCATEGORIES = new Set(['languages', 'tools', 'technologies', 'skills', 'frameworks', 'databases']);

/**
 * Decide whether a line opens a new section.
 *
 * Two signals must agree: the line must *look* like a heading (short, no
 * terminal punctuation, upper- or title-cased) and its text must resolve to a
 * known section in the lexicon. Requiring both keeps a bolded job title like
 * "Senior Engineer" from splitting the work section into fragments.
 *
 * `currentKind` is the section we are already inside, which disambiguates
 * labels that are valid both as a section heading and as a category within one.
 */
function detectHeading(line: Line, currentKind: SectionKind | undefined): HeadingHit | undefined {
  if (line.isBlank || line.isBullet) return undefined;

  // `SKILLS: Python, Go` — the heading and its content share a line.
  const colonSplit = line.text.match(/^([^:]{2,40}):\s*(.*)$/);
  if (colonSplit) {
    const [, candidate, rest] = colonSplit;

    // Inside a skills block, `Languages:` labels a category. Bail out for the
    // whole line rather than just this branch: the generic heading check below
    // would otherwise re-detect it from the same text.
    if (currentKind === 'skills' && SKILL_SUBCATEGORIES.has(normalizeHeading(candidate))) {
      return undefined;
    }

    const kind = classifyHeading(candidate);
    // Only treat this as a section break when the label is heading-shaped;
    // otherwise `Languages: fluent in French` inside a summary would split.
    if (kind && wordCount(candidate) <= 4) {
      return {
        index: line.index,
        kind,
        heading: candidate.trim(),
        inlineContent: rest.trim() || undefined,
      };
    }
  }

  if (!looksLikeHeading(line)) return undefined;
  const kind = classifyHeading(line.text);
  if (!kind) return undefined;
  return { index: line.index, kind, heading: line.text };
}

/**
 * Split a document into sections.
 *
 * Lines before the first recognised heading become the `header` section — that
 * is where the name and contact block live on essentially every resume. When no
 * headings are found at all, the whole document is returned as `header` so that
 * contact extraction still runs.
 */
export function segment(lines: Line[]): Section[] {
  const hits: HeadingHit[] = [];
  let currentKind: SectionKind | undefined;
  for (const line of lines) {
    const hit = detectHeading(line, currentKind);
    if (!hit) continue;
    hits.push(hit);
    currentKind = hit.kind;
  }

  const sections: Section[] = [];

  const firstHeadingIndex = hits.length > 0 ? hits[0].index : lines.length;
  const headerLines = trimBlank(lines.slice(0, firstHeadingIndex));
  if (headerLines.length > 0) {
    sections.push({ kind: 'header', heading: '', lines: headerLines });
  }

  hits.forEach((hit, i) => {
    const start = hit.index + 1;
    const end = i + 1 < hits.length ? hits[i + 1].index : lines.length;
    const body = lines.slice(start, end);

    if (hit.inlineContent) {
      // Re-inject the content that shared the heading line, keeping the
      // original index so ordering stays stable.
      body.unshift({
        text: hit.inlineContent,
        index: hit.index,
        indent: 0,
        isBullet: false,
        isBlank: false,
      });
    }

    sections.push({ kind: hit.kind, heading: hit.heading, lines: trimBlank(body) });
  });

  return sections;
}

/** Merge every section of a given kind, in document order. */
export function linesOfKind(sections: Section[], kind: SectionKind): Line[] {
  return sections.filter((section) => section.kind === kind).flatMap((section) => section.lines);
}

/** First section of a kind, if present. */
export function findSection(sections: Section[], kind: SectionKind): Section | undefined {
  return sections.find((section) => section.kind === kind);
}
