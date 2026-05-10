from __future__ import annotations


def test_wnba_context_only_edge_is_passed():
    from WNBAPredictionModel.wnba_picks import assess_spread_edge
    from WNBAPredictionModel.wnba_probability_layers import calculate_wnba_matchup

    partial_home = {
        "eFG_pct": 0.56,
        "TOV_pct": 0.12,
        "FTR": 0.30,
    }
    partial_away = {
        "eFG_pct": 0.42,
        "TOV_pct": 0.18,
        "FTR": 0.19,
    }
    context = {
        "home_rest_days": 7,
        "away_rest_days": 1,
        "away_is_b2b": True,
        "home_injury_penalty": 0.0,
        "away_injury_penalty": 0.45,
    }

    result = calculate_wnba_matchup("WAS", "NY", partial_home, partial_away, context)
    guardrail = assess_spread_edge(result, partial_home, partial_away, context)

    assert result["data_quality"] == "partial"
    assert guardrail["decision"] == "PASS"
    assert "no two-team NRtg baseline" in guardrail["reasons"]


def test_wnba_full_baseline_can_emit_bet():
    from WNBAPredictionModel.wnba_picks import assess_spread_edge
    from WNBAPredictionModel.wnba_probability_layers import calculate_wnba_matchup

    home = {"NRtg": 8.0, "ORtg": 108.0, "DRtg": 100.0, "Pace": 70.0, "W": 8, "L": 3}
    away = {"NRtg": -2.0, "ORtg": 101.0, "DRtg": 103.0, "Pace": 69.0, "W": 4, "L": 7}
    context = {
        "home_rest_days": 3,
        "away_rest_days": 1,
        "away_is_b2b": False,
        "home_injury_penalty": 0.0,
        "away_injury_penalty": 0.1,
    }

    result = calculate_wnba_matchup("IND", "MIN", home, away, context)
    guardrail = assess_spread_edge(result, home, away, context)

    assert result["data_quality"] == "full"
    assert guardrail["decision"] == "BET"
    assert guardrail["confidence_label"] == "High"


def test_wnba_away_favorite_confidence_uses_favorite_side():
    from WNBAPredictionModel.wnba_picks import get_confidence_label

    assert get_confidence_label(0.25) == "High"
    assert get_confidence_label(0.36) == "Medium"


def test_wnba_h2h_signal_with_two_blowout_wins():
    """Two prior H2H games where the home team won by 14 each should
    produce a positive H2H margin shift (capped) and non-zero evidence
    weight that nudges the predicted margin up without dominating it."""
    from WNBAPredictionModel.wnba_probability_layers import (
        compute_h2h_signal,
        WNBA_H2H_ADJ_CAP,
    )

    games = [
        {"date": "2026-05-20", "is_home_for_target": True, "margin_for_target": 14.0},
        {"date": "2026-06-04", "is_home_for_target": False, "margin_for_target": 14.0},
    ]
    signal = compute_h2h_signal(games)

    assert signal["games"] == 2
    assert signal["avg_margin"] == 14.0
    # 14 * 0.40 = 5.6, but capped at WNBA_H2H_ADJ_CAP (3.5).
    assert 0.0 < signal["margin_shift"] <= WNBA_H2H_ADJ_CAP
    # Evidence weight scales with sqrt(games); 2 games -> ~0.198.
    assert 0.15 < signal["evidence_weight"] < 0.25


def test_wnba_h2h_signal_empty_returns_no_shift():
    from WNBAPredictionModel.wnba_probability_layers import compute_h2h_signal

    signal = compute_h2h_signal([])
    assert signal["games"] == 0
    assert signal["margin_shift"] == 0.0
    assert signal["evidence_weight"] == 0.0


def test_wnba_units_scale_with_conviction():
    """Higher projected margins and stronger probabilities should produce
    materially larger stake recommendations than borderline picks."""
    from WNBAPredictionModel.wnba_picks import assess_spread_edge

    home = {"NRtg": 8.0, "ORtg": 108.0, "DRtg": 100.0, "Pace": 70.0, "W": 8, "L": 3}
    away = {"NRtg": -2.0, "ORtg": 101.0, "DRtg": 103.0, "Pace": 69.0, "W": 4, "L": 7}
    base_ctx = {
        "home_rest_days": 3,
        "away_rest_days": 1,
        "away_is_b2b": False,
        "home_injury_penalty": 0.0,
        "away_injury_penalty": 0.1,
    }

    big = assess_spread_edge(
        {"adjusted_margin": 11.0, "win_prob": 0.78, "projected_total": 162.0,
         "h2h_signal": {"games": 2}},
        home, away, base_ctx,
    )
    small = assess_spread_edge(
        {"adjusted_margin": 5.0, "win_prob": 0.66, "projected_total": 162.0,
         "h2h_signal": {"games": 0}},
        home, away, base_ctx,
    )
    pass_pick = assess_spread_edge(
        {"adjusted_margin": 1.0, "win_prob": 0.54, "projected_total": 162.0,
         "h2h_signal": {"games": 0}},
        home, away, base_ctx,
    )

    assert big["decision"] == "BET"
    assert small["decision"] == "LEAN"
    assert pass_pick["decision"] == "PASS"
    assert big["units"] > small["units"] > 0.0
    assert pass_pick["units"] == 0.0
    # Stakes stay inside the [0.25, 1.75] envelope.
    assert 0.25 <= big["units"] <= 1.75
    assert 0.25 <= small["units"] <= 1.75


def test_wnba_total_falls_back_to_ppg_when_ortg_missing():
    """When ORtg is unavailable but rolling_pts / pts_per_game exist, the
    projected total should still be emitted instead of None."""
    from WNBAPredictionModel.wnba_probability_layers import compute_projected_total

    home = {"Pace": 72.0, "rolling_pts": 84.0}
    away = {"Pace": 70.0, "pts_per_game": 78.5}
    total = compute_projected_total(home, away)
    assert total is not None
    assert 130.0 <= total <= 185.0


def test_wnba_market_vig_removal_and_kelly():
    """Vig-removed two-sided ML should sum to 1.0; Kelly stake scales
    with edge and decimal odds."""
    from WNBAPredictionModel.wnba_market import (
        american_to_implied,
        remove_vig,
        quarter_kelly_units,
    )

    # -120 / +110 → raw 0.5455 + 0.4762 = 1.0217; vig-removed sums to 1.0.
    h, a = remove_vig(-120, 110)
    assert abs((h + a) - 1.0) < 1e-9
    assert h > a  # favorite > dog

    # -110 ≈ 52.4% raw implied
    assert abs(american_to_implied(-110) - 0.5238) < 1e-3
    # +200 ≈ 33.3%
    assert abs(american_to_implied(200) - 0.3333) < 1e-3

    # Quarter-Kelly: 5% edge at +100 (b=1) → 0.05/1/4 = 0.0125u → rounds to 0.01
    assert quarter_kelly_units(0.05, 100) == 0.01
    # 10% edge at -110 (b≈0.909) → 0.10/0.909/4 ≈ 0.0275 → rounds to 0.03
    units = quarter_kelly_units(0.10, -110)
    assert 0.02 < units < 0.05
    # Negative edge always returns 0u.
    assert quarter_kelly_units(-0.05, -110) == 0.0


def test_wnba_compute_edge_uses_market_prob_for_pick_side():
    """compute_edge_units should hand back the market price for the picked
    side and the difference vs the model probability for that side."""
    from WNBAPredictionModel.wnba_market import (
        EdgeAssessment,
        MarketOdds,
        compute_edge_units,
    )

    market = MarketOdds(
        home_team_nickname="Mystics",
        away_team_nickname="Liberty",
        home_ml=140,
        away_ml=-160,
        spread_home=3.5,
        spread_away=-3.5,
        total_line=158.5,
        fetched_at="2026-06-15T18:00:00Z",
    )
    # Model thinks home is 50%; market says home is ~42% (vig-removed).
    # Edge for home pick = +0.08
    home = compute_edge_units(True, 0.50, market)
    assert home.market_pick_odds == 140
    assert home.market_pick_prob is not None and home.market_pick_prob < 0.50
    assert home.edge is not None and home.edge > 0.05
    assert home.kelly_units is not None and home.kelly_units > 0

    # Picking the away team at 50% model prob — market says away ~58%, so edge
    # is negative, Kelly units = 0.
    away = compute_edge_units(False, 0.50, market)
    assert away.edge is not None and away.edge < 0
    assert away.kelly_units == 0.0


def test_wnba_decision_uses_real_edge_when_market_present():
    """When SportsLine odds are available, BET requires real 3% market
    edge; without them, the older internal-only thresholds apply."""
    from WNBAPredictionModel.wnba_market import EdgeAssessment
    from WNBAPredictionModel.wnba_picks import assess_spread_edge

    home = {"NRtg": 8.0, "ORtg": 108.0, "DRtg": 100.0, "Pace": 70.0, "W": 8, "L": 3}
    away = {"NRtg": -2.0, "ORtg": 101.0, "DRtg": 103.0, "Pace": 69.0, "W": 4, "L": 7}
    base_ctx = {
        "home_rest_days": 3, "away_rest_days": 1, "away_is_b2b": False,
        "home_injury_penalty": 0.0, "away_injury_penalty": 0.0,
    }
    base_result = {
        "adjusted_margin": 7.0, "win_prob": 0.71, "projected_total": 162.0,
        "h2h_signal": {"games": 1},
    }

    bet_market = EdgeAssessment(market_pick_odds=-180, market_pick_prob=0.62, edge=0.07, kelly_units=0.40)
    pass_market = EdgeAssessment(market_pick_odds=-260, market_pick_prob=0.72, edge=-0.01, kelly_units=0.0)

    bet = assess_spread_edge(base_result, home, away, base_ctx, market_edge=bet_market)
    pass_pick = assess_spread_edge(base_result, home, away, base_ctx, market_edge=pass_market)

    assert bet["decision"] == "BET"
    assert bet["has_market_price"] is True
    assert bet["market_pick_odds"] == -180
    assert bet["units"] > 0.0

    # Same model output, but now market disagrees — should not be a BET
    assert pass_pick["decision"] == "PASS"
    assert pass_pick["units"] == 0.0


def test_wnba_lineup_quality_downgrades_bet_when_starter_out():
    """A BET with 1 starter Out should drop to LEAN; 2+ Out should drop
    to PASS even if the model edge is large."""
    from WNBAPredictionModel.wnba_lineup_quality import LineupQuality
    from WNBAPredictionModel.wnba_market import EdgeAssessment
    from WNBAPredictionModel.wnba_picks import assess_spread_edge

    home = {"NRtg": 8.0, "ORtg": 108.0, "DRtg": 100.0, "Pace": 70.0, "W": 8, "L": 3}
    away = {"NRtg": -2.0, "ORtg": 101.0, "DRtg": 103.0, "Pace": 69.0, "W": 4, "L": 7}
    base_ctx = {
        "home_rest_days": 3, "away_rest_days": 1, "away_is_b2b": False,
        "home_injury_penalty": 0.0, "away_injury_penalty": 0.0,
    }
    big_edge_market = EdgeAssessment(market_pick_odds=-150, market_pick_prob=0.60, edge=0.08, kelly_units=0.50)
    base_result = {
        "adjusted_margin": 8.0, "win_prob": 0.72, "projected_total": 162.0,
        "h2h_signal": {"games": 1},
    }

    one_out = LineupQuality(
        starters_total=5, starters_healthy=4,
        starters_questionable=[],
        starters_out=["Star Player"],
        minutes_restriction_penalty=0.0,
        lineup_uncertainty_penalty=0.06,
    )
    two_out = LineupQuality(
        starters_total=5, starters_healthy=3,
        starters_questionable=[],
        starters_out=["Star A", "Star B"],
        minutes_restriction_penalty=0.0,
        lineup_uncertainty_penalty=0.12,
    )

    one = assess_spread_edge(base_result, home, away, base_ctx, market_edge=big_edge_market, pick_team_lineup=one_out)
    two = assess_spread_edge(base_result, home, away, base_ctx, market_edge=big_edge_market, pick_team_lineup=two_out)

    # The big-edge BET should drop to LEAN with one star out.
    assert one["decision"] == "LEAN"
    assert any("OUT" in r for r in one["reasons"])
    # And to PASS with two starters out.
    assert two["decision"] == "PASS"
    assert two["units"] == 0.0


def test_wnba_lineup_quality_module_classifies_questionable_vs_out():
    """get_lineup_quality should tally Out vs Questionable from the injury
    report and produce both a minutes-restriction and uncertainty penalty."""
    from WNBAPredictionModel.wnba_lineup_quality import get_lineup_quality

    # Build a synthetic injury report keyed by normalized name (the way
    # wnba_injuries normalizes them).
    report = {
        "caitlin clark": {
            "team_abbr": "IND",
            "status": "Out",
            "player_name": "Caitlin Clark",
        },
    }
    quality = get_lineup_quality("IND", report)

    assert quality.starters_total >= 1
    assert "Caitlin Clark" in quality.starters_out
    assert quality.lineup_uncertainty_penalty > 0.0

    # Questionable star bumps minutes-restriction penalty, not lineup
    # uncertainty penalty.
    report_q = {
        "caitlin clark": {
            "team_abbr": "IND",
            "status": "Questionable",
            "player_name": "Caitlin Clark",
        },
    }
    quality_q = get_lineup_quality("IND", report_q)
    assert "Caitlin Clark" in quality_q.starters_questionable
    assert quality_q.minutes_restriction_penalty > 0.0
    assert quality_q.lineup_uncertainty_penalty == 0.0


def test_wnba_h2h_lifts_predicted_margin():
    """End-to-end: passing two blowout wins as h2h_games shifts the
    adjusted margin and win prob in the home team's favor compared to
    the same matchup with no H2H signal."""
    from WNBAPredictionModel.wnba_probability_layers import calculate_wnba_matchup

    home = {"NRtg": 1.0, "ORtg": 102.0, "DRtg": 101.0, "Pace": 70.0, "W": 5, "L": 5}
    away = {"NRtg": 0.0, "ORtg": 101.5, "DRtg": 101.5, "Pace": 70.0, "W": 5, "L": 5}
    base_ctx = {
        "home_rest_days": 2,
        "away_rest_days": 2,
        "away_is_b2b": False,
        "home_injury_penalty": 0.0,
        "away_injury_penalty": 0.0,
    }

    no_h2h = calculate_wnba_matchup("HOM", "AWY", home, away, base_ctx)
    with_h2h = calculate_wnba_matchup(
        "HOM",
        "AWY",
        home,
        away,
        {**base_ctx, "h2h_games": [
            {"date": "2026-05-20", "is_home_for_target": True, "margin_for_target": 12.0},
            {"date": "2026-06-04", "is_home_for_target": False, "margin_for_target": 12.0},
        ]},
    )

    assert with_h2h["adjusted_margin"] > no_h2h["adjusted_margin"]
    assert with_h2h["win_prob"] > no_h2h["win_prob"]
    assert with_h2h["h2h_signal"]["games"] == 2
