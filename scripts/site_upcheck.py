#!/usr/bin/env python3
"""Validate the committed model cache and built static frontend without a browser."""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


REPO_ROOT = Path(__file__).resolve().parents[1]
MODEL_CACHE_DIR = REPO_ROOT / "data" / "model_cache"
PLAYER_PROPS_CACHE_DIR = REPO_ROOT / "data" / "player_props_cache"
REQUIRED_MODEL_KEYS = {
    "mlb_new",
    "mlb_inning",
    "mlb_first_five",
    "wnba",
    "nba",
    "nba_playoffs",
}
REQUIRED_PLAYER_PROP_KEYS = {
    "mlb_player_props",
    "nba_player_props",
    "wnba_player_props",
}


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def main() -> int:
    failures: list[str] = []
    warnings: list[str] = []
    today = datetime.now(ZoneInfo("America/Chicago")).strftime("%Y-%m-%d")

    latest = _read_json(MODEL_CACHE_DIR / "latest.json")
    dated = _read_json(MODEL_CACHE_DIR / f"{today}.json")
    manifest = _read_json(MODEL_CACHE_DIR / "index.json")
    if not latest:
        failures.append("data/model_cache/latest.json is missing or invalid")
    elif str(latest.get("date") or "") != today:
        failures.append(f"latest model cache is {latest.get('date') or 'undated'}, expected {today}")
    if not dated:
        failures.append(f"data/model_cache/{today}.json is missing or invalid")
    if manifest and f"{today}.json" not in (manifest.get("files") or []):
        failures.append(f"model-cache manifest does not include {today}.json")

    models = latest.get("models") if isinstance(latest, dict) else {}
    models = models if isinstance(models, dict) else {}
    for key in sorted(REQUIRED_MODEL_KEYS):
        bucket = models.get(key)
        if not isinstance(bucket, dict):
            failures.append(f"model bucket {key} is missing")
        elif bucket.get("ok") is not True:
            failures.append(f"model bucket {key} failed: {bucket.get('error') or 'unknown error'}")

    player_latest = _read_json(PLAYER_PROPS_CACHE_DIR / "latest.json")
    player_dated = _read_json(PLAYER_PROPS_CACHE_DIR / f"{today}.json")
    player_manifest = _read_json(PLAYER_PROPS_CACHE_DIR / "index.json")
    if not player_latest:
        failures.append("data/player_props_cache/latest.json is missing or invalid")
    elif str(player_latest.get("date") or "") != today:
        failures.append(f"latest player-props cache is {player_latest.get('date') or 'undated'}, expected {today}")
    if not player_dated:
        failures.append(f"data/player_props_cache/{today}.json is missing or invalid")
    if player_manifest and f"{today}.json" not in (player_manifest.get("files") or []):
        failures.append(f"player-props manifest does not include {today}.json")

    player_models = player_latest.get("models") if isinstance(player_latest, dict) else {}
    player_models = player_models if isinstance(player_models, dict) else {}
    for key in sorted(REQUIRED_PLAYER_PROP_KEYS):
        bucket = player_models.get(key)
        if not isinstance(bucket, dict):
            failures.append(f"player-props bucket {key} is missing")
        elif bucket.get("ok") is not True:
            failures.append(f"player-props bucket {key} failed: {bucket.get('error') or 'unknown error'}")

    cannon = _read_json(REPO_ROOT / "data" / "cannon_mlb_daily.json")
    cannon_date = str((cannon or {}).get("slate_date") or (cannon or {}).get("as_of") or "")
    central_hour = datetime.now(ZoneInfo("America/Chicago")).hour
    if cannon_date != today:
        message = f"Cannon slate is {cannon_date or 'undated'}, expected {today}"
        if central_hour >= 10:
            failures.append(message)
        else:
            warnings.append(message)

    source_html = (REPO_ROOT / "index.html").read_text(encoding="utf-8")
    if 'href="./src/styles/pickledger.css"' not in source_html:
        failures.append("source HTML is missing the main stylesheet")
    if 'type="module" src="./src/main.ts"' not in source_html:
        failures.append("source HTML is missing the Vite module entrypoint")

    dist_html_path = REPO_ROOT / "dist" / "index.html"
    if not dist_html_path.exists():
        failures.append("dist/index.html is missing; run the production build")
    else:
        dist_html = dist_html_path.read_text(encoding="utf-8")
        if not re.search(r'<link[^>]+href="[^"]+\.css"', dist_html):
            failures.append("built HTML has no CSS asset")
        if not re.search(r'<script[^>]+src="[^"]+\.js"', dist_html):
            failures.append("built HTML has no JavaScript asset")
        if ".ts" in dist_html:
            failures.append("built HTML still references TypeScript")

    for message in warnings:
        print(f"[upcheck] warning: {message}")
    for message in failures:
        print(f"[upcheck] failure: {message}")
    if failures:
        return 1

    counts = {
        key: len(bucket.get("picks") or [])
        for key, bucket in models.items()
        if key in REQUIRED_MODEL_KEYS and isinstance(bucket, dict)
    }
    player_counts = {
        key: len(bucket.get("picks") or [])
        for key, bucket in player_models.items()
        if key in REQUIRED_PLAYER_PROP_KEYS and isinstance(bucket, dict)
    }
    print(f"[upcheck] healthy for {today}: teams={counts}, player_props={player_counts}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
