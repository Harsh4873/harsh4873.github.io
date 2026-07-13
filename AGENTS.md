# Daymark Maintenance

This branch and worktree are for Harsh Dave's Daymark app only.

## Product Boundary

- Daymark lives on the `daymark` branch and publishes under `/daymark/`.
- Do not add or modify PickLedger, betting, prediction, scraper, grading, model-cache, or player-prop code from this branch.
- Do not add or modify Gym source, workout data, storage, or styling from this branch.
- Do not add or modify Slate, Fare, Sift, or Portfolio source, data, content, or styling from this branch — with one exception: `firestore.rules` intentionally carries the complete Daymark + Slate + Fare + Sift ruleset and must stay identical to the copies on the `slate`, `fare`, and `research` branches.
- Keep Daymark local-first. Habit entries stay in the user's browser unless the user explicitly exports them.
- Main publishes Daymark by checking out this branch during the Pages workflow and copying the built app into `/daymark/`.

## Verification

- Never open the deployed site, a browser preview, rendered Pages output, or live URLs to verify Daymark. The user confirms production behavior.
- Agents may review source, run typecheck/build/tests, inspect generated file paths as text, and inspect GitHub Actions/API state.
- Before publishing Daymark work, run `npm test`, `npm run typecheck`, and `npm run build`.

## GitHub Publish

- Commit Daymark work on the `daymark` branch and push `daymark` before changing `main` deployment plumbing.
- Commits and pushes must come from the currently logged-in GitHub user.
- Never add AI co-author trailers, `Co-authored-by:` lines, or AI/Cursor/Codex taglines.
- Do not overwrite or revert unrelated user changes.
