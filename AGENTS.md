# Gym App Maintenance

This branch and worktree are for the Gym app only.

## Product Boundary

- Gym lives on the `gym` branch and in `/Users/harshdave/Documents/Gym`.
- Do not touch PickLedger, gambling, model, scraper, player-prop, grading, or prediction code from this worktree.
- Do not add betting data, PickLedger assets, or PickLedger styling to Gym.
- Main publishes Gym by checking out this branch during the Pages workflow and copying the built app into `/gym/`.

## Verification

- Never open the deployed site, a browser preview, rendered Pages output, or live URLs to verify Gym. The user confirms production behavior.
- Agents may review source, run typecheck/build, and inspect GitHub Actions logs.
- Before publishing Gym work, run `npm run typecheck` and `npm run build` from this folder.

## GitHub Publish

- Commit Gym work on the `gym` branch and push `gym`.
- Commits and pushes must come from the currently logged-in GitHub user.
- Never add AI co-author trailers, `Co-authored-by:` lines, or AI/Cursor/Codex taglines.
- Do not overwrite or revert unrelated user changes.
