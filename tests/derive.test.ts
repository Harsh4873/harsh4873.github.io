import { describe, it, expect } from 'vitest';
import { derive } from '../src/lib/derive';
import { CONDITIONS, ESSENTIALITY_DATASETS } from '../src/lib/conditions';
import type { Gene } from '../src/lib/types';

function g(orf: string, gene: string | null, category: Gene['category'], length = 300): Gene {
  return { orf, gene, name: gene ?? orf, start: 1, end: length * 3, strand: '+', length, bp: length * 3, annotation: 'x', category };
}

describe('derive', () => {
  it('is stable for a given ORF', () => {
    const a = derive(g('Rv0667', 'rpoB', 'information', 1178));
    const b = derive(g('Rv0667', 'rpoB', 'information', 1178));
    expect(a).toEqual(b);
  });

  it('emits one expression point per condition, all within range', () => {
    const d = derive(g('Rv1234', null, 'metabolism'));
    expect(d.expression).toHaveLength(CONDITIONS.length);
    for (const p of d.expression) {
      expect(Math.abs(p.log2fc)).toBeLessThanOrEqual(6.5);
    }
  });

  it('emits one essentiality row per dataset', () => {
    const d = derive(g('Rv1235', null, 'metabolism'));
    expect(d.essentialityRows).toHaveLength(ESSENTIALITY_DATASETS.length);
  });

  it('anchors well-known essential genes as essential', () => {
    expect(derive(g('Rv0667', 'rpoB', 'information', 1178)).essentiality).toBe('essential');
    expect(derive(g('Rv0005', 'gyrB', 'information', 676)).essentiality).toBe('essential');
  });

  it('anchors katG as non-essential', () => {
    expect(derive(g('Rv1908c', 'katG', 'virulence', 740)).essentiality).toBe('non-essential');
  });

  it('keeps bounded metrics in range', () => {
    const d = derive(g('Rv2043c', 'pncA', 'metabolism', 186));
    expect(d.vulnerability).toBeGreaterThanOrEqual(0);
    expect(d.vulnerability).toBeLessThanOrEqual(1);
    expect(d.tnseq.saturation).toBeGreaterThanOrEqual(0);
    expect(d.tnseq.saturation).toBeLessThanOrEqual(1);
    expect(d.protein.mwKda).toBeGreaterThan(0);
  });
});
