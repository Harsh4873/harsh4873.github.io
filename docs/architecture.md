# Sift architecture

## Data flow

```text
PDF selected
  ├─> IndexedDB Blob (this device only)
  ├─> PDF.js text/page index (this device)
  ├─> explicit Local Analysis action
  │     └─> on-device text/layout extraction
  │           └─> deterministic extractive brief + page receipts
  └─> explicit AI Analysis action
        └─> on-device PDF.js text extraction (per page, budgeted)
              └─> authenticated Vercel API
                    └─> Groq Chat Completions structured paper analysis
                          └─> Firestore metadata + analysis sync

Contextual question
  └─> active paper + tab + page + selected text + recent chat
        └─> on-device PDF.js text extraction (per page, budgeted)
              └─> authenticated Vercel API
                    └─> Groq Chat Completions grounded in the extracted text
```

## Paper analysis contract

An analysis is useful only when it preserves the paper's internal structure and makes uncertainty inspectable. The canonical response therefore contains:

- citation metadata and stable source links;
- plain-language orientation and research question;
- section summaries with page ranges;
- methods, data, populations, baselines, and evaluation design;
- findings separated from the authors' interpretation;
- important figures and tables with page, caption, takeaway, and reading caveats;
- important equations with page, notation, role, assumptions, and plain-language meaning;
- a claim ledger with evidence excerpts, page references, confidence, and caveats;
- limitations, threats to validity, unresolved questions, and possible follow-up work;
- glossary and references worth following.

Every generated factual item should carry a page or explicit `not located` signal. The UI must never present an ungrounded model inference as though it were stated by the paper.

Local Analysis uses the same canonical contract as AI Analysis so briefs, notes, ledgers, evidence navigation, and sync behave consistently. Its output is intentionally extractive: section-aware sentence ranking, captions, equation-like lines, identifiers, and evidence excerpts are derived from the PDF text layer. It labels interpretation limits and does not claim to understand image-only figures, malformed text layers, or mathematical meaning that is not stated nearby.

Each active analysis owns a short, renewable lease in the paper record. The lease carries a run ID, browser-session owner, mode, and heartbeat time. When private sync is online, Firestore transactions atomically claim, renew, complete, cancel, retry, or release that lease and update only analysis-owned fields; concurrent sessions cannot both acquire the same fresh paper, and unrelated title or source edits are preserved. Paper metadata and analysis use separate clocks (`updatedAt` and optional `analysisUpdatedAt`), while `analysisRunId` retains completion provenance after the lease clears. Paper-aware merges combine newer metadata with newer analysis state, and a canonical active cloud run cannot be displaced by a different signed-out/offline run during bootstrap or quiet-snapshot repair. Firestore rules reject analysis-clock regression and same-revision analysis changes, while remaining compatible with older records that do not yet have the optional analysis clock. Signed-out Local Analysis uses the same run-ID checks in the local store plus a cross-tab settle check. AI Analysis must acquire its online lease before any upload or API work begins. If a browser disappears, the UI marks the lease stale after three minutes and offers an explicit unlock instead of leaving the paper permanently stuck.

The source-only evaluation harness pins the exact SHA-256 bytes of three official arXiv PDFs (Attention, Adam, and BERT), runs the local engine twice, and checks schema validity, deterministic output, section coverage, page ranges, exact evidence-quote matches, and the sync-size ceiling. It never renders or screenshots the papers.

## Security invariants

- Groq credentials exist only in the serverless environment.
- All non-health API routes require a valid Firebase ID token.
- Token claims must match the Firebase project, issuer, verified Google provider, configured UID owner, and configured email owner.
- CORS accepts only the configured frontend origin.
- The AI provider keeps no copy of the paper between requests; Sift stores only the result it needs.
- Extracted paper text and JSON payloads have explicit size limits.
- Prompts treat paper text and user-selected text as data, never instructions.
- Firestore rejects unknown collections and all non-owner access.
