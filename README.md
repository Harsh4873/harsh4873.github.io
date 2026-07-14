# harsh.bet

`harsh.bet` is the front door to Harsh Dave's projects. The root is a minimal personal
introduction and project index; every product keeps its own identity and opens at a
dedicated path.

## Project map

| Path | Project | Source branch |
| --- | --- | --- |
| `/` | harsh.bet landing | `main` |
| `/pickledger/` | PickLedger | `pickledger` |
| `/portfolio/` | Portfolio | `portfolio` |
| `/daymark/` | Daymark | `daymark` |
| `/slate/` | Slate | `slate` |
| `/gym/` | Gym | `gym` |
| `/fare/` | Fare | `fare` |
| `/genes/` | MtbScope | `genome` |
| `/research/` | Sift | `research` |

GitHub Pages is assembled by `.github/workflows/deploy-pages.yml`. It builds the landing
from `main`, checks out each app branch, and publishes one static artifact under the paths
above. The custom domain remains `harsh.bet` through `CNAME`.

## Transitional PickLedger boundary

The PickLedger interface was preserved on the `pickledger` branch when the landing moved
to `/`. Its scheduled models, grading, cache writers, and source data still live on `main`
for now. The Pages workflow gives the frozen frontend current data by copying the viewer's
four public cache directories into `/pickledger/data/` during every deployment.

This is an intentional V1 boundary. The app branches can move to standalone repositories
after the landing direction and final project naming are settled.

## Local checks

```bash
npm ci
npm run build
python3 -m pytest tests/smoke/test_landing.py tests/smoke/test_pickledger_pipeline.py tests/smoke/test_site_upcheck.py -q
npm run upcheck
```

`npm run upcheck` validates both the built landing and the current PickLedger data
contract. It can fail when today's sports-data refresh is incomplete even when the landing
itself builds successfully.

Visual inspection of local or deployed output is intentionally left to the repository
owner.
