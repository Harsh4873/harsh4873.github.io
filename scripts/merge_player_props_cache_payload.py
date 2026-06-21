#!/usr/bin/env python3
"""Merge generated player-prop models while preserving committed grades."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

try:
    from cache_manifest import write_cache_manifest
except ModuleNotFoundError:  # pragma: no cover - exercised when tests import by file path
    from scripts.cache_manifest import write_cache_manifest


PLAYER_PROPS_CACHE_DIR = Path("data/player_props_cache")
PLAYER_PROPS_SNAPSHOT_DIR = Path("data/player_props_snapshots")
CONSENSUS_METADATA_PATH = Path("player_props/artifacts/player_props_consensus_metadata.json")
PICK_METADATA_FIELDS = {"result", "start_time", "game_start_time", "pregame_snapshot"}
MARKET_METADATA_FIELDS = {"start_time", "game_start_time", "pregame_snapshot"}
_CONSENSUS_MODELS: list[str] | None = None


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True, default=str) + "\n", encoding="utf-8")


def _consensus_models() -> list[str]:
    global _CONSENSUS_MODELS
    if _CONSENSUS_MODELS is not None:
        return _CONSENSUS_MODELS
    metadata = _read_json(CONSENSUS_METADATA_PATH) or {}
    model_map = metadata.get("models") if isinstance(metadata.get("models"), dict) else {}
    _CONSENSUS_MODELS = [f"{name}: {description}" for name, description in sorted(model_map.items())]
    return _CONSENSUS_MODELS


def _ensure_consensus_fields(pick: dict[str, Any]) -> dict[str, Any]:
    if str(pick.get("ml_model_version") or "").strip() != "player_props_consensus_v2.0.0":
        return pick
    models = _consensus_models()
    if models:
        pick.setdefault("consensus_model_count", len(models))
        pick.setdefault("consensus_models", models)
    model_names = ", ".join(label.split(":", 1)[0] for label in models)
    if model_names:
        factors = pick.get("key_factors")
        if not isinstance(factors, list):
            factors = []
        if not any("Four-model consensus suite active" in str(factor) for factor in factors):
            pick["key_factors"] = [f"Four-model consensus suite active: {model_names}", *factors]
    reason = str(pick.get("reason") or "")
    sport = str(pick.get("sport") or "").strip().upper()
    if reason.startswith("The 2026 season model and roster-aware history model qualify this market"):
        pick["reason"] = reason.replace(
            "The 2026 season model and roster-aware history model qualify this market",
            f"The active four-model consensus suite qualifies this market through the {sport} season and roster-aware history voters",
            1,
        )
    return pick


def _pick_key(pick: dict[str, Any]) -> tuple[str, ...]:
    return tuple(
        str(pick.get(key) or "").strip().lower()
        for key in ("id", "source", "sport", "date", "pick", "matchup", "ml_rank_epoch", "ranking_epoch", "model_epoch")
    )


def _market_key(pick: dict[str, Any]) -> tuple[str, ...]:
    primary = tuple(
        str(pick.get(key) or "").strip().lower()
        for key in ("sport", "date", "game_id", "player_id", "stat_key", "selection", "line")
    )
    if all(primary[:6]) and primary[6]:
        return primary
    return tuple(
        str(pick.get(key) or "").strip().lower()
        for key in ("source", "sport", "date", "pick", "matchup")
    )


def _carry_forward_allowed(pick: Any, date_iso: str) -> bool:
    if not isinstance(pick, dict):
        return False
    if str(pick.get("date") or "").strip() != date_iso:
        return False
    if str(pick.get("scope") or "").strip().lower() != "player":
        return False
    return bool(
        pick.get("market_priced") is True
        and str(pick.get("probability_source") or "").strip() == "player_props_ml_v1"
        and str(pick.get("pick") or "").strip()
    )


def _snapshot_buckets(date_iso: str, model_key: str, snapshot_dir: Path) -> list[dict[str, Any]]:
    best_bucket: dict[str, Any] | None = None
    best_count = -1
    for path in sorted((snapshot_dir / date_iso).glob("*.json")):
        snapshot = _read_json(path)
        if not snapshot or str(snapshot.get("date") or "").strip() != date_iso:
            continue
        models = snapshot.get("models") if isinstance(snapshot.get("models"), dict) else {}
        bucket = models.get(model_key)
        if isinstance(bucket, dict):
            count = sum(
                1
                for pick in bucket.get("picks") or []
                if _carry_forward_allowed(pick, date_iso)
            )
            if count >= best_count:
                best_bucket = bucket
                best_count = count
    return [best_bucket] if best_bucket is not None else []


def _preserve_pick_metadata(source_buckets: list[Any], generated_bucket: Any, date_iso: str) -> Any:
    if not isinstance(generated_bucket, dict):
        return generated_bucket
    generated_picks = generated_bucket.get("picks")
    if not isinstance(generated_picks, list):
        return generated_bucket
    source_picks = [
        pick
        for bucket in source_buckets
        if isinstance(bucket, dict) and isinstance(bucket.get("picks"), list)
        for pick in bucket.get("picks") or []
        if isinstance(pick, dict)
    ]
    metadata = {
        _pick_key(pick): {field: pick[field] for field in PICK_METADATA_FIELDS if field in pick}
        for pick in source_picks
    }
    metadata_by_market = {
        _market_key(pick): {field: pick[field] for field in MARKET_METADATA_FIELDS if field in pick}
        for pick in source_picks
    }
    generated_market_keys = {_market_key(pick) for pick in generated_picks if isinstance(pick, dict)}
    carried = [
        _ensure_consensus_fields({**pick, "carried_forward": True})
        for pick in source_picks
        if _carry_forward_allowed(pick, date_iso) and _market_key(pick) not in generated_market_keys
    ]
    carried_by_market: dict[tuple[str, ...], dict[str, Any]] = {}
    for pick in carried:
        carried_by_market[_market_key(pick)] = pick
    merged = dict(generated_bucket)
    merged["picks"] = [
        _ensure_consensus_fields({
            **pick,
            **metadata_by_market.get(_market_key(pick), {}),
            **metadata.get(_pick_key(pick), {}),
        }) if isinstance(pick, dict) else pick
        for pick in generated_picks
    ] + list(carried_by_market.values())
    return merged


def merge_payload(
    generated: dict[str, Any],
    cache_dir: Path,
    snapshot_dir: Path = PLAYER_PROPS_SNAPSHOT_DIR,
    *,
    include_current: bool = True,
) -> dict[str, Any]:
    date_iso = str(generated.get("date") or "").strip()
    if not date_iso:
        raise SystemExit("Generated player-props cache is missing date")
    current = _read_json(cache_dir / f"{date_iso}.json") or {}
    current_models = current.get("models") if isinstance(current.get("models"), dict) else {}
    generated_models = generated.get("models") if isinstance(generated.get("models"), dict) else {}

    merged = dict(generated)
    merged["models"] = {
        key: _preserve_pick_metadata(
            ([current_models.get(key)] if include_current else []) + _snapshot_buckets(date_iso, key, snapshot_dir),
            bucket,
            date_iso,
        )
        for key, bucket in generated_models.items()
    }
    return merged


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("generated", help="Generated player-props latest.json")
    parser.add_argument("--cache-dir", default=str(PLAYER_PROPS_CACHE_DIR))
    parser.add_argument("--snapshot-dir", default=str(PLAYER_PROPS_SNAPSHOT_DIR))
    parser.add_argument("--ignore-current-cache", action="store_true")
    args = parser.parse_args()

    generated = _read_json(Path(args.generated))
    if not generated:
        raise SystemExit(f"Could not read generated player-props cache: {args.generated}")
    cache_dir = Path(args.cache_dir)
    merged = merge_payload(
        generated,
        cache_dir,
        Path(args.snapshot_dir),
        include_current=not args.ignore_current_cache,
    )
    date_iso = str(merged["date"])
    _write_json(cache_dir / f"{date_iso}.json", merged)
    _write_json(cache_dir / "latest.json", merged)
    write_cache_manifest(cache_dir)
    print(json.dumps({"date": date_iso, "models": sorted(merged["models"])}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
