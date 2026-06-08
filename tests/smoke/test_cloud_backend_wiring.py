from __future__ import annotations

import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_frontend_prefers_configured_cloud_backend_over_stale_local_override():
    source = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")

    configured = source.index("if (CONFIGURED_MODEL_BACKEND_URL && isAllowedBackendServer(CONFIGURED_MODEL_BACKEND_URL))")
    stored_override = source.index("const override = normalizeServerBase(localStorage.getItem(ADMIN_BACKEND_STORAGE_KEY))")
    assert configured < stored_override

    assert "function getModelBackendCandidates()" in source
    assert "isLoopbackServer(ADMIN_BACKEND_URL)" in source
    assert "getModelBackendCandidates()" in source
    assert "async function getBackendAuthUser()" in source
    assert "(auth && auth.currentUser) || window._currentUser || null" in source
    assert "await getBackendAuthToken()" in source
    assert "headers.set('Authorization', `Bearer ${token}`)" in source


def test_cloud_backend_calls_are_not_blocked_by_health_preflight():
    source = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")

    assert "function canSkipBackendHealthGate(value = ADMIN_BACKEND_URL)" in source
    assert "async function canAttemptAdminBackend(force = false)" in source
    assert "if (canSkipBackendHealthGate())" in source
    assert "checkAdminLocalBackendHealth(force).catch(() => {});" in source
    assert "const timeoutMs = canSkipBackendHealthGate() ? 15000 : 3000;" in source

    run_block = source.index("async function _runAsyncModelRequest")
    assert source.index("const backendHealthy = await canAttemptAdminBackend();", run_block) > run_block


def test_frontend_checks_model_cache_before_starting_cloud_job():
    source = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")

    run_block = source.index("async function _runAsyncModelRequest")
    cache_only_flag = source.index("const cacheOnly = !!(body && body.cache_only);", run_block)
    force_gate = source.index("if (!forceRefresh)", run_block)
    cache_lookup = source.index("const cachedResult = await getAdminPicksFromFirebase", run_block)
    cache_only_stop = source.index("if (cacheOnly && !forceRefresh)", run_block)
    backend_probe = source.index("const backendHealthy = await canAttemptAdminBackend();", run_block)

    assert run_block < cache_only_flag < force_gate < cache_lookup < cache_only_stop < backend_probe
    assert "allowRecentFallback: false" in source
    assert "No GitHub model cache is available" in source
    assert "cache_only: !forceRefresh" in source


def test_frontend_uses_central_slate_date_and_reports_github_cache_status():
    source = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "src" / "styles" / "pickledger.css").read_text(encoding="utf-8")

    assert "function getPickLedgerDateKey(date = new Date())" in source
    assert "timeZone: 'America/Chicago'" in source
    assert "return explicit || getPickLedgerDateKey();" in source
    assert "function _getTodayIsoDate()" in source
    assert "return getPickLedgerDateKey();" in source
    assert "const today = getPickLedgerDateKey();" in source
    assert "pushDate('latest');" in source
    assert "cache_date: cacheDate" in source
    assert "cache_doc: docId" in source
    assert "requested_date: requestedDate" in source
    assert "stale_cache: staleCache" in source
    assert "Using ${formatModelRunDate(cacheDate)} GitHub cache" not in source
    assert "function refreshGithubModelCacheStatus()" in source
    assert "./data/model_cache/latest.json" in source
    assert "Ran today at ${runTime}" in source
    assert "Not yet run today" in source
    assert "github-model-cache-status" in html
    assert "GitHub Models" in html
    assert ".github-model-cache-status.is-good" in css


def test_model_schedule_is_visible_as_two_refresh_windows():
    workflow = (ROOT / ".github" / "workflows" / "model-cache-refresh.yml").read_text(encoding="utf-8")
    html = (ROOT / "index.html").read_text(encoding="utf-8")

    assert "45 12 * * *" in workflow
    assert "5 13 * * *" in workflow
    assert "30 13 * * *" in workflow
    assert "5 20 * * *" in workflow
    assert "5 8 * * *" not in workflow
    assert "Models warm before 9:00 AM and refresh around 3:00 PM CT" in html
    assert "8:30 AM, 9:05 AM, 10:30 AM, 3:05 PM, 3:30 PM CT" not in html
    assert "Cannon: 8:55/9:15/9:35 AM + 3:05 PM CT" not in html
    assert "SportyTrader/SportsGambler: 9:10/9:40 AM + 3:10 PM CT" not in html
    assert "<span class=\"models-schedule-label\">Feeds</span>" not in html
    assert "<span class=\"models-schedule-label\">Auth</span>" not in html
    assert "3:05 AM" not in html
    assert "Google sign-in is only for ledger sync or force refresh" not in html


def test_model_cache_workflow_merges_generated_json_on_latest_main():
    workflow = (ROOT / ".github" / "workflows" / "model-cache-refresh.yml").read_text(encoding="utf-8")
    script = (ROOT / "scripts" / "refresh_model_cache.py").read_text(encoding="utf-8")
    merge_script = (ROOT / "scripts" / "merge_model_cache_payload.py").read_text(encoding="utf-8")

    assert "cancel-in-progress: false" in workflow
    assert "mlb_new,mlb_inning,mlb_first_five,wnba,nba,nba_playoffs" in workflow
    assert "mlb_new,mlb_inning,mlb_first_five,wnba,nba,nba_playoffs" in script
    assert "mlb_new,mlb_old,mlb_inning" not in workflow
    assert "_run_model_job_with_retries" in script
    assert "transient failure on attempt" in script
    assert "git reset --hard origin/main" in workflow
    assert "merge_model_cache_payload.py" in workflow
    assert "Check scheduled cache freshness" in workflow
    assert "Scheduled model cache already fresh" in workflow
    assert "if: steps.cache-gate.outputs.skip != 'true'" in workflow
    assert 'BRANCH="${GITHUB_REF_NAME:-main}"' in workflow
    assert 'git pull --rebase --autostash origin "$BRANCH"' not in workflow
    assert "GENERATED_CACHE=" in workflow
    assert "for attempt in 1 2 3; do" in workflow
    assert 'git reset --hard "origin/${BRANCH}"' in workflow
    assert 'git push origin "HEAD:${BRANCH}"' in workflow
    assert 'git rebase "origin/${BRANCH}"' not in workflow
    assert "EXTERNAL_FEED_MODEL_KEYS" in merge_script


def test_model_cache_merge_preserves_external_feed_buckets(tmp_path):
    module_path = ROOT / "scripts" / "merge_model_cache_payload.py"
    spec = importlib.util.spec_from_file_location("merge_model_cache_payload", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)

    cache_dir = tmp_path / "data" / "model_cache"
    cache_dir.mkdir(parents=True)
    current = {
        "date": "2026-06-08",
        "models": {
            "sportytrader": {"ok": True, "picks": [{"pick": "A"}]},
            "sportsgambler": {"ok": True, "picks": [{"pick": "B"}]},
            "nba_old": {"ok": True, "picks": [{"pick": "stale"}]},
        },
        "sportytrader": {"ok": True, "picks": [{"pick": "A"}]},
        "sportsgambler": {"ok": True, "picks": [{"pick": "B"}]},
        "external_feeds": {
            "sportytrader": {"ok": True},
            "sportsgambler": {"ok": True},
        },
    }
    generated = {
        "date": "2026-06-08",
        "updatedAt": "2026-06-08T18:00:00Z",
        "generatedAt": "2026-06-08T18:00:00Z",
        "generatedBy": "github-actions:model-cache-refresh",
        "models": {
            "mlb_new": {"ok": True, "picks": [{"pick": "C"}]},
            "mlb_inning": {"ok": True, "picks": [{"pick": "D"}]},
            "mlb_first_five": {"ok": True, "picks": [{"pick": "E"}]},
            "wnba": {"ok": True, "picks": [{"pick": "F"}]},
            "nba": {"ok": False, "picks": [], "error": "timeout"},
            "nba_playoffs": {"ok": False, "picks": [], "error": "timeout"},
        },
        "mlb_new": {"ok": True, "picks": [{"pick": "C"}]},
        "nba_old": {},
    }
    (cache_dir / "2026-06-08.json").write_text(json.dumps(current), encoding="utf-8")
    merged = module.merge_payload(generated, cache_dir)

    assert sorted(merged["models"]) == [
        "mlb_first_five",
        "mlb_inning",
        "mlb_new",
        "nba",
        "nba_playoffs",
        "sportsgambler",
        "sportytrader",
        "wnba",
    ]
    assert merged["models"]["sportytrader"]["picks"][0]["pick"] == "A"
    assert merged["models"]["sportsgambler"]["picks"][0]["pick"] == "B"
    assert merged["models"]["nba"]["error"] == "timeout"
    assert merged["nba_old"] == {}


def test_model_cache_merge_preserves_deployed_buckets_on_partial_rerun(tmp_path):
    module_path = ROOT / "scripts" / "merge_model_cache_payload.py"
    spec = importlib.util.spec_from_file_location("merge_model_cache_payload", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)

    cache_dir = tmp_path / "data" / "model_cache"
    cache_dir.mkdir(parents=True)
    current = {
        "date": "2026-06-08",
        "models": {
            "mlb_new": {"ok": True, "picks": [{"pick": "C"}]},
            "mlb_inning": {"ok": True, "picks": [{"pick": "D"}]},
            "mlb_first_five": {"ok": True, "picks": [{"pick": "E"}]},
            "wnba": {"ok": True, "picks": [{"pick": "F"}]},
            "sportytrader": {"ok": True, "picks": [{"pick": "A"}]},
            "sportsgambler": {"ok": True, "picks": [{"pick": "B"}]},
        },
    }
    generated = {
        "date": "2026-06-08",
        "models": {
            "nba": {"ok": True, "picks": [{"pick": "G"}]},
            "nba_playoffs": {"ok": True, "picks": [{"pick": "H"}]},
        },
        "nba": {"ok": True, "picks": [{"pick": "G"}]},
        "nba_playoffs": {"ok": True, "picks": [{"pick": "H"}]},
    }
    (cache_dir / "2026-06-08.json").write_text(json.dumps(current), encoding="utf-8")
    merged = module.merge_payload(generated, cache_dir)

    assert sorted(merged["models"]) == [
        "mlb_first_five",
        "mlb_inning",
        "mlb_new",
        "nba",
        "nba_playoffs",
        "sportsgambler",
        "sportytrader",
        "wnba",
    ]
    assert merged["models"]["mlb_new"]["picks"][0]["pick"] == "C"
    assert merged["models"]["nba"]["picks"][0]["pick"] == "G"


def test_external_feed_merge_preserves_model_buckets(tmp_path):
    module_path = ROOT / "scripts" / "merge_external_feed_cache_payload.py"
    spec = importlib.util.spec_from_file_location("merge_external_feed_cache_payload", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)

    cache_dir = tmp_path / "data" / "model_cache"
    cache_dir.mkdir(parents=True)
    current = {
        "date": "2026-06-08",
        "models": {
            "mlb_new": {"ok": True, "picks": [{"pick": "C"}]},
            "mlb_inning": {"ok": True, "picks": [{"pick": "D"}]},
            "mlb_first_five": {"ok": True, "picks": [{"pick": "E"}]},
            "wnba": {"ok": True, "picks": [{"pick": "F"}]},
            "nba": {"ok": False, "picks": [], "error": "timeout"},
            "nba_playoffs": {"ok": False, "picks": [], "error": "timeout"},
        },
        "mlb_new": {"ok": True, "picks": [{"pick": "C"}]},
    }
    generated = {
        "date": "2026-06-08",
        "updatedAt": "2026-06-08T18:05:00Z",
        "externalFeedsUpdatedAt": "2026-06-08T18:05:00Z",
        "models": {
            "sportytrader": {"ok": True, "picks": [{"pick": "A"}]},
            "sportsgambler": {"ok": True, "picks": [{"pick": "B"}]},
        },
        "sportytrader": {"ok": True, "picks": [{"pick": "A"}]},
        "sportsgambler": {"ok": True, "picks": [{"pick": "B"}]},
        "external_feeds": {
            "sportytrader": {"ok": True},
            "sportsgambler": {"ok": True},
        },
    }
    (cache_dir / "2026-06-08.json").write_text(json.dumps(current), encoding="utf-8")
    merged = module.merge_payload(generated, cache_dir)

    assert sorted(merged["models"]) == [
        "mlb_first_five",
        "mlb_inning",
        "mlb_new",
        "nba",
        "nba_playoffs",
        "sportsgambler",
        "sportytrader",
        "wnba",
    ]
    assert merged["models"]["mlb_new"]["picks"][0]["pick"] == "C"
    assert merged["models"]["sportytrader"]["picks"][0]["pick"] == "A"
    assert merged["models"]["sportsgambler"]["picks"][0]["pick"] == "B"


def test_deployed_model_and_ranking_choosers_are_limited_to_eight_sources():
    models_source = (ROOT / "src" / "models.ts").read_text(encoding="utf-8")
    main_source = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")

    for model_id in [
        "model-card-mlb-new",
        "model-card-mlb-inning",
        "model-card-mlb-first-five",
        "model-card-nba-new",
        "model-card-nba-playoffs",
        "model-card-wnba",
        "model-card-sportytrader",
        "model-card-sportsgambler",
    ]:
        assert model_id in models_source
    assert "const DEPLOYED_MODEL_IDS = [" in models_source
    assert "const DEPLOYED_MODELS = ALL_MODELS.filter" in models_source
    assert "DEPLOYED_MODEL_ID_SET.has(m.id) && visibleSet.has(m.id)" in models_source
    assert "DEPLOYED_MODELS.map(function(m)" in models_source

    assert "const DEPLOYED_RANKING_SOURCES = [" in main_source
    for source in [
        "MLB Model",
        "MLB Inning",
        "MLB First Five",
        "NBA New",
        "NBA Playoffs",
        "WNBA Model",
        "SportyTrader",
        "SportsGambler",
    ]:
        assert source in main_source
    assert "const KNOWN_PICKLEDGER_SOURCES = DEPLOYED_RANKING_SOURCES;" in main_source
    assert "stats.filter(s => DEPLOYED_RANKING_SOURCE_SET.has(s.source))" in main_source


def test_cannon_workflow_skips_duplicate_scheduled_refreshes():
    workflow = (ROOT / ".github" / "workflows" / "cannon-daily-refresh.yml").read_text(encoding="utf-8")

    assert "git reset --hard origin/main" in workflow
    assert "Check scheduled Cannon freshness" in workflow
    assert "data/cannon_mlb_daily.json" in workflow
    assert "Scheduled Cannon cache already fresh" in workflow
    assert "if: steps.cache-gate.outputs.skip != 'true'" in workflow


def test_model_cache_freshness_guard_dispatches_only_when_stale():
    workflow = (ROOT / ".github" / "workflows" / "model-cache-freshness-guard.yml").read_text(encoding="utf-8")

    assert 'cron: "12,27,42,57 12-16 * * *"' in workflow
    assert "TARGET_DATE=\"$(TZ=America/Chicago date +%F)\"" in workflow
    assert "data/model_cache/latest.json" in workflow
    assert "fresh=true" in workflow
    assert "fresh=false" in workflow
    assert "--workflow model-cache-refresh.yml" in workflow
    assert 'select(.status == "queued" or .status == "in_progress"' in workflow
    assert 'gh workflow run model-cache-refresh.yml --ref main -f date="$TARGET_DATE"' in workflow


def test_refresh_workflows_commit_with_triggering_actor():
    workflow_paths = [
        ".github/workflows/model-cache-refresh.yml",
        ".github/workflows/cannon-daily-refresh.yml",
        ".github/workflows/external-feed-refresh.yml",
    ]

    for workflow_path in workflow_paths:
        workflow = (ROOT / workflow_path).read_text(encoding="utf-8")
        assert 'ACTOR_EMAIL="${GITHUB_ACTOR_ID:-41898282}+${GITHUB_ACTOR}@users.noreply.github.com"' in workflow
        assert 'git config user.name  "${GITHUB_ACTOR}"' in workflow
        assert 'git config user.email "${ACTOR_EMAIL}"' in workflow
        assert "github-actions[bot]" not in workflow


def test_frontend_checks_cannon_cache_before_live_cloud_scrape():
    source = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")

    cannon_block = source.index("async function loadCannonDailyPicks")
    cache_loader = source.index("const loadScheduledCannonCache = async () =>", cannon_block)
    cache_first = source.index("data = await loadScheduledCannonCache();", cache_loader)
    live_scrape = source.index('fetch(`${ADMIN_BACKEND_URL}/run-cannon-daily`', cannon_block)
    cannon_poll_label = source.index("Running Cannon scrape...", cannon_block)

    assert cannon_block < cache_loader < cache_first < live_scrape < cannon_poll_label


def test_cannon_workflow_deploys_pages_after_cache_commit():
    workflow = (ROOT / ".github" / "workflows" / "cannon-daily-refresh.yml").read_text(encoding="utf-8")

    assert "actions: write" in workflow
    assert "id: commit-cannon" in workflow
    assert "changed=true" in workflow
    assert "gh workflow run deploy-pages.yml --ref main" in workflow
    assert "55 13 * * *" in workflow
    assert "15 14 * * *" in workflow
    assert "35 14 * * *" in workflow
    assert "5 20 * * *" in workflow
    assert "5 19 * * *" not in workflow


def test_frontend_ledger_cache_is_scoped_to_firebase_uid():
    source = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")

    assert "const LEDGER_OWNER_UID_KEY" in source
    assert "function ensureLocalLedgerOwnerForUid(uid)" in source
    assert "window._ensureLocalLedgerOwnerForUid(user.uid)" in source
    assert "const hadLocalLedgerState = localCacheBelongsToUser &&" in source
    assert "const LEDGER_DIRTY_KEY" in source
    assert "function isLocalLedgerDirty()" in source
    assert "markDirty: shouldKeepLocal || forcedResetChanged" in source
    assert "if (!localLedgerBelongsToUid(uid)) return;" in source
    assert "if (!force && !isLocalLedgerDirty()) return;" in source
    assert "k.startsWith('pickledger_ledger_owner_uid')" in source
    assert "k.startsWith('pickledger_ledger_dirty')" in source


def test_frontend_loads_sportytrader_cache_before_live_sync():
    source = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")

    sportytrader_block = source.index("if (model === 'sportytrader')")
    cache_first = source.index("const loaded = await loadSportyTraderManualFeed()", sportytrader_block)
    live_sync = source.index("const synced = await syncSportyTraderFromServer", sportytrader_block)

    assert cache_first < live_sync
    assert "Using browser-cached SportyTrader feed" not in source
    assert "from: 'browser-cache'" not in source


def test_frontend_loads_sportsgambler_cache_before_live_sync():
    source = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")

    sportsgambler_block = source.index("if (model === 'sportsgambler')")
    cache_first = source.index("const loaded = await loadSportsgamblerManualFeed()", sportsgambler_block)
    live_sync = source.index("const synced = await syncSportsgamblerFromServer", sportsgambler_block)

    assert cache_first < live_sync
    assert "Using browser-cached SportsGambler feed" not in source
    assert "from: 'browser-cache'" not in source


def test_model_results_make_inning_game_context_visible_and_actionable_rows_clear():
    source = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "src" / "styles" / "pickledger.css").read_text(encoding="utf-8")

    assert "function _modelResultGameHeaderHtml(pick)" in source
    assert "model-result-game-row" in source
    assert "_isMlbInningModelPick(p) ? _modelResultGameHeaderKey(p) : ''" in source
    assert "const visibleGameLabel = rowGameLabel" in source
    assert "const metaBits = [visibleGameLabel, dateLabel, oddsDisplay" in source
    assert "function _modelResultStartTimeLabel(pick)" in source
    assert "timeZoneName: 'short'" in source
    assert "data-verdict=\"${verdict}\"" in source
    assert "${isActionable ? '' : 'disabled'}" in source
    assert ".model-pick-cb:not(:disabled)" in source
    assert "Select all BET and LEAN rows" in source
    assert "style=\"flex:1;opacity:0.7\"" not in html
    assert ".model-result-game-header" in css
    assert ".model-pick-cb:disabled" in css


def test_home_tab_is_matchup_board_with_modes_and_live_scores():
    source = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "src" / "styles" / "pickledger.css").read_text(encoding="utf-8")

    assert "home-mode-segment" in html
    assert "setHomeResultMode('pending')" in html
    assert "setHomeResultMode('all')" in html
    assert "setHomeResultMode('settled')" in html
    assert "let homeResultMode = 'pending';" in source
    assert "function setHomeResultMode(mode)" in source
    assert "formatSourceRecordLine('TODAY', todayPicks)" in source
    assert "const PRIMARY_SPORTS = ['ALL', 'MLB', 'NBA', 'WNBA'];" in source
    assert "...sports.filter(s => !PRIMARY_SPORTS.includes(s))" in source
    assert "String(p.sport || '').toUpperCase()===activeFilter" in source
    assert "const homeModeCountLabel = homeMode === 'pending' ? 'open' : homeMode === 'settled' ? 'settled' : 'ledger';" in source
    assert "const hiddenByModeCount = homeMode === 'all' ? 0 : Math.max(0, selectedDateTotalCount - selectedDateCount);" in source
    assert "home-mode-notice" in source
    assert "homeMode === 'settled'" in source
    assert "else if(homeMode === 'pending')" in source
    assert "homeMode === 'all'" in source
    assert "home-feed-grid" in source
    assert "home-game-card status-" in source
    assert "home-game-right-stack" in source
    assert "const visibleGameLabel = rowGameLabel" in source
    assert "HOME_SCOREBOARD_CACHE_TTL_MS" in source
    assert "async function refreshHomeScoreboardForDate" in source
    assert "_fetchEspnScoreboard(endpoint.sport, endpoint.league, yyyymmdd, { force: true })" in source
    assert "function _homeScoreEspnUrl(scoreInfo)" in source
    assert "function _homeScoreGoogleUrl(scoreInfo, gameLabel)" in source
    assert "target=\"_blank\" rel=\"noopener noreferrer\" title=\"Open live score\"" in source
    assert "homeScoreChipHtml(homeScoreboardGameMap.get(game.key), game.startIso, game.label)" in source
    assert ".home-mode-segment" in css
    assert ".home-mode-notice" in css
    assert ".home-score-chip" in css
    assert "a.home-score-chip:hover" in css
    assert "grid-template-columns: minmax(0, 1fr) auto;" in css
    assert "background: linear-gradient(180deg, #0d1117 0%, #030509 100%);" in css
    assert 'body[data-theme="light"] .home-score-chip' in css
    assert "font-size: 15px;" in css


def test_search_scans_saved_picks_not_only_pending_rows():
    source = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")

    search_start = source.index("function renderSearch()")
    search_block = source[search_start:source.index("// ── Trends ──", search_start)]
    assert "const picks = getPicks();" in search_block
    assert "getPicks().filter(p => p.result === 'pending')" not in search_block
    assert "search saved picks" in search_block
    assert "No saved picks match your search" in search_block


def test_frontend_ignores_failed_external_feed_cache_payloads():
    source = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")

    extract_block = source.index("function _extractFirebaseModelPayload")
    ok_false = source.index("if (raw.ok === false)", extract_block)
    picks_branch = source.index("if (Array.isArray(raw.picks))", extract_block)

    assert extract_block < ok_false < picks_branch


def test_external_feed_refresh_workflow_runs_scrapers_and_deploys_pages():
    workflow = (ROOT / ".github" / "workflows" / "external-feed-refresh.yml").read_text(encoding="utf-8")
    script = (ROOT / "scripts" / "refresh_external_feeds.py").read_text(encoding="utf-8")
    merge_script = (ROOT / "scripts" / "merge_external_feed_cache_payload.py").read_text(encoding="utf-8")

    assert "python scripts/refresh_external_feeds.py" in workflow
    assert "python -m playwright install chromium chromium-headless-shell" in workflow
    assert "gh workflow run deploy-pages.yml --ref main" in workflow
    assert "cancel-in-progress: false" in workflow
    assert "git reset --hard origin/main" in workflow
    assert 'git pull --rebase --autostash origin "$BRANCH"' not in workflow
    assert "merge_external_feed_cache_payload.py" in workflow
    assert "GENERATED_CACHE=" in workflow
    assert "for attempt in 1 2 3; do" in workflow
    assert 'git reset --hard "origin/${BRANCH}"' in workflow
    assert 'git push origin "HEAD:${BRANCH}"' in workflow
    assert "EXTERNAL_FEED_MODEL_KEYS" in merge_script
    assert "10 14 * * *" in workflow
    assert "40 14 * * *" in workflow
    assert "10 20 * * *" in workflow
    assert "10 19 * * *" not in workflow
    assert '"sportytrader": server.run_sportytrader_scraper' in script
    assert '"sportsgambler": server.run_sportsgambler_scraper' in script
    assert 'payload["models"][feed_key] = result' in script


def test_backend_cloud_routes_require_correct_auth_scope():
    source = (ROOT / "pickgrader_server.py").read_text(encoding="utf-8")

    assert '"/ipl"' in source
    assert '"/run-sportsline-odds"' in source
    assert "def _resolve_authorized_ledger_uid" in source
    assert "cannot access another user's ledger" in source
    assert "requested == user_uid or _is_admin_user(self.auth_user)" in source


def test_cloud_run_docs_include_cost_guardrails():
    source = (ROOT / "docs" / "CLOUD_RUN.md").read_text(encoding="utf-8")

    assert "--min-instances 0" in source
    assert "--max-instances 1" in source
    assert "--concurrency 1" in source
    assert "budget alert" in source.lower()


def test_cloud_backend_bakes_playwright_browsers_and_disables_runtime_install():
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    backend = (ROOT / "pickgrader_server.py").read_text(encoding="utf-8")
    scraper = (ROOT / "scripts" / "scrapers" / "sportytrader_scraper.py").read_text(encoding="utf-8")

    assert "PLAYWRIGHT_BROWSERS_PATH=/ms-playwright" in dockerfile
    assert "PICKLEDGER_PLAYWRIGHT_RUNTIME_INSTALL=false" in dockerfile
    assert "python -m playwright install chromium chromium-headless-shell" in dockerfile
    assert "return \"0\"" not in backend
    assert "return \"0\"" not in scraper


def test_playwright_runtime_install_can_be_disabled(monkeypatch):
    import pickgrader_server as server

    def fail_run(*args, **kwargs):
        raise AssertionError("runtime Playwright install should be skipped")

    monkeypatch.setattr(server, "PLAYWRIGHT_RUNTIME_INSTALL_ALLOWED", False)
    monkeypatch.setattr(server, "_subprocess_run", fail_run)

    ok, message = server._ensure_playwright_browsers("/usr/local/bin/python", {})

    assert ok is False
    assert "runtime Playwright install disabled" in message


def test_rankings_are_global_admin_state_not_personal_fallback():
    source = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")
    rules = (ROOT / "firestore.rules").read_text(encoding="utf-8")
    html = (ROOT / "index.html").read_text(encoding="utf-8")

    assert "const RANKINGS_COLLECTION = 'rankings'" in source
    assert "async function loadSharedRankingsState()" in source
    assert "async function saveSharedRankingsState(state)" in source
    assert "return isRankingsOwnerUser() ? getPicks() : [];" in source
    assert "isRankingsOwnerUser() && typeof getMergedRankingsLedgerState" in source
    assert "match /rankings/{docId}" in rules
    assert "Global model performance from the admin-tracked ledger" in html


def test_nba_model_short_circuits_empty_espn_slate(monkeypatch):
    import pickgrader_server as server

    def fail_run(*args, **kwargs):
        raise AssertionError("NBA model runner should not execute for empty ESPN slate")

    monkeypatch.setattr(server, "_espn_event_count_for_date", lambda sport, date: 0)
    monkeypatch.setattr(server, "_run_script", fail_run)
    monkeypatch.setattr(server, "_save_admin_picks_doc", lambda *args, **kwargs: True)

    result = server.run_nba_model("2026-06-04", "new")

    assert result["ok"] is True
    assert result["picks"] == []
    assert result["slate_games"] == 0
    assert "No NBA games on ESPN scoreboard" in result["note"]
