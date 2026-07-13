# Sift Research Maintenance

This branch and worktree are for Harsh Dave's private research-paper workspace only.

## Product Boundary

- Sift lives on the `research` branch and publishes under `/research/`.
- Do not add or modify PickLedger betting, Gym, Portfolio, Daymark, Slate, or Fare product source from this branch.
- Keep original PDFs local to the device in IndexedDB. Only send a paper to the protected AI backend when the signed-in owner explicitly requests analysis or chat.
- Never expose the Groq API key in browser code, committed files, logs, tests, screenshots, or GitHub. The frontend must call the authenticated serverless API.
- `firestore.rules` carries the complete shared ruleset for Daymark, Slate, Fare, and Sift and must remain byte-identical on those four app branches whenever any block changes.
- Main publishes Sift by checking out this branch during the Pages workflow and copying the built app into `/research/`.

## Verification

- Never open the deployed site, a browser preview, rendered output, or live URL to verify Sift. The user confirms production behavior.
- Agents may inspect source, image metadata, build output paths as text, tests, GitHub Actions, and APIs.
- Before publishing, run `npm test`, `npm run test:rules`, `npm run typecheck`, `npm run build`, and the backend test/build commands.

## GitHub Publish

- Commit and push `research` before changing `main` deployment plumbing.
- Commits and pushes must come from the currently logged-in GitHub user.
- Never add AI co-author trailers, `Co-authored-by:` lines, or AI/Cursor/Codex taglines.
- Do not overwrite or revert unrelated user changes.
