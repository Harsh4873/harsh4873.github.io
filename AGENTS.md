# Portfolio Maintenance

This branch and worktree are for Harsh Dave's Portfolio app only.

## Product Boundary

- The Portfolio app lives on the `portfolio` branch and publishes under `/portfolio/`.
- Do not add or modify PickLedger, betting, prediction, scraper, grading, model-cache, or player-prop code from this branch.
- Do not add or modify Gym source, workout data, storage, or styling from this branch.
- Do not reuse PickLedger's sports-dashboard styling or Gym's utility-app styling. Portfolio uses its own editorial atlas system.
- Keep factual Portfolio copy centralized in `src/content.ts`; omit claims that are ambiguous, private, or not supported by the resume workspace.
- Main publishes Portfolio by checking out the `portfolio` branch during the Pages workflow and copying the built app into `/portfolio/`.

## Verification

- Never open the deployed site, a browser preview, rendered Pages output, or live URLs to verify Portfolio. The user confirms production behavior.
- Agents may review source, run typecheck/build, inspect generated file paths as text, and inspect GitHub Actions/API state.
- Before publishing Portfolio work, run `npm run typecheck` and `npm run build`.

## GitHub Publish

- Commit Portfolio work on the `portfolio` branch and push `portfolio` before changing `main` deployment plumbing.
- Commits and pushes must come from the currently logged-in GitHub user.
- Never add AI co-author trailers, `Co-authored-by:` lines, or AI/Cursor/Codex taglines.
- Do not overwrite or revert unrelated user changes.
