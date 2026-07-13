# Slate (Schedule + To-Do) Maintenance

This branch and worktree are for Harsh Dave's personal planner (Slate) only.

## Product Boundary

- Slate lives on the `slate` branch and publishes under `/slate/`.
- Do not add or modify PickLedger, betting, prediction, scraper, grading, model-cache, or player-prop code from this branch.
- Do not add or modify Daymark, Gym, or Portfolio source, data, or styling from this branch — with one exception: `firestore.rules` here intentionally carries the whole project ruleset including Daymark's block, and must stay in lockstep with the `daymark` branch copy.
- Keep Slate local-first. Sections, tasks, and schedule blocks stay in the user's browser unless the user signs in for private sync or explicitly exports them.
- Main publishes Slate by checking out this branch during the Pages workflow and copying the built app into `/slate/`.

## Verification

- Never open the deployed site, a browser preview, rendered Pages output, or live URLs to verify Slate. The user confirms production behavior.
- Agents may review source, run typecheck/build/tests, inspect generated file paths as text, and inspect GitHub Actions/API state.
- Before publishing Slate work, run `npm test`, `npm run typecheck`, and `npm run build`.

## GitHub Publish

- Commit Slate work on the `slate` branch and push `slate` before changing `main` deployment plumbing.
- Commits and pushes must come from the currently logged-in GitHub user.
- Never add AI co-author trailers, `Co-authored-by:` lines, or AI/Cursor/Codex taglines.
- Do not overwrite or revert unrelated user changes.
