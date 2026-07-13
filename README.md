# MtbScope

MtbScope is a fast, comparison-first browser for the *Mycobacterium tuberculosis* H37Rv genome, published at
`harsh.bet/genes/`. It is an independent reimagining of the [TB Genome Portal](https://orca2.tamu.edu/U19/) with instant
search, multi-facet browsing, and a side-by-side panel for four or more genes at once.

## Features

- **Whole-genome search** — every one of the 4,018 protein-coding genes, searchable by Rv id, gene symbol, or product
  description with ranked autocomplete. Press <kbd>/</kbd> anywhere to focus it.
- **Gene browser** — multi-facet filtering (functional class, strand, essentiality) and sortable columns across the whole
  genome, paginated for speed.
- **Gene pages** — genomic neighbourhood map, per-study essentiality table, transcriptional-response chart, TnSeq fitness and
  protein stats, GO terms, and live links to Mycobrowser, KEGG, UniProt, STRING, AlphaFold and NCBI.
- **Comparison panel** — pin up to eight genes into aligned columns and read their essentiality, an expression heatmap across
  14 conditions, fitness and protein data together. Shareable and bookmarkable by URL.
- **Light / dark themes**, responsive layout, no backend and no tracking.

## Data

- The gene **catalog** — locus (Rv id), gene symbol, coordinates, strand, protein length, and product description — is the
  H37Rv reference annotation, shipped as a static asset (`public/data/genes.json`).
- Analytical panels — essentiality, expression, TnSeq fitness, protein biophysics, vulnerability and selection — are
  **representative demonstration data** generated deterministically from each gene (`src/lib/derive.ts`). They are seeded from
  real properties so patterns are plausible and stable, but they are not experimental measurements. The UI labels them as
  representative; see the About page.

## Development

```sh
npm ci
npm run build:data   # regenerate public/data/genes.json from scripts/source/
npm test
npm run typecheck
npm run build
npm run dev
```

The Vite base, manifest scope and canonical URL all use `/genes/`.

## Credit

Original portal and annotation curation by the TB Genome Portal team (Texas A&M, Harvard, Weill Cornell, UMass, Broad
Institute) and Mycobrowser (EPFL). This is an independent educational reimplementation and is not affiliated with those groups.
