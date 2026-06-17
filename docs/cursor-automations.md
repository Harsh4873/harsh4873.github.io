# Cursor Automations for PickLedgerPro

Use **two scheduled cloud automations** on repo `Harsh4873/PickLedgerPro` / branch `main`. Enable **GitHub** tool access and ensure `gh` is authenticated in the cloud environment.

Delete or replace draft automations named `Harsh's Automation` if they have zero runs.

## 1. Scores24 publish (required — GitHub Actions cannot scrape Scores24)

**Schedule (UTC cron):** `30 14 * * *` and `30 20 * * *` (~9:30 AM and 3:30 PM America/Chicago during CDT).

**Instructions:**

```
Run scripts/scrapers/scores24_publish.sh from the repo root on PickLedgerPro.

Never open the deployed website or a browser to verify output.

After the script finishes, report:
- exit code
- whether a commit was pushed
- Scores24WNBA, Scores24MLB, and Scores24FIFAWorldCup pick counts for today (America/Chicago)
- any scrape or push errors

If Scores24 blocks the cloud IP, say so clearly in the run summary. Do not add AI co-author lines to commits.
```

## 2. Production health check (optional daily sanity)

**Schedule (UTC cron):** `0 21 * * *` (~4:00 PM America/Chicago during CDT).

**Instructions:**

```
Production upcheck for PickLedgerPro. Never open the deployed site or a browser.

Sync main, run npm run upcheck, and python3 -m pytest tests/smoke/test_player_props.py tests/smoke/test_grader_dry_run.py tests/smoke/test_static_viewer.py -q.

Inspect latest GitHub Actions runs for model-cache-refresh, player-props-refresh, external-feed-refresh, auto-grade, and deploy-pages.

If today's model cache or player-props cache is missing or unhealthy, dispatch the matching workflow with gh and wait.

If code fixes are required: test, commit without AI/co-author taglines, push as the logged-in GitHub user, and dispatch deploy-pages.yml.

Summarize health, bucket counts, workflow status, and any blockers.
```
