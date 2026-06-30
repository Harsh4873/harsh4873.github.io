from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from scripts import build_parlay_cards as parlays


DATE = "2026-06-29"


def make_pick(
    *,
    sport: str,
    source: str,
    pick: str,
    game: str,
    odds: int = -110,
    probability: float = 0.66,
    result: str = "pending",
    player: str = "",
    market: str = "moneyline",
    decision: str = "BET",
    grade_supported: bool = True,
    consensus: bool = False,
) -> dict:
    pick_payload = {
        "date": DATE,
        "sport": sport,
        "source": source,
        "pick": pick,
        "game": game,
        "matchup": game,
        "odds": odds,
        "probability": probability,
        "result": result,
        "player_name": player,
        "market_type": market,
        "decision": decision,
        "grade_supported": grade_supported,
    }
    if consensus:
        pick_payload["consensus_qualified"] = True
        pick_payload["consensus_model_count"] = 2
    return pick_payload


def make_payload(model_picks: dict[str, list[dict]]) -> dict:
    return {
        "date": DATE,
        "models": {
            key: {"ok": True, "picks": picks}
            for key, picks in model_picks.items()
        },
    }


def test_odds_ev_math_and_favorite_stack_penalty():
    decimal = parlays.american_to_decimal(-110) ** 3
    assert parlays.decimal_to_american(decimal) == 596

    fair = parlays.fair_odds_from_probability(0.25)
    assert fair == 300

    balanced = parlays.payout_quality_score([-110, -110, -110], 597)
    ugly = parlays.payout_quality_score([-250, -800, -250], 145)
    assert ugly < balanced


def test_probability_blending_uses_market_model_and_history_weights():
    calibration = parlays.HistoricalCalibration(wins=40, losses=20)

    probability, edge, model_w, hist_w, market_w = parlays.blended_leg_probability(
        mode="team",
        raw_probability=0.7,
        market_probability=0.55,
        odds=-110,
        consensus=True,
        calibration=calibration,
    )

    expected = 0.55 * market_w + 0.7 * model_w + calibration.posterior * hist_w
    assert probability == expected
    assert edge == probability - 0.55
    assert round(model_w, 2) == 0.45
    assert 0 < hist_w <= 0.35


def test_historical_calibration_excludes_target_date_and_future(tmp_path: Path):
    ledger = {
        "records": [
            {"date": "2026-06-28", "cache_type": "model_cache", "model_key": "mlb_new", "source": "MLB Model", "sport": "MLB", "bet_type": "h2h", "result": "win"},
            {"date": DATE, "cache_type": "model_cache", "model_key": "mlb_new", "source": "MLB Model", "sport": "MLB", "bet_type": "h2h", "result": "loss"},
            {"date": "2026-06-30", "cache_type": "model_cache", "model_key": "mlb_new", "source": "MLB Model", "sport": "MLB", "bet_type": "h2h", "result": "loss"},
        ]
    }
    path = tmp_path / "outcome_ledger.json"
    path.write_text(json.dumps(ledger), encoding="utf-8")

    history = parlays.build_historical_calibration(DATE, path)
    calibration = parlays.calibration_for_leg(history, mode="team", model_key="mlb_new", sport="MLB", market_family="h2h")

    assert calibration.wins == 1
    assert calibration.losses == 0


def test_builds_three_leg_value_slips_without_old_categories():
    team_payload = make_payload(
        {
            "mlb_new": [
                make_pick(sport="MLB", source="MLB Model", pick="Orioles ML", game="White Sox @ Orioles", probability=0.9),
                make_pick(sport="MLB", source="MLB Model", pick="Padres ML", game="Padres @ Cubs", probability=0.9),
                make_pick(sport="MLB", source="MLB Model", pick="Rangers ML", game="Rangers @ Reds", probability=0.9),
                make_pick(sport="WNBA", source="WNBA Model", pick="Liberty ML", game="Liberty @ Sun", probability=0.9),
                make_pick(sport="FIFA WC", source="FIFA Model", pick="Brazil ML", game="Japan @ Brazil", probability=0.9),
                make_pick(sport="FIFA WC", source="FIFA Model", pick="Germany ML", game="Germany @ Ghana", probability=0.9),
            ]
        }
    )

    payload = parlays.build_parlay_payload(DATE, team_payload, None, team_history=[], prop_history=[], prior_payloads=[])
    cards = payload["cards"]

    assert payload["engineVersion"] == parlays.ENGINE_VERSION
    assert any(card["category"] == "three_leg_value" and card["legCount"] == 3 for card in cards)
    assert {card["category"] for card in cards} <= set(parlays.CATEGORY_ORDER)
    assert all(card["legCount"] != 1 for card in cards)


def test_uses_two_leg_fallback_without_one_leg_cards():
    team_payload = make_payload(
        {
            "mlb_new": [
                make_pick(sport="MLB", source="MLB Model", pick="Orioles ML", game="White Sox @ Orioles", probability=0.75),
                make_pick(sport="FIFA WC", source="FIFA Model", pick="Brazil ML", game="Japan @ Brazil", probability=0.75),
            ]
        }
    )

    payload = parlays.build_parlay_payload(DATE, team_payload, None, team_history=[], prop_history=[], prior_payloads=[])

    assert payload["cards"]
    assert {card["category"] for card in payload["cards"]} == {"compact_edge"}
    assert {card["legCount"] for card in payload["cards"]} == {2}


def test_compact_edge_is_not_generic_fallback_when_three_leg_utility_is_viable():
    team_payload = make_payload(
        {
            "mlb_new": [
                make_pick(sport="MLB", source="MLB Model", pick=f"MLB {index} ML", game=f"MLB {index} @ Home", probability=0.9)
                for index in range(5)
            ]
        }
    )

    payload = parlays.build_parlay_payload(DATE, team_payload, None, team_history=[], prop_history=[], prior_payloads=[])

    assert payload["cards"]
    assert all(card["category"] != "compact_edge" for card in payload["cards"])


def test_same_game_legs_are_not_combined():
    team_payload = make_payload(
        {
            "mlb_new": [
                make_pick(sport="MLB", source="MLB Model", pick="Orioles ML", game="White Sox @ Orioles"),
                make_pick(sport="MLB", source="MLB Model", pick="Over 8.5", game="White Sox @ Orioles", market="total"),
                make_pick(sport="MLB", source="MLB Model", pick="Padres ML", game="Padres @ Cubs"),
                make_pick(sport="FIFA WC", source="FIFA Model", pick="Brazil ML", game="Japan @ Brazil"),
                make_pick(sport="WNBA", source="WNBA Model", pick="Liberty ML", game="Liberty @ Sun"),
            ]
        }
    )

    payload = parlays.build_parlay_payload(DATE, team_payload, None, team_history=[], prop_history=[], prior_payloads=[])

    for card in payload["cards"]:
        game_keys = [leg["gameKey"] for leg in card["legs"]]
        assert len(game_keys) == len(set(game_keys))


def test_team_and_player_legs_do_not_mix_in_one_slip():
    team_payload = make_payload(
        {
            "mlb_new": [
                make_pick(sport="MLB", source="MLB Model", pick="Orioles ML", game="White Sox @ Orioles", probability=0.9),
                make_pick(sport="MLB", source="MLB Model", pick="Padres ML", game="Padres @ Cubs", probability=0.9),
                make_pick(sport="FIFA WC", source="FIFA Model", pick="Brazil ML", game="Japan @ Brazil", probability=0.9),
            ]
        }
    )
    prop_payload = make_payload(
        {
            "mlb_player_props": [
                make_pick(sport="MLB", source="MLBPlayerProps", pick="Player A Over 0.5 Hits", game="A @ B", player="Player A", consensus=True),
                make_pick(sport="MLB", source="MLBPlayerProps", pick="Player B Under 1.5 Bases", game="C @ D", player="Player B", consensus=True),
                make_pick(sport="MLB", source="MLBPlayerProps", pick="Player C Over 0.5 Runs", game="E @ F", player="Player C", consensus=True),
            ]
        }
    )

    payload = parlays.build_parlay_payload(DATE, team_payload, prop_payload, team_history=[], prop_history=[], prior_payloads=[])

    assert payload["cards"]
    assert {"team", "player"} <= {card["pickMode"] for card in payload["cards"]}
    for card in payload["cards"]:
        leg_types = {leg["sourceType"] for leg in card["legs"]}
        assert leg_types == {"model"} or leg_types == {"player_prop"}
        assert card["pickMode"] in {"team", "player"}


def test_team_and_player_cards_are_selected_independently():
    team_payload = make_payload(
        {
            "mlb_new": [
                make_pick(sport="MLB", source="MLB Model", pick="Orioles ML", game="White Sox @ Orioles", probability=0.9),
                make_pick(sport="MLB", source="MLB Model", pick="Padres ML", game="Padres @ Cubs", probability=0.9),
                make_pick(sport="FIFA WC", source="FIFA Model", pick="Brazil ML", game="Japan @ Brazil", probability=0.9),
            ]
        }
    )
    prop_payload = make_payload(
        {
            "mlb_player_props": [
                make_pick(sport="MLB", source="MLBPlayerProps", pick=f"Player {index} Over 0.5 Hits", game=f"Game {index} @ Home", player=f"Player {index}", consensus=True)
                for index in range(10)
            ]
        }
    )

    payload = parlays.build_parlay_payload(DATE, team_payload, prop_payload, team_history=[], prop_history=[], prior_payloads=[])
    mode_counts = Counter(card["pickMode"] for card in payload["cards"])

    assert mode_counts["team"] > 0
    assert mode_counts["player"] > 0
    assert mode_counts["team"] <= 6
    assert mode_counts["player"] <= 6


def test_ungradeable_legs_are_excluded_from_slips():
    team_payload = make_payload(
        {
            "mlb_new": [
                make_pick(sport="MLB", source="MLB Model", pick="Orioles ML", game="White Sox @ Orioles", probability=0.75),
                make_pick(sport="MLB", source="MLB Model", pick="Padres ML", game="Padres @ Cubs", probability=0.75),
                make_pick(sport="FIFA WC", source="Scores24FIFAWorldCup", pick="Both teams to score", game="Brazil @ Japan", grade_supported=False),
            ]
        }
    )

    payload = parlays.build_parlay_payload(DATE, team_payload, None, team_history=[], prop_history=[], prior_payloads=[])

    assert payload["summary"]["eligibleLegs"] == 2
    assert payload["cards"]
    assert all(
        leg["pick"] != "Both teams to score"
        for card in payload["cards"]
        for leg in card["legs"]
    )


def test_displayed_leg_exposure_is_capped_when_slate_is_not_thin():
    picks = [
        make_pick(sport="MLB", source="MLB Model", pick="Anchor ML", game="Anchor @ Game", probability=0.9),
        make_pick(sport="MLB", source="MLB Model", pick="A ML", game="A @ B", probability=0.68),
        make_pick(sport="MLB", source="MLB Model", pick="C ML", game="C @ D", probability=0.67),
        make_pick(sport="WNBA", source="WNBA Model", pick="E ML", game="E @ F", probability=0.66),
        make_pick(sport="WNBA", source="WNBA Model", pick="G ML", game="G @ H", probability=0.65),
        make_pick(sport="FIFA WC", source="FIFA Model", pick="I ML", game="I @ J", probability=0.64),
        make_pick(sport="FIFA WC", source="FIFA Model", pick="K ML", game="K @ L", probability=0.63),
        make_pick(sport="MLB", source="Scores24MLB", pick="M ML", game="M @ N", probability=0.62),
        make_pick(sport="WNBA", source="WNBA Model", pick="O ML", game="O @ P", probability=0.61),
        make_pick(sport="FIFA WC", source="FIFA Model", pick="Q ML", game="Q @ R", probability=0.60),
    ]
    payload = parlays.build_parlay_payload(DATE, make_payload({"mlb_new": picks}), None, team_history=[], prop_history=[], prior_payloads=[])
    exposure = Counter(leg["legId"] for card in payload["cards"] for leg in card["legs"])

    assert exposure
    assert max(exposure.values()) <= 2


def test_cold_mode_category_publishes_zero_new_slips():
    prior_payloads = [
        {
            "engineVersion": parlays.ENGINE_VERSION,
            "cards": [
                {
                    "category": "three_leg_value",
                    "pickMode": "team",
                    "result": "loss",
                    "profitUnits": -1.0,
                    "id": f"three-leg-value-{index}",
                    "comboKey": f"three-leg-value-{index}",
                }
                for index in range(10)
            ]
        }
    ]
    team_payload = make_payload(
        {
            "mlb_new": [
                make_pick(sport="MLB", source="MLB Model", pick=f"MLB {index} ML", game=f"MLB {index} @ Home", probability=0.7)
                for index in range(5)
            ],
            "wnba": [
                make_pick(sport="WNBA", source="WNBA Model", pick=f"WNBA {index} ML", game=f"WNBA {index} @ Home", probability=0.69)
                for index in range(4)
            ],
            "fifa_world_cup": [
                make_pick(sport="FIFA WC", source="FIFA Model", pick=f"FIFA {index} ML", game=f"FIFA {index} @ Home", probability=0.68)
                for index in range(4)
            ],
        }
    )

    payload = parlays.build_parlay_payload(DATE, team_payload, None, team_history=[], prop_history=[], prior_payloads=prior_payloads)
    counts = Counter(card["category"] for card in payload["cards"])

    assert counts["three_leg_value"] == 0
    assert all(card["category"] in {"consensus_edge", "validated_form", "compact_edge"} for card in payload["cards"])


def test_v3_rankings_do_not_carry_forward_v1_category_records():
    prior_payloads = [
        {
            "engineVersion": "parlay_cards_v1",
            "cards": [
                {"category": "same_sport", "result": "loss", "profitUnits": -1.0, "id": f"old-{index}", "comboKey": f"old-{index}"}
                for index in range(30)
            ],
        }
    ]
    team_payload = make_payload(
        {
            "mlb_new": [
                make_pick(sport="MLB", source="MLB Model", pick=f"MLB {index} ML", game=f"MLB {index} @ Home", probability=0.7)
                for index in range(5)
            ]
        }
    )

    payload = parlays.build_parlay_payload(DATE, team_payload, None, team_history=[], prop_history=[], prior_payloads=prior_payloads)

    assert payload["engineVersion"] == parlays.ENGINE_VERSION
    assert all(row["losses"] == 0 for row in payload["rankings"])


def test_rankings_count_whole_parlay_cards_not_legs():
    cards = [
        {
            "id": "card-win",
            "comboKey": "a|b|c",
            "date": DATE,
            "category": "consensus_edge",
            "result": "win",
            "profitUnits": 2.5,
            "oddsAmerican": 250,
            "legs": [
                {"result": "win"},
                {"result": "win"},
                {"result": "win"},
            ],
        },
        {
            "id": "card-loss",
            "comboKey": "d|e|f",
            "date": DATE,
            "category": "consensus_edge",
            "result": "loss",
            "profitUnits": -1.0,
            "oddsAmerican": 220,
            "legs": [
                {"result": "win"},
                {"result": "win"},
                {"result": "loss"},
            ],
        },
    ]

    row = next(item for item in parlays.rankings([], cards) if item["category"] == "consensus_edge")

    assert row["wins"] == 1
    assert row["losses"] == 1
    assert row["settled"] == 2


def test_push_grading_reduces_to_remaining_active_legs():
    leg = {"decimalOdds": parlays.american_to_decimal(-110)}
    result = parlays.grade_parlay_result([
        {**leg, "result": "win"},
        {**leg, "result": "push"},
        {**leg, "result": "win"},
    ])

    assert result["result"] == "win"
    assert result["activeLegCount"] == 2
    assert result["profitUnits"] == round(parlays.american_to_decimal(-110) ** 2 - 1, 2)

    assert parlays.grade_parlay_result([{**leg, "result": "push"}, {**leg, "result": "push"}])["result"] == "push"
    assert parlays.grade_parlay_result([{**leg, "result": "loss"}, {**leg, "result": "pending"}])["result"] == "loss"
