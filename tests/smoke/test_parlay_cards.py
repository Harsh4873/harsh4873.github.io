from __future__ import annotations

from collections import Counter

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
) -> dict:
    return {
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


def test_builds_cross_sport_and_same_sport_three_leg_slips():
    team_payload = make_payload(
        {
            "mlb_new": [
                make_pick(sport="MLB", source="MLB Model", pick="Orioles ML", game="White Sox @ Orioles"),
                make_pick(sport="MLB", source="MLB Model", pick="Padres ML", game="Padres @ Cubs"),
                make_pick(sport="MLB", source="MLB Model", pick="Rangers ML", game="Rangers @ Reds"),
                make_pick(sport="WNBA", source="WNBA Model", pick="Liberty ML", game="Liberty @ Sun"),
                make_pick(sport="FIFA WC", source="FIFA Model", pick="Brazil ML", game="Japan @ Brazil"),
                make_pick(sport="FIFA WC", source="FIFA Model", pick="Germany ML", game="Germany @ Ghana"),
            ]
        }
    )

    payload = parlays.build_parlay_payload(DATE, team_payload, None, team_history=[], prop_history=[], prior_payloads=[])
    cards = payload["cards"]

    assert any(card["category"] == "cross_sport" and card["legCount"] == 3 and len(card["sports"]) >= 2 for card in cards)
    assert any(card["category"] == "same_sport" and card["legCount"] == 3 and len(card["sports"]) == 1 for card in cards)
    assert all(card["legCount"] != 1 for card in cards)


def test_uses_two_leg_fallback_without_one_leg_cards():
    team_payload = make_payload(
        {
            "mlb_new": [
                make_pick(sport="MLB", source="MLB Model", pick="Orioles ML", game="White Sox @ Orioles"),
                make_pick(sport="FIFA WC", source="FIFA Model", pick="Brazil ML", game="Japan @ Brazil"),
            ]
        }
    )

    payload = parlays.build_parlay_payload(DATE, team_payload, None, team_history=[], prop_history=[], prior_payloads=[])

    assert payload["cards"]
    assert {card["legCount"] for card in payload["cards"]} == {2}


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
                make_pick(sport="MLB", source="MLB Model", pick="Orioles ML", game="White Sox @ Orioles"),
                make_pick(sport="MLB", source="MLB Model", pick="Padres ML", game="Padres @ Cubs"),
                make_pick(sport="FIFA WC", source="FIFA Model", pick="Brazil ML", game="Japan @ Brazil"),
            ]
        }
    )
    prop_payload = make_payload(
        {
            "mlb_player_props": [
                make_pick(sport="MLB", source="MLBPlayerProps", pick="Player A Over 0.5 Hits", game="A @ B", player="Player A"),
                make_pick(sport="MLB", source="MLBPlayerProps", pick="Player B Under 1.5 Bases", game="C @ D", player="Player B"),
                make_pick(sport="MLB", source="MLBPlayerProps", pick="Player C Over 0.5 Runs", game="E @ F", player="Player C"),
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
                make_pick(sport="MLB", source="MLB Model", pick="Orioles ML", game="White Sox @ Orioles"),
                make_pick(sport="MLB", source="MLB Model", pick="Padres ML", game="Padres @ Cubs"),
                make_pick(sport="FIFA WC", source="FIFA Model", pick="Brazil ML", game="Japan @ Brazil"),
            ]
        }
    )
    prop_payload = make_payload(
        {
            "mlb_player_props": [
                make_pick(sport="MLB", source="MLBPlayerProps", pick=f"Player {index} Over 0.5 Hits", game=f"Game {index} @ Home", player=f"Player {index}")
                for index in range(10)
            ]
        }
    )

    payload = parlays.build_parlay_payload(DATE, team_payload, prop_payload, team_history=[], prop_history=[], prior_payloads=[])
    mode_counts = Counter(card["pickMode"] for card in payload["cards"])

    assert mode_counts["team"] > 0
    assert mode_counts["player"] > 0
    assert mode_counts["team"] <= 15
    assert mode_counts["player"] <= 15


def test_ungradeable_legs_are_excluded_from_slips():
    team_payload = make_payload(
        {
            "mlb_new": [
                make_pick(sport="MLB", source="MLB Model", pick="Orioles ML", game="White Sox @ Orioles"),
                make_pick(sport="MLB", source="MLB Model", pick="Padres ML", game="Padres @ Cubs"),
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
    assert max(exposure.values()) <= 3


def test_dynamic_category_weights_shrink_from_prior_results():
    prior_payloads = [
        {
            "cards": [
                {"category": "cross_sport", "result": "win", "profitUnits": 2.0}
                for _ in range(20)
            ]
            + [
                {"category": "same_sport", "result": "loss", "profitUnits": -1.0}
                for _ in range(20)
            ]
        }
    ]

    weights = parlays.category_weights(prior_payloads)

    assert weights["cross_sport"] > 1
    assert weights["same_sport"] < 1
    assert weights["cross_sport"] > weights["same_sport"]


def test_rankings_count_whole_parlay_cards_not_legs():
    cards = [
        {
            "id": "card-win",
            "comboKey": "a|b|c",
            "date": DATE,
            "category": "consensus",
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
            "category": "consensus",
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

    row = next(item for item in parlays.rankings([], cards) if item["category"] == "consensus")

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
