import { describe, it, expect } from 'vitest';
import { rngFor } from '../src/lib/rng';

describe('rngFor', () => {
  it('is deterministic for the same seed', () => {
    const a = rngFor('Rv0667');
    const b = rngFor('Rv0667');
    const seqA = Array.from({ length: 6 }, () => a.next());
    const seqB = Array.from({ length: 6 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('differs across seeds', () => {
    const a = Array.from({ length: 6 }, rngFor('Rv0667').next);
    const b = Array.from({ length: 6 }, rngFor('Rv1908c').next);
    expect(a).not.toEqual(b);
  });

  it('produces values in [0,1)', () => {
    const r = rngFor('x');
    for (let i = 0; i < 100; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
