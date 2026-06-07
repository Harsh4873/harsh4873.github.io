from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MAIN_TS = ROOT / "src" / "main.ts"
DEPLOY_WORKFLOW = ROOT / ".github" / "workflows" / "deploy-pages.yml"


def _source() -> str:
    return MAIN_TS.read_text(encoding="utf-8")


def _body_after_match(source: str, match: re.Match[str], name: str) -> str:
    index = match.end()
    depth = 1
    while index < len(source) and depth:
        char = source[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
        index += 1
    if depth:
        raise AssertionError(f"Unclosed function {name}")
    return source[match.end():index - 1]


def _function_body(source: str, name: str) -> str:
    match = re.search(rf"function\s+{re.escape(name)}\s*\([^)]*\)\s*\{{", source)
    if not match:
        raise AssertionError(f"Missing function {name}")
    return _body_after_match(source, match, name)


def _assigned_function_body(source: str, name: str) -> str:
    match = re.search(
        rf"{re.escape(name)}\s*=\s*(?:async\s+)?function\s*\([^)]*\)\s*\{{",
        source,
    )
    if not match:
        raise AssertionError(f"Missing assigned function {name}")
    return _body_after_match(source, match, name)


def run_checks() -> None:
    source = _source()

    required_snippets = [
        "const LEDGER_DIRTY_KEY",
        "function isLocalLedgerDirty()",
        "function markLedgerLocalSynced(",
        "window.isLocalLedgerDirty = isLocalLedgerDirty",
        "window.pullLatestUserLedgerState = pullLatestUserLedgerState",
        "window.addEventListener('focus'",
        "document.addEventListener('visibilitychange'",
        "markDirty: shouldKeepLocal",
        "markDirty: options.markDirty === true",
        "migrateLocalResultKeysToStable({ schedule: false, dirty: shouldTouchSavedAt })",
        "migrateLocalResultKeysToStable({ schedule: false, dirty: false })",
        "if (!force && !isLocalLedgerDirty()) return;",
        "if (!isLocalLedgerDirty()) return;",
    ]
    for snippet in required_snippets:
        if snippet not in source:
            raise AssertionError(f"Missing record sync guardrail snippet: {snippet}")

    save_record_body = _assigned_function_body(source, "window._saveUserRecordSummary")
    if "mergeRecordSummariesMaxPerCategory" in save_record_body:
        raise AssertionError("_saveUserRecordSummary must save the requested derived record, not ratchet with max().")

    sync_body = _function_body(source, "syncRecordWithLedger")
    if "mergeRecordSummariesMaxPerCategory" in sync_body:
        raise AssertionError("syncRecordWithLedger must derive from ledger truth, not max-ratchet the record.")
    if "buildRecordSummaryFromResultsMap(resultsMap, allLedgerPicks)" not in sync_body:
        raise AssertionError("syncRecordWithLedger must count deduped result keys against ledger picks.")

    preserve_body = _function_body(source, "shouldPreserveLocalLedgerState")
    if "isLocalLedgerDirty()" not in preserve_body:
        raise AssertionError("Local cache can only beat remote when it is explicitly dirty.")

    write_body = _function_body(source, "writeLedgerStateToLocalStorage")
    if "options.markDirty === false" not in write_body or "markLedgerLocalSynced(savedAt)" not in write_body:
        raise AssertionError("Applying remote ledger state must clear the local dirty flag.")

    deploy_text = DEPLOY_WORKFLOW.read_text(encoding="utf-8")
    if "python3 scripts/check_record_sync_guardrails.py" not in deploy_text:
        raise AssertionError("GitHub Pages deploy must run the record sync guardrail check.")


if __name__ == "__main__":
    run_checks()
    print("Record sync guardrails passed.")
