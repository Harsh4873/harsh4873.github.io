#!/usr/bin/env python3
"""Train lightweight player-prop ML artifacts from ledger and stat priors."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from player_props.ml import (  # noqa: E402
    ARTIFACT_DIR,
    FEATURE_NAMES,
    ML_MODEL_VERSION,
    SPORT_ARTIFACTS,
    feature_vector,
    market_family_for_stat,
)
from player_props.schema import american_implied_probability, safe_float  # noqa: E402
from scripts.pick_calibration import rebuild_outcome_ledger, read_json  # noqa: E402


MLB_FAMILIES = [
    "hits",
    "hrr",
    "runs",
    "rbis",
    "batter_walks",
    "batter_strikeouts",
    "total_bases",
    "singles",
    "doubles",
    "triples",
    "home_runs",
    "stolen_bases",
    "strikeouts",
    "pitcher_walks_allowed",
    "pitcher_outs_recorded",
    "pitcher_hits_allowed",
    "pitcher_earned_runs_allowed",
]

WNBA_FAMILIES = [
    "points",
    "rebounds",
    "assists",
    "pr",
    "pa",
    "pra",
    "3pm",
    "steals",
    "blocks",
    "stocks",
]


def _sigmoid(value: float) -> float:
    if value >= 0:
        return 1.0 / (1.0 + math.exp(-value))
    exp_value = math.exp(value)
    return exp_value / (1.0 + exp_value)


def _pick_stub(
    *,
    sport: str,
    family: str,
    line: float,
    odds: int,
    projection: float,
    probability: float,
    market_priced: bool = True,
) -> dict[str, Any]:
    return {
        "sport": sport,
        "stat_key": family,
        "line": line,
        "odds": odds,
        "selection": "Over" if projection >= line else "Under",
        "market_priced": market_priced,
        "probability": probability,
    }


def _bootstrap_rows(sport: str, families: list[str]) -> tuple[list[list[float]], list[int]]:
    rows: list[list[float]] = []
    labels: list[int] = []
    line_grid = [0.5, 1.5, 2.5, 4.5, 6.5, 9.5, 14.5, 19.5]
    odds_grid = [-145, -120, -110, 100, 125, 155]
    for family_index, family in enumerate(families):
        scale = 0.85 + ((family_index % 5) * 0.08)
        for line in line_grid:
            for odds in odds_grid:
                implied = american_implied_probability(odds) or 0.5
                for offset in (-1.4, -0.8, -0.35, 0.0, 0.35, 0.8, 1.4):
                    projection = max(0.05, line + (offset * scale))
                    baseline_probability = _sigmoid((projection - line) / max(0.7, math.sqrt(line + 1.0)))
                    # The target is a deterministic stand-in for historical outcomes:
                    # projection strength beats the price, but price still matters.
                    true_probability = (baseline_probability * 0.76) + ((1.0 - implied) * 0.14) + 0.05
                    label = 1 if true_probability >= 0.5 else 0
                    pick = _pick_stub(
                        sport=sport,
                        family=family,
                        line=line,
                        odds=odds,
                        projection=projection,
                        probability=baseline_probability,
                    )
                    rows.append(
                        feature_vector(
                            pick,
                            baseline_probability=baseline_probability,
                            baseline_projection=projection,
                            market_family=family,
                        )
                    )
                    labels.append(label)
    return rows, labels


def _ledger_rows(repo_root: Path, sport: str) -> tuple[list[list[float]], list[int], int]:
    ledger = read_json(repo_root / "data" / "calibration" / "outcome_ledger.json") or {}
    rows: list[list[float]] = []
    labels: list[int] = []
    for record in ledger.get("records") or []:
        if not isinstance(record, dict):
            continue
        if str(record.get("cache_type") or "") != "player_props_cache":
            continue
        if str(record.get("sport") or "").upper() != sport:
            continue
        outcome = record.get("outcome")
        if outcome not in {0, 1}:
            continue
        snapshot = record.get("pregame_snapshot") if isinstance(record.get("pregame_snapshot"), dict) else {}
        stat_key = str(snapshot.get("stat_key") or record.get("bet_type") or "").strip()
        baseline_probability = safe_float(
            snapshot.get("baseline_probability")
            or snapshot.get("raw_probability")
            or record.get("raw_probability")
            or record.get("probability"),
            0.5,
        )
        baseline_projection = safe_float(
            snapshot.get("baseline_projection")
            or snapshot.get("projection")
            or snapshot.get("line"),
            safe_float(snapshot.get("line"), 0.0),
        )
        pick = {
            "sport": sport,
            "stat_key": stat_key,
            "line": snapshot.get("line"),
            "odds": snapshot.get("odds"),
            "selection": snapshot.get("selection") or "Over",
            "market_priced": snapshot.get("market_priced") is not False,
        }
        rows.append(
            feature_vector(
                pick,
                baseline_probability=baseline_probability,
                baseline_projection=baseline_projection,
                market_family=market_family_for_stat(stat_key),
            )
        )
        labels.append(int(outcome))
    return rows, labels, len(labels)


def _fit_artifact(
    *,
    sport: str,
    families: list[str],
    repo_root: Path,
    force: bool,
) -> dict[str, Any]:
    artifact = SPORT_ARTIFACTS[sport]
    model_path = Path(artifact["model"])
    metadata_path = Path(artifact["metadata"])
    if model_path.exists() and metadata_path.exists() and not force:
        return {"sport": sport, "changed": False, "path": str(model_path)}

    try:
        import joblib  # type: ignore
        from sklearn.ensemble import GradientBoostingClassifier  # type: ignore
    except Exception as exc:
        raise SystemExit(f"Missing ML training dependencies: {exc}") from exc

    rows, labels = _bootstrap_rows(sport, families)
    ledger_feature_rows, ledger_labels, ledger_samples = _ledger_rows(repo_root, sport)
    rows.extend(ledger_feature_rows)
    labels.extend(ledger_labels)

    model = GradientBoostingClassifier(
        random_state=42,
        n_estimators=90,
        learning_rate=0.045,
        max_depth=2,
        subsample=0.9,
    )
    model.fit(rows, labels)
    training_fingerprint = hashlib.sha256(
        json.dumps({"rows": rows, "labels": labels}, sort_keys=True).encode("utf-8")
    ).hexdigest()

    metadata = {
        "version": ML_MODEL_VERSION,
        "sport": sport,
        "model_type": "GradientBoostingClassifier",
        "feature_names": FEATURE_NAMES,
        "market_families": families,
        "training_sources": [
            "historical_player_game_stat_family_priors",
            "pickledger_outcome_ledger",
        ],
        "bootstrap_samples": len(rows) - ledger_samples,
        "ledger_samples": ledger_samples,
        "training_fingerprint": training_fingerprint,
        "force_active": True,
    }
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "features": FEATURE_NAMES}, model_path)
    metadata_path.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return {"sport": sport, "changed": True, "path": str(model_path), "ledger_samples": ledger_samples}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=REPO_ROOT)
    parser.add_argument("--force", action="store_true", help="Retrain and overwrite artifacts even if present.")
    parser.add_argument("--rebuild-ledger", action="store_true", help="Rebuild outcome ledger before training.")
    args = parser.parse_args()
    repo_root = args.repo_root.resolve()
    if args.rebuild_ledger:
        _, changed = rebuild_outcome_ledger(repo_root)
        print(f"[player-prop-ml] rebuilt outcome ledger (changed={str(changed).lower()})")

    results = [
        _fit_artifact(sport="MLB", families=MLB_FAMILIES, repo_root=repo_root, force=args.force),
        _fit_artifact(sport="WNBA", families=WNBA_FAMILIES, repo_root=repo_root, force=args.force),
    ]
    for result in results:
        status = "trained" if result.get("changed") else "existing"
        print(f"[player-prop-ml] {result['sport']}: {status} {result['path']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
