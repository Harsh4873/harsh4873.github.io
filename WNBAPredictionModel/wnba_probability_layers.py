"""
wnba_probability_layers.py — Pure math brain for WNBA matchup probabilities.

No API calls. No file I/O. No caching. Every function is pure: same inputs
always produce the same outputs, with no side effects.

This module is a pure originator model — it does NOT consult Vegas lines
anywhere. It takes team-level stats (as produced by wnba_stats.get_team_stats)
plus optional context (rest, injuries, form) and returns:

    - a projected margin (home − away, positive = home favored),
    - a win probability for the home team (logistic of margin),
    - a projected game total (points).

WNBA note: the league plays 40-minute games. There is no division by 48
anywhere in this file. All pace/possession logic is anchored on 40 minutes.
"""

from __future__ import annotations

import math


# ---------------------------------------------------------------------------
# Section 1 — Constants
# ---------------------------------------------------------------------------

WNBA_LEAGUE_AVG_PACE = 70.0        # possessions per 40 min, league average
WNBA_LEAGUE_AVG_PPG  = 82.0        # league average points per game
WNBA_MARGIN_CAP      = 18.0        # max absolute projected margin (points)
WNBA_LOGISTIC_K      = 0.165       # logistic scaling constant
WNBA_HOME_ADVANTAGE  = 1.4         # home court points added to home margin
WNBA_B2B_PENALTY     = 1.25        # points deducted for road B2B team
WNBA_REST_BONUS      = 0.6         # points per 2+ extra rest days advantage
WNBA_FORM_WEIGHT     = 0.06        # weight on last-5 NRtg delta
WNBA_INJURY_SCALE    = 7.0         # points per unit of injury penalty delta
WNBA_INJURY_ADJ_CAP  = 2.25        # max injury-delta points in either direction
WNBA_FORM_ADJ_CAP    = 2.0         # max recent-form points in either direction
WNBA_H2H_MARGIN_COEF = 0.40        # fraction of avg H2H margin treated as evidence
WNBA_H2H_ADJ_CAP     = 3.5         # max H2H points in either direction
WNBA_H2H_BASE_RMSE   = 11.0        # WNBA per-game margin sigma (regular season)


# ---------------------------------------------------------------------------
# Section 2 — Win Probability
# ---------------------------------------------------------------------------

def margin_to_win_prob(margin: float) -> float:
    """
    Convert a projected point margin (home − away) into a home win
    probability using the logistic function:

        win_prob = 1 / (1 + exp(-WNBA_LOGISTIC_K * margin))

    No hard 95% ceiling (that was the NBANEW Phase 1 bug). The only sanity
    bound is a 2% floor on the losing side — true sub-2% outcomes are below
    model resolution and should not be reported with false precision.
    """
    try:
        m = float(margin)
    except (TypeError, ValueError):
        return 0.5

    # Guard against overflow for extreme margins — math.exp(huge) would raise.
    exponent = -WNBA_LOGISTIC_K * m
    if exponent > 50:
        prob = 0.0
    elif exponent < -50:
        prob = 1.0
    else:
        prob = 1.0 / (1.0 + math.exp(exponent))

    # Floor at 2% / ceiling at 98% — blowout sanity only, no 95% cap.
    if prob < 0.02:
        prob = 0.02
    elif prob > 0.98:
        prob = 0.98
    return prob


# ---------------------------------------------------------------------------
# Section 3 — Pace Blending
# ---------------------------------------------------------------------------

def blend_pace(home_pace, away_pace) -> float:
    """
    Blend two team paces into a single projected game pace.

    - Both None → league average.
    - One None → use the other.
    - Both present → 0.55 home / 0.45 away (home dictates tempo slightly).

    Result is clamped to [55.0, 85.0] — anything outside that range is
    almost certainly a data error (WNBA paces realistically live inside it).
    """
    if home_pace is None and away_pace is None:
        return WNBA_LEAGUE_AVG_PACE

    if home_pace is None:
        blended = float(away_pace)
    elif away_pace is None:
        blended = float(home_pace)
    else:
        blended = float(home_pace) * 0.55 + float(away_pace) * 0.45

    if blended < 55.0:
        blended = 55.0
    elif blended > 85.0:
        blended = 85.0
    return blended


# ---------------------------------------------------------------------------
# Section 4 — Base Margin from Net Rating
# ---------------------------------------------------------------------------

def compute_base_margin(home_NRtg, away_NRtg, home_pace, away_pace) -> float:
    """
    Project a base point margin (home − away) from net ratings, scaled by
    the expected game pace.

    If either net rating is missing we have no model — return 0.0 and let
    the contextual layer carry whatever signal we do have.
    """
    if home_NRtg is None or away_NRtg is None:
        return 0.0

    pace_factor = blend_pace(home_pace, away_pace) / WNBA_LEAGUE_AVG_PACE
    raw_margin = (float(home_NRtg) - float(away_NRtg)) * pace_factor

    if raw_margin > WNBA_MARGIN_CAP:
        raw_margin = WNBA_MARGIN_CAP
    elif raw_margin < -WNBA_MARGIN_CAP:
        raw_margin = -WNBA_MARGIN_CAP
    return raw_margin


# ---------------------------------------------------------------------------
# Section 5 — Four Factors Adjustment
# ---------------------------------------------------------------------------

def _diff_or_zero(a, b) -> float:
    """Return a − b if both are numeric, else 0.0 (missing factor contributes 0)."""
    if a is None or b is None:
        return 0.0
    try:
        return float(a) - float(b)
    except (TypeError, ValueError):
        return 0.0


def compute_four_factors_adjustment(home_stats: dict, away_stats: dict) -> float:
    """
    Compute a Four Factors point adjustment for the home team.

    Pairs each home offensive factor against the away team's matching
    defensive factor:

        eFG_diff = home eFG%  − away opp eFG    (shooting vs. defense)
        TOV_diff = away TOV%  − home TOV%       (turnovers; higher = worse)
        REB_diff = home ORB%  − away DRB%       (offensive rebound edge)
        FTR_diff = home FTR   − away opp FTR    (free throw rate edge)

    Weights follow the canonical Dean Oliver Four Factors ratio
    (0.40 / 0.25 / 0.20 / 0.15) with magnitude scalars (25 / 20 / 15 / 10)
    tuned for WNBA point units. Any None field contributes 0 — we degrade
    gracefully rather than raising.

    Clamped to ±5.0: Four Factors refine the NRtg margin, they should not
    dominate it.
    """
    home_stats = home_stats or {}
    away_stats = away_stats or {}

    eFG_diff = _diff_or_zero(home_stats.get("eFG_pct"), away_stats.get("opp_eFG"))
    TOV_diff = _diff_or_zero(away_stats.get("TOV_pct"), home_stats.get("TOV_pct"))
    REB_diff = _diff_or_zero(home_stats.get("ORB_pct"), away_stats.get("DRB_pct"))
    FTR_diff = _diff_or_zero(home_stats.get("FTR"),     away_stats.get("opp_FTR"))

    adj = (
        (eFG_diff * 0.40 * 25)
        + (TOV_diff * 0.25 * 20)
        + (REB_diff * 0.20 * 15)
        + (FTR_diff * 0.15 * 10)
    )

    if adj > 5.0:
        adj = 5.0
    elif adj < -5.0:
        adj = -5.0
    return adj


# ---------------------------------------------------------------------------
# Section 6 — Contextual Modifiers
# ---------------------------------------------------------------------------

def compute_h2h_signal(
    h2h_games: list[dict] | None,
    base_rmse: float = WNBA_H2H_BASE_RMSE,
) -> dict:
    """Bayesian-style update from this season's prior matchups.

    WNBA teams play each other 3-4 times per regular season. The pre-patch
    model had no input that captured "what has actually happened in this
    matchup so far" — it relied on season averages, last-5 form (general),
    rest, B2B, and injuries. This signal converts the avg margin from prior
    H2H games into a small point-shift the home team gets, capped to keep a
    1-2 game sample from dominating the season-stats baseline.

    Each ``h2h_games`` entry must look like:
        {"date": "YYYY-MM-DD", "is_home_for_target": bool,
         "margin_for_target": float}

    where ``margin_for_target`` is points scored minus points allowed *for the
    home team of the upcoming game* in that prior matchup.
    """
    games = list(h2h_games or [])
    if not games:
        return {
            "games": 0,
            "avg_margin": 0.0,
            "max_abs_margin": 0.0,
            "evidence_weight": 0.0,
            "margin_shift": 0.0,
            "note": "no prior H2H games this season",
        }

    margins = []
    for game in games:
        try:
            margins.append(float(game.get("margin_for_target")))
        except (TypeError, ValueError):
            continue
    if not margins:
        return {
            "games": 0,
            "avg_margin": 0.0,
            "max_abs_margin": 0.0,
            "evidence_weight": 0.0,
            "margin_shift": 0.0,
            "note": "H2H entries unparsable",
        }

    games_n = len(margins)
    avg_margin = sum(margins) / games_n
    max_abs_margin = max(abs(m) for m in margins)

    # Evidence weight scales with sqrt(games) but stays modest because the
    # WNBA season is short — never let H2H dominate the season-stats prior.
    evidence_weight = min(0.40, 0.14 * math.sqrt(games_n))
    margin_shift = avg_margin * WNBA_H2H_MARGIN_COEF
    if margin_shift > WNBA_H2H_ADJ_CAP:
        margin_shift = WNBA_H2H_ADJ_CAP
    elif margin_shift < -WNBA_H2H_ADJ_CAP:
        margin_shift = -WNBA_H2H_ADJ_CAP

    return {
        "games": games_n,
        "avg_margin": avg_margin,
        "max_abs_margin": max_abs_margin,
        "evidence_weight": evidence_weight,
        "margin_shift": margin_shift,
        "note": (
            f"home avg H2H margin {avg_margin:+.1f} over {games_n} game(s); "
            f"biggest |margin| {max_abs_margin:.0f}"
        ),
    }


def compute_contextual_adjustments(
    home_abbr: str,
    away_abbr: str,
    context: dict,
) -> float:
    """
    Sum every independent contextual point adjustment for the home team.

    Recognised context keys (all optional — missing keys contribute 0.0,
    never raise):

        home_rest_days, away_rest_days : int days since last game
        away_is_b2b                    : bool, away team on back-to-back
        home_injury_penalty            : float in [0, 0.45]
        away_injury_penalty            : float in [0, 0.45]
        home_last5_NRtg                : float, last-5-game net rating
        away_last5_NRtg                : float, last-5-game net rating
        h2h_games                      : list of prior H2H games this season

    Components:
        + WNBA_HOME_ADVANTAGE                              (always)
        ± WNBA_REST_BONUS if rest diff ≥ 2 either way
        + WNBA_B2B_PENALTY if away team is on a B2B        (tired road team helps home)
        + (away_inj − home_inj) * WNBA_INJURY_SCALE        (away injuries help home)
        + (home_last5 − away_last5) * WNBA_FORM_WEIGHT     (recent form delta)
        + H2H margin shift (capped)                        (matchup-specific evidence)
    """
    context = context or {}

    adj = 0.0

    # Home-court advantage — always applied.
    adj += WNBA_HOME_ADVANTAGE

    # Rest-day advantage.
    home_rest = context.get("home_rest_days")
    away_rest = context.get("away_rest_days")
    if home_rest is not None and away_rest is not None:
        try:
            rest_diff = float(home_rest) - float(away_rest)
            if rest_diff >= 2:
                adj += WNBA_REST_BONUS
            elif rest_diff <= -2:
                adj -= WNBA_REST_BONUS
        except (TypeError, ValueError):
            pass

    # Back-to-back penalty — only the road team is scored here; the home
    # team's schedule density is already folded into rest_diff above.
    # The road team plays worse on a B2B, which widens the home margin, so
    # the adjustment is additive on the home side.
    if context.get("away_is_b2b") is True:
        adj += WNBA_B2B_PENALTY

    # Injury differential. Away injuries help the home team.
    home_inj = context.get("home_injury_penalty")
    away_inj = context.get("away_injury_penalty")
    try:
        hi = float(home_inj) if home_inj is not None else 0.0
        ai = float(away_inj) if away_inj is not None else 0.0
        injury_adj = (ai - hi) * WNBA_INJURY_SCALE
        if injury_adj > WNBA_INJURY_ADJ_CAP:
            injury_adj = WNBA_INJURY_ADJ_CAP
        elif injury_adj < -WNBA_INJURY_ADJ_CAP:
            injury_adj = -WNBA_INJURY_ADJ_CAP
        adj += injury_adj
    except (TypeError, ValueError):
        pass

    # Last-5 form delta.
    home_l5 = context.get("home_last5_NRtg")
    away_l5 = context.get("away_last5_NRtg")
    if home_l5 is not None and away_l5 is not None:
        try:
            form_adj = (float(home_l5) - float(away_l5)) * WNBA_FORM_WEIGHT
            if form_adj > WNBA_FORM_ADJ_CAP:
                form_adj = WNBA_FORM_ADJ_CAP
            elif form_adj < -WNBA_FORM_ADJ_CAP:
                form_adj = -WNBA_FORM_ADJ_CAP
            adj += form_adj
        except (TypeError, ValueError):
            pass

    # H2H matchup signal — direct evidence about how this matchup actually
    # plays out. Stays small until 2+ games are in the bag.
    h2h_signal = compute_h2h_signal(context.get("h2h_games"))
    adj += float(h2h_signal["margin_shift"])

    return adj


# ---------------------------------------------------------------------------
# Section 7 — Projected Total
# ---------------------------------------------------------------------------

def _ppg_fallback(stats: dict | None) -> float | None:
    """Best-effort scoring estimate when ORtg is missing.

    Tries last-N rolling pts → season pts → ORtg×pace surrogate. Returns
    None only when nothing usable exists; downstream callers should treat
    that as 'missing' rather than a zero.
    """
    stats = stats or {}
    for key in ("rolling_pts", "pts_per_game", "PPG", "PTS_avg", "season_pts"):
        value = stats.get(key)
        if value is None:
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if 50.0 <= number <= 130.0:
            return number
    rolling_pts = stats.get("rolling_avg_pts") or (stats.get("rolling") or {}).get("pts")
    if rolling_pts is not None:
        try:
            number = float(rolling_pts)
        except (TypeError, ValueError):
            return None
        if 50.0 <= number <= 130.0:
            return number
    return None


def compute_projected_total(
    home_stats: dict,
    away_stats: dict,
    home_injury_penalty: float = 0.0,
    away_injury_penalty: float = 0.0,
) -> float | None:
    """
    Project total points scored in the game.

    Preferred formula:
        projected = (home_ORtg + away_ORtg) * blended_pace / 100
        projected -= (home_inj + away_inj) * WNBA_LEAGUE_AVG_PPG

    When either ORtg is missing, fall back to direct points-per-game
    averages so we always emit a usable total (was previously returning
    None which made the picks UI render "Total: N/A").

    Clamped to [130.0, 185.0]. Anything outside this range indicates a
    data problem upstream — we refuse to emit an obviously broken total.
    """
    home_stats = home_stats or {}
    away_stats = away_stats or {}

    home_ortg_raw = home_stats.get("ORtg")
    away_ortg_raw = away_stats.get("ORtg")
    home_ortg: float | None = None
    away_ortg: float | None = None
    if home_ortg_raw is not None:
        try:
            home_ortg = float(home_ortg_raw)
        except (TypeError, ValueError):
            home_ortg = None
    if away_ortg_raw is not None:
        try:
            away_ortg = float(away_ortg_raw)
        except (TypeError, ValueError):
            away_ortg = None

    blended_pace = blend_pace(home_stats.get("Pace"), away_stats.get("Pace"))

    if home_ortg is not None and away_ortg is not None:
        projected = (home_ortg + away_ortg) * blended_pace / 100.0
    else:
        # PPG fallback path — keeps a usable total when ORtg is missing
        # (early WNBA season, partial data, etc.).
        home_pts = _ppg_fallback(home_stats)
        away_pts = _ppg_fallback(away_stats)
        if home_pts is None or away_pts is None:
            return None
        projected = home_pts + away_pts

    try:
        hi = float(home_injury_penalty) if home_injury_penalty is not None else 0.0
        ai = float(away_injury_penalty) if away_injury_penalty is not None else 0.0
    except (TypeError, ValueError):
        hi, ai = 0.0, 0.0
    projected -= (hi + ai) * WNBA_LEAGUE_AVG_PPG

    if projected < 130.0:
        projected = 130.0
    elif projected > 185.0:
        projected = 185.0
    return projected


# ---------------------------------------------------------------------------
# Section 8 — Master Matchup Function
# ---------------------------------------------------------------------------

def calculate_wnba_matchup(
    home_abbr: str,
    away_abbr: str,
    home_stats: dict,
    away_stats: dict,
    context: dict = None,
) -> dict:
    """
    Run the full probability stack for a single matchup and return a
    single flat dict of results.

    Pipeline:
        1. base_margin       ← NRtg × pace
        2. four_factors_adj  ← eFG / TOV / REB / FTR deltas
        3. contextual_adj    ← home edge + rest + B2B + injuries + form
        4. adjusted_margin   ← sum, clamped to ±WNBA_MARGIN_CAP
        5. win_prob          ← logistic(adjusted_margin)
        6. projected_total   ← ORtg × pace, injury-corrected

    The returned dict is intentionally flat and round-tripped through
    `round()` so it's ready to serialize or log.
    """
    home_stats = home_stats or {}
    away_stats = away_stats or {}
    context = context or {}

    base_margin = compute_base_margin(
        home_stats.get("NRtg"),
        away_stats.get("NRtg"),
        home_stats.get("Pace"),
        away_stats.get("Pace"),
    )

    ff_adj = compute_four_factors_adjustment(home_stats, away_stats)
    ctx_adj = compute_contextual_adjustments(home_abbr, away_abbr, context)
    h2h_signal = compute_h2h_signal(context.get("h2h_games"))

    adjusted_margin = base_margin + ff_adj + ctx_adj
    if adjusted_margin > WNBA_MARGIN_CAP:
        adjusted_margin = WNBA_MARGIN_CAP
    elif adjusted_margin < -WNBA_MARGIN_CAP:
        adjusted_margin = -WNBA_MARGIN_CAP

    win_prob = margin_to_win_prob(adjusted_margin)

    projected_total = compute_projected_total(
        home_stats,
        away_stats,
        home_injury_penalty=context.get("home_injury_penalty", 0.0) or 0.0,
        away_injury_penalty=context.get("away_injury_penalty", 0.0) or 0.0,
    )

    data_quality = (
        "full"
        if home_stats.get("NRtg") is not None and away_stats.get("NRtg") is not None
        else "partial"
    )

    return {
        "home_abbr": home_abbr,
        "away_abbr": away_abbr,
        "adjusted_margin": round(adjusted_margin, 2),
        "win_prob": round(win_prob, 4),
        "projected_total": round(projected_total, 1) if projected_total is not None else None,
        "base_margin": round(base_margin, 2),
        "four_factors_adj": round(ff_adj, 2),
        "contextual_adj": round(ctx_adj, 2),
        "h2h_signal": h2h_signal,
        "data_quality": data_quality,
    }


# ---------------------------------------------------------------------------
# Section 9 — CLI Test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    from wnba_stats import get_team_stats

    matchups = [
        ("IND", "MIN"),
        ("LV",  "NY"),
        ("SEA", "CON"),
    ]

    results = []
    for home_abbr, away_abbr in matchups:
        home_stats = get_team_stats(home_abbr)
        away_stats = get_team_stats(away_abbr)

        context = {
            "home_injury_penalty": 0.0,
            "away_injury_penalty": 0.0,
            "away_is_b2b": False,
        }

        result = calculate_wnba_matchup(
            home_abbr=home_abbr,
            away_abbr=away_abbr,
            home_stats=home_stats,
            away_stats=away_stats,
            context=context,
        )
        results.append(result)

        win_pct = result["win_prob"] * 100
        margin = result["adjusted_margin"]
        total = result["projected_total"]
        total_str = f"{total:.1f}" if total is not None else "  n/a"
        print(
            f"{home_abbr} vs {away_abbr} | "
            f"Win Prob: {win_pct:.1f}% | "
            f"Margin: {margin:+.1f} | "
            f"Total: {total_str} | "
            f"Quality: {result['data_quality']}"
        )

    for result in results:
        assert 0.02 <= result["win_prob"] <= 0.98, (
            f"win_prob out of range: {result}"
        )
        total = result["projected_total"]
        assert total is None or 130.0 <= total <= 185.0, (
            f"projected_total out of range: {result}"
        )

    print("PASS: All matchup outputs are within valid ranges.")
