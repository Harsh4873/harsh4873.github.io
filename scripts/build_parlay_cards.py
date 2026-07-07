#!/usr/bin/env python3
"""Build Best Bets parlay-card JSON from committed pick caches."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from itertools import combinations
from pathlib import Path
from typing import Any, Iterable


REPO_ROOT = Path(__file__).resolve().parents[1]
MODEL_CACHE_DIR = REPO_ROOT / "data" / "model_cache"
PLAYER_PROPS_CACHE_DIR = REPO_ROOT / "data" / "player_props_cache"
PARLAY_CARDS_DIR = REPO_ROOT / "data" / "parlay_cards"
OUTCOME_LEDGER_PATH = REPO_ROOT / "data" / "calibration" / "outcome_ledger.json"

TEAM_VISIBLE_DECISIONS = {"BET", "LEAN"}
MIN_LEG_EDGE = 0.015
MIN_GEOMEAN_PROBABILITY = 0.525
MAX_SINGLE_LEG_PLUS_ODDS = 220
MAX_CARDS_PER_MODE = 6
MAX_CARDS_PER_CATEGORY = 2
DEFAULT_EXPOSURE_CAP = 2
ENGINE_VERSION = "parlay_cards_v3_calibrated_portfolio"
COLD_CATEGORY_MIN_SETTLED = 10
COLD_CATEGORY_ROI = -0.15

SOURCE_LABELS: dict[str, str] = {
    "mlb_new": "MLB Model",
    "mlb_inning": "MLB Inning",
    "mlb_first_five": "MLB First Five",
    "wnba": "WNBA Model",
    "nba": "NBA New",
    "nba_playoffs": "NBA Playoffs",
    "nba_summer": "NBA Summer League",
    "fifa_world_cup": "FIFA Model",
    "sportytrader": "SportyTrader",
    "sportytrader_nba": "SportyTraderNBA",
    "sportytrader_mlb": "SportyTraderMLB",
    "sportytrader_wnba": "SportyTraderWNBA",
    "sportytrader_fifa_world_cup": "SportyTraderFIFAWorldCup",
    "sportsgambler": "SportsGambler",
    "sportsgambler_nba": "SportsGamblerNBA",
    "sportsgambler_mlb": "SportsGamblerMLB",
    "sportsgambler_wnba": "SportsGamblerWNBA",
    "sportsgambler_fifa_world_cup": "SportsGamblerFIFAWorldCup",
    "scores24_wnba": "Scores24WNBA",
    "scores24_mlb": "Scores24MLB",
    "scores24_fifa_world_cup": "Scores24FIFAWorldCup",
}

PLAYER_PROP_SOURCE_LABELS: dict[str, str] = {
    "nba_player_props": "NBAPlayerProps",
    "mlb_player_props": "MLBPlayerProps",
    "wnba_player_props": "WNBAPlayerProps",
    "wnba_3pm": "WNBA3PM",
}

CATEGORY_DEFS: dict[str, dict[str, str]] = {
    "consensus_edge": {
        "label": "Consensus Edge",
        "shortLabel": "Consensus",
        "description": "Agreement-backed slips with positive calibrated edge on every leg.",
    },
    "three_leg_value": {
        "label": "3-Leg Value",
        "shortLabel": "3-Leg Value",
        "description": "Positive-EV 3-leg slips inside the disciplined target odds window.",
    },
    "validated_form": {
        "label": "Validated Form",
        "shortLabel": "Validated",
        "description": "Team-only 3-leg slips backed by shrinkage-adjusted source form.",
    },
    "compact_edge": {
        "label": "Compact Edge",
        "shortLabel": "Compact",
        "description": "Selective 2-leg slips used only when they beat the available 3-leg utility or the slate is thin.",
    },
}

CATEGORY_ORDER = [
    "consensus_edge",
    "three_leg_value",
    "validated_form",
    "compact_edge",
]


@dataclass(frozen=True)
class SourceForm:
    source: str
    wins: int = 0
    losses: int = 0
    pushes: int = 0
    net: float = 0.0

    @property
    def settled(self) -> int:
        return self.wins + self.losses

    @property
    def win_rate(self) -> float | None:
        return self.wins / self.settled if self.settled else None

    @property
    def roi(self) -> float | None:
        return self.net / self.settled if self.settled else None

    @property
    def shrinkage(self) -> float:
        return self.settled / (self.settled + 20) if self.settled else 0.0

    @property
    def score(self) -> float:
        win_rate = self.win_rate if self.win_rate is not None else 0.5
        roi = max(-0.75, min(0.75, self.roi if self.roi is not None else 0.0))
        return 50.0 + self.shrinkage * ((win_rate - 0.5) * 70.0 + roi * 18.0) + min(self.settled, 30) * 0.2

    @property
    def probability_adjustment(self) -> float:
        win_rate = self.win_rate if self.win_rate is not None else 0.5
        roi = max(-0.5, min(0.5, self.roi if self.roi is not None else 0.0))
        return self.shrinkage * ((win_rate - 0.5) * 0.08 + roi * 0.035)


@dataclass(frozen=True)
class HistoricalCalibration:
    wins: int = 0
    losses: int = 0

    @property
    def settled(self) -> int:
        return self.wins + self.losses

    @property
    def posterior(self) -> float:
        return (self.wins + 1.0) / (self.settled + 2.0)


@dataclass(frozen=True)
class Leg:
    leg_id: str
    pick_id: str
    source_key: str
    source: str
    source_type: str
    sport: str
    date: str
    pick: str
    decision: str
    odds: int
    decimal_odds: float
    probability: float
    raw_probability: float
    market_probability: float
    calibrated_edge: float
    historical_probability: float
    calibration_samples: int
    probability_source: str
    game_key: str
    game: str
    market_key: str
    market: str
    player_key: str
    player: str
    result: str
    start_time: str
    source_form_score: float
    model_rank: int | None
    consensus_sources: tuple[str, ...]
    consensus: bool
    raw: dict[str, Any]


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _json_text(payload: dict[str, Any]) -> str:
    return json.dumps(payload, indent=2, sort_keys=True, default=str) + "\n"


def _write_json_if_changed(path: Path, payload: dict[str, Any]) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = _json_text(payload)
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.write_text(text, encoding="utf-8")
    return True


def _stable_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, default=str)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _norm_key(value: Any) -> str:
    return " ".join(
        "".join(ch.lower() if ch.isalnum() else " " for ch in _clean_text(value)).split()
    )


def _number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _int_number(value: Any) -> int | None:
    number = _number(value)
    return int(round(number)) if number is not None else None


def normalize_probability(value: Any) -> float | None:
    number = _number(value)
    if number is None:
        return None
    probability = number / 100.0 if number > 1 else number
    return probability if 0 <= probability <= 1 else None


def american_to_decimal(odds: int | float) -> float:
    if odds == 0:
        raise ValueError("American odds cannot be zero")
    return 1.0 + (float(odds) / 100.0 if odds > 0 else 100.0 / abs(float(odds)))


def decimal_to_american(decimal_odds: float) -> int:
    if decimal_odds <= 1:
        raise ValueError("Decimal odds must be greater than 1")
    if decimal_odds >= 2:
        return int(round((decimal_odds - 1) * 100))
    return int(round(-100 / (decimal_odds - 1)))


def implied_probability(odds: int | float) -> float:
    return 1.0 / american_to_decimal(odds)


def fair_odds_from_probability(probability: float) -> int:
    probability = max(0.001, min(0.999, probability))
    decimal_odds = 1.0 / probability
    return decimal_to_american(decimal_odds)


def profit_for_american_odds(odds: int | float, stake: float = 1.0) -> float:
    return stake * (float(odds) / 100.0 if odds > 0 else 100.0 / abs(float(odds)))


def _pick_text(pick: dict[str, Any]) -> str:
    return _clean_text(pick.get("pick") or pick.get("selection") or pick.get("prop") or pick.get("bet"))


def _pick_date(pick: dict[str, Any], fallback_date: str) -> str:
    return _clean_text(
        pick.get("date")
        or pick.get("game_date")
        or pick.get("slate_date")
        or pick.get("Date")
        or fallback_date
    )


def _source_label(source_key: str, raw_source: Any, *, player_prop: bool) -> str:
    raw = _clean_text(raw_source)
    if raw:
        return raw
    if player_prop:
        return PLAYER_PROP_SOURCE_LABELS.get(source_key, source_key)
    return SOURCE_LABELS.get(source_key, source_key)


def _iter_model_records(payload: dict[str, Any], *, player_props: bool) -> Iterable[tuple[str, str, str, dict[str, Any]]]:
    fallback_date = _clean_text(payload.get("date") or payload.get("slate_date"))
    models = payload.get("models") if isinstance(payload.get("models"), dict) else {}
    for source_key, bucket in models.items():
        if not isinstance(bucket, dict) or bucket.get("ok") is False:
            continue
        source_key = str(source_key)
        source = _source_label(source_key, None, player_prop=player_props)
        for raw in bucket.get("picks") or []:
            if isinstance(raw, dict):
                yield source_key, source, fallback_date, raw


def _extract_probability(pick: dict[str, Any]) -> tuple[float | None, str]:
    for key in (
        "calibrated_probability",
        "calibrated_model_probability",
        "probability",
        "model_probability",
        "predicted_probability",
        "ml_probability",
        "variant_signal_probability",
    ):
        probability = normalize_probability(pick.get(key))
        if probability is not None:
            return probability, str(key)
    return None, "market_implied"


def _selected_side_market_probability(pick: dict[str, Any], odds: int) -> float:
    for key in (
        "selected_side_implied_probability",
        "market_implied_probability",
        "market_pick_prob",
        "market_pick_probability",
        "market_probability",
        "market_no_vig_selected_probability",
        "market_no_vig_probability",
    ):
        probability = normalize_probability(pick.get(key))
        if probability is not None:
            return probability
    snapshot = pick.get("pregame_snapshot")
    if isinstance(snapshot, dict):
        for key in (
            "selected_side_implied_probability",
            "market_implied_probability",
            "market_pick_prob",
            "market_probability",
        ):
            probability = normalize_probability(snapshot.get(key))
            if probability is not None:
                return probability
    return implied_probability(odds)


def _mode_for_record(cache_type: str) -> str:
    return "player" if "player_props" in cache_type else "team"


def _market_family(pick: dict[str, Any]) -> str:
    return _norm_key(
        pick.get("ml_market_family")
        or pick.get("bet_type")
        or pick.get("stat_key")
        or pick.get("market")
        or pick.get("market_type")
        or pick.get("stat_label")
        or "market"
    )


def _calibration_key(mode: str, model_key: str, sport: str, market_family: str) -> tuple[str, str, str, str]:
    return (_norm_key(mode), _norm_key(model_key), _norm_key(sport), _norm_key(market_family))


def _add_calibration_bucket(
    totals: dict[tuple[str, str, str, str], dict[str, int]],
    key: tuple[str, str, str, str],
    outcome: str,
) -> None:
    if outcome == "win":
        totals[key]["wins"] += 1
    elif outcome == "loss":
        totals[key]["losses"] += 1


def build_historical_calibration(target_date: str, ledger_path: Path = OUTCOME_LEDGER_PATH) -> dict[tuple[str, str, str, str], HistoricalCalibration]:
    payload = _read_json(ledger_path)
    records = payload.get("records") if payload else []
    totals: dict[tuple[str, str, str, str], dict[str, int]] = defaultdict(lambda: {"wins": 0, "losses": 0})
    if not isinstance(records, list):
        return {}

    for record in records:
        if not isinstance(record, dict):
            continue
        if _clean_text(record.get("date")) >= target_date:
            continue
        result = _clean_text(record.get("result")).lower()
        if result not in {"win", "loss"}:
            outcome = record.get("outcome")
            if outcome == 1:
                result = "win"
            elif outcome == 0:
                result = "loss"
            else:
                continue
        mode = _mode_for_record(_clean_text(record.get("cache_type")))
        model_key = _clean_text(record.get("model_key") or record.get("source"))
        sport = _clean_text(record.get("sport") or "OTHER")
        market = _clean_text(record.get("bet_type") or "market")
        exact = _calibration_key(mode, model_key, sport, market)
        for key in (
            exact,
            _calibration_key(mode, model_key, sport, "any"),
            _calibration_key(mode, "any", sport, market),
            _calibration_key(mode, "any", sport, "any"),
            _calibration_key(mode, "any", "any", market),
            _calibration_key(mode, "any", "any", "any"),
        ):
            _add_calibration_bucket(totals, key, result)

    return {
        key: HistoricalCalibration(wins=values["wins"], losses=values["losses"])
        for key, values in totals.items()
    }


def calibration_for_leg(
    calibrations: dict[tuple[str, str, str, str], HistoricalCalibration],
    *,
    mode: str,
    model_key: str,
    sport: str,
    market_family: str,
) -> HistoricalCalibration:
    for key in (
        _calibration_key(mode, model_key, sport, market_family),
        _calibration_key(mode, model_key, sport, "any"),
        _calibration_key(mode, "any", sport, market_family),
        _calibration_key(mode, "any", sport, "any"),
        _calibration_key(mode, "any", "any", market_family),
        _calibration_key(mode, "any", "any", "any"),
    ):
        if key in calibrations:
            return calibrations[key]
    return HistoricalCalibration()


def blended_leg_probability(
    *,
    mode: str,
    raw_probability: float,
    market_probability: float,
    odds: int,
    consensus: bool,
    calibration: HistoricalCalibration,
) -> tuple[float, float, float, float, float]:
    model_weight = 0.35 if mode == "team" else 0.25
    if consensus:
        model_weight += 0.10
    if calibration.settled < 30:
        model_weight -= 0.10
    model_weight = max(0.05, min(0.55, model_weight))
    historical_weight = min(0.35, calibration.settled / (calibration.settled + 60.0) * 0.35) if calibration.settled else 0.0
    market_weight = max(0.0, 1.0 - model_weight - historical_weight)
    probability = (
        market_probability * market_weight
        + raw_probability * model_weight
        + calibration.posterior * historical_weight
    )
    cap = 0.74 if mode == "team" else 0.68
    if odds > 0:
        cap = min(cap, 0.62)
    probability = max(0.05, min(cap, probability))
    edge = probability - market_probability
    return probability, edge, model_weight, historical_weight, market_weight


def _result(pick: dict[str, Any]) -> str:
    value = _clean_text(pick.get("result")).lower()
    if value in {"win", "won", "w"}:
        return "win"
    if value in {"loss", "lost", "l"}:
        return "loss"
    if value in {"push", "void", "p"}:
        return "push"
    return "pending"


def _source_type(source_key: str, pick: dict[str, Any], *, player_props: bool) -> str:
    if player_props or _clean_text(pick.get("scope")).lower() == "player":
        return "player_prop"
    if source_key.startswith(("sportytrader", "sportsgambler", "scores24")):
        return "external"
    return "model"


def _game_label(pick: dict[str, Any]) -> str:
    label = _clean_text(pick.get("matchup") or pick.get("game") or pick.get("event"))
    if label:
        return label
    away = _clean_text(pick.get("away_team"))
    home = _clean_text(pick.get("home_team"))
    if away and home:
        return f"{away} @ {home}"
    return ""


def _game_key(pick: dict[str, Any], sport: str, date_iso: str, fallback: str) -> str:
    game_id = _clean_text(pick.get("game_id") or pick.get("event_id"))
    if game_id:
        return f"{date_iso}:{sport}:game:{game_id}".lower()
    label = _game_label(pick)
    if label:
        return f"{date_iso}:{sport}:{_norm_key(label)}"
    return f"{date_iso}:{sport}:unknown:{fallback}"


def _market_label(pick: dict[str, Any]) -> str:
    return _clean_text(
        pick.get("market_type")
        or pick.get("market")
        or pick.get("stat_label")
        or pick.get("stat_key")
        or "market"
    )


def _market_key(pick: dict[str, Any], game_key: str, pick_text: str, player: str) -> str:
    line = _clean_text(pick.get("line") or pick.get("market_line"))
    selection = _clean_text(pick.get("selection"))
    return "::".join(
        value
        for value in (
            game_key,
            _norm_key(player),
            _norm_key(_market_label(pick)),
            _norm_key(selection or pick_text.split("(", 1)[0]),
            line,
        )
        if value
    )


def _player_key(pick: dict[str, Any], fallback: str) -> str:
    player_id = _clean_text(pick.get("player_id") or pick.get("market_athlete_id"))
    if player_id:
        return f"player-id:{player_id}"
    player = _clean_text(pick.get("player") or pick.get("player_name"))
    if player:
        return f"player:{_norm_key(player)}"
    return f"no-player:{fallback}"


def _consensus_field_hit(pick: dict[str, Any]) -> bool:
    if pick.get("consensus_qualified") is True:
        return True
    if pick.get("precision_qualified") is True:
        return True
    if pick.get("consensus_model_agreement") is True:
        return True
    if _number(pick.get("consensus_signal_count") or pick.get("consensus_model_count")):
        return True
    for key in ("consensus_models", "consensus_applicable_models", "consensus_record_models"):
        if isinstance(pick.get(key), list) and pick[key]:
            return True
    return False


def _leg_id(pick: dict[str, Any], source_key: str, source: str, fallback_date: str) -> str:
    existing = _clean_text(pick.get("id"))
    if existing:
        return existing
    return "leg-" + _stable_hash(
        [
            source_key,
            source,
            _pick_date(pick, fallback_date),
            _pick_text(pick),
            pick.get("matchup") or pick.get("game"),
            pick.get("player") or pick.get("player_name"),
            pick.get("market") or pick.get("market_type"),
            pick.get("line"),
        ]
    )


def _source_stats_from_pick(pick: dict[str, Any], result: str) -> tuple[int, int, int, float]:
    if result == "win":
        odds = _int_number(pick.get("odds") or pick.get("american_odds") or pick.get("price"))
        return 1, 0, 0, profit_for_american_odds(odds or 100)
    if result == "loss":
        return 0, 1, 0, -1.0
    if result == "push":
        return 0, 0, 1, 0.0
    return 0, 0, 0, 0.0


def _payloads_before(cache_dir: Path, target_date: str) -> list[dict[str, Any]]:
    payloads: list[dict[str, Any]] = []
    for path in sorted(cache_dir.glob("20??-??-??.json")):
        if path.stem >= target_date:
            continue
        payload = _read_json(path)
        if payload:
            payloads.append(payload)
    return payloads


def build_source_forms(target_date: str, team_history: list[dict[str, Any]], prop_history: list[dict[str, Any]]) -> dict[str, SourceForm]:
    totals: dict[str, dict[str, float]] = defaultdict(lambda: {"wins": 0, "losses": 0, "pushes": 0, "net": 0.0})
    for payload, player_props in [(payload, False) for payload in team_history] + [(payload, True) for payload in prop_history]:
        for source_key, fallback_source, fallback_date, pick in _iter_model_records(payload, player_props=player_props):
            decision = _clean_text(pick.get("decision")).upper()
            if decision not in TEAM_VISIBLE_DECISIONS:
                continue
            if player_props and pick.get("market_priced") is not True:
                continue
            if _pick_date(pick, fallback_date) >= target_date:
                continue
            result = _result(pick)
            if result == "pending":
                continue
            source = _source_label(source_key, pick.get("source") or fallback_source, player_prop=player_props)
            wins, losses, pushes, net = _source_stats_from_pick(pick, result)
            totals[source]["wins"] += wins
            totals[source]["losses"] += losses
            totals[source]["pushes"] += pushes
            totals[source]["net"] += net
    return {
        source: SourceForm(
            source=source,
            wins=int(values["wins"]),
            losses=int(values["losses"]),
            pushes=int(values["pushes"]),
            net=round(values["net"], 4),
        )
        for source, values in totals.items()
    }


def collect_legs(
    date_iso: str,
    team_payload: dict[str, Any] | None,
    prop_payload: dict[str, Any] | None,
    source_forms: dict[str, SourceForm] | None = None,
    historical_calibrations: dict[tuple[str, str, str, str], HistoricalCalibration] | None = None,
) -> list[Leg]:
    source_forms = source_forms or {}
    historical_calibrations = historical_calibrations or build_historical_calibration(date_iso)
    records: list[tuple[str, str, str, dict[str, Any], bool]] = []
    if team_payload:
        records.extend((*record, False) for record in _iter_model_records(team_payload, player_props=False))
    if prop_payload:
        records.extend((*record, True) for record in _iter_model_records(prop_payload, player_props=True))

    raw_legs: list[tuple[Leg, str]] = []
    calibrations_by_leg_id: dict[str, HistoricalCalibration] = {}
    seen_ids: set[str] = set()
    for source_key, fallback_source, fallback_date, pick, player_props in records:
        decision = _clean_text(pick.get("decision")).upper()
        if decision not in TEAM_VISIBLE_DECISIONS:
            continue
        if player_props and pick.get("market_priced") is not True:
            continue
        if pick.get("grade_supported") is False:
            continue
        pick_text = _pick_text(pick)
        if not pick_text:
            continue
        pick_date = _pick_date(pick, fallback_date)
        if pick_date != date_iso:
            continue
        odds = _int_number(pick.get("odds") or pick.get("assumed_odds") or pick.get("american_odds") or pick.get("price"))
        if odds is None or odds == 0 or odds <= -1000 or odds >= 1000:
            continue
        if odds > MAX_SINGLE_LEG_PLUS_ODDS:
            continue
        source = _source_label(source_key, pick.get("source") or fallback_source, player_prop=player_props)
        leg_id = _leg_id(pick, source_key, source, fallback_date)
        if leg_id in seen_ids:
            continue
        seen_ids.add(leg_id)
        sport = _clean_text(pick.get("sport") or pick.get("league") or "OTHER").upper()
        decimal_odds = american_to_decimal(odds)
        raw_probability, probability_source = _extract_probability(pick)
        market_probability = _selected_side_market_probability(pick, odds)
        if raw_probability is None:
            raw_probability = market_probability
        form = source_forms.get(source, SourceForm(source=source))
        game = _game_label(pick)
        game_key = _game_key(pick, sport, pick_date, leg_id)
        player = _clean_text(pick.get("player") or pick.get("player_name"))
        player_key = _player_key(pick, leg_id)
        market = _market_label(pick)
        market_key = _market_key(pick, game_key, pick_text, player)
        source_type = _source_type(source_key, pick, player_props=player_props)
        consensus_key = market_key
        model_rank = _int_number(pick.get("ml_rank") or pick.get("model_rank") or pick.get("rank"))
        source_model_key = _clean_text(pick.get("model_key") or source_key or source)
        mode = "player" if source_type == "player_prop" else "team"
        early_consensus = _consensus_field_hit(pick)
        calibration = calibration_for_leg(
            historical_calibrations,
            mode=mode,
            model_key=source_model_key,
            sport=sport,
            market_family=_market_family(pick),
        )
        probability, calibrated_edge, _, _, _ = blended_leg_probability(
            mode=mode,
            raw_probability=raw_probability,
            market_probability=market_probability,
            odds=odds,
            consensus=early_consensus,
            calibration=calibration,
        )
        if calibrated_edge < MIN_LEG_EDGE:
            continue
        calibrations_by_leg_id[leg_id] = calibration
        raw_legs.append(
            (
                Leg(
                    leg_id=leg_id,
                    pick_id=leg_id,
                    source_key=source_key,
                    source=source,
                    source_type=source_type,
                    sport=sport,
                    date=pick_date,
                    pick=pick_text,
                    decision=decision,
                    odds=odds,
                    decimal_odds=decimal_odds,
                    probability=probability,
                    raw_probability=raw_probability,
                    market_probability=market_probability,
                    calibrated_edge=calibrated_edge,
                    historical_probability=calibration.posterior,
                    calibration_samples=calibration.settled,
                    probability_source=probability_source,
                    game_key=game_key,
                    game=game,
                    market_key=market_key,
                    market=market,
                    player_key=player_key,
                    player=player,
                    result=_result(pick),
                    start_time=_clean_text(pick.get("start_time") or pick.get("game_start_time")),
                    source_form_score=form.score,
                    model_rank=model_rank,
                    consensus_sources=(),
                    consensus=early_consensus,
                    raw=pick,
                ),
                consensus_key,
            )
        )

    sources_by_market: dict[str, set[str]] = defaultdict(set)
    for leg, consensus_key in raw_legs:
        sources_by_market[consensus_key].add(leg.source)

    legs: list[Leg] = []
    for leg, consensus_key in raw_legs:
        consensus_sources = tuple(sorted(sources_by_market[consensus_key]))
        consensus = leg.consensus or len(consensus_sources) >= 2
        probability = leg.probability
        calibrated_edge = leg.calibrated_edge
        if consensus != leg.consensus:
            calibration = calibrations_by_leg_id.get(leg.leg_id, HistoricalCalibration())
            probability, calibrated_edge, _, _, _ = blended_leg_probability(
                mode="player" if leg.source_type == "player_prop" else "team",
                raw_probability=leg.raw_probability,
                market_probability=leg.market_probability,
                odds=leg.odds,
                consensus=consensus,
                calibration=calibration,
            )
            if calibrated_edge < MIN_LEG_EDGE:
                continue
        legs.append(
            Leg(
                **{
                    **leg.__dict__,
                    "probability": probability,
                    "calibrated_edge": calibrated_edge,
                    "consensus_sources": consensus_sources if len(consensus_sources) >= 2 else (),
                    "consensus": consensus,
                }
            )
        )
    return sorted(legs, key=lambda leg: (-leg.probability, leg.source, leg.pick))


def valid_combo(legs: Iterable[Leg]) -> bool:
    leg_list = list(legs)
    if len(leg_list) < 2:
        return False
    if len({leg.leg_id for leg in leg_list}) != len(leg_list):
        return False
    if len({leg.game_key for leg in leg_list}) != len(leg_list):
        return False
    players = [leg.player_key for leg in leg_list if not leg.player_key.startswith("no-player:")]
    if len(set(players)) != len(players):
        return False
    if len({leg.market_key for leg in leg_list}) != len(leg_list):
        return False
    pick_modes = {"player" if leg.source_type == "player_prop" else "team" for leg in leg_list}
    if len(pick_modes) != 1:
        return False
    return True


def sport_pattern(legs: Iterable[Leg]) -> str:
    counts = sorted(Counter(leg.sport for leg in legs).values(), reverse=True)
    if counts == [1, 1, 1]:
        return "1-1-1"
    if counts == [2, 1]:
        return "2-1"
    if counts == [3]:
        return "3-same"
    if counts == [1, 1]:
        return "2-leg-mixed"
    if counts == [2]:
        return "2-same"
    return "-".join(str(count) for count in counts)


def sport_mix(legs: Iterable[Leg]) -> str:
    labels = [
        f"{leg.sport} Props" if leg.source_type == "player_prop" else leg.sport
        for leg in legs
    ]
    return " + ".join(labels)


def payout_quality_score(odds_values: Iterable[int], parlay_odds: int) -> float:
    odds_list = list(odds_values)
    heavy_favorites = sum(1 for odds in odds_list if odds <= -250)
    ultra_favorites = sum(1 for odds in odds_list if odds <= -500)
    longshots = sum(1 for odds in odds_list if odds >= 350)
    quality = 1.0 - heavy_favorites * 0.16 - ultra_favorites * 0.24 - longshots * 0.12
    if heavy_favorites >= 2:
        quality -= 0.18
    if parlay_odds < 150:
        quality -= 0.16
    if parlay_odds > 1400:
        quality -= 0.14
    return round(max(0.05, min(1.0, quality)), 4)


def grade_parlay_result(legs: list[dict[str, Any]] | list[Leg], decimal_odds: float | None = None) -> dict[str, Any]:
    normalized: list[dict[str, Any]] = []
    for leg in legs:
        if isinstance(leg, Leg):
            normalized.append({"result": leg.result, "decimalOdds": leg.decimal_odds})
        else:
            normalized.append(leg)

    results = [_clean_text(leg.get("result")).lower() or "pending" for leg in normalized]
    if any(result == "loss" for result in results):
        return {"result": "loss", "activeLegCount": sum(result != "push" for result in results), "profitUnits": -1.0}
    if any(result == "pending" for result in results):
        return {"result": "pending", "activeLegCount": sum(result != "push" for result in results), "profitUnits": 0.0}
    active = [leg for leg, result in zip(normalized, results) if result != "push"]
    if not active:
        return {"result": "push", "activeLegCount": 0, "profitUnits": 0.0}
    active_decimal = 1.0
    for leg in active:
        active_decimal *= float(leg.get("decimalOdds") or 1)
    if decimal_odds is not None and len(active) == len(normalized):
        active_decimal = decimal_odds
    return {
        "result": "win",
        "activeLegCount": len(active),
        "profitUnits": round(active_decimal - 1.0, 2),
    }


def _leg_payload(leg: Leg) -> dict[str, Any]:
    return {
        "legId": leg.leg_id,
        "pickId": leg.pick_id,
        "source": leg.source,
        "sourceKey": leg.source_key,
        "sourceType": leg.source_type,
        "sport": leg.sport,
        "pick": leg.pick,
        "decision": leg.decision,
        "oddsAmerican": leg.odds,
        "decimalOdds": round(leg.decimal_odds, 4),
        "estimatedProbability": round(leg.probability, 4),
        "rawProbability": round(leg.raw_probability, 4),
        "marketProbability": round(leg.market_probability, 4),
        "calibratedEdge": round(leg.calibrated_edge, 4),
        "historicalProbability": round(leg.historical_probability, 4),
        "calibrationSamples": leg.calibration_samples,
        "probabilitySource": leg.probability_source,
        "game": leg.game,
        "gameKey": leg.game_key,
        "market": leg.market,
        "marketKey": leg.market_key,
        "player": leg.player,
        "result": leg.result,
        "startTime": leg.start_time,
        "consensusSources": list(leg.consensus_sources),
        "modelRank": leg.model_rank,
    }


def _base_card(legs: tuple[Leg, ...]) -> dict[str, Any]:
    decimal_odds = math.prod(leg.decimal_odds for leg in legs)
    estimated_probability = math.prod(leg.probability for leg in legs)
    geomean_probability = estimated_probability ** (1.0 / len(legs))
    odds_american = decimal_to_american(decimal_odds)
    parlay_ev = estimated_probability * decimal_odds - 1.0
    payout_profit = decimal_odds - 1.0
    utility = (
        estimated_probability * math.log1p(0.01 * payout_profit)
        + (1.0 - estimated_probability) * math.log(0.99)
    )
    payout_quality = payout_quality_score((leg.odds for leg in legs), odds_american)
    average_form = sum(leg.source_form_score for leg in legs) / len(legs)
    consensus_count = sum(1 for leg in legs if leg.consensus)
    rank_bonus = sum(max(0.0, 10.0 - float(leg.model_rank or 10)) for leg in legs) / len(legs)
    score = (
        utility * 10000.0
        + max(-0.8, min(1.8, parlay_ev)) * 18.0
        + (average_form - 50.0) * 0.32
        + consensus_count * 3.2
        + (1.5 if len(legs) == 3 else 0.0)
        + rank_bonus * 0.45
    )
    leg_payloads = [_leg_payload(leg) for leg in legs]
    grade = grade_parlay_result(leg_payloads, decimal_odds)
    combo_key = "|".join(sorted(leg.leg_id for leg in legs))
    return {
        "id": "parlay-" + _stable_hash(combo_key),
        "comboKey": combo_key,
        "date": legs[0].date,
        "legCount": len(legs),
        "legs": leg_payloads,
        "sportMix": sport_mix(legs),
        "sportPattern": sport_pattern(legs),
        "sports": sorted({leg.sport for leg in legs}),
        "hasPlayerProp": any(leg.source_type == "player_prop" for leg in legs),
        "pickMode": "player" if all(leg.source_type == "player_prop" for leg in legs) else "team",
        "oddsAmerican": odds_american,
        "decimalOdds": round(decimal_odds, 4),
        "estimatedProbability": round(estimated_probability, 4),
        "geomeanProbability": round(geomean_probability, 4),
        "fairOdds": fair_odds_from_probability(estimated_probability),
        "parlayEv": round(parlay_ev, 4),
        "utility": round(utility, 6),
        "payoutQuality": payout_quality,
        "averageSourceForm": round(average_form, 2),
        "consensusLegs": consensus_count,
        "score": round(score, 4),
        "result": grade["result"],
        "activeLegCount": grade["activeLegCount"],
        "profitUnits": grade["profitUnits"],
        "stakeUnits": 1.0,
    }


def _target_range(category: str, leg_count: int, pick_mode: str) -> tuple[int, int]:
    if leg_count == 2:
        return (100, 390) if pick_mode == "player" else (100, 430)
    if category == "consensus_edge":
        return (240, 1000)
    return (240, 850)


def _within_range(card: dict[str, Any], category: str) -> bool:
    low, high = _target_range(category, int(card["legCount"]), _card_pick_mode(card))
    return low <= int(card["oddsAmerican"]) <= high


def _card_leg_edges(card: dict[str, Any]) -> list[float]:
    values: list[float] = []
    for leg in card.get("legs") or []:
        if isinstance(leg, dict):
            edge = _number(leg.get("calibratedEdge"))
            if edge is not None:
                values.append(edge)
    return values


def qualifies_category(
    card: dict[str, Any],
    category: str,
) -> bool:
    pick_mode = _card_pick_mode(card)
    leg_count = int(card["legCount"])
    if float(card["geomeanProbability"]) < MIN_GEOMEAN_PROBABILITY:
        return False
    if any(int(leg.get("oddsAmerican") or 0) > MAX_SINGLE_LEG_PLUS_ODDS for leg in card.get("legs") or []):
        return False
    edges = _card_leg_edges(card)
    if edges and min(edges) < MIN_LEG_EDGE:
        return False
    if not _within_range(card, category):
        return False
    if category == "consensus_edge":
        min_consensus_legs = 2 if pick_mode == "player" else 1
        min_card_ev = 0.30 if pick_mode == "player" else -0.05
        return leg_count == 3 and int(card["consensusLegs"]) >= min_consensus_legs and float(card["parlayEv"]) >= min_card_ev
    if category == "three_leg_value":
        if leg_count != 3 or float(card["parlayEv"]) < 0.45:
            return False
        return pick_mode == "team" or int(card["consensusLegs"]) >= 2
    if category == "validated_form":
        return (
            pick_mode == "team"
            and leg_count == 3
            and float(card["parlayEv"]) >= 0.30
            and float(card["averageSourceForm"]) >= 63.5
        )
    if category == "compact_edge":
        return leg_count == 2 and float(card["parlayEv"]) >= 0.20 and (pick_mode == "team" or int(card["consensusLegs"]) >= 1)
    return False


def _why_qualified(card: dict[str, Any], category: str, fallback: bool) -> str:
    prefix = "Selective 2-leg card. " if fallback else ""
    if category == "consensus_edge":
        return prefix + "Agreement-backed legs clear the calibrated edge gate and rank well on whole-slip utility."
    if category == "three_leg_value":
        return prefix + "A positive-EV 3-leg slip inside the disciplined target odds window."
    if category == "validated_form":
        return prefix + "Team sources have shrinkage-adjusted form support behind a positive-EV 3-leg slip."
    if category == "compact_edge":
        return prefix + "A 2-leg slip admitted only because the slate is thin or its utility beats the next viable 3-leg."
    return prefix + "Qualified by the calibrated parlay engine."


def _category_card(card: dict[str, Any], category: str, fallback: bool) -> dict[str, Any]:
    category_def = CATEGORY_DEFS[category]
    category_bonus = {
        "consensus_edge": int(card["consensusLegs"]) * 5.0,
        "three_leg_value": max(-0.5, float(card["parlayEv"])) * 12.0 + 1.5,
        "validated_form": (float(card["averageSourceForm"]) - 50.0) * 0.8 + 1.0,
        "compact_edge": max(-0.5, float(card["parlayEv"])) * 10.0,
    }[category]
    clone = dict(card)
    clone["id"] = f"{card['id']}-{category}"
    clone["category"] = category
    clone["categoryLabel"] = category_def["label"]
    clone["categoryShortLabel"] = category_def["shortLabel"]
    clone["title"] = category_def["label"]
    clone["fallback"] = fallback
    clone["whyQualified"] = _why_qualified(card, category, fallback)
    clone["categoryScore"] = round(float(card["score"]) + category_bonus, 4)
    return clone


def _prior_parlay_payloads(target_date: str) -> list[dict[str, Any]]:
    payloads: list[dict[str, Any]] = []
    if not PARLAY_CARDS_DIR.exists():
        return payloads
    for path in sorted(PARLAY_CARDS_DIR.glob("20??-??-??.json")):
        if path.stem >= target_date:
            continue
        payload = _read_json(path)
        if payload:
            payloads.append(payload)
    return payloads


def _empty_record_values() -> dict[str, float]:
    return {"wins": 0, "losses": 0, "net": 0.0}


def category_history(prior_payloads: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
    stats: dict[str, dict[str, float]] = defaultdict(lambda: {"wins": 0, "losses": 0, "net": 0.0})
    seen: set[tuple[str, str, str, str]] = set()
    for payload in prior_payloads:
        for card in payload.get("cards") or []:
            if not isinstance(card, dict):
                continue
            category = _clean_text(card.get("category"))
            result = _clean_text(card.get("result")).lower()
            if category not in CATEGORY_DEFS or result not in {"win", "loss"}:
                continue
            key = (
                _clean_text(payload.get("date") or card.get("date")),
                category,
                _clean_text(card.get("id")),
                _clean_text(card.get("comboKey")),
            )
            if key in seen:
                continue
            seen.add(key)
            stats[category]["wins"] += 1 if result == "win" else 0
            stats[category]["losses"] += 1 if result == "loss" else 0
            stats[category]["net"] += float(card.get("profitUnits") or 0)

    history: dict[str, dict[str, float]] = {}
    for category in CATEGORY_DEFS:
        values = stats[category]
        settled = values["wins"] + values["losses"]
        history[category] = {
            "wins": values["wins"],
            "losses": values["losses"],
            "settled": settled,
            "net": values["net"],
            "hitRate": values["wins"] / settled if settled else 0.0,
            "roi": values["net"] / settled if settled else 0.0,
        }
    return history


def _mode_category_key(mode: str, category: str) -> str:
    return f"{_clean_text(mode).lower()}:{_clean_text(category)}"


def mode_category_history(prior_payloads: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
    stats: dict[str, dict[str, float]] = defaultdict(_empty_record_values)
    seen: set[tuple[str, str, str, str, str]] = set()
    for payload in prior_payloads:
        if _clean_text(payload.get("engineVersion")) != ENGINE_VERSION:
            continue
        for card in payload.get("cards") or []:
            if not isinstance(card, dict):
                continue
            category = _clean_text(card.get("category"))
            result = _clean_text(card.get("result")).lower()
            mode = _card_pick_mode(card)
            if category not in CATEGORY_DEFS or mode not in {"team", "player"} or result not in {"win", "loss"}:
                continue
            key = (
                _clean_text(payload.get("date") or card.get("date")),
                mode,
                category,
                _clean_text(card.get("id")),
                _clean_text(card.get("comboKey")),
            )
            if key in seen:
                continue
            seen.add(key)
            bucket = stats[_mode_category_key(mode, category)]
            bucket["wins"] += 1 if result == "win" else 0
            bucket["losses"] += 1 if result == "loss" else 0
            bucket["net"] += float(card.get("profitUnits") or 0)

    history: dict[str, dict[str, float]] = {}
    for mode in ("team", "player"):
        for category in CATEGORY_DEFS:
            values = stats[_mode_category_key(mode, category)]
            settled = values["wins"] + values["losses"]
            history[_mode_category_key(mode, category)] = {
                "wins": values["wins"],
                "losses": values["losses"],
                "settled": settled,
                "net": values["net"],
                "hitRate": values["wins"] / settled if settled else 0.0,
                "roi": values["net"] / settled if settled else 0.0,
            }
    return history


def category_weights(prior_payloads: list[dict[str, Any]]) -> dict[str, float]:
    return {category: 1.0 for category in CATEGORY_DEFS}


def _mode_category_is_shutdown(mode: str, category: str, history: dict[str, dict[str, float]]) -> bool:
    values = history.get(_mode_category_key(mode, category)) or {}
    settled = int(values.get("settled") or 0)
    if settled < COLD_CATEGORY_MIN_SETTLED:
        return False
    return float(values.get("roi") or 0.0) < COLD_CATEGORY_ROI


def generate_candidate_cards(legs: list[Leg], leg_count: int) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []
    for combo in combinations(legs, leg_count):
        if not valid_combo(combo):
            continue
        card = _base_card(combo)
        if float(card["geomeanProbability"]) < MIN_GEOMEAN_PROBABILITY:
            continue
        cards.append(card)
    return cards


def _portfolio_sort_key(card: dict[str, Any]) -> tuple[float, float, int, float, int, float]:
    return (
        float(card.get("utility") or 0.0),
        float(card.get("parlayEv") or 0.0),
        int(card.get("consensusLegs") or 0),
        float(card.get("averageSourceForm") or 0.0),
        1 if int(card.get("legCount") or 0) == 3 else 0,
        float(card.get("categoryScore") or card.get("score") or 0.0),
    )


def _compact_edge_admitted(card: dict[str, Any], *, thin_slate: bool, best_three_utility: float | None) -> bool:
    if thin_slate or best_three_utility is None:
        return True
    card_utility = float(card.get("utility") or 0.0)
    if best_three_utility <= 0:
        return card_utility > best_three_utility
    return card_utility >= best_three_utility * 1.15


def select_cards(
    three_leg_cards: list[dict[str, Any]],
    two_leg_cards: list[dict[str, Any]],
    *,
    mode: str,
    history: dict[str, dict[str, float]] | None = None,
) -> list[dict[str, Any]]:
    history = history or {}
    selected: list[dict[str, Any]] = []
    selected_combo_keys: set[str] = set()
    exposure: Counter[str] = Counter()
    selected_category_counts: Counter[str] = Counter()
    unique_leg_ids = {
        str(leg["legId"])
        for card in three_leg_cards
        for leg in card.get("legs", [])
        if isinstance(leg, dict)
    }
    thin_slate = len(unique_leg_ids) < 5 or len(three_leg_cards) < 3
    three_by_category = {
        category: sorted(
            [
                _category_card(card, category, False)
                for card in three_leg_cards
                if category != "compact_edge"
                and not _mode_category_is_shutdown(mode, category, history)
                and qualifies_category(card, category)
            ],
            key=_portfolio_sort_key,
            reverse=True,
        )
        for category in CATEGORY_ORDER
    }
    viable_three = [
        card
        for category in CATEGORY_ORDER
        if category != "compact_edge"
        for card in three_by_category[category]
    ]
    best_three_utility = max((float(card.get("utility") or 0.0) for card in viable_three), default=None)
    compact_cards = sorted(
        [
            _category_card(card, "compact_edge", True)
            for card in two_leg_cards
            if not _mode_category_is_shutdown(mode, "compact_edge", history)
            and qualifies_category(card, "compact_edge")
            and _compact_edge_admitted(card, thin_slate=thin_slate, best_three_utility=best_three_utility)
        ],
        key=_portfolio_sort_key,
        reverse=True,
    )
    three_by_category["compact_edge"] = compact_cards

    def try_add(card: dict[str, Any]) -> bool:
        category = _clean_text(card.get("category"))
        if len(selected) >= MAX_CARDS_PER_MODE:
            return False
        if card["comboKey"] in selected_combo_keys:
            return False
        if selected_category_counts[category] >= MAX_CARDS_PER_CATEGORY:
            return False
        leg_ids = [str(leg["legId"]) for leg in card["legs"]]
        if any(exposure[leg_id] >= DEFAULT_EXPOSURE_CAP for leg_id in leg_ids):
            return False
        selected.append(card)
        selected_combo_keys.add(str(card["comboKey"]))
        exposure.update(leg_ids)
        selected_category_counts[category] += 1
        return True

    for category in CATEGORY_ORDER:
        if len(selected) >= MAX_CARDS_PER_MODE:
            break
        for card in three_by_category[category]:
            if selected_category_counts[category] >= MAX_CARDS_PER_CATEGORY:
                break
            try_add(card)

    if len(selected) < MAX_CARDS_PER_MODE:
        for category in CATEGORY_ORDER:
            for card in three_by_category[category]:
                if len(selected) >= MAX_CARDS_PER_MODE:
                    break
                try_add(card)

    selected.sort(key=lambda card: (CATEGORY_ORDER.index(str(card["category"])), -float(card["categoryScore"])))
    return selected[:MAX_CARDS_PER_MODE]


def _card_pick_mode(card: dict[str, Any]) -> str:
    mode = _clean_text(card.get("pickMode")).lower()
    if mode in {"team", "player"}:
        return mode
    legs = [leg for leg in card.get("legs") or [] if isinstance(leg, dict)]
    has_player = any(_clean_text(leg.get("sourceType")) == "player_prop" for leg in legs)
    has_team = any(_clean_text(leg.get("sourceType")) != "player_prop" for leg in legs)
    if has_player and has_team:
        return "mixed"
    return "player" if has_player else "team"


def select_cards_by_mode(
    three_leg_cards: list[dict[str, Any]],
    two_leg_cards: list[dict[str, Any]],
    history: dict[str, dict[str, float]] | None = None,
) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    for mode in ("team", "player"):
        mode_three = [card for card in three_leg_cards if _card_pick_mode(card) == mode]
        mode_two = [card for card in two_leg_cards if _card_pick_mode(card) == mode]
        selected.extend(select_cards(mode_three, mode_two, mode=mode, history=history))
    selected.sort(
        key=lambda card: (
            0 if _card_pick_mode(card) == "team" else 1,
            CATEGORY_ORDER.index(str(card["category"])),
            -float(card["categoryScore"]),
        )
    )
    return selected


def _card_dedupe_key(card: dict[str, Any]) -> tuple[str, str, str, str]:
    return (
        _clean_text(card.get("date")),
        _clean_text(card.get("category")),
        _clean_text(card.get("id")),
        _clean_text(card.get("comboKey")),
    )


def _dedupe_cards(cards: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    for card in cards:
        if isinstance(card, dict):
            deduped[_card_dedupe_key(card)] = card
    return list(deduped.values())


def _record_from_cards(cards: Iterable[dict[str, Any]]) -> dict[str, Any]:
    wins = losses = pushes = pending = 0
    net = 0.0
    odds_values: list[int] = []
    recent_results: list[str] = []
    for card in _dedupe_cards(cards):
        result = _clean_text(card.get("result")).lower() or "pending"
        wins += result == "win"
        losses += result == "loss"
        pushes += result == "push"
        pending += result == "pending"
        if result in {"win", "loss"}:
            net += float(card.get("profitUnits") or 0)
            odds_values.append(int(card.get("oddsAmerican") or 0))
            recent_results.append("W" if result == "win" else "L")
        elif result == "push":
            recent_results.append("P")
    settled = wins + losses
    return {
        "wins": wins,
        "losses": losses,
        "pushes": pushes,
        "pending": pending,
        "settled": settled,
        "hitRate": round(wins / settled, 4) if settled else None,
        "netUnits": round(net, 2),
        "roi": round(net / settled, 4) if settled else None,
        "averageOdds": round(sum(odds_values) / len(odds_values), 1) if odds_values else None,
        "recentForm": "".join(recent_results[-5:]) or "",
    }


def rankings(prior_payloads: list[dict[str, Any]], selected_cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_category: dict[str, list[dict[str, Any]]] = {category: [] for category in CATEGORY_DEFS}
    for payload in prior_payloads:
        for card in payload.get("cards") or []:
            if isinstance(card, dict) and card.get("category") in by_category:
                by_category[str(card["category"])].append(card)
    for card in selected_cards:
        by_category[str(card["category"])].append(card)

    rows = []
    for category in CATEGORY_ORDER:
        category_cards = _dedupe_cards(by_category[category])
        record = _record_from_cards(category_cards)
        row = {
            "category": category,
            "label": CATEGORY_DEFS[category]["shortLabel"],
            "description": CATEGORY_DEFS[category]["description"],
            **record,
        }
        hit_rate = row["hitRate"] if row["hitRate"] is not None else 0.5
        roi = row["roi"] if row["roi"] is not None else 0.0
        row["score"] = round(hit_rate * 70 + roi * 15 + min(int(row["settled"]), 20) * 0.4, 4)
        rows.append(row)
    return sorted(rows, key=lambda row: float(row["score"]), reverse=True)


def build_parlay_payload(
    date_iso: str,
    team_payload: dict[str, Any] | None,
    prop_payload: dict[str, Any] | None,
    *,
    team_history: list[dict[str, Any]] | None = None,
    prop_history: list[dict[str, Any]] | None = None,
    prior_payloads: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    team_history = team_history if team_history is not None else _payloads_before(MODEL_CACHE_DIR, date_iso)
    prop_history = prop_history if prop_history is not None else _payloads_before(PLAYER_PROPS_CACHE_DIR, date_iso)
    prior_payloads = prior_payloads if prior_payloads is not None else _prior_parlay_payloads(date_iso)
    source_forms = build_source_forms(date_iso, team_history, prop_history)
    historical_calibrations = build_historical_calibration(date_iso)
    legs = collect_legs(date_iso, team_payload, prop_payload, source_forms, historical_calibrations)
    three_leg_cards = generate_candidate_cards(legs, 3)
    two_leg_cards = generate_candidate_cards(legs, 2)
    mode_history = mode_category_history(prior_payloads)
    cards = select_cards_by_mode(three_leg_cards, two_leg_cards, mode_history)
    ranking_prior_payloads = [
        payload for payload in prior_payloads
        if _clean_text(payload.get("engineVersion")) == ENGINE_VERSION
    ]

    category_summaries = []
    for category in CATEGORY_ORDER:
        category_cards = [card for card in cards if card.get("category") == category]
        category_summaries.append(
            {
                "key": category,
                "label": CATEGORY_DEFS[category]["label"],
                "shortLabel": CATEGORY_DEFS[category]["shortLabel"],
                "description": CATEGORY_DEFS[category]["description"],
                "count": len(category_cards),
                "threeLegCount": sum(1 for card in category_cards if int(card.get("legCount") or 0) == 3),
                "fallbackCount": sum(1 for card in category_cards if card.get("fallback")),
                "record": _record_from_cards(category_cards),
                "shutdowns": {
                    mode: _mode_category_is_shutdown(mode, category, mode_history)
                    for mode in ("team", "player")
                },
            }
        )

    mode_summaries: dict[str, dict[str, Any]] = {}
    for mode in ("team", "player"):
        mode_cards = [card for card in cards if _card_pick_mode(card) == mode]
        mode_three_leg_count = sum(1 for card in mode_cards if int(card.get("legCount") or 0) == 3)
        mode_summaries[mode] = {
            "displayedCards": len(mode_cards),
            "threeLegCards": mode_three_leg_count,
            "twoLegFallbackCards": len(mode_cards) - mode_three_leg_count,
            "averageOdds": (
                round(sum(int(card["oddsAmerican"]) for card in mode_cards) / len(mode_cards), 1)
                if mode_cards
                else None
            ),
            "record": _record_from_cards(mode_cards),
        }

    average_odds = (
        round(sum(int(card["oddsAmerican"]) for card in cards) / len(cards), 1)
        if cards
        else None
    )
    three_leg_count = sum(1 for card in cards if int(card.get("legCount") or 0) == 3)
    notices = [
        "No same-game legs, same-player duplicates, or duplicate markets are allowed in a slip.",
        "Every leg must clear at least +1.5 percentage points of calibrated edge over the market price.",
        "Compact Edge is the only 2-leg category and is used only for thin slates or higher whole-slip utility.",
        "Weak slates are allowed to show fewer cards instead of forcing action.",
    ]
    if not cards:
        notices.append("No qualified parlay cards met the probability, price, and overlap rules for this slate.")

    return {
        "date": date_iso,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "engineVersion": ENGINE_VERSION,
        "summary": {
            "eligibleLegs": len(legs),
            "generatedThreeLegCandidates": len(three_leg_cards),
            "displayedCards": len(cards),
            "threeLegCards": three_leg_count,
            "twoLegFallbackCards": len(cards) - three_leg_count,
            "averageOdds": average_odds,
            "record": _record_from_cards(cards),
            "modes": mode_summaries,
        },
        "categories": category_summaries,
        "rankings": rankings(ranking_prior_payloads, cards),
        "cards": cards,
        "notices": notices,
    }


def _target_dates(all_dates: bool, explicit_date: str | None) -> list[str]:
    if explicit_date:
        return [explicit_date]
    model_dates = {path.stem for path in MODEL_CACHE_DIR.glob("20??-??-??.json")}
    prop_dates = {path.stem for path in PLAYER_PROPS_CACHE_DIR.glob("20??-??-??.json")}
    dates = sorted(model_dates | prop_dates)
    if all_dates:
        return dates
    latest_model = _read_json(MODEL_CACHE_DIR / "latest.json") or {}
    latest_prop = _read_json(PLAYER_PROPS_CACHE_DIR / "latest.json") or {}
    latest = _clean_text(latest_model.get("date") or latest_prop.get("date"))
    return [latest or dates[-1]] if dates or latest else []


def _write_manifest() -> bool:
    files = sorted(path.name for path in PARLAY_CARDS_DIR.glob("20??-??-??.json"))
    return _write_json_if_changed(PARLAY_CARDS_DIR / "index.json", {"files": files})


def rebuild_parlay_cards(*, date_iso: str | None = None, all_dates: bool = False) -> int:
    changed = 0
    dates = _target_dates(all_dates, date_iso)
    if not dates:
        print("[parlay-cards] no cache dates available")
        return 0

    for target in dates:
        team_payload = _read_json(MODEL_CACHE_DIR / f"{target}.json")
        prop_payload = _read_json(PLAYER_PROPS_CACHE_DIR / f"{target}.json")
        if not team_payload and not prop_payload:
            print(f"[parlay-cards] skipped {target}: no source caches")
            continue
        payload = build_parlay_payload(target, team_payload, prop_payload)
        path = PARLAY_CARDS_DIR / f"{target}.json"
        if _write_json_if_changed(path, payload):
            changed += 1
        print(
            f"[parlay-cards] {target}: "
            f"{payload['summary']['displayedCards']} card(s), "
            f"{payload['summary']['eligibleLegs']} eligible leg(s)"
        )

    if _write_manifest():
        changed += 1

    files = sorted(PARLAY_CARDS_DIR.glob("20??-??-??.json"))
    if files:
        latest_payload = _read_json(files[-1])
        if latest_payload and _write_json_if_changed(PARLAY_CARDS_DIR / "latest.json", latest_payload):
            changed += 1
    return changed


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", help="Target date to build, in YYYY-MM-DD format.")
    parser.add_argument("--all", action="store_true", help="Rebuild every dated parlay-card file.")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    changed = rebuild_parlay_cards(date_iso=args.date, all_dates=args.all)
    print(f"[parlay-cards] complete: {changed} file update(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
