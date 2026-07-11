from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

import pytest

from scripts import build_profit_desk as desk


DATE = "2026-07-10"


def make_pick(
    *,
    pick: str = "Alpha ML",
    game: str = "Alpha @ Bravo",
    slate_date: str = DATE,
    source: str = "Test Source",
    sport: str = "MLB",
    decision: str = "BET",
    result: str = "pending",
    odds: int = 100,
    no_vig: float | None = 0.5,
    updated_at: str | None = None,
    start_time: str | None = None,
    market: str = "moneyline",
    player: str = "",
    direction: str = "",
    line: float | None = None,
    raw_probability: float = 0.99,
    grade_supported: bool = True,
    model_version: str = "model-v1",
    policy_version: str = "policy-v1",
    pick_id: str = "",
) -> dict:
    updated_at = updated_at or f"{slate_date}T10:00:00Z"
    start_time = start_time or f"{slate_date}T20:00:00Z"
    payload = {
        "id": pick_id,
        "date": slate_date,
        "source": source,
        "sport": sport,
        "decision": decision,
        "result": result,
        "pick": pick,
        "matchup": game,
        "odds": odds,
        "market_type": market,
        "market_priced": True,
        "pricing_type": "market",
        "odds_source": "posted_market",
        "market_source": "Fixture Book",
        "market_updated_at": updated_at,
        "start_time": start_time,
        "grade_supported": grade_supported,
        "model_version": model_version,
        "policy_version": policy_version,
        "probability": raw_probability,
    }
    if no_vig is not None:
        payload["market_no_vig_selected_probability"] = no_vig
    if player:
        payload.update({"scope": "player", "player_name": player})
    if direction:
        payload["selection"] = direction
    if line is not None:
        payload["line"] = line
    return payload


def make_payload(picks: list[dict], *, slate_date: str = DATE, source_key: str = "test") -> dict:
    return {
        "date": slate_date,
        "generatedAt": f"{slate_date}T12:00:00Z",
        "models": {source_key: {"ok": True, "picks": picks}},
    }


def history_payloads(
    *,
    wins_per_date: int = 5,
    losses_per_date: int = 1,
    days: int = 20,
    mode: str = "team",
) -> list[dict]:
    target = date.fromisoformat(DATE)
    payloads = []
    for day_index in range(days):
        slate = (target - timedelta(days=days - day_index)).isoformat()
        picks = []
        results = ["win"] * wins_per_date + ["loss"] * losses_per_date
        for row_index, result in enumerate(results):
            unique = day_index * len(results) + row_index
            kwargs = {
                "pick": f"Team {unique} ML",
                "game": f"Team {unique} @ Opponent {unique}",
                "slate_date": slate,
                "result": result,
                "pick_id": f"history-{unique}",
            }
            if mode == "player":
                kwargs.update(
                    {
                        "pick": f"Player {unique} Over 1.5 Hits",
                        "player": f"Player {unique}",
                        "direction": "Over",
                        "line": 1.5,
                        "market": "hits",
                    }
                )
            picks.append(make_pick(**kwargs))
        payloads.append(make_payload(picks, slate_date=slate))
    return payloads


def candidate_for(
    pick: dict,
    *,
    team_history: list[dict] | None = None,
    prop_history: list[dict] | None = None,
    player: bool = False,
) -> dict:
    payload = make_payload([pick])
    built = desk.build_profit_desk_payload(
        DATE,
        None if player else payload,
        payload if player else None,
        team_history=team_history or [],
        prop_history=prop_history or [],
    )
    assert len(built["candidates"]) == 1
    return built["candidates"][0]


def test_no_vig_probability_is_derived_only_from_complete_market():
    priced = make_pick(
        pick="Ace Over 4.5 Strikeouts",
        player="Ace",
        direction="Over",
        line=4.5,
        no_vig=None,
        odds=-120,
        market="strikeouts",
    )
    priced.update({"market_over_odds": -120, "market_under_odds": 110})
    derived = desk.derive_no_vig_probability(priced)
    expected = desk.implied_probability(-120) / (
        desk.implied_probability(-120) + desk.implied_probability(110)
    )
    assert derived.verified is True
    assert derived.probability == pytest.approx(expected)
    assert derived.method.startswith("derived_two_sided")

    one_sided = dict(priced)
    one_sided.pop("market_under_odds")
    one_sided["market_probability"] = 0.7
    rejected = desk.derive_no_vig_probability(one_sided)
    assert rejected.verified is False
    assert rejected.probability is None


def test_assumed_one_sided_and_stale_prices_have_exact_blockers_and_tiers():
    assumed = make_pick(pick="Assumed ML", game="A @ B")
    assumed.update(
        {
            "assumed_odds": 100,
            "pricing_type": "user_assumed",
            "odds_source": "default_assumed",
        }
    )
    one_sided = make_pick(pick="One Side ML", game="C @ D", no_vig=None)
    one_sided["selected_side_implied_probability"] = 0.55
    stale = make_pick(
        pick="Stale ML",
        game="E @ F",
        updated_at="2026-07-08T10:00:00Z",
        start_time="2026-07-10T20:00:00Z",
    )
    built = desk.build_profit_desk_payload(
        DATE,
        make_payload([assumed, one_sided, stale]),
        None,
        team_history=[],
        prop_history=[],
    )
    by_pick = {candidate["pick"]: candidate for candidate in built["candidates"]}
    assert by_pick["Assumed ML"]["price"]["tier"] == "D"
    assert "assumed_or_non_executable_price" in by_pick["Assumed ML"]["blockers"]
    assert by_pick["Assumed ML"]["estimate"] is None
    assert by_pick["One Side ML"]["price"]["tier"] == "C"
    assert "unverified_no_vig_probability" in by_pick["One Side ML"]["blockers"]
    assert by_pick["One Side ML"]["estimate"] is None
    assert by_pick["Stale ML"]["price"]["tier"] == "B"
    assert "stale_price" in by_pick["Stale ML"]["blockers"]


def test_three_and_zero_is_explicitly_insufficient():
    prior = []
    for offset in (3, 2, 1):
        slate = (date.fromisoformat(DATE) - timedelta(days=offset)).isoformat()
        prior.append(
            make_payload(
                [
                    make_pick(
                        pick=f"Winner {offset} ML",
                        game=f"Winner {offset} @ Other {offset}",
                        slate_date=slate,
                        result="win",
                        pick_id=f"w-{offset}",
                    )
                ],
                slate_date=slate,
            )
        )
    candidate = candidate_for(make_pick(), team_history=prior)
    assert candidate["shadowQualified"] is False
    assert candidate["evidence"]["sourceSamples"] == 3
    assert candidate["evidence"]["distinctDates"] == 3
    assert {
        "insufficient_source_samples",
        "insufficient_segment_samples",
        "insufficient_distinct_prior_dates",
    }.issubset(candidate["blockers"])


def test_history_excludes_same_date_and_future_even_when_supplied():
    payloads = []
    for slate in ("2026-07-09", DATE, "2026-07-11"):
        payloads.append(
            make_payload(
                [
                    make_pick(
                        pick=f"{slate} ML",
                        game=f"{slate} A @ {slate} B",
                        slate_date=slate,
                        result="win",
                        pick_id=slate,
                    )
                ],
                slate_date=slate,
            )
        )
    candidate = candidate_for(make_pick(), team_history=payloads)
    assert candidate["evidence"]["sourceSamples"] == 1
    assert candidate["evidence"]["priorOnly"] is True
    assert candidate["evidence"]["cutoffExclusive"] == DATE


def test_history_deduplicates_the_same_source_market_even_with_different_ids():
    prior_date = "2026-07-09"
    duplicate_a = make_pick(
        pick="Alpha ML",
        game="Alpha @ Bravo",
        slate_date=prior_date,
        result="win",
        pick_id="duplicate-a",
    )
    duplicate_b = dict(duplicate_a, id="duplicate-b")
    prior = make_payload([duplicate_a, duplicate_b], slate_date=prior_date)

    candidate = candidate_for(make_pick(), team_history=[prior])
    assert candidate["evidence"]["sourceSamples"] == 1
    assert candidate["evidence"]["segmentSamples"] == 1


def test_opposing_prop_directions_are_not_deduped_or_called_consensus():
    over = make_pick(
        pick="Ace Over 1.5 Hits",
        game="A @ B",
        player="Ace",
        direction="Over",
        line=1.5,
        market="hits",
    )
    under = make_pick(
        pick="Ace Under 1.5 Hits",
        game="A @ B",
        player="Ace",
        direction="Under",
        line=1.5,
        market="hits",
    )
    built = desk.build_profit_desk_payload(
        DATE,
        None,
        make_payload([over, under]),
        team_history=[],
        prop_history=[],
    )
    assert len(built["candidates"]) == 2
    assert {candidate["direction"] for candidate in built["candidates"]} == {"over", "under"}
    assert len({candidate["marketIdentity"] for candidate in built["candidates"]}) == 2
    assert all(candidate["duplicateCount"] == 1 for candidate in built["candidates"])
    assert all("consensus" not in candidate for candidate in built["candidates"])


def test_embedded_spread_lines_are_distinct_and_moneyline_prices_are_not_lines():
    short_spread = make_pick(
        pick="Alpha -1.5",
        game="Alpha @ Bravo",
        market="spread",
        line=None,
        odds=105,
    )
    long_spread = make_pick(
        pick="Alpha -2.5",
        game="Alpha @ Bravo",
        market="spread",
        line=None,
        odds=130,
    )
    built = desk.build_profit_desk_payload(
        DATE,
        make_payload([short_spread, long_spread]),
        None,
        team_history=[],
        prop_history=[],
    )
    assert len(built["candidates"]) == 2
    assert {candidate["line"] for candidate in built["candidates"]} == {-1.5, -2.5}
    assert len({candidate["marketIdentity"] for candidate in built["candidates"]}) == 2

    moneyline = make_pick(pick="Alpha +145", market="moneyline", odds=145)
    assert desk._line(moneyline, "side") is None


def test_identical_selections_keep_the_better_executable_price():
    shorter = make_pick(pick="Alpha ML", game="Alpha @ Bravo", odds=-110, source="Short Book")
    better = make_pick(pick="Alpha ML", game="Alpha @ Bravo", odds=105, source="Better Book")
    built = desk.build_profit_desk_payload(
        DATE,
        make_payload([shorter, better]),
        None,
        team_history=[],
        prop_history=[],
    )
    assert len(built["candidates"]) == 1
    candidate = built["candidates"][0]
    assert candidate["oddsAmerican"] == 105
    assert candidate["source"] == "Better Book"
    assert candidate["duplicateCount"] == 2


def test_high_raw_probability_cannot_override_negative_conservative_ev():
    target = date.fromisoformat(DATE)
    losing_history = []
    for day_index in range(20):
        slate = (target - timedelta(days=20 - day_index)).isoformat()
        picks = [
            make_pick(
                pick=f"Loser {day_index}-{row} ML",
                game=f"Loser {day_index}-{row} @ Other {day_index}-{row}",
                slate_date=slate,
                result="loss",
                pick_id=f"l-{day_index}-{row}",
            )
            for row in range(6)
        ]
        losing_history.append(make_payload(picks, slate_date=slate))
    candidate = candidate_for(
        make_pick(raw_probability=0.999), team_history=losing_history
    )
    assert candidate["rawModelProbabilityIgnored"] == 0.999
    assert candidate["estimate"]["conservativeExpectedValue"] < 0
    assert "non_positive_conservative_ev" in candidate["blockers"]
    assert candidate["tier"] == "avoid"


def test_positive_fixture_exposes_estimate_evidence_and_shadow_only_policy():
    built = desk.build_profit_desk_payload(
        DATE,
        make_payload([make_pick()]),
        None,
        team_history=history_payloads(),
        prop_history=[],
    )
    candidate = built["candidates"][0]
    assert candidate["tier"] == "shadow"
    assert candidate["stakeUnits"] == 0
    assert candidate["liveQualified"] is False
    assert candidate["price"]["tier"] == "B"
    assert candidate["estimate"]["probabilityPositiveEv"] >= 0.80
    assert (
        candidate["estimate"]["lowerProbability"]
        >= candidate["estimate"]["breakEvenProbability"] + 0.02
    )
    assert candidate["evidence"]["sourceSamples"] == 120
    assert candidate["evidence"]["segmentSamples"] == 120
    assert candidate["evidence"]["distinctDates"] == 20
    assert candidate["evidence"]["chronologicalHalvesNonnegative"] is True
    assert "model-v1" in candidate["evidence"]["sourceEvidenceKey"]
    assert "policy-v1" in candidate["evidence"]["segmentEvidenceKey"]
    assert built["policy"]["status"] == "SHADOW_ONLY"
    assert built["policy"]["firstLiveDate"] is None
    assert built["summary"]["liveQualified"] == 0
    assert built["summary"]["researchQualified"] == 1
    assert built["portfolio"]["live"] == []
    assert built["portfolio"]["shadow"][0]["stakeUnits"] == 0


def test_unversioned_selection_policy_cannot_qualify_even_with_large_history():
    history = history_payloads()
    for payload in history:
        for bucket in payload["models"].values():
            for pick in bucket["picks"]:
                pick.pop("policy_version", None)

    candidate = candidate_for(
        make_pick(policy_version=""),
        team_history=history,
    )
    assert candidate["evidence"]["sourceSamples"] == 120
    assert candidate["evidence"]["policyVersion"] == "unversioned"
    assert "missing_policy_version" in candidate["blockers"]
    assert candidate["shadowQualified"] is False
    assert candidate["liveQualified"] is False


def test_portfolio_caps_modes_and_uses_each_game_once():
    candidates = []
    for mode, count in (("team", 5), ("player", 5)):
        for index in range(count):
            game = "shared-game" if index == 0 else f"{mode}-game-{index}"
            candidates.append(
                {
                    "id": f"{mode}-{index}",
                    "mode": mode,
                    "canonicalGame": game,
                    "tier": "shadow",
                    "stakeUnits": 0.0,
                    "estimate": {
                        "conservativeExpectedValue": 0.20 - index / 100,
                        "probabilityPositiveEv": 0.99,
                    },
                    "evidence": {"segmentSamples": 120},
                }
            )
    portfolio = desk.select_portfolio(candidates)
    assert len(portfolio["team"]) <= 3
    assert len(portfolio["player"]) <= 3
    assert len(portfolio["all"]) <= 6
    games = [candidate["canonicalGame"] for candidate in portfolio["all"]]
    assert len(games) == len(set(games))
    assert portfolio["live"] == []
    assert portfolio["shadow"] == portfolio["all"]


def test_rebuild_respects_cutover_and_writes_deterministic_schema(tmp_path: Path):
    model_dir = tmp_path / "model"
    prop_dir = tmp_path / "props"
    output_dir = tmp_path / "profit"
    model_dir.mkdir()
    prop_dir.mkdir()
    before = "2026-07-09"
    (model_dir / f"{before}.json").write_text(
        json.dumps(make_payload([make_pick(slate_date=before)], slate_date=before)),
        encoding="utf-8",
    )
    (model_dir / f"{DATE}.json").write_text(
        json.dumps(make_payload([make_pick()])), encoding="utf-8"
    )

    changed = desk.rebuild_profit_desk(
        all_dates=True,
        model_cache_dir=model_dir,
        player_cache_dir=prop_dir,
        output_dir=output_dir,
    )
    assert changed == 3  # dated file, index, latest
    assert not (output_dir / f"{before}.json").exists()
    dated = json.loads((output_dir / f"{DATE}.json").read_text(encoding="utf-8"))
    latest = json.loads((output_dir / "latest.json").read_text(encoding="utf-8"))
    index = json.loads((output_dir / "index.json").read_text(encoding="utf-8"))
    assert dated == latest
    assert dated["engineVersion"] == desk.ENGINE_VERSION
    assert dated["generatedAt"] == f"{DATE}T12:00:00Z"
    assert index["files"] == [f"{DATE}.json"]
    assert index["cutoverDate"] == DATE

    unchanged = desk.rebuild_profit_desk(
        all_dates=True,
        model_cache_dir=model_dir,
        player_cache_dir=prop_dir,
        output_dir=output_dir,
    )
    assert unchanged == 0
