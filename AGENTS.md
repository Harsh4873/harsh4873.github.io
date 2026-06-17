# PickLedgerPro Maintenance

For any coding or production-maintenance task in this repository:

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

## Cursor Automations

- Scores24 must run off GitHub Actions IPs. Scheduled cloud automations should call `scripts/scrapers/scores24_publish.sh` — see `docs/cursor-automations.md` for schedules and prompts.
- Optional daily sanity automation prompt is also in that doc. Never open the deployed site to verify; use `npm run upcheck` and Actions logs.
