from __future__ import annotations

from copy import deepcopy
from typing import Any


class FakeDocumentSnapshot:
    def __init__(self, doc_id: str, data: dict[str, Any] | None):
        self.id = doc_id
        self._data = deepcopy(data) if data is not None else None
        self.exists = data is not None

    def to_dict(self) -> dict[str, Any] | None:
        return deepcopy(self._data) if self._data is not None else None


class FakeDocumentReference:
    def __init__(self, store: dict[str, dict[str, Any]], doc_id: str):
        self._store = store
        self._doc_id = doc_id

    def get(self) -> FakeDocumentSnapshot:
        return FakeDocumentSnapshot(self._doc_id, self._store.get(self._doc_id))

    def set(self, payload: dict[str, Any], merge: bool = False) -> None:
        if merge:
            current = self._store.setdefault(self._doc_id, {})
            current.update(deepcopy(payload))
            return
        self._store[self._doc_id] = deepcopy(payload)


class FakeCollectionReference:
    def __init__(self, store: dict[str, dict[str, Any]]):
        self._store = store

    def stream(self) -> list[FakeDocumentSnapshot]:
        return [
            FakeDocumentSnapshot(doc_id, data)
            for doc_id, data in self._store.items()
        ]

    def document(self, doc_id: str) -> FakeDocumentReference:
        return FakeDocumentReference(self._store, doc_id)


class FakeFirestoreClient:
    def __init__(self, users: dict[str, dict[str, Any]]):
        self.users = users

    def collection(self, name: str) -> FakeCollectionReference:
        assert name == "users"
        return FakeCollectionReference(self.users)


def test_background_grader_preserves_existing_record(monkeypatch):
    import pickgrader_server

    record = {"wins": 604, "losses": 531, "pushes": 0}
    users = {
        "test-pickledger-smoke": {
            "record": deepcopy(record),
            "picks": [
                {
                    "id": "smoke-pick",
                    "sport": "NBA",
                    "date": "Jan 1",
                    "pick": "Lakers ML (Lakers vs Celtics)",
                }
            ],
            "results": {"smoke-pick": "pending"},
            "startTimes": {},
            "ledger": {
                "addedPicks": [],
                "results": {"smoke-pick": "pending"},
                "gameTimes": {},
            },
        }
    }

    monkeypatch.setattr(
        pickgrader_server,
        "_get_firestore_client",
        lambda: FakeFirestoreClient(users),
    )
    monkeypatch.setattr(
        pickgrader_server,
        "auto_grade",
        lambda picks, existing, year: {
            "graded": {"smoke-pick": "win"},
            "startTimes": {"smoke-pick": "2025-01-01T20:00:00Z"},
            "summary": {"attempted": 1, "updated": 1, "remaining": 0},
        },
    )

    summary = pickgrader_server.run_background_grade_all_users()

    assert summary["graded_users"] == 1
    assert not summary["errors"]
    user_doc = users["test-pickledger-smoke"]
    assert user_doc["record"] == record
    assert user_doc["results"]["smoke-pick"] == "win"
    assert user_doc["ledger"]["results"]["smoke-pick"] == "win"
    assert user_doc["startTimes"]["smoke-pick"] == "2025-01-01T20:00:00Z"
    assert "lastGraded" in user_doc


def test_grade_pick_moneyline_result_without_network():
    import pickgrader_server

    game = {
        "competitors": [
            {
                "raw": {
                    "team": {
                        "displayName": "Los Angeles Lakers",
                        "shortDisplayName": "Lakers",
                        "name": "Lakers",
                        "abbreviation": "LAL",
                    }
                },
                "score": 112,
                "homeAway": "home",
                "linescores": [],
            },
            {
                "raw": {
                    "team": {
                        "displayName": "Boston Celtics",
                        "shortDisplayName": "Celtics",
                        "name": "Celtics",
                        "abbreviation": "BOS",
                    }
                },
                "score": 100,
                "homeAway": "away",
                "linescores": [],
            },
        ],
        "startTime": "2025-01-01T20:00:00Z",
        "eventId": "smoke",
    }
    pick = {
        "id": "smoke-pick",
        "sport": "NBA",
        "pick": "Lakers ML (Lakers vs Celtics)",
    }

    assert pickgrader_server.grade_pick(pick, game) == "win"
    assert pickgrader_server.grade_pick(
        {**pick, "pick": "Lakers to Win (Lakers vs Celtics)"},
        game,
    ) == "win"


def test_soccer_three_way_moneyline_loses_on_draw():
    import pickgrader_server

    game = {
        "competitors": [
            {
                "raw": {"team": {"displayName": "Brazil", "name": "Brazil", "abbreviation": "BRA"}},
                "score": 1,
                "homeAway": "home",
                "linescores": [],
            },
            {
                "raw": {"team": {"displayName": "Morocco", "name": "Morocco", "abbreviation": "MAR"}},
                "score": 1,
                "homeAway": "away",
                "linescores": [],
            },
        ],
        "startTime": "2026-06-13T22:00:00Z",
        "eventId": "wc-smoke",
    }
    pick = {
        "id": "wc-moneyline",
        "sport": "FIFA WC",
        "pick": "Brazil ML (Morocco @ Brazil)",
        "market_type": "soccer_moneyline",
    }

    assert pickgrader_server.grade_pick(pick, game) == "loss"


def test_auto_grade_accepts_iso_dates_and_pushes_canceled_games(monkeypatch):
    import pickgrader_server

    scoreboard = {
        "events": [
            {
                "id": "canceled-smoke",
                "competitions": [
                    {
                        "date": "2026-06-08T20:00:00Z",
                        "status": {"type": {"completed": False, "name": "STATUS_CANCELED"}},
                        "competitors": [
                            {
                                "score": "0",
                                "homeAway": "home",
                                "team": {
                                    "displayName": "Los Angeles Lakers",
                                    "shortDisplayName": "Lakers",
                                    "name": "Lakers",
                                    "abbreviation": "LAL",
                                },
                            },
                            {
                                "score": "0",
                                "homeAway": "away",
                                "team": {
                                    "displayName": "Boston Celtics",
                                    "shortDisplayName": "Celtics",
                                    "name": "Celtics",
                                    "abbreviation": "BOS",
                                },
                            },
                        ],
                    }
                ],
            }
        ]
    }
    monkeypatch.setattr(pickgrader_server, "fetch_scoreboard", lambda *_: scoreboard)

    result = pickgrader_server.auto_grade(
        [
            {
                "id": "iso-date-pick",
                "sport": "NBA",
                "date": "2026-06-08",
                "pick": "Lakers ML (Lakers vs Celtics)",
            }
        ],
        {},
        2026,
    )

    assert pickgrader_server.parse_pick_date("2026-06-08", 2026) == "20260608"
    assert result["graded"] == {"iso-date-pick": "push"}
    assert result["startTimes"] == {"iso-date-pick": "2026-06-08T20:00:00Z"}


def test_grade_mlb_first_five_markets_without_network():
    import pickgrader_server

    game = {
        "competitors": [
            {
                "raw": {
                    "team": {
                        "displayName": "Boston Red Sox",
                        "shortDisplayName": "Red Sox",
                        "name": "Red Sox",
                        "abbreviation": "BOS",
                    }
                },
                "score": 4,
                "homeAway": "home",
                "linescores": [
                    {"value": 1}, {"value": 0}, {"value": 1}, {"value": 0}, {"value": 0},
                    {"value": 2}, {"value": 0}, {"value": 0}, {"value": 0},
                ],
            },
            {
                "raw": {
                    "team": {
                        "displayName": "Tampa Bay Rays",
                        "shortDisplayName": "Rays",
                        "name": "Rays",
                        "abbreviation": "TB",
                    }
                },
                "score": 3,
                "homeAway": "away",
                "linescores": [
                    {"value": 0}, {"value": 0}, {"value": 0}, {"value": 1}, {"value": 0},
                    {"value": 0}, {"value": 1}, {"value": 1}, {"value": 0},
                ],
            },
        ],
        "startTime": "2026-05-10T17:35:00Z",
        "eventId": "mlb-f5-smoke",
    }

    assert pickgrader_server.grade_pick(
        {"sport": "MLB", "pick": "Boston Red Sox F5 ML", "team": "Boston Red Sox", "market": "f5_side"},
        game,
    ) == "win"
    assert pickgrader_server.grade_pick(
        {"sport": "MLB", "pick": "Under 4.5 F5", "market": "f5_total"},
        game,
    ) == "win"


def test_grade_structured_wnba_player_prop_from_boxscore():
    import pickgrader_server

    summary = {
        "boxscore": {
            "players": [{
                "statistics": [{
                    "labels": ["MIN", "PTS", "REB", "AST"],
                    "athletes": [{
                        "athlete": {"displayName": "Brittney Sykes"},
                        "stats": ["34", "24", "5", "7"],
                    }],
                }],
            }],
        },
    }
    pick = {
        "scope": "player",
        "sport": "WNBA",
        "player_name": "Brittney Sykes",
        "stat_key": "points",
        "selection": "OVER",
        "line": 20.5,
        "pick": "Brittney Sykes points OVER 20.5 vs Tempo",
    }

    assert pickgrader_server.parse_player_prop_pick(pick)["stat_key"] == "points"
    assert pickgrader_server.parse_nba_player_prop_pick(pick["pick"])["stat_key"] == "points"
    assert pickgrader_server.grade_player_prop_pick(pick, {}, summary) == "win"


def test_grade_structured_mlb_player_props_from_boxscore():
    import pickgrader_server

    summary = {
        "boxscore": {
            "players": [{
                "statistics": [
                    {
                        "labels": ["H-AB", "H", "K"],
                        "athletes": [{
                            "athlete": {"displayName": "Otto Lopez"},
                            "stats": ["2-4", "2", "1"],
                        }],
                    },
                    {
                        "labels": ["IP", "H", "K"],
                        "athletes": [{
                            "athlete": {"displayName": "Sandy Alcantara"},
                            "stats": ["6.0", "5", "7"],
                        }],
                    },
                ],
            }],
        },
    }
    hitter = {
        "scope": "player",
        "sport": "MLB",
        "player_name": "Otto Lopez",
        "stat_key": "hits",
        "selection": "OVER",
        "line": 0.5,
        "pick": "Otto Lopez hits OVER 0.5 vs Pirates",
    }
    pitcher = {
        "scope": "player",
        "sport": "MLB",
        "player_name": "Sandy Alcantara",
        "stat_key": "strikeouts",
        "selection": "OVER",
        "line": 5.5,
        "pick": "Sandy Alcantara strikeouts OVER 5.5 vs Pirates",
    }

    assert pickgrader_server.grade_player_prop_pick(hitter, {}, summary) == "win"
    assert pickgrader_server.grade_player_prop_pick(pitcher, {}, summary) == "win"
