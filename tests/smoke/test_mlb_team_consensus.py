from __future__ import annotations

from copy import deepcopy

from scripts.mlb_team_consensus import (
    MLB_TEAM_CONSENSUS_VERSION,
    apply_mlb_team_consensus_to_payload,
    evaluate_mlb_team_pick,
)


GOOD_PERFORMANCE = {
    ("mlb_new", "h2h"): {"samples": 80, "wins": 48, "losses": 32, "profit": 9.2, "stake": 80.0, "roi": 0.115, "qualified": True},
    ("mlb_new", "totals"): {"samples": 80, "wins": 45, "losses": 35, "profit": 4.0, "stake": 80.0, "roi": 0.05, "qualified": True},
    ("mlb_first_five", "f5_side"): {"samples": 90, "wins": 55, "losses": 35, "profit": 6.0, "stake": 90.0, "roi": 0.067, "qualified": True},
    ("mlb_inning", "no_run_inning"): {"samples": 90, "wins": 55, "losses": 35, "profit": 6.0, "stake": 90.0, "roi": 0.067, "qualified": True},
}


def _mlb_new_pick(**overrides):
    pick = {
        "source": "MLB Model",
        "sport": "MLB",
        "pick": "Mets ML (Braves vs Mets)",
        "market_type": "h2h",
        "team": "Mets",
        "probability": 0.62,
        "calibrated_probability": 0.62,
        "raw_probability": 0.68,
        "market_pick_prob": 0.52,
        "edge": 10.0,
        "odds": -105,
        "units": 0.8,
        "decision": "BET",
        "calibration": {"applied": True, "samples": 88, "key": "model:mlb_new|bet:h2h"},
        "pregame_snapshot": {"decision": "BET", "units": 0.8, "probability": 0.68},
    }
    pick.update(overrides)
    return pick


def _f5_pick(**overrides):
    pick = {
        "source": "MLB First Five",
        "sport": "MLB",
        "date": "2026-06-25",
        "game_id": "game-1",
        "pick": "Away F5 ML",
        "market": "f5_side",
        "team": "Away",
        "away_team": "Away",
        "home_team": "Home",
        "probability": 0.61,
        "calibrated_probability": 0.61,
        "raw_probability": 0.68,
        "edge": 9.0,
        "odds": -102,
        "market_priced": True,
        "pricing_type": "market",
        "odds_source": "sportsbook",
        "line_source": "sportsbook",
        "units": 0.7,
        "decision": "BET",
        "calibration": {"applied": True, "samples": 92, "key": "model:mlb_first_five|bet:f5_side"},
        "pregame_snapshot": {"decision": "BET", "units": 0.7, "probability": 0.68},
    }
    pick.update(overrides)
    return pick


def _f5_bucket(pick):
    return {
        "ok": True,
        "picks": [pick],
        "games": [{
            "game_id": "game-1",
            "away_team": "Away",
            "home_team": "Home",
            "features": {
                "away_lineup_matchup": {"sampled_batters": 9},
                "away_offense": {"pitcher_rest_days": 5, "pitcher_rest_label": "normal rest"},
                "home_pitcher": {"current_starts": 8},
                "venue": {"games": 44, "park_blend": {"final_delta": 0.05}, "wind_mph": 9.0},
            },
        }],
    }


def _inning_pick(**overrides):
    pick = {
        "source": "MLB Inning",
        "sport": "MLB",
        "date": "2026-06-25",
        "game_id": "game-2",
        "pick": "Inning 1 - No Run Scored",
        "market": "no_run_inning",
        "inning": 1,
        "probability": 0.62,
        "calibrated_probability": 0.62,
        "raw_probability": 0.70,
        "edge": 11.0,
        "edge_pp": 12.0,
        "odds": -110,
        "market_priced": True,
        "pricing_type": "market",
        "odds_source": "sportsbook",
        "line_source": "sportsbook",
        "units": 0.6,
        "decision": "BET",
        "calibration": {"applied": True, "samples": 120, "key": "model:mlb_inning|bet:no_run_inning"},
        "pregame_snapshot": {"decision": "BET", "units": 0.6, "probability": 0.70},
    }
    pick.update(overrides)
    return pick


def _inning_bucket(pick):
    return {
        "ok": True,
        "picks": [pick],
        "games": [{
            "game_id": "game-2",
            "home_pitcher": "Home SP",
            "away_pitcher": "Away SP",
            "venue_factor": 0.96,
            "full_inning_table": {str(index): 0.55 for index in range(1, 9)},
        }],
    }


def test_mlb_new_can_publish_when_market_calibration_and_validation_agree():
    pick = _mlb_new_pick()
    result = evaluate_mlb_team_pick(
        pick,
        "mlb_new",
        {"artifact_status": {"ready": True}, "model_stack": "v2"},
        performance=GOOD_PERFORMANCE,
    )

    assert result["decision"] == "BET"
    assert result["consensus_passed"] is True
    assert {signal["name"] for signal in result["signals"]} >= {
        "market_price",
        "probability_calibration",
        "walk_forward_validation",
        "model_stack_ready",
    }


def test_missing_market_price_blocks_mlb_new_even_with_high_probability():
    pick = _mlb_new_pick(odds=None, market_pick_prob=None, edge=14.0, probability=0.69)
    result = evaluate_mlb_team_pick(
        pick,
        "mlb_new",
        {"artifact_status": {"ready": True}, "model_stack": "v2"},
        performance=GOOD_PERFORMANCE,
    )

    assert result["decision"] == "PASS"
    assert "missing_reliable_market_price" in result["hard_blockers"]


def test_bad_walk_forward_history_blocks_high_probability_pick():
    pick = _mlb_new_pick(probability=0.72, calibrated_probability=0.72, edge=16.0)
    bad_performance = {("mlb_new", "h2h"): {"samples": 80, "wins": 34, "losses": 46, "profit": -8.0, "stake": 80.0, "roi": -0.1, "qualified": False}}
    result = evaluate_mlb_team_pick(
        pick,
        "mlb_new",
        {"artifact_status": {"ready": True}, "model_stack": "v2"},
        performance=bad_performance,
    )

    assert result["decision"] == "PASS"
    assert "failed_walk_forward_validation" in result["hard_blockers"]


def test_first_five_uses_baseball_context_when_real_market_price_exists():
    pick = _f5_pick()
    result = evaluate_mlb_team_pick(
        pick,
        "mlb_first_five",
        _f5_bucket(pick),
        performance=GOOD_PERFORMANCE,
    )

    assert result["decision"] == "BET"
    assert {signal["name"] for signal in result["signals"]} >= {
        "starting_pitcher",
        "lineup_offense",
        "travel_rest_schedule",
        "park_weather",
    }


def test_first_five_assumed_price_stays_research_only():
    pick = _f5_pick(market_priced=False, pricing_type="assumed", odds_source="default_assumed", line_source="in_house_projection")
    result = evaluate_mlb_team_pick(
        pick,
        "mlb_first_five",
        _f5_bucket(pick),
        performance=GOOD_PERFORMANCE,
    )

    assert result["decision"] == "PASS"
    assert "unsupported_assumed_price" in result["hard_blockers"]


def test_inning_model_uses_inning_baseline_and_context_with_real_market():
    pick = _inning_pick()
    result = evaluate_mlb_team_pick(
        pick,
        "mlb_inning",
        _inning_bucket(pick),
        performance=GOOD_PERFORMANCE,
    )

    assert result["decision"] == "BET"
    assert {signal["name"] for signal in result["signals"]} >= {
        "inning_baseline_edge",
        "starting_pitcher",
        "park_weather",
        "matchup_structure",
    }


def test_inning_assumed_price_stays_research_only():
    pick = _inning_pick(market_priced=False, pricing_type="assumed", odds_source="default_assumed", line_source="in_house_probability_baseline")
    result = evaluate_mlb_team_pick(
        pick,
        "mlb_inning",
        _inning_bucket(pick),
        performance=GOOD_PERFORMANCE,
    )

    assert result["decision"] == "PASS"
    assert "unsupported_assumed_price" in result["hard_blockers"]


def test_payload_gate_only_touches_three_mlb_team_models():
    mlb_pick = _mlb_new_pick()
    wnba_pick = {"source": "WNBA Model", "sport": "WNBA", "pick": "Tempo ML", "decision": "BET", "units": 1}
    payload = {
        "date": "2026-06-25",
        "models": {
            "mlb_new": {"ok": True, "artifact_status": {"ready": True}, "picks": [mlb_pick]},
            "wnba": {"ok": True, "picks": [deepcopy(wnba_pick)]},
        },
    }

    gated = apply_mlb_team_consensus_to_payload(payload, performance=GOOD_PERFORMANCE)

    assert gated["models"]["mlb_new"]["consensus_gate_version"] == MLB_TEAM_CONSENSUS_VERSION
    assert gated["models"]["mlb_new"]["picks"][0]["consensus_required"] is True
    assert "consensus_required" not in gated["models"]["wnba"]["picks"][0]
    assert gated["models"]["wnba"]["picks"][0] == wnba_pick

