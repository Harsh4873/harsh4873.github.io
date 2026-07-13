# Sift research API

This directory is the private server-side boundary for Sift. The browser authenticates with Firebase, but it never receives the Groq key. Every non-health endpoint verifies the Firebase ID token against Google's current public signing certificates and then requires all of the following:

- Firebase project `pickledgerpro`
- configured owner UID (`ADMIN_UID`)
- verified `hdav4873@gmail.com` email (or the configured `ADMIN_EMAIL`)
- Google as the Firebase sign-in provider

The API also applies exact-origin CORS, JSON body limits, endpoint-specific in-instance rate limits, upstream timeouts, and non-reflective error messages.

## Request flow

All protected requests use `Authorization: Bearer <Firebase ID token>` with `application/json` bodies. Sift extracts selectable paper text on the device with PDF.js and sends it per page, so the original PDF bytes never leave the browser. Each page keeps its 1-indexed PDF file-page number for grounded evidence.

1. `POST /api/summarize`
   - Body: `{ "pages": [{ "page": 1, "text": "…" }], "metadata": {}, "truncated": false, "localOutline": [] }`
   - Returns: `{ analysis, model, responseId, usage, requestId }`.
   - `analysis` exactly matches the frontend `PaperAnalysisSchema`: the overview, question, methods, findings, section summaries, figures, tables, equations, limitations, glossary, references, claim/source ledger, synthesis, and warnings all have the required page provenance.
2. `POST /api/ask`
   - Body: `{ "pages", "paperId", "question", "context", "recentMessages", "truncated" }`.
   - Returns: `{ answer: { answer, grounded, evidence, uncertainty, followUps }, model, responseId, usage, requestId }`.

`GET /api/health` is intentionally unauthenticated and returns only a generic service/version response. Every route supports `OPTIONS` for the configured origin. Errors always use `{ error: { code, message, requestId } }`. When a PDF yields no selectable text (for example a scanned, image-only paper), `/api/summarize` and `/api/ask` return a stable `422 no_extractable_text` so the frontend can explain the limitation.

## AI behavior and privacy

The API calls Groq's OpenAI-compatible Chat Completions endpoint with the configured model (`openai/gpt-oss-120b` by default), strict Structured Outputs (`response_format: json_schema`), and a bounded reasoning effort. The prompts treat the paper text and screen context as untrusted data, analyze the actual paper structure, require 1-indexed PDF-page evidence keyed to the `=== PDF page N ===` markers, and explicitly cover substantive figures, tables, equations, appendices, caveats, and references from the extracted text. Because the model receives extracted text rather than rendered images, the prompts require any figure/table/equation detail that cannot be recovered from the text to be reported in `warnings` instead of guessed.

The original PDF remains local in the frontend's IndexedDB. When the owner explicitly invokes analysis or chat, the frontend uploads the extracted paper text (trimmed to a context-window budget) to this API, which forwards it to Groq. Nothing is stored on the AI provider between requests, so there is no remote file to delete.

## Local verification

Use a supported Node release (Node 22 is recommended):

```sh
npm install
npm test
npm run typecheck
npm run build
npm audit --omit=dev
```

Copy `.env.example` to a non-committed local environment file only when running `vercel dev`. Set `GROQ_API_KEY` in Vercel as a sensitive server-side environment variable. Never prefix it with `VITE_`, commit it, place it in a URL, or paste it into browser code.

Required production environment variables:

- `GROQ_API_KEY`
- `ADMIN_UID`
- `ALLOWED_ORIGIN`
- `FIREBASE_PROJECT_ID`
- `ADMIN_EMAIL`

`GROQ_MODEL`, `GROQ_BASE_URL`, and `GROQ_TIMEOUT_MS` have the defaults shown in `.env.example`.
