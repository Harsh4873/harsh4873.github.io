#!/usr/bin/env python3
"""MLB-team-only consensus publication gate.

The three MLB team publishers still generate their native projections, but
their public BET/LEAN decisions must clear this post-calibration gate before
the static board or rankings can treat them as bettable output.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from scripts.pick_calibration import american_implied_probability, normalize_probability


REPO_ROOT = Path(__file__).resolve().parents[1]
OUTCOME_LEDGER_PATH = REPO_ROOT / "data" / "calibration" / "outcome_ledger.json"
MLB_TEAM_MODEL_KEYS = {"mlb_new", "mlb_first_five", "mlb_inning"}
MLB_TEAM_CONSENSUS_VERSION = "mlb_team_consensus_v1.0.0"
MLB_TEAM_RANKING_EPOCH_PREFIX = f"MLB:{MLB_TEAM_CONSENSUS_VERSION}"
MIN_WALK_FORWARD_SAMPLES = 30

MODEL_BET_TYPE_DEFAULTS = {
    "mlb_new": "h2h",
    "mlb_first_five": "f5_side",
    "mlb_inning": "no_run_inning",
}

PUBLICATION_THRESHOLDS = {
    "mlb_new": {"lean_edge": 3.0, "bet_edge": 7.0, "lean_prob": 0.53, "bet_prob": 0.56, "lean_signals": 3, "bet_signals": 4},
    "mlb_first_five": {"lean_edge": 3.0, "bet_edge": 7.0, "lean_prob": 0.54, "bet_prob": 0.58, "lean_signals": 4, "bet_signals": 5},
    "mlb_inning": {"lean_edge": 5.0, "bet_edge": 10.0, "lean_prob": 0.55, "bet_prob": 0.60, "lean_signals": 4, "bet_signals": 5},
}


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _bet_type(pick: dict[str, Any], model_key: str) -> str:
    for field in ("market", "market_type", "bet_type"):
        value = str(pick.get(field) or "").strip().lower()
        if value:
            return value
    return MODEL_BET_TYPE_DEFAULTS.get(model_key, "other")


def _game_key(pick: dict[str, Any]) -> str:
    for field in ("game_id", "matchup", "game"):
        value = str(pick.get(field) or "").strip()
        if value:
            return value.lower()
    return ""


def _game_lookup(bucket: dict[str, Any]) -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}
    for game in bucket.get("games") or []:
        if not isinstance(game, dict):
            continue
        for field in ("game_id", "matchup", "game"):
            value = str(game.get(field) or "").strip()
            if value:
                lookup[value.lower()] = game
    return lookup


def _line_is_assumed(pick: dict[str, Any]) -> bool:
    pricing = str(pick.get("pricing_type") or "").strip().lower()
    odds_source = str(pick.get("odds_source") or "").strip().lower()
    line_source = str(pick.get("line_source") or "").strip().lower()
    return (
        pricing == "assumed"
        or odds_source == "default_assumed"
        or line_source in {"in_house_projection", "in_house_probability_baseline", "model_generated"}
        or pick.get("market_priced") is False
    )


def _reliable_market_price(pick: dict[str, Any], model_key: str) -> bool:
    if model_key in {"mlb_first_five", "mlb_inning"} and _line_is_assumed(pick):
        return False
    if normalize_probability(pick.get("market_pick_prob")) is not None:
        return True
    if normalize_probability(pick.get("market_probability")) is not None:
        return True
    if normalize_probability(pick.get("market_implied_probability")) is not None:
        return True
    odds = _number(pick.get("odds"))
    if odds is None:
        return False
    if model_key == "mlb_new":
        return True
    return not _line_is_assumed(pick)


def _selected_side_implied_probability(pick: dict[str, Any], model_key: str) -> float | None:
    for field in ("market_pick_prob", "market_probability", "market_implied_probability"):
        probability = normalize_probability(pick.get(field))
        if probability is not None:
            return probability
    if not _reliable_market_price(pick, model_key):
        return None
    return american_implied_probability(pick.get("odds"))


def _calibrated_probability(pick: dict[str, Any]) -> float | None:
    for field in ("calibrated_probability", "probability", "model_probability", "predicted_probability"):
        probability = normalize_probability(pick.get(field))
        if probability is not None:
            return probability
    return None


def _raw_probability(pick: dict[str, Any]) -> float | None:
    for field in ("raw_probability", "model_probability", "predicted_probability", "probability"):
        probability = normalize_probability(pick.get(field))
        if probability is not None:
            return probability
    return None


def _calibrated_edge(pick: dict[str, Any], implied: float | None) -> float | None:
    edge = _number(pick.get("edge"))
    if edge is not None:
        return edge
    probability = _calibrated_probability(pick)
    if probability is not None and implied is not None:
        return (probability - implied) * 100.0
    return None


def _walk_forward_performance(ledger_path: Path = OUTCOME_LEDGER_PATH) -> dict[tuple[str, str], dict[str, Any]]:
    ledger = _read_json(ledger_path) or {}
    records = ledger.get("records") if isinstance(ledger.get("records"), list) else []
    groups: dict[tuple[str, str], dict[str, Any]] = {}
    for record in records:
        if not isinstance(record, dict):
            continue
        model_key = str(record.get("model_key") or "").strip()
        if model_key not in MLB_TEAM_MODEL_KEYS or record.get("result") not in {"win", "loss"}:
            continue
        bet_type = str(record.get("bet_type") or MODEL_BET_TYPE_DEFAULTS.get(model_key, "other")).strip().lower()
        key = (model_key, bet_type)
        group = groups.setdefault(key, {"samples": 0, "wins": 0, "losses": 0, "profit": 0.0, "stake": 0.0})
        group["samples"] += 1
        if record.get("result") == "win":
            group["wins"] += 1
        else:
            group["losses"] += 1
        group["profit"] += float(record.get("profit") or 0.0)
        group["stake"] += abs(float(record.get("raw_units") or record.get("units") or 1.0))
    for group in groups.values():
        samples = int(group["samples"] or 0)
        stake = float(group["stake"] or 0.0)
        group["win_rate"] = (float(group["wins"]) / samples) if samples else None
        group["roi"] = (float(group["profit"]) / stake) if stake else None
        group["qualified"] = (
            samples >= MIN_WALK_FORWARD_SAMPLES
            and (
                float(group.get("profit") or 0.0) > 0
                or ((group.get("win_rate") or 0.0) >= 0.53 and (group.get("roi") is None or group.get("roi") >= -0.01))
            )
        )
    return groups


def _performance_for(
    performance: dict[tuple[str, str], dict[str, Any]],
    model_key: str,
    bet_type: str,
) -> dict[str, Any]:
    exact = performance.get((model_key, bet_type))
    if exact:
        return exact
    return performance.get((model_key, MODEL_BET_TYPE_DEFAULTS.get(model_key, "other")), {"samples": 0, "qualified": False})


def _matching_game(pick: dict[str, Any], lookup: dict[str, dict[str, Any]]) -> dict[str, Any]:
    key = _game_key(pick)
    return lookup.get(key, {}) if key else {}


def _add_signal(signals: list[dict[str, Any]], name: str, detail: str, strength: float = 1.0) -> None:
    signals.append({"name": name, "detail": detail, "strength": round(float(strength), 3)})


def _f5_signals(pick: dict[str, Any], game: dict[str, Any], signals: list[dict[str, Any]]) -> None:
    features = game.get("features") if isinstance(game.get("features"), dict) else {}
    market = str(pick.get("market") or "").lower()
    side_team = str(pick.get("team") or "").strip()
    away_team = str(pick.get("away_team") or game.get("away_team") or "").strip()
    home_team = str(pick.get("home_team") or game.get("home_team") or "").strip()
    side_prefix = "away" if side_team and side_team == away_team else "home" if side_team and side_team == home_team else ""
    offense = features.get(f"{side_prefix}_offense") if side_prefix and isinstance(features.get(f"{side_prefix}_offense"), dict) else {}
    lineup = features.get(f"{side_prefix}_lineup_matchup") if side_prefix and isinstance(features.get(f"{side_prefix}_lineup_matchup"), dict) else {}
    pitcher_key = "home_pitcher" if side_prefix == "away" else "away_pitcher" if side_prefix == "home" else ""
    pitcher = features.get(pitcher_key) if pitcher_key and isinstance(features.get(pitcher_key), dict) else {}
    venue = features.get("venue") if isinstance(features.get("venue"), dict) else {}

    if pitcher and int(pitcher.get("current_starts") or 0) >= 3:
        _add_signal(signals, "starting_pitcher", "starter sample and rest profile available")
    if lineup and int(lineup.get("sampled_batters") or 0) >= 7:
        _add_signal(signals, "lineup_offense", "lineup matchup covers at least seven expected hitters")
    if offense and (offense.get("pitcher_rest_days") is not None or offense.get("pitcher_rest_label")):
        _add_signal(signals, "travel_rest_schedule", "starter rest and schedule context present")
    if venue and (int(venue.get("games") or 0) >= 20 or venue.get("park_blend") or venue.get("wind_mph") is not None):
        _add_signal(signals, "park_weather", "park and weather run-environment context present")
    if market == "f5_total" and _number(pick.get("line")) is not None and _number(pick.get("edge")) is not None:
        _add_signal(signals, "run_environment_gap", "projected F5 total differs from market line")


def _inning_signals(pick: dict[str, Any], game: dict[str, Any], signals: list[dict[str, Any]]) -> None:
    inning = int(_number(pick.get("inning")) or 0)
    edge_pp = _number(pick.get("edge_pp")) or _number(pick.get("raw_edge")) or 0.0
    if edge_pp >= 3.0:
        _add_signal(signals, "inning_baseline_edge", "scoreless probability beats inning baseline")
    if inning and inning <= 6 and game.get("home_pitcher") and game.get("away_pitcher"):
        _add_signal(signals, "starting_pitcher", "starter inning profile is applicable")
    if inning >= 7:
        _add_signal(signals, "bullpen_condition", "late inning depends on bullpen workload/fatigue model")
    if game.get("venue_factor") is not None:
        _add_signal(signals, "park_weather", "venue factor included in inning projection")
    if isinstance(game.get("full_inning_table"), dict) and len(game.get("full_inning_table") or {}) >= 6:
        _add_signal(signals, "matchup_structure", "full inning table available for matchup shape")


def _base_signals(
    pick: dict[str, Any],
    model_key: str,
    bucket: dict[str, Any],
    game: dict[str, Any],
    probability: float | None,
    edge: float | None,
    implied: float | None,
    performance: dict[str, Any],
) -> list[dict[str, Any]]:
    signals: list[dict[str, Any]] = []
    if implied is not None and edge is not None and edge > 0:
        _add_signal(signals, "market_price", "calibrated probability beats selected-side market price", edge / 10.0)
    calibration = pick.get("calibration") if isinstance(pick.get("calibration"), dict) else {}
    if calibration.get("applied") is True and int(calibration.get("samples") or 0) >= 30:
        _add_signal(signals, "probability_calibration", "active calibration group has enough samples")
    if performance.get("qualified") is True:
        _add_signal(signals, "walk_forward_validation", "model family has positive decided history in the gated era input")
    if model_key == "mlb_new":
        artifact_status = bucket.get("artifact_status") if isinstance(bucket.get("artifact_status"), dict) else {}
        if artifact_status.get("ready") is True or str(bucket.get("model_stack") or "").lower() == "v2":
            _add_signal(signals, "model_stack_ready", "MLB full-game v2 artifacts are ready")
        if probability is not None and probability >= 0.55:
            _add_signal(signals, "team_strength", "model probability has meaningful separation from coin-flip")
    elif model_key == "mlb_first_five":
        _f5_signals(pick, game, signals)
    elif model_key == "mlb_inning":
        _inning_signals(pick, game, signals)
    return signals


def evaluate_mlb_team_pick(
    pick: dict[str, Any],
    model_key: str,
    bucket: dict[str, Any] | None = None,
    *,
    performance: dict[tuple[str, str], dict[str, Any]] | None = None,
    game_lookup: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    bucket = bucket or {}
    performance = performance or _walk_forward_performance()
    lookup = game_lookup if game_lookup is not None else _game_lookup(bucket)
    bet_type = _bet_type(pick, model_key)
    thresholds = PUBLICATION_THRESHOLDS.get(model_key, PUBLICATION_THRESHOLDS["mlb_new"])
    implied = _selected_side_implied_probability(pick, model_key)
    probability = _calibrated_probability(pick)
    raw_probability = _raw_probability(pick)
    edge = _calibrated_edge(pick, implied)
    raw_decision = str((pick.get("pregame_snapshot") or {}).get("decision") if isinstance(pick.get("pregame_snapshot"), dict) else pick.get("decision") or "").upper()
    family_performance = _performance_for(performance, model_key, bet_type)
    game = _matching_game(pick, lookup)
    signals = _base_signals(pick, model_key, bucket, game, probability, edge, implied, family_performance)

    hard_blockers: list[str] = []
    if raw_decision == "PASS":
        hard_blockers.append("raw_model_abstained")
    if probability is None:
        hard_blockers.append("missing_calibrated_probability")
    if not _reliable_market_price(pick, model_key):
        hard_blockers.append("missing_reliable_market_price")
    if implied is None:
        hard_blockers.append("missing_selected_side_implied_probability")
    if edge is None or edge <= 0:
        hard_blockers.append("non_positive_calibrated_edge")
    calibration = pick.get("calibration") if isinstance(pick.get("calibration"), dict) else {}
    if calibration and int(calibration.get("samples") or 0) < 30:
        hard_blockers.append("insufficient_calibration_samples")
    if not family_performance.get("qualified"):
        hard_blockers.append("failed_walk_forward_validation")
    if model_key == "mlb_new" and bucket.get("warnings"):
        hard_blockers.append("model_artifact_warning")
    if model_key in {"mlb_first_five", "mlb_inning"} and _line_is_assumed(pick):
        hard_blockers.append("unsupported_assumed_price")

    signal_count = len({signal["name"] for signal in signals})
    decision = "PASS"
    actionability = "research_signal"
    if not hard_blockers and probability is not None and edge is not None:
        if (
            edge >= thresholds["bet_edge"]
            and probability >= thresholds["bet_prob"]
            and signal_count >= thresholds["bet_signals"]
        ):
            decision = "BET"
            actionability = "bettable"
        elif (
            edge >= thresholds["lean_edge"]
            and probability >= thresholds["lean_prob"]
            and signal_count >= thresholds["lean_signals"]
        ):
            decision = "LEAN"
            actionability = "lean"

    rejection_reason = None
    if decision == "PASS":
        reasons = hard_blockers or [
            f"edge_signal_threshold_not_met(edge={edge}, probability={probability}, signals={signal_count})"
        ]
        rejection_reason = "; ".join(str(reason) for reason in reasons)

    consensus_score = 0.0
    if probability is not None and edge is not None:
        consensus_score = round(max(0.0, edge) + max(0.0, probability - 0.5) * 100.0 + signal_count * 2.5, 3)

    return {
        "model_key": model_key,
        "bet_type": bet_type,
        "decision": decision,
        "actionability": actionability,
        "consensus_passed": decision in {"BET", "LEAN"},
        "consensus_score": consensus_score,
        "consensus_rejection_reason": rejection_reason,
        "hard_blockers": hard_blockers,
        "signals": signals,
        "signal_count": signal_count,
        "market_no_vig_probability": implied,
        "selected_side_implied_probability": implied,
        "raw_model_probability": raw_probability,
        "calibrated_model_probability": probability,
        "calibrated_edge": edge,
        "walk_forward": family_performance,
    }


def _stake_units(pick: dict[str, Any], decision: str) -> float:
    if decision == "PASS":
        return 0.0
    raw_units = _number(pick.get("raw_units"))
    if raw_units is None:
        raw_units = _number((pick.get("pregame_snapshot") or {}).get("units")) if isinstance(pick.get("pregame_snapshot"), dict) else None
    if raw_units is None:
        raw_units = _number(pick.get("units"))
    if raw_units is None or raw_units <= 0:
        return 0.25 if decision == "LEAN" else 0.5
    return round(min(1.5, raw_units if decision == "BET" else raw_units * 0.6), 2)


def apply_mlb_team_consensus_to_payload(
    payload: dict[str, Any],
    *,
    performance: dict[tuple[str, str], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    models = payload.get("models")
    if not isinstance(models, dict):
        return payload
    performance = performance or _walk_forward_performance()
    for model_key, bucket in models.items():
        if model_key not in MLB_TEAM_MODEL_KEYS or not isinstance(bucket, dict):
            continue
        lookup = _game_lookup(bucket)
        bucket["consensus_required"] = True
        bucket["consensus_gate_version"] = MLB_TEAM_CONSENSUS_VERSION
        bucket["ranking_epoch"] = f"{MLB_TEAM_RANKING_EPOCH_PREFIX}:{model_key}"
        picks = bucket.get("picks") if isinstance(bucket.get("picks"), list) else []
        for pick in picks:
            if not isinstance(pick, dict):
                continue
            result = evaluate_mlb_team_pick(
                pick,
                str(model_key),
                bucket,
                performance=performance,
                game_lookup=lookup,
            )
            decision = result["decision"]
            pick.update({
                "consensus_required": True,
                "consensus_gate_version": MLB_TEAM_CONSENSUS_VERSION,
                "mlb_team_consensus_version": MLB_TEAM_CONSENSUS_VERSION,
                "consensus_passed": result["consensus_passed"],
                "consensus_qualified": result["consensus_passed"],
                "consensus_score": result["consensus_score"],
                "consensus_rejection_reason": result["consensus_rejection_reason"],
                "consensus_signal_count": result["signal_count"],
                "consensus_signals": result["signals"],
                "consensus_hard_blockers": result["hard_blockers"],
                "market_no_vig_probability": result["market_no_vig_probability"],
                "selected_side_implied_probability": result["selected_side_implied_probability"],
                "raw_model_probability": result["raw_model_probability"],
                "calibrated_model_probability": result["calibrated_model_probability"],
                "calibrated_edge": result["calibrated_edge"],
                "walk_forward_samples": int((result["walk_forward"] or {}).get("samples") or 0),
                "walk_forward_roi": (result["walk_forward"] or {}).get("roi"),
                "actionability": result["actionability"],
                "decision": decision,
                "units": _stake_units(pick, decision),
                "ml_rank_epoch": f"{MLB_TEAM_RANKING_EPOCH_PREFIX}:{model_key}",
                "ranking_epoch": f"{MLB_TEAM_RANKING_EPOCH_PREFIX}:{model_key}",
                "model_epoch": f"{MLB_TEAM_RANKING_EPOCH_PREFIX}:{model_key}",
            })
        summary: dict[str, int] = {}
        for pick in picks:
            if not isinstance(pick, dict):
                continue
            reason = str(pick.get("consensus_rejection_reason") or "")
            if reason:
                first = reason.split(";", 1)[0]
                summary[first] = summary.get(first, 0) + 1
        bucket["consensus_rejection_reasons"] = summary
    for alias in ("mlb_new", "mlb_first_five", "mlb_inning"):
        if alias in models:
            payload[alias] = models[alias]
    return payload

