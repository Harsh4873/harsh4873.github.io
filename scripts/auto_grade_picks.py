#!/usr/bin/env python3
"""Grade committed static pick caches against ESPN scoreboards."""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator


REPO_ROOT = Path(__file__).resolve().parents[1]
MODEL_CACHE_DIR = REPO_ROOT / "data" / "model_cache"
CANNON_JSON_PATH = REPO_ROOT / "data" / "cannon_mlb_daily.json"
sys.path.insert(0, str(REPO_ROOT))

import pickgrader_server  # noqa: E402


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True, default=str) + "\n", encoding="utf-8")


def _iter_pick_lists(payload: dict[str, Any]) -> Iterator[tuple[str, list[dict[str, Any]]]]:
    direct = payload.get("picks")
    if isinstance(direct, list):
        yield "picks", [pick for pick in direct if isinstance(pick, dict)]

    models = payload.get("models")
    if not isinstance(models, dict):
        return
    for model_key, bucket in models.items():
        if not isinstance(bucket, dict) or not isinstance(bucket.get("picks"), list):
            continue
        yield str(model_key), [pick for pick in bucket["picks"] if isinstance(pick, dict)]


def _grade_id(scope: str, index: int, pick: dict[str, Any]) -> str:
    existing = str(pick.get("id") or "").strip()
    if existing:
        return existing
    raw = json.dumps(
        [
            scope,
            index,
            pick.get("source"),
            pick.get("sport"),
            pick.get("date"),
            pick.get("pick"),
            pick.get("matchup") or pick.get("game"),
        ],
        sort_keys=True,
        default=str,
    )
    return f"grade-{hashlib.sha1(raw.encode('utf-8')).hexdigest()[:16]}"


def grade_payload(payload: dict[str, Any]) -> int:
    fallback_date = str(payload.get("date") or payload.get("slate_date") or payload.get("as_of") or "").strip()
    pending: list[dict[str, Any]] = []
    refs: dict[str, dict[str, Any]] = {}

    for scope, picks in _iter_pick_lists(payload):
        for index, pick in enumerate(picks):
            if str(pick.get("result") or "pending").lower() not in {"", "pending"}:
                continue
            grade_id = _grade_id(scope, index, pick)
            candidate = dict(pick)
            candidate["id"] = grade_id
            candidate["date"] = str(candidate.get("date") or fallback_date)
            candidate["result"] = "pending"
            pending.append(candidate)
            refs[grade_id] = pick

    if not pending:
        return 0

    response = pickgrader_server.auto_grade(pending, {}, datetime.now().year)
    grades = response.get("graded") if isinstance(response, dict) else {}
    start_times = response.get("startTimes") if isinstance(response, dict) else {}
    grades = grades if isinstance(grades, dict) else {}
    start_times = start_times if isinstance(start_times, dict) else {}

    changed = 0
    for grade_id, pick in refs.items():
        result = str(grades.get(grade_id) or "pending").lower()
        if result in {"win", "loss", "push"} and pick.get("result") != result:
            pick["result"] = result
            changed += 1
        start_time = str(start_times.get(grade_id) or "").strip()
        if start_time and pick.get("start_time") != start_time:
            pick["start_time"] = start_time
            pick["game_start_time"] = start_time
            changed += 1
    return changed


def grade_file(path: Path) -> int:
    payload = _read_json(path)
    if not payload:
        print(f"[auto-grade] skipped unreadable {path.relative_to(REPO_ROOT)}")
        return 0
    changed = grade_payload(payload)
    if changed:
        _write_json(path, payload)
    print(f"[auto-grade] {path.relative_to(REPO_ROOT)}: {changed} update(s)")
    return changed


def main() -> int:
    total = 0
    dated_files = sorted(MODEL_CACHE_DIR.glob("20??-??-??.json"))
    for path in dated_files:
        total += grade_file(path)

    latest = _read_json(MODEL_CACHE_DIR / "latest.json")
    latest_date = str(latest.get("date") or "") if latest else ""
    latest_source = MODEL_CACHE_DIR / f"{latest_date}.json"
    if latest_date and latest_source.exists():
        shutil.copyfile(latest_source, MODEL_CACHE_DIR / "latest.json")

    total += grade_file(CANNON_JSON_PATH)
    print(f"[auto-grade] complete: {total} update(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
