import type {
  AwardItem,
  CertificateItem,
  InterestItem,
  LanguageItem,
  Line,
  ProjectItem,
  PublicationItem,
  ReferenceItem,
} from '../types.js';
import { splitEntries, toHighlights } from '../segment/entries.js';
import { extractDateRange, stripDates } from '../util/dates.js';
import { extractUrls } from './basics.js';
import { joinLines, splitColumns, trimSeparators } from '../util/lines.js';

/* -------------------------------------------------------------------------- */
/* Languages                                                                  */
/* -------------------------------------------------------------------------- */

/** Proficiency words, ordered so multi-word forms match before their prefixes. */
const FLUENCY = [
  'native or bilingual', 'full professional', 'professional working',
  'limited working', 'elementary', 'native', 'bilingual', 'fluent', 'proficient',
  'advanced', 'intermediate', 'conversational', 'beginner', 'basic', 'mother tongue',
  'c2', 'c1', 'b2', 'b1', 'a2', 'a1',
];

const FLUENCY_PATTERN = new RegExp(`\\b(${FLUENCY.join('|')})\\b`, 'i');

/**
 * Parse a languages section. Handles `English (Native), Spanish - Fluent` on one
 * line as well as one language per line.
 */
export function parseLanguages(lines: Line[]): LanguageItem[] {
  const items: LanguageItem[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (line.isBlank || !line.text) continue;
    // Split on commas only when the line packs several languages together.
    const chunks = line.text.includes(',') && !FLUENCY_PATTERN.test(line.text.split(',')[0])
      ? [line.text]
      : line.text.split(/\s*[,;]\s*(?![^()]*\))/);

    for (const chunk of chunks) {
      const item = toLanguage(chunk);
      if (!item?.language) continue;
      const key = item.language.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }
  return items;
}

function toLanguage(raw: string): LanguageItem | undefined {
  const text = trimSeparators(raw);
  if (!text || text.length > 60) return undefined;

  const fluency = text.match(FLUENCY_PATTERN);
  let language = text;
  if (fluency) {
    language = text.slice(0, fluency.index).replace(/[([{\-–—:]\s*$/, '').trim();
  }
  language = trimSeparators(language.replace(/[()[\]{}]/g, ''));

  if (!language || !/^[A-Za-zÀ-ɏ .'-]{2,30}$/.test(language)) return undefined;
  return fluency ? { language, fluency: titleCase(fluency[1]) } : { language };
}

function titleCase(text: string): string {
  if (/^[a-c][12]$/i.test(text)) return text.toUpperCase();
  return text.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/* -------------------------------------------------------------------------- */
/* Certificates                                                               */
/* -------------------------------------------------------------------------- */

/** Bodies that issue certifications, used to split name from issuer. */
const ISSUER_HINT = /\b(?:amazon\s+web\s+services|aws|microsoft|google|cisco|oracle|comptia|salesforce|pmi|isaca|isc2|\(isc\)²|red\s+hat|vmware|adobe|hashicorp|kubernetes|cncf|scrum\.org|scrum\s+alliance|axelos|linux\s+foundation|databricks|snowflake|tableau)\b/i;

export function parseCertificates(lines: Line[]): CertificateItem[] {
  const items: CertificateItem[] = [];

  for (const entry of splitEntries(lines)) {
    for (const line of [...entry.header, ...entry.body]) {
      const item = toCertificate(line.text);
      if (item?.name) items.push(item);
    }
  }
  return items;
}

function toCertificate(raw: string): CertificateItem | undefined {
  const text = trimSeparators(raw);
  if (!text || text.length < 4) return undefined;

  const item: CertificateItem = {};

  const range = extractDateRange(text);
  if (range?.startDate) item.date = range.startDate;

  const urls = extractUrls(text);
  if (urls.length > 0) item.url = urls[0];

  const withoutDates = stripDates(text).replace(/https?:\/\/\S+/gi, '').trim();
  const fragments = splitColumns(withoutDates);

  if (fragments.length >= 2) {
    const issuerIndex = fragments.findIndex((fragment) => ISSUER_HINT.test(fragment));
    if (issuerIndex > 0) {
      item.issuer = fragments[issuerIndex];
      item.name = fragments.filter((_, i) => i !== issuerIndex).join(' - ');
    } else {
      item.name = fragments[0];
      item.issuer = fragments[1];
    }
  } else {
    item.name = trimSeparators(withoutDates);
  }

  if (!item.name || item.name.length < 3 || item.name.length > 120) return undefined;
  return item;
}

/* -------------------------------------------------------------------------- */
/* Awards                                                                     */
/* -------------------------------------------------------------------------- */

export function parseAwards(lines: Line[]): AwardItem[] {
  const items: AwardItem[] = [];

  for (const entry of splitEntries(lines)) {
    const header = entry.header.map((line) => line.text).join(' ');
    const source = header || entry.body.map((line) => line.text).join(' ');
    if (!source) continue;

    for (const line of entry.header.length > 0 ? entry.header : entry.body) {
      const item = toAward(line.text);
      if (item?.title) {
        const summary = entry.header.length > 0 ? joinLines(entry.body) : '';
        if (summary) item.summary = summary;
        items.push(item);
        break;
      }
    }
  }
  return items;
}

function toAward(raw: string): AwardItem | undefined {
  const text = trimSeparators(raw);
  if (!text || text.length < 3) return undefined;

  const item: AwardItem = {};
  const range = extractDateRange(text);
  if (range?.startDate) item.date = range.startDate;

  const fragments = splitColumns(stripDates(text));
  if (fragments.length === 0) return undefined;

  item.title = fragments[0];
  if (fragments.length > 1) item.awarder = fragments[1];

  if (item.title.length > 150) return undefined;
  return item;
}

/* -------------------------------------------------------------------------- */
/* Projects                                                                   */
/* -------------------------------------------------------------------------- */

export function parseProjects(lines: Line[]): ProjectItem[] {
  const items: ProjectItem[] = [];

  for (const entry of splitEntries(lines)) {
    if (entry.header.length === 0 && entry.body.length === 0) continue;

    const item: ProjectItem = {};
    const headerText = entry.header.map((line) => line.text).join(' ');

    const range = extractDateRange(headerText);
    if (range?.startDate) item.startDate = range.startDate;
    if (range?.endDate) item.endDate = range.endDate;

    const urls = extractUrls(headerText);
    if (urls.length > 0) item.url = urls[0];

    const nameSource = stripDates(headerText).replace(/https?:\/\/\S+/gi, '').trim();
    const fragments = splitColumns(nameSource);
    if (fragments.length > 0) {
      item.name = fragments[0];
      if (fragments.length > 1) item.description = fragments.slice(1).join(' - ');
    }

    const highlights = toHighlights(entry.body);
    if (highlights.length > 0) item.highlights = highlights;

    if (!item.name && highlights.length > 0) {
      // A bullets-only project list: use the first bullet as the name.
      item.name = highlights[0];
      item.highlights = highlights.slice(1);
      if (item.highlights.length === 0) delete item.highlights;
    }

    if (item.name) items.push(item);
  }
  return items;
}

/* -------------------------------------------------------------------------- */
/* Publications, interests, references                                        */
/* -------------------------------------------------------------------------- */

export function parsePublications(lines: Line[]): PublicationItem[] {
  const items: PublicationItem[] = [];

  for (const entry of splitEntries(lines)) {
    const text = [...entry.header, ...entry.body].map((line) => line.text).join(' ');
    if (!text || text.length < 8) continue;

    const item: PublicationItem = {};
    const range = extractDateRange(text);
    if (range?.startDate) item.releaseDate = range.startDate;

    const urls = extractUrls(text);
    if (urls.length > 0) item.url = urls[0];

    const cleaned = stripDates(text).replace(/https?:\/\/\S+/gi, '').trim();
    const fragments = splitColumns(cleaned);
    item.name = fragments[0] ?? cleaned;
    if (fragments.length > 1) item.publisher = fragments[1];

    if (item.name && item.name.length >= 5) items.push(item);
  }
  return items;
}

export function parseInterests(lines: Line[]): InterestItem[] {
  const keywords: string[] = [];
  for (const line of lines) {
    if (line.isBlank || !line.text) continue;
    for (const part of line.text.split(/\s*[,;|·•]\s*/)) {
      const cleaned = trimSeparators(part);
      if (cleaned && cleaned.length <= 40 && /[A-Za-z]/.test(cleaned)) keywords.push(cleaned);
    }
  }
  return keywords.length > 0 ? [{ keywords }] : [];
}

export function parseReferences(lines: Line[]): ReferenceItem[] {
  const text = joinLines(lines);
  if (!text) return [];
  // "References available upon request" is boilerplate, not a reference.
  if (/available\s+(?:up)?on\s+request/i.test(text)) return [];

  return splitEntries(lines)
    .map((entry): ReferenceItem | undefined => {
      const header = entry.header.map((line) => line.text).join(' ');
      const body = joinLines(entry.body);
      const name = splitColumns(header)[0];
      if (!name) return undefined;
      return body ? { name, reference: body } : { name };
    })
    .filter((item): item is ReferenceItem => item !== undefined);
}
