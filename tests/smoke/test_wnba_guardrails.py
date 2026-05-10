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
