# Automation Scripts

The active production automation uses GitHub Actions plus local Codex morning and afternoon upchecks, and writes committed JSON for the static GitHub Pages viewer.

| Script | Purpose |
| --- | --- |
| `refresh_model_cache.py` | Runs selected model directories and writes dated model-cache JSON. |
| `refresh_external_feeds.py` | Refreshes SportyTrader, SportsGambler, Scores24WNBA, and Scores24MLB cache buckets. |
| `merge_model_cache_payload.py` | Merges model output while preserving other buckets and grades. |
| `merge_external_feed_cache_payload.py` | Merges feed output while preserving model buckets and grades. |
| `auto_grade_picks.py` | Traverses committed model/Cannon picks and grades completed games through ESPN. |
| `cache_manifest.py` | Maintains `data/model_cache/index.json` for the static frontend. |
| `scrapers/scores24_publish_local.sh` | Publishes Scores24WNBA and Scores24MLB from the local Codex morning and afternoon upchecks because Scores24 blocks GitHub-hosted runner IPs. |

Production refresh workflows pass `--skip-firestore`; committed JSON is the source of truth.

Useful local checks:

```bash
python3 scripts/auto_grade_picks.py
python3 -m pytest tests/smoke/test_static_viewer.py -q
```
