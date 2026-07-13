# MtbScope Maintenance

This branch hosts MtbScope, a browser for the *M. tuberculosis* H37Rv genome, published under `/genes/`.

## Product boundary

- MtbScope is a static, client-only React + TypeScript single-page app. No backend, no auth, no Firebase.
- Keep dependencies minimal (React, lucide-react icons). Charts are hand-drawn SVG in `src/components/Charts.tsx` — prefer that
  over adding a charting library.

## Data integrity

- The gene catalog (`public/data/genes.json`) is real reference annotation; regenerate it with `npm run build:data`.
- Everything in `src/lib/derive.ts` is representative demonstration data generated deterministically from the ORF id. Do not
  present it as experimental measurement, and keep the representative-data labels on any panel that shows it.
- Functional-class assignment is a keyword heuristic in `scripts/build-dataset.mjs`; it approximates, not reproduces, curated
  TubercuList categories.

## Verification

- Run `npm test`, `npm run typecheck`, and `npm run build` before publishing.
