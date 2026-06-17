from __future__ import annotations

import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def test_frontend_is_static_json_only():
    main = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")
    data = (ROOT / "src" / "data.ts").read_text(encoding="utf-8")
    html = (ROOT / "index.html").read_text(encoding="utf-8")

    assert "from './firebase'" not in main
    assert "auth.currentUser" not in main
    assert "Firestore" not in main
    assert "ADMIN_BACKEND" not in main
    assert "./data/model_cache/index.json" in data
    assert "cannon_mlb_daily" not in data
    assert '<link rel="stylesheet" href="./src/styles/pickledger.css">' in html
    assert "See how every source has performed across the picks and results collected here." in html


def test_frontend_player_mode_is_persisted_isolated_and_team_defaulted():
    main = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")
    data = (ROOT / "src" / "data.ts").read_text(encoding="utf-8")
    settings = (ROOT / "src" / "settings.ts").read_text(encoding="utf-8")
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "src" / "styles" / "pickledger.css").read_text(encoding="utf-8")

    assert 'data-pick-mode="team"' in html
    assert 'data-pick-mode="player"' in html
    assert "const PICK_MODE_KEY = 'pickledger_pick_mode'" in settings
    assert "const mode: PickMode = stored === 'player' ? 'player' : 'team'" in settings
    assert "pickledger:modechange" in settings

    assert "./data/model_cache/index.json" in data
    assert "cannon_mlb_daily" not in data
    assert "./data/player_props_cache/index.json" in data
    assert "./data/player_props_cache/latest.json" in data
    assert "let teamPicks: Pick[] = []" in data
    assert "let playerPicks: Pick[] = []" in data
    assert "function isPlayerScopedPick(" in data
    assert "if (isPlayerScopedPick(pick)) playerById.set(pick.id, pick)" in data
    assert "return activePickMode === 'player' ? playerPicks : teamPicks" in data
    assert "decision === 'BET' || decision === 'LEAN' || decision === 'PASS'" in data

    assert "activeFilter = 'ALL'" in main
    assert "selectedDate = ''" in main
    assert "search.value = ''" in main
    assert "const pending = getAllPicks().filter(pick => pick.result === 'pending')" in main
    assert "mlbLivePlayerStat(" in main
    assert "espnPlayerStat(" in main
    assert "PLAYER_PROPS_ML_FIRST_SNAPSHOT_AT" in data
    assert "isMlEraPlayerProp(pick)" in data
    assert ".pick-mode-segment" in css
    assert "body.mobile-app-mode .pick-mode-segment" in css
    assert "@media (max-width: 700px)" in css


def test_research_details_use_generator_schema_fields_across_pick_views():
    main = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")
    data = (ROOT / "src" / "data.ts").read_text(encoding="utf-8")
    css = (ROOT / "src" / "styles" / "pickledger.css").read_text(encoding="utf-8")

    for field in ("full_kelly", "quarter_kelly", "confidence", "reason", "key_factors"):
        assert f"{field}?" in data
        assert f"pick.{field}" in main
    assert "function researchDetailsHtml(" in main
    assert "Quarter Kelly" in main
    assert "Full Kelly" in main
    assert "Key factors" in main
    assert "expandedResearchPickKeys" in main
    assert "data-research-pick-card" in main
    assert "isPlayer ? '' : `<span class=\"home-feed-row-sport\"" in main
    assert "function bindResearchDetailCards(" in main
    assert "bindPickCards(results)" in main
    assert "bindPickCards(container)" in main
    assert "Show research details" in main
    assert ".home-player-details" in css
    assert ".home-player-extra" in css
    assert ".home-feed-row.expanded .home-player-extra" in css
    assert ".home-player-factors" in css
    assert 'body[data-pick-mode="player"] .home-feed-row-pick' in css
    player_pick_css = css[css.index('body[data-pick-mode="player"] .home-feed-row-pick'):]
    assert "white-space: normal" in player_pick_css[:350]
    assert "overflow: visible" in player_pick_css[:350]
    assert 'body.mobile-app-mode[data-pick-mode="player"] .home-feed-row' in css


def test_home_team_pick_text_expands_on_hover_focus_and_tap():
    main = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")
    css = (ROOT / "src" / "styles" / "pickledger.css").read_text(encoding="utf-8")

    assert 'data-home-pick-text role="button" tabindex="0" aria-expanded="false"' in main
    assert "function bindHomePickTextExpansion(" in main
    assert "row.classList.toggle('pick-text-expanded')" in main
    assert "bindHomePickTextExpansion(container)" in main
    assert "@media (hover: hover) and (pointer: fine)" in css
    assert ".home-feed-row:hover .home-feed-row-pick" in css
    assert ".home-feed-row:focus-visible .home-feed-row-pick" in css
    assert ".home-feed-row-pick[data-home-pick-text]:focus-visible" in css
    assert ".home-feed-row.pick-text-expanded .home-feed-row-pick" in css
    expanded_css = css[css.index(".home-feed-row:hover .home-feed-row-pick"):]
    assert "white-space: normal" in expanded_css[:500]
    assert "overflow: visible" in expanded_css[:500]
    assert "text-overflow: clip" in expanded_css[:500]


def test_header_brand_and_freshness_copy_are_friendly_and_accurate():
    main = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")
    data = (ROOT / "src" / "data.ts").read_text(encoding="utf-8")
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "src" / "styles" / "pickledger.css").read_text(encoding="utf-8")

    assert 'class="brand-home" href="#home" onclick="goHome(event)"' in html
    assert "function goHome(" in main
    assert "function latestPayloadTimestamp(" in data
    assert "Picks updated ${updatedAgoLabel(status.updatedAt)}" in main
    assert "Models refresh each morning and again around 3:30 PM CT" in html
    assert "Scores are checked automatically every 15 minutes" in html
    assert "cache ${status.date}" not in main
    assert ".brand-home" in css


def test_static_viewer_keeps_public_tabs_and_client_grading():
    main = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")
    data = (ROOT / "src" / "data.ts").read_text(encoding="utf-8")
    html = (ROOT / "index.html").read_text(encoding="utf-8")

    for tab in ("home", "search", "rankings", "daily", "your-bets"):
        assert f"id=\"tab-{tab}\"" in html
    assert 'id="tab-trends"' not in html
    assert ">TRENDS</button>" not in html
    assert 'onclick="switchTab(\'daily\')">BEST BETS</button>' in html
    assert 'onclick="switchTab(\'your-bets\')">YOUR BETS</button>' in html
    assert html.index(">BEST BETS</button>") < html.index(">YOUR BETS</button>")
    assert "async function refreshAutoGrades()" in main
    assert "async function gradeDate(" in main
    assert "site.api.espn.com" in main
    assert "setLocalResult(pick.id" in main
    assert "await loadAllData();" in main
    assert "DISPLAY_TIME_ZONE = 'America/Chicago'" in main
    assert "function centralDateKey(" in main
    assert "pick.result === 'pending' && pickDateKey(pick) === selectedDate" in main
    assert "window.setInterval(() => void refreshForCentralClock(), AUTO_REFRESH_MS)" in main
    assert "Find a team, matchup, or source in the selected date’s open picks" in html
    assert "embeddedResult === 'pending' ? localResult : embeddedResult" in data
    assert "function isTrackedPick(" in data
    assert "decision === 'BET' || decision === 'LEAN'" in data
    assert "pick && isTrackedPick(pick)" in data
    assert "function renderRankings()" in main
    assert "function renderSearch()" in main


def test_rich_static_viewer_restores_consensus_table_and_scores():
    main = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "src" / "styles" / "pickledger.css").read_text(encoding="utf-8")

    assert "function canonicalTrendSignal(" in main
    assert "matching: !group.pass && new Set(group.picks.map(sourceName)).size >= 2" in main
    assert ".trend-market.matching" in css
    assert "function renderDayOfWeekTable()" in main
    assert 'class="dow-table"' in main
    assert 'id="dow-overall-heatmap"' not in html
    assert "async function refreshHomeScores(" in main
    assert "homeScoreChipHtml(" in main
    assert "Open ESPN box score" in main


def test_source_rankings_expand_period_records_and_static_cards_do_not_fake_clicks():
    main = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "src" / "styles" / "pickledger.css").read_text(encoding="utf-8")

    assert "function sourceRecordLines(" in main
    for label in ("TODAY", "YESTERDAY", "LAST 7 DAYS", "ALL TIME"):
        assert f"label: '{label}'" in main
    assert 'data-source-card="${escapeHtml(item.source)}"' in main
    assert 'role="button" tabindex="0" aria-expanded="${expanded}"' in main
    assert "function bindSourceCards(" in main
    assert "View period records" in main
    assert "Select a source for today, yesterday, last 7 days, and all-time records." in html
    assert ".source-expand-control" in css
    assert ".source-card.expanded .source-deep-dive" in css
    assert ".trend-game-card:hover" not in css
    assert ".search-card:hover" not in css
    assert ".sport-card:hover" not in css
    assert ".home-game-card:hover" not in css
    assert ".daily-bet-card:hover" not in css


def test_daily_tab_uses_focused_views_and_merges_duplicate_markets():
    main = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")
    css = (ROOT / "src" / "styles" / "pickledger.css").read_text(encoding="utf-8")

    for section in ("Top Picks", "Consensus Signals", "Hot Sources", "Research Queue"):
        assert section in main
    assert "PRICEY FAVORITE" in main
    assert "function dailySourceForms(" in main
    assert "function dailyPickScore(" in main
    assert "function dailyPickKey(" in main
    assert "function dailyPickGroups(" in main
    assert "allPicks: Pick[] = picks" in main
    assert "uniqueDailyPicks(ranked(pending.filter" in main
    assert "function dailyConsensusCards(" in main
    consensus_cards = main[main.index("function dailyConsensusCards("):main.index("function setDailyView(")]
    assert ".slice(0, 6)" not in consensus_cards
    assert "All matching market signals" in main
    assert "Sources issuing BET calls today" in main
    assert "function setDailyView(" in main
    assert "researchDetailsHtml(pick, expanded)" in main
    assert "yourBetAddButton(pick)" in main
    assert "researchDetailsHtml(game, expanded)" in main
    assert "yourBetAddButton(game)" in main
    assert "Each unique market appears once." in main
    assert "excluding anything already in Top Picks" in main
    assert ".daily-bet-card" in css
    assert ".daily-model-card" in css
    assert ".daily-consensus-card" in css
    assert ".daily-view-nav" in css
    assert ".daily-view-select-wrap" in css
    assert ".daily-pick-source-list" in css
    assert "daily-slate-grid" not in main


def test_soccer_consensus_keeps_lines_and_specialty_markets_distinct():
    main = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")
    signals = main[main.index("function canonicalTrendSignal("):main.index("function trendSignalGroups(")]
    assert "asian-handicap" in signals
    assert "spread:${canonicalTeamForPick(pick, spread[1])}:${spread[2]}" in signals
    assert "total:${total[1].toLowerCase()}:${total[2]}" in signals
    assert "(?:ML|moneyline|to win|wins?)$/i" in signals


def test_player_mode_keeps_best_bets_available_and_prop_sources_separate():
    main = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")
    data = (ROOT / "src" / "data.ts").read_text(encoding="utf-8")
    html = (ROOT / "index.html").read_text(encoding="utf-8")

    assert 'data-player-hidden-tab="trends"' not in html
    assert "function syncModeTabs(" not in main
    assert 'onclick="switchTab(\'daily\')">BEST BETS</button>' in html
    assert "activePickMode !== 'player' || option.key !== 'consensus'" in main
    assert "activePickMode === 'player' && view === 'consensus'" in main
    assert "playerResearchPool" in main
    assert "function playerRankingEpoch(" in main
    assert "function rankingComparablePicks(" in main
    assert "reflect every ML-era slate" in main
    assert "function playerModelRank(" in main
    assert "return 10000 - modelRank" in main
    assert "Next-best player prop candidates" in main
    for source in ("NBAPlayerProps", "MLBPlayerProps", "WNBAPlayerProps"):
        assert source in data
    assert "playerProp && fallbackSource" in data


def test_home_filters_prioritize_primary_sports_and_use_more_menu():
    main = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")
    data = (ROOT / "src" / "data.ts").read_text(encoding="utf-8")
    css = (ROOT / "src" / "styles" / "pickledger.css").read_text(encoding="utf-8")

    assert "const PRIMARY_FILTERS = ['ALL', 'MLB', 'WNBA', 'FIFA WC']" in main
    assert "const ARCHIVED_SPORTS = new Set(['NBA'])" in data
    assert "!ARCHIVED_SPORTS.has(pick.sport)" in data
    assert "'MLB NEW': 'MLB Model'" in data
    assert "'FIFA WC In-House': 'FIFA Model'" in data
    assert "filter === 'FIFA WC' ? 'FIFA' : filter" in main
    assert 'id="filter-more-btn"' in main
    assert "extraFilters.map(filterButton)" in main
    assert ".filter-more-wrap" in css
    assert ".filter-dropdown.open" in css
    assert "body.mobile-app-mode .filter-more-wrap" in css
    assert "position: static" in css[css.index("body.mobile-app-mode .filter-more-wrap"):][:120]
    mobile_filter = css[css.index("body.mobile-app-mode .filter-bar"):]
    assert "overflow: visible" in mobile_filter[:220]


def test_your_bets_is_mode_separated_locked_device_local_ledger():
    main = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "src" / "styles" / "pickledger.css").read_text(encoding="utf-8")

    assert "const YOUR_BETS_STORAGE_KEY = 'pickledger_your_bets_v1'" in main
    assert "localStorage.setItem(YOUR_BETS_STORAGE_KEY" in main
    assert "function addPickToYourBets(" in main
    assert "function updateYourBetUnits(" in main
    assert "function syncYourBetResults(" in main
    assert "const modeBets = yourBets.filter(bet => bet.pickMode === activePickMode)" in main
    assert "bet.pickMode === activePickMode && bet.pickId === pick.id" in main
    assert "Results are locked and graded by PickLedger" in main
    assert "Locked and graded by PickLedger" in main
    assert "function addCustomYourBet(" not in main
    assert "function updateYourBetResult(" not in main
    assert "function undoYourBetChange(" not in main
    assert "Add A Custom Bet" not in main
    assert "UNDO CHANGE" not in main
    for label in ("TODAY", "YESTERDAY", "ALL TIME"):
        assert f"yourBetSummaryCard('{label}'" in main
    assert 'id="tab-your-bets"' in html
    assert ".your-bets-shell" in css
    assert ".your-bet-card" in css
    assert ".your-bet-locked-result" in css


def test_phone_toggle_keeps_brand_visible_and_more_menu_unclipped():
    css = (ROOT / "src" / "styles" / "pickledger.css").read_text(encoding="utf-8")

    mobile_header = css[css.index("body.mobile-app-mode header {"):]
    assert "grid-template-columns: minmax(0, 1fr)" in mobile_header[:260]
    assert "body.mobile-app-mode .brand-home" in css
    brand = css[css.index("body.mobile-app-mode .brand-home"):]
    assert "width: max-content" in brand[:180]
    assert "overflow: visible" in brand[:180]


def test_tab_ordering_prioritizes_home_start_time_and_actionable_picks_elsewhere():
    main = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")

    for helper in (
        "function pickStartTimestamp(",
        "function gameStartTimestamp(",
        "function compareGameStartAsc(",
        "function startBucket(",
        "function compareActionableStart(",
        "function comparePickActionableStart(",
        "function compareHomePickRows(",
    ):
        assert helper in main
    assert "return timestamp > now ? 0 : 2" in main
    assert "if (leftBucket !== rightBucket) return leftBucket - rightBucket" in main
    assert "return leftBucket === 2 ? right - left : left - right" in main
    assert "const sortedGames = [...groups.entries()].sort((left, right) => compareGameStartAsc(left[1], right[1]))" in main
    assert "const sortedPicks = [...picks].sort(compareHomePickRows)" in main
    assert "homeDecisionRank(left) - homeDecisionRank(right)" in main
    assert "(pickProbability(right) || 0) - (pickProbability(left) || 0)" in main
    assert ".sort(comparePickActionableStart);" in main
    assert "comparePickActionableStart(a.primary, b.primary)" in main
    assert "comparePickActionableStart(a.game, b.game)" in main
    assert ".sort(comparePickActionableStart));" in main


def test_cache_manifest_lists_committed_dated_payloads():
    manifest = json.loads((ROOT / "data" / "model_cache" / "index.json").read_text(encoding="utf-8"))
    files = manifest["files"]
    assert files == sorted(files)
    assert files
    assert "latest.json" not in files
    for filename in files:
        assert (ROOT / "data" / "model_cache" / filename).exists()


def test_auto_grader_updates_nested_model_picks(monkeypatch):
    module = _load_module("auto_grade_picks", ROOT / "scripts" / "auto_grade_picks.py")
    payload = {
        "date": "2026-06-08",
        "models": {
            "mlb_new": {
                "picks": [
                    {
                        "source": "MLB Model",
                        "sport": "MLB",
                        "pick": "Cubs ML (Cubs vs Cardinals)",
                        "decision": "BET",
                        "result": "pending",
                    }
                ]
            }
        },
    }

    def fake_grade(picks, existing, year):
        pick_id = picks[0]["id"]
        return {
            "graded": {pick_id: "win"},
            "startTimes": {pick_id: "2026-06-08T20:00:00Z"},
        }

    monkeypatch.setattr(module.pickgrader_server, "auto_grade", fake_grade)
    assert module.grade_payload(payload) == 2
    pick = payload["models"]["mlb_new"]["picks"][0]
    assert pick["result"] == "win"
    assert pick["start_time"] == "2026-06-08T20:00:00Z"


def test_auto_grader_rechecks_previously_decided_tracked_picks(monkeypatch):
    module = _load_module("auto_grade_recheck_test", ROOT / "scripts" / "auto_grade_picks.py")
    payload = {
        "date": "2026-06-13",
        "models": {
            "wnba_player_props": {
                "picks": [{
                    "id": "aneesah-morrow-rebounds",
                    "source": "PickLedgerPro In-House Player Props",
                    "scope": "player",
                    "sport": "WNBA",
                    "pick": "Aneesah Morrow Over 10.5 Rebounds",
                    "decision": "BET",
                    "result": "win",
                }]
            }
        },
    }

    def fake_grade(picks, existing, year):
        assert picks[0]["result"] == "pending"
        return {"graded": {"aneesah-morrow-rebounds": "loss"}, "startTimes": {}}

    monkeypatch.setattr(module.pickgrader_server, "auto_grade", fake_grade)
    assert module.grade_payload(payload) == 1
    assert payload["models"]["wnba_player_props"]["picks"][0]["result"] == "loss"


def test_auto_grader_only_tracks_bet_and_lean_decisions(monkeypatch):
    module = _load_module("auto_grade_pass_test", ROOT / "scripts" / "auto_grade_picks.py")
    payload = {
        "date": "2026-06-08",
        "models": {
            "mlb_new": {
                "picks": [
                    {
                        "source": "MLB Model",
                        "sport": "MLB",
                        "pick": "Cubs ML (Cubs vs Cardinals)",
                        "decision": "PASS",
                        "result": "pending",
                    },
                    {
                        "source": "MLB Model",
                        "sport": "MLB",
                        "pick": "Cardinals ML (Cubs vs Cardinals)",
                        "decision": "WATCH",
                        "result": "pending",
                    },
                    {
                        "source": "MLB Model",
                        "sport": "MLB",
                        "pick": "Over 8.5 (Cubs vs Cardinals)",
                        "result": "pending",
                    },
                ]
            }
        },
    }

    def fail_if_called(*_args):
        raise AssertionError("PASS decisions must not be sent to the grader")

    monkeypatch.setattr(module.pickgrader_server, "auto_grade", fail_if_called)
    assert module.grade_payload(payload) == 0
    assert all(pick["result"] == "pending" for pick in payload["models"]["mlb_new"]["picks"])


def test_auto_grader_ignores_player_props_from_before_ml_retraining(monkeypatch):
    module = _load_module("auto_grade_ml_cutoff_test", ROOT / "scripts" / "auto_grade_picks.py")
    payload = {
        "date": "2026-06-15",
        "generatedAt": "2026-06-15T22:55:06Z",
        "models": {
            "mlb_player_props": {
                "picks": [{
                    "id": "legacy-prop",
                    "sport": "MLB",
                    "pick": "Player Over 0.5 Hits",
                    "decision": "BET",
                    "result": "pending",
                    "probability_source": "legacy_projection",
                    "ranking_updated_at": "2026-06-15T22:55:06Z",
                }]
            }
        },
    }

    monkeypatch.setattr(module.pickgrader_server, "auto_grade", lambda *_args: (_ for _ in ()).throw(AssertionError("legacy props must not be graded")))
    assert module.grade_payload(payload, ml_player_props_only=True) == 0


def test_scheduled_refreshes_are_json_only_and_use_shared_writer_lock():
    workflow_names = (
        "auto-grade.yml",
        "calibration-refresh.yml",
        "model-cache-refresh.yml",
        "player-props-refresh.yml",
        "external-feed-refresh.yml",
    )
    for name in workflow_names:
        workflow = (ROOT / ".github" / "workflows" / name).read_text(encoding="utf-8")
        assert "group: pick-cache-writer" in workflow
        assert "cancel-in-progress: false" in workflow

    model = (ROOT / ".github" / "workflows" / "model-cache-refresh.yml").read_text(encoding="utf-8")
    feeds = (ROOT / ".github" / "workflows" / "external-feed-refresh.yml").read_text(encoding="utf-8")
    assert "--skip-firestore" in model
    assert "--skip-firestore" in feeds
    assert "FIREBASE_PROJECT_ID" not in model
    assert "FIREBASE_PROJECT_ID" not in feeds


def test_refresh_timing_and_pages_deploy_are_deterministic():
    workflows = ROOT / ".github" / "workflows"
    model = (workflows / "model-cache-refresh.yml").read_text(encoding="utf-8")
    feeds = (workflows / "external-feed-refresh.yml").read_text(encoding="utf-8")
    grader = (workflows / "auto-grade.yml").read_text(encoding="utf-8")
    calibration = (workflows / "calibration-refresh.yml").read_text(encoding="utf-8")
    props = (workflows / "player-props-refresh.yml").read_text(encoding="utf-8")
    deploy = (workflows / "deploy-pages.yml").read_text(encoding="utf-8")

    assert "cache-gate" not in model
    assert "cron: '*/15 * * * *'" in grader
    assert 'cron: "45 12 * * *"' in model
    assert 'cron: "10,40 14 * * *"' in feeds
    assert "gh workflow run calibration-refresh.yml --ref main" in grader
    assert "decided - last >= 100" in grader
    assert "python scripts/train_pick_calibration.py" in calibration
    assert "gh workflow run player-props-refresh.yml --ref main" in calibration
    for workflow in (model, props, feeds, grader, calibration):
        assert "gh workflow run deploy-pages.yml --ref main" in workflow
        assert "actions: write" in workflow
    assert not (workflows / "cannon-daily-refresh.yml").exists()
    assert "Check daily data readiness" in deploy
    assert "python scripts/site_upcheck.py --data-only" in deploy
    assert "if: needs.readiness.outputs.ready == 'true'" in deploy
    assert "Verify styled Pages artifact" in deploy
    assert "find dist/assets -maxdepth 1 -name '*.js'" in deploy
    assert "! grep -q 'src/main.ts' dist/index.html" in deploy
    assert "python scripts/site_upcheck.py" in deploy
    guard = (workflows / "model-cache-freshness-guard.yml").read_text(encoding="utf-8")
    assert 'CACHE_HEALTHY="$(python - <<\'PY\'' in guard
    assert 'models[key].get("ok") is True for key in required' in guard
    assert 'PLAYER_CACHE_HEALTHY="$(python - <<\'PY\'' in guard
    assert 'int(mlb.get("games") or 0) > 0 and not (mlb.get("picks") or [])' in guard


def test_refresh_workflows_commit_as_triggering_actor():
    for name in (
        "auto-grade.yml",
        "calibration-refresh.yml",
        "model-cache-refresh.yml",
        "player-props-refresh.yml",
        "external-feed-refresh.yml",
    ):
        workflow = (ROOT / ".github" / "workflows" / name).read_text(encoding="utf-8")
        assert 'git config user.name  "${GITHUB_ACTOR}"' in workflow
        assert 'git config user.email "${ACTOR_EMAIL}"' in workflow
        assert "github-actions[bot]" not in workflow


def test_model_cache_merge_preserves_other_deployed_buckets(tmp_path):
    module = _load_module("merge_model_cache_payload", ROOT / "scripts" / "merge_model_cache_payload.py")
    cache_dir = tmp_path / "data" / "model_cache"
    cache_dir.mkdir(parents=True)
    current = {
        "date": "2026-06-08",
        "models": {
            "mlb_new": {"ok": True, "picks": [{"pick": "A", "result": "win"}]},
            "sportytrader_mlb": {"ok": True, "picks": [{"pick": "B"}]},
        },
        "mlb_new": {"ok": True, "picks": [{"pick": "A", "result": "win"}]},
    }
    generated = {
        "date": "2026-06-08",
        "models": {
            "nba": {"ok": True, "picks": [{"pick": "C"}]},
        },
        "mlb_new": {},
        "nba": {"ok": True, "picks": [{"pick": "C"}]},
    }
    (cache_dir / "2026-06-08.json").write_text(json.dumps(current), encoding="utf-8")
    merged = module.merge_payload(generated, cache_dir)
    assert merged["models"]["mlb_new"]["picks"][0]["result"] == "win"
    assert merged["models"]["sportytrader_mlb"]["picks"][0]["pick"] == "B"
    assert merged["models"]["nba"]["picks"][0]["pick"] == "C"
    assert merged["mlb_new"]["picks"][0]["pick"] == "A"
    assert merged["nba"]["picks"][0]["pick"] == "C"


def test_model_cache_merge_preserves_committed_grades(tmp_path):
    module = _load_module("merge_model_cache_payload_grades", ROOT / "scripts" / "merge_model_cache_payload.py")
    cache_dir = tmp_path / "data" / "model_cache"
    cache_dir.mkdir(parents=True)
    current = {
        "date": "2026-06-08",
        "models": {
            "mlb_new": {
                "picks": [{
                    "source": "X",
                    "sport": "MLB",
                    "pick": "Cubs ML",
                    "result": "win",
                    "pregame_snapshot": {"probability": 0.61},
                }]
            }
        },
    }
    generated = {
        "date": "2026-06-08",
        "models": {
            "mlb_new": {
                "picks": [{"source": "X", "sport": "MLB", "pick": "Cubs ML", "result": "pending"}]
            }
        },
    }
    (cache_dir / "2026-06-08.json").write_text(json.dumps(current), encoding="utf-8")
    merged = module.merge_payload(generated, cache_dir)
    assert merged["models"]["mlb_new"]["picks"][0]["result"] == "win"
    assert merged["models"]["mlb_new"]["picks"][0]["pregame_snapshot"]["probability"] == 0.61


def test_model_cache_merge_keeps_previous_same_date_picks_when_refresh_drops_them(tmp_path):
    module = _load_module("merge_model_cache_payload_keep_dropped", ROOT / "scripts" / "merge_model_cache_payload.py")
    cache_dir = tmp_path / "data" / "model_cache"
    cache_dir.mkdir(parents=True)
    current = {
        "date": "2026-06-16",
        "models": {
            "fifa_world_cup": {
                "picks": [
                    {"source": "FIFA Model", "sport": "FIFA WC", "date": "2026-06-16", "pick": "France ML", "matchup": "Senegal @ France"},
                    {"source": "FIFA Model", "sport": "FIFA WC", "date": "2026-06-16", "pick": "Norway ML", "matchup": "Norway @ Iraq"},
                ]
            }
        },
    }
    generated = {
        "date": "2026-06-16",
        "models": {
            "fifa_world_cup": {
                "picks": [
                    {"source": "FIFA Model", "sport": "FIFA WC", "date": "2026-06-16", "pick": "Norway ML", "matchup": "Norway @ Iraq"},
                ]
            }
        },
    }
    (cache_dir / "2026-06-16.json").write_text(json.dumps(current), encoding="utf-8")

    merged = module.merge_payload(generated, cache_dir)
    picks = merged["models"]["fifa_world_cup"]["picks"]

    assert [pick["pick"] for pick in picks] == ["Norway ML", "France ML"]


def test_external_feed_merge_keeps_previous_same_date_picks_when_refresh_drops_them(tmp_path):
    module = _load_module("merge_external_feed_cache_payload_keep_dropped", ROOT / "scripts" / "merge_external_feed_cache_payload.py")
    cache_dir = tmp_path / "data" / "model_cache"
    cache_dir.mkdir(parents=True)
    current = {
        "date": "2026-06-16",
        "models": {
            "sportytrader_fifa_world_cup": {
                "ok": True,
                "picks": [
                    {"source": "SportyTraderFIFAWorldCup", "sport": "FIFA WC", "date": "2026-06-16", "pick": "Both teams to score", "matchup": "France vs Senegal"},
                    {"source": "SportyTraderFIFAWorldCup", "sport": "FIFA WC", "date": "2026-06-16", "pick": "Norway ML", "matchup": "Norway @ Iraq"},
                ],
            }
        },
        "external_feeds": {
            "sportytrader_fifa_world_cup": {
                "ok": True,
                "picks": [
                    {"source": "SportyTraderFIFAWorldCup", "sport": "FIFA WC", "date": "2026-06-16", "pick": "Both teams to score", "matchup": "France vs Senegal"},
                    {"source": "SportyTraderFIFAWorldCup", "sport": "FIFA WC", "date": "2026-06-16", "pick": "Norway ML", "matchup": "Norway @ Iraq"},
                ],
            }
        },
        "sportytrader_fifa_world_cup": {
            "ok": True,
            "picks": [
                {"source": "SportyTraderFIFAWorldCup", "sport": "FIFA WC", "date": "2026-06-16", "pick": "Both teams to score", "matchup": "France vs Senegal"},
                {"source": "SportyTraderFIFAWorldCup", "sport": "FIFA WC", "date": "2026-06-16", "pick": "Norway ML", "matchup": "Norway @ Iraq"},
            ],
        },
    }
    generated = {
        "date": "2026-06-16",
        "models": {
            "sportytrader_fifa_world_cup": {
                "ok": True,
                "picks": [
                    {"source": "SportyTraderFIFAWorldCup", "sport": "FIFA WC", "date": "2026-06-16", "pick": "Norway ML", "matchup": "Norway @ Iraq"},
                ],
            }
        },
        "external_feeds": {
            "sportytrader_fifa_world_cup": {
                "ok": True,
                "picks": [
                    {"source": "SportyTraderFIFAWorldCup", "sport": "FIFA WC", "date": "2026-06-16", "pick": "Norway ML", "matchup": "Norway @ Iraq"},
                ],
            }
        },
        "sportytrader_fifa_world_cup": {
            "ok": True,
            "picks": [
                {"source": "SportyTraderFIFAWorldCup", "sport": "FIFA WC", "date": "2026-06-16", "pick": "Norway ML", "matchup": "Norway @ Iraq"},
            ],
        },
    }
    (cache_dir / "2026-06-16.json").write_text(json.dumps(current), encoding="utf-8")

    merged = module.merge_payload(generated, cache_dir)
    picks = merged["models"]["sportytrader_fifa_world_cup"]["picks"]

    assert [pick["pick"] for pick in picks] == ["Norway ML", "Both teams to score"]
    assert [pick["pick"] for pick in merged["external_feeds"]["sportytrader_fifa_world_cup"]["picks"]] == ["Norway ML", "Both teams to score"]
    assert [pick["pick"] for pick in merged["sportytrader_fifa_world_cup"]["picks"]] == ["Norway ML", "Both teams to score"]


def test_external_feed_merge_migrates_legacy_provider_bucket_to_split_key(tmp_path):
    module = _load_module("merge_external_feed_cache_payload_legacy_split", ROOT / "scripts" / "merge_external_feed_cache_payload.py")
    cache_dir = tmp_path / "data" / "model_cache"
    cache_dir.mkdir(parents=True)
    current = {
        "date": "2026-06-16",
        "models": {
            "sportytrader": {
                "ok": True,
                "picks": [
                    {"source": "SportyTrader", "sport": "FIFA WC", "date": "2026-06-16", "pick": "Both teams to score", "matchup": "France vs Senegal"},
                    {"source": "SportyTrader", "sport": "FIFA WC", "date": "2026-06-16", "pick": "Norway ML", "matchup": "Norway @ Iraq"},
                ],
            }
        },
        "external_feeds": {
            "sportytrader": {
                "ok": True,
                "picks": [
                    {"source": "SportyTrader", "sport": "FIFA WC", "date": "2026-06-16", "pick": "Both teams to score", "matchup": "France vs Senegal"},
                    {"source": "SportyTrader", "sport": "FIFA WC", "date": "2026-06-16", "pick": "Norway ML", "matchup": "Norway @ Iraq"},
                ],
            }
        },
        "sportytrader": {
            "ok": True,
            "picks": [
                {"source": "SportyTrader", "sport": "FIFA WC", "date": "2026-06-16", "pick": "Both teams to score", "matchup": "France vs Senegal"},
                {"source": "SportyTrader", "sport": "FIFA WC", "date": "2026-06-16", "pick": "Norway ML", "matchup": "Norway @ Iraq"},
            ],
        },
    }
    generated = {
        "date": "2026-06-16",
        "models": {
            "sportytrader_fifa_world_cup": {
                "ok": True,
                "picks": [
                    {"source": "SportyTraderFIFAWorldCup", "sport": "FIFA WC", "date": "2026-06-16", "pick": "Norway ML", "matchup": "Norway @ Iraq"},
                ],
            }
        },
        "external_feeds": {
            "sportytrader_fifa_world_cup": {
                "ok": True,
                "picks": [
                    {"source": "SportyTraderFIFAWorldCup", "sport": "FIFA WC", "date": "2026-06-16", "pick": "Norway ML", "matchup": "Norway @ Iraq"},
                ],
            }
        },
    }
    (cache_dir / "2026-06-16.json").write_text(json.dumps(current), encoding="utf-8")

    merged = module.merge_payload(generated, cache_dir)
    picks = merged["models"]["sportytrader_fifa_world_cup"]["picks"]

    assert "sportytrader" not in merged["models"]
    assert "sportytrader" not in merged["external_feeds"]
    assert "sportytrader" not in merged
    assert [pick["pick"] for pick in picks] == ["Norway ML", "Both teams to score"]
    assert {pick["source"] for pick in picks} == {"SportyTraderFIFAWorldCup"}


def test_player_prop_merge_does_not_carry_results_across_rank_epochs(tmp_path):
    module = _load_module("merge_player_props_cache_payload_epochs", ROOT / "scripts" / "merge_player_props_cache_payload.py")
    cache_dir = tmp_path / "data" / "player_props_cache"
    cache_dir.mkdir(parents=True)
    current = {
        "date": "2026-06-16",
        "models": {
            "mlb_player_props": {
                "picks": [{
                    "id": "same-prop",
                    "source": "PickLedgerPro In-House Player Props",
                    "sport": "MLB",
                    "date": "2026-06-16",
                    "pick": "Player Over 0.5 Hits",
                    "matchup": "Away @ Home",
                    "ml_rank_epoch": "MLB:old",
                    "result": "win",
                }]
            }
        },
    }
    generated = {
        "date": "2026-06-16",
        "models": {
            "mlb_player_props": {
                "picks": [{
                    "id": "same-prop",
                    "source": "PickLedgerPro In-House Player Props",
                    "sport": "MLB",
                    "date": "2026-06-16",
                    "pick": "Player Over 0.5 Hits",
                    "matchup": "Away @ Home",
                    "ml_rank_epoch": "MLB:new",
                    "result": "pending",
                }]
            }
        },
    }
    (cache_dir / "2026-06-16.json").write_text(json.dumps(current), encoding="utf-8")

    merged = module.merge_payload(generated, cache_dir)

    assert merged["models"]["mlb_player_props"]["picks"][0]["result"] == "pending"


def test_external_feed_merge_does_not_promote_partial_cache_to_latest(tmp_path):
    module = _load_module("merge_external_feed_cache_payload", ROOT / "scripts" / "merge_external_feed_cache_payload.py")
    cache_dir = tmp_path / "data" / "model_cache"
    cache_dir.mkdir(parents=True)
    previous = {"date": "2026-06-14", "models": {"mlb_new": {"ok": True, "picks": []}}}
    partial = {
        "date": "2026-06-15",
        "models": {"scores24_mlb": {"ok": True, "picks": [{"pick": "Cubs ML"}]}},
    }
    (cache_dir / "latest.json").write_text(json.dumps(previous), encoding="utf-8")

    merged = module.merge_payload(partial, cache_dir)
    latest_updated = module.write_merged_payload(merged, cache_dir)

    assert latest_updated is False
    assert json.loads((cache_dir / "latest.json").read_text(encoding="utf-8"))["date"] == "2026-06-14"
    assert json.loads((cache_dir / "2026-06-15.json").read_text(encoding="utf-8"))["models"]["scores24_mlb"]["ok"] is True


def test_external_feed_merge_promotes_complete_cache_to_latest(tmp_path):
    module = _load_module("merge_external_feed_cache_payload_complete", ROOT / "scripts" / "merge_external_feed_cache_payload.py")
    cache_dir = tmp_path / "data" / "model_cache"
    cache_dir.mkdir(parents=True)
    complete = {
        "date": "2026-06-15",
        "models": {
            key: {"ok": True, "picks": []}
            for key in module.REQUIRED_TEAM_MODEL_KEYS
        },
    }

    latest_updated = module.write_merged_payload(complete, cache_dir)

    assert latest_updated is True
    assert json.loads((cache_dir / "latest.json").read_text(encoding="utf-8"))["date"] == "2026-06-15"
