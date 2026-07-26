import { describe, expect, it } from 'vitest';
import { parseSkills } from '../src/parse/skills.js';
import { parseAwards, parseCertificates, parseLanguages, parseProjects } from '../src/parse/misc.js';
import { canonicalizeSkill, isKnownSkill } from '../src/lexicon/skills.js';
import { toLines } from '../src/util/lines.js';

const skills = (text: string) => parseSkills(toLines(text));

describe('parseSkills', () => {
  it('keeps categories as named groups', () => {
    const result = skills('Languages: Go, Python, SQL\nInfrastructure: Kubernetes, Docker');
    expect(result).toEqual([
      { name: 'Languages', keywords: ['Go', 'Python', 'SQL'] },
      { name: 'Infrastructure', keywords: ['Kubernetes', 'Docker'] },
    ]);
  });

  it('emits a flat list as a single unnamed group', () => {
    const result = skills('Figma, Illustrator, Typography');
    expect(result).toEqual([{ keywords: ['Figma', 'Illustrator', 'Typography'] }]);
  });

  it('does not split a skill that contains a slash', () => {
    // "A/B Testing" and "CI/CD" are single skills, not two each.
    expect(skills('A/B Testing, CI/CD')[0].keywords).toEqual(['A/B Testing', 'CI/CD']);
  });

  it('splits on a spaced slash', () => {
    expect(skills('Go / Rust')[0].keywords).toEqual(['Go', 'Rust']);
  });

  it('strips a trailing proficiency marker', () => {
    expect(skills('Python (expert), Go (intermediate)')[0].keywords).toEqual(['Python', 'Go']);
  });

  it('deduplicates case-insensitively', () => {
    expect(skills('python, Python, PYTHON')[0].keywords).toEqual(['Python']);
  });

  it('does not treat a prose line as a category', () => {
    // The sentence is dropped rather than filed under a "Note" category.
    const result = skills('Note: I led a distributed team across four time zones.');
    expect(result.some((group) => group.name === 'Note')).toBe(false);
    expect(result.flatMap((group) => group.keywords ?? [])).toEqual([]);
  });

  it('drops sentence fragments that are too long to be a skill', () => {
    const result = skills('Go, responsible for architecting and delivering the whole platform');
    expect(result[0].keywords).toEqual(['Go']);
  });
});

describe('skill lexicon', () => {
  it('corrects casing for known skills', () => {
    expect(canonicalizeSkill('javascript')).toBe('JavaScript');
    expect(canonicalizeSkill('POSTGRESQL')).toBe('PostgreSQL');
  });

  it('passes unknown skills through untouched', () => {
    // The lexicon is a casing aid, not a whitelist — niche skills must survive.
    expect(canonicalizeSkill('Fictional Framework 9')).toBe('Fictional Framework 9');
    expect(isKnownSkill('Fictional Framework 9')).toBe(false);
  });
});

describe('parseLanguages', () => {
  it('reads languages and fluency from one line', () => {
    expect(parseLanguages(toLines('English (Native), Spanish (Fluent)'))).toEqual([
      { language: 'English', fluency: 'Native' },
      { language: 'Spanish', fluency: 'Fluent' },
    ]);
  });

  it('reads a dash-separated fluency', () => {
    expect(parseLanguages(toLines('German - Conversational'))).toEqual([
      { language: 'German', fluency: 'Conversational' },
    ]);
  });

  it('accepts a language with no stated fluency', () => {
    expect(parseLanguages(toLines('Portuguese'))).toEqual([{ language: 'Portuguese' }]);
  });
});

describe('parseCertificates', () => {
  it('separates name, issuer and date', () => {
    const [cert] = parseCertificates(
      toLines('AWS Certified Solutions Architect | Amazon Web Services | 2022'),
    );
    expect(cert.name).toBe('AWS Certified Solutions Architect');
    expect(cert.issuer).toBe('Amazon Web Services');
    expect(cert.date).toBe('2022');
  });
});

describe('parseAwards', () => {
  it('separates title, awarder and date', () => {
    const [award] = parseAwards(toLines("Dean's List | Imperial College London | 2013"));
    expect(award.title).toBe("Dean's List");
    expect(award.awarder).toBe('Imperial College London');
    expect(award.date).toBe('2013');
  });
});

describe('parseProjects', () => {
  it('reads a project name with bullets beneath it', () => {
    const [project] = parseProjects(toLines('Ledger CLI | 2023\n• Wrote a double-entry engine'));
    expect(project.name).toBe('Ledger CLI');
    expect(project.startDate).toBe('2023');
    expect(project.highlights).toEqual(['Wrote a double-entry engine']);
  });
});
