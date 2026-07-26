import { describe, expect, it } from 'vitest';
import {
  extractDateRange,
  hasDateToken,
  isDateLine,
  isPresent,
  normalizeDate,
  stripDates,
} from '../src/util/dates.js';

describe('normalizeDate', () => {
  it('normalises month-name forms', () => {
    expect(normalizeDate('Jan 2020')).toBe('2020-01');
    expect(normalizeDate('January 2020')).toBe('2020-01');
    expect(normalizeDate('Sept 2019')).toBe('2019-09');
    expect(normalizeDate('December, 2021')).toBe('2021-12');
    expect(normalizeDate('Feb. 2018')).toBe('2018-02');
  });

  it('normalises numeric forms', () => {
    expect(normalizeDate('01/2020')).toBe('2020-01');
    expect(normalizeDate('3-2019')).toBe('2019-03');
    expect(normalizeDate('2020-06')).toBe('2020-06');
    expect(normalizeDate('2020-06-15')).toBe('2020-06-15');
  });

  it('keeps bare years at year precision rather than inventing a month', () => {
    expect(normalizeDate('2015')).toBe('2015');
  });

  it('expands two-digit years around a near-future pivot', () => {
    expect(normalizeDate("Jan '98")).toBe('1998-01');
    expect(normalizeDate("Jan '12")).toBe('2012-01');
  });

  it('rejects values that are not dates', () => {
    expect(normalizeDate('Engineer')).toBeUndefined();
    expect(normalizeDate('13/2020')).toBeUndefined();
    expect(normalizeDate('')).toBeUndefined();
  });

  it('treats open-ended markers as "no date"', () => {
    expect(normalizeDate('Present')).toBeUndefined();
    expect(isPresent('Present')).toBe(true);
    expect(isPresent('current')).toBe(true);
    expect(isPresent('2020')).toBe(false);
  });
});

describe('extractDateRange', () => {
  it('reads a range with a dash separator', () => {
    expect(extractDateRange('Jan 2020 - Mar 2022')).toEqual({
      startDate: '2020-01',
      endDate: '2022-03',
      present: false,
    });
  });

  it('accepts en and em dashes', () => {
    expect(extractDateRange('2018 – 2020')).toMatchObject({ startDate: '2018', endDate: '2020' });
    expect(extractDateRange('2018 — 2020')).toMatchObject({ startDate: '2018', endDate: '2020' });
  });

  it('accepts the word "to"', () => {
    expect(extractDateRange('May 2019 to Aug 2021')).toMatchObject({
      startDate: '2019-05',
      endDate: '2021-08',
    });
  });

  it('flags an open-ended range and leaves endDate unset', () => {
    const range = extractDateRange('Jan 2021 - Present');
    expect(range).toEqual({ startDate: '2021-01', present: true });
    expect(range?.endDate).toBeUndefined();
  });

  it('finds a range embedded in a longer line', () => {
    expect(extractDateRange('Acme Corp | Engineer | 2018 - 2020 | Remote')).toMatchObject({
      startDate: '2018',
      endDate: '2020',
    });
  });

  it('returns a lone date as the start', () => {
    expect(extractDateRange('Graduated 2019')).toMatchObject({ startDate: '2019' });
  });

  it('returns undefined when there is no date', () => {
    expect(extractDateRange('Senior Software Engineer')).toBeUndefined();
  });

  it('does not treat a street number as a year', () => {
    expect(extractDateRange('500 Howard Street')).toBeUndefined();
  });
});

describe('isDateLine', () => {
  it('recognises a line that is only a date range', () => {
    expect(isDateLine('Jan 2020 - Present')).toBe(true);
    expect(isDateLine('2018 – 2020')).toBe(true);
  });

  it('rejects a line with substantial other content', () => {
    expect(isDateLine('Stripe | Engineer | Jan 2020 - Present')).toBe(false);
  });

  it('is stateless across repeated calls', () => {
    // A shared global regex would alternate between true and false here.
    for (let i = 0; i < 5; i += 1) {
      expect(isDateLine('2018 – 2020')).toBe(true);
      expect(hasDateToken('2018')).toBe(true);
    }
  });
});

describe('stripDates', () => {
  it('removes a range and tidies the leftover separators', () => {
    expect(stripDates('Stripe | Staff Engineer | Jan 2021 - Present')).toBe('Stripe | Staff Engineer');
  });

  it('removes a trailing lone date', () => {
    expect(stripDates('Dean\'s List | Imperial College London | 2013')).toBe(
      "Dean's List | Imperial College London",
    );
  });

  it('leaves date-free text untouched', () => {
    expect(stripDates('Senior Product Manager')).toBe('Senior Product Manager');
  });
});
