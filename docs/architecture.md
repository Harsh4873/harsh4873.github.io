# Sift architecture

## Data flow

```text
PDF selected
  ├─> IndexedDB Blob (this device only)
  ├─> PDF.js text/page index (this device)
  └─> explicit Analyze action
        └─> authenticated Vercel API
              ├─> chunked OpenAI Upload
              └─> Responses API structured paper analysis
                    └─> Firestore metadata + analysis sync

Contextual question
  └─> active paper + tab + page + selected text + recent chat
        └─> authenticated Vercel API
              └─> Responses API grounded in uploaded PDF
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

## Security invariants

- OpenAI credentials exist only in the serverless environment.
- All non-health API routes require a valid Firebase ID token.
- Token claims must match the Firebase project, issuer, verified Google provider, configured UID owner, and configured email owner.
- CORS accepts only the configured frontend origin.
- OpenAI Responses use `store: false`; Sift stores only the result it needs.
- PDF chunks and JSON payloads have explicit size limits.
- Prompts treat paper text and user-selected text as data, never instructions.
- Firestore rejects unknown collections and all non-owner access.
