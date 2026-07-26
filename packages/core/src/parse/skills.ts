import type { Line, SkillItem } from '../types.js';
import { canonicalizeSkill } from '../lexicon/skills.js';
import { trimSeparators } from '../util/lines.js';

/** `Languages: Python, Go` — a category label followed by its members. */
const CATEGORY_LINE = /^([A-Za-z][A-Za-z0-9 &/+#.-]{1,40}?)\s*[:—–]\s*(.+)$/;

/**
 * Separators used between individual skills on one line.
 *
 * A slash only separates when it is surrounded by whitespace: unspaced slashes
 * are part of the skill itself in `A/B Testing`, `CI/CD` and `TCP/IP`.
 */
const SKILL_SEPARATOR = /\s*[,;|·•]\s*|\s+\/\s+|\s{3,}/;

/**
 * Proficiency qualifiers that trail a skill, e.g. `Python (expert)`.
 * Captured into `level` rather than left glued to the name.
 */
const LEVEL_SUFFIX = /\s*[({[]\s*(expert|advanced|proficient|intermediate|beginner|basic|novice|fluent|native|working knowledge|familiar|\d+\s*(?:\+\s*)?(?:yrs?|years?))\s*[)}\]]\s*$/i;

/**
 * Parse a skills section.
 *
 * Two shapes are common and both map onto JSON Resume's `skills` array:
 * a categorised list (`Frontend: React, Vue`) becomes one item per category
 * with `keywords`; a flat list becomes a single unnamed item holding every
 * skill as a keyword.
 */
export function parseSkills(lines: Line[]): SkillItem[] {
  const categorised: SkillItem[] = [];
  const loose: string[] = [];

  for (const line of lines) {
    if (line.isBlank || !line.text) continue;

    const category = line.text.match(CATEGORY_LINE);
    if (category && looksLikeCategory(category[1], category[2])) {
      const keywords = splitSkills(category[2]);
      if (keywords.length > 0) {
        categorised.push({ name: trimSeparators(category[1]), keywords });
        continue;
      }
    }

    loose.push(...splitSkills(line.text));
  }

  const items = [...categorised];
  const uniqueLoose = dedupe(loose);
  if (uniqueLoose.length > 0) {
    // An unnamed group is valid JSON Resume and avoids inventing a category
    // name the resume never stated.
    items.push({ keywords: uniqueLoose });
  }

  return items;
}

/**
 * Guard against treating prose as a category. `Skilled in: ...` is a category;
 * `Note: I led a team of five` is not — the tell is that the right-hand side is
 * a list of short items rather than a sentence.
 */
function looksLikeCategory(label: string, rest: string): boolean {
  if (label.split(/\s+/).length > 4) return false;
  if (/[.!?]$/.test(rest)) return false;
  const parts = rest.split(SKILL_SEPARATOR).filter(Boolean);
  if (parts.length === 1) return parts[0].split(/\s+/).length <= 5;
  // Every member of a real skill list is short.
  const longParts = parts.filter((part) => part.split(/\s+/).length > 6).length;
  return longParts === 0;
}

function splitSkills(text: string): string[] {
  const cleaned = text.replace(/\s*\.\s*$/, '');
  return dedupe(
    cleaned
      .split(SKILL_SEPARATOR)
      .map((part) => cleanSkill(part))
      .filter((part): part is string => part !== undefined),
  );
}

function cleanSkill(raw: string): string | undefined {
  let text = trimSeparators(raw).replace(/\s*\(\s*\)\s*$/, '');
  if (!text) return undefined;

  // Drop a trailing proficiency marker; it is metadata, not part of the name.
  text = text.replace(LEVEL_SUFFIX, '').trim();

  if (text.length < 1 || text.length > 40) return undefined;
  if (!/[A-Za-z]/.test(text)) return undefined;
  // A fragment this long is a sentence that survived splitting, not a skill.
  if (text.split(/\s+/).length > 6) return undefined;

  return canonicalizeSkill(text);
}

function dedupe(skills: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const skill of skills) {
    const key = skill.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(skill);
  }
  return out;
}
