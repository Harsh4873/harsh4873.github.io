"""Direct ESPN and MLB StatsAPI client used by the player-props generator."""

from __future__ import annotations

import time
from typing import Any

import requests


class DirectApiClient:
    """Small retrying client with an in-memory response cache."""

    def __init__(self, timeout: float = 20.0, attempts: int = 3) -> None:
        self.timeout = timeout
        self.attempts = max(1, attempts)
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": "PickLedgerPro-player-props/1.0"})
        self._cache: dict[tuple[str, tuple[tuple[str, str], ...]], dict[str, Any]] = {}

    def _get(self, url: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        normalized = tuple(sorted((str(key), str(value)) for key, value in (params or {}).items()))
        cache_key = (url, normalized)
        if cache_key in self._cache:
            return self._cache[cache_key]

        last_error: Exception | None = None
        for attempt in range(self.attempts):
            try:
                response = self.session.get(url, params=params, timeout=self.timeout)
                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, dict):
                    raise ValueError(f"Expected object response from {url}")
                self._cache[cache_key] = payload
                return payload
            except (requests.RequestException, ValueError) as exc:
                last_error = exc
                if attempt + 1 < self.attempts:
                    time.sleep(0.5 * (attempt + 1))
        raise RuntimeError(f"Direct API request failed for {url}: {last_error}") from last_error

    def basketball_scoreboard(self, league: str, date_iso: str) -> dict[str, Any]:
        return self._get(
            f"https://site.api.espn.com/apis/site/v2/sports/basketball/{league}/scoreboard",
            {"dates": date_iso.replace("-", ""), "limit": 100},
        )

    def basketball_roster(self, league: str, team_id: str) -> dict[str, Any]:
        return self._get(
            f"https://site.api.espn.com/apis/site/v2/sports/basketball/{league}/teams/{team_id}/roster"
        )

    def basketball_injuries(self, league: str) -> dict[str, Any]:
        return self._get(
            f"https://site.api.espn.com/apis/site/v2/sports/basketball/{league}/injuries"
        )

    def basketball_team_stats(self, league: str, team_id: str) -> dict[str, Any]:
        return self._get(
            f"https://site.api.espn.com/apis/site/v2/sports/basketball/{league}/teams/{team_id}/statistics"
        )

    def basketball_player_gamelog(
        self,
        league: str,
        player_id: str,
        season: int,
    ) -> dict[str, Any]:
        return self._get(
            f"https://site.web.api.espn.com/apis/common/v3/sports/basketball/{league}/athletes/{player_id}/gamelog",
            {"season": season},
        )

    def mlb_schedule(self, date_iso: str) -> dict[str, Any]:
        return self._get(
            "https://statsapi.mlb.com/api/v1/schedule",
            {"sportId": 1, "date": date_iso, "hydrate": "probablePitcher,venue"},
        )

    def mlb_live_feed(self, game_pk: int) -> dict[str, Any]:
        return self._get(f"https://statsapi.mlb.com/api/v1.1/game/{game_pk}/feed/live")

    def mlb_roster(self, team_id: int, date_iso: str, season: int) -> dict[str, Any]:
        return self._get(
            f"https://statsapi.mlb.com/api/v1/teams/{team_id}/roster",
            {
                "rosterType": "active",
                "date": date_iso,
                "hydrate": f"person(stats(group=[hitting],type=[season],season={season}))",
            },
        )

    def mlb_player_stats(self, player_id: int, group: str, season: int) -> dict[str, Any]:
        return self._get(
            f"https://statsapi.mlb.com/api/v1/people/{player_id}/stats",
            {"stats": "season", "group": group, "season": season},
        )

    def mlb_h2h(self, batter_id: int, pitcher_id: int) -> dict[str, Any]:
        return self._get(
            f"https://statsapi.mlb.com/api/v1/people/{batter_id}/stats",
            {"stats": "vsPlayer", "group": "hitting", "opposingPlayerId": pitcher_id},
        )
