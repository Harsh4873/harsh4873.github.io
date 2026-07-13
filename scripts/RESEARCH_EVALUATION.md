# Sift real-paper evaluation

This source-only harness evaluates the deterministic local paper-analysis engine against three primary public research papers. It downloads official arXiv PDF bytes into the operating system's temporary `sift-papers` directory (or `SIFT_PAPER_CACHE`), verifies their pinned SHA-256 identities, extracts text and document bookmarks with PDF.js, and never renders or screenshots a page.

## Engine contract

The runner imports the synchronous pure export below from `src/lib/local-analysis.ts`. Its input includes the same flattened bookmark title/page/depth outline used by the production PDF adapter when the document provides one:

```ts
analyzeExtractedPaper(input: {
  pages: readonly { page: number; text: string; lines?: readonly string[] }[];
  title?: string;
  fileName?: string;
  metadata?: {
    title?: string;
    author?: string;
    subject?: string;
    year?: number;
    venue?: string;
    doi?: string;
    url?: string;
  };
  outline?: readonly { title: string; page?: number; depth?: number }[];
}): PaperAnalysis
```

The engine must not mutate its input. The runner invokes it twice with the same extracted document and requires byte-for-byte stable structured output.

## Papers

| Paper | Pinned primary PDF | Expected SHA-256 |
| --- | --- | --- |
| Attention Is All You Need (v7) | `https://arxiv.org/pdf/1706.03762v7` | `bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697` |
| Adam: A Method for Stochastic Optimization (v9) | `https://arxiv.org/pdf/1412.6980v9` | `eab9c73ae2ceda884b94830bda99312254bac4806f6c9f045cbab90721ecda31` |
| BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding (v2) | `https://arxiv.org/pdf/1810.04805v2` | `5692a5514787a8c6727b4ff3b726a3385798bc68e12138d1d4af83947e2acf6e` |

These are primary-source PDF endpoints maintained by arXiv. The PDFs are runtime cache files and are never placed in Git. Every cached file is hashed before use, and every download is hashed before it can replace the cache. `--offline` fails closed when a cached file is missing or does not match; an online run may replace an invalid cache from the pinned URL, but only if the replacement hash matches.

## Commands

```sh
npm run evaluate:local
npm run evaluate:local -- --extract-only
npm run evaluate:local -- --paper=attention
npm run evaluate:local -- --offline
npm run evaluate:local -- --refresh --json
npm run evaluate:local -- --paper=adam --diagnostics
```

`--extract-only` checks PDF.js text extraction without requiring the engine. `--offline` requires valid cached PDFs. `--refresh` replaces cached copies. `--json` prints metrics and source metadata only. `--diagnostics` appends detected section headings, never section bodies. No output mode prints paper text or full generated summaries.

## Metrics and gates

The compact report includes:

- extracted pages, resolved/total outline entries, characters per page, and source PDF SHA-256;
- `PaperAnalysisSchema` validity and serialized byte size against the 850,000-byte sync ceiling;
- section count, covered pages, and expected-heading coverage;
- findings, methods, figures, tables, equations, references, and ledger counts;
- page-range validity for all receipts and specifically for source-ledger entries;
- normalized exact matches between short evidence quotes and their cited PDF pages;
- abstract-summary token overlap with the opening three source pages;
- first and repeated runtime, stable analysis SHA-256, and deterministic equality.

Schema failures, nondeterminism, out-of-range receipts, insufficient text extraction, an oversized analysis, or a source SHA-256 mismatch fail the command. Paper-specific content minima and weaker quote/abstract coverage are reported as quality warnings so regressions remain visible without pretending that heuristic counts are ground truth.
