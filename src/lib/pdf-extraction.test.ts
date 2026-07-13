import { describe, expect, it } from 'vitest';
import { extractPdfTextLines } from './pdf-text-extraction';

function textItem(str: string, y: number, hasEOL = false, height = 10) {
  return { str, transform: [1, 0, 0, 1, 0, y], height, hasEOL };
}

describe('line-preserving PDF text extraction', () => {
  it('honors explicit PDF.js line endings and keeps punctuation attached', () => {
    const lines = extractPdfTextLines([
      textItem('Abstract', 720, true),
      textItem('We', 700),
      textItem('find', 700),
      textItem('three', 700),
      textItem('results', 700),
      textItem('.', 700, true),
    ]);

    expect(lines).toEqual(['Abstract', 'We find three results.']);
  });

  it('starts a line when the baseline changes even without an EOL marker', () => {
    const lines = extractPdfTextLines([
      textItem('2 Methods', 680),
      textItem('Participants were randomly assigned.', 660),
      textItem('Figure', 620),
      textItem('1:', 620),
      textItem('Primary outcome.', 620),
    ]);

    expect(lines).toEqual([
      '2 Methods',
      'Participants were randomly assigned.',
      'Figure 1: Primary outcome.',
    ]);
  });

  it('ignores marked-content records and tolerates small baseline jitter', () => {
    const lines = extractPdfTextLines([
      { type: 'beginMarkedContent', id: 'artifact' },
      textItem('confidence', 500),
      textItem('interval', 498),
      { str: '', transform: [1, 0, 0, 1, 0, 498], height: 10, hasEOL: true },
    ]);

    expect(lines).toEqual(['confidence interval']);
  });
});
