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

## Cursor Cloud specific instructions

- Environment: Node 22 (frontend) + Python 3.12 (scripts/tests). The startup update script already runs `npm ci` and installs Python deps from `requirements.txt` plus `pytest`, so deps are present when an agent starts.
- The frontend is a static Vite + TypeScript viewer that fetches committed JSON from `data/`; there is no backend, database, or login to run. Standard commands live in `package.json` (`dev`, `build`, `typecheck`, `upcheck`) and the README/`docs/ARCHITECTURE.md`.
- Run the app in dev with `npm run dev` (Vite on port 5173). It serves the committed `data/` JSON directly — no separate data process is needed to view picks.
- Non-obvious: pip installs require `--break-system-packages` on this image (PEP 668 externally-managed), and pip console scripts (incl. `pytest`) land in `~/.local/bin`, which is not on PATH — run tests via `python3 -m pytest tests/smoke` rather than the bare `pytest` binary.
- `npm run upcheck` is date-sensitive: it validates that today's (`America/Chicago`) model + player-props caches are committed and healthy. It passes only when today's data exists in `data/`; otherwise follow the model-cache-refresh guidance above.
- The optional Python backend (`pickgrader_server.py`, port 8765) and data-generation/scraper scripts are NOT part of the standard dev loop and are not needed to run or view the site.
