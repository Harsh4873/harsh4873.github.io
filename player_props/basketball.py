"""ESPN-backed NBA and WNBA player-props projections."""

from __future__ import annotations

import math
import statistics
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from .schema import build_pick, nearest_half, normal_probability, normalize_name, safe_float


STAT_LABELS = {
    "points": "Points",
    "totalRebounds": "Rebounds",
    "assists": "Assists",
}
OUT_STATUSES = {"out", "doubtful", "injured reserve", "suspension"}


def _event_teams(event: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    competition = (event.get("competitions") or [{}])[0]
    competitors = competition.get("competitors") or []
    home = next((item for item in competitors if item.get("homeAway") == "home"), {})
    away = next((item for item in competitors if item.get("homeAway") == "away"), {})
    return away.get("team") or {}, home.get("team") or {}


def _injury_map(payload: dict[str, Any]) -> dict[str, dict[str, str]]:
    injuries: dict[str, dict[str, str]] = {}
    for team in payload.get("injuries") or []:
        for item in team.get("injuries") or []:
            athlete = item.get("athlete") or {}
            name = athlete.get("displayName") or athlete.get("fullName") or ""
            if not name:
                continue
            injuries[normalize_name(name)] = {
                "status": str(item.get("status") or ""),
                "comment": str(item.get("shortComment") or ""),
            }
    return injuries


def _team_stats(payload: dict[str, Any]) -> dict[str, float]:
    result: dict[str, float] = {}
    categories = (((payload.get("results") or {}).get("stats") or {}).get("categories") or [])
    for category in categories:
        for item in category.get("stats") or []:
            result[str(item.get("name") or "")] = safe_float(item.get("value"))
    return result


def _parse_gamelog(payload: dict[str, Any]) -> dict[str, Any] | None:
    names = [str(value) for value in payload.get("names") or []]
    wanted = {"minutes", *STAT_LABELS}
    if not wanted.issubset(set(names)):
        return None

    rows: list[dict[str, float]] = []
    for season_type in payload.get("seasonTypes") or []:
        if "preseason" in str(season_type.get("displayName") or "").lower():
            continue
        for category in season_type.get("categories") or []:
            if category.get("type") != "event":
                continue
            for event in category.get("events") or []:
                values = event.get("stats") or []
                if len(values) < len(names):
                    continue
                rows.append({name: safe_float(values[index]) for index, name in enumerate(names)})
    if not rows:
        return None

    averages = {
        stat: statistics.fmean(row[stat] for row in rows)
        for stat in ("minutes", *STAT_LABELS)
    }
    recent = {
        stat: statistics.fmean(row[stat] for row in rows[:5])
        for stat in ("minutes", *STAT_LABELS)
    }
    deviations = {
        stat: statistics.pstdev([row[stat] for row in rows]) if len(rows) > 1 else max(1.0, averages[stat] * 0.25)
        for stat in STAT_LABELS
    }
    return {
        "games": len(rows),
        "average": averages,
        "recent": recent,
        "deviation": deviations,
    }


def _opponent_context(stats: dict[str, float]) -> tuple[float, list[str]]:
    points = stats.get("avgPoints", 0.0)
    blocks = stats.get("avgBlocks", 0.0)
    steals = stats.get("avgSteals", 0.0)
    pace_proxy = 1.0 + max(-0.035, min(0.035, (points - 82.0) / 350.0)) if points else 1.0
    disruption = max(-0.03, min(0.02, ((blocks + steals) - 12.0) / -250.0))
    factor = pace_proxy + disruption
    factors = [
        f"Opponent scoring/pace proxy {points:.1f} PPG" if points else "Opponent pace data unavailable",
        f"Opponent disruption proxy {blocks + steals:.1f} blocks+steals/game"
        if blocks or steals
        else "Opponent defensive event data unavailable",
    ]
    return factor, factors


def _player_profiles(
    client: Any,
    league: str,
    season: int,
    roster: dict[str, Any],
    max_workers: int,
) -> list[dict[str, Any]]:
    athletes = [
        athlete
        for athlete in roster.get("athletes") or []
        if athlete.get("id") and athlete.get("displayName")
    ]
    profiles: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=max(1, min(max_workers, len(athletes) or 1))) as executor:
        futures = {
            executor.submit(client.basketball_player_gamelog, league, str(athlete["id"]), season): athlete
            for athlete in athletes
        }
        for future in as_completed(futures):
            athlete = futures[future]
            try:
                parsed = _parse_gamelog(future.result())
            except Exception:
                parsed = None
            if parsed:
                profiles.append(
                    {
                        "id": str(athlete["id"]),
                        "name": str(athlete["displayName"]),
                        "position": str((athlete.get("position") or {}).get("abbreviation") or ""),
                        **parsed,
                    }
                )
    return profiles


def _game_props(
    *,
    client: Any,
    league: str,
    sport: str,
    season: int,
    date_iso: str,
    event: dict[str, Any],
    injuries: dict[str, dict[str, str]],
    max_workers: int,
) -> list[dict[str, Any]]:
    away, home = _event_teams(event)
    if not away.get("id") or not home.get("id"):
        return []

    team_payloads: dict[str, dict[str, Any]] = {}
    for side, team in (("away", away), ("home", home)):
        team_payloads[side] = {
            "team": team,
            "roster": client.basketball_roster(league, str(team["id"])),
            "stats": _team_stats(client.basketball_team_stats(league, str(team["id"]))),
        }
        team_payloads[side]["players"] = _player_profiles(
            client,
            league,
            season,
            team_payloads[side]["roster"],
            max_workers,
        )

    candidates: list[tuple[float, dict[str, Any]]] = []
    for side, opponent_side in (("away", "home"), ("home", "away")):
        team_data = team_payloads[side]
        opponent_data = team_payloads[opponent_side]
        players = team_data["players"]
        healthy: list[dict[str, Any]] = []
        injured_stars: list[str] = []
        superstar_floor = 20.0 if sport == "NBA" else 14.0
        for player in players:
            injury = injuries.get(normalize_name(player["name"]), {})
            status = str(injury.get("status") or "").lower()
            if status in OUT_STATUSES:
                if player["average"]["points"] >= superstar_floor:
                    injured_stars.append(player["name"])
                continue
            if player["games"] >= 3 and player["average"]["minutes"] >= 17.0:
                player["injury"] = injury
                healthy.append(player)

        healthy.sort(key=lambda player: (player["average"]["points"], player["average"]["minutes"]), reverse=True)
        next_men = {player["id"] for player in healthy[:3]} if injured_stars else set()
        opponent_factor, opponent_factors = _opponent_context(opponent_data["stats"])
        for player in healthy:
            for stat_key, stat_label in STAT_LABELS.items():
                season_avg = player["average"][stat_key]
                recent_avg = player["recent"][stat_key]
                if season_avg <= 0:
                    continue
                projection = (season_avg * 0.58) + (recent_avg * 0.42)
                factors = [
                    f"Season {stat_label.lower()} average {season_avg:.1f}",
                    f"Last-five {stat_label.lower()} average {recent_avg:.1f}",
                    *opponent_factors,
                ]
                if side == "home":
                    projection *= 1.018
                    factors.append("Home-court role adjustment +1.8%")
                else:
                    factors.append("Road context applied")
                projection *= opponent_factor

                injury = player.get("injury") or {}
                if injury:
                    projection *= 0.92
                    factors.append(f"Player injury status {injury.get('status')}: -8% availability adjustment")
                if player["id"] in next_men:
                    redistribution = {"points": 1.08, "assists": 1.06, "totalRebounds": 1.04}[stat_key]
                    projection *= redistribution
                    factors.append(
                        f"Next-man-up redistribution from unavailable star(s): {', '.join(injured_stars)}"
                    )

                line = nearest_half(season_avg)
                selection = "Over" if projection >= line else "Under"
                probability = normal_probability(
                    projection,
                    line,
                    max(player["deviation"][stat_key], math.sqrt(max(1.0, projection)) * 0.65),
                    selection,
                )
                reason = (
                    f"{player['name']} projects for {projection:.2f} {stat_label.lower()} versus "
                    f"an in-house {line:.1f} baseline after recent form, availability, opponent, "
                    f"and {'home' if side == 'home' else 'road'} context."
                )
                pick = build_pick(
                    sport=sport,
                    date_iso=date_iso,
                    game_id=str(event.get("id") or ""),
                    away_team=str(away.get("displayName") or away.get("name") or ""),
                    home_team=str(home.get("displayName") or home.get("name") or ""),
                    start_time=str(event.get("date") or ""),
                    player_id=player["id"],
                    player_name=player["name"],
                    team=str(team_data["team"].get("displayName") or team_data["team"].get("name") or ""),
                    opponent=str(opponent_data["team"].get("displayName") or opponent_data["team"].get("name") or ""),
                    stat_key=stat_key,
                    stat_label=stat_label,
                    selection=selection,
                    line=line,
                    projection=projection,
                    probability=probability,
                    reason=reason,
                    key_factors=factors,
                    extra={
                        "game_id": str(event.get("id") or ""),
                        "player_id": player["id"],
                        "sample_games": player["games"],
                        "injury_status": str(injury.get("status") or "Healthy"),
                        "redistribution_from": injured_stars,
                        "pricing_type": "synthetic",
                        "line_source": "in_house_baseline",
                        "odds_source": "default_assumed",
                        "market_priced": False,
                        "actionability": "research_signal",
                    },
                )
                score = abs(projection - line) / max(0.5, player["deviation"][stat_key]) + probability
                candidates.append((score, pick))

    candidates.sort(key=lambda row: (-row[0], row[1]["id"]))
    selected: list[dict[str, Any]] = []
    per_player: dict[str, int] = {}
    for _score, pick in candidates:
        player_key = str(pick.get("player_id"))
        if per_player.get(player_key, 0) >= 2:
            continue
        selected.append(pick)
        per_player[player_key] = per_player.get(player_key, 0) + 1
        if len(selected) >= 8:
            break
    return selected


def generate_basketball_model(
    client: Any,
    league: str,
    sport: str,
    date_iso: str,
    max_workers: int = 6,
) -> dict[str, Any]:
    """Generate a healthy model result; an empty schedule is not an error."""
    try:
        scoreboard = client.basketball_scoreboard(league, date_iso)
    except Exception as exc:
        return {"ok": False, "sport": sport, "date": date_iso, "games": 0, "picks": [], "errors": [str(exc)]}

    events = scoreboard.get("events") or []
    if not events:
        return {
            "ok": True,
            "sport": sport,
            "date": date_iso,
            "games": 0,
            "picks": [],
            "errors": [],
            "note": f"No {sport} games scheduled; empty slate is healthy.",
        }

    try:
        injuries = _injury_map(client.basketball_injuries(league))
    except Exception:
        injuries = {}
    season = int(((scoreboard.get("season") or {}).get("year")) or date_iso[:4])
    picks: list[dict[str, Any]] = []
    errors: list[str] = []
    for event in events:
        try:
            picks.extend(
                _game_props(
                    client=client,
                    league=league,
                    sport=sport,
                    season=season,
                    date_iso=date_iso,
                    event=event,
                    injuries=injuries,
                    max_workers=max_workers,
                )
            )
        except Exception as exc:
            errors.append(f"{event.get('id')}: {exc}")
    return {
        "ok": True,
        "sport": sport,
        "date": date_iso,
        "games": len(events),
        "picks": picks,
        "errors": errors,
        "method": "ESPN schedule, rosters, gamelogs, team context, and injuries",
    }
