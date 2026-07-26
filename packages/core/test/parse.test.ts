import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseResume, parseResumeText } from '../src/index.js';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), 'utf8');
}

describe('end to end: a chronological resume', () => {
  const { resume, meta } = parseResumeText(fixture('chronological'));

  it('extracts the contact block', () => {
    expect(resume.basics).toMatchObject({
      name: 'Jane A. Rodriguez',
      email: 'jane.rodriguez@example.com',
      phone: '(415) 555-0182',
      label: 'Senior Software Engineer',
      url: 'https://janerodriguez.dev',
    });
    expect(resume.basics?.location).toMatchObject({ city: 'San Francisco', region: 'CA' });
  });

  it('does not invent a website from the email domain', () => {
    expect(resume.basics?.url).not.toContain('example.com');
  });

  it('extracts every role with employer, title and dates', () => {
    expect(resume.work).toHaveLength(3);
    expect(resume.work?.map((w) => w.name)).toEqual(['Stripe', 'Airbnb', 'Datadog']);
    expect(resume.work?.map((w) => w.position)).toEqual([
      'Staff Software Engineer',
      'Senior Software Engineer',
      'Software Engineer',
    ]);
    expect(resume.work?.[0].startDate).toBe('2021-01');
    expect(resume.work?.[0].endDate).toBeUndefined();
    expect(resume.work?.[0].highlights).toHaveLength(3);
  });

  it('extracts both degrees', () => {
    expect(resume.education).toHaveLength(2);
    expect(resume.education?.[0]).toMatchObject({
      institution: 'Carnegie Mellon University',
      studyType: 'Master of Science',
      area: 'Computer Science',
      score: '3.9/4.0',
    });
  });

  it('preserves skill categories', () => {
    expect(resume.skills?.map((s) => s.name)).toEqual(['Languages', 'Infrastructure', 'Databases']);
    expect(resume.skills?.[0].keywords).toContain('TypeScript');
  });

  it('extracts certificates and languages', () => {
    expect(resume.certificates).toHaveLength(2);
    expect(resume.languages?.map((l) => l.language)).toEqual(['English', 'Spanish', 'Portuguese']);
  });

  it('reports the sections it recognised and raises no warnings', () => {
    expect(meta.sectionsDetected).toContain('work');
    expect(meta.sectionsDetected).toContain('education');
    expect(meta.warnings).toEqual([]);
  });

  it('scores confident fields above uncertain ones', () => {
    expect(meta.confidence['basics.email']).toBeGreaterThan(0.9);
    expect(meta.confidence.work).toBeGreaterThan(0.7);
  });
});

describe('end to end: a company-first resume with unglyphed bullets', () => {
  const { resume } = parseResumeText(fixture('company-first'));

  it('keeps the international dialling code', () => {
    expect(resume.basics?.phone).toBe('+44 20 7946 0958');
  });

  it('maps the country name to an ISO code', () => {
    expect(resume.basics?.location).toEqual({ city: 'London', countryCode: 'GB' });
  });

  it('reads employer and title from stacked lines', () => {
    expect(resume.work?.map((w) => w.name)).toEqual(['Monzo Bank Ltd', 'Deliveroo', 'Skyscanner']);
    expect(resume.work?.[0].position).toBe('Director of Engineering');
  });

  it('treats indented prose as achievements rather than header fields', () => {
    expect(resume.work?.[1].highlights).toEqual([
      'Owned the consumer app roadmap through Series G',
      'Launched Deliveroo Plus, reaching 1M subscribers in 14 months',
    ]);
  });

  it('files academic awards under awards, not education', () => {
    expect(resume.education).toHaveLength(1);
    expect(resume.awards?.map((a) => a.title)).toEqual(["Dean's List", 'Best Final Year Project']);
  });

  it('keeps A/B Testing as one skill', () => {
    expect(resume.skills?.[0].keywords).toContain('A/B Testing');
  });
});

describe('end to end: a sparse resume', () => {
  const { resume } = parseResumeText(fixture('sparse'));

  it('extracts what is present without inventing the rest', () => {
    expect(resume.basics?.name).toBe('Priya Sharma');
    expect(resume.basics?.phone).toBeUndefined();
    expect(resume.work).toHaveLength(1);
    expect(resume.education?.[0].institution).toBe('Rhode Island School of Design');
  });
});

describe('parseResume options and edge cases', () => {
  it('accepts a plain-text buffer', async () => {
    const bytes = new TextEncoder().encode(fixture('sparse'));
    const { resume, meta } = await parseResume(bytes);
    expect(meta.sourceFormat).toBe('txt');
    expect(resume.basics?.name).toBe('Priya Sharma');
  });

  it('returns the raw text on request', async () => {
    const result = await parseResume('Jane Doe\njane@example.com', { includeText: true });
    expect(result.text).toContain('jane@example.com');
  });

  it('omits raw text by default', async () => {
    const result = await parseResume('Jane Doe\njane@example.com');
    expect(result.text).toBeUndefined();
  });

  it('drops fields below the confidence threshold', () => {
    const full = parseResumeText(fixture('chronological'));
    const strict = parseResumeText(fixture('chronological'), { minConfidence: 0.5 });
    // The label is a weak inference and should not survive a strict threshold,
    // while the email is unambiguous and must.
    expect(full.resume.basics?.label).toBeDefined();
    expect(strict.resume.basics?.label).toBeUndefined();
    expect(strict.resume.basics?.email).toBeDefined();
  });

  it('warns rather than throwing on an empty document', () => {
    const { resume, meta } = parseResumeText('');
    expect(resume).toBeDefined();
    expect(meta.warnings.length).toBeGreaterThan(0);
  });

  it('warns when there is no contact information', () => {
    const { meta } = parseResumeText('EXPERIENCE\nAcme | Engineer | 2020 - 2022');
    expect(meta.warnings.join(' ')).toMatch(/email|phone/i);
  });

  it('always emits a schema reference and parser metadata', () => {
    const { resume, meta } = parseResumeText(fixture('sparse'));
    expect(resume.$schema).toContain('jsonresume');
    expect(resume.meta?.cvjson?.parser).toMatch(/^cvjson@/);
    expect(meta.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('sets the canonical URL when asked', () => {
    const { resume } = parseResumeText('Jane Doe', { canonical: 'https://example.com/jane' });
    expect(resume.meta?.canonical).toBe('https://example.com/jane');
  });
});
