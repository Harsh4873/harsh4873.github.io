# harsh.bet Landing Maintenance

This repository owns only the `harsh.bet` landing site. Each linked project has its own repository and GitHub Pages workflow.

## Project boundaries

- Landing: `Harsh4873/harsh4873.github.io`
- PickLedger: `Harsh4873/pickledger`
- Portfolio: `Harsh4873/portfolio`
- Daymark: `Harsh4873/daymark`
- Slate: `Harsh4873/slate`
- Gym: `Harsh4873/gym`
- Fare: `Harsh4873/fare`
- MtbScope: `Harsh4873/genes`
- Sift: `Harsh4873/research`

Do not add app source, model code, data pipelines, or composite app builds back to this repository. Historical app branches remain only as rollback snapshots.

## Verification

- Never open the deployed site, a browser, rendered output, screenshot, or live URL to verify changes. The repository owner confirms the visual result.
- Review source, run tests/builds, and inspect GitHub Actions and Pages API state.
- Run `npm run upcheck` and `python3 -m pytest tests/smoke/test_landing.py -q` before publishing.

## Publishing

- Commit and push landing changes to `main`, then deploy through `.github/workflows/deploy-pages.yml`.
- Commits and pushes must use the currently logged-in GitHub user.
- Never add AI co-author trailers, `Co-authored-by:` lines, or AI/Cursor/Codex taglines to commits.
- Keep Pages on GitHub Actions (`build_type: workflow`) and keep `CNAME` only in this user-site repository.
- Do not overwrite or revert unrelated user changes.
