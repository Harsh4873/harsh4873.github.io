#!/usr/bin/env python3
"""Merge generated player-prop models while preserving committed grades."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from cache_manifest import write_cache_manifest


PLAYER_PROPS_CACHE_DIR = Path("data/player_props_cache")
PICK_METADATA_FIELDS = {"result", "start_time", "game_start_time", "pregame_snapshot"}


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True, default=str) + "\n", encoding="utf-8")


def _pick_key(pick: dict[str, Any]) -> tuple[str, ...]:
    return tuple(
        str(pick.get(key) or "").strip().lower()
        for key in ("id", "source", "sport", "date", "pick", "matchup", "ml_rank_epoch", "ranking_epoch", "model_epoch")
    )


def _preserve_pick_metadata(current_bucket: Any, generated_bucket: Any) -> Any:
    if not isinstance(current_bucket, dict) or not isinstance(generated_bucket, dict):
        return generated_bucket
    current_picks = current_bucket.get("picks")
    generated_picks = generated_bucket.get("picks")
    if not isinstance(current_picks, list) or not isinstance(generated_picks, list):
        return generated_bucket
    metadata = {
        _pick_key(pick): {field: pick[field] for field in PICK_METADATA_FIELDS if field in pick}
        for pick in current_picks
        if isinstance(pick, dict)
    }
    merged = dict(generated_bucket)
    merged["picks"] = [
        {**pick, **metadata.get(_pick_key(pick), {})} if isinstance(pick, dict) else pick
        for pick in generated_picks
    ]
    return merged


def merge_payload(generated: dict[str, Any], cache_dir: Path) -> dict[str, Any]:
    date_iso = str(generated.get("date") or "").strip()
    if not date_iso:
        raise SystemExit("Generated player-props cache is missing date")
    current = _read_json(cache_dir / f"{date_iso}.json") or {}
    current_models = current.get("models") if isinstance(current.get("models"), dict) else {}
    generated_models = generated.get("models") if isinstance(generated.get("models"), dict) else {}

    merged = dict(generated)
    merged["models"] = {
        key: _preserve_pick_metadata(current_models.get(key), bucket)
        for key, bucket in generated_models.items()
    }
    return merged


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("generated", help="Generated player-props latest.json")
    parser.add_argument("--cache-dir", default=str(PLAYER_PROPS_CACHE_DIR))
    args = parser.parse_args()

    generated = _read_json(Path(args.generated))
    if not generated:
        raise SystemExit(f"Could not read generated player-props cache: {args.generated}")
    cache_dir = Path(args.cache_dir)
    merged = merge_payload(generated, cache_dir)
    date_iso = str(merged["date"])
    _write_json(cache_dir / f"{date_iso}.json", merged)
    _write_json(cache_dir / "latest.json", merged)
    write_cache_manifest(cache_dir)
    print(json.dumps({"date": date_iso, "models": sorted(merged["models"])}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
