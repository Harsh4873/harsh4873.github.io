# Slate

Slate is the private, local-first daily planner published at `harsh.bet/slate/`. Its source is isolated on the `slate` branch of PickLedgerPro and assembled into the composite GitHub Pages artifact by `main` — the same model as Daymark (`daymark` branch → `harsh.bet/daymark/`).

## Product model

- **Schedule** — a time-boxed day from 7:30 AM to 11:30 PM in 30-minute slots. Click a slot (or drag across several) to box out time; blocks never overlap, can be recolored, extended in 30-minute steps, copied from yesterday, or cleared for the day. A coral line tracks the current time on today's view, and tasks due today sit beside the grid.
- **To-Do List** — Notion-style sections with inline-editable titles, per-section colors, collapse, drag-and-drop reordering (within and across sections), due dates, notes, hide-completed, and clear-completed.
- **Profile** — Google sign-in for automatic sync, theme (dark / light / system), JSON export/import, and full reset.

## Architecture

- React 18 + Vite + TypeScript, no runtime dependencies beyond `firebase` and `lucide-react`.
- Local-first store (`src/store.ts`): state lives in localStorage and IndexedDB (dual-write, newest copy wins on load, corrupt copies preserved under `slate-recovery-*` keys). The app is fully usable signed-out and offline.
- Sync (`src/sync-core.ts` + `src/useSlateSync.ts`): per-document last-write-wins on `updatedAt` with deterministic tie-breaks. Every section, task, and schedule block is its own Firestore document under `slate_users/{uid}`; deletes are tombstones so they propagate instead of resurrecting. Access is restricted to the owner's verified Google account, mirroring Daymark.
- Sign-out waits for pending writes, then clears the local mirror (`src/signout.ts`, same tested contract as Daymark).

## Firestore rules

Slate shares the `pickledgerpro` Firebase project with Daymark and Fare. **`firestore.rules` in this branch carries the complete project ruleset (`daymark_users`, `slate_users`, and `fare_users`)** because deploying rules replaces the whole ruleset. Deploy from this branch with:

```
firebase deploy --only firestore:rules
```

Keep this file identical to `firestore.rules` on the `daymark` and `fare` branches whenever any app's rules change.

## Development

```
npm ci
npm run dev        # local dev server
npm test           # unit tests (sync merge, slot math, ordering, parsing, sign-out)
npm run typecheck
npm run build      # tsc + vite build with base /slate/
npm run test:rules # firestore rules tests (requires the firebase emulator)
```

## Publishing

`main`'s `deploy-pages.yml` checks out this branch, runs `npm ci && npm run build`, and copies `dist/` into the site artifact at `/slate/`. Push `slate` first, then let the `main` deploy workflow publish.
