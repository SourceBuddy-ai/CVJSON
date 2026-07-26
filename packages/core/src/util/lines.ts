import type { Line } from '../types.js';

/**
 * Bullet glyphs that PDF and DOCX extraction leave at the start of list items.
 *
 * Dedicated glyphs (`•`, `▪`, …) are unambiguous and stand alone. ASCII
 * characters that merely *serve* as bullets (`-`, `*`, `+`, `>`) must be
 * followed by whitespace, otherwise a line beginning `+44 20 …` would lose its
 * country code and a line beginning `-5% churn` would lose its sign.
 */
const BULLET_GLYPHS = /^[\s]*(?:[•·▪▫◦‣⁃∙◾◽●○■□]|[-*+>–—](?=\s))\s*/;

/**
 * Ligatures and lookalike characters that PDF text layers emit. Normalising
 * these early means every downstream regex can assume plain ASCII punctuation.
 */
const CHARACTER_FIXES: Array<[RegExp, string]> = [
  [/ﬀ/g, 'ff'],
  [/ﬁ/g, 'fi'],
  [/ﬂ/g, 'fl'],
  [/ﬃ/g, 'ffi'],
  [/ﬄ/g, 'ffl'],
  [/[‘’‚‛′]/g, "'"],
  [/[“”„‟″]/g, '"'],
  [/…/g, '...'],
  [/ /g, ' '],
  [/[​-‍﻿]/g, ''],
];

/** Apply character-level normalisation to raw extracted text. */
export function normalizeText(raw: string): string {
  let text = raw.replace(/\r\n?/g, '\n');
  for (const [pattern, replacement] of CHARACTER_FIXES) {
    text = text.replace(pattern, replacement);
  }
  // Collapse runs of 3+ blank lines; they carry no extra structure and only
  // make the blank-line entry-splitting heuristics noisier.
  return text.replace(/\n{3,}/g, '\n\n');
}

/**
 * Split normalised text into the {@link Line} model used by every downstream
 * stage. Bullet glyphs are stripped from `text` and recorded as `isBullet`, so
 * parsers can match on content without each of them re-handling glyph variants.
 */
export function toLines(text: string): Line[] {
  return normalizeText(text)
    .split('\n')
    .map((raw, index) => {
      const withoutTabs = raw.replace(/\t/g, '    ');
      const indent = withoutTabs.length - withoutTabs.trimStart().length;
      const isBullet = BULLET_GLYPHS.test(withoutTabs);
      const stripped = isBullet ? withoutTabs.replace(BULLET_GLYPHS, '') : withoutTabs;
      const cleaned = stripped.replace(/\s{2,}/g, ' ').trim();
      return {
        text: cleaned,
        index,
        indent,
        isBullet,
        isBlank: !/\w/.test(cleaned),
      };
    });
}

/** True when the line is styled like a heading: short, and upper-case or title-case. */
export function looksLikeHeading(line: Line): boolean {
  const { text } = line;
  if (!text || text.length > 60) return false;
  if (line.isBullet) return false;
  // A trailing period means prose, not a heading.
  if (/[.;]$/.test(text)) return false;
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length < 2) return false;
  const upperRatio = (text.match(/[A-Z]/g) ?? []).length / letters.length;
  return upperRatio > 0.8 || wordCount(text) <= 4;
}

export function wordCount(text: string): number {
  const words = text.trim().match(/\S+/g);
  return words ? words.length : 0;
}

/** Drop trailing/leading separator punctuation left behind by field splitting. */
export function trimSeparators(text: string): string {
  return text.replace(/^[\s|·•,;:\-–—]+/, '').replace(/[\s|·•,;:\-–—]+$/, '').trim();
}

/**
 * Split a line on the column separators resumes use to pack several fields onto
 * one line: `Acme Corp | Senior Engineer | Remote`.
 *
 * Hyphens are deliberately excluded — they appear inside real values
 * ("Hewlett-Packard", "full-stack") far more often than they separate columns.
 */
export function splitColumns(text: string): string[] {
  return text
    .split(/\s*[|•·]\s*|\s{3,}|\s+[–—]\s+/)
    .map((part) => trimSeparators(part))
    .filter((part) => part.length > 0);
}

/** Collapse a run of lines into a single paragraph string. */
export function joinLines(lines: Line[]): string {
  return lines
    .filter((line) => !line.isBlank)
    .map((line) => line.text)
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Remove leading and trailing blank lines from a run. */
export function trimBlank(lines: Line[]): Line[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].isBlank) start += 1;
  while (end > start && lines[end - 1].isBlank) end -= 1;
  return lines.slice(start, end);
}
