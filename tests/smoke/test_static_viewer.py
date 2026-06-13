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
    assert "./data/cannon_mlb_daily.json" in data
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
    assert "./data/cannon_mlb_daily.json" in data
    assert "./data/player_props_cache/index.json" in data
    assert "./data/player_props_cache/latest.json" in data
    assert "let teamPicks: Pick[] = []" in data
    assert "let playerPicks: Pick[] = []" in data
    assert "return activePickMode === 'player' ? playerPicks : teamPicks" in data
    assert "decision === 'BET' || decision === 'LEAN' || decision === 'PASS'" in data

    assert "activeFilter = 'ALL'" in main
    assert "selectedDate = ''" in main
    assert "search.value = ''" in main
    assert "const pending = activePickMode === 'team'" in main
    assert ".pick-mode-segment" in css
    assert "body.mobile-app-mode .pick-mode-segment" in css
    assert "@media (max-width: 700px)" in css


def test_player_home_details_use_generator_schema_fields():
    main = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")
    data = (ROOT / "src" / "data.ts").read_text(encoding="utf-8")
    css = (ROOT / "src" / "styles" / "pickledger.css").read_text(encoding="utf-8")

    for field in ("full_kelly", "quarter_kelly", "confidence", "reason", "key_factors"):
        assert f"{field}?" in data
        assert f"pick.{field}" in main
    assert "function playerDetailsHtml(" in main
    assert "Quarter Kelly" in main
    assert "Full Kelly" in main
    assert "Key factors" in main
    assert "activePickMode !== 'player'" in main
    assert "expandedPlayerPickKeys" in main
    assert "data-player-pick-card" in main
    assert "isPlayer ? '' : `<span class=\"home-feed-row-sport\"" in main
    assert "function bindPlayerHomeRows(" in main
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

    for tab in ("home", "search", "rankings", "trends", "daily"):
        assert f"id=\"tab-{tab}\"" in html
    assert 'data-player-hidden-tab="trends" onclick="switchTab(\'trends\')">TRENDS</button>' in html
    assert 'onclick="switchTab(\'daily\')">BEST BETS</button>' in html
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
    assert "Each unique market appears once." in main
    assert "excluding anything already in Top Picks" in main
    assert ".daily-bet-card" in css
    assert ".daily-model-card" in css
    assert ".daily-consensus-card" in css
    assert ".daily-view-nav" in css
    assert ".daily-view-select-wrap" in css
    assert ".daily-pick-source-list" in css
    assert "daily-slate-grid" not in main


def test_player_mode_hides_unneeded_tabs_and_keeps_prop_sources_separate():
    main = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")
    data = (ROOT / "src" / "data.ts").read_text(encoding="utf-8")
    html = (ROOT / "index.html").read_text(encoding="utf-8")

    assert 'data-player-hidden-tab="trends"' in html
    assert "function syncModeTabs(" in main
    assert "activePickMode === 'player' && name === 'trends'" in main
    assert "activePickMode !== 'player' || option.key !== 'consensus'" in main
    assert "activePickMode === 'player' && view === 'consensus'" in main
    assert "playerResearchPool" in main
    assert "Next-best player prop candidates" in main
    for source in ("NBAPlayerProps", "MLBPlayerProps", "WNBAPlayerProps"):
        assert source in data
    assert "playerProp && fallbackSource" in data


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


def test_scheduled_refreshes_are_json_only_and_use_shared_writer_lock():
    workflow_names = (
        "auto-grade.yml",
        "model-cache-refresh.yml",
        "external-feed-refresh.yml",
        "cannon-daily-refresh.yml",
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
    cannon = (workflows / "cannon-daily-refresh.yml").read_text(encoding="utf-8")
    grader = (workflows / "auto-grade.yml").read_text(encoding="utf-8")
    deploy = (workflows / "deploy-pages.yml").read_text(encoding="utf-8")

    assert "cache-gate" not in model
    assert "cache-gate" not in cannon
    assert "cron: '*/15 * * * *'" in grader
    assert 'cron: "45 12 * * *"' in model
    assert 'cron: "10,40 14 * * *"' in feeds
    assert 'cron: "55 13 * * *"' in cannon
    for workflow in (model, feeds, cannon, grader):
        assert "gh workflow run deploy-pages.yml --ref main" in workflow
        assert "actions: write" in workflow
    assert "Verify styled Pages artifact" in deploy
    assert "find dist/assets -maxdepth 1 -name '*.js'" in deploy
    assert "! grep -q 'src/main.ts' dist/index.html" in deploy
    assert "python scripts/site_upcheck.py" in deploy


def test_refresh_workflows_commit_as_triggering_actor():
    for name in (
        "auto-grade.yml",
        "model-cache-refresh.yml",
        "external-feed-refresh.yml",
        "cannon-daily-refresh.yml",
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
            "sportytrader": {"ok": True, "picks": [{"pick": "B"}]},
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
    assert merged["models"]["sportytrader"]["picks"][0]["pick"] == "B"
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
                "picks": [{"source": "X", "sport": "MLB", "pick": "Cubs ML", "result": "win"}]
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
