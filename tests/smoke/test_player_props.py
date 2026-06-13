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
                        "stats": [{"splits": [{"stat": {"atBats": 180, "hits": 55 - index, "avg": ".300", "ops": ".820", "strikeOuts": 35 + index, "plateAppearances": 200}}]}],
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
                                "gamesStarted": 10,
                                "inningsPitched": "60.0",
                                "strikeOuts": 70,
                                "hitsPer9Inn": "8.10",
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


def test_mlb_props_are_gradeable_and_represent_h2h_environment():
    payload = generate_payload(DATE, client=MockClient(), generated_at=STAMP)
    model = payload["models"]["mlb_player_props"]
    picks = model["picks"]

    assert model["ok"] is True
    assert 3 <= len(picks) <= 5
    assert {"hits", "strikeouts"} == {pick["stat_key"] for pick in picks}
    assert all(pick["odds"] == -110 and pick["decision"] in {"BET", "LEAN", "PASS"} for pick in picks)
    hit_props = [pick for pick in picks if pick["stat_key"] == "hits"]
    assert hit_props and all("h2h" in pick for pick in hit_props)
    assert any("H2H available" in " ".join(pick["key_factors"]) for pick in hit_props)
    assert all("Venue Test Park" in " ".join(pick["key_factors"]) for pick in picks)
    assert all("Wind 12 mph, Out To CF" in " ".join(pick["key_factors"]) for pick in picks)


def test_units_follow_quarter_kelly_and_passes_are_zero():
    bet = decision_and_stake(0.64)
    passed = decision_and_stake(0.53)
    assert bet[0] == "BET"
    assert bet[4] == min(2.0, round(bet[3] * 100.0, 2))
    assert passed[0] == "PASS"
    assert passed[4] == 0.0
