from __future__ import annotations

from player_props.generator import generate_payload
from player_props.schema import decision_and_stake


DATE = "2026-06-12"
STAMP = "2026-06-12T12:00:00Z"


def _gamelog(name: str, values: list[list[str]]) -> dict:
    names = ["minutes", "points", "totalRebounds", "assists"]
    return {
        "names": names,
        "seasonTypes": [
            {
                "displayName": "2026 Regular Season",
                "categories": [
                    {
                        "type": "event",
                        "events": [
                            {"eventId": f"{name}-{index}", "stats": row}
                            for index, row in enumerate(values)
                        ],
                    }
                ],
            }
        ],
    }


def _statcast_rows(
    pitch_type: str,
    *,
    pitches: int,
    whiffs: int,
    strikeouts: int,
    hits: int = 0,
    outs: int = 0,
) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for index in range(pitches):
        description = "swinging_strike" if index < whiffs else "foul"
        event = ""
        if index < strikeouts:
            event = "strikeout"
        elif index < strikeouts + hits:
            event = "single"
        elif index < strikeouts + hits + outs:
            event = "field_out"
        rows.append({"pitch_type": pitch_type, "description": description, "events": event})
    return rows


def _market_pair(athlete_id: int, type_name: str, line: float, over_odds: int, under_odds: int) -> list[dict]:
    def row(odds: int) -> dict:
        return {
            "athlete": {
                "$ref": (
                    "http://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb/"
                    f"seasons/2026/athletes/{athlete_id}?lang=en&region=us"
                )
            },
            "type": {"name": type_name},
            "odds": {"american": {"value": f"{odds:+d}"}, "total": {"value": str(line)}},
            "current": {"target": {"value": line, "displayValue": str(line)}},
            "lastUpdated": STAMP,
        }

    return [row(over_odds), row(under_odds)]


class EmptyClient:
    def basketball_scoreboard(self, league, date_iso):
        return {"events": [], "season": {"year": 2026}}

    def mlb_schedule(self, date_iso):
        return {"dates": []}


class MockClient(EmptyClient):
    players = {
        "1": _gamelog("star", [["34", "22", "8", "5"]] * 6),
        "2": _gamelog("next", [["32", "18", "6", "7"], ["34", "24", "7", "9"]] * 3),
        "3": _gamelog("wing", [["30", "14", "5", "3"], ["31", "16", "6", "4"]] * 3),
        "4": _gamelog("center", [["29", "12", "11", "2"], ["30", "13", "12", "2"]] * 3),
        "5": _gamelog("roadstar", [["35", "21", "7", "6"], ["36", "25", "8", "7"]] * 3),
        "6": _gamelog("guard", [["31", "17", "4", "8"], ["32", "19", "5", "9"]] * 3),
        "7": _gamelog("forward", [["28", "15", "9", "3"], ["29", "17", "10", "4"]] * 3),
        "8": _gamelog("bench", [["24", "11", "4", "3"], ["25", "13", "5", "4"]] * 3),
    }

    def basketball_scoreboard(self, league, date_iso):
        if league == "nba":
            return {"events": [], "season": {"year": 2026}}
        return {
            "season": {"year": 2026},
            "events": [
                {
                    "id": "w1",
                    "date": "2026-06-12T23:30Z",
                    "competitions": [
                        {
                            "competitors": [
                                {"homeAway": "away", "team": {"id": "10", "displayName": "Away Club"}},
                                {"homeAway": "home", "team": {"id": "20", "displayName": "Home Club"}},
                            ]
                        }
                    ],
                }
            ],
        }

    def basketball_injuries(self, league):
        return {
            "injuries": [
                {
                    "injuries": [
                        {
                            "status": "Out",
                            "shortComment": "Unavailable",
                            "athlete": {"displayName": "Star Player"},
                        }
                    ]
                }
            ]
        }

    def basketball_roster(self, league, team_id):
        names = (
            [("1", "Star Player"), ("2", "Next Guard"), ("3", "Home Wing"), ("4", "Home Center")]
            if team_id == "20"
            else [("5", "Road Star"), ("6", "Road Guard"), ("7", "Road Forward"), ("8", "Road Bench")]
        )
        return {"athletes": [{"id": player_id, "displayName": name, "position": {"abbreviation": "G"}} for player_id, name in names]}

    def basketball_team_stats(self, league, team_id):
        return {
            "results": {
                "stats": {
                    "categories": [
                        {"stats": [{"name": "avgPoints", "value": 83}, {"name": "avgBlocks", "value": 5}, {"name": "avgSteals", "value": 7}]}
                    ]
                }
            }
        }

    def basketball_player_gamelog(self, league, player_id, season):
        return self.players[player_id]

    def mlb_schedule(self, date_iso):
        return {
            "dates": [
                {
                    "games": [
                        {
                            "gamePk": 99,
                            "gameDate": "2026-06-12T20:00Z",
                            "venue": {"id": 19, "name": "Test Park"},
                            "teams": {
                                "away": {"team": {"id": 1, "name": "Away Nine"}, "probablePitcher": {"id": 101, "fullName": "Away Pitcher"}},
                                "home": {"team": {"id": 2, "name": "Home Nine"}, "probablePitcher": {"id": 202, "fullName": "Home Pitcher"}},
                            },
                        }
                    ]
                }
            ]
        }

    def mlb_live_feed(self, game_pk):
        return {
            "gameData": {
                "venue": {"id": 19, "name": "Test Park"},
                "weather": {"condition": "Sunny", "temp": "82", "wind": "12 mph, Out To CF"},
            },
            "liveData": {"boxscore": {"teams": {"away": {}, "home": {}}}},
        }

    def mlb_roster(self, team_id, date_iso, season):
        return {
            "roster": [
                {
                    "person": {
                        "id": team_id * 10 + index,
                        "fullName": f"Hitter {team_id}-{index}",
                        "stats": [{
                            "splits": [{
                                "stat": {
                                    "atBats": 180,
                                    "hits": 55 - index,
                                    "runs": 40 - index,
                                    "rbi": 45 - index,
                                    "gamesPlayed": 55,
                                    "avg": ".300",
                                    "ops": ".820",
                                    "strikeOuts": 35 + index,
                                    "plateAppearances": 200,
                                }
                            }]
                        }],
                    },
                    "position": {"abbreviation": "OF"},
                }
                for index in range(4)
            ]
        }

    def mlb_player_stats(self, player_id, group, season):
        return {
            "stats": [
                {
                    "splits": [
                        {
                            "stat": {
                                "gamesStarted": 2 if player_id == 101 else 10,
                                "gamesPitched": 21 if player_id == 101 else 10,
                                "inningsPitched": "36.1" if player_id == 101 else "60.0",
                                "strikeOuts": 41 if player_id == 101 else 70,
                                "hitsPer9Inn": "5.20" if player_id == 101 else "8.10",
                            }
                        }
                    ]
                }
            ]
        }

    def mlb_h2h(self, batter_id, pitcher_id):
        if batter_id % 2:
            return {"stats": []}
        return {
            "stats": [
                {
                    "type": {"displayName": "vsPlayerTotal"},
                    "splits": [{"stat": {"atBats": 8, "hits": 3}}],
                }
            ]
        }

    def mlb_statcast_player_pitches(self, player_id, player_type, end_date_iso, days=45):
        if player_type == "pitcher":
            return (
                _statcast_rows("FC", pitches=36, whiffs=16, strikeouts=6, outs=10)
                + _statcast_rows("ST", pitches=24, whiffs=12, strikeouts=5, outs=8)
            )
        return (
            _statcast_rows("FC", pitches=22, whiffs=10, strikeouts=5, hits=2, outs=8)
            + _statcast_rows("ST", pitches=18, whiffs=8, strikeouts=4, hits=1, outs=6)
        )

    def mlb_statcast_team_pitches(self, team_abbr, end_date_iso, days=30):
        return (
            _statcast_rows("FC", pitches=42, whiffs=20, strikeouts=12, hits=3, outs=14)
            + _statcast_rows("ST", pitches=30, whiffs=14, strikeouts=9, hits=2, outs=9)
        )

    def mlb_espn_scoreboard(self, date_iso):
        return {
            "events": [{
                "id": "espn-99",
                "competitions": [{
                    "competitors": [
                        {"homeAway": "away", "team": {"displayName": "Away Nine"}},
                        {"homeAway": "home", "team": {"displayName": "Home Nine"}},
                    ],
                    "odds": [{"provider": {"id": "100", "name": "DraftKings"}}],
                }],
            }]
        }

    def mlb_espn_summary(self, event_id):
        athletes = [
            {"id": "101", "displayName": "Away Pitcher"},
            {"id": "202", "displayName": "Home Pitcher"},
            *[
                {"id": str(team_id * 10 + index), "displayName": f"Hitter {team_id}-{index}"}
                for team_id in (1, 2)
                for index in range(4)
            ],
        ]
        return {"rosters": [{"roster": [{"athlete": athlete} for athlete in athletes]}]}

    def mlb_espn_prop_bets(self, event_id, provider_id="100"):
        items = _market_pair(202, "Total Strikeouts", 6.5, 105, -125)
        for team_id in (1, 2):
            for index in range(4):
                athlete_id = team_id * 10 + index
                items.extend(_market_pair(athlete_id, "Total Hits", 0.5, -400, 280))
                items.extend(_market_pair(athlete_id, "Total Hits + Runs + RBIs", 1.5, 110, -135))
        return {"items": items}


def test_empty_leagues_are_healthy():
    payload = generate_payload(DATE, client=EmptyClient(), generated_at=STAMP)
    assert set(payload) == {"date", "generatedAt", "updatedAt", "models"}
    assert all(model["ok"] for model in payload["models"].values())
    assert all(model["picks"] == [] for model in payload["models"].values())


def test_refresh_script_blank_date_uses_central_today(monkeypatch):
    from scripts import refresh_player_props

    monkeypatch.setattr(refresh_player_props, "_default_central_date", lambda: "2026-06-13")
    assert refresh_player_props._target_date("") == "2026-06-13"
    assert refresh_player_props._target_date("   ") == "2026-06-13"
    assert refresh_player_props._target_date("2026-06-12") == "2026-06-12"


def test_basketball_props_are_stable_and_apply_next_man_up():
    first = generate_payload(DATE, client=MockClient(), generated_at=STAMP)
    second = generate_payload(DATE, client=MockClient(), generated_at="2026-06-12T13:00:00Z")
    picks = first["models"]["wnba_player_props"]["picks"]

    assert 5 <= len(picks) <= 8
    assert [pick["id"] for pick in picks] == [
        pick["id"] for pick in second["models"]["wnba_player_props"]["picks"]
    ]
    assert all(pick["scope"] == "player" and pick["result"] == "pending" for pick in picks)
    assert all(pick["player_name"] != "Star Player" for pick in picks)
    assert any("Next-man-up redistribution" in " ".join(pick["key_factors"]) for pick in picks)


def test_mlb_props_use_actual_markets_and_reject_reliever_starter_lines():
    payload = generate_payload(DATE, client=MockClient(), generated_at=STAMP)
    model = payload["models"]["mlb_player_props"]
    picks = model["picks"]

    assert model["ok"] is True
    assert 3 <= len(picks) <= 5
    assert "hits_runs_rbis" in {pick["stat_key"] for pick in picks}
    assert all(pick["odds"] != -110 and pick["decision"] in {"BET", "LEAN", "PASS"} for pick in picks)
    assert all(pick["market_source"] == "DraftKings via ESPN" for pick in picks)
    assert all(pick["market_implied_probability"] is not None for pick in picks)
    assert all(pick["player_name"] != "Away Pitcher" for pick in picks)
    assert all(not (pick["stat_key"] == "hits" and pick["line"] == 0.5) for pick in picks)
    assert any(pick.get("prop_role") == "batter_hrr" and pick["line"] == 1.5 for pick in picks)
    assert all("Venue Test Park" in " ".join(pick["key_factors"]) for pick in picks)
    assert all("Wind 12 mph, Out To CF" in " ".join(pick["key_factors"]) for pick in picks)


def test_units_follow_quarter_kelly_and_passes_are_zero():
    bet = decision_and_stake(0.64)
    passed = decision_and_stake(0.53)
    overpriced = decision_and_stake(0.64, -250)
    missing = decision_and_stake(0.75, None)
    assert bet[0] == "BET"
    assert bet[4] == min(2.0, round(bet[3] * 100.0, 2))
    assert passed[0] == "PASS"
    assert passed[4] == 0.0
    assert overpriced[0] == "PASS"
    assert missing == ("PASS", None, 0.0, 0.0, 0.0)
