# PickLedgerPro

PickLedgerPro is a full-stack sports pick tracking and algorithmic prediction system. It tracks picks across NBA, MLB, WNBA, and IPL with a live GitHub Pages frontend and Firebase-backed data.

## Live Site

https://harsh4873.github.io/PickLedgerPro/

## Architecture

| Layer        | Stack                                                                 |
|-------------|-----------------------------------------------------------------------|
| Frontend    | Vite-built static app (`index.html`, `src/main.ts`, `src/styles/`) deployed via GitHub Pages |
| Data Backend| Firebase Firestore (picks, user data, cached feeds)                   |
| Model API   | `pickgrader_server.py` — local or Cloud Run HTTP server for signed-in model runs |
| Models      | Python: NBA, NBA Playoffs, MLB, MLB First Five, WNBA, IPL             |
| Automation  | GitHub Actions: MLB daily Cannon refresh, model training, Pages deploy|

## Repository Structure

```text
PickLedgerPro/
├── index.html                  # Frontend shell
├── src/                        # Extracted TypeScript and CSS
├── pickgrader_server.py        # Model/backend API server
├── runlive.py                  # Orchestrates model runs
├── requirements.txt            # Python dependencies
├── firestore.rules             # Firebase security rules
├── firestore.indexes.json      # Firestore composite indexes
├── data/                       # Static JSON served to GitHub Pages
│   ├── cannon_mlb_daily.json   # MLB Cannon daily projections (auto-refreshed)
│   └── picks_latest.json       # Latest picks snapshot for UI
├── scripts/                    # Local LaunchAgent & helper scripts
├── NBAPredictionModel/         # NBA moneyline + spread model
├── NBAPlayoffsPredictionModel/ # NBA Playoffs model
├── NBAPlayerBettingModel/      # NBA player props model
├── MLBPredictionModel/         # MLB moneyline + totals model
├── models/mlb_first_five/      # MLB first-five side + total model
├── models/mlb_inning/          # MLB no-run inning model
├── WNBAPredictionModel/        # WNBA prediction model
├── ipl/                        # IPL fantasy/win-prediction model
├── docs/                       # Deployment & infra documentation
└── .github/workflows/          # GitHub Actions CI/CD
```

## Setup

1. Copy `.env.example` to `.env` and fill in Firebase credentials.
2. Install Python dependencies:

   ```bash
   pip install -r requirements.txt
   ```

3. Start the local backend (for admin-only actions):

   ```bash
   python pickgrader_server.py
   ```

4. Install frontend dependencies and build the static app:

   ```bash
   npm ci
   npm run build
   ```

5. For the UI, use the live GitHub Pages site or the built `dist/` artifact.

## Automation

- **Cannon MLB Daily Refresh**: Regenerates `data/cannon_mlb_daily.json` on a schedule.
- **Deploy to GitHub Pages**: Builds Vite and deploys on each push to `main`.
- **MLB Model Training**: Manual workflow dispatch in GitHub Actions.

## Notes

- Do not commit `.env`, Firebase admin JSON, or any API keys.
- Model run buttons can call the hosted Cloud Run backend when `VITE_PICKLEDGER_BACKEND_URL` is configured.
- Scraper/cache/admin-only actions still require an admin email configured through `PICKLEDGER_ADMIN_EMAILS`.
