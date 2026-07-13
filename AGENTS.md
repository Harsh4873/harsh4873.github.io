# PickLedgerPro Maintenance

For any coding or production-maintenance task in this repository:

## Product Boundaries

- PickLedgerPro stays on `main` in `/Users/harshdave/Documents/PickLedgerPro`.
- Gym lives on the `gym` branch in `/Users/harshdave/Documents/Gym` and publishes under `/gym/`.
- Slate lives on the `slate` branch and publishes under `/slate/`.
- Daymark lives on the `daymark` branch and publishes under `/daymark/`.
- Portfolio lives on the `portfolio` branch and publishes under `/portfolio/`.
- Fare lives on the `fare` branch and publishes under `/fare/`.
- Do not touch Gym unless the user asks for Gym work.
- Do not touch PickLedger, gambling, prediction, scraper, grading, model-cache, player-prop, or betting code from the Gym worktree.
- Work on these app branches is isolated; `main` only owns the Pages deployment plumbing that assembles their built artifacts under their named paths.

## Verification (agents only — not the user)

- Never open the deployed site, a browser, rendered Pages output, or live URLs to verify that a change worked. The user confirms production behavior.
- Agents may review source, run builds/tests, read GitHub Actions logs, and inspect GitHub API/workflow state — but must not visually inspect the running site.
- Run `npm run upcheck` before declaring the site healthy. If it fails because today's model cache is missing or a model bucket failed, dispatch `model-cache-refresh.yml`, wait for it, and investigate any remaining failure.
- Inspect the latest relevant GitHub Actions runs for model refreshes, player props, external feeds, auto-grading, and Pages deployment.

## GitHub publish workflow (required after coding changes)

- After any PickLedgerPro coding change: run focused tests and `npm run upcheck`, then **commit, push to `main`, and deploy through `deploy-pages.yml`** — do not leave fixes local-only unless the user explicitly asks not to publish.
- Commits and pushes must come from the **currently logged-in GitHub user** (`gh auth status` / `git log -1 --format='%an %ae'`).
- **Never** add AI co-author trailers, `Co-authored-by:` lines, or any AI/Cursor/Codex tagline to commit messages or pushes.
- Keep GitHub Pages configured for GitHub Actions deployment (`build_type: workflow`), never legacy branch deployment.
- Do not overwrite or revert unrelated user changes.
- For app coding changes, commit and push the app branch first, then commit and push any required `main` deployment updates, and deploy through `deploy-pages.yml`.

## Cursor Automations

- Scores24 must run off GitHub Actions IPs. Scheduled cloud automations should call `scripts/scrapers/scores24_publish.sh` — see `docs/cursor-automations.md` for schedules and prompts.
- Optional daily sanity automation prompt is also in that doc. Never open the deployed site to verify; use `npm run upcheck` and Actions logs.

## Parlay engine (v5, "market excess")

- `scripts/build_parlay_cards.py` anchors leg probabilities to market no-vig prices and adjusts only by each source's trailing excess over market (per source, market-probability band, and Over/Under direction for props), with shrinkage. Raw model probabilities are never trusted directly.
- Cards: up to 2 disjoint team "Edge Double" slips + 1 player "Prop Double" per slate, 2 legs each, leg odds −320..+160, card odds −160..+320. No same-game / same-player / same-side legs — game and side keys are canonicalized across sources so reworded duplicates collide.
- `ENGINE_CUTOVER_DATE = 2026-07-01`: dated parlay files before it are never rebuilt (published v3 history stays); the UI separates records by `engineVersion`.
- Weak slates may show fewer or zero cards. Do not loosen gates to force daily action.
