/**
 * Type definitions for the JSON Resume schema (https://jsonresume.org/schema)
 * plus the CVJSON-specific extensions the parser emits.
 *
 * The schema types mirror jsonresume/resume-schema exactly so that output is a
 * drop-in match for the wider JSON Resume tool ecosystem. Everything CVJSON adds
 * lives under `meta.cvjson` or in the `ParseResult` wrapper, never inline in the
 * standard fields — consumers that validate against the upstream schema must not
 * trip over our additions.
 */

/** ISO 8601 date, narrowed to the granularities a resume actually states: `2020`, `2020-06`, `2020-06-01`. */
export type Iso8601 = string;

export interface Location {
  address?: string;
  postalCode?: string;
  city?: string;
  countryCode?: string;
  region?: string;
}

export interface Profile {
  network?: string;
  username?: string;
  url?: string;
}

export interface Basics {
  name?: string;
  label?: string;
  image?: string;
  email?: string;
  phone?: string;
  url?: string;
  summary?: string;
  location?: Location;
  profiles?: Profile[];
}

export interface WorkItem {
  name?: string;
  location?: string;
  description?: string;
  position?: string;
  url?: string;
  startDate?: Iso8601;
  endDate?: Iso8601;
  summary?: string;
  highlights?: string[];
}

export interface VolunteerItem {
  organization?: string;
  position?: string;
  url?: string;
  startDate?: Iso8601;
  endDate?: Iso8601;
  summary?: string;
  highlights?: string[];
}

export interface EducationItem {
  institution?: string;
  url?: string;
  area?: string;
  studyType?: string;
  startDate?: Iso8601;
  endDate?: Iso8601;
  score?: string;
  courses?: string[];
}

export interface AwardItem {
  title?: string;
  date?: Iso8601;
  awarder?: string;
  summary?: string;
}

export interface CertificateItem {
  name?: string;
  date?: Iso8601;
  url?: string;
  issuer?: string;
}

export interface PublicationItem {
  name?: string;
  publisher?: string;
  releaseDate?: Iso8601;
  url?: string;
  summary?: string;
}

export interface SkillItem {
  name?: string;
  level?: string;
  keywords?: string[];
}

export interface LanguageItem {
  language?: string;
  fluency?: string;
}

export interface InterestItem {
  name?: string;
  keywords?: string[];
}

export interface ReferenceItem {
  name?: string;
  reference?: string;
}

export interface ProjectItem {
  name?: string;
  description?: string;
  highlights?: string[];
  keywords?: string[];
  startDate?: Iso8601;
  endDate?: Iso8601;
  url?: string;
  roles?: string[];
  entity?: string;
  type?: string;
}

export interface ResumeMeta {
  canonical?: string;
  version?: string;
  lastModified?: string;
  /** CVJSON extension block. Ignored by standard JSON Resume consumers. */
  cvjson?: CvjsonMeta;
}

export interface JsonResume {
  $schema?: string;
  basics?: Basics;
  work?: WorkItem[];
  volunteer?: VolunteerItem[];
  education?: EducationItem[];
  awards?: AwardItem[];
  certificates?: CertificateItem[];
  publications?: PublicationItem[];
  skills?: SkillItem[];
  languages?: LanguageItem[];
  interests?: InterestItem[];
  references?: ReferenceItem[];
  projects?: ProjectItem[];
  meta?: ResumeMeta;
}

/* -------------------------------------------------------------------------- */
/* CVJSON extensions                                                          */
/* -------------------------------------------------------------------------- */

export type SourceFormat = 'pdf' | 'docx' | 'txt' | 'html' | 'unknown';

/**
 * Per-field confidence in [0, 1]. Keys are dot-paths into the resume
 * (`basics.email`, `work`, `education`). Absent key means "not attempted".
 *
 * These are heuristic self-assessments, not calibrated probabilities: they rank
 * fields against each other within one parse so a caller can decide what to
 * show a human for review. Do not read them as "97% chance this is correct".
 */
export type ConfidenceMap = Record<string, number>;

export interface CvjsonMeta {
  /** Parser version that produced this document. */
  parser: string;
  /** Format the text was extracted from. */
  sourceFormat: SourceFormat;
  /** Wall-clock parse time in milliseconds. */
  durationMs: number;
  /** Characters of text extracted from the source document. */
  textLength: number;
  /** Section headings the segmenter recognised, in document order. */
  sectionsDetected: string[];
  /** Heuristic per-field confidence. See {@link ConfidenceMap}. */
  confidence: ConfidenceMap;
  /** Non-fatal problems worth surfacing to a human. */
  warnings: string[];
}

export interface ParseResult {
  resume: JsonResume;
  meta: CvjsonMeta;
  /** Raw extracted text, returned only when `includeText` is set. */
  text?: string;
}

/** A single logical line of the document, with layout signals attached. */
export interface Line {
  /** Text with surrounding whitespace collapsed and trimmed. */
  text: string;
  /** Zero-based index within the document's line array. */
  index: number;
  /** Leading-whitespace width, used as a weak nesting signal. */
  indent: number;
  /** True when the line begins with a bullet glyph, which was stripped from `text`. */
  isBullet: boolean;
  /** True when the line has no word characters. */
  isBlank: boolean;
}

export interface ParseOptions {
  /** Override format detection. By default the format is sniffed from magic bytes. */
  format?: SourceFormat;
  /** Include the raw extracted text in the result. Off by default to keep payloads small. */
  includeText?: boolean;
  /**
   * Drop fields whose confidence falls below this threshold. Default 0 (keep
   * everything). Callers feeding an ATS directly often want ~0.5.
   */
  minConfidence?: number;
  /** Value written to `meta.canonical`. */
  canonical?: string;
}

export interface Section {
  /** Canonical section id, e.g. `work`, `education`, `skills`. */
  kind: SectionKind;
  /** The heading text exactly as it appeared in the document. */
  heading: string;
  /** Lines belonging to the section, excluding the heading line itself. */
  lines: Line[];
}

export type SectionKind =
  | 'header'
  | 'summary'
  | 'work'
  | 'education'
  | 'skills'
  | 'projects'
  | 'certificates'
  | 'awards'
  | 'publications'
  | 'languages'
  | 'interests'
  | 'volunteer'
  | 'references'
  | 'unknown';
