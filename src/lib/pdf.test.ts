import { describe, expect, it } from 'vitest';
import { inferredPaperTitle, pageLabel } from './pdf-utils';

describe('PDF presentation helpers', () => {
  it('turns a file name into a readable fallback title', () => {
    expect(inferredPaperTitle('attention_is-all-you-need.pdf')).toBe('attention is all you need');
  });

  it('keeps page navigation explicit', () => {
    expect(pageLabel(4, 18)).toBe('Page 4 of 18');
    expect(pageLabel(4)).toBe('Page 4');
  });
});
