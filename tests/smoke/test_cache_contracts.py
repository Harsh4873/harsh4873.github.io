from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from scripts import site_upcheck


ROOT = Path(__file__).resolve().parents[2]
PLAYER_PROP_VARIANT_KEYS = {
    "mlb_player_props_season",
    "mlb_player_props_all_time",
    "mlb_player_props_hot_l10",
    "mlb_player_props_matchup_h2h",
    "wnba_player_props_season",
    "wnba_player_props_all_time",
    "wnba_player_props_hot_l10",
    "wnba_player_props_matchup_h2h",
}


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _manifest_files(cache_dir: Path) -> list[Path]:
    manifest = _read_json(cache_dir / "index.json")
    return [cache_dir / file for file in manifest.get("files") or []]


def _iter_model_picks(payload: dict):
    models = payload.get("models") if isinstance(payload.get("models"), dict) else {}
    for model_key, bucket in models.items():
        if not isinstance(bucket, dict):
            continue
        for pick in bucket.get("picks") or []:
            if isinstance(pick, dict):
                yield str(model_key), pick


def test_committed_cache_ids_are_unique_within_each_date():
    for cache_dir in (ROOT / "data" / "model_cache", ROOT / "data" / "player_props_cache"):
        for path in _manifest_files(cache_dir):
            payload = _read_json(path)
            date = str(payload.get("date") or payload.get("slate_date") or path.stem)
            ids = [
                str(pick.get("id") or "").strip()
                for _, pick in _iter_model_picks(payload)
                if str(pick.get("id") or "").strip()
            ]
            duplicates = [pick_id for pick_id, count in Counter(ids).items() if count > 1]
            assert not duplicates, f"{cache_dir.name}/{path.name} duplicate ids for {date}: {duplicates[:5]}"


def test_latest_player_props_cache_contains_latest_snapshot_markets():
    latest = _read_json(ROOT / "data" / "player_props_cache" / "latest.json")
    latest_date = str(latest.get("date") or "")

    assert latest_date
    latest_keys = site_upcheck._published_player_prop_keys(latest, latest_date)
    snapshot_keys = site_upcheck._snapshot_player_prop_keys(latest_date)

    assert snapshot_keys
    assert not (snapshot_keys - latest_keys)


def test_latest_player_prop_records_remain_split_by_model_bucket():
    latest = _read_json(ROOT / "data" / "player_props_cache" / "latest.json")
    models = latest.get("models") if isinstance(latest.get("models"), dict) else {}

    assert PLAYER_PROP_VARIANT_KEYS <= set(models)
    for model_key in PLAYER_PROP_VARIANT_KEYS:
        bucket = models[model_key]
        assert bucket["ok"] is True
        sources = {
            str(pick.get("source") or "").strip()
            for pick in bucket.get("picks") or []
            if isinstance(pick, dict)
        }
        assert "Player Props" not in sources
        for pick in bucket.get("picks") or []:
            assert pick["scope"] == "player"
            assert pick["model_key"] == model_key
            assert str(pick.get("ml_rank_epoch") or "").startswith(f"{pick['sport']}:player_props_variant_v1.0.0:")
