import type {
  CvjsonMeta,
  JsonResume,
  Line,
  ParseOptions,
  ParseResult,
  Section,
  SectionKind,
} from './types.js';
import { extractText, detectFormat, type ParseInput } from './extract/index.js';
import { toLines } from './util/lines.js';
import { segment, linesOfKind } from './segment/sections.js';
import { parseBasics } from './parse/basics.js';
import { parseWork, looksVolunteer } from './parse/work.js';
import { parseEducation } from './parse/education.js';
import { parseSkills } from './parse/skills.js';
import {
  parseAwards,
  parseCertificates,
  parseInterests,
  parseLanguages,
  parseProjects,
  parsePublications,
  parseReferences,
} from './parse/misc.js';
import { applyThreshold, scoreConfidence } from './util/confidence.js';

export const VERSION = '0.1.0';

const SCHEMA_URL = 'https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json';

export type { ParseInput } from './extract/index.js';
export * from './types.js';
export { detectFormat, extractText } from './extract/index.js';
export { toLines } from './util/lines.js';
export { segment } from './segment/sections.js';

/**
 * Parse a resume into the JSON Resume schema.
 *
 * Accepts a PDF, DOCX, HTML or plain-text resume as a buffer, or already
 * extracted text as a string. The format is sniffed from magic bytes unless
 * `options.format` overrides it.
 *
 * Never throws on a parseable-but-messy resume: sections it cannot interpret
 * are reported in `meta.warnings` and left out of the result, so a caller
 * always receives a valid (if sparse) document.
 */
export async function parseResume(
  input: ParseInput,
  options: ParseOptions = {},
): Promise<ParseResult> {
  const started = Date.now();

  const { text, format } = await extractText(input, options.format ?? detectFormat(input));
  const warnings: string[] = [];

  if (text.trim().length === 0) {
    warnings.push(
      format === 'pdf'
        ? 'No text layer found in the PDF. It is most likely a scan, which needs OCR before parsing.'
        : 'The document contained no extractable text.',
    );
  }

  const lines = toLines(text);
  const sections = segment(lines);
  const sectionsDetected = [...new Set(sections.map((s) => s.kind))].filter((kind) => kind !== 'header');

  const resume = assemble(sections, lines, warnings);
  if (options.canonical) {
    resume.meta = { ...resume.meta, canonical: options.canonical };
  }

  const headerLines = linesOfKind(sections, 'header');
  const confidence = scoreConfidence({ resume, headerLines, sectionsDetected });

  const filtered = applyThreshold(resume, confidence, options.minConfidence ?? 0);

  const meta: CvjsonMeta = {
    parser: `cvjson@${VERSION}`,
    sourceFormat: format,
    durationMs: Date.now() - started,
    textLength: text.length,
    sectionsDetected,
    confidence,
    warnings,
  };

  filtered.meta = { ...filtered.meta, cvjson: meta };

  const result: ParseResult = { resume: filtered, meta };
  if (options.includeText) result.text = text;
  return result;
}

/**
 * Synchronous parse for callers that already have plain text.
 *
 * Same pipeline as {@link parseResume} minus format detection and the async
 * PDF path, so it can be used in contexts where awaiting is inconvenient.
 */
export function parseResumeText(text: string, options: Omit<ParseOptions, 'format'> = {}): ParseResult {
  const started = Date.now();
  const warnings: string[] = [];

  const lines = toLines(text);
  const sections = segment(lines);
  const sectionsDetected = [...new Set(sections.map((s) => s.kind))].filter((kind) => kind !== 'header');

  const resume = assemble(sections, lines, warnings);
  if (options.canonical) resume.meta = { ...resume.meta, canonical: options.canonical };

  const headerLines = linesOfKind(sections, 'header');
  const confidence = scoreConfidence({ resume, headerLines, sectionsDetected });
  const filtered = applyThreshold(resume, confidence, options.minConfidence ?? 0);

  const meta: CvjsonMeta = {
    parser: `cvjson@${VERSION}`,
    sourceFormat: 'txt',
    durationMs: Date.now() - started,
    textLength: text.length,
    sectionsDetected,
    confidence,
    warnings,
  };

  filtered.meta = { ...filtered.meta, cvjson: meta };

  const result: ParseResult = { resume: filtered, meta };
  if (options.includeText) result.text = text;
  return result;
}

function assemble(sections: Section[], allLines: Line[], warnings: string[]): JsonResume {
  const resume: JsonResume = { $schema: SCHEMA_URL };

  const headerLines = linesOfKind(sections, 'header');
  const summaryLines = linesOfKind(sections, 'summary');

  // With no recognised header, contact details are still somewhere in the first
  // screenful — fall back to the top of the document.
  const contactSource = headerLines.length > 0 ? headerLines : allLines.slice(0, 15);
  const basics = parseBasics(contactSource, summaryLines);
  if (Object.keys(basics).length > 0) resume.basics = basics;

  if (!basics.email && !basics.phone) {
    warnings.push('No email address or phone number was found. Check that the document has a contact block.');
  }

  const work = parseWork(linesOfKind(sections, 'work'));
  const explicitVolunteer = linesOfKind(sections, 'volunteer');

  // Unpaid roles filed under the main experience heading belong in `volunteer`.
  const paid = work.filter((item) => !looksVolunteer(item));
  const reclassified = work.filter((item) => looksVolunteer(item));

  if (paid.length > 0) resume.work = paid;

  const volunteer = [
    ...reclassified.map((item) => ({
      organization: item.name,
      position: item.position,
      startDate: item.startDate,
      endDate: item.endDate,
      highlights: item.highlights,
    })),
    ...parseWork(explicitVolunteer).map((item) => ({
      organization: item.name,
      position: item.position,
      startDate: item.startDate,
      endDate: item.endDate,
      highlights: item.highlights,
    })),
  ];
  if (volunteer.length > 0) resume.volunteer = volunteer;

  const education = parseEducation(linesOfKind(sections, 'education'));
  if (education.length > 0) resume.education = education;

  const skills = parseSkills(linesOfKind(sections, 'skills'));
  if (skills.length > 0) resume.skills = skills;

  const projects = parseProjects(linesOfKind(sections, 'projects'));
  if (projects.length > 0) resume.projects = projects;

  const certificates = parseCertificates(linesOfKind(sections, 'certificates'));
  if (certificates.length > 0) resume.certificates = certificates;

  const awards = parseAwards(linesOfKind(sections, 'awards'));
  if (awards.length > 0) resume.awards = awards;

  const languages = parseLanguages(linesOfKind(sections, 'languages'));
  if (languages.length > 0) resume.languages = languages;

  const publications = parsePublications(linesOfKind(sections, 'publications'));
  if (publications.length > 0) resume.publications = publications;

  const interests = parseInterests(linesOfKind(sections, 'interests'));
  if (interests.length > 0) resume.interests = interests;

  const references = parseReferences(linesOfKind(sections, 'references'));
  if (references.length > 0) resume.references = references;

  if (!resume.work && !resume.education) {
    warnings.push('Neither work history nor education could be identified. The section headings may be unusual.');
  }

  return resume;
}

/** Section kinds this parser knows how to interpret. */
export const SUPPORTED_SECTIONS: SectionKind[] = [
  'header', 'summary', 'work', 'education', 'skills', 'projects',
  'certificates', 'awards', 'publications', 'languages', 'interests',
  'volunteer', 'references',
];
