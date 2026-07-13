import { describe, it, expect } from 'vitest';
import { searchGenes } from '../src/lib/search';
import type { Gene } from '../src/lib/types';

function g(orf: string, gene: string | null, annotation: string, category: Gene['category'] = 'metabolism'): Gene {
  return { orf, gene, name: gene ?? orf, start: 1, end: 2, strand: '+', length: 100, bp: 300, annotation, category };
}

const genes: Gene[] = [
  g('Rv0667', 'rpoB', 'DNA-directed RNA polymerase beta chain'),
  g('Rv1908c', 'katG', 'Catalase-peroxidase KatG', 'virulence'),
  g('Rv0006', 'gyrA', 'DNA gyrase subunit A', 'information'),
  g('Rv0005', 'gyrB', 'DNA gyrase subunit B', 'information'),
  g('Rv3457c', 'rpoA', 'DNA-directed RNA polymerase alpha chain'),
];

describe('searchGenes', () => {
  it('ranks an exact ORF match first', () => {
    expect(searchGenes(genes, 'Rv1908c')[0].gene.orf).toBe('Rv1908c');
  });

  it('ranks an exact gene-symbol match first', () => {
    expect(searchGenes(genes, 'katG')[0].gene.gene).toBe('katG');
  });

  it('matches gene-symbol prefixes and returns both gyrase genes', () => {
    const hits = searchGenes(genes, 'gyr').map((h) => h.gene.gene);
    expect(hits).toContain('gyrA');
    expect(hits).toContain('gyrB');
  });

  it('matches annotation keywords', () => {
    const hits = searchGenes(genes, 'polymerase').map((h) => h.gene.gene);
    expect(hits).toContain('rpoB');
    expect(hits).toContain('rpoA');
  });

  it('returns nothing for an empty query', () => {
    expect(searchGenes(genes, '   ')).toEqual([]);
  });

  it('requires every whitespace-separated term to match', () => {
    expect(searchGenes(genes, 'gyrase subunit A').length).toBeGreaterThan(0);
    expect(searchGenes(genes, 'gyrase zzz')).toEqual([]);
  });
});
