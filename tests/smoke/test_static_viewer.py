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
    assert "Global model performance calculated from committed, auto-graded JSON." in html


def test_static_viewer_keeps_public_tabs_and_client_grading():
    main = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")
    html = (ROOT / "index.html").read_text(encoding="utf-8")

    for tab in ("home", "search", "rankings", "trends", "daily"):
        assert f"id=\"tab-{tab}\"" in html
    assert "async function refreshAutoGrades()" in main
    assert "async function gradeDate(" in main
    assert "site.api.espn.com" in main
    assert "setLocalResult(pick.id" in main
    assert "function renderRankings()" in main
    assert "function renderSearch()" in main


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
    }
    generated = {
        "date": "2026-06-08",
        "models": {
            "nba": {"ok": True, "picks": [{"pick": "C"}]},
        },
    }
    (cache_dir / "2026-06-08.json").write_text(json.dumps(current), encoding="utf-8")
    merged = module.merge_payload(generated, cache_dir)
    assert merged["models"]["mlb_new"]["picks"][0]["result"] == "win"
    assert merged["models"]["sportytrader"]["picks"][0]["pick"] == "B"
    assert merged["models"]["nba"]["picks"][0]["pick"] == "C"


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
