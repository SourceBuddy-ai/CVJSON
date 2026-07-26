import { describe, expect, it } from 'vitest';
import { parseWork } from '../src/parse/work.js';
import { parseEducation } from '../src/parse/education.js';
import { toLines } from '../src/util/lines.js';

const work = (text: string) => parseWork(toLines(text));
const education = (text: string) => parseEducation(toLines(text));

describe('parseWork', () => {
  it('separates employer from job title on a pipe-delimited line', () => {
    const [item] = work('Stripe | Staff Software Engineer | Jan 2021 - Present');
    expect(item.name).toBe('Stripe');
    expect(item.position).toBe('Staff Software Engineer');
    expect(item.startDate).toBe('2021-01');
  });

  it('leaves endDate unset for a current role', () => {
    const [item] = work('Stripe | Engineer | Jan 2021 - Present');
    expect(item.endDate).toBeUndefined();
  });

  it('handles the company-first stacked layout', () => {
    const [item] = work('Monzo Bank Ltd\nDirector of Engineering\nSeptember 2020 - Present');
    expect(item.name).toBe('Monzo Bank Ltd');
    expect(item.position).toBe('Director of Engineering');
  });

  it('handles "Title at Company"', () => {
    const [item] = work('Senior Engineer at Acme Corp\n2019 - 2021');
    expect(item.position).toBe('Senior Engineer');
    expect(item.name).toBe('Acme Corp');
  });

  it('does not let an industry noun in a job title outweigh the role signal', () => {
    // "Software" appears in company names too; if it were strong company
    // evidence it would cancel out "Engineer" and leave the line unclassified.
    const [item] = work('Datadog | Software Engineer | 2016 - 2018');
    expect(item.position).toBe('Software Engineer');
    expect(item.name).toBe('Datadog');
  });

  it('splits a comma-joined title and employer when nothing else identified one', () => {
    const [item] = work('Freelance Graphic Designer, Self-Employed, 2019 to present');
    expect(item.position).toBe('Freelance Graphic Designer');
    expect(item.name).toBe('Self-Employed');
  });

  it('captures a location without confusing it for the employer', () => {
    const [item] = work('Stripe | Engineer | 2021 - Present\nSan Francisco, CA');
    expect(item.location).toBe('San Francisco, CA');
    expect(item.name).toBe('Stripe');
  });

  it('collects bullets as highlights', () => {
    const [item] = work('Acme | Engineer | 2020 - 2022\n• Shipped X\n• Shipped Y');
    expect(item.highlights).toEqual(['Shipped X', 'Shipped Y']);
  });

  it('parses several roles in document order', () => {
    const items = work(
      [
        'Stripe | Staff Engineer | Jan 2021 - Present',
        '• A',
        'Airbnb | Senior Engineer | Mar 2018 - Dec 2020',
        '• B',
      ].join('\n'),
    );
    expect(items.map((i) => i.name)).toEqual(['Stripe', 'Airbnb']);
    expect(items[1].endDate).toBe('2020-12');
  });

  it('returns nothing for an empty section', () => {
    expect(work('')).toEqual([]);
  });
});

describe('parseEducation', () => {
  it('reads institution, degree and field', () => {
    const [item] = education('Carnegie Mellon University | M.S. in Computer Science | 2014 - 2016');
    expect(item.institution).toBe('Carnegie Mellon University');
    expect(item.studyType).toBe('Master of Science');
    expect(item.area).toBe('Computer Science');
    expect(item.startDate).toBe('2014');
    expect(item.endDate).toBe('2016');
  });

  it('reads a field stated without a connector word', () => {
    const [item] = education('Imperial College London\nMEng Computing\n2010 - 2014');
    expect(item.studyType).toBe('Master of Engineering');
    expect(item.area).toBe('Computing');
  });

  it('treats a lone date as the graduation date', () => {
    const [item] = education('Rhode Island School of Design\nBFA Graphic Design, 2019');
    expect(item.endDate).toBe('2019');
    expect(item.startDate).toBeUndefined();
    expect(item.studyType).toBe('BFA');
  });

  it('captures a GPA', () => {
    const [item] = education('MIT | B.S. Computer Science | 2016\nGPA: 3.9/4.0');
    expect(item.score).toBe('3.9/4.0');
  });

  it('captures a UK honours classification', () => {
    const [item] = education('Imperial College London\nMEng Computing\n2010 - 2014\nFirst Class Honours');
    expect(item.score).toBe('First Class Honours');
  });

  it('collects listed coursework', () => {
    const [item] = education('MIT | BS | 2016\nRelevant Coursework: Algorithms, Databases');
    expect(item.courses).toEqual(['Algorithms', 'Databases']);
  });
});
