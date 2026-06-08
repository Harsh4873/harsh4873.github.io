#!/usr/bin/env python3
"""Merge generated external feed cache payloads into the latest cache."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


MODEL_CACHE_DIR = Path("data/model_cache")
EXTERNAL_FEED_MODEL_KEYS = {"sportytrader", "sportsgambler"}


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Merge generated feed cache JSON into data/model_cache.")
    parser.add_argument("generated", help="Path to the generated latest.json from refresh_external_feeds.py.")
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


def _feed_keys(generated: dict[str, Any]) -> set[str]:
    keys = set(EXTERNAL_FEED_MODEL_KEYS)
    external_feeds = generated.get("external_feeds")
    if isinstance(external_feeds, dict):
        keys.update(str(key) for key in external_feeds)
    return keys


def merge_payload(generated: dict[str, Any], cache_dir: Path) -> dict[str, Any]:
    date_iso = str(generated.get("date") or "").strip()
    if not date_iso:
        raise SystemExit("Generated external feed cache is missing date")

    current = _current_payload(cache_dir, date_iso)
    merged = dict(current)
    for key in ("date", "updatedAt", "externalFeedsUpdatedAt", "external_feed_errors"):
        if key in generated:
            merged[key] = generated[key]

    feed_keys = _feed_keys(generated)
    current_models = current.get("models") if isinstance(current.get("models"), dict) else {}
    generated_models = generated.get("models") if isinstance(generated.get("models"), dict) else {}
    models = dict(current_models)
    for key in feed_keys:
        if key in generated_models:
            models[key] = generated_models[key]
    merged["models"] = models

    current_external = current.get("external_feeds") if isinstance(current.get("external_feeds"), dict) else {}
    generated_external = generated.get("external_feeds") if isinstance(generated.get("external_feeds"), dict) else {}
    if current_external or generated_external:
        merged["external_feeds"] = {
            **current_external,
            **generated_external,
        }

    for key in feed_keys:
        if key in generated:
            merged[key] = generated[key]

    return merged


def main() -> int:
    args = _parse_args()
    generated_path = Path(args.generated)
    cache_dir = Path(args.cache_dir)
    generated = _read_json(generated_path)
    if not generated:
        raise SystemExit(f"Could not read generated external feed cache: {generated_path}")

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
