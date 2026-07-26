import type { Line, WorkItem } from '../types.js';
import { splitEntries, toHighlights, type Entry } from '../segment/entries.js';
import { extractDateRange, hasDateToken, stripDates } from '../util/dates.js';
import { parseLocation } from './basics.js';
import { roleAffinity } from '../lexicon/roles.js';
import { splitColumns, trimSeparators } from '../util/lines.js';

/** `Senior Engineer at Acme Corp` / `Engineer @ Beta` — an explicit role/company split. */
const AT_SEPARATOR = /^(.{2,60}?)\s+(?:at|@|,\s*with)\s+(.{2,60})$/i;

/**
 * Parse a work-experience section into JSON Resume `work` items.
 */
export function parseWork(lines: Line[]): WorkItem[] {
  return splitEntries(lines)
    .map((entry) => toWorkItem(entry))
    .filter((item): item is WorkItem => item !== undefined);
}

function toWorkItem(entry: Entry): WorkItem | undefined {
  if (entry.header.length === 0 && entry.body.length === 0) return undefined;

  const item: WorkItem = {};

  // Dates: scan header lines, take the first line that yields a range.
  for (const line of entry.header) {
    const range = extractDateRange(line.text);
    if (!range) continue;
    if (range.startDate) item.startDate = range.startDate;
    if (range.endDate) item.endDate = range.endDate;
    // "Present" is expressed in JSON Resume by omitting endDate; recording it
    // explicitly would claim the role ended today.
    break;
  }

  assignNameAndPosition(entry.header, item);

  const highlights = toHighlights(entry.body);
  if (highlights.length > 0) item.highlights = highlights;

  // An entry with neither an employer nor any content is extraction noise.
  if (!item.name && !item.position && !item.highlights) return undefined;
  return item;
}

/**
 * Work out which header fragments are the employer, the job title and the
 * location.
 *
 * Resumes use every permutation — company first, title first, both on one line
 * separated by a pipe, or joined by "at" — so we split each header line into
 * fragments, drop the dates, and assign fragments by their role-vs-company
 * affinity rather than by position.
 */
function assignNameAndPosition(header: Line[], item: WorkItem): void {
  const fragments: string[] = [];

  for (const line of header) {
    const withoutDates = stripDates(line.text);
    if (!withoutDates) continue;

    // Handle "Title at Company" before column splitting, since "at" is not a
    // column separator and the two halves are already labelled by it.
    const atMatch = withoutDates.match(AT_SEPARATOR);
    if (atMatch) {
      const [, left, right] = atMatch;
      if (!item.position) item.position = trimSeparators(left);
      if (!item.name) item.name = trimSeparators(right);
      continue;
    }

    for (const fragment of splitColumns(withoutDates)) {
      if (fragment.length > 0) fragments.push(fragment);
    }
  }

  // Pull out anything that parses as a location before ranking the rest.
  const remaining: string[] = [];
  for (const fragment of fragments) {
    if (!item.location) {
      const location = parseLocation(fragment);
      if (location?.city || location?.countryCode) {
        item.location = fragment;
        continue;
      }
    }
    remaining.push(fragment);
  }

  if (remaining.length === 0) return;

  const scored = remaining.map((text, index) => ({ text, index, affinity: roleAffinity(text) }));

  // Take the clearest positive signal for the title and the clearest negative
  // one for the employer. Ties fall back to document order.
  const byRole = scored
    .filter((entry) => entry.affinity > 0)
    .sort((a, b) => b.affinity - a.affinity || a.index - b.index);
  const byCompany = scored
    .filter((entry) => entry.affinity < 0)
    .sort((a, b) => a.affinity - b.affinity || a.index - b.index);

  if (!item.position && byRole.length > 0) item.position = byRole[0].text;
  if (!item.name && byCompany.length > 0) item.name = byCompany[0].text;

  // Assign whatever the lexicon had no opinion on, in document order. Resumes
  // lead with the employer more often than with the title, so an unclaimed
  // neutral fragment becomes the employer first.
  const claimed = new Set([item.position, item.name].filter(Boolean));
  const leftovers = scored
    .filter((entry) => !claimed.has(entry.text))
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.text);

  if (!item.name && leftovers.length > 0) item.name = leftovers.shift();
  if (!item.position && leftovers.length > 0) item.position = leftovers.shift();

  splitCombinedFragment(item);
}

/**
 * Recover an employer from a fragment that carries both fields separated by a
 * comma: `Graphic Designer, Self-Employed`.
 *
 * Commas are not treated as column separators generally — they appear inside
 * single values far too often ("Deliveroo, Inc.", "Head of Product, Consumer")
 * — so this runs only as a last resort, when one field was filled and the other
 * was left empty, and only when the two halves disagree about being a role.
 */
function splitCombinedFragment(item: WorkItem): void {
  const combined = item.position && !item.name ? item.position : undefined;
  if (!combined) return;

  const parts = combined.split(',').map((part) => trimSeparators(part)).filter(Boolean);
  if (parts.length !== 2) return;

  const [left, right] = parts;
  const leftIsRole = roleAffinity(left) > 0;
  const rightIsRole = roleAffinity(right) > 0;
  if (leftIsRole === rightIsRole) return;

  item.position = leftIsRole ? left : right;
  item.name = leftIsRole ? right : left;
}

/**
 * Some resumes place freelance or volunteer work under the main experience
 * heading. Exposed so callers can re-classify entries after parsing.
 */
export function looksVolunteer(item: WorkItem): boolean {
  const haystack = `${item.name ?? ''} ${item.position ?? ''}`.toLowerCase();
  return /\bvolunteer|\bpro\s?bono|\bunpaid\b/.test(haystack);
}

/** True when a section's lines carry enough date structure to parse as work history. */
export function hasWorkStructure(lines: Line[]): boolean {
  return lines.some((line) => !line.isBullet && hasDateToken(line.text));
}
