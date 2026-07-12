# Habit Tracker Maintenance

This branch and worktree are for Harsh Dave's personal habit tracker only.

## Product Boundary

- The tracker lives on the `tracker` branch and publishes under `/tracker/`.
- Do not add or modify PickLedger, betting, prediction, scraper, grading, model-cache, or player-prop code from this branch.
- Do not add or modify Gym source, workout data, storage, or styling from this branch.
- Do not add or modify personal portfolio source, content, or styling from this branch.
- Keep the tracker local-first. Habit entries stay in the user's browser unless the user explicitly exports them.
- Main publishes the tracker by checking out this branch during the Pages workflow and copying the built app into `/tracker/`.

## Verification

- Never open the deployed site, a browser preview, rendered Pages output, or live URLs to verify the tracker. The user confirms production behavior.
- Agents may review source, run typecheck/build/tests, inspect generated file paths as text, and inspect GitHub Actions/API state.
- Before publishing tracker work, run `npm test`, `npm run typecheck`, and `npm run build`.

## GitHub Publish

- Commit tracker work on the `tracker` branch and push `tracker` before changing `main` deployment plumbing.
- Commits and pushes must come from the currently logged-in GitHub user.
- Never add AI co-author trailers, `Co-authored-by:` lines, or AI/Cursor/Codex taglines.
- Do not overwrite or revert unrelated user changes.
