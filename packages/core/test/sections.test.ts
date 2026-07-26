import { describe, expect, it } from 'vitest';
import { segment } from '../src/segment/sections.js';
import { splitEntries, toHighlights } from '../src/segment/entries.js';
import { toLines } from '../src/util/lines.js';

const sections = (text: string) => segment(toLines(text));

describe('segment', () => {
  it('puts everything before the first heading into a header section', () => {
    const result = sections('Jane Doe\njane@example.com\n\nEXPERIENCE\nAcme');
    expect(result[0].kind).toBe('header');
    expect(result[0].lines.map((l) => l.text)).toEqual(['Jane Doe', 'jane@example.com']);
  });

  it('returns the whole document as a header when no headings are present', () => {
    const result = sections('Jane Doe\njane@example.com');
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('header');
  });

  it('splits on recognised headings', () => {
    const result = sections('EXPERIENCE\nAcme\n\nEDUCATION\nMIT\n\nSKILLS\nGo');
    expect(result.map((s) => s.kind)).toEqual(['work', 'education', 'skills']);
  });

  it('keeps inline content when a heading shares its line', () => {
    const result = sections('SKILLS: Python, Go');
    expect(result[0].kind).toBe('skills');
    expect(result[0].lines[0].text).toBe('Python, Go');
  });

  it('does not split a bolded job title out of the work section', () => {
    const result = sections('EXPERIENCE\nSenior Engineer\nAcme Corp\nLead Developer\nBeta Inc');
    expect(result.map((s) => s.kind)).toEqual(['work']);
  });

  it('treats "Languages:" inside a skills block as a category, not a new section', () => {
    // Both readings are valid in isolation; the surrounding section decides.
    const result = sections('TECHNICAL SKILLS\nLanguages: Go, Rust\nDatabases: Redis');
    expect(result.map((s) => s.kind)).toEqual(['skills']);
    expect(result[0].lines.map((l) => l.text)).toEqual(['Languages: Go, Rust', 'Databases: Redis']);
  });

  it('still recognises a standalone languages section', () => {
    const result = sections('LANGUAGES\nEnglish (Native)');
    expect(result[0].kind).toBe('languages');
  });
});

describe('splitEntries', () => {
  it('splits when plain text follows a bullet run', () => {
    const entries = splitEntries(
      toLines('Acme Corp\nEngineer\n• Did a thing\nBeta Inc\nAnalyst\n• Did another'),
    );
    expect(entries).toHaveLength(2);
    expect(entries[0].header.map((l) => l.text)).toEqual(['Acme Corp', 'Engineer']);
    expect(entries[1].header.map((l) => l.text)).toEqual(['Beta Inc', 'Analyst']);
  });

  it('keeps a dated line with the header it belongs to', () => {
    const entries = splitEntries(toLines('Acme Corp\nEngineer | 2020 - 2022\n• Did a thing'));
    expect(entries).toHaveLength(1);
  });

  it('starts a new entry at a second date', () => {
    const entries = splitEntries(toLines('Acme | 2020 - 2022\nBeta | 2018 - 2020'));
    expect(entries).toHaveLength(2);
  });

  it('treats indented prose without a glyph as body, not header', () => {
    // PDF extraction routinely drops bullet glyphs, leaving achievements as
    // plain indented lines.
    const entries = splitEntries(
      toLines('Deliveroo\nHead of Product\n2017 - 2020\n   Owned the consumer app roadmap through Series G'),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].header.map((l) => l.text)).toEqual(['Deliveroo', 'Head of Product', '2017 - 2020']);
    expect(entries[0].body.map((l) => l.text)).toEqual([
      'Owned the consumer app roadmap through Series G',
    ]);
  });

  it('returns nothing for empty input', () => {
    expect(splitEntries(toLines(''))).toEqual([]);
  });
});

describe('toHighlights', () => {
  it('keeps each bullet separate', () => {
    const entries = splitEntries(toLines('Acme\n• One\n• Two'));
    expect(toHighlights(entries[0].body)).toEqual(['One', 'Two']);
  });

  it('rejoins a bullet that wrapped onto a second line', () => {
    const entries = splitEntries(toLines('Acme\n• Reduced latency across the payments path\nby 82 percent'));
    expect(toHighlights(entries[0].body)).toEqual([
      'Reduced latency across the payments path by 82 percent',
    ]);
  });
});
