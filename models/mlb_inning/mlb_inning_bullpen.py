"""Bullpen-fatigue lookup for the MLB Inning model.

Pre-patch the model treated every team's bullpen as fully rested. In reality
managers can only run an arm on back-to-back days a couple times a week, and
high-leverage relievers used yesterday almost never appear today. So a
manager who has burned 3-4 of his top 8 arms in the last 2 games is forced
into mop-up arms for the late innings, and the team's late-inning scoreless
rate drops materially.

This module fetches each team's last `lookback` finished games via the
existing `feed_{game_id}` cache (no extra round-trips after first run) and
returns a structured workload payload the probability layer can read.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

try:
    from mlb_inning_fetcher import (
        API_BASE,
        LIVE_FEED_BASE,
        STATS_TTL_SECONDS,
        api_get_json,
        log_warning,
        safe_int,
    )
except ImportError:
    from .mlb_inning_fetcher import (
        API_BASE,
        LIVE_FEED_BASE,
        STATS_TTL_SECONDS,
        api_get_json,
        log_warning,
        safe_int,
    )


# Standard MLB pen carries 8 relievers. Used as the denominator when scaling
# "fraction of the pen unavailable today" into the [0, 1] fatigue index.
TYPICAL_BULLPEN_SIZE = 8

# Maximum scoreless-rate shift the model applies when the entire pen is
# fatigued. 12pp at full fatigue is calibrated so that ~half the pen out
# (fatigue_index ≈ 0.5) shaves ~6pp off the late-inning scoreless rate —
# roughly the empirical penalty a fully blown bullpen carries.
MAX_FATIGUE_SHIFT_PP = 0.12


def fetch_bullpen_workload(
    team_id: int,
    target_date: str,
    lookback_games: int = 2,
) -> dict[str, Any]:
    """Lookup the team's last `lookback_games` finished games and compute
    which relievers are likely unavailable today.

    Returns a dict shaped to slot directly into ``pitcher["team_bullpen"]``
    so the probability layer can read it without extra plumbing. On any
    network error the function returns a zero-fatigue payload so the
    probability layer falls back to baseline behavior.
    """
    if not team_id:
        return _empty_workload(lookback_games)

    try:
        season = int(str(target_date)[:4])
    except (TypeError, ValueError):
        return _empty_workload(lookback_games)

    try:
        schedule = api_get_json(
            f"{API_BASE}/schedule",
            params={
                "sportId": 1,
                "teamId": team_id,
                "startDate": f"{season}-03-01",
                "endDate": f"{season}-11-30",
            },
            cache_key=f"team_schedule_{team_id}_{season}",
            ttl_seconds=STATS_TTL_SECONDS,
        )
    except RuntimeError as exc:
        log_warning(f"bullpen schedule lookup failed for team {team_id}: {exc}")
        return _empty_workload(lookback_games)

    final_games = _final_games_before(schedule, target_date)[:lookback_games]
    if not final_games:
        return _empty_workload(lookback_games)

    appearances: dict[int, int] = {}
    yesterday_relievers: set[int] = set()
    games_inspected = 0

    for index, game in enumerate(final_games):
        game_pk = safe_int(game.get("gamePk"))
        if not game_pk:
            continue
        try:
            feed = api_get_json(
                f"{LIVE_FEED_BASE}/game/{game_pk}/feed/live",
                cache_key=f"feed_{game_pk}",
                ttl_seconds=STATS_TTL_SECONDS,
            )
        except RuntimeError as exc:
            log_warning(f"bullpen feed lookup failed for game {game_pk}: {exc}")
            continue

        relievers = _relievers_from_feed(feed, team_id)
        if not relievers:
            continue
        games_inspected += 1
        for pid in relievers:
            appearances[pid] = appearances.get(pid, 0) + 1
        if index == 0:
            yesterday_relievers = set(relievers)

    recently_used = sorted(appearances.keys())
    back_to_back = sorted(pid for pid, n in appearances.items() if n >= 2)
    # Yesterday-used relievers are typically unavailable today; back-to-back
    # arms doubly so. The union is "today's unavailable list".
    unavailable = sorted(set(yesterday_relievers) | set(back_to_back))
    fatigue_index = min(1.0, len(unavailable) / float(TYPICAL_BULLPEN_SIZE))

    return {
        "lookback_games": lookback_games,
        "games_inspected": games_inspected,
        "recently_used_pitcher_ids": recently_used,
        "back_to_back_arms": back_to_back,
        "yesterday_used_pitcher_ids": sorted(yesterday_relievers),
        "unavailable_today": unavailable,
        "fatigue_index": round(fatigue_index, 3),
    }


def compute_fatigue_shift(fatigue_index: float, max_shift_pp: float = MAX_FATIGUE_SHIFT_PP) -> float:
    """Convert a [0, 1] fatigue index into the points-of-scoreless-rate to
    subtract from the bullpen's clean baseline.

    Linear inside [0, 1]; clamped if the caller passes a stale value.
    """
    try:
        f = float(fatigue_index or 0.0)
    except (TypeError, ValueError):
        return 0.0
    if f <= 0.0:
        return 0.0
    if f >= 1.0:
        return max_shift_pp
    return f * max_shift_pp


def _final_games_before(schedule: dict[str, Any], target_date: str) -> list[dict[str, Any]]:
    try:
        cutoff = datetime.strptime(str(target_date), "%Y-%m-%d").date()
    except ValueError:
        return []

    finished: list[tuple[Any, dict[str, Any]]] = []
    for day in schedule.get("dates") or []:
        for game in day.get("games") or []:
            game_date = _parse_game_date(game.get("gameDate") or game.get("officialDate"))
            if not game_date or game_date >= cutoff:
                continue
            status = str(((game.get("status") or {}).get("detailedState")) or "")
            if "final" not in status.lower():
                continue
            finished.append((game_date, game))

    finished.sort(key=lambda item: item[0], reverse=True)
    return [game for _, game in finished]


def _relievers_from_feed(feed: dict[str, Any], team_id: int) -> list[int]:
    boxscore = (feed.get("liveData") or {}).get("boxscore") or {}
    teams = boxscore.get("teams") or {}
    target_side = None
    for side in ("home", "away"):
        side_data = teams.get(side) or {}
        side_team = side_data.get("team") or {}
        if safe_int(side_team.get("id")) == int(team_id):
            target_side = side
            break
    if target_side is None:
        return []

    side_box = teams.get(target_side) or {}
    pitcher_ids = [safe_int(pid) for pid in (side_box.get("pitchers") or []) if safe_int(pid)]
    if len(pitcher_ids) <= 1:
        return []
    # First listed pitcher is the starter; everyone after is a reliever.
    return [pid for pid in pitcher_ids[1:] if pid]


def _parse_game_date(raw_value: Any):
    raw = str(raw_value or "")[:10]
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError:
        return None


def _empty_workload(lookback_games: int) -> dict[str, Any]:
    return {
        "lookback_games": lookback_games,
        "games_inspected": 0,
        "recently_used_pitcher_ids": [],
        "back_to_back_arms": [],
        "yesterday_used_pitcher_ids": [],
        "unavailable_today": [],
        "fatigue_index": 0.0,
    }
