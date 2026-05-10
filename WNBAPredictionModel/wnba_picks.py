"""
wnba_picks.py — Orchestrator that produces WNBA pick outputs.

This module stitches together the schedule, team stats, injury report, and
the pure probability layer into a single pipeline that emits formatted pick
lines for the existing pickgraderserver UI parser.

No network I/O of its own — every data source is reached through the
imported modules, which own their own caches and rate-limiting.
"""

from __future__ import annotations

import datetime

try:
    from .wnba_probability_layers import calculate_wnba_matchup
    from .wnba_schedule import (
        WNBAGame,
        fetch_espn_schedule,
        get_todays_wnba_games,
    )
    from .wnba_stats import (
        get_all_team_stats,
        get_h2h_history,
        get_rolling_stats,
        get_team_stats,
    )
    from .wnba_injuries import (
        get_injury_report,
        get_team_injury_penalty,
    )
except ImportError:
    from wnba_probability_layers import calculate_wnba_matchup
    from wnba_schedule import (
        WNBAGame,
        fetch_espn_schedule,
        get_todays_wnba_games,
    )
    from wnba_stats import (
        get_all_team_stats,
        get_h2h_history,
        get_rolling_stats,
        get_team_stats,
    )
    from wnba_injuries import (
        get_injury_report,
        get_team_injury_penalty,
    )


# ---------------------------------------------------------------------------
# Section 1 — Context Builder
# ---------------------------------------------------------------------------

_REST_LOOKBACK_DAYS = 7

# Per-run memo so we only fetch each past-date schedule once even when
# building contexts for many games in the same run.
_SCHEDULE_DATE_CACHE: dict[str, list[WNBAGame]] = {}


def _schedule_for_date(date_str: str) -> list[WNBAGame]:
    """Return the cached ESPN schedule for *date_str*, fetching if needed."""
    if date_str in _SCHEDULE_DATE_CACHE:
        return _SCHEDULE_DATE_CACHE[date_str]
    try:
        games = fetch_espn_schedule(date_str) or []
    except Exception:
        games = []
    _SCHEDULE_DATE_CACHE[date_str] = games
    return games


def _rest_days_for_team(team_abbr: str, game_date: str) -> int | None:
    """Days since the team's most recent completed game, or None if unknown.

    Walks backward day-by-day up to _REST_LOOKBACK_DAYS from *game_date*.
    We only count games with status == "final" — an abandoned or still-in-
    progress game shouldn't set rest clocks.
    """
    team_abbr = (team_abbr or "").strip().upper()
    if not team_abbr:
        return None

    try:
        base = datetime.date.fromisoformat(game_date)
    except (ValueError, TypeError):
        base = datetime.date.today()

    for days_back in range(1, _REST_LOOKBACK_DAYS + 1):
        past = (base - datetime.timedelta(days=days_back)).isoformat()
        for g in _schedule_for_date(past):
            if getattr(g, "status", "") != "final":
                continue
            if team_abbr in (g.home_abbr, g.away_abbr):
                return days_back
    return None


def _last5_nrtg(team_abbr: str) -> float | None:
    """Best-effort last-5-game NRtg lookup; returns None if unavailable."""
    try:
        rolling = get_rolling_stats(team_abbr, n=5)
    except Exception:
        return None
    if not isinstance(rolling, dict):
        return None
    value = rolling.get("NRtg")
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def build_game_context(game: WNBAGame) -> dict:
    """Assemble the context dict that calculate_wnba_matchup expects.

    Every field is best-effort — missing upstream data leaves the key as
    None, matching the probability layer's tolerance. This function never
    raises.
    """
    home_abbr = getattr(game, "home_abbr", "") or ""
    away_abbr = getattr(game, "away_abbr", "") or ""
    game_date = getattr(game, "date_str", "") or datetime.date.today().isoformat()

    try:
        home_rest_days = _rest_days_for_team(home_abbr, game_date)
    except Exception:
        home_rest_days = None
    try:
        away_rest_days = _rest_days_for_team(away_abbr, game_date)
    except Exception:
        away_rest_days = None

    away_is_b2b = away_rest_days == 1

    try:
        home_injury_penalty = get_team_injury_penalty(home_abbr)
    except Exception:
        home_injury_penalty = None
    try:
        away_injury_penalty = get_team_injury_penalty(away_abbr)
    except Exception:
        away_injury_penalty = None

    try:
        h2h_games = get_h2h_history(home_abbr, away_abbr, as_of_date=game_date)
    except Exception:
        h2h_games = []

    return {
        "home_rest_days": home_rest_days,
        "away_rest_days": away_rest_days,
        "away_is_b2b": away_is_b2b,
        "home_injury_penalty": home_injury_penalty,
        "away_injury_penalty": away_injury_penalty,
        "home_last5_NRtg": _last5_nrtg(home_abbr),
        "away_last5_NRtg": _last5_nrtg(away_abbr),
        "h2h_games": h2h_games,
    }


# ---------------------------------------------------------------------------
# Section 2 — Confidence Label
# ---------------------------------------------------------------------------

def get_confidence_label(win_prob: float) -> str:
    """Bucket the favored team's win probability into Low / Medium / High."""
    try:
        p = float(win_prob)
    except (TypeError, ValueError):
        return "Low"
    favorite_prob = max(p, 1.0 - p)
    if favorite_prob >= 0.72:
        return "High"
    if favorite_prob >= 0.64:
        return "Medium"
    return "Low"


# ---------------------------------------------------------------------------
# Section 3 — Pick Gate Logic
# ---------------------------------------------------------------------------

def should_generate_spread_pick(
    result: dict,
    home_stats: dict | None = None,
    away_stats: dict | None = None,
    context: dict | None = None,
) -> bool:
    """True when the projected side clears WNBA moneyline guardrails."""
    return assess_spread_edge(result, home_stats, away_stats, context)["decision"] != "PASS"


def should_generate_totals_pick(result: dict, market_total: float | None) -> bool:
    """True when our projected total differs from the market by >= 4.0."""
    if not isinstance(result, dict):
        return False
    projected = result.get("projected_total")
    if projected is None or market_total is None:
        return False
    try:
        return abs(float(projected) - float(market_total)) >= 4.0
    except (TypeError, ValueError):
        return False


def _has_rating_baseline(stats: dict | None) -> bool:
    """True when a team has the season-level rating needed for a real baseline."""
    stats = stats or {}
    return stats.get("NRtg") is not None


def _present_factor_count(stats: dict | None) -> int:
    stats = stats or {}
    return sum(1 for field in _FOUR_FACTOR_FIELDS if stats.get(field) is not None)


def _games_sample(stats: dict | None) -> int:
    """Best-effort completed-game sample from season or rolling fields."""
    stats = stats or {}
    samples: list[int] = []

    try:
        wins = stats.get("W")
        losses = stats.get("L")
        if wins is not None and losses is not None:
            samples.append(int(float(wins)) + int(float(losses)))
    except (TypeError, ValueError):
        pass

    try:
        rolling = stats.get("rolling_games_used")
        if rolling is not None:
            samples.append(int(float(rolling)))
    except (TypeError, ValueError):
        pass

    return max(samples) if samples else 0


def _favorite_probability(win_prob: float) -> float:
    return max(win_prob, 1.0 - win_prob)


def assess_spread_edge(
    result: dict,
    home_stats: dict | None = None,
    away_stats: dict | None = None,
    context: dict | None = None,
) -> dict:
    """Classify a WNBA moneyline edge as BET, LEAN, or PASS.

    WNBA early-season/preseason data can look decisive when the model only has
    home court, rest, B2B, and injury context. Those inputs are useful tie-
    breakers, not a betting thesis by themselves, so partial-baseline games are
    capped at LEAN and usually PASS unless the edge is extreme.
    """
    if not isinstance(result, dict):
        return {"decision": "PASS", "confidence_label": "Low", "reasons": ["invalid result"]}

    try:
        margin = float(result.get("adjusted_margin"))
        win_prob = float(result.get("win_prob"))
    except (TypeError, ValueError):
        return {"decision": "PASS", "confidence_label": "Low", "reasons": ["missing margin/probability"]}

    abs_margin = abs(margin)
    favorite_prob = _favorite_probability(win_prob)
    home_has_rating = _has_rating_baseline(home_stats)
    away_has_rating = _has_rating_baseline(away_stats)
    has_full_baseline = home_has_rating and away_has_rating
    min_games = min(_games_sample(home_stats), _games_sample(away_stats))
    min_factor_fields = min(_present_factor_count(home_stats), _present_factor_count(away_stats))

    reasons: list[str] = []
    if not has_full_baseline:
        reasons.append("no two-team NRtg baseline")
    if min_games and min_games < 3:
        reasons.append(f"thin completed-game sample ({min_games})")
    if min_factor_fields < 4 and not has_full_baseline:
        reasons.append("incomplete four-factor matchup data")
    if result.get("projected_total") is None:
        reasons.append("total unavailable")

    if has_full_baseline:
        if abs_margin >= 6.5 and favorite_prob >= 0.70:
            decision = "BET"
        elif abs_margin >= 4.75 and favorite_prob >= 0.64:
            decision = "LEAN"
        else:
            decision = "PASS"
    else:
        # Context-only or mostly context-only cards should not become BETs.
        if abs_margin >= 8.0 and favorite_prob >= 0.76 and min_factor_fields >= 4:
            decision = "LEAN"
            reasons.append("partial baseline capped at LEAN")
        else:
            decision = "PASS"

    label_by_decision = {
        "BET": "High",
        "LEAN": "Medium",
        "PASS": "Low",
    }
    return {
        "decision": decision,
        "confidence_label": label_by_decision[decision],
        "favorite_probability": round(favorite_prob, 4),
        "abs_margin": round(abs_margin, 2),
        "has_full_baseline": has_full_baseline,
        "min_games": min_games,
        "min_factor_fields": min_factor_fields,
        "reasons": reasons,
    }


# ---------------------------------------------------------------------------
# Section 4 — Output Formatter
# ---------------------------------------------------------------------------

def format_pick_line(
    result: dict,
    market_total: float | None = None,
    confidence_label: str | None = None,
) -> str:
    """Render a single-line pick string consumable by pickgraderserver.

    Format (must match exactly — the server UI parses it positionally):

        WNBA | {away} @ {home} | Home Win {win_pct}% | \
Proj Margin: {home} +{margin} | Total: {total} | Conf: {confidence}
    """
    home = result.get("home_abbr", "") or ""
    away = result.get("away_abbr", "") or ""

    try:
        win_prob = float(result.get("win_prob") or 0.0)
    except (TypeError, ValueError):
        win_prob = 0.0
    try:
        margin = float(result.get("adjusted_margin") or 0.0)
    except (TypeError, ValueError):
        margin = 0.0

    projected_total = result.get("projected_total")

    win_pct = round(win_prob * 100.0, 1)

    if margin >= 0:
        margin_str = f"{home} +{margin:.1f}"
    else:
        margin_str = f"{away} +{abs(margin):.1f}"

    if projected_total is None:
        total_str = "N/A"
    else:
        try:
            total_str = f"{float(projected_total):.1f}"
        except (TypeError, ValueError):
            total_str = "N/A"

    confidence = confidence_label or result.get("confidence_label") or get_confidence_label(win_prob)

    return (
        f"WNBA | {away} @ {home} | Home Win {win_pct}% | "
        f"Proj Margin: {margin_str} | Total: {total_str} | Conf: {confidence}"
    )


# ---------------------------------------------------------------------------
# Section 5 — Main Pick Generator
# ---------------------------------------------------------------------------

_FOUR_FACTOR_FIELDS = (
    "eFG_pct", "TOV_pct", "ORB_pct", "FTR",
    "opp_eFG", "opp_TOV", "DRB_pct", "opp_FTR",
)


def _has_usable_stats(stats: dict | None) -> bool:
    """A team profile is usable if it has ratings or a real factor sample."""
    if not stats:
        return False
    if stats.get("NRtg") is not None:
        return True
    return _present_factor_count(stats) >= 4


def generate_wnba_picks(
    market_totals: dict = None,
    echo: bool = True,
    date_str: str | None = None,
) -> list[dict]:
    """Produce a pick dict for every today's WNBA game that clears an edge gate.

    Returns a list of pick dicts (possibly empty). Each entry also carries a
    pre-formatted ``output_line`` so downstream consumers don't need to know
    the format string.
    """
    games = get_todays_wnba_games(date_str)
    if not games:
        if echo:
            print("[WNBA] No games today — no picks generated.")
        return []

    # Warm caches once so downstream per-team calls hit memory, not network.
    get_all_team_stats()
    get_injury_report()

    picks: list[dict] = []
    market_totals = market_totals or {}

    for game in games:
        home_abbr = game.home_abbr
        away_abbr = game.away_abbr

        home_stats = get_team_stats(home_abbr) or {}
        away_stats = get_team_stats(away_abbr) or {}

        if not _has_usable_stats(home_stats) and not _has_usable_stats(away_stats):
            if echo:
                print(
                    f"[WNBA] PASS — insufficient data for {away_abbr} @ {home_abbr}"
                )
            continue

        context = build_game_context(game)
        result = calculate_wnba_matchup(
            home_abbr, away_abbr, home_stats, away_stats, context
        )

        market_total = (
            market_totals.get(game.espn_game_id) if market_totals else None
        )

        guardrail = assess_spread_edge(result, home_stats, away_stats, context)
        result["confidence_label"] = guardrail["confidence_label"]

        spread_pick = guardrail["decision"] != "PASS"
        totals_pick = should_generate_totals_pick(result, market_total)

        if not spread_pick and not totals_pick:
            if echo:
                reasons = "; ".join(guardrail["reasons"]) or "edge below threshold"
                print(
                    f"[WNBA] PASS — {reasons} for {away_abbr} @ {home_abbr}"
                )
            continue

        output_line = format_pick_line(
            result,
            market_total,
            confidence_label=guardrail["confidence_label"],
        )
        pick = {
            "league": "WNBA",
            "home": home_abbr,
            "away": away_abbr,
            "win_prob": result["win_prob"],
            "adjusted_margin": result["adjusted_margin"],
            "projected_total": result["projected_total"],
            "market_total": market_total,
            "spread_pick": spread_pick,
            "totals_pick": totals_pick,
            "decision": guardrail["decision"],
            "confidence": guardrail["confidence_label"],
            "guardrail_reasons": guardrail["reasons"],
            "data_quality": result["data_quality"],
            "output_line": output_line,
        }
        picks.append(pick)
        if echo:
            print(output_line)

    return picks


# ---------------------------------------------------------------------------
# Section 6 — CLI Test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    picks = generate_wnba_picks()

    if not picks:
        # Off-season path: synthesize guardrail scenarios so we can still
        # exercise the full formatter + gate stack without live games.
        print("[WNBA] Off-season test: running synthetic guardrail checks.")

        home_stats = {"NRtg": 8.0, "ORtg": 108.0, "DRtg": 100.0, "Pace": 70.0, "W": 8, "L": 3}
        away_stats = {"NRtg": -2.0, "ORtg": 101.0, "DRtg": 103.0, "Pace": 69.0, "W": 4, "L": 7}

        synthetic_context = {
            "home_injury_penalty": 0.0,
            "away_injury_penalty": 0.26,  # Collier (MIN) ruled Out
            "away_is_b2b": True,          # MIN on road B2B
        }

        synthetic_result = calculate_wnba_matchup(
            home_abbr="IND",
            away_abbr="MIN",
            home_stats=home_stats,
            away_stats=away_stats,
            context=synthetic_context,
        )

        print(format_pick_line(synthetic_result))

        assert should_generate_spread_pick(synthetic_result, home_stats, away_stats, synthetic_context), (
            "Synthetic IND vs MIN pick should fire only when a real two-team "
            "ratings baseline supports the context stack.\n"
            f"  result={synthetic_result}"
        )

    print("PASS: Pick generator working correctly.")
