from __future__ import annotations

import pandas as pd


def test_ipl_no_market_priority_units_and_lean_tier():
    from ipl.models.fantasy_selector import (
        contest_units_from_priority_edge,
        decision_from_priority_edge,
    )

    assert decision_from_priority_edge(5.0) == "BET"
    assert decision_from_priority_edge(3.0) == "LEAN"
    assert decision_from_priority_edge(1.0) == "PASS"

    bet_units = contest_units_from_priority_edge(18.0)
    lean_units = contest_units_from_priority_edge(3.0)
    pass_units = contest_units_from_priority_edge(1.0)

    assert 0.25 <= lean_units < bet_units <= 1.5
    assert pass_units == 0.0


def test_ipl_fantasy_xi_enforces_dream11_role_and_team_caps():
    from ipl.models.fantasy_selector import (
        DREAM11_ROLE_LIMITS,
        _lineup_constraints_summary,
        _select_valid_fantasy_xi,
    )

    rows = []
    # Tempt the selector with too many high-scoring wicket-keepers from one
    # team; a valid XI still needs batsmen, bowlers, all-rounders, and max 7
    # from either side.
    for idx in range(6):
        rows.append(
            {
                "player_name": f"Keeper {idx}",
                "team": "Team A",
                "role": "Wicket-Keeper",
                "adjusted_score": 100 - idx,
                "fantasy_probability_pct": 100 - idx,
            }
        )
    for idx in range(4):
        rows.append(
            {
                "player_name": f"Batter {idx}",
                "team": "Team B" if idx < 2 else "Team A",
                "role": "Batsman",
                "adjusted_score": 80 - idx,
                "fantasy_probability_pct": 80 - idx,
            }
        )
    for idx in range(3):
        rows.append(
            {
                "player_name": f"AllRounder {idx}",
                "team": "Team B",
                "role": "All-Rounder",
                "adjusted_score": 70 - idx,
                "fantasy_probability_pct": 70 - idx,
            }
        )
    for idx in range(5):
        rows.append(
            {
                "player_name": f"Bowler {idx}",
                "team": "Team B" if idx < 4 else "Team A",
                "role": "Bowler",
                "adjusted_score": 60 - idx,
                "fantasy_probability_pct": 60 - idx,
            }
        )

    selected = _select_valid_fantasy_xi(pd.DataFrame(rows), max_per_team=7)
    summary = _lineup_constraints_summary(selected, max_per_team=7)

    assert len(selected) == 11
    assert summary["satisfied"] is True
    assert max(summary["team_counts"].values()) <= 7
    for role, limits in DREAM11_ROLE_LIMITS.items():
        assert limits[0] <= summary["role_counts"][role] <= limits[1]


def test_ipl_matchup_and_bowling_opportunity_factors_move_scores():
    from ipl.models.fantasy_selector import _add_matchup_and_opportunity_factors

    frame = pd.DataFrame(
        [
            {
                "player_name": "Hot Batter",
                "role": "Batsman",
                "matches_played_total": 20,
                "h2h_batting_balls": 30,
                "h2h_batting_runs": 60,
                "h2h_batting_dismissals": 0,
                "h2h_bowling_balls": 0,
                "h2h_bowling_runs": 0,
                "h2h_bowling_wickets": 0,
                "last_match_overs": 0.0,
                "last_match_balls_bowled": 0,
            },
            {
                "player_name": "Full Quota Bowler",
                "role": "Bowler",
                "matches_played_total": 20,
                "h2h_batting_balls": 0,
                "h2h_batting_runs": 0,
                "h2h_batting_dismissals": 0,
                "h2h_bowling_balls": 36,
                "h2h_bowling_runs": 24,
                "h2h_bowling_wickets": 4,
                "last_match_overs": 4.0,
                "last_match_balls_bowled": 24,
            },
            {
                "player_name": "Unused Bowler",
                "role": "Bowler",
                "matches_played_total": 20,
                "h2h_batting_balls": 0,
                "h2h_batting_runs": 0,
                "h2h_batting_dismissals": 0,
                "h2h_bowling_balls": 0,
                "h2h_bowling_runs": 0,
                "h2h_bowling_wickets": 0,
                "last_match_overs": 0.0,
                "last_match_balls_bowled": 0,
            },
        ]
    )

    adjusted = _add_matchup_and_opportunity_factors(frame)
    by_name = adjusted.set_index("player_name")

    assert by_name.loc["Hot Batter", "matchup_factor"] > 1.0
    assert by_name.loc["Full Quota Bowler", "matchup_factor"] > 1.0
    assert by_name.loc["Full Quota Bowler", "bowling_opportunity_factor"] > 1.0
    assert by_name.loc["Unused Bowler", "bowling_opportunity_factor"] < 1.0


def test_ipl_api_payload_surfaces_market_units_and_constraints(monkeypatch, tmp_path):
    import ipl.ipl_model as model

    monkeypatch.setattr(
        model,
        "predict_winner",
        lambda *args, **kwargs: {
            "predicted_winner": "Team A",
            "team1_win_prob": 0.58,
            "team2_win_prob": 0.42,
            "confidence": "MEDIUM",
        },
    )
    monkeypatch.setattr(
        model,
        "run_match_fantasy_model",
        lambda *args, **kwargs: {
            "market": {"has_market": False, "source": "none_wired"},
            "lineup_constraints": {"satisfied": True},
            "selected_players": [
                {
                    "player_name": "Player A",
                    "team": "Team A",
                    "role": "Batsman",
                    "fantasy_probability_pct": 64.2,
                    "selection_baseline_pct": 60.0,
                    "priority_edge_pct": 4.2,
                    "decision": "BET",
                    "units": 0.35,
                    "market_source": "none_wired",
                    "has_market_price": False,
                    "market_probability_pct": None,
                    "market_edge_pct": None,
                    "matchup_evidence_balls": 18.0,
                    "matchup_factor": 1.02,
                    "last_match_overs": 0.0,
                    "bowling_opportunity_factor": 1.0,
                    "captain": True,
                    "vice_captain": False,
                    "captain_multiplier": 2.0,
                    "captaincy_boost_points": 42.0,
                }
            ],
        },
    )

    payload = model.run_ipl_model(
        team1="Team A",
        team2="Team B",
        venue="Test Ground",
        toss_winner="Team A",
        toss_decision="bat",
        db_path=tmp_path / "unused.db",
    )

    player = payload["selected_players"][0]
    assert payload["market"]["has_market"] is False
    assert payload["lineup_constraints"]["satisfied"] is True
    assert player["decision"] == "BET"
    assert player["units"] == 0.35
    assert player["priority_edge_pct"] == 4.2
    assert player["has_market_price"] is False
