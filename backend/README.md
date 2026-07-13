# Sift research API

This directory is the private server-side boundary for Sift. The browser authenticates with Firebase, but it never receives the OpenAI key. Every non-health endpoint verifies the Firebase ID token against Google's current public signing certificates and then requires all of the following:

- Firebase project `pickledgerpro`
- configured owner UID (`ADMIN_UID`)
- verified `hdav4873@gmail.com` email (or the configured `ADMIN_EMAIL`)
- Google as the Firebase sign-in provider

The API also applies exact-origin CORS, small JSON limits, a 50 MiB PDF ceiling, a 2.75 MiB hard ceiling for upload parts, endpoint-specific in-instance rate limits, upstream timeouts, and non-reflective error messages.

## Request flow

All protected requests use `Authorization: Bearer <Firebase ID token>`. JSON endpoints use `application/json`.

1. `POST /api/upload/start`
   - Body: `{ "bytes": 123, "filename": "paper.pdf", "mimeType": "application/pdf" }`
   - Returns: `{ upload: { id, expiresAt, bytes, filename }, requestId }`
2. `POST /api/upload/part?uploadId=upload_...`
   - Body: a non-empty `application/octet-stream` chunk. The frontend should use 2.5 MiB chunks; the server rejects anything over 2.75 MiB.
   - `X-Upload-Id` may be used instead of the query parameter.
   - Returns: `{ part: { id, uploadId, createdAt }, requestId }`
3. `POST /api/upload/complete`
   - Body: `{ "uploadId": "upload_...", "partIds": ["part_..."] }` in upload order.
   - Returns: `{ file: { id, bytes, filename, status, createdAt }, requestId }`
4. `POST /api/summarize`
   - Body: `{ "fileId": "file-...", "metadata": {}, "localOutline": [] }`
   - Returns: `{ analysis, model, responseId, usage, requestId }`.
   - `analysis` exactly matches the frontend `PaperAnalysisSchema`: the overview, question, methods, findings, section summaries, figures, tables, equations, limitations, glossary, references, claim/source ledger, synthesis, and warnings all have the required page provenance.
5. `POST /api/ask`
   - Body: `{ "fileId", "paperId", "question", "context", "recentMessages" }`.
   - Returns: `{ answer: { answer, grounded, evidence, uncertainty, followUps }, model, responseId, usage, requestId }`.
6. `POST /api/delete-file`
   - Body: `{ "fileId": "file-..." }`.
   - Returns: `{ id, deleted, requestId }`.

`GET /api/health` is intentionally unauthenticated and returns only a generic service/version response. Every route supports `OPTIONS` for the configured origin. Errors always use `{ error: { code, message, requestId } }`. `openai_quota_required` is the stable 503 response when the OpenAI API project needs billing enabled.

## AI behavior and privacy

Summaries and answers use the configured model (`gpt-5.6-terra` by default), PDF input at `detail: "high"`, strict Structured Outputs, and `store: false`. The prompts treat PDFs and screen context as untrusted data, analyze the actual paper structure, require 1-indexed PDF-page evidence, and explicitly cover substantive figures, tables, equations, appendices, caveats, and references. The original PDF remains local in the frontend's IndexedDB except when the owner explicitly invokes analysis/chat, which uploads it to OpenAI. Permanently deleting a paper should call `/api/delete-file` for its OpenAI file ID.

## Local verification

Use a supported Node release (Node 22 is recommended):

```sh
npm install
npm test
npm run typecheck
npm run build
npm audit --omit=dev
```

Copy `.env.example` to a non-committed local environment file only when running `vercel dev`. Set `OPENAI_API_KEY` in Vercel as a sensitive server-side environment variable. Never prefix it with `VITE_`, commit it, place it in a URL, or paste it into browser code.

Required production environment variables:

- `OPENAI_API_KEY`
- `ADMIN_UID`
- `ALLOWED_ORIGIN`
- `FIREBASE_PROJECT_ID`
- `ADMIN_EMAIL`

`OPENAI_MODEL`, timeout, and size variables have the defaults shown in `.env.example`.
