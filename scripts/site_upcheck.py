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
PLAYER_PROPS_SNAPSHOT_DIR = REPO_ROOT / "data" / "player_props_snapshots"
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
    "wnba_player_props",
}
REQUIRED_SCORES24_FEED_KEYS = {
    "scores24_fifa_world_cup",
    "scores24_mlb",
    "scores24_wnba",
}
TEAM_VISIBLE_DECISIONS = {"BET", "LEAN"}
PLAYER_VISIBLE_DECISIONS = {"BET", "LEAN", "PASS"}
MAX_PLAYER_PROP_BOARD_SIZE = 8


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


def _player_prop_market_key(pick: dict[str, Any]) -> tuple[str, ...]:
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


def _consensus_qualified_player_prop(pick: dict[str, Any]) -> bool:
    return (
        pick.get("consensus_qualified") is True
        or pick.get("precision_qualified") is True
        or str(pick.get("ml_probability_mode") or "").strip() == "four_model_consensus_gate"
        or str(pick.get("ml_model_version") or "").strip() == "player_props_consensus_v2.0.0"
    )


def _published_player_prop_keys(payload: dict[str, Any], date_iso: str) -> set[tuple[str, ...]]:
    models = payload.get("models") if isinstance(payload.get("models"), dict) else {}
    keys: set[tuple[str, ...]] = set()
    for bucket in models.values():
        if not isinstance(bucket, dict):
            continue
        for pick in bucket.get("picks") or []:
            if not isinstance(pick, dict):
                continue
            if str(pick.get("date") or "").strip() != date_iso:
                continue
            if str(pick.get("scope") or "").strip().lower() != "player":
                continue
            if (
                pick.get("market_priced") is True
                and str(pick.get("probability_source") or "").strip() == "player_props_ml_v1"
                and _consensus_qualified_player_prop(pick)
            ):
                keys.add(_player_prop_market_key(pick))
    return keys


def _snapshot_player_prop_keys(date_iso: str) -> set[tuple[str, ...]]:
    best_keys: set[tuple[str, ...]] = set()
    for path in sorted((PLAYER_PROPS_SNAPSHOT_DIR / date_iso).glob("*.json")):
        payload = _read_json(path)
        if payload and str(payload.get("date") or "").strip() == date_iso:
            keys = _published_player_prop_keys(payload, date_iso)
            if len(keys) >= len(best_keys):
                best_keys = keys
    return best_keys


def _decision(pick: dict[str, Any]) -> str:
    return str(pick.get("decision") or "").strip().upper()


def _pick_text(pick: dict[str, Any]) -> str:
    return str(pick.get("pick") or pick.get("selection") or pick.get("prop") or pick.get("bet") or "").strip()


def _team_pick_key(pick: dict[str, Any], fallback_source: str) -> tuple[str, ...]:
    return tuple(
        str(value or "").strip().lower()
        for value in (
            pick.get("source") or fallback_source,
            pick.get("sport"),
            pick.get("date") or pick.get("game_date") or pick.get("slate_date") or pick.get("Date"),
            _pick_text(pick),
            pick.get("matchup"),
            pick.get("game"),
        )
    )


def _bucket_picks(bucket: Any) -> list[dict[str, Any]]:
    if not isinstance(bucket, dict):
        return []
    return [pick for pick in bucket.get("picks") or [] if isinstance(pick, dict)]


def _visible_team_picks(bucket: Any) -> list[dict[str, Any]]:
    return [pick for pick in _bucket_picks(bucket) if _pick_text(pick) and _decision(pick) in TEAM_VISIBLE_DECISIONS]


def _visible_player_picks(bucket: Any) -> list[dict[str, Any]]:
    return [
        pick
        for pick in _bucket_picks(bucket)
        if _pick_text(pick)
        and _decision(pick) in PLAYER_VISIBLE_DECISIONS
        and str(pick.get("scope") or "").strip().lower() == "player"
    ]


def _cache_contract_messages(cache_dir: Path, *, player_props: bool, today: str) -> tuple[list[str], list[str]]:
    failures: list[str] = []
    warnings: list[str] = []
    manifest = _read_json(cache_dir / "index.json") or {}
    files = [
        file
        for file in manifest.get("files") or []
        if isinstance(file, str) and re.fullmatch(r"20\d\d-\d\d-\d\d\.json", file)
    ]
    for file in files:
        payload = _read_json(cache_dir / file)
        if not payload:
            warnings.append(f"{cache_dir.name}/{file} is listed in manifest but is missing or invalid")
            continue
        date_iso = str(payload.get("date") or payload.get("slate_date") or file[:10]).strip()
        models = payload.get("models") if isinstance(payload.get("models"), dict) else {}
        id_counts: dict[tuple[str, str], int] = {}
        duplicate_keys = 0
        missing_dates = 0
        for model_key, bucket in models.items():
            picks = _bucket_picks(bucket)
            market_counts: dict[tuple[str, ...], int] = {}
            for pick in picks:
                pick_id = str(pick.get("id") or "").strip()
                if pick_id:
                    id_key = (date_iso, pick_id)
                    id_counts[id_key] = id_counts.get(id_key, 0) + 1
                if not str(pick.get("date") or pick.get("game_date") or pick.get("slate_date") or pick.get("Date") or "").strip():
                    missing_dates += 1
                key = _player_prop_market_key(pick) if player_props else _team_pick_key(pick, str(model_key))
                if any(key):
                    market_counts[key] = market_counts.get(key, 0) + 1
            duplicate_keys += sum(1 for count in market_counts.values() if count > 1)
        duplicate_ids = sum(1 for count in id_counts.values() if count > 1)
        if duplicate_ids:
            message = f"{cache_dir.name}/{file} has {duplicate_ids} duplicate date/id pair(s)"
            if date_iso == today:
                failures.append(message)
            else:
                warnings.append(message)
        if duplicate_keys:
            warnings.append(f"{cache_dir.name}/{file} has {duplicate_keys} duplicate market key(s)")
        if missing_dates:
            warnings.append(
                f"{cache_dir.name}/{file} has {missing_dates} pick row(s) without embedded dates; "
                "the viewer falls back to the payload date"
            )
    return failures, warnings


def main() -> int:
    args = _parse_args()
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
    if player_latest:
        latest_prop_keys = _published_player_prop_keys(player_latest, today)
        archived_prop_keys = _snapshot_player_prop_keys(today)
        missing_archived = archived_prop_keys - latest_prop_keys
        if missing_archived:
            failures.append(
                f"latest player-props cache is missing {len(missing_archived)} same-day published prop(s) from snapshots"
            )
    for key in sorted(REQUIRED_PLAYER_PROP_KEYS):
        bucket = player_models.get(key)
        if not isinstance(bucket, dict):
            failures.append(f"player-props bucket {key} is missing")
        elif bucket.get("ok") is not True:
            failures.append(f"player-props bucket {key} failed: {bucket.get('error') or 'unknown error'}")
        elif (
            key in {"mlb_player_props", "wnba_player_props"}
            and int(bucket.get("games") or 0) > 0
            and not (bucket.get("picks") or [])
            and bucket.get("abstained") is not True
        ):
            failures.append(f"player-props bucket {key} has scheduled games but zero picks")
        else:
            picks = bucket.get("picks") or []
            if key in {"mlb_player_props", "wnba_player_props"}:
                if len(picks) > MAX_PLAYER_PROP_BOARD_SIZE:
                    failures.append(
                        f"player-props bucket {key} has {len(picks)} visible picks, expected at most {MAX_PLAYER_PROP_BOARD_SIZE}"
                    )
                ranks = [
                    int(pick.get("ml_rank") or 0)
                    for pick in picks
                    if isinstance(pick, dict) and str(pick.get("ml_rank") or "").strip()
                ]
                if ranks and ranks != list(range(1, len(ranks) + 1)):
                    failures.append(f"player-props bucket {key} has non-contiguous ML ranks: {ranks}")
                if any(isinstance(pick, dict) and pick.get("carried_forward") for pick in picks):
                    failures.append(f"player-props bucket {key} includes carried-forward snapshot props in latest board")
            market_picks = [pick for pick in picks if isinstance(pick, dict) and pick.get("market_priced") is True]
            if market_picks and any(str(pick.get("probability_source") or "") != "player_props_ml_v1" for pick in market_picks):
                failures.append(f"player-props bucket {key} has market-priced picks without player_props_ml_v1 probability")

    contract_failures, contract_warnings = _cache_contract_messages(MODEL_CACHE_DIR, player_props=False, today=today)
    failures.extend(contract_failures)
    warnings.extend(contract_warnings)
    contract_failures, contract_warnings = _cache_contract_messages(PLAYER_PROPS_CACHE_DIR, player_props=True, today=today)
    failures.extend(contract_failures)
    warnings.extend(contract_warnings)

    if args.data_only:
        for message in warnings:
            print(f"[readiness] warning: {message}")
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

    for message in warnings:
        print(f"[upcheck] warning: {message}")
    for message in failures:
        print(f"[upcheck] failure: {message}")
    if failures:
        return 1

    team_counts = {
        key: len(bucket.get("picks") or [])
        for key, bucket in models.items()
        if key in REQUIRED_MODEL_KEYS and isinstance(bucket, dict)
    }
    team_visible_counts = {
        key: len(_visible_team_picks(bucket))
        for key, bucket in models.items()
        if key in REQUIRED_MODEL_KEYS and isinstance(bucket, dict)
    }
    player_counts = {
        key: len(bucket.get("picks") or [])
        for key, bucket in player_models.items()
        if key in REQUIRED_PLAYER_PROP_KEYS and isinstance(bucket, dict)
    }
    player_visible_counts = {
        key: len(_visible_player_picks(bucket))
        for key, bucket in player_models.items()
        if key in REQUIRED_PLAYER_PROP_KEYS and isinstance(bucket, dict)
    }
    print(
        f"[upcheck] healthy for {today}: "
        f"teams_raw={team_counts}, teams_visible={team_visible_counts}, "
        f"player_props_raw={player_counts}, player_props_visible={player_visible_counts}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
