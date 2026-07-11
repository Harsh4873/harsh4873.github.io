#!/usr/bin/env python3
"""Build the decision-first Profit Desk from committed pick caches.

The first policy is intentionally shadow-only.  It does not turn model scores,
consensus, or a good-looking short record into a bet.  Every estimate starts at
the market's verified no-vig probability and adds only a conservatively shrunk
estimate of the source's *prior* residual (outcome minus no-vig probability).

The resulting files are deterministic for a given set of inputs and are safe
to rebuild because dates before ``ENGINE_CUTOVER_DATE`` are never written.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


REPO_ROOT = Path(__file__).resolve().parents[1]
MODEL_CACHE_DIR = REPO_ROOT / "data" / "model_cache"
PLAYER_PROPS_CACHE_DIR = REPO_ROOT / "data" / "player_props_cache"
PROFIT_DESK_DIR = REPO_ROOT / "data" / "profit_desk"

ENGINE_VERSION = "profit_desk_v1_shadow"
ENGINE_CUTOVER_DATE = "2026-07-10"

VISIBLE_DECISIONS = {"BET", "LEAN"}
MAX_PRICE_AGE_HOURS = 24.0
MIN_SOURCE_SAMPLES = 100
MIN_SEGMENT_SAMPLES = 40
MIN_DISTINCT_DATES = 20
MIN_PROBABILITY_POSITIVE_EV = 0.80
MIN_CONSERVATIVE_PROBABILITY_MARGIN = 0.02
MAX_PER_MODE = 3

# Zero-centered source prior, then a segment prior centered on the source.
SOURCE_PRIOR_ROWS = 40.0
SEGMENT_PRIOR_ROWS = 25.0
MIN_RESIDUAL_VARIANCE = 0.04
LOWER_BOUND_Z = 1.2815515655446004  # one-sided 90% lower bound

_NON_EXECUTABLE_MARKERS = (
    "assumed",
    "synthetic",
    "proxy",
    "fallback",
    "default",
    "estimated",
    "derived",
    "model price",
    "model_price",
)
_DATE_FILE_RE = re.compile(r"^20\d\d-\d\d-\d\d$")
_DIRECTION_RE = re.compile(r"\b(over|under|yes|no)\b", re.IGNORECASE)
_LINE_RE = re.compile(r"(?<![A-Za-z])([+-]?\d+(?:[.,]\d+)?)")


# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------


def _text(value: Any) -> str:
    return str(value or "").strip()


def _norm(value: Any) -> str:
    return " ".join(
        "".join(char.lower() if char.isalnum() else " " for char in _text(value)).split()
    )


def _number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def normalize_probability(value: Any) -> float | None:
    number = _number(value)
    if number is None:
        return None
    if 1.0 < number <= 100.0:
        number /= 100.0
    if not 0.0 < number < 1.0:
        return None
    return number


def american_to_decimal(odds: Any) -> float | None:
    number = _number(odds)
    if number is None or number == 0 or -100.0 < number < 100.0:
        return None
    if number > 0:
        return 1.0 + number / 100.0
    return 1.0 + 100.0 / abs(number)


def implied_probability(odds: Any) -> float | None:
    decimal = american_to_decimal(odds)
    return (1.0 / decimal) if decimal else None


def _american_int(value: Any) -> int | None:
    number = _number(value)
    decimal = american_to_decimal(number)
    if number is None or decimal is None:
        return None
    return int(round(number))


def _parse_timestamp(value: Any) -> datetime | None:
    raw = _text(value)
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _stable_hash(value: Any, length: int = 20) -> str:
    rendered = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(rendered.encode("utf-8")).hexdigest()[:length]


def _json_text(payload: Mapping[str, Any]) -> str:
    return json.dumps(payload, indent=2, sort_keys=True, default=str) + "\n"


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _write_json_if_changed(path: Path, payload: Mapping[str, Any]) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    rendered = _json_text(payload)
    if path.exists() and path.read_text(encoding="utf-8") == rendered:
        return False
    path.write_text(rendered, encoding="utf-8")
    return True


def _first(mapping: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        value = mapping.get(key)
        if value not in (None, ""):
            return value
    return None


def _result(value: Any) -> str:
    result = _norm(value)
    if result in {"win", "won", "w"}:
        return "win"
    if result in {"loss", "lost", "l"}:
        return "loss"
    if result in {"push", "void", "p"}:
        return "push"
    return "pending"


def _record_date(record: Mapping[str, Any], fallback: str) -> str:
    return _text(_first(record, "date", "game_date", "slate_date", "Date") or fallback)


def _pick_text(record: Mapping[str, Any]) -> str:
    return _text(_first(record, "pick", "selection", "prop", "bet"))


def _game_label(record: Mapping[str, Any]) -> str:
    explicit = _text(_first(record, "matchup", "game", "event"))
    if explicit:
        return explicit
    away = _text(record.get("away_team"))
    home = _text(record.get("home_team"))
    return f"{away} @ {home}" if away and home else ""


def canonical_game_key(record: Mapping[str, Any], sport: str, date_iso: str) -> str:
    """Return an order-insensitive game identity shared across sources."""

    away = _norm(record.get("away_team"))
    home = _norm(record.get("home_team"))
    teams = [team for team in (away, home) if team]
    label = _game_label(record)
    if len(teams) < 2 and label:
        normalized = re.sub(r"\s+(?:@|vs\.?|v\.)\s+", " @ ", label, flags=re.IGNORECASE)
        parts = [_norm(part) for part in normalized.split(" @ ") if _norm(part)]
        if len(parts) == 2:
            teams = parts
    if len(teams) == 2:
        return f"{date_iso}:{_norm(sport)}:{'|'.join(sorted(teams))}"
    game_id = _norm(_first(record, "game_id", "event_id", "gamePk"))
    if game_id:
        return f"{date_iso}:{_norm(sport)}:id:{game_id}"
    return f"{date_iso}:{_norm(sport)}:unknown:{_stable_hash(label or _pick_text(record), 12)}"


def _direction(record: Mapping[str, Any]) -> str:
    explicit = _norm(_first(record, "direction", "selection"))
    if explicit in {"over", "under", "yes", "no"}:
        return explicit
    match = _DIRECTION_RE.search(_pick_text(record))
    return match.group(1).lower() if match else "side"


def _line(record: Mapping[str, Any], direction: str) -> float | None:
    for key in ("line", "market_line", "market_total_line", "spread", "handicap"):
        number = _number(record.get(key))
        if number is not None:
            return number
    if direction != "side":
        direction_match = re.search(
            rf"\b{re.escape(direction)}\b[^0-9+-]*([+-]?\d+(?:[.,]\d+)?)",
            _pick_text(record),
            flags=re.IGNORECASE,
        )
        if direction_match:
            return _number(direction_match.group(1).replace(",", "."))
    else:
        # Several team feeds embed the handicap only in the pick label (for
        # example, "Seattle -1.5"). Parse it only for spread-like markets so
        # a moneyline price such as "+145" cannot become a fake handicap.
        family = _market_family(record)
        pick = _pick_text(record)
        spread_like = any(
            marker in family
            for marker in (
                "spread",
                "handicap",
                "run line",
                "runline",
                "puck line",
                "puckline",
            )
        ) or bool(
            re.search(
                r"\b(?:spread|handicap|run\s*line|puck\s*line)\b",
                pick,
                flags=re.IGNORECASE,
            )
        )
        if spread_like:
            pick_without_parentheticals = re.sub(r"\([^)]*\)", " ", pick)
            side_line = re.search(
                r"(?<![A-Za-z0-9])([+-]\d+(?:[.,]\d+)?)\b",
                pick_without_parentheticals,
            )
            if side_line:
                return _number(side_line.group(1).replace(",", "."))
    return None


def _market_family(record: Mapping[str, Any]) -> str:
    return _norm(
        _first(record, "stat_key", "market_type", "market", "stat_label", "bet_type")
        or "market"
    )


def _player(record: Mapping[str, Any]) -> str:
    return _text(_first(record, "player_name", "player", "athlete_name"))


def _selected_side(record: Mapping[str, Any], direction: str) -> str:
    if direction != "side":
        return direction
    explicit = _text(_first(record, "team", "side", "selection"))
    if explicit:
        return _norm(explicit)
    pick = _pick_text(record)
    pick = re.sub(r"\([^)]*(?:@|\bvs\.?\b)[^)]*\)", "", pick, flags=re.IGNORECASE)
    pick = re.sub(r"\b(?:moneyline|ml|to win|wins?|cover)\b", " ", pick, flags=re.IGNORECASE)
    pick = _LINE_RE.sub(" ", pick)
    return _norm(pick)


def canonical_market_identity(
    record: Mapping[str, Any], *, mode: str, sport: str, date_iso: str
) -> str:
    """Identity includes prop direction and line, so opposing props never merge."""

    direction = _direction(record)
    line = _line(record, direction)
    parts = {
        "date": date_iso,
        "game": canonical_game_key(record, sport, date_iso),
        "mode": mode,
        "player": _norm(_player(record)) if mode == "player" else "",
        "market": _market_family(record),
        "direction": direction,
        "line": round(line, 4) if line is not None else None,
        "side": _selected_side(record, direction),
    }
    return "market:" + _stable_hash(parts, 24)


# ---------------------------------------------------------------------------
# Market verification
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class NoVigProbability:
    probability: float | None
    verified: bool
    method: str
    inputs: dict[str, Any] = field(default_factory=dict)


def _mapping_layers(record: Mapping[str, Any]) -> list[tuple[str, Mapping[str, Any]]]:
    layers: list[tuple[str, Mapping[str, Any]]] = [("pick", record)]
    for name in ("pregame_snapshot", "price", "market_snapshot"):
        nested = record.get(name)
        if isinstance(nested, Mapping):
            layers.append((name, nested))
    return layers


def derive_no_vig_probability(record: Mapping[str, Any]) -> NoVigProbability:
    """Use explicit no-vig data or normalize a complete observed market.

    Regular ``market_probability`` and ``selected_side_implied_probability``
    are deliberately ignored: a single vigged side cannot verify fair value.
    """

    direction = _direction(record)
    layers = _mapping_layers(record)

    for layer_name, layer in layers:
        for key in (
            "market_no_vig_selected_probability",
            "no_vig_selected_probability",
            "market_no_vig_probability",
            "no_vig_probability",
        ):
            probability = normalize_probability(layer.get(key))
            if probability is not None:
                return NoVigProbability(
                    probability, True, f"explicit:{layer_name}.{key}", {"field": key}
                )

        over = normalize_probability(
            _first(layer, "market_no_vig_over_probability", "no_vig_over_probability")
        )
        under = normalize_probability(
            _first(layer, "market_no_vig_under_probability", "no_vig_under_probability")
        )
        if direction == "over" and over is not None:
            return NoVigProbability(over, True, f"explicit:{layer_name}.no_vig_over", {})
        if direction == "under":
            if under is not None:
                return NoVigProbability(under, True, f"explicit:{layer_name}.no_vig_under", {})
            if over is not None:
                return NoVigProbability(1.0 - over, True, f"explicit_complement:{layer_name}.no_vig_over", {})

    # Generic selected/opposite pair.
    for layer_name, layer in layers:
        selected = _american_int(_first(layer, "selected_odds", "market_selected_odds", "odds"))
        opposite = _american_int(
            _first(layer, "opposite_odds", "market_opposite_odds", "other_side_odds")
        )
        if selected is not None and opposite is not None:
            probabilities = [implied_probability(selected), implied_probability(opposite)]
            hold = sum(value for value in probabilities if value is not None)
            if hold > 0 and probabilities[0] is not None:
                probability = probabilities[0] / hold
                return NoVigProbability(
                    probability,
                    True,
                    f"derived_two_sided:{layer_name}.selected_opposite",
                    {"selectedOdds": selected, "oppositeOdds": opposite, "hold": round(hold, 6)},
                )

    # Directional over/under or yes/no pairs.
    pair_specs = (
        ("over", "market_over_odds", "market_under_odds"),
        ("over", "over_odds", "under_odds"),
        ("yes", "market_yes_odds", "market_no_odds"),
        ("yes", "yes_odds", "no_odds"),
    )
    for layer_name, layer in layers:
        for positive_side, positive_key, negative_key in pair_specs:
            positive_odds = _american_int(layer.get(positive_key))
            negative_odds = _american_int(layer.get(negative_key))
            if positive_odds is None or negative_odds is None:
                continue
            positive_implied = implied_probability(positive_odds)
            negative_implied = implied_probability(negative_odds)
            if positive_implied is None or negative_implied is None:
                continue
            hold = positive_implied + negative_implied
            positive_probability = positive_implied / hold
            selected_probability = (
                positive_probability if direction == positive_side else 1.0 - positive_probability
            )
            if direction not in {positive_side, "under" if positive_side == "over" else "no"}:
                continue
            return NoVigProbability(
                selected_probability,
                True,
                f"derived_two_sided:{layer_name}.{positive_key}+{negative_key}",
                {
                    positive_key: positive_odds,
                    negative_key: negative_odds,
                    "hold": round(hold, 6),
                },
            )

    # Home/away markets; include draw when supplied so a 3-way market is not
    # incorrectly treated as two-way.
    for layer_name, layer in layers:
        home_odds = _american_int(_first(layer, "market_home_odds", "home_odds"))
        away_odds = _american_int(_first(layer, "market_away_odds", "away_odds"))
        if home_odds is None or away_odds is None:
            continue
        entries = [("home", home_odds), ("away", away_odds)]
        draw_odds = _american_int(_first(layer, "market_draw_odds", "draw_odds"))
        if draw_odds is not None:
            entries.append(("draw", draw_odds))
        implied = [(side, implied_probability(price)) for side, price in entries]
        if any(value is None for _, value in implied):
            continue
        hold = sum(float(value) for _, value in implied)
        selected_team = _norm(_first(record, "team", "side", "selection"))
        home_team = _norm(record.get("home_team"))
        away_team = _norm(record.get("away_team"))
        selected_slot = "draw" if selected_team == "draw" else (
            "home" if selected_team and selected_team == home_team else (
                "away" if selected_team and selected_team == away_team else ""
            )
        )
        if not selected_slot:
            continue
        selected_implied = next(float(value) for side, value in implied if side == selected_slot)
        return NoVigProbability(
            selected_implied / hold,
            True,
            f"derived_complete_market:{layer_name}.home_away" + ("_draw" if draw_odds else ""),
            {"hold": round(hold, 6), "outcomes": len(entries)},
        )

    return NoVigProbability(None, False, "unverified_single_side", {})


def _price_provenance(record: Mapping[str, Any]) -> tuple[bool, str | None, str, list[str]]:
    odds = _american_int(record.get("odds"))
    blockers: list[str] = []
    if odds is None:
        return False, None, "missing", ["missing_executable_odds"]

    marker_values: list[str] = []
    source: str | None = None
    source_field = ""
    for layer_name, layer in _mapping_layers(record):
        for key in (
            "pricing_type",
            "price_source",
            "odds_source",
            "line_source",
            "market_source",
            "market_total_source",
        ):
            value = _text(layer.get(key))
            if value:
                marker_values.append(value.lower())
                if source is None and key in {"price_source", "odds_source", "market_source", "line_source"}:
                    source = value
                    source_field = f"{layer_name}.{key}"
    marker_text = " ".join(marker_values)
    assumed_odds = _american_int(record.get("assumed_odds"))
    if record.get("market_priced") is False or assumed_odds == odds or any(
        marker in marker_text for marker in _NON_EXECUTABLE_MARKERS
    ):
        blockers.append("assumed_or_non_executable_price")

    explicit_market = record.get("market_priced") is True or any(
        marker in marker_text
        for marker in ("market", "sportsbook", "bookmaker", "posted", "observed", "executable")
    )
    if not explicit_market:
        blockers.append("unverified_price_provenance")
    if source is None and record.get("market_priced") is True:
        source = "explicit market_priced flag"
        source_field = "pick.market_priced"
    return not blockers, source, source_field or "unverified", blockers


def _timing(record: Mapping[str, Any]) -> dict[str, Any]:
    timestamp_value: Any = None
    timestamp_field = ""
    for layer_name, layer in _mapping_layers(record):
        for key in (
            "market_updated_at",
            "odds_updated_at",
            "price_updated_at",
            "snapshot_at",
            "data_as_of",
            "published_at",
        ):
            if layer.get(key) not in (None, ""):
                timestamp_value = layer.get(key)
                timestamp_field = f"{layer_name}.{key}"
                break
        if timestamp_value is not None:
            break
    certification = record.get("certification_timing")
    if timestamp_value is None and isinstance(certification, Mapping):
        timestamp_value = _first(certification, "data_as_of", "published_at")
        timestamp_field = "pick.certification_timing.data_as_of"

    start_value = _first(record, "game_start_time", "start_time", "event_start_time")
    timestamp = _parse_timestamp(timestamp_value)
    start = _parse_timestamp(start_value)
    blockers: list[str] = []
    age_hours: float | None = None
    if timestamp is None:
        blockers.append("missing_or_invalid_price_timestamp")
    if start is None:
        blockers.append("missing_or_invalid_game_start_time")
    if timestamp is not None and start is not None:
        age_hours = (start - timestamp).total_seconds() / 3600.0
        if age_hours < 0:
            blockers.append("price_not_pregame")
        elif age_hours > MAX_PRICE_AGE_HOURS:
            blockers.append("stale_price")
    return {
        "timestamp": _text(timestamp_value) or None,
        "timestampField": timestamp_field or None,
        "startTime": _text(start_value) or None,
        "ageHours": round(age_hours, 3) if age_hours is not None else None,
        "freshPregame": not blockers,
        "maxAgeHours": MAX_PRICE_AGE_HOURS,
        "blockers": blockers,
    }


def _grade_support(record: Mapping[str, Any], source_key: str, mode: str) -> tuple[bool, str]:
    flags = [record.get(key) for key in ("grade_supported", "grading_supported", "gradable")]
    if False in flags:
        return False, "explicit_false"
    if True in flags:
        return True, "explicit_true"
    # Repository auto-grading treats internal team and player caches as
    # supported unless a scraper explicitly marks a market unsupported.
    if mode == "player" or not source_key.startswith(("scores24", "sportytrader", "sportsgambler")):
        return True, "repository_grader_default"
    return False, "missing_external_grade_support"


def _certified_price(record: Mapping[str, Any]) -> bool:
    certification = record.get("certification")
    if isinstance(certification, Mapping):
        status = _norm(certification.get("status"))
        if status == "certified" and certification.get("pregame") is not False:
            return True
    if record.get("certified_pregame") is True:
        return True
    timing = record.get("certification_timing")
    return isinstance(timing, Mapping) and timing.get("trusted") is True


def _price_tier(
    record: Mapping[str, Any],
    *,
    executable: bool,
    no_vig: NoVigProbability,
) -> tuple[str, str]:
    """Classify price provenance without treating one posted side as fair value."""

    if not executable:
        return "D", "assumed_proxy_or_synthetic"
    if no_vig.verified and _certified_price(record):
        return "A", "certified_executable"
    if no_vig.verified:
        return "B", "posted_two_sided"
    return "C", "posted_one_sided"


# ---------------------------------------------------------------------------
# Records, evidence keys, and trailing estimates
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RecordContext:
    payload: Mapping[str, Any]
    bucket: Mapping[str, Any]
    record: Mapping[str, Any]
    source_key: str
    source: str
    mode: str
    fallback_date: str


def _iter_records(payload: Mapping[str, Any] | None, mode: str) -> Iterable[RecordContext]:
    if not isinstance(payload, Mapping):
        return
    fallback_date = _text(_first(payload, "date", "slate_date"))
    models = payload.get("models")
    if isinstance(models, Mapping):
        buckets = models.items()
    elif isinstance(payload.get("picks"), list):
        buckets = [(_text(payload.get("source_key")) or mode, payload)]
    else:
        buckets = []
    for raw_source_key, raw_bucket in buckets:
        if not isinstance(raw_bucket, Mapping) or raw_bucket.get("ok") is False:
            continue
        source_key = _text(raw_source_key)
        for raw_record in raw_bucket.get("picks") or []:
            if not isinstance(raw_record, Mapping):
                continue
            record_mode = "player" if _norm(raw_record.get("scope")) == "player" else mode
            source = _text(raw_record.get("source")) or source_key
            yield RecordContext(
                payload=payload,
                bucket=raw_bucket,
                record=raw_record,
                source_key=source_key,
                source=source,
                mode=record_mode,
                fallback_date=fallback_date,
            )


def _version(context: RecordContext, kind: str) -> str:
    if kind == "model":
        keys = (
            "model_version",
            "ml_model_version",
            "model_epoch",
            "ranking_model_version",
            "engine_version",
        )
    else:
        keys = (
            "policy_version",
            "selection_policy_version",
            "decision_policy_version",
            "ranking_policy_version",
        )
    for mapping in (context.record, context.bucket, context.payload):
        value = _first(mapping, *keys)
        if value not in (None, ""):
            return _text(value)
    return "unversioned"


def _probability_band(probability: float) -> str:
    if probability < 0.45:
        return "lt_0.45"
    if probability < 0.50:
        return "0.45_0.50"
    if probability < 0.55:
        return "0.50_0.55"
    if probability < 0.60:
        return "0.55_0.60"
    return "gte_0.60"


def _evidence_keys(
    context: RecordContext, probability: float, market_family: str, direction: str
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    model_version = _version(context, "model")
    policy_version = _version(context, "policy")
    source_key = (
        context.mode,
        context.source_key,
        model_version,
        policy_version,
        _norm(context.record.get("sport")) or "unknown_sport",
    )
    segment_key = source_key + (
        market_family,
        direction,
        _probability_band(probability),
    )
    return source_key, segment_key


def _key_text(key: Sequence[str]) -> str:
    return "|".join(str(value).replace("|", "/") for value in key)


@dataclass(frozen=True)
class EvidenceRow:
    row_id: str
    date: str
    source_key: tuple[str, ...]
    segment_key: tuple[str, ...]
    result: str
    outcome: float
    market_probability: float
    residual: float
    profit_units: float


@dataclass
class Aggregate:
    rows: list[EvidenceRow] = field(default_factory=list)

    @property
    def samples(self) -> int:
        return len(self.rows)

    @property
    def dates(self) -> set[str]:
        return {row.date for row in self.rows}

    @property
    def wins(self) -> int:
        return sum(row.result == "win" for row in self.rows)

    @property
    def losses(self) -> int:
        return sum(row.result == "loss" for row in self.rows)

    @property
    def net_units(self) -> float:
        return sum(row.profit_units for row in self.rows)

    @property
    def residual_sum(self) -> float:
        return sum(row.residual for row in self.rows)

    @property
    def chronological_half_net_units(self) -> tuple[float, float]:
        ordered = sorted(self.rows, key=lambda row: (row.date, row.row_id))
        midpoint = len(ordered) // 2
        first = ordered[:midpoint]
        second = ordered[midpoint:]
        return (
            sum(row.profit_units for row in first),
            sum(row.profit_units for row in second),
        )


class EvidenceBook:
    """Verified, settled, strictly-prior market residuals."""

    def __init__(self, rows: Iterable[EvidenceRow] = ()) -> None:
        unique: dict[str, EvidenceRow] = {}
        for row in rows:
            unique.setdefault(row.row_id, row)
        self.rows = list(unique.values())
        self.by_source: dict[tuple[str, ...], Aggregate] = defaultdict(Aggregate)
        self.by_segment: dict[tuple[str, ...], Aggregate] = defaultdict(Aggregate)
        for row in self.rows:
            self.by_source[row.source_key].rows.append(row)
            self.by_segment[row.segment_key].rows.append(row)

    @classmethod
    def build(
        cls,
        date_iso: str,
        team_history: Iterable[Mapping[str, Any]],
        prop_history: Iterable[Mapping[str, Any]],
    ) -> "EvidenceBook":
        rows: list[EvidenceRow] = []
        for mode, payloads in (("team", team_history), ("player", prop_history)):
            for payload in payloads:
                for context in _iter_records(payload, mode):
                    record = context.record
                    record_date = _record_date(record, context.fallback_date)
                    if not record_date or record_date >= date_iso:
                        continue
                    if _text(record.get("decision")).upper() not in VISIBLE_DECISIONS:
                        continue
                    result = _result(record.get("result"))
                    if result not in {"win", "loss"}:
                        continue
                    odds = _american_int(record.get("odds"))
                    decimal = american_to_decimal(odds)
                    executable, _, _, price_blockers = _price_provenance(record)
                    timing = _timing(record)
                    grade_supported, _ = _grade_support(record, context.source_key, context.mode)
                    no_vig = derive_no_vig_probability(record)
                    if (
                        odds is None
                        or decimal is None
                        or not executable
                        or price_blockers
                        or not timing["freshPregame"]
                        or not grade_supported
                        or not no_vig.verified
                        or no_vig.probability is None
                    ):
                        continue
                    market_family = _market_family(record)
                    direction = _direction(record)
                    source_key, segment_key = _evidence_keys(
                        context, no_vig.probability, market_family, direction
                    )
                    outcome = 1.0 if result == "win" else 0.0
                    profit = decimal - 1.0 if result == "win" else -1.0
                    row_identity = {
                        "date": record_date,
                        "source": source_key,
                        "market": canonical_market_identity(
                            record,
                            mode=context.mode,
                            sport=_text(record.get("sport")),
                            date_iso=record_date,
                        ),
                    }
                    rows.append(
                        EvidenceRow(
                            row_id=_stable_hash(row_identity, 32),
                            date=record_date,
                            source_key=source_key,
                            segment_key=segment_key,
                            result=result,
                            outcome=outcome,
                            market_probability=no_vig.probability,
                            residual=outcome - no_vig.probability,
                            profit_units=profit,
                        )
                    )
        return cls(rows)

    def estimate(
        self,
        source_key: tuple[str, ...],
        segment_key: tuple[str, ...],
        market_probability: float,
        decimal_odds: float,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        source = self.by_source[source_key]
        segment = self.by_segment[segment_key]
        source_alpha = source.residual_sum / (source.samples + SOURCE_PRIOR_ROWS)
        alpha = (
            segment.residual_sum + SEGMENT_PRIOR_ROWS * source_alpha
        ) / (segment.samples + SEGMENT_PRIOR_ROWS)

        # Residual variance includes a conservative floor, so even a perfect
        # finite record retains uncertainty.
        if segment.samples:
            empirical_variance = sum(
                (row.residual - alpha) ** 2 for row in segment.rows
            ) / segment.samples
        else:
            empirical_variance = 0.25
        residual_variance = max(MIN_RESIDUAL_VARIANCE, empirical_variance)
        alpha_std_error = math.sqrt(
            residual_variance / (segment.samples + SEGMENT_PRIOR_ROWS)
        )

        probability = min(0.99, max(0.01, market_probability + alpha))
        lower_probability = min(
            0.99,
            max(0.01, market_probability + alpha - LOWER_BOUND_Z * alpha_std_error),
        )
        break_even = 1.0 / decimal_odds
        z_score = (market_probability + alpha - break_even) / alpha_std_error
        probability_positive_ev = 0.5 * (1.0 + math.erf(z_score / math.sqrt(2.0)))
        expected_value = probability * decimal_odds - 1.0
        conservative_ev = lower_probability * decimal_odds - 1.0

        estimate = {
            "marketProbability": round(market_probability, 6),
            "alpha": round(alpha, 6),
            "sourceAlpha": round(source_alpha, 6),
            "alphaStdError": round(alpha_std_error, 6),
            "probability": round(probability, 6),
            "lowerProbability": round(lower_probability, 6),
            "breakEvenProbability": round(break_even, 6),
            "expectedValue": round(expected_value, 6),
            "conservativeExpectedValue": round(conservative_ev, 6),
            "probabilityPositiveEv": round(probability_positive_ev, 6),
            "method": "market_no_vig_plus_hierarchically_shrunk_prior_residual",
        }
        flat_roi = segment.net_units / segment.samples if segment.samples else None
        first_half_net, second_half_net = segment.chronological_half_net_units
        evidence = {
            "sourceEvidenceKey": _key_text(source_key),
            "segmentEvidenceKey": _key_text(segment_key),
            "modelVersion": source_key[2],
            "policyVersion": source_key[3],
            "sourceSamples": source.samples,
            "segmentSamples": segment.samples,
            "sourceDistinctDates": len(source.dates),
            "segmentDistinctDates": len(segment.dates),
            "distinctDates": len(segment.dates),
            "wins": segment.wins,
            "losses": segment.losses,
            "pushes": 0,
            "flatNetUnits": round(segment.net_units, 4),
            "flatRoi": round(flat_roi, 6) if flat_roi is not None else None,
            "firstHalfFlatNetUnits": round(first_half_net, 4),
            "secondHalfFlatNetUnits": round(second_half_net, 4),
            "chronologicalHalvesNonnegative": (
                first_half_net >= 0.0 and second_half_net >= 0.0
            ),
            "priorOnly": True,
        }
        return estimate, evidence


# ---------------------------------------------------------------------------
# Candidate construction and selection
# ---------------------------------------------------------------------------


@dataclass
class RawCandidate:
    context: RecordContext
    date: str
    sport: str
    pick: str
    game: str
    canonical_game: str
    market_family: str
    market_identity: str
    direction: str
    line: float | None
    player: str
    odds: int | None
    decimal_odds: float | None
    price: dict[str, Any]
    price_tier: str
    price_tier_label: str
    no_vig: NoVigProbability
    grade_supported: bool
    grade_support_source: str
    base_blockers: list[str]


def _raw_candidate(context: RecordContext, date_iso: str) -> RawCandidate:
    record = context.record
    sport = _text(record.get("sport"))
    odds = _american_int(record.get("odds"))
    decimal = american_to_decimal(odds)
    executable, price_source, price_source_field, price_blockers = _price_provenance(record)
    timing = _timing(record)
    no_vig = derive_no_vig_probability(record)
    price_tier, price_tier_label = _price_tier(
        record, executable=executable, no_vig=no_vig
    )
    grade_supported, grade_support_source = _grade_support(
        record, context.source_key, context.mode
    )
    blockers = list(price_blockers) + list(timing["blockers"])
    if not no_vig.verified:
        blockers.append("unverified_no_vig_probability")
    if not grade_supported:
        blockers.append("unsupported_grading")
    market_family = _market_family(record)
    direction = _direction(record)
    if price_tier == "A":
        public_price_quality = "verified_no_vig"
    elif price_tier == "B":
        public_price_quality = "verified_two_sided"
    elif price_tier == "C":
        public_price_quality = "one_sided"
    elif odds is None:
        public_price_quality = "missing"
    elif "stale_price" in timing["blockers"]:
        public_price_quality = "stale"
    else:
        public_price_quality = "assumed"
    price = {
        "observedExecutable": executable,
        "oddsAmerican": odds,
        "decimalOdds": round(decimal, 6) if decimal is not None else None,
        "source": price_source,
        "sourceField": price_source_field,
        "timestamp": timing["timestamp"],
        "timestampField": timing["timestampField"],
        "startTime": timing["startTime"],
        "ageHours": timing["ageHours"],
        "freshPregame": timing["freshPregame"],
        "maxAgeHours": timing["maxAgeHours"],
        "noVigVerified": no_vig.verified,
        "noVigMethod": no_vig.method,
        "noVigInputs": no_vig.inputs,
        "tier": price_tier,
        "tierLabel": price_tier_label,
        "eligibleForAlphaEstimate": price_tier in {"A", "B"},
        # Stable reader-facing aliases used by the static Profit Desk.
        "quality": public_price_quality,
        "updatedAt": timing["timestamp"],
        "fresh": timing["freshPregame"],
        "twoSided": no_vig.verified,
        "noVigProbability": (
            round(no_vig.probability, 6)
            if no_vig.probability is not None
            else None
        ),
        "breakEvenProbability": (
            round(1.0 / decimal, 6) if decimal is not None else None
        ),
    }
    return RawCandidate(
        context=context,
        date=date_iso,
        sport=sport,
        pick=_pick_text(record),
        game=_game_label(record),
        canonical_game=canonical_game_key(record, sport, date_iso),
        market_family=market_family,
        market_identity=canonical_market_identity(
            record, mode=context.mode, sport=sport, date_iso=date_iso
        ),
        direction=direction,
        line=_line(record, direction),
        player=_player(record),
        odds=odds,
        decimal_odds=decimal,
        price=price,
        price_tier=price_tier,
        price_tier_label=price_tier_label,
        no_vig=no_vig,
        grade_supported=grade_supported,
        grade_support_source=grade_support_source,
        base_blockers=list(dict.fromkeys(blockers)),
    )


def _dedupe_raw_candidates(candidates: Iterable[RawCandidate]) -> list[tuple[RawCandidate, list[RawCandidate]]]:
    grouped: dict[str, list[RawCandidate]] = defaultdict(list)
    for candidate in candidates:
        grouped[candidate.market_identity].append(candidate)
    winners: list[tuple[RawCandidate, list[RawCandidate]]] = []
    for identity, group in grouped.items():
        # A genuinely executable price beats a proxy.  Among equally verified
        # copies, the highest decimal payout is the better executable price.
        ordered = sorted(
            group,
            key=lambda candidate: (
                0 if candidate.price_tier in {"A", "B"} else (
                    1 if candidate.price_tier == "C" else 2
                ),
                -(candidate.decimal_odds or 0.0),
                candidate.context.source_key,
                candidate.pick,
            ),
        )
        winners.append((ordered[0], ordered))
    return sorted(winners, key=lambda pair: (pair[0].context.mode, pair[0].market_identity))


_EVIDENCE_BLOCKERS = {
    "insufficient_source_samples",
    "insufficient_segment_samples",
    "insufficient_distinct_prior_dates",
    "negative_chronological_evidence_half",
    "missing_model_version",
    "missing_policy_version",
}


def _candidate_payload(
    raw: RawCandidate,
    duplicates: Sequence[RawCandidate],
    evidence_book: EvidenceBook,
) -> dict[str, Any]:
    context = raw.context
    record = context.record
    model_version = _version(context, "model")
    policy_version = _version(context, "policy")
    blockers = list(raw.base_blockers)
    if model_version == "unversioned":
        blockers.append("missing_model_version")
    if policy_version == "unversioned":
        blockers.append("missing_policy_version")
    estimate: dict[str, Any] | None = None
    evidence: dict[str, Any]

    if (
        raw.price_tier in {"A", "B"}
        and raw.no_vig.probability is not None
        and raw.decimal_odds is not None
    ):
        source_key, segment_key = _evidence_keys(
            context, raw.no_vig.probability, raw.market_family, raw.direction
        )
        estimate, evidence = evidence_book.estimate(
            source_key, segment_key, raw.no_vig.probability, raw.decimal_odds
        )
        if evidence["sourceSamples"] < MIN_SOURCE_SAMPLES:
            blockers.append("insufficient_source_samples")
        if evidence["segmentSamples"] < MIN_SEGMENT_SAMPLES:
            blockers.append("insufficient_segment_samples")
        if evidence["distinctDates"] < MIN_DISTINCT_DATES:
            blockers.append("insufficient_distinct_prior_dates")
        if not evidence["chronologicalHalvesNonnegative"]:
            blockers.append("negative_chronological_evidence_half")
        if estimate["probabilityPositiveEv"] < MIN_PROBABILITY_POSITIVE_EV:
            blockers.append("probability_positive_ev_below_0.80")
        if (
            estimate["lowerProbability"]
            < estimate["breakEvenProbability"] + MIN_CONSERVATIVE_PROBABILITY_MARGIN
        ):
            blockers.append("conservative_probability_margin_below_0.02")
        if estimate["conservativeExpectedValue"] <= 0.0:
            blockers.append("non_positive_conservative_ev")
    else:
        source_key = (
            context.mode,
            context.source_key,
            model_version,
            policy_version,
            _norm(record.get("sport")) or "unknown_sport",
        )
        evidence = {
            "sourceEvidenceKey": _key_text(source_key),
            "segmentEvidenceKey": None,
            "modelVersion": model_version,
            "policyVersion": policy_version,
            "sourceSamples": evidence_book.by_source[source_key].samples,
            "segmentSamples": 0,
            "sourceDistinctDates": len(evidence_book.by_source[source_key].dates),
            "segmentDistinctDates": 0,
            "distinctDates": 0,
            "wins": 0,
            "losses": 0,
            "pushes": 0,
            "flatNetUnits": 0.0,
            "flatRoi": None,
            "firstHalfFlatNetUnits": 0.0,
            "secondHalfFlatNetUnits": 0.0,
            "chronologicalHalvesNonnegative": False,
            "priorOnly": True,
        }

    blockers = list(dict.fromkeys(blockers))
    if not blockers:
        tier = "shadow"
    elif set(blockers).issubset(_EVIDENCE_BLOCKERS):
        tier = "watch"
    else:
        tier = "avoid"
    shadow_qualified = tier == "shadow"
    candidate_id = "profit-" + _stable_hash(
        {
            "date": raw.date,
            "market": raw.market_identity,
            "source": context.source_key,
            "odds": raw.odds,
            "modelVersion": model_version,
            "policyVersion": policy_version,
        },
        24,
    )
    raw_probability = normalize_probability(
        _first(
            record,
            "raw_probability",
            "ml_raw_probability",
            "model_probability",
            "probability",
        )
    )
    return {
        "id": candidate_id,
        "date": raw.date,
        "mode": context.mode,
        "sport": raw.sport,
        "sourceKey": context.source_key,
        "source": context.source,
        "modelVersion": model_version,
        "policyVersion": policy_version,
        "pick": raw.pick,
        "decision": _text(record.get("decision")).upper(),
        "result": _result(record.get("result")),
        "game": raw.game,
        "canonicalGame": raw.canonical_game,
        "market": _text(_first(record, "market_type", "market", "stat_label")) or raw.market_family,
        "marketFamily": raw.market_family,
        "marketIdentity": raw.market_identity,
        "player": raw.player or None,
        "direction": raw.direction,
        "line": raw.line,
        "oddsAmerican": raw.odds,
        "decimalOdds": round(raw.decimal_odds, 6) if raw.decimal_odds is not None else None,
        "rawModelProbabilityIgnored": round(raw_probability, 6) if raw_probability is not None else None,
        "gradeSupported": raw.grade_supported,
        "gradeSupportSource": raw.grade_support_source,
        "price": raw.price,
        "estimate": estimate,
        "evidence": {**evidence, "cutoffExclusive": raw.date},
        "tier": tier,
        "blockers": blockers,
        "shadowQualified": shadow_qualified,
        "liveQualified": False,
        "stakeUnits": 0.0,
        "duplicateCount": len(duplicates),
        "duplicateSources": sorted(
            {candidate.context.source for candidate in duplicates}
        ),
        "consensusSources": sorted(
            {candidate.context.source for candidate in duplicates}
        ) if len({candidate.context.source for candidate in duplicates}) > 1 else [],
        "dedupeRule": "exact_market_identity_best_executable_price",
    }


def select_portfolio(candidates: Sequence[Mapping[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Select shadow research cards; the live portfolio remains empty."""

    qualified = [candidate for candidate in candidates if candidate.get("tier") == "shadow"]
    ordered = sorted(
        qualified,
        key=lambda candidate: (
            -float((candidate.get("estimate") or {}).get("conservativeExpectedValue") or -999),
            -float((candidate.get("estimate") or {}).get("probabilityPositiveEv") or 0),
            -int((candidate.get("evidence") or {}).get("segmentSamples") or 0),
            _text(candidate.get("id")),
        ),
    )
    selected: list[dict[str, Any]] = []
    mode_counts: dict[str, int] = defaultdict(int)
    used_games: set[str] = set()
    for candidate in ordered:
        mode = _text(candidate.get("mode"))
        game = _text(candidate.get("canonicalGame"))
        if mode_counts[mode] >= MAX_PER_MODE or game in used_games:
            continue
        selected.append({
            **dict(candidate),
            "portfolioSelected": True,
            "rank": len(selected) + 1,
        })
        mode_counts[mode] += 1
        used_games.add(game)
    return {
        "team": [candidate for candidate in selected if candidate.get("mode") == "team"],
        "player": [candidate for candidate in selected if candidate.get("mode") == "player"],
        "all": selected,
        "shadow": selected,
        "live": [],
    }


def _flat_record(candidates: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    wins = losses = pushes = pending = 0
    net = 0.0
    for candidate in candidates:
        result = _result(candidate.get("result"))
        decimal = _number(candidate.get("decimalOdds"))
        if result == "win" and decimal is not None:
            wins += 1
            net += decimal - 1.0
        elif result == "loss":
            losses += 1
            net -= 1.0
        elif result == "push":
            pushes += 1
        else:
            pending += 1
    settled = wins + losses
    return {
        "wins": wins,
        "losses": losses,
        "pushes": pushes,
        "pending": pending,
        "settled": settled,
        "netUnits": round(net, 4),
        "roi": round(net / settled, 6) if settled else None,
    }


def _deterministic_generated_at(
    date_iso: str,
    team_payload: Mapping[str, Any] | None,
    prop_payload: Mapping[str, Any] | None,
) -> str:
    timestamps: list[tuple[datetime, str]] = []
    for payload in (team_payload, prop_payload):
        if not isinstance(payload, Mapping):
            continue
        raw = _text(_first(payload, "updatedAt", "generatedAt"))
        parsed = _parse_timestamp(raw)
        if parsed is not None:
            timestamps.append((parsed, parsed.isoformat().replace("+00:00", "Z")))
    if timestamps:
        return max(timestamps, key=lambda item: item[0])[1]
    return f"{date_iso}T00:00:00Z"


def build_profit_desk_payload(
    date_iso: str,
    team_payload: Mapping[str, Any] | None,
    prop_payload: Mapping[str, Any] | None,
    *,
    team_history: Iterable[Mapping[str, Any]] | None = None,
    prop_history: Iterable[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build one deterministic Profit Desk slate payload.

    Supplied history is still filtered by each record's own date, preventing a
    fixture or caller from accidentally introducing same-date/future leakage.
    """

    if team_history is None:
        team_history = _payloads_before(MODEL_CACHE_DIR, date_iso)
    if prop_history is None:
        prop_history = _payloads_before(PLAYER_PROPS_CACHE_DIR, date_iso)
    evidence_book = EvidenceBook.build(date_iso, team_history, prop_history)

    raw_candidates: list[RawCandidate] = []
    input_count = 0
    for mode, payload in (("team", team_payload), ("player", prop_payload)):
        for context in _iter_records(payload, mode):
            record = context.record
            if _record_date(record, context.fallback_date) != date_iso:
                continue
            if _text(record.get("decision")).upper() not in VISIBLE_DECISIONS:
                continue
            input_count += 1
            raw_candidates.append(_raw_candidate(context, date_iso))

    candidates = [
        _candidate_payload(winner, duplicates, evidence_book)
        for winner, duplicates in _dedupe_raw_candidates(raw_candidates)
    ]
    candidates.sort(
        key=lambda candidate: (
            {"shadow": 0, "watch": 1, "avoid": 2}.get(_text(candidate.get("tier")), 3),
            -float((candidate.get("estimate") or {}).get("conservativeExpectedValue") or -999),
            _text(candidate.get("mode")),
            _text(candidate.get("id")),
        )
    )
    portfolio = select_portfolio(candidates)
    shadow_qualified = sum(candidate["shadowQualified"] for candidate in candidates)
    watchlist = sum(candidate["tier"] == "watch" for candidate in candidates)
    observed = sum(candidate["price"]["observedExecutable"] for candidate in candidates)

    mode_summary: dict[str, Any] = {}
    for mode in ("team", "player"):
        rows = [candidate for candidate in candidates if candidate["mode"] == mode]
        mode_evidence_rows = sum(
            1 for row in evidence_book.rows if row.source_key[0] == mode
        )
        mode_observed = sum(candidate["price"]["observedExecutable"] for candidate in rows)
        mode_summary[mode] = {
            "candidates": len(rows),
            "candidateCount": len(rows),
            "candidatesEvaluated": len(rows),
            "observedPriceCandidates": mode_observed,
            "shadowQualified": sum(candidate["shadowQualified"] for candidate in rows),
            "researchQualified": sum(candidate["shadowQualified"] for candidate in rows),
            "watchlist": sum(candidate["tier"] == "watch" for candidate in rows),
            "avoid": sum(candidate["tier"] == "avoid" for candidate in rows),
            "selected": len(portfolio[mode]),
            "portfolioCandidates": len(portfolio[mode]),
            "liveQualified": 0,
            "evidenceRows": mode_evidence_rows,
        }

    live_record = _flat_record([])
    shadow_record = _flat_record(portfolio["all"])
    policy = {
        "version": ENGINE_VERSION,
        "status": "SHADOW_ONLY",
        "statusLabel": "shadow",
        "mode": "shadow",
        "firstLiveDate": None,
        "liveStaking": False,
        "gates": {
            "observedExecutableOdds": True,
            "freshPregameTimestamp": True,
            "maximumPriceAgeHours": MAX_PRICE_AGE_HOURS,
            "verifiedNoVigProbability": True,
            "gradeSupported": True,
            "minimumSourceSamples": MIN_SOURCE_SAMPLES,
            "minimumSegmentSamples": MIN_SEGMENT_SAMPLES,
            "minimumDistinctPriorDates": MIN_DISTINCT_DATES,
            "minimumProbabilityPositiveEv": MIN_PROBABILITY_POSITIVE_EV,
            "minimumConservativeProbabilityMargin": MIN_CONSERVATIVE_PROBABILITY_MARGIN,
            "chronologicalEvidenceHalvesMustBeNonnegative": True,
            "minimumPriceTierForAlphaEstimate": "B",
            "versionedModelAndSelectionPolicy": True,
            "maximumPerMode": MAX_PER_MODE,
            "maximumPerCanonicalGame": 1,
        },
        "notes": [
            "All stake sizes remain 0 units while this policy is in shadow.",
            "Raw model probability and consensus are display context only and never create edge.",
            "Evidence uses verified settled rows dated strictly before the target slate.",
        ],
    }
    summary = {
        "inputPicks": input_count,
        "candidateCount": len(candidates),
        "candidatesEvaluated": len(candidates),
        "deduplicatedPicks": input_count - len(candidates),
        "observedPriceCandidates": observed,
        "shadowQualified": shadow_qualified,
        "researchQualified": shadow_qualified,
        "watchlist": watchlist,
        "avoid": sum(candidate["tier"] == "avoid" for candidate in candidates),
        "selected": len(portfolio["all"]),
        "portfolioCandidates": len(portfolio["all"]),
        "shadowPortfolioCandidates": len(portfolio["shadow"]),
        "livePortfolioCandidates": 0,
        "liveQualified": 0,
        "evidenceRows": len(evidence_book.rows),
        "modes": mode_summary,
        "shadowRecord": shadow_record,
        "liveRecord": live_record,
    }
    notices = [
        "Profit Desk is shadow-only: no candidate carries a live stake.",
        "Market no-vig probability is the baseline; historical residual alpha is shrunk and uncertainty-adjusted.",
        "A 3-0 streak is still insufficient: qualification requires 100 source rows, 40 segment rows, and 20 prior dates.",
        "Opposing Over/Under selections remain separate markets and receive no consensus bonus.",
    ]
    if not shadow_qualified:
        notices.append("No candidates cleared every research gate on this slate; zero action is a valid result.")

    return {
        "schemaVersion": 1,
        "date": date_iso,
        "generatedAt": _deterministic_generated_at(date_iso, team_payload, prop_payload),
        "engineVersion": ENGINE_VERSION,
        "phase": "shadow",
        "cutoverDate": ENGINE_CUTOVER_DATE,
        "policy": policy,
        "summary": summary,
        "portfolio": portfolio,
        "candidates": candidates,
        "notices": notices,
    }


# ---------------------------------------------------------------------------
# Rebuild / CLI
# ---------------------------------------------------------------------------


def _payloads_before(directory: Path, date_iso: str) -> list[dict[str, Any]]:
    payloads: list[dict[str, Any]] = []
    for path in sorted(directory.glob("20??-??-??.json")):
        if path.stem >= date_iso:
            continue
        payload = _read_json(path)
        if payload is not None:
            payloads.append(payload)
    return payloads


def _target_dates(
    *,
    date_iso: str | None,
    all_dates: bool,
    model_cache_dir: Path,
    player_cache_dir: Path,
) -> list[str]:
    if date_iso:
        return [date_iso]
    dates = {
        path.stem
        for directory in (model_cache_dir, player_cache_dir)
        for path in directory.glob("20??-??-??.json")
        if _DATE_FILE_RE.match(path.stem)
    }
    if all_dates:
        return sorted(dates)
    latest_dates: list[str] = []
    for directory in (model_cache_dir, player_cache_dir):
        latest = _read_json(directory / "latest.json") or {}
        value = _text(_first(latest, "date", "slate_date"))
        if value:
            latest_dates.append(value)
    if latest_dates:
        return [max(latest_dates)]
    return [max(dates)] if dates else []


def rebuild_profit_desk(
    *,
    date_iso: str | None = None,
    all_dates: bool = False,
    model_cache_dir: Path | str | None = None,
    player_cache_dir: Path | str | None = None,
    output_dir: Path | str | None = None,
) -> int:
    """Write dated, latest, and index files; return the changed-file count."""

    model_dir = Path(model_cache_dir) if model_cache_dir is not None else MODEL_CACHE_DIR
    player_dir = Path(player_cache_dir) if player_cache_dir is not None else PLAYER_PROPS_CACHE_DIR
    destination = Path(output_dir) if output_dir is not None else PROFIT_DESK_DIR
    targets = _target_dates(
        date_iso=date_iso,
        all_dates=all_dates,
        model_cache_dir=model_dir,
        player_cache_dir=player_dir,
    )
    changed = 0
    for target in targets:
        if target < ENGINE_CUTOVER_DATE:
            print(f"[profit-desk] skipped {target}: predates cutover {ENGINE_CUTOVER_DATE}")
            continue
        team_payload = _read_json(model_dir / f"{target}.json")
        prop_payload = _read_json(player_dir / f"{target}.json")
        if team_payload is None and prop_payload is None:
            print(f"[profit-desk] skipped {target}: no committed source cache")
            continue
        payload = build_profit_desk_payload(
            target,
            team_payload,
            prop_payload,
            team_history=_payloads_before(model_dir, target),
            prop_history=_payloads_before(player_dir, target),
        )
        if _write_json_if_changed(destination / f"{target}.json", payload):
            changed += 1
        print(
            f"[profit-desk] {target}: {payload['summary']['candidateCount']} candidate(s), "
            f"{payload['summary']['shadowQualified']} shadow-qualified"
        )

    files = sorted(path.name for path in destination.glob("20??-??-??.json"))
    manifest = {
        "engineVersion": ENGINE_VERSION,
        "cutoverDate": ENGINE_CUTOVER_DATE,
        "files": files,
    }
    if _write_json_if_changed(destination / "index.json", manifest):
        changed += 1
    if files:
        latest_payload = _read_json(destination / files[-1])
        if latest_payload is not None and _write_json_if_changed(
            destination / "latest.json", latest_payload
        ):
            changed += 1
    return changed


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", help="Target date in YYYY-MM-DD format.")
    parser.add_argument(
        "--all", action="store_true", help="Build all cache dates at or after the cutover."
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    changed = rebuild_profit_desk(date_iso=args.date, all_dates=args.all)
    print(f"[profit-desk] complete: {changed} file update(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
