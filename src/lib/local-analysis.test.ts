import { describe, expect, it } from 'vitest';
import { PaperAnalysisSchema } from '../model';
import { analyzeExtractedPaper, type ExtractedResearchPage } from './local-analysis';

const pages: ExtractedResearchPage[] = [
  {
    page: 1,
    text: '',
    lines: [
      'A Careful Local Study',
      'Ada Researcher and Grace Scientist',
      'Abstract',
      'We investigate whether a compact local method can organize research evidence without a remote model.',
      'The method improves retrieval accuracy by 12 percent compared with the baseline.',
    ],
  },
  {
    page: 2,
    text: '',
    lines: [
      '1 I NTRODUCTION',
      'Research papers are difficult to revisit when their claims are separated from their source pages.',
      'We introduce a deterministic evidence index for this problem.',
      'This page ends with a deliberately long incomplete statement about local extraction and reliable receipts',
    ],
  },
  {
    page: 3,
    text: '',
    lines: [
      '2 M ETHOD',
      'We evaluate the method on 240 documents using a fixed baseline and a held-out test corpus.',
      'The algorithm ranks sentences using section position, term frequency, and result cues.',
      'y = softmax(x) (1)',
      'where x represents the input score.',
    ],
  },
  {
    page: 4,
    text: '',
    lines: [
      '3 R ESULTS',
      'The local system achieves 88 percent accuracy and outperforms the baseline by 12 points.',
      'Figure 1: Retrieval accuracy by document section.',
      'Table 1: Accuracy for the local system and baseline.',
      '4 L IMITATIONS',
      'The evaluation is limited to English papers and may not generalize to scanned documents.',
    ],
  },
  {
    page: 5,
    text: '',
    lines: [
      'R EFERENCES',
      '[1] A. Author. Evidence retrieval for papers. Journal of Testing, 2022. https://doi.org/10.1000/test',
      '[2] B. Author. Deterministic summarization. arXiv:2201.00001, 2022.',
    ],
  },
];

function normalize(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

describe('analyzeExtractedPaper', () => {
  it('builds a deterministic schema-valid brief with repaired headings and technical receipts', () => {
    const input = { pages, title: 'A Careful Local Study', fileName: 'study.pdf', metadata: { year: 2026, url: 'https://example.com/study' } };
    const first = analyzeExtractedPaper(input);
    const second = analyzeExtractedPaper(input);

    expect(PaperAnalysisSchema.parse(first)).toEqual(first);
    expect(second).toEqual(first);
    expect(first.sectionSummaries.map((section) => section.heading)).toEqual(expect.arrayContaining([
      '1 INTRODUCTION', '2 METHOD', '3 RESULTS', '4 LIMITATIONS',
    ]));
    expect(first.methods.length).toBeGreaterThan(0);
    expect(first.keyFindings.length).toBeGreaterThan(0);
    expect(first.figures[0]?.label).toMatch(/Figure 1/i);
    expect(first.tables[0]?.label).toMatch(/Table 1/i);
    expect(first.equations.some((equation) => equation.label === 'Equation 1')).toBe(true);
    expect(first.references).toHaveLength(2);
    expect(first.references[0]?.doi).toBe('10.1000/test');
    expect(first.sourceLedger.length).toBeGreaterThan(5);
  });

  it('keeps every quoted ledger receipt on the page that contains it', () => {
    const result = analyzeExtractedPaper({ pages, title: 'Receipt test' });
    const pageText = new Map(pages.map((page) => [page.page, normalize((page.lines ?? []).join(' '))]));
    result.sourceLedger.forEach((entry) => {
      const quote = normalize(entry.quote);
      expect(pageText.get(entry.page), `${entry.type} receipt on page ${entry.page}`).toContain(quote);
    });
  });

  it('warns instead of inventing detail for a PDF without an extractable text layer', () => {
    const result = analyzeExtractedPaper({
      pages: [{ page: 1, text: '', lines: [] }, { page: 2, text: '', lines: [] }],
      title: 'Scanned paper',
    });
    expect(PaperAnalysisSchema.safeParse(result).success).toBe(true);
    expect(result.keyFindings).toEqual([]);
    expect(result.warnings.some((warning) => /OCR|image-only|text layer/i.test(warning))).toBe(true);
  });

  it('keeps late-page coverage when a headingless paper is longer than thirty pages', () => {
    const headinglessPages: ExtractedResearchPage[] = Array.from({ length: 45 }, (_, index) => {
      const page = index + 1;
      const ordinary = `This narrative passage on page ${page} records the study context and supporting observations for later review.`;
      const lateFinding = page === 45
        ? 'The late-page evaluation achieves 97 percent accuracy and outperforms the baseline on the final benchmark.'
        : `The discussion on page ${page} remains ordinary prose without a section heading.`;
      return { page, text: '', lines: [ordinary, lateFinding] };
    });

    const result = analyzeExtractedPaper({ pages: headinglessPages, title: 'Long headingless paper' });

    expect(PaperAnalysisSchema.safeParse(result).success).toBe(true);
    expect(result.sectionSummaries.some((section) => (
      section.endPage >= 45 || section.evidence.some((receipt) => receipt.page === 45)
    ))).toBe(true);
    expect(result.keyFindings.some((finding) => finding.page === 45 && /97 percent accuracy/i.test(finding.claim))).toBe(true);
    expect(result.warnings.some((warning) => /complete paper into page ranges/i.test(warning))).toBe(true);
  });

  it('deterministically prunes an unusually large brief below the local sync budget', () => {
    const bibliography = Array.from({ length: 250 }, (_, index) => {
      const number = index + 1;
      const filler = 'évidence '.repeat(205);
      return `[${number}] A. Author and B. Writer. Synthetic reference ${number}. Journal of Scale, 2024. ${filler} https://doi.org/10.1234/ref${number}`;
    });
    const input = {
      pages: [{ page: 1, text: '', lines: ['References', ...bibliography] }],
      title: 'Large deterministic bibliography',
    } satisfies { pages: ExtractedResearchPage[]; title: string };

    const first = analyzeExtractedPaper(input);
    const second = analyzeExtractedPaper(input);
    const bytes = new TextEncoder().encode(JSON.stringify(first)).byteLength;

    expect(PaperAnalysisSchema.safeParse(first).success).toBe(true);
    expect(second).toEqual(first);
    expect(bytes).toBeLessThanOrEqual(700_000);
    expect(first.references.length).toBeLessThan(250);
    expect(first.warnings.some((warning) => /trimmed lower-ranked items/i.test(warning))).toBe(true);
  });
});
