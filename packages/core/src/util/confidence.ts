import type { ConfidenceMap, JsonResume, Line } from '../types.js';
import { isKnownSkill } from '../lexicon/skills.js';

/**
 * Heuristic confidence scoring.
 *
 * These numbers rank fields against each other within a single parse so a
 * caller can route the weak ones to human review. They are not calibrated
 * probabilities and should not be presented to end users as accuracy figures.
 *
 * The scale is anchored on how much evidence the extraction rests on:
 *   0.95+  unambiguous syntax (an email address is either well-formed or not)
 *   0.7    strong structural signal (a dated entry with an employer)
 *   0.5    a single weak signal, plausible but worth checking
 *   <0.4   a guess made because the field would otherwise be empty
 */

const FULL_SYNTAX = 0.97;
const STRONG = 0.8;
const MODERATE = 0.6;
const WEAK = 0.4;

export interface ConfidenceInput {
  resume: JsonResume;
  headerLines: Line[];
  /** Section kinds the segmenter recognised. */
  sectionsDetected: string[];
}

export function scoreConfidence({ resume, headerLines, sectionsDetected }: ConfidenceInput): ConfidenceMap {
  const scores: ConfidenceMap = {};
  const basics = resume.basics ?? {};

  if (basics.email) scores['basics.email'] = FULL_SYNTAX;
  if (basics.phone) scores['basics.phone'] = phoneConfidence(basics.phone);
  if (basics.url) scores['basics.url'] = STRONG;
  if (basics.profiles?.length) scores['basics.profiles'] = FULL_SYNTAX;
  if (basics.name) scores['basics.name'] = nameConfidence(basics.name, headerLines);
  if (basics.location) scores['basics.location'] = basics.location.region || basics.location.countryCode ? STRONG : MODERATE;
  if (basics.label) scores['basics.label'] = WEAK;
  if (basics.summary) {
    // A summary lifted from an explicitly labelled section is trustworthy; one
    // inferred from loose header prose is not.
    scores['basics.summary'] = sectionsDetected.includes('summary') ? STRONG : WEAK;
  }

  if (resume.work?.length) {
    const dated = resume.work.filter((item) => item.startDate).length;
    const named = resume.work.filter((item) => item.name).length;
    const titled = resume.work.filter((item) => item.position).length;
    const n = resume.work.length;
    scores.work = round(0.35 + 0.25 * (dated / n) + 0.2 * (named / n) + 0.2 * (titled / n));
  }

  if (resume.education?.length) {
    const withInstitution = resume.education.filter((item) => item.institution).length;
    const withDegree = resume.education.filter((item) => item.studyType).length;
    const n = resume.education.length;
    scores.education = round(0.4 + 0.3 * (withInstitution / n) + 0.3 * (withDegree / n));
  }

  if (resume.skills?.length) {
    const keywords = resume.skills.flatMap((skill) => skill.keywords ?? []);
    if (keywords.length > 0) {
      const known = keywords.filter((keyword) => isKnownSkill(keyword)).length;
      // A high proportion of recognised skills means the section split cleanly.
      // A low proportion is not itself wrong — niche skills are still skills —
      // so the floor stays usable.
      scores.skills = round(0.5 + 0.45 * (known / keywords.length));
    }
  }

  for (const [key, value] of [
    ['projects', resume.projects],
    ['certificates', resume.certificates],
    ['awards', resume.awards],
    ['languages', resume.languages],
    ['publications', resume.publications],
    ['volunteer', resume.volunteer],
  ] as const) {
    if (value?.length) scores[key] = sectionsDetected.includes(key) ? MODERATE : WEAK;
  }

  return scores;
}

function phoneConfidence(phone: string): number {
  const digits = phone.replace(/\D/g, '').length;
  // 10-11 digits with a country or area code is the canonical shape.
  if (digits >= 10 && digits <= 13) return 0.9;
  return MODERATE;
}

function nameConfidence(name: string, headerLines: Line[]): number {
  const nonBlank = headerLines.filter((line) => !line.isBlank);
  const position = nonBlank.findIndex((line) => line.text.includes(name));
  const words = name.split(/\s+/).length;

  let score = MODERATE;
  // The name is nearly always the first thing on the page.
  if (position === 0) score += 0.25;
  else if (position === 1) score += 0.15;
  else if (position > 3) score -= 0.15;

  if (words === 2 || words === 3) score += 0.1;
  // A line that is *only* the name is a stronger signal than one that also
  // carries contact details.
  if (position >= 0 && nonBlank[position]?.text.trim() === name) score += 0.05;

  return round(Math.min(0.95, Math.max(0.2, score)));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Remove fields scoring below `threshold`.
 *
 * Operates on the top-level keys the confidence map addresses. Dropping a field
 * is preferable to emitting a low-confidence guess when the caller has told us
 * they are feeding an ATS without review.
 */
export function applyThreshold(resume: JsonResume, scores: ConfidenceMap, threshold: number): JsonResume {
  if (threshold <= 0) return resume;

  const filtered: JsonResume = { ...resume };

  if (filtered.basics) {
    const basics = { ...filtered.basics };
    for (const key of Object.keys(basics) as Array<keyof typeof basics>) {
      const score = scores[`basics.${key}`];
      if (score !== undefined && score < threshold) delete basics[key];
    }
    filtered.basics = basics;
  }

  for (const key of ['work', 'education', 'skills', 'projects', 'certificates', 'awards', 'languages', 'publications', 'volunteer'] as const) {
    const score = scores[key];
    if (score !== undefined && score < threshold) delete filtered[key];
  }

  return filtered;
}
