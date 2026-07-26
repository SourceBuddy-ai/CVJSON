import { describe, expect, it } from 'vitest';
import { normalizeText, splitColumns, toLines, trimSeparators } from '../src/util/lines.js';
import { classifyHeading, normalizeHeading } from '../src/lexicon/headings.js';

describe('toLines', () => {
  it('strips bullet glyphs and records them as a flag', () => {
    const [line] = toLines('• Built the thing');
    expect(line.text).toBe('Built the thing');
    expect(line.isBullet).toBe(true);
  });

  it('treats a hyphen followed by a space as a bullet', () => {
    const [line] = toLines('- Shipped a feature');
    expect(line.isBullet).toBe(true);
    expect(line.text).toBe('Shipped a feature');
  });

  it('does not strip a plus that begins an international phone number', () => {
    const [line] = toLines('+44 20 7946 0958');
    expect(line.isBullet).toBe(false);
    expect(line.text).toBe('+44 20 7946 0958');
  });

  it('does not strip a hyphen that begins a negative figure', () => {
    const [line] = toLines('-15% churn');
    expect(line.isBullet).toBe(false);
    expect(line.text).toBe('-15% churn');
  });

  it('records indentation and blankness', () => {
    const lines = toLines('Header\n    indented\n\n');
    expect(lines[0].indent).toBe(0);
    expect(lines[1].indent).toBe(4);
    expect(lines[2].isBlank).toBe(true);
  });
});

describe('normalizeText', () => {
  it('expands ligatures that PDF text layers emit', () => {
    expect(normalizeText('oﬃce workﬂow')).toBe('office workflow');
  });

  it('folds smart quotes to ASCII', () => {
    expect(normalizeText('“hello” ‘world’')).toBe('"hello" \'world\'');
  });

  it('collapses long blank runs', () => {
    expect(normalizeText('a\n\n\n\n\nb')).toBe('a\n\nb');
  });
});

describe('splitColumns', () => {
  it('splits on pipes and wide gaps', () => {
    expect(splitColumns('Acme | Engineer | Remote')).toEqual(['Acme', 'Engineer', 'Remote']);
    expect(splitColumns('Acme     Engineer')).toEqual(['Acme', 'Engineer']);
  });

  it('does not split on hyphens inside a value', () => {
    expect(splitColumns('Hewlett-Packard')).toEqual(['Hewlett-Packard']);
  });
});

describe('trimSeparators', () => {
  it('removes leading and trailing punctuation', () => {
    expect(trimSeparators('| Engineer —')).toBe('Engineer');
  });
});

describe('classifyHeading', () => {
  it('matches canonical headings regardless of case and decoration', () => {
    expect(classifyHeading('WORK EXPERIENCE')).toBe('work');
    expect(classifyHeading('Professional Experience')).toBe('work');
    expect(classifyHeading('EDUCATION')).toBe('education');
    expect(classifyHeading('Technical Skills')).toBe('skills');
    expect(classifyHeading('Core Competencies')).toBe('skills');
  });

  it('matches headings that extend a known phrase', () => {
    expect(classifyHeading('Skills & Tools')).toBe('skills');
    expect(classifyHeading('Academic Awards')).toBe('awards');
  });

  it('returns undefined for text that is not a section heading', () => {
    expect(classifyHeading('Stripe')).toBeUndefined();
    expect(classifyHeading('Led a team of six engineers')).toBeUndefined();
  });

  it('normalises separators into a comparable form', () => {
    expect(normalizeHeading('Awards & Honors')).toBe('awards and honors');
  });
});
