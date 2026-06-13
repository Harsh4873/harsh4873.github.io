"""MLB StatsAPI-backed hits and pitcher strikeouts player props."""

from __future__ import annotations

import math
from typing import Any

from .schema import build_pick, nearest_half, normal_probability, safe_float, safe_int


PARK_FACTORS = {
    19: 1.18,
    2: 1.07,
    1: 1.06,
    2602: 1.05,
    3: 1.04,
    17: 1.04,
    7: 1.03,
    22: 0.98,
    32: 0.97,
    4: 0.96,
    2680: 0.95,
    12: 0.94,
    2395: 0.92,
    2889: 0.91,
}


def _first_stat(payload: dict[str, Any]) -> dict[str, Any]:
    for group in payload.get("stats") or []:
        splits = group.get("splits") or []
        if splits:
            return splits[0].get("stat") or {}
    return {}


def _h2h(payload: dict[str, Any]) -> dict[str, Any]:
    total: dict[str, Any] = {}
    for group in payload.get("stats") or []:
        if str((group.get("type") or {}).get("displayName") or "") == "vsPlayerTotal":
            splits = group.get("splits") or []
            if splits:
                total = splits[0].get("stat") or {}
                break
    at_bats = safe_int(total.get("atBats"))
    hits = safe_int(total.get("hits"))
    return {
        "available": at_bats > 0,
        "at_bats": at_bats,
        "hits": hits,
        "average": round(hits / at_bats, 3) if at_bats else None,
    }


def _weather_factor(weather: dict[str, Any]) -> tuple[float, list[str]]:
    condition = str(weather.get("condition") or "Unknown")
    temperature = safe_float(weather.get("temp"), 72.0)
    wind = str(weather.get("wind") or "Unknown")
    lower_wind = wind.lower()
    factor = 1.0 + max(-0.025, min(0.025, (temperature - 72.0) / 600.0))
    if "out to" in lower_wind or "outward" in lower_wind:
        factor += 0.025
    elif "in from" in lower_wind or "inward" in lower_wind:
        factor -= 0.02
    return factor, [f"Weather {condition}, {temperature:.0f}F", f"Wind {wind}"]


def _game_parts(game: dict[str, Any]) -> dict[str, Any]:
    away = ((game.get("teams") or {}).get("away") or {})
    home = ((game.get("teams") or {}).get("home") or {})
    return {
        "game_pk": safe_int(game.get("gamePk")),
        "start_time": str(game.get("gameDate") or ""),
        "away_id": safe_int((away.get("team") or {}).get("id")),
        "home_id": safe_int((home.get("team") or {}).get("id")),
        "away_team": str((away.get("team") or {}).get("name") or ""),
        "home_team": str((home.get("team") or {}).get("name") or ""),
        "away_pitcher": away.get("probablePitcher") or {},
        "home_pitcher": home.get("probablePitcher") or {},
        "venue": game.get("venue") or {},
    }


def _roster_hitters(payload: dict[str, Any]) -> list[dict[str, Any]]:
    hitters: list[dict[str, Any]] = []
    for row in payload.get("roster") or []:
        if str((row.get("position") or {}).get("abbreviation") or "") == "P":
            continue
        person = row.get("person") or {}
        stats = _first_stat(person)
        at_bats = safe_int(stats.get("atBats"))
        if not person.get("id") or at_bats < 20:
            continue
        hitters.append(
            {
                "id": safe_int(person.get("id")),
                "name": str(person.get("fullName") or ""),
                "stats": stats,
            }
        )
    return hitters


def _live_lineup(feed: dict[str, Any], side: str) -> list[dict[str, Any]]:
    team_box = ((((feed.get("liveData") or {}).get("boxscore") or {}).get("teams") or {}).get(side) or {})
    players = team_box.get("players") or {}
    hitters: list[dict[str, Any]] = []
    for player_id in (team_box.get("battingOrder") or [])[:9]:
        player = players.get(f"ID{player_id}") or {}
        person = player.get("person") or {}
        stats = (player.get("seasonStats") or {}).get("batting") or {}
        if person.get("id") and safe_int(stats.get("atBats")) >= 20:
            hitters.append(
                {
                    "id": safe_int(person.get("id")),
                    "name": str(person.get("fullName") or ""),
                    "stats": stats,
                }
            )
    return hitters


def _team_strikeout_rate(hitters: list[dict[str, Any]]) -> float:
    strikeouts = sum(safe_float(player["stats"].get("strikeOuts")) for player in hitters)
    plate_appearances = sum(safe_float(player["stats"].get("plateAppearances")) for player in hitters)
    return strikeouts / plate_appearances if plate_appearances else 0.225


def _pitcher_prop(
    *,
    sport: str,
    date_iso: str,
    game: dict[str, Any],
    pitcher: dict[str, Any],
    pitcher_stats: dict[str, Any],
    team: str,
    opponent: str,
    opponent_hitters: list[dict[str, Any]],
    park_factor: float,
    weather_factor: float,
    environment_factors: list[str],
) -> dict[str, Any] | None:
    pitcher_id = safe_int(pitcher.get("id"))
    name = str(pitcher.get("fullName") or "")
    starts = safe_int(pitcher_stats.get("gamesStarted"))
    innings = safe_float(pitcher_stats.get("inningsPitched"))
    strikeouts = safe_float(pitcher_stats.get("strikeOuts"))
    if not pitcher_id or not name or starts < 2 or innings <= 0:
        return None
    k_per_start = strikeouts / starts
    opponent_k_rate = _team_strikeout_rate(opponent_hitters)
    opponent_adjustment = max(0.82, min(1.18, opponent_k_rate / 0.225))
    environment_adjustment = max(0.94, min(1.06, 2.0 - (park_factor * weather_factor)))
    projection = k_per_start * opponent_adjustment * environment_adjustment
    line = nearest_half(k_per_start)
    selection = "Over" if projection >= line else "Under"
    probability = normal_probability(projection, line, max(1.35, math.sqrt(projection) * 0.9), selection)
    factors = [
        f"Season strikeouts/start {k_per_start:.2f} across {starts} starts",
        f"Opponent lineup strikeout rate {opponent_k_rate:.1%}",
        *environment_factors,
    ]
    return build_pick(
        sport=sport,
        date_iso=date_iso,
        game_id=str(game["game_pk"]),
        away_team=game["away_team"],
        home_team=game["home_team"],
        start_time=game["start_time"],
        player_id=str(pitcher_id),
        player_name=name,
        team=team,
        opponent=opponent,
        stat_key="strikeouts",
        stat_label="Strikeouts",
        selection=selection,
        line=line,
        projection=projection,
        probability=probability,
        reason=(
            f"{name} projects for {projection:.2f} strikeouts against an opponent lineup with "
            f"a {opponent_k_rate:.1%} strikeout rate, adjusted for venue and weather."
        ),
        key_factors=factors,
        extra={"game_id": str(game["game_pk"]), "player_id": str(pitcher_id), "prop_role": "pitcher"},
    )


def _hitter_prop(
    *,
    client: Any,
    sport: str,
    date_iso: str,
    game: dict[str, Any],
    hitter: dict[str, Any],
    pitcher: dict[str, Any],
    pitcher_stats: dict[str, Any],
    team: str,
    opponent: str,
    is_home: bool,
    park_factor: float,
    weather_factor: float,
    environment_factors: list[str],
) -> dict[str, Any] | None:
    stats = hitter["stats"]
    at_bats = safe_int(stats.get("atBats"))
    hits = safe_float(stats.get("hits"))
    if at_bats < 20 or not hitter.get("id") or not hitter.get("name"):
        return None
    batting_average = hits / at_bats if at_bats else safe_float(stats.get("avg"), 0.245)
    pitcher_hits_per_9 = safe_float(pitcher_stats.get("hitsPer9Inn"), 8.4)
    pitcher_adjustment = max(0.82, min(1.20, pitcher_hits_per_9 / 8.4))
    expected_at_bats = 4.0 if is_home else 4.2
    h2h = {"available": False, "at_bats": 0, "hits": 0, "average": None}
    try:
        h2h = _h2h(client.mlb_h2h(safe_int(hitter["id"]), safe_int(pitcher.get("id"))))
    except Exception:
        pass
    h2h_adjustment = 1.0
    if h2h["available"] and h2h["at_bats"] >= 3:
        h2h_adjustment = max(
            0.85,
            min(1.15, 1.0 + ((safe_float(h2h["average"], batting_average) - batting_average) * 0.25)),
        )
    per_at_bat = max(
        0.08,
        min(0.45, batting_average * pitcher_adjustment * park_factor * weather_factor * h2h_adjustment),
    )
    projection = per_at_bat * expected_at_bats
    probability = 1.0 - ((1.0 - per_at_bat) ** expected_at_bats)
    line = 0.5
    selection = "Over"
    h2h_factor = (
        f"H2H available: {h2h['hits']}-for-{h2h['at_bats']} ({safe_float(h2h['average']):.3f})"
        if h2h["available"]
        else "H2H unavailable from MLB StatsAPI"
    )
    factors = [
        f"Season batting average {batting_average:.3f} over {at_bats} at-bats",
        f"Opposing pitcher allows {pitcher_hits_per_9:.2f} hits/9",
        h2h_factor,
        *environment_factors,
    ]
    return build_pick(
        sport=sport,
        date_iso=date_iso,
        game_id=str(game["game_pk"]),
        away_team=game["away_team"],
        home_team=game["home_team"],
        start_time=game["start_time"],
        player_id=str(hitter["id"]),
        player_name=hitter["name"],
        team=team,
        opponent=opponent,
        stat_key="hits",
        stat_label="Hits",
        selection=selection,
        line=line,
        projection=projection,
        probability=probability,
        reason=(
            f"{hitter['name']} has a modeled {probability:.1%} chance to record at least one hit "
            f"after pitcher, park, weather, wind, and H2H-availability adjustments."
        ),
        key_factors=factors,
        extra={
            "game_id": str(game["game_pk"]),
            "player_id": str(hitter["id"]),
            "prop_role": "batter",
            "h2h": h2h,
        },
    )


def _game_props(client: Any, date_iso: str, raw_game: dict[str, Any], season: int) -> list[dict[str, Any]]:
    game = _game_parts(raw_game)
    feed = client.mlb_live_feed(game["game_pk"])
    game_data = feed.get("gameData") or {}
    venue = game_data.get("venue") or game["venue"]
    venue_id = safe_int(venue.get("id"))
    venue_name = str(venue.get("name") or game["venue"].get("name") or "Unknown venue")
    park_factor = PARK_FACTORS.get(venue_id, 1.0)
    weather_factor, weather_factors = _weather_factor(game_data.get("weather") or {})
    environment_factors = [f"Venue {venue_name}, park factor {park_factor:.2f}", *weather_factors]

    hitters: dict[str, list[dict[str, Any]]] = {}
    for side, team_id in (("away", game["away_id"]), ("home", game["home_id"])):
        lineup = _live_lineup(feed, side)
        if not lineup:
            lineup = _roster_hitters(client.mlb_roster(team_id, date_iso, season))
        hitters[side] = lineup

    pitcher_stats: dict[str, dict[str, Any]] = {}
    for side in ("away", "home"):
        pitcher = game[f"{side}_pitcher"]
        pitcher_stats[side] = _first_stat(
            client.mlb_player_stats(safe_int(pitcher.get("id")), "pitching", season)
        ) if pitcher.get("id") else {}

    picks: list[dict[str, Any]] = []
    away_pitcher_prop = _pitcher_prop(
        sport="MLB",
        date_iso=date_iso,
        game=game,
        pitcher=game["away_pitcher"],
        pitcher_stats=pitcher_stats["away"],
        team=game["away_team"],
        opponent=game["home_team"],
        opponent_hitters=hitters["home"],
        park_factor=park_factor,
        weather_factor=weather_factor,
        environment_factors=environment_factors,
    )
    home_pitcher_prop = _pitcher_prop(
        sport="MLB",
        date_iso=date_iso,
        game=game,
        pitcher=game["home_pitcher"],
        pitcher_stats=pitcher_stats["home"],
        team=game["home_team"],
        opponent=game["away_team"],
        opponent_hitters=hitters["away"],
        park_factor=park_factor,
        weather_factor=weather_factor,
        environment_factors=environment_factors,
    )
    picks.extend(prop for prop in (away_pitcher_prop, home_pitcher_prop) if prop)

    hitter_candidates: list[dict[str, Any]] = []
    for side, opposing_side in (("away", "home"), ("home", "away")):
        ordered = sorted(
            hitters[side],
            key=lambda player: (
                safe_float(player["stats"].get("avg")),
                safe_float(player["stats"].get("ops")),
                safe_int(player["stats"].get("atBats")),
            ),
            reverse=True,
        )
        for hitter in ordered[:3]:
            prop = _hitter_prop(
                client=client,
                sport="MLB",
                date_iso=date_iso,
                game=game,
                hitter=hitter,
                pitcher=game[f"{opposing_side}_pitcher"],
                pitcher_stats=pitcher_stats[opposing_side],
                team=game[f"{side}_team"],
                opponent=game[f"{opposing_side}_team"],
                is_home=side == "home",
                park_factor=park_factor,
                weather_factor=weather_factor,
                environment_factors=environment_factors,
            )
            if prop:
                hitter_candidates.append(prop)
    hitter_candidates.sort(key=lambda prop: (-safe_float(prop.get("probability")), prop["id"]))
    picks.extend(hitter_candidates[: max(0, 5 - len(picks))])
    return picks[:5]


def generate_mlb_model(client: Any, date_iso: str) -> dict[str, Any]:
    """Generate 3-5 gradeable hits/strikeouts props per MLB game."""
    try:
        schedule = client.mlb_schedule(date_iso)
    except Exception as exc:
        return {"ok": False, "sport": "MLB", "date": date_iso, "games": 0, "picks": [], "errors": [str(exc)]}
    games = [
        game
        for date_group in schedule.get("dates") or []
        for game in date_group.get("games") or []
    ]
    if not games:
        return {
            "ok": True,
            "sport": "MLB",
            "date": date_iso,
            "games": 0,
            "picks": [],
            "errors": [],
            "note": "No MLB games scheduled; empty slate is healthy.",
        }

    picks: list[dict[str, Any]] = []
    errors: list[str] = []
    season = int(date_iso[:4])
    for game in games:
        try:
            picks.extend(_game_props(client, date_iso, game, season))
        except Exception as exc:
            errors.append(f"{game.get('gamePk')}: {exc}")
    return {
        "ok": True,
        "sport": "MLB",
        "date": date_iso,
        "games": len(games),
        "picks": picks,
        "errors": errors,
        "method": "MLB StatsAPI probable pitchers, lineups/rosters, season stats, H2H, venue, and weather",
    }
