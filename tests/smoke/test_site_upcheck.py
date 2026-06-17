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
PLAYER_PROP_KEYS = {"mlb_player_props", "nba_player_props", "wnba_player_props"}


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _upcheck_repo(tmp_path: Path, date: str) -> Path:
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    shutil.copyfile(ROOT / "scripts" / "site_upcheck.py", scripts / "site_upcheck.py")

    model_payload = {"date": date, "models": {key: {"ok": True, "picks": []} for key in MODEL_KEYS}}
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
