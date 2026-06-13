"""Top-level isolated player-props payload generator."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .api import DirectApiClient
from .basketball import generate_basketball_model
from .mlb import generate_mlb_model


def generate_payload(
    date_iso: str,
    *,
    client: Any | None = None,
    generated_at: str | None = None,
) -> dict[str, Any]:
    api = client or DirectApiClient()
    timestamp = generated_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return {
        "date": date_iso,
        "generatedAt": timestamp,
        "updatedAt": timestamp,
        "models": {
            "nba_player_props": generate_basketball_model(api, "nba", "NBA", date_iso),
            "wnba_player_props": generate_basketball_model(api, "wnba", "WNBA", date_iso),
            "mlb_player_props": generate_mlb_model(api, date_iso),
        },
    }
