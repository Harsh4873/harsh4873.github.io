from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
for path in (REPO_ROOT, REPO_ROOT / "NBAPredictionModel"):
    str_path = str(path)
    if str_path not in sys.path:
        sys.path.insert(0, str_path)


def _series_3_down_0_2():
    return {
        "round": "Conference Semifinals",
        "headline": "West Semifinals - Game 3",
        "game_number": 3,
        "is_game_1": False,
        "is_game_2": False,
        "is_game_7": False,
        "home_wins": 0,
        "away_wins": 2,
        "home_trailing": True,
        "away_trailing": False,
        "home_elimination": False,
        "away_elimination": False,
        "home_closeout": False,
        "away_closeout": False,
        "repeat_matchups": 2,
    }


def _stub_market(home_spread: float, away_spread: float):
    return {
        "home_spread": home_spread,
        "away_spread": away_spread,
        "provider": "test",
    }


def test_big_dog_with_huge_edge_is_not_a_bet():
    """Lakers +295 vs OKC scenario from 2026-05-09: 27.8% edge on a +295 dog
    must not be a BET — it should be PASS or LEAN at most because the dog
    needs >=60% conviction and the spread layer disagrees with the market."""
    from NBAPlayoffsPredictionModel.run_live import evaluate_playoff_decision

    result = evaluate_playoff_decision(
        pick_team="Lakers",
        pick_prob=0.5208,
        pick_odds=295,
        edge=0.278,
        predicted_spread=0.15,
        market=_stub_market(home_spread=8.5, away_spread=-8.5),
        home_name="Lakers",
        away_name="Thunder",
        injuries={"placeholder": []},
        series_context=_series_3_down_0_2(),
        adjustments=[{"value": 0.04}, {"value": -0.04}],
    )
    assert result["decision"] != "BET"
    reasons = " | ".join(result["reasons"]).lower()
    assert "ceiling" in reasons or "conviction" in reasons or "narrative" in reasons


def test_short_favorite_with_real_edge_can_bet():
    """A short home favorite with a 6+% edge, 60%+ pick prob, and a model
    spread that broadly agrees with the market line should fire BET."""
    from NBAPlayoffsPredictionModel.run_live import evaluate_playoff_decision

    series_neutral = {
        "round": "Conference Semifinals",
        "headline": "East Semifinals - Game 5",
        "game_number": 5,
        "is_game_1": False,
        "is_game_2": False,
        "is_game_7": False,
        "home_wins": 2,
        "away_wins": 2,
        "home_trailing": False,
        "away_trailing": False,
        "home_elimination": False,
        "away_elimination": False,
        "home_closeout": False,
        "away_closeout": False,
        "repeat_matchups": 4,
    }

    result = evaluate_playoff_decision(
        pick_team="Celtics",
        pick_prob=0.62,
        pick_odds=-180,
        edge=0.07,
        predicted_spread=4.6,
        market=_stub_market(home_spread=-4.5, away_spread=4.5),
        home_name="Celtics",
        away_name="Heat",
        injuries={"placeholder": []},
        series_context=series_neutral,
        adjustments=[{"value": 0.03}, {"value": 0.02}],
    )
    assert result["decision"] == "BET"
    assert result["confidence"] in {"High", "Medium"}


def test_spread_disagreement_blocks_bet():
    """If the model margin disagrees with the market line by >5 pts the
    pick must drop to LEAN/PASS even if the moneyline edge looks fine."""
    from NBAPlayoffsPredictionModel.run_live import evaluate_playoff_decision

    series_state = {
        "round": "Conference Finals",
        "headline": "East Finals - Game 4",
        "game_number": 4,
        "is_game_1": False,
        "is_game_2": False,
        "is_game_7": False,
        "home_wins": 1,
        "away_wins": 2,
        "home_trailing": True,
        "away_trailing": False,
        "home_elimination": False,
        "away_elimination": False,
        "home_closeout": False,
        "away_closeout": False,
        "repeat_matchups": 3,
    }

    result = evaluate_playoff_decision(
        pick_team="Pacers",
        pick_prob=0.56,
        pick_odds=-130,
        edge=0.06,
        predicted_spread=-4.0,  # model says home loses by 4
        market=_stub_market(home_spread=-3.5, away_spread=3.5),  # market says home -3.5
        home_name="Pacers",
        away_name="Knicks",
        injuries={"placeholder": []},
        series_context=series_state,
        adjustments=[{"value": 0.02}, {"value": 0.02}],
    )
    assert result["decision"] != "BET"


def test_missing_injury_feed_caps_at_lean():
    """An empty injury feed leaves the model running blind on availability;
    even a good-looking edge should drop to LEAN."""
    from NBAPlayoffsPredictionModel.run_live import evaluate_playoff_decision

    series_state = {
        "round": "First Round",
        "headline": "East First Round - Game 2",
        "game_number": 2,
        "is_game_1": False,
        "is_game_2": True,
        "is_game_7": False,
        "home_wins": 0,
        "away_wins": 1,
        "home_trailing": True,
        "away_trailing": False,
        "home_elimination": False,
        "away_elimination": False,
        "home_closeout": False,
        "away_closeout": False,
        "repeat_matchups": 1,
    }

    result = evaluate_playoff_decision(
        pick_team="Knicks",
        pick_prob=0.58,
        pick_odds=-150,
        edge=0.05,
        predicted_spread=3.0,
        market=_stub_market(home_spread=-3.0, away_spread=3.0),
        home_name="Knicks",
        away_name="Pistons",
        injuries={},  # empty feed
        series_context=series_state,
        adjustments=[{"value": 0.02}],
    )
    assert result["decision"] != "BET"
    assert any("injury" in reason.lower() for reason in result["reasons"])
