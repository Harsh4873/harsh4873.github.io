# PickLedgerPro Maintenance

For any coding or production-maintenance task in this repository:

- Never open the deployed site, a browser, or rendered output to verify changes. Use source review, builds, tests, GitHub Actions logs, and GitHub API state instead.
- Run `npm run upcheck` before declaring the site healthy. If it fails because today's model cache is missing or a model bucket failed, dispatch `model-cache-refresh.yml`, wait for it, and investigate any remaining failure.
- Inspect the latest relevant GitHub Actions runs for model refreshes, external feeds, Cannon data, auto-grading, and Pages deployment.
- Keep GitHub Pages configured for GitHub Actions deployment (`build_type: workflow`), never legacy branch deployment.
- After coding changes, run the focused tests and `npm run upcheck`, commit without any AI/co-author tagline, push to `main` as the currently logged-in GitHub user, and deploy through `deploy-pages.yml`.
- Do not overwrite or revert unrelated user changes.

