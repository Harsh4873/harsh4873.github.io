# Sift

Sift is Harsh Dave's private, source-grounded research-paper workspace. It is published at `https://harsh.bet/research/` from the `research` branch of PickLedgerPro.

## What it does

- Imports a PDF into a local device library and renders it with PDF.js.
- Offers two explicit analysis paths: an offline, extractive Local Analysis with no account or API credits, and a deeper AI Analysis through the private backend.
- Produces a structured paper brief without flattening the paper into a generic summary.
- Keeps methods, results, limitations, figures, tables, equations, and page-level evidence visible.
- Maintains a claim ledger linking conclusions back to the paper.
- Provides paper notes, source links, search, and a contextual assistant that knows the active paper, tab, page, and selected text.
- Syncs metadata, briefs, ledgers, notes, and chat metadata through the shared private Firebase account.

## Privacy boundary

The original PDF stays in the browser's IndexedDB on each device. Sift does not put the PDF Blob in Firestore. **Local Analysis** runs entirely on the device with PDF.js and deterministic extractive heuristics; it never uploads the PDF and does not require sign-in or API credits. The resulting structured brief can sync as ordinary workspace metadata.

When the signed-in owner chooses **AI Analysis** or asks the assistant a question, the frontend uploads the PDF to the protected backend in small chunks. The backend authenticates the Firebase ID token, permits only the configured verified Google account, and calls OpenAI without exposing the API key to browser code. Ask Sift requires this private AI copy; a local brief alone does not upload or enable chat.

Sift stores the resulting OpenAI file ID with the paper record so grounded follow-up questions can work across signed-in devices. Deleting a paper requests deletion of that remote file and writes a sync tombstone for the paper record.

## Local development

```bash
npm install
npm run typecheck
npm test
npm run evaluate:local -- --offline
npm run test:rules
npm run build
```

Set `VITE_RESEARCH_API_URL` in an uncommitted `.env.local` to point the frontend at the deployed API. The production GitHub Actions build receives the same value from the repository variable `RESEARCH_API_URL`.

The serverless backend is in `backend/`; it has its own dependencies, tests, environment contract, and Vercel deployment.

## Deployment order

1. Test and deploy the Vercel backend with protected environment variables.
2. Set the GitHub Actions repository variable `RESEARCH_API_URL` to the production API origin.
3. Test, commit, and push the `research` branch.
4. Keep and deploy the shared Firestore rules on the Daymark, Slate, Fare, and Research branches.
5. Commit and push the `main` Pages workflow update so it assembles `/research/`.

Never commit API keys, Vercel project state, Firebase debug output, or local PDF data.
