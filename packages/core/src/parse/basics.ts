import type { Basics, Line, Location, Profile } from '../types.js';
import { CA_PROVINCES, isRegionCode, lookupCountry, REMOTE_MARKERS } from '../lexicon/places.js';
import { joinLines, splitColumns, trimSeparators, wordCount } from '../util/lines.js';
import { looksLikeRole } from '../lexicon/roles.js';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Phone numbers, permissive on formatting but anchored so we do not match the
 * digits inside a date range or a street address. Validated afterwards by digit
 * count — see {@link cleanPhone}.
 */
const PHONE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]\d{2,4}){1,4}/g;

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s,;|)<>\]]+|(?:[a-z0-9-]+\.)+(?:com|io|dev|net|org|me|co|ai|app|xyz|tech|design|page|site)(?:\/[^\s,;|)<>\]]*)?/gi;

/** Known profile hosts, mapped to the network label JSON Resume expects. */
const NETWORKS: Array<{ pattern: RegExp; network: string }> = [
  { pattern: /(?:^|\.)linkedin\.com/i, network: 'LinkedIn' },
  { pattern: /(?:^|\.)github\.com/i, network: 'GitHub' },
  { pattern: /(?:^|\.)gitlab\.com/i, network: 'GitLab' },
  { pattern: /(?:^|\.)(?:twitter\.com|x\.com)/i, network: 'Twitter' },
  { pattern: /(?:^|\.)stackoverflow\.com/i, network: 'Stack Overflow' },
  { pattern: /(?:^|\.)medium\.com/i, network: 'Medium' },
  { pattern: /(?:^|\.)dribbble\.com/i, network: 'Dribbble' },
  { pattern: /(?:^|\.)behance\.net/i, network: 'Behance' },
  { pattern: /(?:^|\.)kaggle\.com/i, network: 'Kaggle' },
  { pattern: /(?:^|\.)youtube\.com/i, network: 'YouTube' },
  { pattern: /(?:^|\.)scholar\.google\./i, network: 'Google Scholar' },
  { pattern: /(?:^|\.)orcid\.org/i, network: 'ORCID' },
];

/**
 * Tokens that disqualify a line from being the candidate's name. These are the
 * words that appear on the *other* header lines — titles, contact labels and
 * document furniture.
 */
const NOT_A_NAME = new RegExp(
  [
    'curriculum\\s+vitae', '\\bresume\\b', '\\bcv\\b',
    'phone', 'email', 'e-mail', 'mobile', 'cell', 'tel\\b', 'address',
    'engineer', 'developer', 'manager', 'director', 'analyst', 'designer',
    'consultant', 'specialist', 'architect', 'scientist', 'administrator',
    'coordinator', 'president', 'officer', 'lead\\b', 'senior', 'junior',
    'intern\\b', 'student', 'professor', 'freelance', 'contractor',
  ].join('|'),
  'i',
);

/** Suffixes that are part of a name but should not block detection. */
const NAME_SUFFIX = /\b(?:jr|sr|ii|iii|iv|phd|ph\.d|md|mba|msc|bsc|ba|bs|ms|cpa|pmp|pe)\b\.?,?/gi;

function cleanPhone(raw: string): string | undefined {
  const trimmed = raw.trim().replace(/[.,;]$/, '');
  const digits = trimmed.replace(/\D/g, '');
  // Below 7 digits it is an extension or a year range; above 15 it exceeds E.164.
  if (digits.length < 7 || digits.length > 15) return undefined;
  // Reject pure date ranges such as "2018 2022" that slipped through.
  if (/^(?:19|20)\d{2}(?:19|20)\d{2}$/.test(digits)) return undefined;
  return trimmed.replace(/\s{2,}/g, ' ');
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim().replace(/[.,;:]$/, '');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function profileFromUrl(url: string): Profile | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return undefined;
  }
  const match = NETWORKS.find((entry) => entry.pattern.test(host));
  if (!match) return undefined;

  let username: string | undefined;
  try {
    const path = new URL(url).pathname.replace(/^\/+|\/+$/g, '').split('/');
    // LinkedIn nests the handle under /in/ or /pub/; everyone else puts it first.
    const segments = path.filter(Boolean);
    if (/linkedin/i.test(host)) {
      const idx = segments.findIndex((s) => s === 'in' || s === 'pub');
      username = idx >= 0 ? segments[idx + 1] : undefined;
    } else {
      username = segments[0];
    }
  } catch {
    username = undefined;
  }

  return { network: match.network, username, url };
}

export function extractEmail(text: string): string | undefined {
  const matches = text.match(EMAIL);
  if (!matches) return undefined;
  // Prefer a personal-looking address over a company one embedded in prose.
  return matches[0].replace(/[.,;]$/, '').toLowerCase();
}

export function extractPhone(text: string): string | undefined {
  // Remove emails and URLs first: both contain digit runs that look phone-ish.
  const scrubbed = text.replace(EMAIL, ' ').replace(URL_PATTERN, ' ');
  const matches = scrubbed.match(PHONE);
  if (!matches) return undefined;
  for (const candidate of matches) {
    const cleaned = cleanPhone(candidate);
    if (cleaned) return cleaned;
  }
  return undefined;
}

export function extractUrls(text: string): string[] {
  // Blank out email addresses first. Their domain (`example.com`) matches the
  // bare-domain half of URL_PATTERN, which would otherwise turn every resume's
  // email into a spurious personal website.
  const matches = text.replace(EMAIL, ' ').match(URL_PATTERN);
  if (!matches) return [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const raw of matches) {
    // The URL pattern can clip an email's domain; skip anything preceded by '@'.
    const normalized = normalizeUrl(raw);
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(normalized);
  }
  return urls;
}

/**
 * Parse a `City, ST`, `City, Country` or `City, ST 94107` fragment.
 * Returns `undefined` when the fragment is not location-shaped.
 */
export function parseLocation(fragment: string): Location | undefined {
  const text = trimSeparators(fragment);
  if (!text || text.length > 60) return undefined;

  if (REMOTE_MARKERS.has(text.toLowerCase())) return { city: text };

  // `Head of Product, Consumer` is comma-separated and word-shaped, so without
  // this guard it would parse as a city and region. A job title is never a
  // place.
  if (looksLikeRole(text)) return undefined;

  const parts = text.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) {
    // A bare country name still gives us a country code.
    const solo = lookupCountry(text);
    return solo ? { countryCode: solo } : undefined;
  }

  const [city, ...rest] = parts;
  // A city should read as words, not a sentence fragment with digits.
  if (!/^[A-Za-z .'À-ɏ-]{2,40}$/.test(city)) return undefined;

  const location: Location = { city };
  const tail = rest.join(' ').trim();

  // `CA 94107` or `CA` or `ON M5V 2T6`
  const regionZip = tail.match(/^([A-Za-z]{2})\.?\s*([A-Z0-9][A-Z0-9\s-]{2,9})?$/i);
  if (regionZip && isRegionCode(regionZip[1])) {
    const region = regionZip[1].toUpperCase();
    location.region = region;
    if (regionZip[2]) location.postalCode = regionZip[2].trim();
    // The US and Canadian abbreviation sets are disjoint, so the region code
    // alone identifies the country.
    location.countryCode = CA_PROVINCES.has(region) ? 'CA' : 'US';
    return location;
  }

  const country = lookupCountry(tail);
  if (country) {
    location.countryCode = country;
    return location;
  }

  // `City, Region, Country`
  if (rest.length >= 2) {
    const last = lookupCountry(rest[rest.length - 1]);
    if (last) {
      location.region = rest.slice(0, -1).join(', ');
      location.countryCode = last;
      return location;
    }
  }

  // `City, Region` where the region is not a code we recognise. Kept narrow —
  // both halves must be one or two words — because any looser rule turns
  // ordinary comma-separated prose into a location.
  if (
    rest.length === 1 &&
    /^[A-Za-z .'À-ɏ-]{2,40}$/.test(rest[0]) &&
    wordCount(city) <= 2 &&
    wordCount(rest[0]) <= 2
  ) {
    location.region = rest[0];
    return location;
  }

  return undefined;
}

/**
 * Find the candidate's name in the header block.
 *
 * Resumes put the name first and style it larger, but text extraction discards
 * font size — so we score the first handful of lines on shape instead: a short
 * run of capitalised words, free of digits, contact punctuation and role nouns.
 */
export function extractName(headerLines: Line[]): string | undefined {
  const candidates = headerLines.filter((line) => !line.isBlank).slice(0, 8);

  for (const line of candidates) {
    // A packed header line ("John Smith | j@x.com") still starts with the name.
    for (const fragment of [line.text, ...splitColumns(line.text)]) {
      const name = scoreAsName(fragment);
      if (name) return name;
    }
  }
  return undefined;
}

function scoreAsName(fragment: string): string | undefined {
  const text = trimSeparators(fragment);
  if (!text || text.length > 50) return undefined;
  if (/[@\d]/.test(text)) return undefined;
  if (/https?:|www\./i.test(text)) return undefined;
  if (NOT_A_NAME.test(text)) return undefined;

  const stripped = text.replace(NAME_SUFFIX, '').replace(/,\s*$/, '').trim();
  const words = stripped.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return undefined;

  // Every word must be a capitalised token, an initial, or a particle.
  const particles = new Set(['de', 'del', 'della', 'van', 'von', 'der', 'den', 'la', 'le', 'bin', 'al', 'da', 'dos']);
  const ok = words.every((word) => {
    if (particles.has(word.toLowerCase())) return true;
    if (/^[A-Z]\.?$/.test(word)) return true;
    return /^[A-ZÀ-ɏ][A-Za-zÀ-ɏ'-]*\.?$/.test(word) || /^[A-ZÀ-ɏ'-]{2,}$/.test(word);
  });
  if (!ok) return undefined;

  return stripped;
}

/**
 * Build the `basics` block from the header section and, for the summary, from
 * whichever section the segmenter labelled `summary`.
 */
export function parseBasics(headerLines: Line[], summaryLines: Line[]): Basics {
  const headerText = headerLines.map((line) => line.text).join('\n');
  const basics: Basics = {};

  const name = extractName(headerLines);
  if (name) basics.name = name;

  const email = extractEmail(headerText);
  if (email) basics.email = email;

  const phone = extractPhone(headerText);
  if (phone) basics.phone = phone;

  const urls = extractUrls(headerText);
  const profiles: Profile[] = [];
  let siteUrl: string | undefined;
  for (const url of urls) {
    const profile = profileFromUrl(url);
    if (profile) {
      if (!profiles.some((p) => p.network === profile.network)) profiles.push(profile);
    } else if (!siteUrl) {
      siteUrl = url;
    }
  }
  if (profiles.length > 0) basics.profiles = profiles;
  if (siteUrl) basics.url = siteUrl;

  const location = findLocation(headerLines);
  if (location) basics.location = location;

  const label = findLabel(headerLines, name);
  if (label) basics.label = label;

  const summary = joinLines(summaryLines);
  if (summary) basics.summary = summary;

  return basics;
}

function findLocation(headerLines: Line[]): Location | undefined {
  for (const line of headerLines) {
    if (line.isBlank) continue;
    for (const fragment of splitColumns(line.text)) {
      const location = parseLocation(fragment);
      if (location?.city || location?.countryCode) return location;
    }
    const whole = parseLocation(line.text);
    if (whole?.city || whole?.countryCode) return whole;
  }
  return undefined;
}

/**
 * The professional label is the role line that sits directly under the name —
 * "Senior Software Engineer". We look for a short line containing a role noun,
 * skipping the name line itself and anything carrying contact details.
 */
function findLabel(headerLines: Line[], name: string | undefined): string | undefined {
  for (const line of headerLines.filter((l) => !l.isBlank).slice(0, 6)) {
    const text = trimSeparators(line.text);
    if (!text || text === name) continue;
    if (/[@]|https?:|www\./i.test(text)) continue;
    if (/\d{3}/.test(text)) continue;
    if (text.length > 70 || wordCount(text) > 8) continue;
    if (!NOT_A_NAME.test(text)) continue;
    // NOT_A_NAME also matches the literal words "resume"/"cv"; exclude those.
    if (/^(?:resume|curriculum\s+vitae|cv)$/i.test(text)) continue;
    if (/phone|email|e-mail|mobile|cell|address/i.test(text)) continue;
    return text;
  }
  return undefined;
}
