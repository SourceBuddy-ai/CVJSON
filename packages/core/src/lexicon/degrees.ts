/** Degree recognition for the education section. */

interface DegreePattern {
  pattern: RegExp;
  /** Canonical `studyType` written into JSON Resume. */
  studyType: string;
}

/**
 * Ordered most-specific first: "Master of Business Administration" must win
 * over the bare "Master" pattern, and "B.S." over "BS".
 */
const DEGREES: DegreePattern[] = [
  { pattern: /\bmaster\s+of\s+business\s+administration\b|\bm\.?b\.?a\.?\b/i, studyType: 'MBA' },
  { pattern: /\bdoctor\s+of\s+philosophy\b|\bph\.?\s?d\.?\b|\bdphil\b/i, studyType: 'PhD' },
  { pattern: /\bdoctor\s+of\s+medicine\b|\bm\.?d\.?\b(?!\w)/i, studyType: 'MD' },
  { pattern: /\bjuris\s+doctor\b|\bj\.?d\.?\b(?!\w)/i, studyType: 'JD' },
  { pattern: /\bdoctor(?:ate)?\b|\bed\.?d\.?\b|\bsc\.?d\.?\b/i, studyType: 'Doctorate' },
  { pattern: /\bmaster\s+of\s+science\b|\bm\.?sc?\.?\b(?!\w)|\bms\b|\bmsc\b/i, studyType: 'Master of Science' },
  { pattern: /\bmaster\s+of\s+arts\b|\bm\.?a\.?\b(?!\w)|\bma\b/i, studyType: 'Master of Arts' },
  { pattern: /\bmaster\s+of\s+engineering\b|\bm\.?eng\.?\b/i, studyType: 'Master of Engineering' },
  { pattern: /\bmaster\s+of\s+fine\s+arts\b|\bm\.?f\.?a\.?\b/i, studyType: 'MFA' },
  { pattern: /\bmaster\s+of\s+public\s+health\b|\bm\.?p\.?h\.?\b(?!\w)/i, studyType: 'MPH' },
  { pattern: /\bmaster\s+of\s+social\s+work\b|\bm\.?s\.?w\.?\b(?!\w)/i, studyType: 'MSW' },
  { pattern: /\bmaster\s+of\s+architecture\b|\bm\.?arch\.?\b/i, studyType: 'Master of Architecture' },
  { pattern: /\bmaster\s+of\s+laws\b|\bll\.?m\.?\b/i, studyType: 'LLM' },
  { pattern: /\bm\.?phil\.?\b/i, studyType: 'MPhil' },
  { pattern: /\bmaster\b|\bmasters\b/i, studyType: 'Master' },
  { pattern: /\bbachelor\s+of\s+fine\s+arts\b|\bb\.?f\.?a\.?\b/i, studyType: 'BFA' },
  { pattern: /\bbachelor\s+of\s+business\s+administration\b|\bb\.?b\.?a\.?\b/i, studyType: 'BBA' },
  { pattern: /\bbachelor\s+of\s+architecture\b|\bb\.?arch\.?\b/i, studyType: 'Bachelor of Architecture' },
  { pattern: /\bbachelor\s+of\s+laws\b|\bll\.?b\.?\b/i, studyType: 'LLB' },
  { pattern: /\bbachelor\s+of\s+education\b|\bb\.?ed\.?\b/i, studyType: 'Bachelor of Education' },
  { pattern: /\bbachelor\s+of\s+science\b|\bb\.?sc?\.?\b(?!\w)|\bbs\b|\bbsc\b/i, studyType: 'Bachelor of Science' },
  { pattern: /\bbachelor\s+of\s+arts\b|\bb\.?a\.?\b(?!\w)|\bba\b/i, studyType: 'Bachelor of Arts' },
  { pattern: /\bbachelor\s+of\s+engineering\b|\bb\.?eng\.?\b|\bbtech\b|\bb\.?tech\b/i, studyType: 'Bachelor of Engineering' },
  { pattern: /\bbachelor\b|\bbachelors\b|\bundergraduate\s+degree\b/i, studyType: 'Bachelor' },
  { pattern: /\bassociate\s+(?:of|in|degree)\b|\ba\.?a\.?s?\.?\b(?!\w)/i, studyType: 'Associate' },
  { pattern: /\bhigh\s+school\s+diploma\b|\bg\.?e\.?d\.?\b/i, studyType: 'High School' },
  { pattern: /\bdiploma\b/i, studyType: 'Diploma' },
  { pattern: /\bcertificate\b|\bcertification\b/i, studyType: 'Certificate' },
];

/** Words introducing the field of study: "B.S. **in** Computer Science". */
const FIELD_CONNECTOR = /\b(?:in|of|,)\s+/i;

export interface DegreeMatch {
  studyType: string;
  /** Field of study, when the line states one. */
  area?: string;
}

/**
 * Pull a degree and, where present, its field of study out of a line.
 * Returns `undefined` when no degree is mentioned.
 */
export function matchDegree(text: string): DegreeMatch | undefined {
  for (const { pattern, studyType } of DEGREES) {
    const hit = text.match(pattern);
    if (!hit) continue;

    const after = text.slice((hit.index ?? 0) + hit[0].length);
    const connector = after.match(FIELD_CONNECTOR);

    // `B.S. in Computer Science` — the connector marks where the field starts.
    // `MEng Computing` — no connector, so the field is simply what follows.
    const fieldSource =
      connector && connector.index !== undefined
        ? after.slice(connector.index + connector[0].length)
        : after;

    const area = cleanArea(fieldSource);
    return area ? { studyType, area } : { studyType };
  }
  return undefined;
}

/**
 * Trim a candidate field-of-study down to the subject itself.
 *
 * The raw slice runs to the end of the line, so it still carries the dates,
 * institution and grade that shared it. We cut at the first column separator or
 * year and then require the remainder to read like a subject name — a few words,
 * no digits — rather than accept whatever happened to follow the degree.
 */
function cleanArea(source: string): string | undefined {
  const area = source
    .split(/[|•·,;]|\s{3,}|\s+[–—]\s+/)[0]
    .replace(/\b(?:19|20)\d{2}\b[\s\S]*$/, '')
    .replace(/\b(?:from|at)\b[\s\S]*$/i, '')
    .replace(/[.\s]+$/, '')
    .trim();

  if (!area || area.length < 3 || area.length > 60) return undefined;
  if (!/[A-Za-z]{3}/.test(area)) return undefined;
  if (/\d/.test(area)) return undefined;
  // A subject is a short noun phrase; anything longer is the rest of the line.
  if ((area.match(/\S+/g)?.length ?? 0) > 6) return undefined;
  return area;
}

/** Grade or GPA statement, normalised to the raw text JSON Resume's `score` expects. */
export function matchScore(text: string): string | undefined {
  const gpa = text.match(/\b(?:c?gpa|grade\s+point\s+average)\b[\s:]*([0-9]\.?[0-9]{0,2})\s*(?:\/\s*([0-9]\.?[0-9]{0,2}))?/i);
  if (gpa) return gpa[2] ? `${gpa[1]}/${gpa[2]}` : gpa[1];

  const classification = text.match(/\b(first\s+class(?:\s+honou?rs)?|upper\s+second|lower\s+second|2:1|2:2|summa\s+cum\s+laude|magna\s+cum\s+laude|cum\s+laude|distinction|merit|with\s+honou?rs)\b/i);
  if (classification) return classification[1];

  return undefined;
}
