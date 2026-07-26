import type { Line } from '../types.js';
import { hasDateToken } from '../util/dates.js';
import { trimBlank } from '../util/lines.js';

/**
 * One item within a repeating section — a single job, degree or project.
 *
 * `header` holds the leading non-bullet lines (company, title, dates); `body`
 * holds the bullet list and any prose beneath it.
 */
export interface Entry {
  header: Line[];
  body: Line[];
}

/**
 * True when a line is the visual continuation of the one above rather than a
 * new thought — the shape a long bullet takes when it wraps.
 *
 * Used in two places that must agree: entry splitting (a wrapped bullet must
 * not start a new job) and highlight assembly (the halves must be rejoined).
 */
function isContinuation(line: Line): boolean {
  if (line.isBullet) return false;
  return /^[a-z(]/.test(line.text) || /^(?:and|or|to|with|for|by|in|of|the)\b/i.test(line.text);
}

/**
 * Split a section's lines into entries.
 *
 * Resumes give no machine-readable entry delimiter, so we infer boundaries from
 * three signals, in priority order:
 *
 *  1. A non-bullet line following a bullet run. Bullets are an entry's body, so
 *     plain text after them starts the next entry.
 *  2. A second dated line. Each job states its dates once; a new date means a
 *     new job. Dated lines *within* the first two lines of an entry are treated
 *     as part of that entry's header instead.
 *  3. A blank-line gap after the entry already has content.
 *
 * The rules are deliberately conservative: over-splitting scatters one job
 * across several records, which is far more damaging downstream than merging
 * two short entries.
 */
export function splitEntries(lines: Line[]): Entry[] {
  const cleaned = trimBlank(lines);
  if (cleaned.length === 0) return [];

  const entries: Entry[] = [];
  let current: Line[] = [];
  let sawBullet = false;
  let sawDate = false;
  let gap = false;

  const flush = (): void => {
    const trimmed = trimBlank(current);
    if (trimmed.length > 0) entries.push(toEntry(trimmed));
    current = [];
    sawBullet = false;
    sawDate = false;
  };

  for (const line of cleaned) {
    if (line.isBlank) {
      gap = true;
      if (current.length > 0) current.push(line);
      continue;
    }

    if (line.isBullet) {
      sawBullet = true;
      gap = false;
      current.push(line);
      continue;
    }

    const dated = hasDateToken(line.text);
    const headerLength = current.filter((l) => !l.isBlank && !l.isBullet).length;

    const startsNew =
      current.length > 0 &&
      !isContinuation(line) &&
      (sawBullet ||
        (dated && sawDate) ||
        (gap && (sawDate || headerLength >= 2)));

    if (startsNew) flush();

    if (dated) sawDate = true;
    gap = false;
    current.push(line);
  }

  flush();
  return entries;
}

/**
 * Where an entry's header ends and its body begins.
 *
 * A bullet glyph is the obvious marker, but plenty of resumes — and most PDF
 * text layers, which drop the glyph entirely — indent achievements as plain
 * lines instead. So a long, separator-free, date-free line is also treated as
 * body: header lines are short labels (company, title, location) or carry a
 * date range, never a full sentence.
 */
function isBodyLine(line: Line): boolean {
  if (line.isBullet) return true;
  if (hasDateToken(line.text)) return false;
  if (/[|·•]/.test(line.text)) return false;
  const words = line.text.trim().match(/\S+/g);
  return (words?.length ?? 0) >= 7;
}

function toEntry(lines: Line[]): Entry {
  const content = lines.filter((line) => !line.isBlank);
  // Start scanning at 1 so an entry always keeps at least one header line, even
  // when it opens with a sentence.
  let boundary = content.length;
  for (let i = 1; i < content.length; i += 1) {
    if (isBodyLine(content[i])) {
      boundary = i;
      break;
    }
  }
  return { header: content.slice(0, boundary), body: content.slice(boundary) };
}

/**
 * Turn an entry's body into discrete highlight strings, re-joining lines that
 * are visual wraps of the preceding bullet rather than new points.
 *
 * A line continues the previous bullet when it is not itself bulleted and
 * begins lower-case or with a joining word — the shape PDF extraction produces
 * when a long bullet spills onto a second line.
 */
export function toHighlights(body: Line[]): string[] {
  const highlights: string[] = [];
  for (const line of body) {
    if (!line.text) continue;
    if (highlights.length > 0 && isContinuation(line)) {
      highlights[highlights.length - 1] = `${highlights[highlights.length - 1]} ${line.text}`.replace(/\s{2,}/g, ' ');
    } else {
      highlights.push(line.text);
    }
  }
  return highlights.map((h) => h.replace(/\s*[;,]\s*$/, '').trim()).filter(Boolean);
}
