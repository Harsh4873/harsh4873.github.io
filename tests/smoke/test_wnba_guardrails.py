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
