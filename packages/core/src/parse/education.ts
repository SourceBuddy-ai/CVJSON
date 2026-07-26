import type { EducationItem, Line } from '../types.js';
import { splitEntries, toHighlights, type Entry } from '../segment/entries.js';
import { matchDegree, matchScore } from '../lexicon/degrees.js';
import { extractDateRange, stripDates } from '../util/dates.js';
import { splitColumns, trimSeparators } from '../util/lines.js';

/** Words that mark a fragment as the name of a school rather than a degree. */
const INSTITUTION_HINT = /\b(?:university|universität|universite|college|institute|institut|school|academy|polytechnic|seminary|conservatory|gymnasium|hochschule|faculty)\b/i;

/** `Courses: Algorithms, Databases` style lines within an education entry. */
const COURSE_LINE = /^(?:relevant\s+)?(?:course\s?work|courses|classes|modules|subjects)\b[\s:—–-]*(.+)$/i;

export function parseEducation(lines: Line[]): EducationItem[] {
  return splitEntries(lines)
    .map((entry) => toEducationItem(entry))
    .filter((item): item is EducationItem => item !== undefined);
}

function toEducationItem(entry: Entry): EducationItem | undefined {
  const all = [...entry.header, ...entry.body];
  if (all.length === 0) return undefined;

  const item: EducationItem = {};
  const wholeText = all.map((line) => line.text).join(' ');

  // Dates. Education commonly states only a graduation year; a lone date on an
  // education entry is the end date, not the start.
  for (const line of entry.header) {
    const range = extractDateRange(line.text);
    if (!range) continue;
    if (range.startDate && range.endDate) {
      item.startDate = range.startDate;
      item.endDate = range.endDate;
    } else if (range.present) {
      if (range.startDate) item.startDate = range.startDate;
    } else if (range.startDate) {
      item.endDate = range.startDate;
    }
    break;
  }

  const degree = matchDegree(wholeText);
  if (degree) {
    item.studyType = degree.studyType;
    if (degree.area) item.area = degree.area;
  }

  const score = matchScore(wholeText);
  if (score) item.score = score;

  assignInstitution(entry.header, item);

  const courses = collectCourses(all);
  if (courses.length > 0) item.courses = courses;

  if (!item.institution && !item.studyType && !item.area) return undefined;
  return item;
}

function assignInstitution(header: Line[], item: EducationItem): void {
  const fragments: string[] = [];
  for (const line of header) {
    const withoutDates = stripDates(line.text);
    if (!withoutDates) continue;
    for (const fragment of splitColumns(withoutDates)) fragments.push(fragment);
  }

  // A fragment naming a school wins outright.
  const named = fragments.find((fragment) => INSTITUTION_HINT.test(fragment));
  if (named) {
    item.institution = trimSeparators(named);
    return;
  }

  // Otherwise take the first fragment that is not the degree statement itself.
  const nonDegree = fragments.find((fragment) => {
    const degree = matchDegree(fragment);
    // A fragment that is *only* the degree is not the institution; one that
    // merely mentions it ("Stanford University, BS Computer Science") still is.
    return !degree || fragment.replace(/[^A-Za-z]/g, '').length > degree.studyType.length * 3;
  });

  if (nonDegree) item.institution = trimSeparators(nonDegree);
  else if (fragments.length > 0) item.institution = trimSeparators(fragments[0]);
}

function collectCourses(lines: Line[]): string[] {
  const courses: string[] = [];
  for (const line of lines) {
    const match = line.text.match(COURSE_LINE);
    if (!match) continue;
    for (const course of match[1].split(/[,;·•]/)) {
      const cleaned = trimSeparators(course);
      if (cleaned && cleaned.length <= 60) courses.push(cleaned);
    }
  }
  return courses;
}

/**
 * Highlights are not part of the JSON Resume education object, but callers
 * sometimes want the bullet text. Exposed separately rather than bent into the
 * schema.
 */
export function educationHighlights(lines: Line[]): string[][] {
  return splitEntries(lines).map((entry) => toHighlights(entry.body));
}
