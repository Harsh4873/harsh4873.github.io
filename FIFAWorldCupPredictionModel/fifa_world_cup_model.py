"""Algorithmic FIFA World Cup moneyline and totals model.

The model intentionally does not use historical head-to-head results or a
trained estimator. It rates the current tournament squad through each
player's position, availability, current club league, and club table record,
then converts the four unit ratings into Poisson goal probabilities.
"""

from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any, Iterable

import requests


ESPN_SITE_API = "https://site.api.espn.com/apis/site/v2/sports/soccer"
ESPN_ATHLETE_API = "https://site.web.api.espn.com/apis/common/v3/sports/soccer/fifa.world/athletes"
USER_AGENT = "PickLedgerFIFAWorldCupModel/1.0"

LEAGUE_STRENGTH = {
    "eng.1": 92.0,
    "esp.1": 91.0,
    "ita.1": 89.5,
    "ger.1": 89.0,
    "fra.1": 87.5,
    "uefa.champions": 92.0,
    "bra.1": 84.0,
    "por.1": 83.5,
    "ned.1": 82.5,
    "bel.1": 79.5,
    "tur.1": 79.0,
    "arg.1": 79.0,
    "mex.1": 77.5,
    "usa.1": 76.5,
    "sco.1": 75.5,
    "ksa.1": 75.0,
    "jpn.1": 74.0,
    "aus.1": 70.5,
}
POSITION_BASELINE = {
    "goalkeeper": 72.0,
    "defender": 72.0,
    "midfielder": 73.0,
    "forward": 73.0,
}
UNIT_STARTERS = {
    "goalkeeper": 1,
    "defender": 4,
    "midfielder": 3,
    "forward": 3,
}
UNIT_WEIGHTS = {
    "goalkeeper": 0.16,
    "defender": 0.28,
    "midfielder": 0.28,
    "forward": 0.28,
}


def _number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _clamp(value: float, low: float, high: float) -> float:
    return min(high, max(low, value))


def _american_implied(odds: Any) -> float | None:
    value = _number(odds)
    if value is None or value == 0:
        return None
    return 100.0 / (value + 100.0) if value > 0 else abs(value) / (abs(value) + 100.0)


def _american_odds(value: Any) -> int | None:
    number = _number(value)
    return int(number) if number is not None and number != 0 else None


def _position_group(value: Any) -> str:
    text = str(value or "").strip().lower()
    if "goal" in text or text in {"g", "gk"}:
        return "goalkeeper"
    if "def" in text or text in {"d", "cb", "lb", "rb"}:
        return "defender"
    if "mid" in text or text in {"m", "dm", "cm", "am"}:
        return "midfielder"
    return "forward"


def _record_stats(team: dict[str, Any]) -> dict[str, float]:
    record = team.get("record") if isinstance(team.get("record"), dict) else {}
    items = record.get("items") if isinstance(record.get("items"), list) else []
    first = items[0] if items and isinstance(items[0], dict) else {}
    stats = first.get("stats") if isinstance(first.get("stats"), list) else []
    return {
        str(stat.get("name") or ""): float(stat.get("value") or 0)
        for stat in stats
        if isinstance(stat, dict) and _number(stat.get("value")) is not None
    }


def club_power(league_slug: str, club: dict[str, Any] | None) -> float:
    """Return a current club-strength proxy on a roughly 60-96 scale."""
    base = LEAGUE_STRENGTH.get(str(league_slug or "").lower(), 70.0)
    if not isinstance(club, dict):
        return base
    stats = _record_stats(club)
    games = stats.get("gamesPlayed", 0.0)
    if games < 5:
        return base
    points = stats.get("points", (stats.get("wins", 0.0) * 3) + stats.get("ties", 0.0))
    goals_for = stats.get("pointsFor", 0.0)
    goals_against = stats.get("pointsAgainst", 0.0)
    ppg_adjustment = _clamp(((points / games) - 1.45) * 5.0, -4.0, 5.0)
    goal_adjustment = _clamp(((goals_for - goals_against) / games) * 2.0, -3.0, 3.0)
    rank = stats.get("rank", 0.0)
    rank_adjustment = _clamp(2.5 - (rank * 0.22), -2.0, 2.0) if rank else 0.0
    return _clamp(base + ppg_adjustment + goal_adjustment + rank_adjustment, 58.0, 96.0)


def _age_adjustment(age: Any, position: str) -> float:
    value = _number(age)
    if value is None:
        return 0.0
    peak_low, peak_high = (27, 33) if position == "goalkeeper" else (24, 30)
    if peak_low <= value <= peak_high:
        return 1.5
    if value < 20 or value > 36:
        return -2.0
    if value < peak_low - 2 or value > peak_high + 2:
        return -0.75
    return 0.5


def player_power(
    player: dict[str, Any],
    profile: dict[str, Any] | None,
    club: dict[str, Any] | None,
) -> dict[str, Any]:
    """Rank one current squad player from club quality and availability."""
    profile = profile if isinstance(profile, dict) else {}
    athlete = profile.get("athlete") if isinstance(profile.get("athlete"), dict) else {}
    league = profile.get("league") if isinstance(profile.get("league"), dict) else {}
    club_team = athlete.get("team") if isinstance(athlete.get("team"), dict) else {}
    position_data = player.get("position") if isinstance(player.get("position"), dict) else {}
    position = _position_group(position_data.get("name") or position_data.get("abbreviation"))
    league_slug = str(league.get("slug") or "").lower()
    base = club_power(league_slug, club)
    if not league_slug:
        base = POSITION_BASELINE[position]

    injuries = player.get("injuries") if isinstance(player.get("injuries"), list) else []
    status = player.get("status") if isinstance(player.get("status"), dict) else {}
    availability_penalty = min(10.0, len(injuries) * 5.0)
    if str(status.get("type") or "").lower() not in {"", "active"}:
        availability_penalty += 8.0

    rating = _clamp(base + _age_adjustment(player.get("age"), position) - availability_penalty, 45.0, 97.0)
    return {
        "player_id": str(player.get("id") or ""),
        "name": str(player.get("displayName") or player.get("fullName") or "Unknown"),
        "position": position,
        "rating": round(rating, 2),
        "age": player.get("age"),
        "available": availability_penalty == 0,
        "injury_count": len(injuries),
        "club": str(club_team.get("displayName") or club_team.get("name") or "Unknown"),
        "club_id": str(club_team.get("id") or ""),
        "league": str(league.get("name") or "Unknown"),
        "league_slug": league_slug,
        "profile_available": bool(league_slug and club_team.get("id")),
    }


def _weighted_unit(players: Iterable[dict[str, Any]], position: str) -> float:
    ranked = sorted(
        (player for player in players if player.get("position") == position),
        key=lambda player: float(player.get("rating") or 0),
        reverse=True,
    )
    if not ranked:
        return POSITION_BASELINE[position] - 4.0
    starter_count = UNIT_STARTERS[position]
    starters = ranked[:starter_count]
    depth = ranked[starter_count:starter_count + max(2, starter_count)]
    starter_score = sum(float(player["rating"]) for player in starters) / len(starters)
    depth_score = (
        sum(float(player["rating"]) for player in depth) / len(depth)
        if depth
        else starter_score - 4.0
    )
    return round((starter_score * 0.82) + (depth_score * 0.18), 2)


def team_power(team: dict[str, Any], players: list[dict[str, Any]]) -> dict[str, Any]:
    unit_scores = {
        position: _weighted_unit(players, position)
        for position in UNIT_STARTERS
    }
    overall = sum(unit_scores[position] * UNIT_WEIGHTS[position] for position in UNIT_WEIGHTS)
    ranked = sorted(players, key=lambda player: float(player.get("rating") or 0), reverse=True)
    top_five = ranked[:5]
    availability = sum(bool(player.get("available")) for player in players) / max(1, len(players))
    profile_coverage = sum(bool(player.get("profile_available")) for player in players) / max(1, len(players))
    position_counts = {
        position: sum(player.get("position") == position for player in players)
        for position in UNIT_STARTERS
    }
    roster_ready = (
        len(players) >= 11
        and profile_coverage >= 0.60
        and all(position_counts[position] >= UNIT_STARTERS[position] for position in UNIT_STARTERS)
    )
    return {
        "team_id": str(team.get("id") or ""),
        "team": str(team.get("displayName") or team.get("name") or "Unknown"),
        "abbreviation": str(team.get("abbreviation") or ""),
        "overall": round(overall, 2),
        "attack": round((unit_scores["forward"] * 0.72) + (unit_scores["midfielder"] * 0.28), 2),
        "midfield": unit_scores["midfielder"],
        "defense": round((unit_scores["defender"] * 0.68) + (unit_scores["midfielder"] * 0.12) + (unit_scores["goalkeeper"] * 0.20), 2),
        "goalkeeper": unit_scores["goalkeeper"],
        "availability": round(availability, 3),
        "profile_coverage": round(profile_coverage, 3),
        "position_counts": position_counts,
        "roster_ready": roster_ready,
        "players_rated": len(players),
        "top_players": [
            {
                "name": player["name"],
                "position": player["position"],
                "rating": player["rating"],
                "club": player["club"],
                "league": player["league"],
            }
            for player in top_five
        ],
        "players": ranked,
    }


def expected_goals(team: dict[str, Any], opponent: dict[str, Any]) -> float:
    attack_gap = float(team["attack"]) - float(opponent["defense"])
    overall_gap = float(team["overall"]) - float(opponent["overall"])
    availability_drag = max(0.0, 0.94 - float(team.get("availability") or 0.0)) * 2.0
    value = 1.22 * math.exp((attack_gap / 32.0) + (overall_gap / 90.0) - availability_drag)
    return round(_clamp(value, 0.25, 3.60), 3)


def poisson_probabilities(home_xg: float, away_xg: float, max_goals: int = 9) -> dict[str, float]:
    home = [math.exp(-home_xg) * (home_xg ** goals) / math.factorial(goals) for goals in range(max_goals + 1)]
    away = [math.exp(-away_xg) * (away_xg ** goals) / math.factorial(goals) for goals in range(max_goals + 1)]
    home_win = draw = away_win = 0.0
    for home_goals, home_prob in enumerate(home):
        for away_goals, away_prob in enumerate(away):
            probability = home_prob * away_prob
            if home_goals > away_goals:
                home_win += probability
            elif home_goals < away_goals:
                away_win += probability
            else:
                draw += probability
    total = home_win + draw + away_win
    return {
        "home_win": home_win / total,
        "draw": draw / total,
        "away_win": away_win / total,
    }


def total_probability(projected_total: float, line: float, side: str) -> float:
    max_goals = 14
    probabilities = [
        math.exp(-projected_total) * (projected_total ** goals) / math.factorial(goals)
        for goals in range(max_goals + 1)
    ]
    if side == "over":
        return sum(probability for goals, probability in enumerate(probabilities) if goals > line)
    return sum(probability for goals, probability in enumerate(probabilities) if goals < line)


class EspnClient:
    def __init__(self, session: requests.Session | None = None, timeout: int = 18):
        self.session = session or requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT})
        self.timeout = timeout

    def get_json(self, url: str) -> dict[str, Any]:
        response = self.session.get(url, timeout=self.timeout)
        response.raise_for_status()
        payload = response.json()
        return payload if isinstance(payload, dict) else {}

    def scoreboard(self, date_iso: str) -> dict[str, Any]:
        compact = date_iso.replace("-", "")
        return self.get_json(f"{ESPN_SITE_API}/fifa.world/scoreboard?dates={compact}&limit=100")

    def roster(self, team_id: str) -> dict[str, Any]:
        return self.get_json(f"{ESPN_SITE_API}/fifa.world/teams/{team_id}/roster")

    def athlete(self, athlete_id: str) -> dict[str, Any]:
        return self.get_json(f"{ESPN_ATHLETE_API}/{athlete_id}")

    def club(self, league_slug: str, club_id: str) -> dict[str, Any]:
        return self.get_json(f"{ESPN_SITE_API}/{league_slug}/teams/{club_id}")


def _parallel_map(items: Iterable[Any], fn, max_workers: int) -> dict[Any, Any]:
    unique = list(dict.fromkeys(items))
    results: dict[Any, Any] = {}
    if not unique:
        return results
    with ThreadPoolExecutor(max_workers=max(1, min(max_workers, len(unique)))) as executor:
        future_map = {executor.submit(fn, item): item for item in unique}
        for future in as_completed(future_map):
            item = future_map[future]
            try:
                results[item] = future.result()
            except Exception:
                results[item] = {}
    return results


def _parse_games(scoreboard: dict[str, Any]) -> list[dict[str, Any]]:
    games: list[dict[str, Any]] = []
    for event in scoreboard.get("events") if isinstance(scoreboard.get("events"), list) else []:
        competitions = event.get("competitions") if isinstance(event, dict) else []
        competition = competitions[0] if isinstance(competitions, list) and competitions else {}
        competitors = competition.get("competitors") if isinstance(competition, dict) else []
        home = next((item for item in competitors if isinstance(item, dict) and item.get("homeAway") == "home"), None)
        away = next((item for item in competitors if isinstance(item, dict) and item.get("homeAway") == "away"), None)
        if not home or not away:
            continue
        status = event.get("status") if isinstance(event.get("status"), dict) else {}
        status_type = status.get("type") if isinstance(status.get("type"), dict) else {}
        if str(status_type.get("state") or "").lower() == "post":
            continue
        games.append({
            "game_id": str(event.get("id") or ""),
            "start_time": str(event.get("date") or ""),
            "home": home.get("team") if isinstance(home.get("team"), dict) else {},
            "away": away.get("team") if isinstance(away.get("team"), dict) else {},
            "odds": (competition.get("odds") or [{}])[0] if isinstance(competition.get("odds"), list) else {},
        })
    return games


def _closed_market_value(odds: dict[str, Any], market: str, side: str, field: str = "odds") -> Any:
    market_data = odds.get(market) if isinstance(odds.get(market), dict) else {}
    side_data = market_data.get(side) if isinstance(market_data.get(side), dict) else {}
    close = side_data.get("close") if isinstance(side_data.get("close"), dict) else {}
    open_data = side_data.get("open") if isinstance(side_data.get("open"), dict) else {}
    return close.get(field) if close.get(field) not in {"", None} else open_data.get(field)


def _market_probabilities(odds: dict[str, Any]) -> dict[str, float | None]:
    raw = {
        side: _american_implied(_closed_market_value(odds, "moneyline", side))
        for side in ("home", "away", "draw")
    }
    total = sum(value for value in raw.values() if value is not None)
    if total <= 0:
        return raw
    return {
        side: (value / total if value is not None else None)
        for side, value in raw.items()
    }


def _decision(probability: float, edge: float | None, *, total: bool = False) -> str:
    if total:
        if probability >= 0.56 and (edge is None or edge >= 0.025):
            return "BET"
        if probability >= 0.52 and (edge is None or edge >= 0.0):
            return "LEAN"
        return "PASS"
    if probability >= 0.48 and (edge is None or edge >= 0.025):
        return "BET"
    if probability >= 0.40 and (edge is None or edge >= -0.01):
        return "LEAN"
    return "PASS"


def _units(probability: float, edge: float | None, decision: str) -> float:
    if decision == "PASS":
        return 0.0
    value = 0.25 + max(0.0, probability - 0.50) * 2.0 + max(0.0, edge or 0.0) * 3.0
    return round(_clamp(value, 0.25, 1.0), 2)


def _top_player_text(team: dict[str, Any]) -> str:
    return ", ".join(
        f"{player['name']} {player['rating']:.1f}"
        for player in team.get("top_players", [])[:3]
    )


def _matchup_picks(
    date_iso: str,
    game: dict[str, Any],
    home: dict[str, Any],
    away: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    home_xg = expected_goals(home, away)
    away_xg = expected_goals(away, home)
    projected_total = round(home_xg + away_xg, 2)
    probabilities = poisson_probabilities(home_xg, away_xg)
    odds = game.get("odds") if isinstance(game.get("odds"), dict) else {}
    market = _market_probabilities(odds)
    matchup = f"{away['team']} @ {home['team']}"
    common = {
        "source": "FIFA WC In-House",
        "sport": "FIFA WC",
        "league": "FIFA World Cup",
        "date": date_iso,
        "game": matchup,
        "matchup": matchup,
        "away_team": away["team"],
        "home_team": home["team"],
        "game_id": game["game_id"],
        "start_time": game["start_time"],
        "game_start_time": game["start_time"],
        "calibration_excluded": True,
        "model_basis": "current squad player power and position-unit matchup; no head-to-head input",
        "projected_home_goals": home_xg,
        "projected_away_goals": away_xg,
        "projected_total": projected_total,
        "home_unit_ratings": {key: home[key] for key in ("overall", "attack", "midfield", "defense", "goalkeeper")},
        "away_unit_ratings": {key: away[key] for key in ("overall", "attack", "midfield", "defense", "goalkeeper")},
    }

    side = "home" if probabilities["home_win"] >= probabilities["away_win"] else "away"
    selected = home if side == "home" else away
    probability = probabilities[f"{side}_win"]
    market_probability = market.get(side)
    edge = probability - market_probability if market_probability is not None else None
    ml_decision = _decision(probability, edge)
    if not home.get("roster_ready") or not away.get("roster_ready"):
        ml_decision = "PASS"
    ml_odds = _american_odds(_closed_market_value(odds, "moneyline", side))
    ml_reason = (
        f"{selected['team']} owns the stronger current-squad projection. "
        f"Attack {selected['attack']:.1f}, midfield {selected['midfield']:.1f}, "
        f"defense {selected['defense']:.1f}, goalkeeper {selected['goalkeeper']:.1f}. "
        f"Top player ranks: {_top_player_text(selected)}."
    )
    picks = [{
        **common,
        "pick": f"{selected['team']} ML ({matchup})",
        "team": selected["team"],
        "market": "moneyline",
        "market_type": "soccer_moneyline",
        "odds": ml_odds,
        "probability": round(probability, 4),
        "draw_probability": round(probabilities["draw"], 4),
        "market_probability": round(market_probability, 4) if market_probability is not None else None,
        "edge": round(edge * 100, 2) if edge is not None else None,
        "decision": ml_decision,
        "units": _units(probability, edge, ml_decision),
        "reason": ml_reason,
        "key_factors": [
            "Current World Cup roster and availability",
            "Player club-league and club-table power rankings",
            "Attack/midfield/defense/goalkeeper unit matchup",
            "No historical head-to-head input",
        ],
    }]

    line = _number(odds.get("overUnder")) or 2.5
    over_probability = total_probability(projected_total, line, "over")
    under_probability = total_probability(projected_total, line, "under")
    total_side = "over" if over_probability >= under_probability else "under"
    total_prob = over_probability if total_side == "over" else under_probability
    total_odds = _american_odds(_closed_market_value(odds, "total", total_side))
    total_market_probability = _american_implied(total_odds)
    total_edge = total_prob - total_market_probability if total_market_probability is not None else None
    total_decision = _decision(total_prob, total_edge, total=True)
    if not home.get("roster_ready") or not away.get("roster_ready"):
        total_decision = "PASS"
    picks.append({
        **common,
        "pick": f"{total_side.title()} {line:g} ({matchup})",
        "team": "",
        "market": "total",
        "market_type": "soccer_total",
        "line": line,
        "odds": total_odds,
        "probability": round(total_prob, 4),
        "market_probability": round(total_market_probability, 4) if total_market_probability is not None else None,
        "edge": round(total_edge * 100, 2) if total_edge is not None else None,
        "decision": total_decision,
        "units": _units(total_prob, total_edge, total_decision),
        "reason": (
            f"Projected goals {away['team']} {away_xg:.2f}, {home['team']} {home_xg:.2f} "
            f"from the two attacking engines against the opposing defensive units."
        ),
        "key_factors": [
            f"{away['team']} attack {away['attack']:.1f} vs {home['team']} defense {home['defense']:.1f}",
            f"{home['team']} attack {home['attack']:.1f} vs {away['team']} defense {away['defense']:.1f}",
            f"Projected total {projected_total:.2f}",
        ],
    })

    game_summary = {
        **common,
        "home_win_probability": round(probabilities["home_win"], 4),
        "draw_probability": round(probabilities["draw"], 4),
        "away_win_probability": round(probabilities["away_win"], 4),
    }
    return picks, game_summary


def generate_fifa_world_cup_picks(
    date_str: str | None = None,
    *,
    client: EspnClient | None = None,
    max_workers: int = 24,
) -> dict[str, Any]:
    """Generate a cache-ready FIFA World Cup model bucket."""
    date_iso = datetime.strptime(date_str, "%Y-%m-%d").strftime("%Y-%m-%d") if date_str else datetime.now().strftime("%Y-%m-%d")
    api = client or EspnClient()
    scoreboard = api.scoreboard(date_iso)
    games = _parse_games(scoreboard)
    if not games:
        return {
            "ok": True,
            "date": date_iso,
            "picks": [],
            "games": [],
            "team_ratings": [],
            "player_rankings": [],
            "calibration_excluded": True,
            "note": f"No FIFA World Cup games on ESPN for {date_iso}.",
        }

    teams = {
        str(team.get("id") or ""): team
        for game in games
        for team in (game["home"], game["away"])
        if str(team.get("id") or "")
    }
    rosters = _parallel_map(teams, lambda team_id: api.roster(team_id), max_workers)
    raw_players = {
        team_id: [
            player for player in (rosters.get(team_id, {}).get("athletes") or [])
            if isinstance(player, dict)
        ]
        for team_id in teams
    }
    athlete_ids = [
        str(player.get("id") or "")
        for players in raw_players.values()
        for player in players
        if str(player.get("id") or "")
    ]
    profiles = _parallel_map(athlete_ids, lambda athlete_id: api.athlete(athlete_id), max_workers)

    club_keys: list[tuple[str, str]] = []
    for profile in profiles.values():
        athlete = profile.get("athlete") if isinstance(profile.get("athlete"), dict) else {}
        club = athlete.get("team") if isinstance(athlete.get("team"), dict) else {}
        league = profile.get("league") if isinstance(profile.get("league"), dict) else {}
        league_slug = str(league.get("slug") or "").lower()
        club_id = str(club.get("id") or "")
        if league_slug and league_slug != "fifa.world" and club_id:
            club_keys.append((league_slug, club_id))
    clubs = _parallel_map(club_keys, lambda key: api.club(key[0], key[1]), max_workers)

    ratings: dict[str, dict[str, Any]] = {}
    for team_id, team in teams.items():
        players: list[dict[str, Any]] = []
        for raw_player in raw_players.get(team_id, []):
            athlete_id = str(raw_player.get("id") or "")
            profile = profiles.get(athlete_id) if athlete_id else {}
            athlete = profile.get("athlete") if isinstance(profile, dict) and isinstance(profile.get("athlete"), dict) else {}
            club_team = athlete.get("team") if isinstance(athlete.get("team"), dict) else {}
            league = profile.get("league") if isinstance(profile, dict) and isinstance(profile.get("league"), dict) else {}
            club_key = (str(league.get("slug") or "").lower(), str(club_team.get("id") or ""))
            club_payload = clubs.get(club_key) if club_key in clubs else {}
            club_data = club_payload.get("team") if isinstance(club_payload, dict) and isinstance(club_payload.get("team"), dict) else {}
            players.append(player_power(raw_player, profile, club_data))
        ratings[team_id] = team_power(team, players)

    all_players: list[dict[str, Any]] = []
    for rating in ratings.values():
        for player in rating["players"]:
            all_players.append({**player, "national_team": rating["team"]})
    all_players.sort(key=lambda player: float(player.get("rating") or 0), reverse=True)
    for index, player in enumerate(all_players, start=1):
        player["slate_rank"] = index

    picks: list[dict[str, Any]] = []
    game_summaries: list[dict[str, Any]] = []
    for game in games:
        home_id = str(game["home"].get("id") or "")
        away_id = str(game["away"].get("id") or "")
        if home_id not in ratings or away_id not in ratings:
            continue
        game_picks, summary = _matchup_picks(date_iso, game, ratings[home_id], ratings[away_id])
        picks.extend(game_picks)
        game_summaries.append(summary)

    team_ratings = sorted(ratings.values(), key=lambda team: float(team["overall"]), reverse=True)
    for index, rating in enumerate(team_ratings, start=1):
        rating["slate_rank"] = index
        rating.pop("players", None)
    return {
        "ok": True,
        "date": date_iso,
        "model": "FIFAWorldCupPlayerPower",
        "picks": picks,
        "games": game_summaries,
        "team_ratings": team_ratings,
        "player_rankings": all_players[:75],
        "calibration_excluded": True,
        "schedule_source": "ESPN FIFA World Cup scoreboard",
        "player_rating_source": "ESPN tournament rosters, player current clubs/leagues, and club table records",
        "note": (
            f"Rated {len(all_players)} current-squad players across {len(team_ratings)} teams; "
            f"generated {len(picks)} moneyline/total rows without head-to-head or trained-model inputs."
        ),
    }
