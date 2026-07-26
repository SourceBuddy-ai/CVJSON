import type { SectionKind } from '../types.js';

/**
 * Section heading lexicon.
 *
 * Keys are normalised headings (lower-cased, punctuation and filler words
 * removed — see `normalizeHeading`). Order within a kind does not matter; the
 * lookup is exact-match first, then a prefix scan, so more specific phrasings
 * must also be listed explicitly rather than relying on substring luck.
 */
const HEADINGS: Record<string, SectionKind> = {};

function register(kind: SectionKind, variants: string[]): void {
  for (const variant of variants) {
    HEADINGS[normalizeHeading(variant)] = kind;
  }
}

register('work', [
  'experience',
  'work experience',
  'work history',
  'employment',
  'employment history',
  'professional experience',
  'professional background',
  'professional history',
  'relevant experience',
  'career history',
  'career summary',
  'career experience',
  'industry experience',
  'work',
  'positions held',
  'appointments',
  'professional appointments',
  'engineering experience',
  'technical experience',
  'related experience',
  'additional experience',
  'other experience',
]);

register('education', [
  'education',
  'academic background',
  'academic history',
  'academic qualifications',
  'education and training',
  'education training',
  'educational background',
  'qualifications',
  'academics',
  'degrees',
  'schooling',
]);

register('skills', [
  'skills',
  'technical skills',
  'core skills',
  'key skills',
  'core competencies',
  'competencies',
  'areas of expertise',
  'expertise',
  'proficiencies',
  'technical proficiencies',
  'technologies',
  'tech stack',
  'tools',
  'tools and technologies',
  'skills and tools',
  'skill highlights',
  'strengths',
  'capabilities',
]);

register('summary', [
  'summary',
  'professional summary',
  'executive summary',
  'career summary',
  'profile',
  'professional profile',
  'personal profile',
  'about',
  'about me',
  'objective',
  'career objective',
  'professional objective',
  'overview',
  'introduction',
  'highlights',
  'career highlights',
]);

register('projects', [
  'projects',
  'personal projects',
  'side projects',
  'selected projects',
  'key projects',
  'notable projects',
  'project experience',
  'portfolio',
  'open source',
  'open source contributions',
]);

register('certificates', [
  'certifications',
  'certificates',
  'licenses',
  'licences',
  'licenses and certifications',
  'certifications and licenses',
  'professional certifications',
  'accreditations',
  'credentials',
]);

register('awards', [
  'awards',
  'honors',
  'honours',
  'awards and honors',
  'honors and awards',
  'academic awards',
  'academic honors',
  'academic honours',
  'academic achievements',
  'awards and recognition',
  'achievements',
  'accomplishments',
  'key achievements',
  'recognition',
  'scholarships',
  'scholarships and awards',
  'grants',
  'grants and awards',
]);

register('publications', [
  'publications',
  'papers',
  'research',
  'research experience',
  'selected publications',
  'conference papers',
  'presentations',
  'talks',
  'speaking',
  'patents',
]);

register('languages', ['languages', 'language skills', 'spoken languages', 'language proficiency']);

register('interests', [
  'interests',
  'hobbies',
  'personal interests',
  'activities',
  'extracurricular activities',
]);

register('volunteer', [
  'volunteer',
  'volunteering',
  'volunteer experience',
  'community involvement',
  'community service',
  'service',
  'leadership',
  'leadership experience',
]);

register('references', ['references', 'referees']);

/**
 * Normalise a heading for lexicon lookup: strip decoration, collapse
 * whitespace, drop filler words, and singularise nothing (the lexicon lists
 * both forms where they differ meaningfully).
 */
export function normalizeHeading(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[_*#~]/g, ' ')
    .replace(/[^a-z\s&/]/g, ' ')
    .replace(/\s*[&/]\s*/g, ' and ')
    .replace(/\b(?:my|the|a|an|of|in|for|section)\b/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Resolve a heading line to a section kind, or `undefined` when the line is not
 * a recognised heading.
 *
 * Exact match wins. Failing that we accept a heading that *starts with* a known
 * phrase ("Technical Skills & Tools" → skills) but require the match to cover
 * most of the heading, so a prose line that happens to open with "Experience"
 * is not mistaken for a section break.
 */
export function classifyHeading(raw: string): SectionKind | undefined {
  const normalized = normalizeHeading(raw);
  if (!normalized) return undefined;

  const exact = HEADINGS[normalized];
  if (exact) return exact;

  let best: { kind: SectionKind; length: number } | undefined;
  for (const [phrase, kind] of Object.entries(HEADINGS)) {
    if (normalized === phrase) return kind;
    const isPrefix = normalized.startsWith(`${phrase} `);
    const isSuffix = normalized.endsWith(` ${phrase}`);
    if (!isPrefix && !isSuffix) continue;
    // Require the known phrase to dominate the heading.
    if (phrase.length / normalized.length < 0.5) continue;
    if (!best || phrase.length > best.length) best = { kind, length: phrase.length };
  }
  return best?.kind;
}

/** All heading phrases known to the lexicon. Exposed for tests and tooling. */
export function knownHeadings(): string[] {
  return Object.keys(HEADINGS).sort();
}
