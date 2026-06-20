"""ESPN-backed NBA and WNBA player-props projections."""

from __future__ import annotations

import math
import statistics
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from .schema import (
    american_implied_probability,
    build_pick,
    nearest_half,
    normal_probability,
    normalize_name,
    safe_float,
)
from .ml import apply_ml_to_pick, market_family_for_stat, select_top_props


BASKETBALL_STAT_DEFINITIONS = {
    "points": {"label": "Points", "components": ("points",)},
    "totalRebounds": {"label": "Rebounds", "components": ("totalRebounds",)},
    "assists": {"label": "Assists", "components": ("assists",)},
    "points_rebounds": {"label": "Points + Rebounds", "components": ("points", "totalRebounds")},
    "points_assists": {"label": "Points + Assists", "components": ("points", "assists")},
    "points_rebounds_assists": {
        "label": "Points + Rebounds + Assists",
        "components": ("points", "totalRebounds", "assists"),
    },
    "three_pointers_made": {"label": "3-Point Field Goals", "components": ("three_pointers_made",)},
    "steals": {"label": "Steals", "components": ("steals",)},
    "blocks": {"label": "Blocks", "components": ("blocks",)},
    "steals_blocks": {"label": "Steals + Blocks", "components": ("steals", "blocks")},
}
OUT_STATUSES = {"out", "doubtful", "injured reserve", "suspension"}

STAT_LABELS = {
    key: str(definition["label"])
    for key, definition in BASKETBALL_STAT_DEFINITIONS.items()
}

BASKETBALL_GAMELOG_ALIASES = {
    "min": "minutes",
    "minutes": "minutes",
    "pts": "points",
    "points": "points",
    "reb": "totalRebounds",
    "rebounds": "totalRebounds",
    "totalrebounds": "totalRebounds",
    "ast": "assists",
    "assists": "assists",
    "3pm": "three_pointers_made",
    "fg3m": "three_pointers_made",
    "threepointfieldgoalsmade": "three_pointers_made",
    "threepointfieldgoals": "three_pointers_made",
    "stl": "steals",
    "steals": "steals",
    "blk": "blocks",
    "blocks": "blocks",
}

BASKETBALL_MARKET_TYPES = {
    "points": ("points", "Points"),
    "playerpoints": ("points", "Points"),
    "totalpoints": ("points", "Points"),
    "pointsmilestones": ("points", "Points"),
    "rebounds": ("totalRebounds", "Rebounds"),
    "playerrebounds": ("totalRebounds", "Rebounds"),
    "totalrebounds": ("totalRebounds", "Rebounds"),
    "reboundsmilestones": ("totalRebounds", "Rebounds"),
    "assists": ("assists", "Assists"),
    "playerassists": ("assists", "Assists"),
    "totalassists": ("assists", "Assists"),
    "assistsmilestones": ("assists", "Assists"),
    "pointsrebounds": ("points_rebounds", "Points + Rebounds"),
    "pointstotalrebounds": ("points_rebounds", "Points + Rebounds"),
    "pointsreboundsmilestones": ("points_rebounds", "Points + Rebounds"),
    "pointsassists": ("points_assists", "Points + Assists"),
    "pointsassistsmilestones": ("points_assists", "Points + Assists"),
    "pointsassistsrebounds": ("points_rebounds_assists", "Points + Rebounds + Assists"),
    "pointsreboundsassists": ("points_rebounds_assists", "Points + Rebounds + Assists"),
    "pramilestones": ("points_rebounds_assists", "Points + Rebounds + Assists"),
    "threepointfieldgoals": ("three_pointers_made", "3-Point Field Goals"),
    "threepointfieldgoalsmade": ("three_pointers_made", "3-Point Field Goals"),
    "threepointsmade": ("three_pointers_made", "3-Point Field Goals"),
    "3pointfieldgoals": ("three_pointers_made", "3-Point Field Goals"),
    "3ptfieldgoals": ("three_pointers_made", "3-Point Field Goals"),
    "3pm": ("three_pointers_made", "3-Point Field Goals"),
    "steals": ("steals", "Steals"),
    "totalsteals": ("steals", "Steals"),
    "stealsmilestones": ("steals", "Steals"),
    "blocks": ("blocks", "Blocks"),
    "totalblocks": ("blocks", "Blocks"),
    "blocksmilestones": ("blocks", "Blocks"),
    "stealsblocks": ("steals_blocks", "Steals + Blocks"),
    "stocks": ("steals_blocks", "Steals + Blocks"),
    "stealsblocksmilestones": ("steals_blocks", "Steals + Blocks"),
}


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


def _american_odds(value: Any) -> int | None:
    text = str(value or "").strip().replace("+", "")
    if not text:
        return None
    try:
        odds = int(float(text))
    except (TypeError, ValueError):
        return None
    return odds if odds else None


def _athlete_ref_id(row: dict[str, Any]) -> str:
    ref = str((row.get("athlete") or {}).get("$ref") or "").split("?", 1)[0].rstrip("/")
    return ref.rsplit("/", 1)[-1] if "/athletes/" in ref else ""


def _event_market_provider(event: dict[str, Any]) -> tuple[str, str] | None:
    event_id = str(event.get("id") or "").strip()
    competition = (event.get("competitions") or [{}])[0]
    odds_rows = competition.get("odds") or []
    odds = odds_rows[0] if odds_rows else {}
    provider = odds.get("provider") or {}
    provider_id = str(provider.get("id") or "100").strip() or "100"
    provider_name = str(provider.get("displayName") or provider.get("name") or "DraftKings").strip()
    if not event_id:
        return None
    return provider_id, f"{provider_name} via ESPN"


def _target_value(row: dict[str, Any]) -> tuple[float, str]:
    current = row.get("current") or {}
    target = current.get("target") or {}
    odds = row.get("odds") or {}
    total = odds.get("total") or {}
    raw_value = target.get("value") if target.get("value") is not None else total.get("value")
    display = str(target.get("displayValue") or total.get("value") or raw_value or "").strip()
    return safe_float(str(raw_value).replace("+", "")), display


def _canonical_market_name(value: str) -> str:
    return "".join(ch for ch in str(value or "").lower() if ch.isalnum())


def _is_milestone_market(type_name: str, display: str) -> bool:
    return "milestone" in str(type_name or "").lower() or "+" in str(display or "")


def _basketball_market_index(
    client: Any,
    league: str,
    event: dict[str, Any],
) -> dict[str, dict[str, list[dict[str, Any]]]]:
    market_method = getattr(client, "basketball_espn_prop_bets", None)
    provider = _event_market_provider(event)
    if not callable(market_method) or provider is None:
        return {}
    provider_id, source = provider
    try:
        payload = market_method(league, str(event.get("id") or ""), provider_id)
    except Exception:
        return {}

    grouped: dict[tuple[str, str, float, str], list[dict[str, Any]]] = defaultdict(list)
    markets: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
    for row in payload.get("items") or []:
        type_name = str((row.get("type") or {}).get("name") or "")
        market_type = BASKETBALL_MARKET_TYPES.get(_canonical_market_name(type_name))
        if not market_type:
            continue
        athlete_id = _athlete_ref_id(row)
        if not athlete_id:
            continue
        threshold, display = _target_value(row)
        odds = _american_odds((((row.get("odds") or {}).get("american") or {}).get("value")))
        if threshold <= 0 or odds is None:
            continue
        stat_key, stat_label = market_type
        if _is_milestone_market(type_name, display):
            markets[athlete_id][stat_key].append(
                {
                    "stat_key": stat_key,
                    "stat_label": stat_label,
                    "market_athlete_id": athlete_id,
                    "line": max(0.0, threshold - 0.5),
                    "threshold": threshold,
                    "display": display or f"{threshold:g}+",
                    "over_odds": odds,
                    "market_type": type_name,
                    "market_source": source,
                    "market_updated_at": str(row.get("lastUpdated") or ""),
                    "market_format": "milestone",
                }
            )
            continue
        grouped[(athlete_id, stat_key, threshold, type_name)].append(row)

    for (athlete_id, stat_key, line, type_name), sides in grouped.items():
        if len(sides) < 2:
            continue
        market_type = BASKETBALL_MARKET_TYPES.get(_canonical_market_name(type_name))
        if not market_type:
            continue
        _, stat_label = market_type
        over_odds = _american_odds((((sides[0].get("odds") or {}).get("american") or {}).get("value")))
        under_odds = _american_odds((((sides[1].get("odds") or {}).get("american") or {}).get("value")))
        if over_odds is None or under_odds is None:
            continue
        markets[athlete_id][stat_key].append(
            {
                "stat_key": stat_key,
                "stat_label": stat_label,
                "market_athlete_id": athlete_id,
                "line": line,
                "display": f"{line:g}",
                "over_odds": over_odds,
                "under_odds": under_odds,
                "market_type": type_name,
                "market_source": source,
                "market_updated_at": str(sides[0].get("lastUpdated") or ""),
                "market_format": "total",
            }
        )
    return {player_id: dict(by_stat) for player_id, by_stat in markets.items()}


def _best_basketball_market(
    markets: list[dict[str, Any]],
    projection: float,
    sigma: float,
) -> dict[str, Any] | None:
    best: dict[str, Any] | None = None
    best_key: tuple[float, float, float, str] | None = None
    for market in markets:
        line = safe_float(market.get("line"))
        over_odds = _american_odds(market.get("over_odds") or market.get("odds"))
        if line < 0 or over_odds is None:
            continue
        over_probability = normal_probability(projection, line, sigma, "Over")
        choices = [("Over", over_probability, over_odds)]
        under_odds = _american_odds(market.get("under_odds"))
        if under_odds is not None:
            choices.append(("Under", 1.0 - over_probability, under_odds))
        for selection, probability, odds in choices:
            implied = american_implied_probability(odds)
            if implied is None:
                continue
            key = (
                probability - implied,
                probability,
                -abs(projection - line),
                selection,
            )
            if best_key is None or key > best_key:
                best_key = key
                best = {
                    **market,
                    "selection": selection,
                    "probability": probability,
                    "odds": odds,
                    "market_implied_probability": implied,
                }
    return best


def _parse_gamelog(payload: dict[str, Any]) -> dict[str, Any] | None:
    raw_names = [str(value) for value in payload.get("names") or []]
    names = [
        BASKETBALL_GAMELOG_ALIASES.get(_canonical_market_name(value), str(value))
        for value in raw_names
    ]
    minimum = {"minutes", "points", "totalRebounds", "assists"}
    if not minimum.issubset(set(names)):
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
                row = {name: safe_float(values[index]) for index, name in enumerate(names)}
                for stat_key, definition in BASKETBALL_STAT_DEFINITIONS.items():
                    components = tuple(definition["components"])
                    if stat_key in row:
                        continue
                    if all(component in row for component in components):
                        row[stat_key] = sum(row[component] for component in components)
                rows.append(row)
    if not rows:
        return None

    available_stats = [
        stat_key
        for stat_key in BASKETBALL_STAT_DEFINITIONS
        if all(stat_key in row for row in rows)
    ]
    averages = {
        stat: statistics.fmean(row[stat] for row in rows)
        for stat in ("minutes", *available_stats)
    }
    recent = {
        stat: statistics.fmean(row[stat] for row in rows[:5])
        for stat in ("minutes", *available_stats)
    }
    deviations = {
        stat: statistics.pstdev([row[stat] for row in rows]) if len(rows) > 1 else max(1.0, averages[stat] * 0.25)
        for stat in available_stats
    }
    return {
        "games": len(rows),
        "average": averages,
        "recent": recent,
        "deviation": deviations,
        "available_stats": available_stats,
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
    market_index = _basketball_market_index(client, league, event)

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

    candidates: list[dict[str, Any]] = []
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
            available_stats = set(player.get("available_stats") or player["average"].keys())
            for stat_key, stat_label in STAT_LABELS.items():
                if stat_key not in available_stats:
                    continue
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
                    redistribution = {
                        "points": 1.08,
                        "assists": 1.06,
                        "totalRebounds": 1.04,
                        "points_rebounds": 1.06,
                        "points_assists": 1.07,
                        "points_rebounds_assists": 1.065,
                        "three_pointers_made": 1.05,
                    }.get(stat_key, 1.03)
                    projection *= redistribution
                    factors.append(
                        f"Next-man-up redistribution from unavailable star(s): {', '.join(injured_stars)}"
                    )

                sigma = max(player["deviation"][stat_key], math.sqrt(max(1.0, projection)) * 0.65)
                market = _best_basketball_market(
                    (market_index.get(player["id"]) or {}).get(stat_key, []),
                    projection,
                    sigma,
                )
                if market:
                    line = safe_float(market.get("line"))
                    selection = str(market.get("selection") or "Over")
                    probability = safe_float(market.get("probability"))
                    odds = _american_odds(market.get("odds"))
                    factors = [
                        f"Posted {market['display']} {stat_label.lower()} at {int(odds):+d}",
                        *factors,
                    ]
                    reason = (
                        f"{player['name']} projects for {projection:.2f} {stat_label.lower()} versus "
                        f"a posted {market['display']} market after recent form, availability, opponent, "
                        f"and {'home' if side == 'home' else 'road'} context."
                    )
                    extra_pricing = {
                        "pricing_type": "market",
                        "line_source": "posted_market",
                        "odds_source": "posted_market",
                        "market_priced": True,
                        "actionability": "market_priced",
                        "market_source": market.get("market_source"),
                        "market_athlete_id": market.get("market_athlete_id"),
                        "market_over_odds": market.get("over_odds"),
                        "market_under_odds": market.get("under_odds"),
                        "market_type": market.get("market_type"),
                        "market_format": market.get("market_format"),
                        "market_updated_at": market.get("market_updated_at"),
                        "market_threshold": market.get("display"),
                    }
                else:
                    line = nearest_half(season_avg)
                    selection = "Over" if projection >= line else "Under"
                    probability = normal_probability(projection, line, sigma, selection)
                    odds = -110
                    reason = (
                        f"{player['name']} projects for {projection:.2f} {stat_label.lower()} versus "
                        f"an in-house {line:.1f} baseline after recent form, availability, opponent, "
                        f"and {'home' if side == 'home' else 'road'} context."
                    )
                    extra_pricing = {
                        "pricing_type": "synthetic",
                        "line_source": "in_house_baseline",
                        "odds_source": "default_assumed",
                        "market_priced": False,
                        "actionability": "research_signal",
                    }
                baseline_probability = probability
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
                    odds=odds,
                    reason=reason,
                    key_factors=factors,
                    extra={
                        "game_id": str(event.get("id") or ""),
                        "player_id": player["id"],
                        "sample_games": player["games"],
                        "injury_status": str(injury.get("status") or "Healthy"),
                        "redistribution_from": injured_stars,
                        **extra_pricing,
                    },
                )
                apply_ml_to_pick(
                    pick,
                    baseline_probability=baseline_probability,
                    baseline_projection=projection,
                    market_family=market_family_for_stat(stat_key),
                )
                candidates.append(pick)

    market_candidates = [row for row in candidates if row.get("market_priced") is True]
    selection_pool = market_candidates or candidates
    return select_top_props(selection_pool)


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
