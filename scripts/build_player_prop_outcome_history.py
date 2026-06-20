#!/usr/bin/env python3
"""Build compact prior-season player game outcomes for prop features.

Archived books do not retain complete historical prop prices. ESPN does retain
player game logs, so this corpus is deliberately outcomes-only: it may provide
prior-performance features, but it is never treated as a betting-market label.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from player_props.api import DirectApiClient  # noqa: E402
from player_props.schema import safe_float  # noqa: E402


DEFAULT_MARKETS = REPO_ROOT / "data" / "player_props_training" / "market_history_2026.jsonl"
DEFAULT_OUTPUT = REPO_ROOT / "data" / "player_props_training" / "outcome_history_2022_2026.jsonl.gz"
SPORT_CONFIG = {
    "MLB": ("baseball", "mlb"),
    "WNBA": ("basketball", "wnba"),
}


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--markets", type=Path, default=DEFAULT_MARKETS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--seasons", default="2024,2025")
    parser.add_argument("--sports", default="MLB,WNBA")
    parser.add_argument("--max-workers", type=int, default=16)
    parser.add_argument("--refresh", action="store_true", help="Refetch profiles already present in the output.")
    return parser.parse_args()


def _number(value: Any) -> float | None:
    text = str(value or "").strip().replace(",", "")
    if not text or text.lower() in {"nan", "--", "-"}:
        return None
    if "-" in text and not text.startswith("-"):
        text = text.split("-", 1)[0]
    try:
        number = float(text)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _outs(value: Any) -> float | None:
    text = str(value or "").strip()
    if not text:
        return None
    if "." not in text:
        innings = _number(text)
        return innings * 3.0 if innings is not None else None
    whole, partial = text.split(".", 1)
    innings = _number(whole)
    remainder = _number(partial[:1])
    if innings is None or remainder is None:
        return None
    return innings * 3.0 + max(0.0, min(2.0, remainder))


def _requested_athletes(path: Path, sports: set[str]) -> dict[str, set[str]]:
    athletes = {sport: set() for sport in sports}
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        sport = str(row.get("sport") or "").upper()
        athlete_id = str(row.get("athlete_id") or "").strip()
        if sport in athletes and athlete_id:
            athletes[sport].add(athlete_id)
    return athletes


def _read_existing(path: Path) -> tuple[list[dict[str, Any]], set[tuple[str, int, str]]]:
    if not path.exists():
        return [], set()
    rows: list[dict[str, Any]] = []
    completed: set[tuple[str, int, str]] = set()
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(row, dict):
                continue
            rows.append(row)
            completed.add((str(row.get("sport") or ""), int(row.get("season") or 0), str(row.get("athlete_id") or "")))
    return rows, completed


def _event_rows(sport: str, athlete_id: str, season: int, payload: dict[str, Any]) -> list[dict[str, Any]]:
    names = [str(value) for value in payload.get("names") or []]
    event_index = payload.get("events") if isinstance(payload.get("events"), dict) else {}
    output: list[dict[str, Any]] = []
    seen: set[str] = set()
    for season_type in payload.get("seasonTypes") or []:
        if "preseason" in str(season_type.get("displayName") or "").lower():
            continue
        for category in season_type.get("categories") or []:
            if category.get("type") != "event":
                continue
            for item in category.get("events") or []:
                event_id = str(item.get("eventId") or "")
                values = item.get("stats") or []
                event = event_index.get(event_id) if isinstance(event_index.get(event_id), dict) else {}
                if not event_id or event_id in seen or len(values) < len(names):
                    continue
                stats = {name: _number(values[index]) for index, name in enumerate(names)}
                context = {
                    "minutes": stats.get("minutes"),
                    "usage": (
                        stats.get("minutes")
                        if sport == "WNBA"
                        else stats.get("battersFaced") if "innings" in stats else stats.get("atBats")
                    ),
                    "opponent_id": str((event.get("opponent") or {}).get("id") or ""),
                    "team_id": str((event.get("team") or {}).get("id") or ""),
                    "home_away": str(event.get("atVs") or ""),
                }
                actuals: dict[str, float | None]
                if sport == "MLB" and "innings" in stats:
                    actuals = {
                        "strikeouts": stats.get("strikeouts"),
                        "pitcher_walks_allowed": stats.get("walks"),
                        "pitcher_hits_allowed": stats.get("hits"),
                        "pitcher_earned_runs_allowed": stats.get("earnedRuns"),
                        "pitcher_outs_recorded": _outs(values[names.index("innings")]),
                    }
                elif sport == "MLB":
                    hits = stats.get("hits")
                    runs = stats.get("runs")
                    rbis = stats.get("RBIs")
                    actuals = {
                        "hits": hits,
                        "runs": runs,
                        "rbis": rbis,
                        "home_runs": stats.get("homeRuns"),
                        "batter_walks": stats.get("walks"),
                        "batter_strikeouts": stats.get("strikeouts"),
                        "hits_runs_rbis": hits + runs + rbis if hits is not None and runs is not None and rbis is not None else None,
                    }
                else:
                    points = stats.get("points")
                    rebounds = stats.get("totalRebounds")
                    assists = stats.get("assists")
                    actuals = {
                        "points": points,
                        "totalRebounds": rebounds,
                        "assists": assists,
                        "points_rebounds": points + rebounds if points is not None and rebounds is not None else None,
                        "points_assists": points + assists if points is not None and assists is not None else None,
                        "points_rebounds_assists": (
                            points + rebounds + assists
                            if points is not None and rebounds is not None and assists is not None
                            else None
                        ),
                    }
                game_timestamp = str(event.get("gameDate") or "")
                try:
                    game_date = (
                        datetime.fromisoformat(game_timestamp.replace("Z", "+00:00"))
                        .astimezone(ZoneInfo("America/Chicago"))
                        .date()
                        .isoformat()
                    )
                except ValueError:
                    game_date = game_timestamp[:10]
                for stat_key, actual in actuals.items():
                    if actual is None or not math.isfinite(float(actual)):
                        continue
                    output.append({
                        "sport": sport,
                        "season": season,
                        "date": game_date,
                        "event_id": event_id,
                        "athlete_id": athlete_id,
                        "stat_key": stat_key,
                        "actual": float(actual),
                        "source": "ESPN player gamelog",
                        **context,
                    })
                seen.add(event_id)
    return output


def _fetch(sport: str, athlete_id: str, season: int) -> tuple[str, int, str, list[dict[str, Any]], str | None]:
    segment, league = SPORT_CONFIG[sport]
    client = DirectApiClient(timeout=30.0, attempts=3)
    try:
        payload = client._get(  # noqa: SLF001 - ESPN has no public SDK for this endpoint
            f"https://site.web.api.espn.com/apis/common/v3/sports/{segment}/{league}/athletes/{athlete_id}/gamelog",
            {"season": season, "region": "us", "lang": "en", "contentorigin": "espn"},
        )
        return sport, season, athlete_id, _event_rows(sport, athlete_id, season, payload), None
    except Exception as exc:  # network failures are reported and retried on the next run
        return sport, season, athlete_id, [], str(exc)


def _write(path: Path, rows: list[dict[str, Any]]) -> None:
    deduped = {
        (row["sport"], row["season"], row["event_id"], row["athlete_id"], row["stat_key"]): row
        for row in rows
    }
    ordered = sorted(deduped.values(), key=lambda row: (
        row["date"], row["sport"], row["event_id"], row["athlete_id"], row["stat_key"]
    ))
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as handle:
        for row in ordered:
            handle.write(json.dumps(row, sort_keys=True) + "\n")


def main() -> int:
    args = _arguments()
    seasons = sorted({int(value.strip()) for value in str(args.seasons).split(",") if value.strip()})
    sports = {value.strip().upper() for value in str(args.sports).split(",") if value.strip()}
    unknown = sports - set(SPORT_CONFIG)
    if unknown:
        raise SystemExit(f"Unsupported sport(s): {', '.join(sorted(unknown))}")
    athletes = _requested_athletes(args.markets.resolve(), sports)
    existing, completed = _read_existing(args.output.resolve())
    tasks = [
        (sport, athlete_id, season)
        for sport in sorted(sports)
        for athlete_id in sorted(athletes[sport])
        for season in seasons
        if args.refresh or (sport, season, athlete_id) not in completed
    ]
    rows = list(existing)
    failures: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=max(1, int(args.max_workers))) as executor:
        futures = {executor.submit(_fetch, *task): task for task in tasks}
        for index, future in enumerate(as_completed(futures), start=1):
            sport, season, athlete_id, fetched, error = future.result()
            rows.extend(fetched)
            if error:
                failures.append({"sport": sport, "season": season, "athlete_id": athlete_id, "error": error})
            if index % 100 == 0 or index == len(tasks):
                print(f"[outcome-history] completed {index}/{len(tasks)} profiles; rows={len(rows)}; failures={len(failures)}")
    _write(args.output.resolve(), rows)
    print(json.dumps({
        "ok": not failures,
        "output": str(args.output.resolve()),
        "rows": len(rows),
        "athletes": {sport: len(values) for sport, values in athletes.items()},
        "seasons": seasons,
        "failures": failures,
    }, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
