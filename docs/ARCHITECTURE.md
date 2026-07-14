# Architecture

## Production shape

```text
main
  ├─ harsh.bet landing
  ├─ PickLedger models, grading, and committed cache data
  └─ GitHub Pages assembly workflow

app branches
  ├─ pickledger ───────────────> /pickledger/
  ├─ portfolio ────────────────> /portfolio/
  ├─ daymark ──────────────────> /daymark/
  ├─ slate ────────────────────> /slate/
  ├─ gym ──────────────────────> /gym/
  ├─ fare ─────────────────────> /fare/
  ├─ genome ───────────────────> /genes/
  └─ research ─────────────────> /research/
```

The root landing is a small Vite + TypeScript site. It has no framework, persistence,
authentication, or runtime API dependency. Project links are normal anchors and remain
useful without JavaScript; `src/main.ts` adds only the current year and optional reduced-
motion-aware reveal behavior.

## Pages assembly

`.github/workflows/deploy-pages.yml` runs on pushes to `main` and manual dispatches.

1. The readiness job checks the current PickLedger cache contract.
2. The deploy job checks out `main` and every app branch.
3. The root landing builds into `dist/`.
4. Each app builds into its matching `dist/<path>/` directory.
5. Current PickLedger viewer data is copied from `main` into
   `dist/pickledger/data/`; its frontend resolves data relative to that path.
6. Source-level checks verify CSS/JavaScript assets, required app files, `CNAME`,
   `.nojekyll`, and the four PickLedger data manifests.
7. The composite artifact deploys through GitHub Actions Pages.

The workflow deliberately retains the root `/data/` and `/ipl/` copies for backwards
compatibility during the transition.

## PickLedger data flow

```text
model/feed Actions
      |
      v
committed JSON on main
      |
      +--> scheduled ESPN auto-grader --> committed results
      |
      +--> Profit Desk and parlay builders
      |
      v
Pages copies public viewer caches --> /pickledger/data/
```

PickLedger's public frontend reads these directories:

- `data/model_cache/`
- `data/player_props_cache/`
- `data/parlay_cards/`
- `data/profit_desk/`

The scheduled cache writers continue to share the `pick-cache-writer` concurrency group.
Only one writer may modify committed data at a time.

## Verification

```bash
npm run build
npm run typecheck
python3 -m pytest tests/smoke/test_landing.py tests/smoke/test_pickledger_pipeline.py tests/smoke/test_site_upcheck.py -q
npm run upcheck
```

Validation is source-, build-, and workflow-based. Browser or deployed-site inspection is
left to the repository owner.
