import type { Gene } from './types';

// Ranked substring search over the catalog. Scoring favours, in order:
// exact ORF/gene hits, prefix hits on the identifiers, then annotation matches.
// Fast enough to run on every keystroke over the full 4k-gene set.

export interface SearchHit {
  gene: Gene;
  score: number;
}

function scoreGene(gene: Gene, q: string): number {
  const orf = gene.orf.toLowerCase();
  const sym = gene.gene?.toLowerCase() ?? '';
  const ann = gene.annotation.toLowerCase();

  if (orf === q || sym === q) return 1000;
  let score = 0;
  if (orf.startsWith(q)) score = Math.max(score, 800 - (orf.length - q.length));
  if (sym && sym.startsWith(q)) score = Math.max(score, 780 - (sym.length - q.length));
  if (score === 0 && orf.includes(q)) score = 500;
  if (sym.includes(q)) score = Math.max(score, 520);
  if (score === 0) {
    const idx = ann.indexOf(q);
    if (idx === 0) score = 300;
    else if (idx > 0) {
      // Word-boundary annotation hits rank above mid-word ones.
      score = ann[idx - 1] === ' ' ? 220 : 140;
    }
  }
  return score;
}

export function searchGenes(genes: Gene[], query: string, limit = 50): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  const hits: SearchHit[] = [];
  for (const gene of genes) {
    let total = 0;
    let ok = true;
    for (const t of terms) {
      const s = scoreGene(gene, t);
      if (s === 0) {
        ok = false;
        break;
      }
      total += s;
    }
    if (ok) hits.push({ gene, score: total / terms.length });
  }
  hits.sort((a, b) => b.score - a.score || a.gene.start - b.gene.start);
  return hits.slice(0, limit);
}
