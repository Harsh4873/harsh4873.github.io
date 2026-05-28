from __future__ import annotations

from pathlib import Path


INDEX_HTML = Path(__file__).resolve().parents[2] / "index.html"


def test_frontend_ledger_cache_is_scoped_to_firebase_uid():
    source = INDEX_HTML.read_text(encoding="utf-8")

    assert "const LEDGER_OWNER_UID_KEY" in source
    assert "function ensureLocalLedgerOwnerForUid(uid)" in source
    assert "window._ensureLocalLedgerOwnerForUid(user.uid)" in source
    assert "const hadLocalLedgerState = localCacheBelongsToUser &&" in source
    assert "window._applyUserLedgerState(ledgerToApply, { uid: user.uid })" in source
    assert "if (!localLedgerBelongsToUid(uid)) return;" in source
    assert "k.startsWith('pickledger_ledger_owner_uid')" in source

    owner_guard = source.index("const localCacheBelongsToUser = typeof window._ensureLocalLedgerOwnerForUid")
    local_payload = source.index("const localBeforeRemote = localCacheBelongsToUser")
    assert owner_guard < local_payload
