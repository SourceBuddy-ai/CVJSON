import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { detectFormat, extractHtmlText, extractText } from '../src/extract/index.js';
import { extractDocxText } from '../src/extract/docx.js';
import { parseResume } from '../src/index.js';

/**
 * Build a minimal but structurally valid .docx around the given paragraphs.
 * `list: true` marks a paragraph as a bullet via a numbering reference, which
 * is how Word actually represents bullets — there is no bullet character in the
 * file.
 */
function buildDocx(paragraphs: Array<{ text: string; list?: boolean }>): Uint8Array {
  const body = paragraphs
    .map(({ text, list }) => {
      const props = list ? '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' : '';
      const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<w:p>${props}<w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`;
    })
    .join('');

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body}</w:body></w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="xml" ContentType="application/xml"/></Types>`;

  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    'word/document.xml': strToU8(documentXml),
  });
}

describe('detectFormat', () => {
  it('identifies a PDF by its magic bytes', () => {
    expect(detectFormat(new TextEncoder().encode('%PDF-1.7\n...'))).toBe('pdf');
  });

  it('identifies a DOCX by its ZIP container', () => {
    expect(detectFormat(buildDocx([{ text: 'Jane Doe' }]))).toBe('docx');
  });

  it('identifies plain text', () => {
    expect(detectFormat('Jane Doe\njane@example.com')).toBe('txt');
    expect(detectFormat(new TextEncoder().encode('Jane Doe'))).toBe('txt');
  });

  it('identifies HTML by its markup', () => {
    expect(detectFormat('<html><body><p>Jane Doe</p></body></html>')).toBe('html');
  });

  it('reports binary noise as unknown', () => {
    expect(detectFormat(new Uint8Array([0x00, 0xff, 0x01, 0xfe, 0x02, 0xfd]))).toBe('unknown');
  });
});

describe('extractDocxText', () => {
  it('emits one line per paragraph', () => {
    const text = extractDocxText(buildDocx([{ text: 'Jane Doe' }, { text: 'Engineer' }]));
    expect(text.split('\n').filter(Boolean)).toEqual(['Jane Doe', 'Engineer']);
  });

  it('reconstructs bullets from the numbering reference', () => {
    // Word stores list membership as a style reference; without reconstructing
    // it the entire body of every resume would read as header lines.
    const text = extractDocxText(buildDocx([{ text: 'Acme' }, { text: 'Shipped X', list: true }]));
    expect(text).toContain('• Shipped X');
  });

  it('decodes XML entities', () => {
    const text = extractDocxText(buildDocx([{ text: 'Research & Development' }]));
    expect(text).toContain('Research & Development');
  });

  it('rejects a file that is not a DOCX', () => {
    expect(() => extractDocxText(new TextEncoder().encode('not a zip'))).toThrow(/DOCX/);
  });

  it('rejects a ZIP without a document part', () => {
    const zip = zipSync({ 'other.txt': strToU8('hello') });
    expect(() => extractDocxText(zip)).toThrow(/document\.xml/);
  });
});

describe('extractHtmlText', () => {
  it('turns list items into bullets and blocks into lines', () => {
    const text = extractHtmlText('<h1>Jane Doe</h1><ul><li>Shipped X</li><li>Shipped Y</li></ul>');
    expect(text).toContain('Jane Doe');
    expect(text).toContain('• Shipped X');
  });

  it('discards script and style content', () => {
    const text = extractHtmlText('<style>body{color:red}</style><p>Jane</p>');
    expect(text).not.toContain('color');
  });
});

describe('extractText', () => {
  it('routes a DOCX buffer through the DOCX path', async () => {
    const { text, format } = await extractText(buildDocx([{ text: 'Jane Doe' }]));
    expect(format).toBe('docx');
    expect(text).toContain('Jane Doe');
  });

  it('throws a helpful error on an unsupported format', async () => {
    await expect(extractText(new Uint8Array([0x00, 0xff, 0x01, 0xfe]))).rejects.toThrow(
      /Unsupported file format/,
    );
  });
});

describe('parseResume with a DOCX', () => {
  it('parses a resume end to end from a .docx buffer', async () => {
    const docx = buildDocx([
      { text: 'Jane Rodriguez' },
      { text: 'jane@example.com' },
      { text: '' },
      { text: 'EXPERIENCE' },
      { text: 'Stripe | Staff Engineer | Jan 2021 - Present' },
      { text: 'Designed the idempotency layer', list: true },
      { text: '' },
      { text: 'SKILLS' },
      { text: 'Go, Python, Kubernetes' },
    ]);

    const { resume, meta } = await parseResume(docx);

    expect(meta.sourceFormat).toBe('docx');
    expect(resume.basics?.name).toBe('Jane Rodriguez');
    expect(resume.basics?.email).toBe('jane@example.com');
    expect(resume.work?.[0]).toMatchObject({ name: 'Stripe', position: 'Staff Engineer' });
    expect(resume.work?.[0].highlights).toEqual(['Designed the idempotency layer']);
    expect(resume.skills?.[0].keywords).toEqual(['Go', 'Python', 'Kubernetes']);
  });
});

describe('parseResume with a PDF', () => {
  it('parses a resume end to end from a real PDF text layer', async () => {
    const pdf = readFileSync(new URL('./fixtures/sample.pdf', import.meta.url));
    const { resume, meta } = await parseResume(new Uint8Array(pdf));

    expect(meta.sourceFormat).toBe('pdf');
    expect(resume.basics?.name).toBe('Jane Rodriguez');
    expect(resume.basics?.email).toBe('jane@example.com');
    expect(resume.work?.[0]).toMatchObject({ name: 'Stripe', position: 'Staff Engineer' });
    expect(resume.skills?.[0].keywords).toContain('Kubernetes');
  });

  it('warns that a PDF with no text layer needs OCR', async () => {
    // A structurally valid PDF whose page has no content stream at all.
    const blank = new TextEncoder().encode(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n' +
        'trailer\n<< /Size 4 /Root 1 0 R >>\n%%EOF\n',
    );
    const { meta } = await parseResume(blank);
    expect(meta.warnings.join(' ')).toMatch(/OCR|no extractable text/i);
  });
});
