#!/usr/bin/env python3
"""Validate the committed model cache and built static frontend without a browser."""

from __future__ import annotations

import argparse
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
    "fifa_world_cup",
}
REQUIRED_PLAYER_PROP_KEYS = {
    "mlb_player_props",
    "nba_player_props",
    "wnba_player_props",
}
REQUIRED_SCORES24_FEED_KEYS = {
    "scores24_fifa_world_cup",
    "scores24_mlb",
    "scores24_wnba",
}


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--data-only",
        action="store_true",
        help="Check whether today's committed model and player-props data is ready to deploy.",
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    failures: list[str] = []
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

    external_feeds = latest.get("external_feeds") if isinstance(latest, dict) else {}
    external_feeds = external_feeds if isinstance(external_feeds, dict) else {}
    for key in sorted(REQUIRED_SCORES24_FEED_KEYS):
        bucket = external_feeds.get(key)
        if not isinstance(bucket, dict):
            failures.append(f"external-feed bucket {key} is missing")
            continue
        if bucket.get("ok") is not True:
            failures.append(f"external-feed bucket {key} failed: {bucket.get('error') or 'unknown error'}")
            continue
        if str(bucket.get("date") or "") != today:
            failures.append(f"external-feed bucket {key} is {bucket.get('date') or 'undated'}, expected {today}")
        meta = bucket.get("meta") if isinstance(bucket.get("meta"), dict) else {}
        missing = meta.get("missingMatchups") if isinstance(meta.get("missingMatchups"), list) else []
        expected = meta.get("expectedMatchups")
        matched = meta.get("matchedPicks")
        if missing or expected != matched or matched != len(bucket.get("picks") or []):
            failures.append(
                f"external-feed bucket {key} has incomplete official-slate coverage: "
                f"matched={matched!r}, expected={expected!r}, missing={missing!r}"
            )

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
        elif (
            key == "mlb_player_props"
            and int(bucket.get("games") or 0) > 0
            and not (bucket.get("picks") or [])
            and bucket.get("abstained") is not True
        ):
            failures.append("player-props bucket mlb_player_props has scheduled games but zero picks")
        else:
            picks = bucket.get("picks") or []
            market_picks = [pick for pick in picks if isinstance(pick, dict) and pick.get("market_priced") is True]
            if market_picks and any(str(pick.get("probability_source") or "") != "player_props_ml_v1" for pick in market_picks):
                failures.append(f"player-props bucket {key} has market-priced picks without player_props_ml_v1 probability")

    if args.data_only:
        for message in failures:
            print(f"[readiness] waiting: {message}")
        if failures:
            return 1
        print(f"[readiness] daily data is ready for {today}")
        return 0

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
