import { describe, it, expect } from 'vitest';
import { fmtSigned, clamp, highlight } from '../src/lib/format';

describe('format helpers', () => {
  it('fmtSigned adds an explicit plus for positives', () => {
    expect(fmtSigned(1.234)).toBe('+1.23');
    expect(fmtSigned(-0.5)).toBe('-0.50');
    expect(fmtSigned(0)).toBe('0.00');
  });

  it('clamp bounds a value', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-2, 0, 1)).toBe(0);
    expect(clamp(0.4, 0, 1)).toBe(0.4);
  });

  it('highlight splits a matched query, case-insensitively', () => {
    const segs = highlight('DNA gyrase subunit A', 'gyr');
    expect(segs.filter((s) => s.hit).map((s) => s.text)).toEqual(['gyr']);
    expect(segs.map((s) => s.text).join('')).toBe('DNA gyrase subunit A');
  });

  it('highlight returns the whole string when query is empty', () => {
    expect(highlight('katG', '')).toEqual([{ text: 'katG', hit: false }]);
  });
});
