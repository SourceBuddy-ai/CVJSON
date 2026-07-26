import { describe, expect, it } from 'vitest';
import {
  extractEmail,
  extractName,
  extractPhone,
  extractUrls,
  parseBasics,
  parseLocation,
} from '../src/parse/basics.js';
import { toLines } from '../src/util/lines.js';

describe('extractEmail', () => {
  it('finds an address in a contact block', () => {
    expect(extractEmail('Jane Doe | jane.doe@example.com | 555-1234')).toBe('jane.doe@example.com');
  });

  it('lower-cases and drops trailing punctuation', () => {
    expect(extractEmail('Contact: Jane.Doe@Example.COM.')).toBe('jane.doe@example.com');
  });

  it('handles plus-addressing and multi-level domains', () => {
    expect(extractEmail('m.okonkwo+jobs@example.co.uk')).toBe('m.okonkwo+jobs@example.co.uk');
  });

  it('returns undefined when there is no address', () => {
    expect(extractEmail('No contact details here')).toBeUndefined();
  });
});

describe('extractPhone', () => {
  it('reads common US formats', () => {
    expect(extractPhone('(415) 555-0182')).toBe('(415) 555-0182');
    expect(extractPhone('415-555-0182')).toBe('415-555-0182');
    expect(extractPhone('+1 415 555 0182')).toBe('+1 415 555 0182');
  });

  it('keeps the leading plus on an international number', () => {
    expect(extractPhone('+44 20 7946 0958')).toBe('+44 20 7946 0958');
  });

  it('does not mistake a date range for a phone number', () => {
    expect(extractPhone('2018 - 2022')).toBeUndefined();
  });

  it('does not read digits out of an email address', () => {
    expect(extractPhone('user2020@example.com')).toBeUndefined();
  });
});

describe('extractUrls', () => {
  it('normalises bare domains to https', () => {
    expect(extractUrls('janerodriguez.dev')).toEqual(['https://janerodriguez.dev']);
  });

  it('ignores the domain half of an email address', () => {
    // Without this the candidate's email domain becomes a phantom website.
    expect(extractUrls('jane@example.com')).toEqual([]);
  });

  it('deduplicates repeats', () => {
    expect(extractUrls('github.com/a github.com/a')).toEqual(['https://github.com/a']);
  });
});

describe('parseLocation', () => {
  it('reads city and US state', () => {
    expect(parseLocation('San Francisco, CA')).toEqual({
      city: 'San Francisco',
      region: 'CA',
      countryCode: 'US',
    });
  });

  it('reads a postal code alongside the region', () => {
    expect(parseLocation('Austin, TX 78701')).toMatchObject({
      city: 'Austin',
      region: 'TX',
      postalCode: '78701',
    });
  });

  it('assigns Canada for a provincial code', () => {
    expect(parseLocation('Toronto, ON')).toMatchObject({ city: 'Toronto', countryCode: 'CA' });
  });

  it('maps country names to ISO codes', () => {
    expect(parseLocation('London, United Kingdom')).toEqual({ city: 'London', countryCode: 'GB' });
  });

  it('does not read a job title as a location', () => {
    // "Head of Product, Consumer" is comma-separated and word-shaped, which an
    // unguarded city/region rule would happily accept.
    expect(parseLocation('Head of Product, Consumer')).toBeUndefined();
    expect(parseLocation('Freelance Graphic Designer, Self-Employed')).toBeUndefined();
  });

  it('rejects arbitrary prose', () => {
    expect(parseLocation('Reduced infrastructure spend, saving millions')).toBeUndefined();
  });
});

describe('extractName', () => {
  const name = (text: string) => extractName(toLines(text));

  it('reads a plain two-word name on the first line', () => {
    expect(name('Jane Rodriguez\nSenior Engineer')).toBe('Jane Rodriguez');
  });

  it('reads an all-caps name', () => {
    expect(name('MARCUS OKONKWO\nLondon')).toBe('MARCUS OKONKWO');
  });

  it('handles a middle initial', () => {
    expect(name('Jane A. Rodriguez')).toBe('Jane A. Rodriguez');
  });

  it('strips a credential suffix', () => {
    expect(name('Robert Chen, PhD')).toBe('Robert Chen');
  });

  it('picks the name out of a packed header line', () => {
    expect(name('Jane Rodriguez | jane@example.com | 555-0182')).toBe('Jane Rodriguez');
  });

  it('skips a job title line', () => {
    expect(name('Senior Software Engineer\nJane Rodriguez')).toBe('Jane Rodriguez');
  });

  it('returns undefined when no line looks like a name', () => {
    expect(name('CURRICULUM VITAE\n555-0182')).toBeUndefined();
  });
});

describe('parseBasics', () => {
  it('assembles a full contact block', () => {
    const header = toLines(
      [
        'Jane A. Rodriguez',
        'Senior Software Engineer',
        'San Francisco, CA | jane@example.com | (415) 555-0182',
        'linkedin.com/in/janerodriguez | github.com/jrodriguez',
      ].join('\n'),
    );

    const basics = parseBasics(header, []);

    expect(basics.name).toBe('Jane A. Rodriguez');
    expect(basics.email).toBe('jane@example.com');
    expect(basics.phone).toBe('(415) 555-0182');
    expect(basics.label).toBe('Senior Software Engineer');
    expect(basics.location).toMatchObject({ city: 'San Francisco', region: 'CA' });
    expect(basics.profiles).toEqual([
      { network: 'LinkedIn', username: 'janerodriguez', url: 'https://linkedin.com/in/janerodriguez' },
      { network: 'GitHub', username: 'jrodriguez', url: 'https://github.com/jrodriguez' },
    ]);
  });

  it('takes the summary from the summary section', () => {
    const basics = parseBasics(toLines('Jane Doe'), toLines('Backend engineer.\nNine years of it.'));
    expect(basics.summary).toBe('Backend engineer. Nine years of it.');
  });
});
