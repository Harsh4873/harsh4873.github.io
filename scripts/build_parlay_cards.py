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

TEAM_VISIBLE_DECISIONS = {"BET", "LEAN"}
MIN_GEOMEAN_PROBABILITY = 0.525
MAX_CARDS = 15
MAX_CARDS_PER_CATEGORY = 3
DEFAULT_EXPOSURE_CAP = 3

SOURCE_LABELS: dict[str, str] = {
    "mlb_new": "MLB Model",
    "mlb_inning": "MLB Inning",
    "mlb_first_five": "MLB First Five",
    "wnba": "WNBA Model",
    "nba": "NBA New",
    "nba_playoffs": "NBA Playoffs",
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
}

CATEGORY_DEFS: dict[str, dict[str, str]] = {
    "consensus": {
        "label": "Consensus Parlays",
        "shortLabel": "Consensus",
        "description": "Matching sources, consensus fields, or strong model agreement.",
    },
    "surefire": {
        "label": "Surefire Parlays",
        "shortLabel": "Surefire",
        "description": "Highest estimated hit probability with playable combined odds.",
    },
    "best_odds": {
        "label": "Best Odds Parlays",
        "shortLabel": "Best Odds",
        "description": "Best payout and EV balance without longshot junk.",
    },
    "hot_models": {
        "label": "Hot Model Parlays",
        "shortLabel": "Hot Models",
        "description": "Weighted toward sources and models with recent or all-time form.",
    },
    "cross_sport": {
        "label": "Cross-Sport Parlays",
        "shortLabel": "Cross-Sport",
        "description": "Clean mixes across MLB, FIFA, WNBA, and player-prop sources.",
    },
    "same_sport": {
        "label": "Same-Sport Parlays",
        "shortLabel": "Same-Sport",
        "description": "Best same-sport cards when they grade above mixed alternatives.",
    },
}

CATEGORY_ORDER = [
    "consensus",
    "surefire",
    "best_odds",
    "hot_models",
    "cross_sport",
    "same_sport",
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
        "probability",
        "model_probability",
        "predicted_probability",
        "calibrated_probability",
        "calibrated_model_probability",
        "ml_probability",
        "variant_signal_probability",
    ):
        probability = normalize_probability(pick.get(key))
        if probability is not None:
            return probability, str(key)
    return None, "market_implied"


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
) -> list[Leg]:
    source_forms = source_forms or {}
    records: list[tuple[str, str, str, dict[str, Any], bool]] = []
    if team_payload:
        records.extend((*record, False) for record in _iter_model_records(team_payload, player_props=False))
    if prop_payload:
        records.extend((*record, True) for record in _iter_model_records(prop_payload, player_props=True))

    raw_legs: list[tuple[Leg, str]] = []
    seen_ids: set[str] = set()
    for source_key, fallback_source, fallback_date, pick, player_props in records:
        decision = _clean_text(pick.get("decision")).upper()
        if decision not in TEAM_VISIBLE_DECISIONS:
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
        source = _source_label(source_key, pick.get("source") or fallback_source, player_prop=player_props)
        leg_id = _leg_id(pick, source_key, source, fallback_date)
        if leg_id in seen_ids:
            continue
        seen_ids.add(leg_id)
        sport = _clean_text(pick.get("sport") or pick.get("league") or "OTHER").upper()
        decimal_odds = american_to_decimal(odds)
        base_probability, probability_source = _extract_probability(pick)
        if base_probability is None:
            base_probability = implied_probability(odds)
        form = source_forms.get(source, SourceForm(source=source))
        decision_bonus = 0.012 if decision == "BET" else 0.004
        adjusted_probability = base_probability + form.probability_adjustment + decision_bonus
        if probability_source != "market_implied":
            adjusted_probability += 0.006
        probability = max(0.35, min(0.92, adjusted_probability))
        game = _game_label(pick)
        game_key = _game_key(pick, sport, pick_date, leg_id)
        player = _clean_text(pick.get("player") or pick.get("player_name"))
        player_key = _player_key(pick, leg_id)
        market = _market_label(pick)
        market_key = _market_key(pick, game_key, pick_text, player)
        source_type = _source_type(source_key, pick, player_props=player_props)
        consensus_key = market_key
        model_rank = _int_number(pick.get("ml_rank") or pick.get("model_rank") or pick.get("rank"))
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
                    consensus=_consensus_field_hit(pick),
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
        legs.append(
            Leg(
                **{
                    **leg.__dict__,
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
    payout_quality = payout_quality_score((leg.odds for leg in legs), odds_american)
    average_form = sum(leg.source_form_score for leg in legs) / len(legs)
    consensus_count = sum(1 for leg in legs if leg.consensus)
    rank_bonus = sum(max(0.0, 10.0 - float(leg.model_rank or 10)) for leg in legs) / len(legs)
    score = (
        geomean_probability * 86.0
        + max(-0.8, min(1.8, parlay_ev)) * 22.0
        + math.log(decimal_odds) * 5.0
        + payout_quality * 13.0
        + (average_form - 50.0) * 0.32
        + consensus_count * 3.2
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
        "payoutQuality": payout_quality,
        "averageSourceForm": round(average_form, 2),
        "consensusLegs": consensus_count,
        "score": round(score, 4),
        "result": grade["result"],
        "activeLegCount": grade["activeLegCount"],
        "profitUnits": grade["profitUnits"],
        "stakeUnits": 1.0,
    }


def _target_range(category: str, leg_count: int) -> tuple[int, int]:
    if category == "surefire":
        return (100, 650) if leg_count == 2 else (180, 650)
    if category == "best_odds":
        return (180, 900) if leg_count == 2 else (400, 1200)
    if category in {"hot_models", "cross_sport", "same_sport"}:
        return (150, 800) if leg_count == 2 else (250, 900)
    return (100, 1200) if leg_count == 2 else (180, 1200)


def _within_range(card: dict[str, Any], category: str) -> bool:
    low, high = _target_range(category, int(card["legCount"]))
    return low <= int(card["oddsAmerican"]) <= high


def qualifies_category(card: dict[str, Any], category: str) -> bool:
    odds_values = [int(leg["oddsAmerican"]) for leg in card["legs"]]
    sports = set(card["sports"])
    if float(card["geomeanProbability"]) < MIN_GEOMEAN_PROBABILITY:
        return False
    if category == "consensus":
        return int(card["consensusLegs"]) >= 1 and _within_range(card, category)
    if category == "surefire":
        return _within_range(card, category) and min(odds_values) > -350 and float(card["payoutQuality"]) >= 0.48
    if category == "best_odds":
        return _within_range(card, category) and max(odds_values) <= 300 and float(card["parlayEv"]) > -0.25
    if category == "hot_models":
        return _within_range(card, category) and float(card["averageSourceForm"]) >= 48.0
    if category == "cross_sport":
        return _within_range(card, category) and len(sports) >= 2
    if category == "same_sport":
        return _within_range(card, category) and len(sports) == 1
    return False


def _why_qualified(card: dict[str, Any], category: str, fallback: bool) -> str:
    prefix = "Fallback 2-leg card. " if fallback else ""
    if category == "consensus":
        return prefix + "At least one leg is backed by matching sources, consensus fields, or model agreement."
    if category == "surefire":
        return prefix + "Built from the highest blended hit probabilities while avoiding ugly favorite stacks."
    if category == "best_odds":
        return prefix + "Balances projected payout, fair odds, EV, and single-leg price discipline."
    if category == "hot_models":
        return prefix + "Ranks higher because its sources or models have stronger recent and all-time form."
    if category == "cross_sport":
        return prefix + "Combines clean legs across sports and sources without same-game overlap."
    if category == "same_sport":
        return prefix + "Keeps one sport together because this clean combo outranks weaker mixed alternatives."
    return prefix + "Qualified by the parlay engine."


def _category_card(card: dict[str, Any], category: str, category_weight: float, fallback: bool) -> dict[str, Any]:
    category_def = CATEGORY_DEFS[category]
    category_bonus = {
        "consensus": int(card["consensusLegs"]) * 5.0,
        "surefire": float(card["geomeanProbability"]) * 18.0,
        "best_odds": max(-0.5, float(card["parlayEv"])) * 16.0,
        "hot_models": (float(card["averageSourceForm"]) - 50.0) * 0.65,
        "cross_sport": len(card["sports"]) * 3.0 + (2.0 if card["hasPlayerProp"] else 0.0),
        "same_sport": 4.0 if card["sportPattern"] == "3-same" else 1.0,
    }[category]
    clone = dict(card)
    clone["id"] = f"{card['id']}-{category}"
    clone["category"] = category
    clone["categoryLabel"] = category_def["label"]
    clone["categoryShortLabel"] = category_def["shortLabel"]
    clone["title"] = category_def["label"]
    clone["fallback"] = fallback
    clone["whyQualified"] = _why_qualified(card, category, fallback)
    clone["categoryScore"] = round((float(card["score"]) + category_bonus) * category_weight, 4)
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


def category_weights(prior_payloads: list[dict[str, Any]]) -> dict[str, float]:
    stats: dict[str, dict[str, float]] = defaultdict(lambda: {"wins": 0, "losses": 0, "net": 0.0})
    for payload in prior_payloads:
        for card in payload.get("cards") or []:
            if not isinstance(card, dict):
                continue
            category = _clean_text(card.get("category"))
            result = _clean_text(card.get("result")).lower()
            if category not in CATEGORY_DEFS or result not in {"win", "loss"}:
                continue
            stats[category]["wins"] += 1 if result == "win" else 0
            stats[category]["losses"] += 1 if result == "loss" else 0
            stats[category]["net"] += float(card.get("profitUnits") or 0)

    weights = {category: 1.0 for category in CATEGORY_DEFS}
    for category, values in stats.items():
        settled = values["wins"] + values["losses"]
        if not settled:
            continue
        win_rate = values["wins"] / settled
        roi = max(-1.0, min(1.5, values["net"] / settled))
        shrink = settled / (settled + 20.0)
        weights[category] = round(max(0.82, min(1.18, 1.0 + shrink * ((win_rate - 0.5) * 0.18 + roi * 0.06))), 4)
    return weights


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


def select_cards(three_leg_cards: list[dict[str, Any]], two_leg_cards: list[dict[str, Any]], weights: dict[str, float]) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    selected_combo_keys: set[str] = set()
    exposure: Counter[str] = Counter()
    unique_leg_ids = {
        str(leg["legId"])
        for card in three_leg_cards
        for leg in card.get("legs", [])
        if isinstance(leg, dict)
    }
    thin_slate = len(unique_leg_ids) < 10 or len(three_leg_cards) < 10
    exposure_cap = 99 if thin_slate else DEFAULT_EXPOSURE_CAP
    three_by_category = {
        category: sorted(
            [
                _category_card(card, category, weights.get(category, 1.0), False)
                for card in three_leg_cards
                if qualifies_category(card, category)
            ],
            key=lambda card: float(card["categoryScore"]),
            reverse=True,
        )
        for category in CATEGORY_ORDER
    }
    fallback_by_category = {
        category: sorted(
            [
                _category_card(card, category, weights.get(category, 1.0), True)
                for card in two_leg_cards
                if qualifies_category(card, category)
            ],
            key=lambda card: float(card["categoryScore"]),
            reverse=True,
        )
        for category in CATEGORY_ORDER
    }

    for index, category in enumerate(CATEGORY_ORDER):
        if len(selected) >= MAX_CARDS:
            break
        picked_for_category = 0
        remaining_viable_categories = sum(
            1
            for later in CATEGORY_ORDER[index + 1 :]
            if three_by_category[later] or fallback_by_category[later]
        )
        category_limit = min(
            MAX_CARDS_PER_CATEGORY,
            max(0, MAX_CARDS - len(selected) - remaining_viable_categories),
        )
        for card in three_by_category[category]:
            if picked_for_category >= category_limit or len(selected) >= MAX_CARDS:
                break
            if card["comboKey"] in selected_combo_keys:
                continue
            leg_ids = [str(leg["legId"]) for leg in card["legs"]]
            if any(exposure[leg_id] >= exposure_cap for leg_id in leg_ids):
                continue
            selected.append(card)
            selected_combo_keys.add(str(card["comboKey"]))
            exposure.update(leg_ids)
            picked_for_category += 1

        if picked_for_category:
            continue

        fallback_limit = min(2, category_limit)
        for card in fallback_by_category[category]:
            if picked_for_category >= fallback_limit or len(selected) >= MAX_CARDS:
                break
            if card["comboKey"] in selected_combo_keys:
                continue
            leg_ids = [str(leg["legId"]) for leg in card["legs"]]
            if any(exposure[leg_id] >= exposure_cap for leg_id in leg_ids):
                continue
            selected.append(card)
            selected_combo_keys.add(str(card["comboKey"]))
            exposure.update(leg_ids)
            picked_for_category += 1

    if len(selected) < MAX_CARDS:
        for category in CATEGORY_ORDER:
            for card in three_by_category[category] + fallback_by_category[category]:
                if len(selected) >= MAX_CARDS:
                    break
                if card["comboKey"] in selected_combo_keys:
                    continue
                leg_ids = [str(leg["legId"]) for leg in card["legs"]]
                if any(exposure[leg_id] >= exposure_cap for leg_id in leg_ids):
                    continue
                selected.append(card)
                selected_combo_keys.add(str(card["comboKey"]))
                exposure.update(leg_ids)

    selected.sort(key=lambda card: (CATEGORY_ORDER.index(str(card["category"])), -float(card["categoryScore"])))
    return selected[:MAX_CARDS]


def _record_from_cards(cards: Iterable[dict[str, Any]]) -> dict[str, Any]:
    wins = losses = pushes = pending = 0
    net = 0.0
    odds_values: list[int] = []
    recent_results: list[str] = []
    for card in cards:
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
        record = _record_from_cards(by_category[category])
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
    legs = collect_legs(date_iso, team_payload, prop_payload, source_forms)
    three_leg_cards = generate_candidate_cards(legs, 3)
    two_leg_cards = generate_candidate_cards(legs, 2)
    weights = category_weights(prior_payloads)
    cards = select_cards(three_leg_cards, two_leg_cards, weights)

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
                "weight": weights.get(category, 1.0),
            }
        )

    average_odds = (
        round(sum(int(card["oddsAmerican"]) for card in cards) / len(cards), 1)
        if cards
        else None
    )
    three_leg_count = sum(1 for card in cards if int(card.get("legCount") or 0) == 3)
    notices = [
        "No same-game legs, same-player duplicates, or duplicate markets are allowed in a slip.",
        "3-leg slips are generated and ranked before any 2-leg fallback cards.",
        "Weak slates are allowed to show fewer cards instead of forcing action.",
    ]
    if not cards:
        notices.append("No qualified parlay cards met the probability, price, and overlap rules for this slate.")

    return {
        "date": date_iso,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "engineVersion": "parlay_cards_v1",
        "summary": {
            "eligibleLegs": len(legs),
            "generatedThreeLegCandidates": len(three_leg_cards),
            "displayedCards": len(cards),
            "threeLegCards": three_leg_count,
            "twoLegFallbackCards": len(cards) - three_leg_count,
            "averageOdds": average_odds,
            "record": _record_from_cards(cards),
        },
        "categories": category_summaries,
        "rankings": rankings(prior_payloads, cards),
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
