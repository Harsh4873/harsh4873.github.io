// Builds the static gene catalog served at /genes/data/genes.json.
//
// Source: the H37Rv protein table published by the TB Genome Portal
// (orca2.tamu.edu/U19), itself derived from the H37Rv reference annotation.
// Only the real catalog (ORF id, gene name, coordinates, strand, protein
// length, annotation) is taken from the source. The functional category is
// assigned here by a transparent keyword heuristic — the original TubercuList
// category calls are curated per gene and are approximated, not reproduced.
//
// Run: node scripts/build-dataset.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, 'source/H37Rv.prot_table.html');
const OUT = resolve(here, '../public/data/genes.json');

// Ordered, most-specific-first. The first matching rule wins.
// key === category id used across the app (see src/lib/categories.ts).
const RULES = [
  ['stable-rna', /\b(t-?rna|transfer rna|ribosomal rna|\brrna\b|tmrna|ncrna|small rna|stable rna|16s|23s|5s ribosomal|rnase p)\b/],
  ['insertion-phage', /(transposase|insertion sequ|\bis6110\b|\bis element|integrase|prophage|\bphage\b|resolvase|recombinase.*phage)/],
  ['pe-ppe', /(pe-pgrs|pgrs family|\bppe\b|ppe family|pe family|\bpe_pgrs|\besat-6 like|pe protein)/],
  ['regulatory', /(transcriptional regul|response regul|two[- ]component|sensor histidine|histidine kinase|sigma factor|anti-sigma|\brepressor\b|transcription factor|regulatory protein|dna-binding protein|\bgntr\b|\btetr\b|\blysr\b|\bmarr\b|\barac\b|whib|\bwhi[bd])/],
  ['information', /(dna polymerase|rna polymerase|ribosomal protein|dna gyrase|topoisomerase|\bhelicase\b|primase|dna ligase|dna repair|dna replication|excinuclease|aminoacyl|trna synthetase|trna ligase|translation (initiation|elongation|release)|transcription (termination|antitermination)|nucleotidyltransferase|single-strand dna|mismatch repair|\bnusg?\b|elongation factor|\bgyra\b|\bgyrb\b)/],
  ['lipid', /(fatty acid|mycolic|polyketide|\bpks\b|acyl-coa|acyl carrier|\bfas\b|beta-oxidation|cyclopropane|fatty-acid|lipid (metabolism|biosynth)|desaturase|\bfadd|\bfade|\bfabd|\bfabg|\bfabh|\baccd|dehydratase.*fatty|thiolase|phospholip)/],
  ['virulence', /(catalase|peroxidase|superoxide|\btoxin\b|antitoxin|universal stress|heat[- ]shock|chaperone|\bgroel|\bgroes|\bdnak\b|\bclpb\b|detoxif|arsenate|arsenic|resistance protein|virulence|thioredoxin|glutaredoxin|alkyl hydroperoxide|nitroreductase|stress protein|cold shock|starvation)/],
  ['cell-wall', /(membrane protein|transmembrane|\btransport|transporter|permease|\babc transport|cell wall|cell division|\bftsz|\bftsk|secretion|\besx|type vii|lipoprotein|porin|peptidoglycan|penicillin-binding|\bmmpl|\bmmps|conserved membrane|integral membrane|efflux|arabinosyltransferase|glycosyltransferase.*wall|d-alanine)/],
  ['metabolism', /(dehydrogenase|reductase|oxidoreductase|\bsynthase\b|synthetase|transferase|\bkinase\b|hydrolase|\boxidase\b|cytochrome|atp synthase|\bnadh\b|monooxygenase|dioxygenase|isomerase|carboxylase|aminotransferase|phosphatase|\blyase\b|decarboxylase|hydratase|epimerase|racemase|mutase|aldolase|deaminase|amidase|esterase|dehydratase|reducto|carbonic anhydrase|respiratory|biosynthesis|metabolism|catabolism|glycosyltransferase|methyltransferase|acetyltransferase|phosphoribosyl|pyrophospha|nucleoside|nucleotide|coenzyme)/],
  ['hypothetical', /(hypothetical|conserved protein|unknown function|uncharacter|conserved hypothetical|possible protein|probable protein|conserved (exported )?protein)/],
];

function classify(gene, annotation) {
  const hay = `${gene || ''} ${annotation}`.toLowerCase();
  for (const [id, re] of RULES) if (re.test(hay)) return id;
  return 'unclassified';
}

const html = readFileSync(SRC, 'utf8');
const rows = html.split(/<TR>/i);
const genes = [];
for (const r of rows) {
  const cells = r.split(/<TD>/i).map((c) => c.trim()).filter(Boolean);
  if (!cells.length) continue;
  const m = /<a[^>]*>([^<]+)<\/a>/i.exec(cells[0]);
  if (!m) continue;
  const orf = m[1].trim();
  if (!/^Rv\d/.test(orf)) continue;
  const strip = (x) => x.replace(/<[^>]+>/g, '').trim();
  const geneRaw = strip(cells[1] || '');
  const gene = geneRaw && geneRaw !== '-' ? geneRaw : null;
  const start = parseInt(strip(cells[2] || ''), 10);
  const end = parseInt(strip(cells[3] || ''), 10);
  const strand = strip(cells[4] || '+');
  const aa = parseInt(strip(cells[5] || '0'), 10);
  const annotation = strip(cells[6] || '');
  if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
  genes.push({
    o: orf,
    g: gene,
    s: start,
    e: end,
    d: strand === '-' ? '-' : '+',
    l: Number.isFinite(aa) ? aa : Math.round(Math.abs(end - start) / 3),
    a: annotation,
    c: classify(gene, annotation),
  });
}

genes.sort((a, b) => a.s - b.s);

const byCat = {};
for (const g of genes) byCat[g.c] = (byCat[g.c] || 0) + 1;

const payload = {
  organism: 'Mycobacterium tuberculosis H37Rv',
  source: 'H37Rv reference annotation (protein table via the TB Genome Portal, orca2.tamu.edu/U19)',
  note: 'Catalog fields (ORF, gene, coordinates, strand, length, annotation) are the reference annotation. Functional category is assigned by keyword heuristic.',
  count: genes.length,
  categories: byCat,
  genes,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(payload));
console.log(`Wrote ${genes.length} genes -> ${OUT}`);
console.log('Category distribution:');
for (const [k, v] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(16)} ${v}`);
}
