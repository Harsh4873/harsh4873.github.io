from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_frontend_prefers_configured_cloud_backend_over_stale_local_override():
    source = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")

    configured = source.index("if (CONFIGURED_MODEL_BACKEND_URL && isAllowedBackendServer(CONFIGURED_MODEL_BACKEND_URL))")
    stored_override = source.index("const override = normalizeServerBase(localStorage.getItem(ADMIN_BACKEND_STORAGE_KEY))")
    assert configured < stored_override

    assert "function getModelBackendCandidates()" in source
    assert "isLoopbackServer(ADMIN_BACKEND_URL)" in source
    assert "getModelBackendCandidates()" in source
    assert "window._currentUser.getIdToken()" in source
    assert "headers.set('Authorization', `Bearer ${token}`)" in source


def test_frontend_ledger_cache_is_scoped_to_firebase_uid():
    source = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")

    assert "const LEDGER_OWNER_UID_KEY" in source
    assert "function ensureLocalLedgerOwnerForUid(uid)" in source
    assert "window._ensureLocalLedgerOwnerForUid(user.uid)" in source
    assert "const hadLocalLedgerState = localCacheBelongsToUser &&" in source
    assert "window._applyUserLedgerState(ledgerToApply, { uid: user.uid })" in source
    assert "if (!localLedgerBelongsToUid(uid)) return;" in source
    assert "k.startsWith('pickledger_ledger_owner_uid')" in source


def test_backend_cloud_routes_require_correct_auth_scope():
    source = (ROOT / "pickgrader_server.py").read_text(encoding="utf-8")

    assert '"/ipl"' in source
    assert '"/run-sportsline-odds"' in source
    assert "def _resolve_authorized_ledger_uid" in source
    assert "cannot access another user's ledger" in source
    assert "requested == user_uid or _is_admin_user(self.auth_user)" in source


def test_cloud_run_docs_include_cost_guardrails():
    source = (ROOT / "docs" / "CLOUD_RUN.md").read_text(encoding="utf-8")

    assert "--min-instances 0" in source
    assert "--max-instances 1" in source
    assert "--concurrency 1" in source
    assert "budget alert" in source.lower()


def test_rankings_are_global_admin_state_not_personal_fallback():
    source = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")
    rules = (ROOT / "firestore.rules").read_text(encoding="utf-8")
    html = (ROOT / "index.html").read_text(encoding="utf-8")

    assert "const RANKINGS_COLLECTION = 'rankings'" in source
    assert "async function loadSharedRankingsState()" in source
    assert "async function saveSharedRankingsState(state)" in source
    assert "return isRankingsOwnerUser() ? getPicks() : [];" in source
    assert "isRankingsOwnerUser() && typeof getMergedRankingsLedgerState" in source
    assert "match /rankings/{docId}" in rules
    assert "Global model performance from the admin-tracked ledger" in html
