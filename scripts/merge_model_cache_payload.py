#!/usr/bin/env python3
"""Merge a generated model cache payload into the latest checked-out cache."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


MODEL_CACHE_DIR = Path("data/model_cache")
EXTERNAL_FEED_MODEL_KEYS = {"sportytrader", "sportsgambler"}
DEPLOYED_MODEL_KEYS = {
    "mlb_new",
    "mlb_inning",
    "mlb_first_five",
    "wnba",
    "nba",
    "nba_playoffs",
    *EXTERNAL_FEED_MODEL_KEYS,
}
MODEL_ALIAS_KEYS = {
    "nba",
    "nba_old",
    "nba_playoffs",
    "wnba",
    "nba_props",
    "mlb",
    "mlb_old",
    "mlb_new",
    "mlb_inning",
    "mlb_first_five",
    "ipl",
}


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Merge generated model cache JSON into data/model_cache.")
    parser.add_argument("generated", help="Path to the generated latest.json from refresh_model_cache.py.")
    parser.add_argument("--cache-dir", default=str(MODEL_CACHE_DIR), help="Cache directory to update.")
    return parser.parse_args()


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True, default=str)
        handle.write("\n")


def _current_payload(cache_dir: Path, date_iso: str) -> dict[str, Any]:
    date_payload = _read_json(cache_dir / f"{date_iso}.json")
    if date_payload and str(date_payload.get("date") or "") == date_iso:
        return date_payload
    latest_payload = _read_json(cache_dir / "latest.json")
    if latest_payload and str(latest_payload.get("date") or "") == date_iso:
        return latest_payload
    return {"date": date_iso, "models": {}}


def _merged_models(current: dict[str, Any], generated: dict[str, Any]) -> dict[str, Any]:
    current_models = current.get("models") if isinstance(current.get("models"), dict) else {}
    generated_models = generated.get("models") if isinstance(generated.get("models"), dict) else {}
    external_feeds = current.get("external_feeds") if isinstance(current.get("external_feeds"), dict) else {}

    keep_keys = set(DEPLOYED_MODEL_KEYS)
    keep_keys.update(str(key) for key in external_feeds)
    merged = {
        key: current_models[key]
        for key in keep_keys
        if key in current_models
    }
    merged.update(generated_models)
    return merged


def merge_payload(generated: dict[str, Any], cache_dir: Path) -> dict[str, Any]:
    date_iso = str(generated.get("date") or "").strip()
    if not date_iso:
        raise SystemExit("Generated model cache is missing date")

    current = _current_payload(cache_dir, date_iso)
    merged = dict(current)
    for key in ("date", "updatedAt", "generatedAt", "generatedBy", "errors"):
        if key in generated:
            merged[key] = generated[key]
    merged["models"] = _merged_models(current, generated)

    for key in MODEL_ALIAS_KEYS:
        if key in generated:
            merged[key] = generated[key]
    for key in EXTERNAL_FEED_MODEL_KEYS:
        if key in current:
            merged[key] = current[key]

    return merged


def main() -> int:
    args = _parse_args()
    generated_path = Path(args.generated)
    cache_dir = Path(args.cache_dir)
    generated = _read_json(generated_path)
    if not generated:
        raise SystemExit(f"Could not read generated model cache: {generated_path}")

    merged = merge_payload(generated, cache_dir)
    date_iso = str(merged["date"])
    _write_json(cache_dir / f"{date_iso}.json", merged)
    _write_json(cache_dir / "latest.json", merged)
    print(json.dumps({
        "date": date_iso,
        "models": sorted((merged.get("models") or {}).keys()),
        "generated": str(generated_path),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
