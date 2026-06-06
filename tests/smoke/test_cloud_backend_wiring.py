from __future__ import annotations

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
    force_gate = source.index("if (!forceRefresh)", run_block)
    cache_lookup = source.index("const cachedResult = await getAdminPicksFromFirebase", run_block)
    backend_probe = source.index("const backendHealthy = await canAttemptAdminBackend();", run_block)

    assert run_block < force_gate < cache_lookup < backend_probe


def test_model_schedule_is_visible_as_two_refresh_windows():
    workflow = (ROOT / ".github" / "workflows" / "model-cache-refresh.yml").read_text(encoding="utf-8")
    html = (ROOT / "index.html").read_text(encoding="utf-8")

    assert "5 20 * * *" in workflow
    assert "5 8 * * *" not in workflow
    assert "Models refresh around 9:00 AM and 3:00 PM CT" in html
    assert "8:30 AM, 9:05 AM, 10:30 AM, 3:05 PM, 3:30 PM CT" not in html
    assert "Cannon: 8:55/9:15/9:35 AM + 3:05 PM CT" not in html
    assert "SportyTrader/SportsGambler: 9:10/9:40 AM + 3:10 PM CT" not in html
    assert "<span class=\"models-schedule-label\">Feeds</span>" not in html
    assert "<span class=\"models-schedule-label\">Auth</span>" not in html
    assert "3:05 AM" not in html
    assert "Google sign-in is only for ledger sync or force refresh" not in html


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
    assert "window._applyUserLedgerState(ledgerToApply, { uid: user.uid })" in source
    assert "if (!localLedgerBelongsToUid(uid)) return;" in source
    assert "k.startsWith('pickledger_ledger_owner_uid')" in source


def test_frontend_loads_sportytrader_cache_before_live_sync():
    source = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")

    sportytrader_block = source.index("if (model === 'sportytrader')")
    cache_first = source.index("const loaded = await loadSportyTraderManualFeed()", sportytrader_block)
    live_sync = source.index("const synced = await syncSportyTraderFromServer", sportytrader_block)

    assert cache_first < live_sync


def test_frontend_loads_sportsgambler_cache_before_live_sync():
    source = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")

    sportsgambler_block = source.index("if (model === 'sportsgambler')")
    cache_first = source.index("const loaded = await loadSportsgamblerManualFeed()", sportsgambler_block)
    live_sync = source.index("const synced = await syncSportsgamblerFromServer", sportsgambler_block)

    assert cache_first < live_sync


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


def test_frontend_ignores_failed_external_feed_cache_payloads():
    source = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")

    extract_block = source.index("function _extractFirebaseModelPayload")
    ok_false = source.index("if (raw.ok === false)", extract_block)
    picks_branch = source.index("if (Array.isArray(raw.picks))", extract_block)

    assert extract_block < ok_false < picks_branch


def test_external_feed_refresh_workflow_runs_scrapers_and_deploys_pages():
    workflow = (ROOT / ".github" / "workflows" / "external-feed-refresh.yml").read_text(encoding="utf-8")
    script = (ROOT / "scripts" / "refresh_external_feeds.py").read_text(encoding="utf-8")

    assert "python scripts/refresh_external_feeds.py" in workflow
    assert "python -m playwright install chromium chromium-headless-shell" in workflow
    assert "gh workflow run deploy-pages.yml --ref main" in workflow
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
