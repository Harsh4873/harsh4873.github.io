"""Lightweight ML artifact loading, scoring, and EV ranking for player props."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any

from .schema import american_implied_probability, decision_and_stake, safe_float


ML_SOURCE = "player_props_ml_v1"
ML_MODEL_VERSION = "player_props_ml_v1.0.0"
ARTIFACT_DIR = Path(__file__).resolve().parent / "artifacts"

FEATURE_NAMES = [
    "line",
    "odds_implied",
    "baseline_probability",
    "baseline_projection",
    "projection_over_line",
    "selection_over",
    "market_family_hash",
    "market_priced",
]

SPORT_ARTIFACTS = {
    "MLB": {
        "model": ARTIFACT_DIR / "mlb_player_props_ml.joblib",
        "metadata": ARTIFACT_DIR / "mlb_player_props_ml_metadata.json",
    },
    "WNBA": {
        "model": ARTIFACT_DIR / "wnba_player_props_ml.joblib",
        "metadata": ARTIFACT_DIR / "wnba_player_props_ml_metadata.json",
    },
    "NBA": {
        "model": ARTIFACT_DIR / "wnba_player_props_ml.joblib",
        "metadata": ARTIFACT_DIR / "wnba_player_props_ml_metadata.json",
    },
}

_BUNDLES: dict[str, dict[str, Any] | None] = {}


def _clamp(value: float, low: float = 0.01, high: float = 0.99) -> float:
    return max(low, min(high, value))


def _family_hash(market_family: str) -> float:
    digest = hashlib.sha256(str(market_family or "unknown").encode("utf-8")).hexdigest()
    bucket = int(digest[:8], 16) / 0xFFFFFFFF
    return (bucket * 2.0) - 1.0


def market_family_for_stat(stat_key: str) -> str:
    key = str(stat_key or "").strip()
    aliases = {
        "totalRebounds": "rebounds",
        "hits_runs_rbis": "hrr",
        "points_rebounds_assists": "pra",
        "points_rebounds": "pr",
        "points_assists": "pa",
        "three_pointers_made": "3pm",
        "steals_blocks": "stocks",
        "batter_walks": "batter_walks",
        "batter_strikeouts": "batter_strikeouts",
        "pitcher_walks_allowed": "pitcher_walks_allowed",
        "pitcher_outs_recorded": "pitcher_outs_recorded",
        "pitcher_hits_allowed": "pitcher_hits_allowed",
        "pitcher_earned_runs_allowed": "pitcher_earned_runs_allowed",
    }
    return aliases.get(key, key.replace(" ", "_").lower() or "unknown")


def expected_value(probability: float, odds: int | None) -> float:
    if odds is None or odds == 0:
        return 0.0
    profit = 100.0 / abs(odds) if odds < 0 else odds / 100.0
    return (probability * profit) - (1.0 - probability)


def _load_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def load_ml_bundle(sport: str) -> dict[str, Any] | None:
    normalized = str(sport or "").strip().upper()
    artifact = SPORT_ARTIFACTS.get(normalized)
    if artifact is None:
        return None
    cache_key = normalized
    if cache_key in _BUNDLES:
        return _BUNDLES[cache_key]
    metadata = _load_json(artifact["metadata"])
    try:
        import joblib  # type: ignore

        model_payload = joblib.load(artifact["model"])
    except Exception:
        model_payload = None
    if isinstance(model_payload, dict):
        model = model_payload.get("model")
        feature_names = model_payload.get("features") or FEATURE_NAMES
    else:
        model = model_payload
        feature_names = FEATURE_NAMES
    if model is None:
        _BUNDLES[cache_key] = None
        return None
    bundle = {"model": model, "features": list(feature_names), "metadata": metadata}
    _BUNDLES[cache_key] = bundle
    return bundle


def feature_vector(
    pick: dict[str, Any],
    *,
    baseline_probability: float,
    baseline_projection: float,
    market_family: str,
) -> list[float]:
    line = safe_float(pick.get("line"))
    odds = pick.get("odds")
    try:
        odds_int = int(odds) if odds is not None else None
    except (TypeError, ValueError):
        odds_int = None
    implied = american_implied_probability(odds_int) or 0.5
    selection_over = 1.0 if str(pick.get("selection") or "").strip().lower() == "over" else 0.0
    return [
        line,
        implied,
        _clamp(baseline_probability),
        safe_float(baseline_projection),
        safe_float(baseline_projection) - line,
        selection_over,
        _family_hash(market_family),
        1.0 if pick.get("market_priced") is True else 0.0,
    ]


def _predict_bundle_probability(bundle: dict[str, Any] | None, vector: list[float]) -> float | None:
    if not bundle:
        return None
    model = bundle.get("model")
    if model is None:
        return None
    try:
        probabilities = model.predict_proba([vector])
        return _clamp(float(probabilities[0][1]))
    except Exception:
        return None


def score_probability(
    pick: dict[str, Any],
    *,
    baseline_probability: float,
    baseline_projection: float,
    market_family: str,
) -> tuple[float, str, str]:
    bundle = load_ml_bundle(str(pick.get("sport") or ""))
    vector = feature_vector(
        pick,
        baseline_probability=baseline_probability,
        baseline_projection=baseline_projection,
        market_family=market_family,
    )
    model_probability = _predict_bundle_probability(bundle, vector)
    if model_probability is None:
        model_probability = _clamp(baseline_probability)
        model_version = f"{ML_MODEL_VERSION}-fallback"
        fingerprint = "fallback"
    else:
        # Keep the learned artifact in charge while anchoring wild early models
        # to the live projection signal until the ledger has more samples.
        model_probability = _clamp((model_probability * 0.62) + (_clamp(baseline_probability) * 0.38))
        metadata = bundle.get("metadata") or {}
        model_version = str(metadata.get("version") or ML_MODEL_VERSION)
        fingerprint = str(metadata.get("training_fingerprint") or "")
    return round(model_probability, 4), model_version, fingerprint


def apply_ml_to_pick(
    pick: dict[str, Any],
    *,
    baseline_probability: float,
    baseline_projection: float,
    market_family: str | None = None,
) -> dict[str, Any]:
    family = market_family or market_family_for_stat(str(pick.get("stat_key") or ""))
    ml_probability, model_version, fingerprint = score_probability(
        pick,
        baseline_probability=baseline_probability,
        baseline_projection=baseline_projection,
        market_family=family,
    )
    odds_raw = pick.get("odds")
    try:
        odds = int(odds_raw) if odds_raw is not None else None
    except (TypeError, ValueError):
        odds = None
    decision, edge, full_kelly, quarter_kelly, units = decision_and_stake(ml_probability, odds)
    market_implied = american_implied_probability(odds)
    epoch_fingerprint = fingerprint[:16] if fingerprint else "unfingerprinted"
    rank_epoch = f"{str(pick.get('sport') or '').strip().upper()}:{model_version}:{epoch_fingerprint}"
    pick.update(
        {
            "probability_source": ML_SOURCE,
            "ml_probability": ml_probability,
            "ml_edge": round(ml_probability - (market_implied or 0.0), 6) if market_implied is not None else None,
            "ml_expected_value": round(expected_value(ml_probability, odds), 6),
            "ml_model_version": model_version,
            "ml_training_fingerprint": fingerprint,
            "ml_rank_epoch": rank_epoch,
            "ranking_epoch": rank_epoch,
            "model_epoch": rank_epoch,
            "ml_market_family": family,
            "baseline_projection": round(safe_float(baseline_projection), 3),
            "baseline_probability": round(_clamp(baseline_probability), 6),
            "ml_calibration_excluded": True,
            "probability": ml_probability,
            "confidence": "High" if ml_probability >= 0.62 else "Medium" if ml_probability >= 0.56 else "Low",
            "edge": edge,
            "decision": decision,
            "full_kelly": full_kelly,
            "quarter_kelly": quarter_kelly,
            "units": units,
        }
    )
    return pick


def ev_sort_key(prop: dict[str, Any]) -> tuple[int, float, float, float, str]:
    decision_rank = {"BET": 0, "LEAN": 1, "PASS": 2}
    return (
        decision_rank.get(str(prop.get("decision") or ""), 3),
        -safe_float(prop.get("ml_expected_value"), -100.0),
        -safe_float(prop.get("ml_edge"), -100.0),
        -safe_float(prop.get("ml_probability") or prop.get("probability")),
        str(prop.get("id") or ""),
    )


def assign_ml_ranks(props: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ranked = sorted(props, key=ev_sort_key)
    for index, prop in enumerate(ranked, start=1):
        prop["ml_rank"] = index
        prop["model_rank"] = index
        prop["rank"] = index
    return ranked
