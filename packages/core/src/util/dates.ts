import type { Iso8601 } from '../types.js';

/**
 * Resume date handling.
 *
 * Resumes state dates in every format a human might type, and almost never with
 * day precision. We normalise to the coarsest ISO 8601 form that the source
 * actually supports (`2020`, `2020-06`, `2020-06-01`) rather than inventing a
 * day, because a fabricated `-01` reads as real data downstream.
 */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/** Words a resume uses to mean "this role has no end date". */
const PRESENT_WORDS = new Set([
  'present', 'current', 'currently', 'now', 'today', 'ongoing', 'to date', 'date',
]);

/** Dash variants used as range separators, plus the word forms. */
const RANGE_SEPARATOR = /\s*(?:--|[-–—‒―]|\bto\b|\bthrough\b|\buntil\b)\s*/i;

const MONTH_NAMES = Object.keys(MONTHS).join('|');

/**
 * A single date token: `Jan 2020`, `January 2020`, `01/2020`, `2020-01`, `2020`,
 * `Present`. Anchored by the caller as needed.
 */
const DATE_TOKEN = new RegExp(
  [
    // Month-name forms, optional separator, 2- or 4-digit year: "Jan 2020", "Jan. '20", "January, 2020"
    `(?:(?:${MONTH_NAMES})\\.?,?\\s*'?\\d{2,4})`,
    // Numeric month/year: "01/2020", "1-2020", "01.2020"
    `(?:\\d{1,2}\\s*[\\/.\\-]\\s*\\d{2,4})`,
    // ISO-ish: "2020-01", "2020/01", "2020-01-15"
    `(?:\\d{4}\\s*[\\/\\-]\\s*\\d{1,2}(?:\\s*[\\/\\-]\\s*\\d{1,2})?)`,
    // Bare year, 19xx/20xx only so we don't swallow "500" or a street number
    `(?:(?:19|20)\\d{2})`,
    // Open-ended markers
    `(?:${[...PRESENT_WORDS].join('|')})`,
  ].join('|'),
  'i',
);

/**
 * Global variant, for `match`/`replace` only.
 *
 * Never call `.test()` on this: a global regex carries `lastIndex` between
 * calls, so a shared instance would return alternating results. Use
 * {@link hasDateToken} instead.
 */
const DATE_TOKEN_G = new RegExp(DATE_TOKEN.source, 'gi');

const RANGE_SEPARATOR_G = new RegExp(RANGE_SEPARATOR.source, 'gi');

/** Stateless "does this string contain a date token?" check. */
export function hasDateToken(text: string): boolean {
  return DATE_TOKEN.test(text);
}

export interface DateRange {
  startDate?: Iso8601;
  endDate?: Iso8601;
  /** True when the range explicitly ends in "Present"/"Current"/etc. */
  present: boolean;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Expand a 2-digit year the way a resume reader would: `'98` is 1998, `'12` is
 * 2012. The pivot is "more than 5 years in the future is a typo for last
 * century", which keeps recent grad dates correct without mangling 1990s roles.
 */
function expandYear(raw: number): number {
  if (raw >= 100) return raw;
  const currentTwoDigit = new Date().getUTCFullYear() % 100;
  return raw <= currentTwoDigit + 5 ? 2000 + raw : 1900 + raw;
}

export function isPresent(token: string): boolean {
  return PRESENT_WORDS.has(token.trim().toLowerCase().replace(/[.,]/g, ''));
}

/**
 * Normalise a single date token to ISO 8601.
 *
 * Returns `undefined` for tokens that mean "no end date" (callers should check
 * {@link isPresent} first) and for anything unrecognisable.
 */
export function normalizeDate(input: string): Iso8601 | undefined {
  const token = input.trim().replace(/[,.]$/, '');
  if (!token || isPresent(token)) return undefined;

  // "Jan 2020" / "January '20"
  const named = token.match(new RegExp(`^(${MONTH_NAMES})\\.?,?\\s*'?(\\d{2,4})$`, 'i'));
  if (named) {
    const month = MONTHS[named[1].toLowerCase()];
    const year = expandYear(parseInt(named[2], 10));
    return `${year}-${pad(month)}`;
  }

  // "2020-01-15" / "2020/01/15"
  const isoFull = token.match(/^(\d{4})\s*[/-]\s*(\d{1,2})\s*[/-]\s*(\d{1,2})$/);
  if (isoFull) {
    const [, y, m, d] = isoFull;
    const month = parseInt(m, 10);
    const day = parseInt(d, 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${y}-${pad(month)}-${pad(day)}`;
    }
  }

  // "2020-01" / "2020/1"
  const isoMonth = token.match(/^(\d{4})\s*[/-]\s*(\d{1,2})$/);
  if (isoMonth) {
    const month = parseInt(isoMonth[2], 10);
    if (month >= 1 && month <= 12) return `${isoMonth[1]}-${pad(month)}`;
  }

  // "01/2020" / "1-20". Ambiguous with day/month, but a resume writing "03/2019"
  // means March 2019 — day-level precision essentially never appears here.
  const numeric = token.match(/^(\d{1,2})\s*[/.\-]\s*(\d{2,4})$/);
  if (numeric) {
    const month = parseInt(numeric[1], 10);
    const year = expandYear(parseInt(numeric[2], 10));
    if (month >= 1 && month <= 12) return `${year}-${pad(month)}`;
  }

  // Bare year
  const bare = token.match(/^((?:19|20)\d{2})$/);
  if (bare) return bare[1];

  return undefined;
}

/**
 * Pull a start/end range out of a line.
 *
 * Handles "Jan 2020 – Present", "2018-2022", "May 2019 to Aug 2021", and lines
 * where the range is embedded in other text ("Acme Corp | 2018 – 2020 | Remote").
 * Returns `undefined` when the line carries no usable date.
 */
export function extractDateRange(line: string): DateRange | undefined {
  const tokens = line.match(DATE_TOKEN_G);
  if (!tokens || tokens.length === 0) return undefined;

  // Prefer an explicit separator: it tells us the two tokens are one range
  // rather than two unrelated dates that happen to share a line.
  const separated = splitOnSeparator(line);
  if (separated) return separated;

  if (tokens.length >= 2) {
    const start = normalizeDate(tokens[0]);
    const endToken = tokens[1];
    if (isPresent(endToken)) return { startDate: start, present: true };
    const end = normalizeDate(endToken);
    if (start || end) return { startDate: start, endDate: end, present: false };
  }

  const only = tokens[0];
  if (isPresent(only)) return { present: true };
  const single = normalizeDate(only);
  if (!single) return undefined;
  // A lone date on an entry line is conventionally the end/completion date for
  // education and the start for work; the caller decides which, so report it as
  // a start and let them move it.
  return { startDate: single, present: false };
}

function splitOnSeparator(line: string): DateRange | undefined {
  // Find "<date> <sep> <date>" anywhere in the line.
  const pattern = new RegExp(
    `(${DATE_TOKEN.source})${RANGE_SEPARATOR.source}(${DATE_TOKEN.source})`,
    'i',
  );
  const match = line.match(pattern);
  if (!match) return undefined;

  const [, startToken, endToken] = match;
  const startDate = normalizeDate(startToken);
  if (isPresent(endToken)) return { startDate, present: true };
  return { startDate, endDate: normalizeDate(endToken), present: false };
}

/** True when the line's content is mostly a date range — a strong entry-boundary signal. */
export function isDateLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (!hasDateToken(trimmed)) return false;
  const withoutDates = trimmed.replace(DATE_TOKEN_G, '').replace(RANGE_SEPARATOR_G, '');
  const residue = withoutDates.replace(/[\s|·•,\-–—()]/g, '');
  return residue.length <= 3;
}

/** Strip any date tokens and range separators from a line, for cleaning titles. */
export function stripDates(line: string): string {
  return line
    .replace(new RegExp(`(${DATE_TOKEN.source})${RANGE_SEPARATOR.source}(${DATE_TOKEN.source})`, 'gi'), '')
    .replace(DATE_TOKEN_G, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s*[|·•]\s*$/, '')
    .replace(/^\s*[|·•,\-–—]\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/[,\-–—|·•]\s*$/, '')
    .trim();
}
