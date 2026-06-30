from __future__ import annotations

import json
from pathlib import Path

from scripts.merge_player_props_cache_payload import merge_payload
from scripts.site_upcheck import _published_player_prop_keys


def _pick(
    pick_id: str,
    market_id: str,
    pick_text: str,
    *,
    selection: str = "Under",
    line: float = 0.5,
    consensus_qualified: bool = True,
    mode: str = "four_model_consensus_gate",
) -> dict:
    return {
        "id": pick_id,
        "scope": "player",
        "source": "MLBPlayerProps",
        "model_key": "mlb_player_props",
        "sport": "MLB",
        "date": "2026-06-20",
        "game_id": f"game-{market_id}",
        "player_id": f"player-{market_id}",
        "stat_key": "hits",
        "selection": selection,
        "line": line,
        "pick": pick_text,
        "matchup": "A @ B",
        "market_priced": True,
        "probability_source": "player_props_ml_v1",
        "decision": "BET",
        "ml_model_version": "player_props_consensus_v2.0.0",
        "ml_probability_mode": mode,
        "consensus_qualified": consensus_qualified,
        "ml_rank": 1,
        "ml_edge": 0.1,
        "ml_expected_value": 0.1,
        "ml_probability": 0.6,
        "result": "pending",
    }


def test_merge_keeps_current_and_snapshot_same_day_markets_visible(tmp_path: Path):
    cache_dir = tmp_path / "data" / "player_props_cache"
    snapshot_dir = tmp_path / "data" / "player_props_snapshots"
    cache_dir.mkdir(parents=True)
    (snapshot_dir / "2026-06-20").mkdir(parents=True)

    current = {
        "date": "2026-06-20",
        "models": {
            "mlb_player_props": {
                "ok": True,
                "ranking_epoch": "MLB:player_props_consensus_v2.0.0:published:test",
                "picks": [_pick(f"current-{index}", f"current-{index}", f"Current {index}") for index in range(8)],
            }
        },
    }
    snapshot = {
        "date": "2026-06-20",
        "models": {
            "mlb_player_props": {
                "ok": True,
                "picks": [_pick("snapshot-only", "snapshot-only", "Snapshot Only")],
            }
        },
    }
    generated = {
        "date": "2026-06-20",
        "models": {
            "mlb_player_props": {
                "ok": True,
                "ranking_epoch": "MLB:player_props_consensus_v2.0.0:published:test",
                "picks": [_pick(f"generated-{index}", f"generated-{index}", f"Generated {index}") for index in range(8)],
            }
        },
    }

    (cache_dir / "2026-06-20.json").write_text(json.dumps(current), encoding="utf-8")
    (snapshot_dir / "2026-06-20" / "snapshot.json").write_text(json.dumps(snapshot), encoding="utf-8")

    merged = merge_payload(generated, cache_dir, snapshot_dir)
    merged_picks = merged["models"]["mlb_player_props"]["picks"]
    merged_keys = _published_player_prop_keys(merged, "2026-06-20")
    expected_keys = (
        _published_player_prop_keys(current, "2026-06-20")
        | _published_player_prop_keys(snapshot, "2026-06-20")
        | _published_player_prop_keys(generated, "2026-06-20")
    )

    assert merged_keys == expected_keys
    assert len(merged_picks) == len(expected_keys)
    assert [pick["ml_rank"] for pick in merged_picks] == list(range(1, len(merged_picks) + 1))


def test_merge_does_not_force_rejected_variant_snapshots_into_latest_board(tmp_path: Path):
    cache_dir = tmp_path / "data" / "player_props_cache"
    snapshot_dir = tmp_path / "data" / "player_props_snapshots"
    cache_dir.mkdir(parents=True)
    (snapshot_dir / "2026-06-20").mkdir(parents=True)

    snapshot = {
        "date": "2026-06-20",
        "models": {
            "mlb_player_props": {
                "ok": True,
                "picks": [
                    _pick(
                        "fallback-snapshot",
                        "fallback-snapshot",
                        "Rejected Variant",
                        consensus_qualified=False,
                        mode="all_time_variant",
                    )
                ],
            }
        },
    }
    generated = {
        "date": "2026-06-20",
        "models": {
            "mlb_player_props": {
                "ok": True,
                "ranking_epoch": "MLB:player_props_consensus_v2.0.0:published:test",
                "picks": [_pick("generated", "generated", "Generated")],
            }
        },
    }

    (cache_dir / "2026-06-20.json").write_text(json.dumps({"date": "2026-06-20", "models": {}}), encoding="utf-8")
    (snapshot_dir / "2026-06-20" / "snapshot.json").write_text(json.dumps(snapshot), encoding="utf-8")

    merged = merge_payload(generated, cache_dir, snapshot_dir)
    picks = merged["models"]["mlb_player_props"]["picks"]

    assert [pick["id"] for pick in picks] == ["generated"]
