import type { Dataset, Gene, RawGene } from './types';

/** Path is resolved against Vite's base ('/genes/') so it works under the subpath. */
const DATA_URL = `${import.meta.env.BASE_URL}data/genes.json`;

function expand(r: RawGene): Gene {
  return {
    orf: r.o,
    gene: r.g,
    name: r.g ?? r.o,
    start: r.s,
    end: r.e,
    strand: r.d,
    length: r.l,
    bp: Math.abs(r.e - r.s) + 1,
    annotation: r.a,
    category: r.c,
  };
}

let promise: Promise<Dataset> | null = null;

export function loadDataset(): Promise<Dataset> {
  if (promise) return promise;
  promise = fetch(DATA_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load gene catalog (${res.status})`);
      return res.json();
    })
    .then((raw: { organism: string; source: string; note: string; count: number; categories: Record<string, number>; genes: RawGene[] }) => {
      const genes = raw.genes.map(expand);
      const byOrf = new Map<string, Gene>();
      for (const g of genes) byOrf.set(g.orf, g);
      const dataset: Dataset = {
        organism: raw.organism,
        source: raw.source,
        note: raw.note,
        count: raw.count,
        categories: raw.categories,
        genes,
        byOrf,
      };
      return dataset;
    });
  return promise;
}
