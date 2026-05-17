# Cloud Run Backend

The public model backend runs `pickgrader_server.py` in a container. GitHub Pages stays static; the browser calls this HTTPS backend when `VITE_PICKLEDGER_BACKEND_URL` is configured.

## Service Defaults

- Service name: `pickledger-backend`
- Runtime: Cloud Run container
- Auth model: public Cloud Run ingress, Firebase ID token required by the app
- Concurrency: `1`
- Max instances: `1` initially
- Timeout: `600s`

## Required Secrets / Env

Store these in Google Secret Manager or Cloud Run environment settings, not in git:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_PRIVATE_KEY_ID`
- `FIREBASE_CLIENT_ID`
- `PICKLEDGER_ADMIN_EMAILS`
- Optional: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, scraper proxy settings

The container defaults `PICKLEDGER_REQUIRE_AUTH=true`, so model routes require a signed-in Firebase user. Admin-only routes also require the user email to appear in `PICKLEDGER_ADMIN_EMAILS`.

## Setting Up Environment Variables In Cloud Run

Set these via the Cloud Run console under **Edit & Deploy > Variables & Secrets**, or use Secret Manager references. Do not put real values in this repo.

- `FIREBASE_PROJECT_ID`: Firebase project id used by Firebase Admin SDK.
- `FIREBASE_CLIENT_EMAIL`: Service-account client email for Firebase Admin SDK.
- `FIREBASE_PRIVATE_KEY`: Service-account private key; Cloud Run should inject it as a secret.
- `PICKLEDGER_ADMIN_EMAILS`: Comma-separated emails allowed to call admin-only routes.
- `PICKLEDGER_REQUIRE_AUTH`: Keep `true` so backend model routes require Firebase sign-in.
- `ENABLE_SPORTYTRADER_REMOTE`: Set `false` unless remote scraper dependencies/proxy are configured.

Frontend builds also need these non-secret public Firebase Web config variables in GitHub Actions or the Pages environment:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_PICKLEDGER_BACKEND_URL`: HTTPS Cloud Run service URL for model requests.

## Deploy Shape

```bash
gcloud run deploy pickledger-backend \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --concurrency 1 \
  --max-instances 1 \
  --timeout 600 \
  --set-env-vars PICKLEDGER_REQUIRE_AUTH=true,ENABLE_SPORTYTRADER_REMOTE=false
```

After Cloud Run gives you the service URL, set the GitHub Pages build variable:

```text
VITE_PICKLEDGER_BACKEND_URL=https://your-cloud-run-url
```

Production Pages still deploys only from `main`; `dev` is for review and validation.
