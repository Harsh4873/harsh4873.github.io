from __future__ import annotations

import json
import shutil
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[2]
MODEL_KEYS = {
    "mlb_new",
    "mlb_inning",
    "mlb_first_five",
    "wnba",
    "nba",
    "nba_playoffs",
    "fifa_world_cup",
}
PLAYER_PROP_KEYS = {
    "nba_player_props",
    "mlb_player_props_season",
    "mlb_player_props_all_time",
    "mlb_player_props_hot_l10",
    "mlb_player_props_matchup_h2h",
    "wnba_player_props_season",
    "wnba_player_props_all_time",
    "wnba_player_props_hot_l10",
    "wnba_player_props_matchup_h2h",
}
SCORES24_KEYS = {"scores24_fifa_world_cup", "scores24_mlb", "scores24_wnba"}


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _upcheck_repo(tmp_path: Path, date: str) -> Path:
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    shutil.copyfile(ROOT / "scripts" / "site_upcheck.py", scripts / "site_upcheck.py")

    model_payload = {
        "date": date,
        "models": {key: {"ok": True, "picks": []} for key in MODEL_KEYS},
        "external_feeds": {
            key: {
                "ok": True,
                "date": date,
                "picks": [],
                "meta": {"expectedMatchups": 0, "matchedPicks": 0, "missingMatchups": []},
            }
            for key in SCORES24_KEYS
        },
    }
    props_payload = {"date": date, "models": {key: {"ok": True, "picks": []} for key in PLAYER_PROP_KEYS}}
    for cache_name, payload in (("model_cache", model_payload), ("player_props_cache", props_payload)):
        cache_dir = tmp_path / "data" / cache_name
        _write_json(cache_dir / "latest.json", payload)
        _write_json(cache_dir / f"{date}.json", payload)
        _write_json(cache_dir / "index.json", {"files": [f"{date}.json"]})
    return scripts / "site_upcheck.py"


def test_data_only_readiness_passes_without_build_or_cannon(tmp_path: Path):
    today = datetime.now(ZoneInfo("America/Chicago")).strftime("%Y-%m-%d")
    script = _upcheck_repo(tmp_path, today)

    result = subprocess.run(
        [sys.executable, str(script), "--data-only"],
        cwd=tmp_path,
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0
    assert "daily data is ready" in result.stdout
    assert not (tmp_path / "dist").exists()
    assert "Cannon" not in result.stdout


def test_data_only_readiness_defers_stale_daily_data(tmp_path: Path):
    yesterday = (datetime.now(ZoneInfo("America/Chicago")) - timedelta(days=1)).strftime("%Y-%m-%d")
    script = _upcheck_repo(tmp_path, yesterday)

    result = subprocess.run(
        [sys.executable, str(script), "--data-only"],
        cwd=tmp_path,
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 1
    assert "[readiness] waiting:" in result.stdout
    assert "expected" in result.stdout


def test_data_only_readiness_rejects_incomplete_scores24_bucket(tmp_path: Path):
    today = datetime.now(ZoneInfo("America/Chicago")).strftime("%Y-%m-%d")
    script = _upcheck_repo(tmp_path, today)
    cache_path = tmp_path / "data" / "model_cache" / "latest.json"
    payload = json.loads(cache_path.read_text(encoding="utf-8"))
    payload["external_feeds"]["scores24_fifa_world_cup"] = {
        "ok": False,
        "date": today,
        "picks": [{"matchup": "Qatar @ Canada"}],
        "error": "blocked before official slate completed",
        "meta": {
            "expectedMatchups": 2,
            "matchedPicks": 1,
            "missingMatchups": ["South Africa @ Czechia"],
        },
    }
    _write_json(cache_path, payload)

    result = subprocess.run(
        [sys.executable, str(script), "--data-only"],
        cwd=tmp_path,
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 1
    assert "scores24_fifa_world_cup failed" in result.stdout
