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
    assert '"mlb_player_props"' in guard
    assert '"wnba_player_props"' in guard
    assert 'key in required' in guard
    assert 'int(bucket.get("games") or 0) > 0 and not (bucket.get("picks") or [])' in guard


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


def test_model_cache_merge_seeds_external_feeds_on_new_slate_day(tmp_path):
    module = _load_module("merge_model_cache_payload_new_day", ROOT / "scripts" / "merge_model_cache_payload.py")
    cache_dir = tmp_path / "data" / "model_cache"
    cache_dir.mkdir(parents=True)
    previous = {
        "date": "2026-07-07",
        "models": {
            "wnba": {"ok": True, "picks": [{"pick": "Old"}]},
            "scores24_wnba": {"ok": True, "picks": [{"pick": "S24"}]},
        },
        "external_feeds": {
            "scores24_wnba": {"ok": True, "picks": [{"pick": "S24"}]},
        },
    }
    generated = {
        "date": "2026-07-08",
        "models": {
            "wnba": {"ok": True, "picks": [{"pick": "New"}]},
        },
    }
    (cache_dir / "latest.json").write_text(json.dumps(previous), encoding="utf-8")
    merged = module.merge_payload(generated, cache_dir)
    assert merged["models"]["wnba"]["picks"][0]["pick"] == "New"
    assert merged["external_feeds"]["scores24_wnba"]["picks"][0]["pick"] == "S24"


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


def test_model_cache_merge_replaces_stale_same_game_market_pick(tmp_path):
    module = _load_module("merge_model_cache_payload_replace_market", ROOT / "scripts" / "merge_model_cache_payload.py")
    cache_dir = tmp_path / "data" / "model_cache"
    cache_dir.mkdir(parents=True)
    current = {
        "date": "2026-06-22",
        "models": {
            "fifa_world_cup": {
                "picks": [
                    {
                        "source": "FIFA Model",
                        "sport": "FIFA WC",
                        "date": "2026-06-22",
                        "market": "total",
                        "pick": "Over 2.5 (Algeria @ Jordan)",
                        "matchup": "Algeria @ Jordan",
                    },
                    {
                        "source": "FIFA Model",
                        "sport": "FIFA WC",
                        "date": "2026-06-22",
                        "market": "total",
                        "pick": "Under 2.5 (Completed @ Match)",
                        "matchup": "Completed @ Match",
                        "result": "win",
                    },
                ]
            }
        },
    }
    generated = {
        "date": "2026-06-22",
        "models": {
            "fifa_world_cup": {
                "picks": [
                    {
                        "source": "FIFA Model",
                        "sport": "FIFA WC",
                        "date": "2026-06-22",
                        "market": "total",
                        "pick": "Under 2.5 (Algeria @ Jordan)",
                        "matchup": "Algeria @ Jordan",
                    },
                ]
            }
        },
    }
    (cache_dir / "2026-06-22.json").write_text(json.dumps(current), encoding="utf-8")

    merged = module.merge_payload(generated, cache_dir)
    picks = merged["models"]["fifa_world_cup"]["picks"]

    assert [pick["pick"] for pick in picks] == [
        "Under 2.5 (Algeria @ Jordan)",
        "Under 2.5 (Completed @ Match)",
    ]


def test_external_feed_merge_replaces_previous_same_date_picks_when_refresh_drops_them(tmp_path):
    module = _load_module("merge_external_feed_cache_payload_replace_dropped", ROOT / "scripts" / "merge_external_feed_cache_payload.py")
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

    assert [pick["pick"] for pick in picks] == ["Norway ML"]
    assert [pick["pick"] for pick in merged["external_feeds"]["sportytrader_fifa_world_cup"]["picks"]] == ["Norway ML"]
    assert [pick["pick"] for pick in merged["sportytrader_fifa_world_cup"]["picks"]] == ["Norway ML"]


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
    assert [pick["pick"] for pick in picks] == ["Norway ML"]
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


def test_player_prop_merge_preserves_same_day_snapshot_props_in_latest_board(tmp_path):
    module = _load_module("merge_player_props_cache_payload_current_board", ROOT / "scripts" / "merge_player_props_cache_payload.py")
    cache_dir = tmp_path / "data" / "player_props_cache"
    snapshot_dir = tmp_path / "data" / "player_props_snapshots"
    cache_dir.mkdir(parents=True)
    (snapshot_dir / "2026-06-20").mkdir(parents=True)
    previous = {
        "date": "2026-06-20",
        "models": {
            "mlb_player_props": {
                "ok": True,
                "picks": [
                    {
                        "id": "old",
                        "scope": "player",
                        "source": "MLBPlayerProps",
                        "sport": "MLB",
                        "date": "2026-06-20",
                        "game_id": "1",
                        "player_id": "10",
                        "stat_key": "hits",
                        "selection": "Over",
                        "line": 0.5,
                        "pick": "Old Over 0.5 Hits",
                        "matchup": "A @ B",
                        "market_priced": True,
                        "probability_source": "player_props_ml_v1",
                        "decision": "LEAN",
                        "ml_model_version": "player_props_consensus_v2.0.0",
                        "ml_probability_mode": "four_model_consensus_gate",
                        "consensus_qualified": True,
                        "result": "pending",
                    }
                ],
            }
        },
    }
    generated = {
        "date": "2026-06-20",
        "models": {
            "mlb_player_props": {
                "ok": True,
                "picks": [
                    {
                        "id": "new",
                        "scope": "player",
                        "source": "MLBPlayerProps",
                        "model_key": "mlb_player_props",
                        "sport": "MLB",
                        "date": "2026-06-20",
                        "game_id": "2",
                        "player_id": "20",
                        "stat_key": "hits_runs_rbis",
                        "selection": "Under",
                        "line": 1.5,
                        "pick": "New Under 1.5 HRR",
                        "matchup": "C @ D",
                        "market_priced": True,
                        "probability_source": "player_props_ml_v1",
                        "decision": "LEAN",
                        "ml_model_version": "player_props_consensus_v2.0.0",
                        "ml_probability_mode": "four_model_consensus_gate",
                        "consensus_qualified": True,
                    }
                ],
            }
        },
    }
    (cache_dir / "2026-06-20.json").write_text(json.dumps({"date": "2026-06-20", "models": {}}), encoding="utf-8")
    (snapshot_dir / "2026-06-20" / "snapshot.json").write_text(json.dumps(previous), encoding="utf-8")

    merged = module.merge_payload(generated, cache_dir, snapshot_dir)
    picks = merged["models"]["mlb_player_props"]["picks"]

    assert {pick["id"] for pick in picks} == {"new", "old"}
    assert {pick["source"] for pick in picks} == {"MLBPlayerProps"}
    assert {pick["model_key"] for pick in picks} == {"mlb_player_props"}
    assert all("carried_forward" not in pick for pick in picks)


def test_player_prop_merge_migrates_legacy_variant_snapshots_into_sport_bucket(tmp_path):
    module = _load_module("merge_player_props_cache_payload_legacy_variants", ROOT / "scripts" / "merge_player_props_cache_payload.py")
    cache_dir = tmp_path / "data" / "player_props_cache"
    snapshot_dir = tmp_path / "data" / "player_props_snapshots"
    cache_dir.mkdir(parents=True)
    (snapshot_dir / "2026-06-24").mkdir(parents=True)
    snapshot = {
        "date": "2026-06-24",
        "models": {
            "wnba_player_props_all_time": {
                "ok": True,
                "picks": [
                    {
                        "id": "pp_michaela_all_time",
                        "scope": "player",
                        "source": "WNBA All Time Props",
                        "sport": "WNBA",
                        "date": "2026-06-24",
                        "game_id": "401857018",
                        "player_id": "4281173",
                        "stat_key": "points",
                        "selection": "Over",
                        "line": 9.5,
                        "pick": "Michaela Onyenwere Over 9.5 Points",
                        "matchup": "A @ B",
                        "market_priced": True,
                        "probability_source": "player_props_ml_v1",
                        "decision": "LEAN",
                        "ml_model_version": "player_props_consensus_v2.0.0",
                        "ml_probability_mode": "four_model_consensus_gate",
                        "consensus_qualified": True,
                        "model_variant": "all_time",
                        "result": "pending",
                    }
                ],
            }
        },
    }
    generated = {
        "date": "2026-06-24",
        "models": {
            "wnba_player_props": {
                "ok": True,
                "ranking_epoch": "WNBA:player_props_consensus_v2.0.0:published:test",
                "picks": [],
            }
        },
    }
    (cache_dir / "2026-06-24.json").write_text(json.dumps({"date": "2026-06-24", "models": {}}), encoding="utf-8")
    (snapshot_dir / "2026-06-24" / "snapshot.json").write_text(json.dumps(snapshot), encoding="utf-8")

    merged = module.merge_payload(generated, cache_dir, snapshot_dir)
    picks = merged["models"]["wnba_player_props"]["picks"]

    assert len(picks) == 1
    assert picks[0]["id"] == "pp_michaela_consensus"
    assert picks[0]["source"] == "WNBAPlayerProps"
    assert picks[0]["model_key"] == "wnba_player_props"
    assert picks[0]["supporting_variant"] == "all_time"
    assert picks[0]["ml_rank_epoch"] == "WNBA:player_props_consensus_v2.0.0:published:test"


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
