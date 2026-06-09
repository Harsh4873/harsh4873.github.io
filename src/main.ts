// @ts-nocheck
import "./styles/pickledger.css";
// PickLedger Viewer — Public Pick Viewer (no auth, no Firebase)
import { initTheme, initMobileMode, initSettingsUI } from './settings';
import {
  loadAllData, getAllPicks as getDataPicks, getResults as getDataResults,
  getGameTimes as getDataGameTimes, saveResults, saveGameTimes,
  getCacheStatus, getCachePayload, type Pick,
} from './data';

// ── Compatibility shims ──
// Many rendering functions reference these globals. We provide them
// from the static data layer so the existing render code works unchanged.

const PICKS: Pick[] = [];
function getGameTimes() { return getDataGameTimes(); }

import { initMobileMode, initSettingsUI, initTheme } from './settings';

  
  window._recordSummaryLoaded = false;
  window._pendingRecordDelta = { wins: 0, losses: 0, pushes: 0 };
  window._authStateResolved = false;
  window._authStateGeneration = 0;
  let userRecordSaveChain = Promise.resolve();
  let userLedgerUnsubscribe = null;

  let authStateReadyResolve = null;
  window._authStateReady = new Promise((resolve) => { authStateReadyResolve = resolve; });

  function resolveAuthStateReady() {
    if (window._authStateResolved) return;
    window._authStateResolved = true;
    if (typeof authStateReadyResolve === 'function') authStateReadyResolve();
  }

  function getLedgerSyncUid(explicitUid) {
    const value = explicitUid === undefined ? '' : explicitUid;
    return typeof value === 'string' ? value.trim() : '';
  }

  function getFirestoreUserDocCandidates(explicitUid) {
    const ids = [];
    const pushId = (value) => {
      const id = typeof value === 'string' ? value.trim() : '';
      if (id && !ids.includes(id)) ids.push(id);
    };
    pushId(explicitUid === undefined ? '' : explicitUid);
    const email = String(null && null.email || '').trim();
    pushId(email);
    if (email) pushId(email.toLowerCase());
    return ids;
  }

  function buildUserDocLedgerPayload(state) {
    const source = state && typeof state === 'object' ? state : {};
    const addedPicks = Array.isArray(source.addedPicks) ? source.addedPicks : [];
    const deletedPickIds = Array.isArray(source.deletedPickIds)
      ? source.deletedPickIds.map(v => String(v))
      : [];
    const deletedPickKeys = Array.isArray(source.deletedPickKeys)
      ? source.deletedPickKeys.map(v => String(v)).filter(Boolean)
      : [];
    const results = source.results && typeof source.results === 'object' ? source.results : {};
    const startTimes = source.startTimes && typeof source.startTimes === 'object'
      ? source.startTimes
      : (source.gameTimes && typeof source.gameTimes === 'object' ? source.gameTimes : {});
    const savedAt = String(source.savedAt || source.lastSynced || new Date().toISOString());
    return {
      ledger: {
        addedPicks,
        deletedPickIds,
        deletedPickKeys,
        results,
        startTimes,
        gameTimes: startTimes,
        savedAt,
      },
      picks: addedPicks,
      results,
      startTimes,
      savedAt,
      lastSynced: savedAt,
    };
  }

  const USER_LEDGER_MERGE_FIELDS = ['ledger', 'picks', 'results', 'startTimes', 'savedAt', 'lastSynced'];
  window.USER_LEDGER_MERGE_FIELDS = USER_LEDGER_MERGE_FIELDS;

  function saveUserLedgerDoc(ref, state) {
    return setDoc(ref, buildUserDocLedgerPayload(state), { mergeFields: USER_LEDGER_MERGE_FIELDS });
  }

  function buildLedgerStateUrl(explicitUid) {
    return '';
  }

  function formatRecordSummary(record) {
    const wins = Number(record && record.wins) || 0;
    const losses = Number(record && record.losses) || 0;
    const pushes = Number(record && record.pushes) || 0;
    return pushes > 0 ? `${wins}-${losses}-${pushes}` : `${wins}-${losses}`;
  }

  function buildRecordSummaryFromPicks(picks) {
    const list = Array.isArray(picks) ? picks : [];
    return {
      wins: list.filter(p => p && p.result === 'win').length,
      losses: list.filter(p => p && p.result === 'loss').length,
      pushes: list.filter(p => p && p.result === 'push').length,
    };
  }

  function addResultToRecordSummary(summary, result) {
    const normalized = normalizeResultValue(result);
    if (normalized === 'win') summary.wins += 1;
    else if (normalized === 'loss') summary.losses += 1;
    else if (normalized === 'push') summary.pushes += 1;
    return summary;
  }

  function getLedgerPicksForRecordSummary() {
    try {
      if (typeof getAllLedgerPicks === 'function') return getAllLedgerPicks();
      if (typeof getPicks === 'function') return getPicks();
    } catch (_) {
      // Fall back to counting the result map directly below.
    }
    return [];
  }

  function buildRecordSummaryFromResultsMap(resultsMap, picksForDedupe = null) {
    const map = (resultsMap && typeof resultsMap === 'object') ? resultsMap : {};
    const summary = { wins: 0, losses: 0, pushes: 0 };
    const picks = Array.isArray(picksForDedupe) ? picksForDedupe : getLedgerPicksForRecordSummary();
    const matchedResultKeys = new Set();

    if (
      Array.isArray(picks) &&
      picks.length &&
      typeof getResultForPickFromMap === 'function' &&
      typeof getLegacyResultKeysForPick === 'function'
    ) {
      picks.forEach((pick, index) => {
        if (!pick || typeof pick !== 'object') return;
        getLegacyResultKeysForPick(pick, index).forEach((key) => {
          if (key) matchedResultKeys.add(String(key));
        });
        addResultToRecordSummary(summary, getResultForPickFromMap(pick, map));
      });
    }

    Object.entries(map).forEach(([key, value]) => {
      if (matchedResultKeys.has(String(key))) return;
      addResultToRecordSummary(summary, normalizeResultEntry(value).result);
    });

    return summary;
  }

  function chooseDerivedRecordSummary(fromResults, fromPicks) {
    if (hasRecordSummaryData(fromResults)) return normalizeRecordSummary(fromResults);
    if (hasRecordSummaryData(fromPicks)) return normalizeRecordSummary(fromPicks);
    return normalizeRecordSummary(null);
  }

  function hasKnownLedgerRecordSource() {
    try {
      return (
        (typeof getResults === 'function' && Object.keys(getResults()).length > 0) ||
        (typeof getPicks === 'function' && getPicks().some(p => p && normalizeResultValue(p.result) !== 'pending'))
      );
    } catch (_) {
      return false;
    }
  }

  function normalizeRecordSummary(record) {
    return {
      wins: Number(record && record.wins) || 0,
      losses: Number(record && record.losses) || 0,
      pushes: Number(record && record.pushes) || 0,
    };
  }


// ── Engine ──
const STORAGE_VERSION = '2026_03_20_mar19_results_fix_v3';
const ADDED_PICKS_KEY = `pickledger_added_picks_${STORAGE_VERSION}`;
const DELETED_PICKS_KEY = `pickledger_deleted_pick_ids_${STORAGE_VERSION}`;
const DELETED_PICK_KEYS_KEY = `pickledger_deleted_pick_keys_${STORAGE_VERSION}`;
const RESULTS_KEY = `pickledger_results_${STORAGE_VERSION}`;
const GAME_TIMES_KEY = `pickledger_game_times_${STORAGE_VERSION}`;
const LEDGER_UPDATED_AT_KEY = `pickledger_ledger_updated_at_${STORAGE_VERSION}`;
const LEDGER_OWNER_UID_KEY = `pickledger_ledger_owner_uid_${STORAGE_VERSION}`;
const LEDGER_DIRTY_KEY = `pickledger_ledger_dirty_${STORAGE_VERSION}`;
const HOME_DATE_STORAGE_KEY = `pickledger_home_date_${STORAGE_VERSION}`;
const HOME_MODE_STORAGE_KEY = `pickledger_home_mode_${STORAGE_VERSION}`;
const ONE_TIME_PROPS_CLEANUP_KEY = `pickledger_cleanup_nba_props_${STORAGE_VERSION}`;
const FORCED_LEDGER_RESET_DATE_KEYS = ['2026-05-04'];
const FORCED_LEDGER_RESET_STORAGE_KEY = `pickledger_forced_reset_may4_${STORAGE_VERSION}`;
const STABLE_PICK_RESULT_KEY_PREFIX = 'stable:';
const STABLE_PICK_KEY_MIGRATION_KEY = `pickledger_stable_pick_keys_${STORAGE_VERSION}`;
const RESET_CUTOFF_ISO = '2026-03-19T00:00:00.000Z';
let activeFilter = 'ALL';
let showSettled = false;
let homeResultMode = 'pending';
let pulseLogRange = 'pending';  // 'pending' | 'today' | '7d' | '30d' | 'all'
let pulseLogSport = 'ALL';
let homeSelectedDateKey = '';
let homeCalendarMonthKey = '';
let homeCalendarOpen = false;
let homeDateFocusKey = '';
let currentDeploymentLedgerResetChanged = false;
const LOOPBACK_HOST_RE = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0)$/i;
const PICKLEDGER_MODE = 'firebase_direct';
const RANKINGS_OWNER_EMAIL = 'hdav4873@gmail.com';
const RANKINGS_STATE_UID = 'primary';
const RANKINGS_COLLECTION = 'rankings';
const RANKINGS_DOC_ID = 'primary';
const ADMIN_BACKEND_STORAGE_KEY = 'pickledger_backend';
const DEFAULT_ADMIN_BACKEND_URL = 'http://127.0.0.1:8765';
const FALLBACK_ADMIN_BACKEND_URL = 'http://127.0.0.1:8767';
const CONFIGURED_MODEL_BACKEND_URL = normalizeServerBase(import.meta.env.VITE_PICKLEDGER_BACKEND_URL || '');
const SPORTYTRADER_FEED_URL = null;  // manual feed removed — use Firebase cache only
const SPORTYTRADER_CACHE_KEY = 'pickledger_sportytrader_feed_cache';
const SPORTSGAMBLER_FEED_URL = null; // manual feed removed — use Firebase cache only
const SPORTSGAMBLER_CACHE_KEY = 'pickledger_sportsgambler_feed_cache';
const SCORES24_MODULES = {
  'scores24-mlb': {
    label: 'Scores24MLB',
    sport: 'MLB',
    url: 'https://scores24.live/mlb',
    timestampKey: 'scores24_mlb',
  },
  'scores24-wnba': {
    label: 'Scores24WNBA',
    sport: 'WNBA',
    url: 'https://scores24.live/wnba',
    timestampKey: 'scores24_wnba',
  },
};
const MODEL_FIREBASE_KEY_ALIASES = {
  'nba-old': ['nba_old', 'nba-old', 'nba'],
  'nba-new': ['nba_new', 'nba-new', 'nba_new_model', 'nbaNew', 'nba'],
  'nba-playoffs': ['nba_playoffs', 'nba-playoffs', 'nbaPlayoffs'],
  nba_playoffs: ['nba_playoffs', 'nba-playoffs', 'nbaPlayoffs'],
  'nba-props': ['nba_props', 'nba-props', 'props'],
  wnba: ['wnba'],
  mlb: ['mlb', 'mlb_old', 'mlb-old'],
  'mlb-new': ['mlb_new', 'mlb-new', 'mlbNew'],
  'mlb-inning': ['mlb_inning', 'mlb-inning', 'mlbInning'],
  'mlb-first-five': ['mlb_first_five', 'mlb-first-five', 'mlbFirstFive'],
  ipl: ['ipl'],
  sportytrader: ['sportytrader'],
  sportsgambler: ['sportsgambler'],
};
let ledgerStateSyncTimer = null;
let ledgerStateSyncInFlight = false;
let autoGradeRefreshInFlight = false;
let suppressSetResultRender = false;
let rankingsLedgerState = null;
let adminHistoricalRankingsState = null;
let adminLocalBackendHealthy = false;
let adminLocalBackendCheckedAt = 0;
let latestLedgerPullInFlight = false;
let latestLedgerPullAt = 0;

function normalizeServerBase(value) {
  if (!value) return '';
  const s = String(value).trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(s) ? s : '';
}

function isLoopbackServer(value) {
  try {
    return LOOPBACK_HOST_RE.test(new URL(value).hostname);
  } catch {
    return false;
  }
}

function isAllowedBackendServer(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || isLoopbackServer(value);
  } catch {
    return false;
  }
}

const ADMIN_BACKEND_URL = (() => {
  const queryOverride = normalizeServerBase(new URLSearchParams(window.location.search).get('api'));
  if (queryOverride && isAllowedBackendServer(queryOverride)) {
    localStorage.setItem(ADMIN_BACKEND_STORAGE_KEY, queryOverride);
    return queryOverride;
  }
  if (CONFIGURED_MODEL_BACKEND_URL && isAllowedBackendServer(CONFIGURED_MODEL_BACKEND_URL)) {
    localStorage.setItem(ADMIN_BACKEND_STORAGE_KEY, CONFIGURED_MODEL_BACKEND_URL);
    return CONFIGURED_MODEL_BACKEND_URL;
  }
  const override = normalizeServerBase(localStorage.getItem(ADMIN_BACKEND_STORAGE_KEY));
  if (override && isAllowedBackendServer(override)) {
    return override;
  }
  return DEFAULT_ADMIN_BACKEND_URL;
})();

function getModelBackendCandidates() {
  const candidates = [ADMIN_BACKEND_URL].filter(Boolean);
  if (isLoopbackServer(ADMIN_BACKEND_URL) && FALLBACK_ADMIN_BACKEND_URL && !candidates.includes(FALLBACK_ADMIN_BACKEND_URL)) {
    candidates.push(FALLBACK_ADMIN_BACKEND_URL);
  }
  return candidates;
}

function getModelBackendLabel(value = ADMIN_BACKEND_URL) {
  return isLoopbackServer(value) ? 'local model backend' : 'cloud model backend';
}

function canSkipBackendHealthGate(value = ADMIN_BACKEND_URL) {
  return !!value && !isLoopbackServer(value);
}

async function canAttemptAdminBackend(force = false) {
  if (canSkipBackendHealthGate()) {
    checkAdminLocalBackendHealth(force).catch(() => {});
    return true;
  }
  return checkAdminLocalBackendHealth(force);
}

async function getBackendAuthUser() {
  try {
    if (window._authStateReady && typeof window._authStateReady.then === 'function') {
      await window._authStateReady;
    }
  } catch {
    // Keep backend calls moving; the request will receive a normal auth error if needed.
  }
  return (auth && auth.currentUser) || null || null;
}

async function getBackendAuthToken() {
  const user = await getBackendAuthUser();
  if (user && typeof user.getIdToken === 'function') {
    return user.getIdToken();
  }
  return '';
}

const PICKLEDGER_NATIVE_FETCH = window.fetch.bind(window);
window.fetch = async function pickledgerFetch(input, init = {}) {
  const targetUrl = typeof input === 'string'
    ? input
    : (input && typeof input === 'object' && 'url' in input ? input.url : '');
  const shouldAttachAuth = targetUrl && getModelBackendCandidates()
    .some((backendUrl) => String(targetUrl).startsWith(backendUrl));
  if (!shouldAttachAuth) {
    return PICKLEDGER_NATIVE_FETCH(input, init);
  }

  const headers = new Headers(init && init.headers
    ? init.headers
    : (input instanceof Request ? input.headers : undefined));
  if (!headers.has('Authorization')) {
    try {
      const token = await getBackendAuthToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
    } catch (err) {
      console.warn('[Auth] Failed to attach backend token:', err && err.message ? err.message : err);
    }
  }
  return PICKLEDGER_NATIVE_FETCH(input, { ...(init || {}), headers });
};

function isAdminModelRunnerUser() {
  return isRankingsOwnerUser();
}

async function checkAdminLocalBackendHealth(force = false) {
  const now = Date.now();
  if (!force && adminLocalBackendCheckedAt && (now - adminLocalBackendCheckedAt) < 15000) {
    return adminLocalBackendHealthy;
  }

  adminLocalBackendCheckedAt = now;
  try {
    const timeoutMs = canSkipBackendHealthGate() ? 15000 : 3000;
    const resp = await fetch(`${ADMIN_BACKEND_URL}/health`, {
      method: 'GET',
      cache: 'no-store',
      signal: _createTimeoutSignal(timeoutMs),
    });
    adminLocalBackendHealthy = !!resp.ok;
  } catch {
    adminLocalBackendHealthy = false;
  }
  null;
  return adminLocalBackendHealthy;
}



function hasMeaningfulLedgerData(state) {
  const ledger = _coerceLedgerState(state);
  return (
    ledger.addedPicks.length > 0 ||
    ledger.deletedPickIds.length > 0 ||
    ledger.deletedPickKeys.length > 0 ||
    Object.keys(ledger.results).length > 0 ||
    Object.keys(ledger.gameTimes).length > 0
  );
}

function chooseMergedResultEntry(existingRaw, incomingRaw, preferIncoming = false) {
  const existing = normalizeResultEntry(existingRaw);
  const incoming = normalizeResultEntry(incomingRaw);
  if (existing.result === incoming.result) return preferIncoming ? incoming : existing;
  if (existing.result === 'pending' && incoming.result !== 'pending') return incoming;
  if (incoming.result === 'pending' && existing.result !== 'pending') return existing;
  if (existing.gradedAtMs && incoming.gradedAtMs) {
    return incoming.gradedAtMs >= existing.gradedAtMs ? incoming : existing;
  }
  if (incoming.gradedAtMs && !existing.gradedAtMs) return incoming;
  if (existing.gradedAtMs && !incoming.gradedAtMs) return existing;
  return preferIncoming ? incoming : existing;
}

function mergeResultMapsPreservingSettled(baseResults, overlayResults, preferOverlayConflicts = true) {
  const merged = {};
  const ingest = (source, preferIncoming) => {
    Object.entries(source && typeof source === 'object' ? source : {}).forEach(([key, value]) => {
      if (!Object.prototype.hasOwnProperty.call(merged, key)) {
        merged[key] = normalizeResultEntry(value).result;
        return;
      }
      merged[key] = chooseMergedResultEntry(merged[key], value, preferIncoming).result;
    });
  };
  ingest(baseResults, false);
  ingest(overlayResults, preferOverlayConflicts);
  return merged;
}

function mergeLedgerStates(baseState, overlayState) {
  const base = _coerceLedgerState(baseState);
  const overlay = _coerceLedgerState(overlayState);
  const pickMap = new Map();
  const order = [];
  const upsertPick = (pick, index) => {
    if (!pick || typeof pick !== 'object') return;
    const key = getStablePickKey(pick)
      || (pick.id != null
        ? String(pick.id)
        : `${pick.source || ''}::${pick.pick || ''}::${pick.date || ''}::${index}`);
    if (!pickMap.has(key)) order.push(key);
    pickMap.set(key, pick);
  };
  base.addedPicks.forEach((pick, index) => upsertPick(pick, index));
  overlay.addedPicks.forEach((pick, index) => upsertPick(pick, base.addedPicks.length + index));
  const mergedPicks = order.map((key) => pickMap.get(key)).filter(Boolean);
  const baseResults = migrateResultsToStablePickKeys(base.results, [...PICKS, ...mergedPicks]).results;
  const overlayResults = migrateResultsToStablePickKeys(overlay.results, [...PICKS, ...mergedPicks]).results;
  const baseTs = getLedgerSavedAtMs(base);
  const overlayTs = getLedgerSavedAtMs(overlay);
  const deletedPickKeys = baseTs === overlayTs
    ? [...new Set([...base.deletedPickKeys, ...overlay.deletedPickKeys])]
    : [...new Set((overlayTs > baseTs ? overlay.deletedPickKeys : base.deletedPickKeys))];
  return {
    addedPicks: mergedPicks,
    deletedPickIds: [...new Set([...base.deletedPickIds, ...overlay.deletedPickIds])],
    deletedPickKeys,
    results: mergeResultMapsPreservingSettled(baseResults, overlayResults, overlayTs >= baseTs),
    gameTimes: { ...base.gameTimes, ...overlay.gameTimes },
    savedAt: getNewestLedgerSavedAt(base, overlay),
  };
}

window.mergeLedgerStates = mergeLedgerStates;

function getAddedPicks() {
  try {
    const raw = localStorage.getItem(ADDED_PICKS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(parsed) ? parsed : [];
    return list.map(p => ({ ...p, units: 1 }));
  } catch {
    return [];
  }
}

function saveAddedPicks(list) {
  localStorage.setItem(ADDED_PICKS_KEY, JSON.stringify(list));
  null;
  null;
}

function getDeletedPickIds() {
  try {
    const raw = localStorage.getItem(DELETED_PICKS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(v => String(v)) : [];
  } catch {
    return [];
  }
}

function saveDeletedPickIds(ids) {
  localStorage.setItem(DELETED_PICKS_KEY, JSON.stringify(ids));
  null;
  null;
}

function getDeletedPickKeys() {
  try {
    const raw = localStorage.getItem(DELETED_PICK_KEYS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(v => String(v)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveDeletedPickKeys(keys) {
  localStorage.setItem(DELETED_PICK_KEYS_KEY, JSON.stringify([...new Set((Array.isArray(keys) ? keys : []).map(v => String(v)).filter(Boolean))]));
  null;
  null;
}

function isPickDeletedByTombstones(pick, deletedIds = getDeletedPickIds(), deletedKeys = getDeletedPickKeys()) {
  const stableKey = getStablePickKey(pick);
  if (stableKey && deletedKeys.includes(stableKey)) return true;
  // Numeric tombstones are legacy and can collide across devices after a
  // browser reset. Only use them for picks that cannot produce a stable key.
  return !stableKey && deletedIds.includes(String(pick && pick.id));
}

function removeDeletedTombstonesForPicks(picks) {
  const list = Array.isArray(picks) ? picks : [];
  if (!list.length) return;
  const idsToClear = new Set(list.map(p => String(p && p.id)).filter(Boolean));
  const keysToClear = new Set(list.map(p => getStablePickKey(p)).filter(Boolean));
  const nextIds = getDeletedPickIds().filter(id => !idsToClear.has(String(id)));
  const nextKeys = getDeletedPickKeys().filter(key => !keysToClear.has(String(key)));
  localStorage.setItem(DELETED_PICKS_KEY, JSON.stringify(nextIds));
  localStorage.setItem(DELETED_PICK_KEYS_KEY, JSON.stringify(nextKeys));
  null;
}

function runOneTimeNbaPropsCleanup(state) {
  localStorage.setItem(ONE_TIME_PROPS_CLEANUP_KEY, '1');
  return 0;
}

function getLedgerSavedAt(state) {
  const source = state && typeof state === 'object' ? state : {};
  const ledger = source.ledger && typeof source.ledger === 'object' ? source.ledger : source;
  const value = source.savedAt || source.lastSynced || ledger.savedAt || ledger.lastSynced || '';
  return String(value || '').trim();
}

function getLedgerSavedAtMs(state) {
  return Date.parse(getLedgerSavedAt(state)) || 0;
}

function getNewestLedgerSavedAt(a, b) {
  const aValue = getLedgerSavedAt(a);
  const bValue = getLedgerSavedAt(b);
  return getLedgerSavedAtMs(a) >= getLedgerSavedAtMs(b) ? aValue : bValue;
}

function getLocalLedgerSavedAt() {
  try {
    return String(localStorage.getItem(LEDGER_UPDATED_AT_KEY) || '').trim();
  } catch {
    return '';
  }
}

function getLocalLedgerOwnerUid() {
  try {
    return String(localStorage.getItem(LEDGER_OWNER_UID_KEY) || '').trim();
  } catch {
    return '';
  }
}

function isLocalLedgerDirty() {
  try {
    return localStorage.getItem(LEDGER_DIRTY_KEY) === '1';
  } catch {
    return false;
  }
}

function setLocalLedgerOwnerUid(uid) {
  try {
    const value = typeof uid === 'string' ? uid.trim() : '';
    if (value) localStorage.setItem(LEDGER_OWNER_UID_KEY, value);
    else localStorage.removeItem(LEDGER_OWNER_UID_KEY);
  } catch {
    // Ledger ownership is only a browser-cache guardrail.
  }
}

function localLedgerBelongsToUid(uid) {
  const value = typeof uid === 'string' ? uid.trim() : '';
  return Boolean(value && getLocalLedgerOwnerUid() === value);
}

function ensureLocalLedgerOwnerForUid(uid) {
  const value = typeof uid === 'string' ? uid.trim() : '';
  if (!value) {
    clearLedgerLocalState();
    return false;
  }
  const owner = getLocalLedgerOwnerUid();
  const hasLocalData = hasMeaningfulLocalState();
  if (!owner) {
    if (hasLocalData) {
      clearLedgerLocalState();
      setLocalLedgerOwnerUid(value);
      return false;
    }
    setLocalLedgerOwnerUid(value);
    return true;
  }
  if (owner !== value) {
    clearLedgerLocalState();
    setLocalLedgerOwnerUid(value);
    return false;
  }
  return true;
}

function getLedgerOwnerUidOption(options = {}) {
  const explicit = options.uid || options.ownerUid || '' || '';
  return typeof explicit === 'string' ? explicit.trim() : '';
}

function markLedgerLocalChanged(savedAt = new Date().toISOString(), options = {}) {
  const value = String(savedAt || new Date().toISOString());
  try {
    if ('') setLocalLedgerOwnerUid('');
    localStorage.setItem(LEDGER_UPDATED_AT_KEY, value);
    if (options.dirty !== false) localStorage.setItem(LEDGER_DIRTY_KEY, '1');
  } catch {
    // Local ledger still exists in memory if storage metadata cannot be written.
  }
  return value;
}

function markLedgerLocalSynced(savedAt = getLocalLedgerSavedAt() || new Date().toISOString()) {
  const value = String(savedAt || new Date().toISOString());
  try {
    if ('') setLocalLedgerOwnerUid('');
    localStorage.setItem(LEDGER_UPDATED_AT_KEY, value);
    localStorage.removeItem(LEDGER_DIRTY_KEY);
  } catch {
    // Sync metadata is a cache hint; the Firestore write already succeeded.
  }
  return value;
}



function getAllLedgerPicks() {
  return PICKS;
}

function _coerceLedgerState(state) {
  const source = state && typeof state === 'object' ? state : {};
  const ledger = source.ledger && typeof source.ledger === 'object' ? source.ledger : source;
  const addedPicks = Array.isArray(ledger.addedPicks) ? ledger.addedPicks : [];
  const deletedPickIds = Array.isArray(ledger.deletedPickIds) ? ledger.deletedPickIds.map(v => String(v)) : [];
  const deletedPickKeySet = new Set(
    (Array.isArray(ledger.deletedPickKeys)
      ? ledger.deletedPickKeys
      : (Array.isArray(source.deletedPickKeys) ? source.deletedPickKeys : []))
      .map(v => String(v))
      .filter(Boolean)
  );
  const deletedIdSet = new Set(deletedPickIds);
  addedPicks.forEach((pick) => {
    if (!pick || !deletedIdSet.has(String(pick.id))) return;
    const key = getStablePickKey(pick);
    if (key) deletedPickKeySet.add(key);
  });
  const gameTimes = source.gameTimes && typeof source.gameTimes === 'object'
    ? { ...source.gameTimes }
    : (source.startTimes && typeof source.startTimes === 'object'
      ? { ...source.startTimes }
      : (ledger.gameTimes && typeof ledger.gameTimes === 'object'
        ? { ...ledger.gameTimes }
        : (ledger.startTimes && typeof ledger.startTimes === 'object' ? { ...ledger.startTimes } : {})));
  const results = source.results && typeof source.results === 'object'
    ? { ...source.results }
    : (ledger.results && typeof ledger.results === 'object' ? { ...ledger.results } : {});
  return {
    addedPicks,
    deletedPickIds,
    deletedPickKeys: [...deletedPickKeySet],
    results,
    startTimes: gameTimes,
    gameTimes,
    savedAt: getLedgerSavedAt(source),
  };
}

function isRankingsOwnerUser() {
  const user = (auth && auth.currentUser) || null || null;
  const email = String(user && user.email || '').trim().toLowerCase();
  return email === RANKINGS_OWNER_EMAIL;
}

function getPicksFromLedgerState(state) {
  const ledger = _coerceLedgerState(state);
  return [...PICKS, ...ledger.addedPicks]
    .filter(p => !isPickDeletedByTombstones(p, ledger.deletedPickIds, ledger.deletedPickKeys))
    .map(p => {
      const result = getResultForPickFromMap(p, ledger.results);
      return { ...p, result, pl: calcPL(p.units, result) };
    });
}

async function loadSharedRankingsState() {
  if (!((auth && auth.currentUser) || null)) return null;
  try {
    const snap = await getDoc(doc(db, RANKINGS_COLLECTION, RANKINGS_DOC_ID));
    if (!snap.exists()) return null;
    const state = _coerceLedgerState(snap.data() || {});
    return hasMeaningfulLedgerData(state) ? state : null;
  } catch (err) {
    console.warn('[Rankings] shared rankings load failed:', err && err.message ? err.message : err);
    return null;
  }
}

async function saveSharedRankingsState(state) {
  if (!isRankingsOwnerUser()) return false;
  const normalized = _coerceLedgerState(state);
  try {
    await setDoc(doc(db, RANKINGS_COLLECTION, RANKINGS_DOC_ID), {
      ...buildUserDocLedgerPayload(normalized),
      ownerEmail: RANKINGS_OWNER_EMAIL,
      updatedAt: new Date().toISOString(),
      description: 'Global model performance built from the admin-tracked PickLedger ledger.',
    }, { merge: true });
    return true;
  } catch (err) {
    console.warn('[Rankings] shared rankings save failed:', err && err.message ? err.message : err);
    return false;
  }
}

function getRankingsPicks() {
  return PICKS;
}

async function loadCanonicalRankingsState() {
  const sharedState = await loadSharedRankingsState();
  if (sharedState) {
    rankingsLedgerState = sharedState;
    return rankingsLedgerState;
  }
   else {
    rankingsLedgerState = _coerceLedgerState(null);
  }
  return rankingsLedgerState;
}

async function pushCanonicalRankingsState(state) {
  if (!isRankingsOwnerUser()) return false;
  const nextState = _coerceLedgerState(state && state.ledger ? state.ledger : state);
  rankingsLedgerState = getMergedRankingsLedgerState(nextState);
  await saveSharedRankingsState(rankingsLedgerState);
  return true;
}

function hasMeaningfulLocalState() {
  return (
    getAddedPicks().length > 0 ||
    getDeletedPickIds().length > 0 ||
    getDeletedPickKeys().length > 0 ||
    Object.keys(getResults()).length > 0 ||
    Object.keys(getGameTimes()).length > 0
  );
}

window._hasMeaningfulLocalState = hasMeaningfulLocalState;
window.hasMeaningfulLocalState = hasMeaningfulLocalState;
window.isLocalLedgerDirty = isLocalLedgerDirty;

function shouldPreserveLocalLedgerState(localState, remoteState) {
  if (!isLocalLedgerDirty()) return false;
  if (!hasMeaningfulLedgerData(localState)) return false;
  return true;
}

window.shouldPreserveLocalLedgerState = shouldPreserveLocalLedgerState;

function buildLedgerStatePayload(options = {}) {
  const shouldTouchSavedAt = options.touchSavedAt !== false;
  migrateLocalResultKeysToStable({ schedule: false, dirty: shouldTouchSavedAt });
  const existingSavedAt = getLocalLedgerSavedAt();
  const localHasData = hasMeaningfulLocalState();
  const savedAt = existingSavedAt
    || (localHasData && shouldTouchSavedAt ? null : '')
    || (!localHasData ? new Date().toISOString() : '');
  return {
    version: 1,
    savedAt,
    addedPicks: getAddedPicks(),
    deletedPickIds: getDeletedPickIds(),
    deletedPickKeys: getDeletedPickKeys(),
    results: getResults(),
    gameTimes: getGameTimes(),
  };
}

window._buildLedgerStatePayload = buildLedgerStatePayload;

function clearLedgerLocalState() {
  localStorage.removeItem(ADDED_PICKS_KEY);
  localStorage.removeItem(DELETED_PICKS_KEY);
  localStorage.removeItem(DELETED_PICK_KEYS_KEY);
  localStorage.removeItem(RESULTS_KEY);
  localStorage.removeItem(GAME_TIMES_KEY);
  localStorage.removeItem(LEDGER_UPDATED_AT_KEY);
  localStorage.removeItem(LEDGER_OWNER_UID_KEY);
  localStorage.removeItem(LEDGER_DIRTY_KEY);
}

function writeLedgerStateToLocalStorage(state, options = {}) {
  const ownerUid = getLedgerOwnerUidOption(options);
  if (ownerUid) setLocalLedgerOwnerUid(ownerUid);
  if (!state || typeof state !== 'object') return { hasAny: false };
  const mirrorResultsToServer = options.mirrorResultsToServer === true;
  const migratedState = migrateLedgerStateToStablePickKeys(state);
  runOneTimeNbaPropsCleanup(migratedState);
  const ledger = migratedState.ledger && typeof migratedState.ledger === 'object' ? migratedState.ledger : migratedState;
  const addedRaw = Array.isArray(ledger.addedPicks) ? ledger.addedPicks : [];
  const added = addedRaw;
  const deleted = Array.isArray(ledger.deletedPickIds) ? ledger.deletedPickIds.map(v => String(v)) : [];
  const deletedKeys = Array.isArray(ledger.deletedPickKeys) ? ledger.deletedPickKeys.map(v => String(v)).filter(Boolean) : [];
  const resultsRaw = (migratedState.results && typeof migratedState.results === 'object')
    ? migratedState.results
    : ((ledger.results && typeof ledger.results === 'object') ? ledger.results : {});
  const results = { ...resultsRaw };
  const gameTimesRaw = (migratedState.gameTimes && typeof migratedState.gameTimes === 'object')
    ? migratedState.gameTimes
    : ((migratedState.startTimes && typeof migratedState.startTimes === 'object')
      ? migratedState.startTimes
      : ((ledger.gameTimes && typeof ledger.gameTimes === 'object')
        ? ledger.gameTimes
        : ((ledger.startTimes && typeof ledger.startTimes === 'object') ? ledger.startTimes : {})));
  const gameTimes = { ...gameTimesRaw };
  const hasAny = added.length || deleted.length || deletedKeys.length || Object.keys(results).length || Object.keys(gameTimes).length;
  if (!hasAny) return { hasAny: false };

  localStorage.setItem(ADDED_PICKS_KEY, JSON.stringify(added));
  localStorage.setItem(DELETED_PICKS_KEY, JSON.stringify(deleted));
  localStorage.setItem(DELETED_PICK_KEYS_KEY, JSON.stringify(deletedKeys));
  localStorage.setItem(RESULTS_KEY, JSON.stringify(results));
  if (mirrorResultsToServer) {
    Object.entries(results).forEach(([id, result]) => null);
  }
  localStorage.setItem(GAME_TIMES_KEY, JSON.stringify(gameTimes));
  const savedAt = getLedgerSavedAt(migratedState) || new Date().toISOString();
  if (options.markDirty === false) markLedgerLocalSynced(savedAt);
  else markLedgerLocalChanged(savedAt);
  return { hasAny: true };
}

function applyLedgerStateFromServer(state, options = {}) {
  const uid = getLedgerOwnerUidOption(options);
  if (uid) setLocalLedgerOwnerUid(uid);
  const { hasAny } = writeLedgerStateToLocalStorage(state, { uid, markDirty: false });
  return hasAny;
}

function applyUserLedgerState(state, options = {}) {
  const uid = getLedgerOwnerUidOption(options);
  clearLedgerLocalState();
  if (uid) setLocalLedgerOwnerUid(uid);
  const { hasAny } = writeLedgerStateToLocalStorage(state, {
    uid,
    markDirty: options.markDirty === true,
  });
  return hasAny;
}

window._clearLedgerLocalState = clearLedgerLocalState;
window._applyUserLedgerState = applyUserLedgerState;
window._ensureLocalLedgerOwnerForUid = ensureLocalLedgerOwnerForUid;
window._localLedgerBelongsToUid = localLedgerBelongsToUid;

async function pushLedgerState(force = false) {
  const uid = window.getLedgerSyncUid ? window.getLedgerSyncUid() : '';
  if (!window._authStateResolved || !uid) return;
  if (!force && !isLocalLedgerDirty()) return;
  if (!ensureLocalLedgerOwnerForUid(uid) && !hasMeaningfulLocalState()) return;
  if (!localLedgerBelongsToUid(uid)) return;
  if (ledgerStateSyncInFlight && !force) return;
  ledgerStateSyncInFlight = true;
  try {
    const state = buildLedgerStatePayload();
    await saveLedgerToFirebase(uid, state);
    await pushCanonicalRankingsState(state);
    markLedgerLocalSynced(state.savedAt || getLocalLedgerSavedAt());
  } catch {
    // Best-effort sync only.
  } finally {
    ledgerStateSyncInFlight = false;
  }
}

window.pushLedgerState = pushLedgerState;

function scheduleLedgerStateSync(delayMs = 250) {
  if (ledgerStateSyncTimer) {
    clearTimeout(ledgerStateSyncTimer);
  }
  ledgerStateSyncTimer = setTimeout(() => {
    pushLedgerState(false);
    if ('' && window._saveUserRecordSummary && typeof window.syncRecordWithLedger === 'function') {
      window.syncRecordWithLedger();
    }
  }, Math.max(0, Number(delayMs) || 0));
}

function flushLedgerStateBeforeUnload() {
  if (!hasMeaningfulLocalState() || !'') return;
  if (!localLedgerBelongsToUid('')) return;
  if (!isLocalLedgerDirty()) return;
  pushLedgerState(true).catch(() => {});
}

window.addEventListener('pagehide', flushLedgerStateBeforeUnload);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushLedgerStateBeforeUnload();
    return;
  }
  pullLatestUserLedgerState().catch(() => {});
});
window.addEventListener('focus', () => {
  pullLatestUserLedgerState().catch(() => {});
});

async function pullLedgerStateIfNeeded(options = {}) {
  const uid = window.getLedgerSyncUid ? window.getLedgerSyncUid(options.uid) : '';
  const expectedGeneration = Number.isInteger(options.expectedGeneration) ? options.expectedGeneration : null;
  ensureLocalLedgerOwnerForUid(uid);
  if (hasMeaningfulLocalState() || !window._authStateResolved || !uid) return false;
  try {
    const data = await loadLedgerFromFirebase(uid);
    if (expectedGeneration !== null && expectedGeneration !== window._authStateGeneration) return false;
    let stateToApply = data || {};
    let forcedResetChanged = false;
    if (typeof window.resetLedgerStateForCurrentDeployment === 'function') {
      const reset = window.resetLedgerStateForCurrentDeployment(stateToApply);
      stateToApply = reset.state;
      forcedResetChanged = Boolean(reset.changed);
    }
    if (typeof window.focusHomeDateForIncomingLedgerState === 'function') {
      window.focusHomeDateForIncomingLedgerState(stateToApply, {});
    }
    const restored = applyLedgerStateFromServer(stateToApply, { uid });
    if (restored) {
      if (forcedResetChanged && typeof pushLedgerState === 'function') {
        pushLedgerState(true).catch(() => {});
      }
      null
      render();
      if (document.getElementById('tab-search').classList.contains('active')) {
        renderSearch();
      }
      setRefreshStatus('Recovered ledger state from Firebase', 'ok');
      return true;
    }
  } catch {
    // Ignore restore failures; local storage remains source-of-truth.
  }
  return false;
}

async function pullLatestUserLedgerState(options = {}) {
  const uid = window.getLedgerSyncUid ? window.getLedgerSyncUid(options.uid) : '';
  if (!window._authStateResolved || !uid) return false;
  if (latestLedgerPullInFlight) return false;

  const force = options.force === true;
  const now = Date.now();
  if (!force && latestLedgerPullAt && now - latestLedgerPullAt < 3000) return false;
  latestLedgerPullAt = now;
  latestLedgerPullInFlight = true;
  try {
    const remoteState = await loadLedgerFromFirebase(uid);
    if (!hasMeaningfulFirestoreLedgerState(remoteState)) return false;
    return applyRemoteLedgerState(remoteState, window._authStateGeneration);
  } catch (err) {
    console.warn('[Firestore] foreground ledger sync failed:', err && err.message ? err.message : err);
    return false;
  } finally {
    latestLedgerPullInFlight = false;
  }
}

window.pullLatestUserLedgerState = pullLatestUserLedgerState;

function toggleMoreFilters(e) {
  e.stopPropagation();
  closeHomeDatePicker();
  const dd = document.getElementById('filter-dropdown');
  if (dd) dd.classList.toggle('open');
}
function closeMoreFilters() {
  const dd = document.getElementById('filter-dropdown');
  if (dd) dd.classList.remove('open');
}
document.addEventListener('click', function(e) {
  const wrap = document.querySelector('.filter-more-wrap');
  if (wrap && !wrap.contains(e.target)) closeMoreFilters();
  const dateWrap = document.getElementById('home-date-wrap');
  if (dateWrap && !dateWrap.contains(e.target)) closeHomeDatePicker();
});
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    closeMoreFilters();
    closeHomeDatePicker();
  }
});

function setRefreshStatus(msg, state) {
  const el = document.getElementById('refresh-status');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('error', 'ok');
  if (state === 'error') el.classList.add('error');
  if (state === 'ok') el.classList.add('ok');
}

function setSyncStatus(state) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  if (state === 'synced') { el.textContent = '✓ synced'; el.style.color = 'var(--win)'; }
  else if (state === 'syncing') { el.textContent = 'syncing...'; el.style.color = 'var(--muted)'; }
  else { el.textContent = 'offline'; el.style.color = 'var(--muted)'; }
}



async function syncWithServer() {
  setSyncStatus('syncing');
  try {
    const healthy = await checkHealth();
    if (!healthy) {
      throw new Error('health check failed');
    }
    const uid = window.getLedgerSyncUid ? window.getLedgerSyncUid() : '';
    if (uid && hasMeaningfulLocalState() && isLocalLedgerDirty()) {
      null;
    } else if (uid) {
      null;
    }
    setSyncStatus('synced');
  } catch {
    setSyncStatus('offline');
  }
}

function isNetworkRequestErrorMessage(message) {
  const text = String(message || '').toLowerCase();
  return (
    text.includes('failed to fetch') ||
    text.includes('networkerror') ||
    text.includes('load failed') ||
    text.includes('timed out') ||
    text.includes('timeout') ||
    text.includes('bad response')
  );
}

async function refreshAutoGrades() {
  console.log('refreshAutoGrades removed');
}

function normalizeHomeResultMode(mode) {
  const value = String(mode || '').trim().toLowerCase();
  return ['pending', 'settled', 'all'].includes(value) ? value : 'pending';
}

function persistHomeResultMode() {
  try {
    localStorage.setItem(HOME_MODE_STORAGE_KEY, homeResultMode);
  } catch {
    // Ignore storage failures; the current session still keeps the mode.
  }
}

function setHomeResultMode(mode) {
  const nextMode = normalizeHomeResultMode(mode);
  homeResultMode = nextMode;
  showSettled = nextMode === 'settled';
  persistHomeResultMode();
  syncHomeSettledToggleButton();
  render();
}

function toggleShowSettled() {
  setHomeResultMode(homeResultMode === 'settled' ? 'pending' : 'settled');
}

function syncHomeSettledToggleButton() {
  homeResultMode = normalizeHomeResultMode(homeResultMode || (showSettled ? 'settled' : 'pending'));
  showSettled = homeResultMode === 'settled';
  const btn = document.getElementById('settled-toggle-btn');
  if (btn) {
    btn.textContent = showSettled ? 'SHOW PENDING' : 'SHOW SETTLED';
    btn.classList.toggle('is-settled', showSettled);
  }
  document.querySelectorAll('[data-home-mode]').forEach((el) => {
    el.classList.toggle('active', el.getAttribute('data-home-mode') === homeResultMode);
  });
}

function calcPL(u,r) {
  const normalized = normalizeResultValue(r);
  if(normalized==='push'||normalized==='pending') return 0;
  if(normalized==='loss') return -u;
  return u;
}
function normalizeResultValue(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'w' || text === 'win') return 'win';
  if (text === 'l' || text === 'loss') return 'loss';
  if (text === 'p' || text === 'push') return 'push';
  return 'pending';
}
function normalizeNumericValue(value) {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}
function normalizeOddsValue(value) {
  return normalizeNumericValue(value);
}

function stableHashString(value) {
  const text = String(value || '');
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function normalizeStableToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^a-z0-9.+\-@|:\/\s]/g, '')
    .replace(/\s+/g, ' ');
}

function normalizeStableLine(value) {
  const num = normalizeNumericValue(value);
  if (num == null) return '';
  return Number.isInteger(num) ? String(num) : String(num).replace(/0+$/, '').replace(/\.$/, '');
}

function normalizeStableTeamToken(team, sport) {
  return normalizeStableToken(normalizeTeamForGameLabel(team, sport));
}

function getDateKeyInTimeZone(value, timeZone) {
  const dt = value instanceof Date ? value : new Date(value);
  if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return '';
  const zone = String(timeZone || '').trim();
  if (!zone) return getLocalDateKey(dt);
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(dt).reduce((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value;
      return acc;
    }, {});
    if (parts.year && parts.month && parts.day) {
      return `${parts.year}-${parts.month}-${parts.day}`;
    }
  } catch {
    return getLocalDateKey(dt);
  }
  return getLocalDateKey(dt);
}

function getLeagueLocalTimeZone(sport) {
  const upper = String(sport || '').toUpperCase();
  if (upper === 'MLB' || upper === 'NBA') return 'America/New_York';
  return '';
}

function getLeagueLocalDateKeyFromIso(iso, sport) {
  const value = String(iso || '').trim();
  if (!value) return '';
  return getDateKeyInTimeZone(value, getLeagueLocalTimeZone(sport));
}

function formatDateKeyForPickLabel(dateKey) {
  const dt = parseLocalDateKey(dateKey);
  if (!dt) return '';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getPickGameDateKeyLocal(pick) {
  const sport = String(pick && pick.sport || '').toUpperCase();
  const startIso = String(pick && (pick.start_time || pick.startTime || pick.game_time || '') || '').trim();
  const fromStart = getLeagueLocalDateKeyFromIso(startIso, sport);
  if (fromStart) return fromStart;
  return getPickDateKey(pick && (pick.game_date_key || pick.game_date || pick.Date || pick.date));
}

function parseMlbNoRunInningPick(pickText) {
  const m = String(pickText || '').trim().match(/\binning\s+([1-9])\s*[-\u2013\u2014:]?\s*no\s+runs?\s+scored\b/i);
  if (!m) return null;
  const inning = Number(m[1]);
  return Number.isFinite(inning) ? inning : null;
}

function getStablePickMarketParts(pick) {
  const sport = String(pick && pick.sport || '').toUpperCase();
  const pickText = String(pick && pick.pick || '').trim();
  const head = pickText.split('(', 1)[0].trim();
  const lower = head.toLowerCase().replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();
  const teams = _pickAwayHomePair(pick || {});
  const matchupKey = _matchupKeyFromTeams(teams.away, teams.home, sport);
  const withGame = (side) => `${normalizeStableToken(side)}@${matchupKey || 'unknown-game'}`;

  const noRunInning = sport === 'MLB' ? parseMlbNoRunInningPick(pickText) : null;
  if (noRunInning != null) {
    return {
      market: 'no_run_inning',
      line: normalizeStableLine(noRunInning),
      selectedTeamOrSide: withGame('no_run_scored'),
    };
  }

  const mTotal = lower.match(/\b(over|under)\s+(\d+(?:\.\d+)?)\b/);
  const hasTeamTg = lower.endsWith(' tg') && !/^(over|under)\b/.test(lower);
  if (mTotal && !lower.includes('team total') && !hasTeamTg) {
    return {
      market: 'total',
      line: normalizeStableLine(mTotal[2]),
      selectedTeamOrSide: withGame(mTotal[1]),
    };
  }

  const mTeamTotal = lower.match(/^(.*?)\s+team total\s+(over|under)\s+(\d+(?:\.\d+)?)/);
  if (mTeamTotal) {
    const team = normalizeStableTeamToken(mTeamTotal[1], sport);
    return {
      market: 'team_total',
      line: normalizeStableLine(mTeamTotal[3]),
      selectedTeamOrSide: withGame(`${team}:${mTeamTotal[2]}`),
    };
  }

  const mTg = lower.match(/^(.*?)\s+(over|under)\s+(\d+(?:\.\d+)?)\s*tg\b/);
  if (mTg) {
    const team = normalizeStableTeamToken(mTg[1], sport);
    return {
      market: 'team_goals',
      line: normalizeStableLine(mTg[3]),
      selectedTeamOrSide: withGame(`${team}:${mTg[2]}`),
    };
  }

  if (/^draw$/.test(lower)) {
    return { market: 'draw', line: '', selectedTeamOrSide: withGame('draw') };
  }

  const mBtts = lower.match(/^btts\s+(yes|no)$/);
  if (mBtts) {
    return { market: 'btts', line: '', selectedTeamOrSide: withGame(mBtts[1]) };
  }

  const mSpread = head.match(/^(.*?)\s*([+-]\d+(?:\.\d+)?)\b/);
  if (mSpread) {
    return {
      market: 'spread',
      line: normalizeStableLine(mSpread[2]),
      selectedTeamOrSide: withGame(normalizeStableTeamToken(mSpread[1], sport)),
    };
  }

  const mMl = lower.match(/^(.*?)\s+ml\b/);
  if (mMl) {
    return {
      market: 'moneyline',
      line: '',
      selectedTeamOrSide: withGame(normalizeStableTeamToken(mMl[1], sport)),
    };
  }

  const fallbackTeam = head.replace(/\s*[+-]\d+(?:\.\d+)?\s*$/i, '').replace(/\s+ml\b/i, '').trim()
    || String(pick && pick.team || '').trim();
  return {
    market: normalizeStableToken(pick && (pick.market || pick.decision) || 'moneyline'),
    line: normalizeStableLine(pick && (pick.market_line ?? pick.line)),
    selectedTeamOrSide: fallbackTeam
      ? withGame(normalizeStableTeamToken(fallbackTeam, sport))
      : withGame(normalizeStableToken(head || pickText || 'unknown-side')),
  };
}

function getStablePickKey(pick) {
  if (!pick || typeof pick !== 'object') return '';
  const sport = String(pick.sport || '').toUpperCase();
  const market = getStablePickMarketParts(pick);
  const tuple = [
    normalizeStableToken(pick.source || ''),
    sport,
    getPickGameDateKeyLocal(pick),
    normalizeStableToken(market.market),
    normalizeStableLine(market.line),
    normalizeStableToken(market.selectedTeamOrSide),
  ];
  return `${STABLE_PICK_RESULT_KEY_PREFIX}${stableHashString(JSON.stringify(tuple))}`;
}
window.getStablePickKey = getStablePickKey;

function getLegacyResultKeysForPick(pick, index = 0) {
  const keys = [];
  const pushKey = (value) => {
    const key = String(value || '').trim();
    if (key && !keys.includes(key)) keys.push(key);
  };
  pushKey(getStablePickKey(pick));
  pushKey(pick && pick.id);
  pushKey(`${pick && pick.source || ''}::${pick && pick.pick || ''}::${pick && pick.date || ''}`);
  pushKey(`${pick && pick.source || ''}::${pick && pick.pick || ''}::${pick && pick.date || ''}::${index}`);
  return keys;
}

function normalizeResultEntry(raw) {
  const value = raw && typeof raw === 'object'
    ? (raw.result ?? raw.outcome ?? raw.grade ?? raw.status ?? raw.value)
    : raw;
  const result = normalizeResultValue(value);
  const tsValue = raw && typeof raw === 'object'
    ? (raw.gradedAt || raw.graded_at || raw.gradedTimestamp || raw.updatedAt || raw.updated_at || raw.savedAt || raw.saved_at || raw.ts)
    : null;
  const gradedAtMs = Date.parse(String(tsValue || '')) || 0;
  return { result, gradedAtMs };
}

function getKnownPickStartTimeMs(pick) {
  if (!pick || typeof pick !== 'object') return 0;
  const directValues = [
    pick.start_time,
    pick.game_start_time,
    pick.startTime,
    pick.game_time,
  ];
  for (const raw of directValues) {
    const ms = Date.parse(String(raw || ''));
    if (Number.isFinite(ms)) return ms;
  }
  try {
    const times = typeof getGameTimes === 'function' ? getGameTimes() : {};
    const raw = times && times[String(pick.id)];
    const ms = Date.parse(String(raw || ''));
    return Number.isFinite(ms) ? ms : 0;
  } catch {
    return 0;
  }
}

function pickStartsInFuture(pick, bufferMs = 5 * 60 * 1000) {
  const startMs = getKnownPickStartTimeMs(pick);
  return Boolean(startMs && startMs > Date.now() + bufferMs);
}

function chooseResultEntry(existing, incoming) {
  if (!existing) return incoming;
  if (!incoming) return existing;
  if (existing.result === incoming.result) {
    if (existing.gradedAtMs && incoming.gradedAtMs) {
      return incoming.gradedAtMs < existing.gradedAtMs ? incoming : existing;
    }
    return existing;
  }
  if (existing.result === 'pending' && incoming.result !== 'pending') return incoming;
  if (incoming.result === 'pending' && existing.result !== 'pending') return existing;
  if (existing.gradedAtMs && incoming.gradedAtMs) {
    return incoming.gradedAtMs < existing.gradedAtMs ? incoming : existing;
  }
  if (!existing.gradedAtMs && incoming.gradedAtMs) return incoming;
  return existing;
}

function migrateResultsToStablePickKeys(results, picks) {
  const source = results && typeof results === 'object' ? results : {};
  const list = Array.isArray(picks) ? picks : [];
  const lookup = new Map();
  list.forEach((pick, index) => {
    getLegacyResultKeysForPick(pick, index).forEach((key) => lookup.set(key, pick));
  });

  const migrated = new Map();
  const orphans = {};
  let changed = false;
  const mergeInto = (key, raw) => {
    const entry = normalizeResultEntry(raw);
    const current = migrated.get(key);
    migrated.set(key, chooseResultEntry(current, entry));
  };

  Object.entries(source).forEach(([rawKey, rawValue]) => {
    const key = String(rawKey);
    const pick = lookup.get(key);
    if (pick) {
      const stableKey = getStablePickKey(pick);
      if (stableKey) {
        if (stableKey !== key) changed = true;
        mergeInto(stableKey, rawValue);
        return;
      }
    }
    if (key.startsWith(STABLE_PICK_RESULT_KEY_PREFIX)) {
      mergeInto(key, rawValue);
    } else {
      orphans[key] = rawValue;
    }
  });

  list.forEach((pick) => {
    const embedded = normalizeResultValue(pick && pick.result);
    if (embedded === 'pending') return;
    const stableKey = getStablePickKey(pick);
    if (stableKey) mergeInto(stableKey, embedded);
  });

  const out = {};
  migrated.forEach((entry, key) => {
    out[key] = entry.result;
  });
  Object.entries(orphans).forEach(([key, value]) => {
    out[key] = value;
  });
  return { results: out, changed };
}

function getResultForPickFromMap(pick, results) {
  const source = results && typeof results === 'object' ? results : {};
  const keys = getLegacyResultKeysForPick(pick);
  const suppressDecidedResults = pickStartsInFuture(pick);
  let sawPending = false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const result = normalizeResultEntry(source[key]).result;
    if (result !== 'pending') {
      if (!suppressDecidedResults) return result;
      sawPending = true;
      continue;
    }
    sawPending = true;
  }
  return sawPending ? 'pending' : normalizeResultValue(pick && pick.result);
}

function pruneResultAliasesForPick(results, pick, keepKey) {
  if (!results || typeof results !== 'object' || !pick) return results;
  getLegacyResultKeysForPick(pick).forEach((key) => {
    if (key && key !== keepKey && Object.prototype.hasOwnProperty.call(results, key)) {
      delete results[key];
    }
  });
  return results;
}

function clearResultAliasesForPicks(results, picks, keepKeyByPick) {
  if (!results || typeof results !== 'object') return false;
  let changed = false;
  (Array.isArray(picks) ? picks : []).forEach((pick) => {
    if (!pick) return;
    const keepKey = typeof keepKeyByPick === 'function' ? keepKeyByPick(pick) : '';
    getLegacyResultKeysForPick(pick).forEach((key) => {
      if (key && key !== keepKey && Object.prototype.hasOwnProperty.call(results, key)) {
        delete results[key];
        changed = true;
      }
    });
  });
  return changed;
}

function migrateLedgerStateToStablePickKeys(state) {
  const ledger = _coerceLedgerState(state);
  const allPicks = [...PICKS, ...ledger.addedPicks].filter((p) => (
    !isPickDeletedByTombstones(p, ledger.deletedPickIds, ledger.deletedPickKeys)
  ));
  const migrated = migrateResultsToStablePickKeys(ledger.results, allPicks);
  return {
    ...ledger,
    deletedPickKeys: ledger.deletedPickKeys,
    results: migrated.results,
    startTimes: ledger.startTimes,
    gameTimes: ledger.gameTimes,
  };
}

function migrateLocalResultKeysToStable(options = {}) {
  let rawResults = {};
  try {
    rawResults = JSON.parse(localStorage.getItem(RESULTS_KEY) || '{}');
  } catch {
    rawResults = {};
  }
  const migrated = migrateResultsToStablePickKeys(rawResults, getAllLedgerPicks());
  if (migrated.changed || options.force) {
    localStorage.setItem(RESULTS_KEY, JSON.stringify(migrated.results));
    if (options.dirty === false) null;
    else null;
    if (options.schedule !== false && typeof scheduleLedgerStateSync === 'function') null;
  }
  try {
    localStorage.setItem(STABLE_PICK_KEY_MIGRATION_KEY, '1');
  } catch {
    // The migration is idempotent; inability to set the marker is non-fatal.
  }
  return migrated;
}

function formatOddsDisplay(odds) {
  const num = normalizeOddsValue(odds);
  if (num == null) return '—';
  return `${num > 0 ? '+' : ''}${num}`;
}
function normalizeProbabilityValue(value) {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 && num <= 1 ? num : null;
}
function formatOddsOrProbabilityDisplay(odds, probability) {
  const oddsStr = formatOddsDisplay(odds);
  if (oddsStr !== '—') return oddsStr;
  const prob = normalizeProbabilityValue(probability);
  if (prob == null) return '—';
  return `${(prob * 100).toFixed(1)}%`;
}
function americanImpliedProb(odds) {
  const num = normalizeNumericValue(odds);
  if (num == null || num === 0) return null;
  if (num > 0) return 100 / (num + 100);
  return Math.abs(num) / (Math.abs(num) + 100);
}
function quarterKellyPct(odds, probability, maxPct = 5) {
  const price = normalizeNumericValue(odds);
  const prob = normalizeProbabilityValue(probability);
  if (price == null || prob == null || prob <= 0 || prob >= 1) return null;
  const decimalNet = price > 0 ? price / 100 : 100 / Math.abs(price);
  if (!(decimalNet > 0)) return null;
  const fullKellyFrac = (decimalNet * prob - (1 - prob)) / decimalNet;
  if (!(fullKellyFrac > 0)) return 0;
  return Math.min(fullKellyFrac * 0.25 * 100, maxPct);
}
function isProjectedTotalPick(pickText) {
  const text = String(pickText || '').trim().toLowerCase();
  return text.startsWith('projected total') || text.startsWith('o/u ') || text.startsWith('over ') || text.startsWith('under ');
}
function modelResultsFallbackOdds(pick) {
  if (!pick) return null;
  if (normalizeNumericValue(pick.odds) != null) return normalizeNumericValue(pick.odds);
  if (normalizeNumericValue(pick.assumed_odds) != null) return normalizeNumericValue(pick.assumed_odds);
  if (!['NBA', 'MLB'].includes(String(pick.sport || '').toUpperCase())) return null;
  const prob = normalizeProbabilityValue(pick.probability);
  if (prob != null || normalizeNumericValue(pick && (pick.market_edge != null ? pick.market_edge : pick.edge)) != null) return -110;
  return null;
}
function modelResultsEdgeValue(pick) {
  const explicit = normalizeNumericValue(pick && (pick.market_edge != null ? pick.market_edge : pick.edge));
  if (explicit != null) return explicit;
  const odds = modelResultsFallbackOdds(pick);
  const prob = normalizeProbabilityValue(pick && pick.probability);
  const implied = americanImpliedProb(odds);
  if (prob == null || implied == null) return null;
  return (prob - implied) * 100;
}
const MODEL_RESULTS_BET_EDGE_PCT = 5;
const MODEL_RESULTS_LEAN_EDGE_PCT = 3;
function modelResultsDerivedProbability(pick) {
  const explicit = normalizeProbabilityValue(pick && (pick.prob ?? pick.probability));
  if (explicit != null) return explicit;
  if (pick && pick.model_prediction != null) return null;
  const edge = modelResultsEdgeValue(pick);
  const implied = americanImpliedProb(modelResultsFallbackOdds(pick));
  if (edge == null || implied == null) return null;
  const derived = implied + (edge / 100);
  if (!Number.isFinite(derived)) return null;
  return Math.max(0, Math.min(1, derived));
}
function modelResultsVerdict(pick) {
  const explicit = String(pick && pick.kelly_edge && pick.kelly_edge.verdict || '').toUpperCase();
  if (explicit) return explicit;
  const explicitDecision = String(pick && pick.decision || '').toUpperCase();
  if (pick && pick.model_prediction != null && explicitDecision) return explicitDecision;
  const edge = modelResultsEdgeValue(pick);
  if (edge == null) return String(pick && pick.decision || 'PASS').toUpperCase();
  if (edge >= MODEL_RESULTS_BET_EDGE_PCT) return 'BET';
  if (edge >= MODEL_RESULTS_LEAN_EDGE_PCT) return 'LEAN';
  if (edge <= -MODEL_RESULTS_BET_EDGE_PCT) return 'FADE';
  return 'PASS';
}
function modelResultsVerdictLabel(verdict) {
  return {
    BET: 'BET',
    LEAN: 'LEAN',
    PASS: 'PASS',
    FADE: 'FADE',
    NO_LINE: 'NO LINE',
    ERROR: 'ERROR',
    NO_MODEL_SPREAD: 'NO SPREAD',
  }[String(verdict || '').toUpperCase()] || String(verdict || 'PASS').toUpperCase();
}
function modelResultsMatchupLabel(pick) {
  if (!pick) return '';
  const explicit = String(pick.matchup || pick.game || '').replace(/\s*@\s*/g, ' vs ').trim();
  const away = String(pick.away_team || '').trim();
  const home = String(pick.home_team || '').trim();
  const label = explicit || (away && home ? `${away} vs ${home}` : '');
  if (!label) return '';
  const pickText = String(pick.pick || '').trim().toLowerCase();
  if (pickText && pickText.includes(label.toLowerCase())) return '';
  return label;
}
function modelResultsPickMatchesKellySide(pick) {
  const ke = pick && pick.kelly_edge;
  if (!ke || !ke.bet_side) return true;
  const team = String(pick.team || '').trim();
  const home = String(pick.home_team || '').trim();
  const away = String(pick.away_team || '').trim();
  const side = String(ke.bet_side || '').toUpperCase();
  if (!team || !home || !away) return true;
  if (side.includes('HOME')) return team === home;
  if (side.includes('AWAY')) return team === away;
  return true;
}
function modelResultsKellyValue(pick) {
  const verdict = modelResultsVerdict(pick);
  if (!['BET', 'LEAN'].includes(verdict)) return null;
  const explicitKelly = normalizeNumericValue(pick && (pick.kelly ?? pick.kelly_pct ?? (pick.kelly_edge && pick.kelly_edge.kelly_frac_pct)));
  if (explicitKelly != null && explicitKelly > 0 && modelResultsPickMatchesKellySide(pick)) {
    return explicitKelly;
  }
  if (pick && pick.model_prediction != null) return null;
  const explicitOdds = normalizeNumericValue(pick && pick.odds);
  const explicitUnits = normalizeNumericValue(pick && pick.units);
  if (explicitOdds != null && explicitUnits != null && explicitUnits > 0 && verdict === 'BET') {
    return explicitUnits;
  }
  const fallbackKelly = quarterKellyPct(modelResultsFallbackOdds(pick), modelResultsDerivedProbability(pick));
  if (fallbackKelly == null || fallbackKelly <= 0) return null;
  return fallbackKelly;
}
function formatModelResultsLineValue(lineValue, useSign = false) {
  const line = normalizeNumericValue(lineValue);
  if (line == null) return '—';
  const formatted = Number.isInteger(line) ? line.toFixed(0) : line.toFixed(1);
  return useSign && line > 0 ? `+${formatted}` : formatted;
}
function modelResultsVegasDisplay(pick) {
  const kellySpread = normalizeNumericValue(pick && pick.kelly_edge && pick.kelly_edge.vegas_spread);
  if (kellySpread != null) return formatModelResultsLineValue(kellySpread, true);
  const marketLine = normalizeNumericValue(pick && (pick.market_line != null ? pick.market_line : pick.line));
  if (marketLine != null) return formatModelResultsLineValue(marketLine, !isProjectedTotalPick(pick && pick.pick));
  const totalMatch = String(pick && pick.pick || '').match(/(?:^|\s)(?:O\/U|Over|Under)\s+([0-9]+(?:\.[0-9]+)?)/i);
  if (totalMatch) return formatModelResultsLineValue(totalMatch[1], false);
  const odds = modelResultsFallbackOdds(pick);
  if (odds != null) return formatOddsDisplay(odds);
  return '—';
}
function formatKellyDisplay(units, decision) {
  const num = normalizeNumericValue(units);
  if (String(decision || '').toUpperCase() !== 'BET') return '—';
  if (num == null || num <= 0) return '—';
  return `${num.toFixed(2)}%`;
}
function modelResultsKellyDisplay(pick) {
  const kelly = modelResultsKellyValue(pick);
  if (kelly == null || kelly <= 0) return '—';
  return `${kelly.toFixed(2)}%`;
}
function getResults() {
  return getDataResults();
}

function setResult() {
  console.log('setResult removed');
}

function setResultFromAutoGrade() {
  console.log('setResultFromAutoGrade removed');
}

function missingStartTimesCount() {
  const supported = new Set(['NBA', 'NHL', 'MLB', 'EPL', 'WBC']);
  const times = getGameTimes();
  return getPicks().filter(p => p.result === 'pending' && supported.has(p.sport) && !times[String(p.id)]).length;
}

function getLocalDateKey(dt) {
  if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return '';
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getLocalMonthKey(dt) {
  if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return '';
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

function parseLocalDateKey(key) {
  const match = String(key || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const dt = new Date(year, month, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== month || dt.getDate() !== day) return null;
  return dt;
}

function parseLocalMonthKey(key) {
  const match = String(key || '').trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const dt = new Date(year, month, 1);
  if (dt.getFullYear() !== year || dt.getMonth() !== month) return null;
  return dt;
}

function parsePickDateLabel(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const raw = String(value || '').trim();
  if (!raw) return null;

  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const dt = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (slashMatch) {
    let year = slashMatch[3] ? Number(slashMatch[3]) : new Date().getFullYear();
    if (year < 100) year += 2000;
    const dt = new Date(year, Number(slashMatch[1]) - 1, Number(slashMatch[2]));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  const currentYear = new Date().getFullYear();
  const candidates = [`${raw} ${currentYear}`, `${raw}, ${currentYear}`, raw];
  for (const candidate of candidates) {
    const dt = new Date(candidate);
    if (!Number.isNaN(dt.getTime())) {
      return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    }
  }
  return null;
}

function getTodayDateKey() {
  const now = new Date();
  return getLocalDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
}

function formatHomeDateKey(key, options = { month: 'short', day: 'numeric' }) {
  const dt = parseLocalDateKey(key);
  return dt ? dt.toLocaleDateString('en-US', options) : '';
}

function formatHomeMonthKey(key) {
  const dt = parseLocalMonthKey(key);
  return dt ? dt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '';
}

function getPickDateKey(value) {
  const dt = parsePickDateLabel(value);
  return dt ? getLocalDateKey(dt) : '';
}

function hasCurrentDeploymentLedgerResetRun() {
  try {
    return localStorage.getItem(FORCED_LEDGER_RESET_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function markCurrentDeploymentLedgerResetRun() {
  try {
    localStorage.setItem(FORCED_LEDGER_RESET_STORAGE_KEY, '1');
  } catch {
    // If storage is blocked, the reset is still safe and idempotent.
  }
}

function resetLedgerStateForDateKeys(state, dateKeys) {
  const targets = new Set((Array.isArray(dateKeys) ? dateKeys : [])
    .map(key => String(key || '').trim())
    .filter(Boolean));
  const ledger = _coerceLedgerState(state);
  if (!targets.size) return { state: ledger, changed: false, removedCount: 0 };

  const removedPicks = [];
  const keptPicks = [];
  ledger.addedPicks.forEach((pick) => {
    const key = getPickDateKey(pick && (pick.date || pick.game_date || pick.Date));
    if (targets.has(key)) removedPicks.push(pick);
    else keptPicks.push(pick);
  });

  const results = { ...(ledger.results || {}) };
  const aliasesChanged = clearResultAliasesForPicks(results, removedPicks);
  const removedIds = new Set(removedPicks.map(p => String(p && p.id)).filter(Boolean));
  const gameTimes = { ...(ledger.gameTimes || ledger.startTimes || {}) };
  let timesChanged = false;
  removedIds.forEach((id) => {
    if (Object.prototype.hasOwnProperty.call(gameTimes, id)) {
      delete gameTimes[id];
      timesChanged = true;
    }
  });
  const deletedPickIds = ledger.deletedPickIds.filter(id => !removedIds.has(String(id)));
  const tombstonesChanged = deletedPickIds.length !== ledger.deletedPickIds.length;
  const removedKeys = new Set(removedPicks.map(p => getStablePickKey(p)).filter(Boolean));
  const deletedPickKeys = ledger.deletedPickKeys.filter(key => !removedKeys.has(String(key)));
  const keyTombstonesChanged = deletedPickKeys.length !== ledger.deletedPickKeys.length;
  const changed = removedPicks.length > 0 || aliasesChanged || timesChanged || tombstonesChanged || keyTombstonesChanged;

  return {
    state: {
      ...ledger,
      addedPicks: keptPicks,
      deletedPickIds,
      deletedPickKeys,
      results,
      startTimes: gameTimes,
      gameTimes,
      savedAt: changed ? new Date().toISOString() : ledger.savedAt,
    },
    changed,
    removedCount: removedPicks.length,
  };
}

function resetLedgerStateForCurrentDeployment(state) {
  currentDeploymentLedgerResetChanged = false;
  if (hasCurrentDeploymentLedgerResetRun()) {
    return { state: _coerceLedgerState(state), changed: false, removedCount: 0 };
  }
  const reset = resetLedgerStateForDateKeys(state, FORCED_LEDGER_RESET_DATE_KEYS);
  markCurrentDeploymentLedgerResetRun();
  currentDeploymentLedgerResetChanged = reset.changed;
  if (reset.changed) {
    console.log(`[LedgerReset] Removed ${reset.removedCount} pick(s) for ${FORCED_LEDGER_RESET_DATE_KEYS.join(', ')}`);
  }
  return reset;
}

function consumeCurrentDeploymentLedgerResetChanged() {
  const changed = currentDeploymentLedgerResetChanged;
  currentDeploymentLedgerResetChanged = false;
  return changed;
}

window.resetLedgerStateForCurrentDeployment = resetLedgerStateForCurrentDeployment;
window.consumeCurrentDeploymentLedgerResetChanged = consumeCurrentDeploymentLedgerResetChanged;

function buildHomeDateEntries(list) {
  const counts = new Map();
  (Array.isArray(list) ? list : []).forEach((pick) => {
    const key = getPickDateKey(pick && (pick.date || pick.game_date || pick.Date));
    if (!key) return;
    const next = counts.get(key) || { key, count: 0 };
    next.count += 1;
    counts.set(key, next);
  });
  return [...counts.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function persistHomeSelectedDate() {
  try {
    localStorage.setItem(HOME_DATE_STORAGE_KEY, homeSelectedDateKey);
  } catch {
    // Ignore storage failures; the in-memory selection is enough.
  }
}

function ensureHomeSelectedDate(list) {
  const entries = buildHomeDateEntries(list);
  const availableKeys = entries.map((entry) => entry.key);
  const todayKey = getTodayDateKey();
  let resetSelection = false;
  if (homeDateFocusKey && availableKeys.includes(homeDateFocusKey)) {
    homeSelectedDateKey = homeDateFocusKey;
    homeDateFocusKey = '';
    persistHomeSelectedDate();
    resetSelection = true;
  } else if (!parseLocalDateKey(homeSelectedDateKey) || (availableKeys.length && !availableKeys.includes(homeSelectedDateKey))) {
    homeSelectedDateKey = availableKeys.includes(todayKey)
      ? todayKey
      : (availableKeys[availableKeys.length - 1] || todayKey);
    persistHomeSelectedDate();
    resetSelection = true;
  } else if (homeDateFocusKey) {
    homeDateFocusKey = '';
  }
  const selectedDate = parseLocalDateKey(homeSelectedDateKey) || parseLocalDateKey(todayKey) || new Date();
  if (resetSelection || !parseLocalMonthKey(homeCalendarMonthKey)) {
    homeCalendarMonthKey = getLocalMonthKey(selectedDate);
  }
  return { entries, availableKeys, todayKey };
}

function requestHomeDateFocusForPicks(picks) {
  const keys = [];
  (Array.isArray(picks) ? picks : []).forEach((pick) => {
    const key = getPickDateKey(pick && (pick.date || pick.game_date || pick.Date));
    if (key && !keys.includes(key)) keys.push(key);
  });
  if (!keys.length) return;
  const todayKey = getTodayDateKey();
  homeDateFocusKey = keys.includes(todayKey) ? todayKey : keys[keys.length - 1];
  const selectedDate = parseLocalDateKey(homeDateFocusKey);
  if (selectedDate) homeCalendarMonthKey = getLocalMonthKey(selectedDate);
}
window.requestHomeDateFocusForPicks = requestHomeDateFocusForPicks;

function syncHomeDatePickerVisibility() {
  const trigger = document.getElementById('home-date-trigger');
  const popover = document.getElementById('home-date-popover');
  if (trigger) {
    trigger.classList.toggle('is-open', homeCalendarOpen);
    trigger.setAttribute('aria-expanded', homeCalendarOpen ? 'true' : 'false');
  }
  if (popover) popover.classList.toggle('open', homeCalendarOpen);
}

function closeHomeDatePicker() {
  if (!homeCalendarOpen) return;
  homeCalendarOpen = false;
  syncHomeDatePickerVisibility();
}

function toggleHomeDatePicker(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  closeMoreFilters();
  homeCalendarOpen = !homeCalendarOpen;
  syncHomeDatePickerVisibility();
}

function shiftHomeCalendarMonth(delta, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const baseMonth = parseLocalMonthKey(homeCalendarMonthKey)
    || parseLocalDateKey(homeSelectedDateKey)
    || parseLocalDateKey(getTodayDateKey())
    || new Date();
  const nextMonth = new Date(baseMonth.getFullYear(), baseMonth.getMonth() + Number(delta || 0), 1);
  homeCalendarMonthKey = getLocalMonthKey(nextMonth);
  homeCalendarOpen = true;
  render();
}

function setHomeSelectedDateFromKey(key) {
  const dt = parseLocalDateKey(key);
  if (!dt) return;
  homeSelectedDateKey = getLocalDateKey(dt);
  homeCalendarMonthKey = getLocalMonthKey(dt);
  homeCalendarOpen = false;
  persistHomeSelectedDate();
  render();
  // Switching the board date also re-runs the schedule fetch for that day
  // so the Next Start tile and card times reflect the newly selected slate.
  if (typeof syncStartTimesForBoardDate === 'function') {
    syncStartTimesForBoardDate(homeSelectedDateKey).then((result) => {
      if (result && result.ran && result.synced > 0) render();
    }).catch(() => {});
  }
}

function setHomeSelectedDateFromEl(el) {
  const key = String(el && el.getAttribute('data-date-key') || '').trim();
  if (!key) return;
  setHomeSelectedDateFromKey(key);
}

function buildHomeCalendarPopoverHtml({ selectedDateKey, monthKey, todayKey, dateCounts, latestDateKey, modeLabel }) {
  const selectedDate = parseLocalDateKey(selectedDateKey) || parseLocalDateKey(todayKey) || new Date();
  const viewMonth = parseLocalMonthKey(monthKey) || new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  const monthStart = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const gridStart = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 - monthStart.getDay());
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const selectedCount = Number(dateCounts.get(selectedDateKey) || 0);
  const selectedLabel = formatHomeDateKey(selectedDateKey, { month: 'long', day: 'numeric' }) || formatTodayPickDateLabel();
  const pickWord = selectedCount === 1 ? 'pick' : 'picks';
  const quickButtons = [
    `<button type="button" class="home-date-quick-btn ${selectedDateKey === todayKey ? 'active' : ''}" onclick="setHomeSelectedDateFromKey('${todayKey}')">Today</button>`,
  ];
  if (latestDateKey) {
    quickButtons.push(
      `<button type="button" class="home-date-quick-btn ${selectedDateKey === latestDateKey ? 'active' : ''}" onclick="setHomeSelectedDateFromKey('${latestDateKey}')">Latest Slate</button>`
    );
  }

  const dayButtons = [];
  for (let index = 0; index < 42; index += 1) {
    const day = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
    const key = getLocalDateKey(day);
    const count = Number(dateCounts.get(key) || 0);
    const classes = ['home-calendar-day'];
    if (day.getMonth() !== monthStart.getMonth()) classes.push('is-outside');
    if (key === todayKey) classes.push('is-today');
    if (count > 0) classes.push('has-picks');
    if (key === selectedDateKey) classes.push('is-selected');
    const dayLabel = formatHomeDateKey(key, { month: 'long', day: 'numeric' });
    const title = count > 0
      ? `${dayLabel} · ${count} ${modeLabel} ${count === 1 ? 'pick' : 'picks'}`
      : `${dayLabel} · No ${modeLabel} picks`;
    dayButtons.push(`
      <button
        type="button"
        class="${classes.join(' ')}"
        data-date-key="${key}"
        onclick="setHomeSelectedDateFromEl(this)"
        title="${_dailyEscape(title)}"
      >
        <span class="home-calendar-day-num">${day.getDate()}</span>
        <span class="home-calendar-day-count">${count > 0 ? count : '&middot;'}</span>
      </button>
    `);
  }

  return `
    <div class="home-date-popover-top">
      <div class="home-date-popover-copy">
        <div class="home-date-popover-label">Calendar View</div>
        <div class="home-date-popover-month">${_dailyEscape(formatHomeMonthKey(getLocalMonthKey(monthStart)))}</div>
      </div>
      <div class="home-date-nav-wrap">
        <button type="button" class="home-date-nav" onclick="shiftHomeCalendarMonth(-1, event)" aria-label="Previous month">&#8249;</button>
        <button type="button" class="home-date-nav" onclick="shiftHomeCalendarMonth(1, event)" aria-label="Next month">&#8250;</button>
      </div>
    </div>
    <div class="home-date-quick">${quickButtons.join('')}</div>
    <div class="home-date-weekdays">
      ${weekdays.map((weekday) => `<div class="home-date-weekday">${weekday}</div>`).join('')}
    </div>
    <div class="home-calendar-grid">${dayButtons.join('')}</div>
    <div class="home-date-popover-foot">
      ${selectedCount > 0
        ? `${selectedCount} ${modeLabel} ${pickWord} on ${_dailyEscape(selectedLabel)}.`
        : `No ${modeLabel} picks on ${_dailyEscape(selectedLabel)} in the current view.`}
    </div>
  `;
}

try {
  const storedHomeDateKey = localStorage.getItem(HOME_DATE_STORAGE_KEY) || '';
  if (parseLocalDateKey(storedHomeDateKey)) {
    homeSelectedDateKey = storedHomeDateKey;
    homeCalendarMonthKey = getLocalMonthKey(parseLocalDateKey(storedHomeDateKey));
  }
  homeResultMode = normalizeHomeResultMode(localStorage.getItem(HOME_MODE_STORAGE_KEY) || homeResultMode);
  showSettled = homeResultMode === 'settled';
} catch {
  // Ignore storage access issues and fall back to today.
}

function isTodayPickDateLabel(d) {
  return getPickDateKey(d) === getTodayDateKey();
}

function formatTodayPickDateLabel() {
  return formatHomeDateKey(getTodayDateKey());
}

function formatStartLabel(iso) {
  if (!iso) return 'TBD';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return 'TBD';
  return dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function getGameKeyForPick(p) {
  const label = deriveGameLabel(p, getPicks());
  return label || `${p.sport}::${p.date}::${p.id}`;
}

function formatSourceRecordLine(label, picks) {
  const wins = picks.filter(p => p.result === 'win').length;
  const losses = picks.filter(p => p.result === 'loss').length;
  const pushes = picks.filter(p => p.result === 'push').length;
  const netUnits = picks.reduce((sum, p) => sum + p.pl, 0);
  const record = pushes > 0 ? `${wins}-${losses}-${pushes}` : `${wins}-${losses}`;
  return { label, text: `${record} | ${netUnits >= 0 ? '+' : ''}${netUnits}u` };
}

function getSourcePastRecordLines(source, picks = getPicks()) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);

  const lastWeekStart = new Date(todayStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  const sourcePicks = (Array.isArray(picks) ? picks : getPicks())
    .filter(p => getRankingSourceKey(p) === source && p.result !== 'pending')
    .map(p => ({ ...p, parsedDate: parsePickDateLabel(p.date) }));

  const todayPicks = sourcePicks.filter(p => p.parsedDate && p.parsedDate >= todayStart && p.parsedDate < tomorrowStart);
  const yesterdayPicks = sourcePicks.filter(p => p.parsedDate && p.parsedDate >= yesterdayStart && p.parsedDate < todayStart);
  const lastWeekPicks = sourcePicks.filter(p => p.parsedDate && p.parsedDate >= lastWeekStart && p.parsedDate < todayStart);

  return [
    formatSourceRecordLine('TODAY', todayPicks),
    formatSourceRecordLine('YESTERDAY', yesterdayPicks),
    formatSourceRecordLine('LAST WEEK', lastWeekPicks),
    formatSourceRecordLine('OVERALL', sourcePicks),
  ];
}

function jumpToSource(source) {
  activeFilter = source;
  switchTab('home');
  render();
}

function setActiveFilterFromEl(el) {
  const nextFilter = String(el && el.getAttribute('data-filter') || 'ALL');
  activeFilter = nextFilter;
  closeMoreFilters();
  render();
}

function getPicks() {
  return PICKS;
}

function isIplPick(p) {
  return String(p && p.sport || '').trim().toUpperCase() === 'IPL';
}

function getSportBadgeText(sport) {
  return String(sport || '').toUpperCase() === 'IPL' ? '🏏 IPL' : String(sport || 'OTHER').toUpperCase();
}

function renderPickResultControl(p) {
  return `<select class="result-select" onchange="setResult(${p.id},this.value)">
    <option value="pending" ${p.result==='pending'?'selected':''}>PENDING</option>
    <option value="win" ${p.result==='win'?'selected':''}>WIN</option>
    <option value="loss" ${p.result==='loss'?'selected':''}>LOSS</option>
    <option value="push" ${p.result==='push'?'selected':''}>PUSH</option>
    <option value="delete">DELETE</option></select>`;
}

const iplPredictionAddedKeys = new Set();
const iplPredictionPendingKeys = new Set();

function _buildIplWinnerLedgerPick(data) {
  const dateLabel = formatTodayPickDateLabel();
  const team1 = String(data && data.team1 || '').trim();
  const team2 = String(data && data.team2 || '').trim();
  const predictedWinner = String(
    data && (data.predicted_winner || data.winner || data.prediction?.winner || team1 || team2)
  ).trim();
  const winnerProbRaw = predictedWinner === team2 ? Number(data && data.team2_win_prob) : Number(data && data.team1_win_prob);
  const probability = Number.isFinite(winnerProbRaw)
    ? (winnerProbRaw > 1 ? winnerProbRaw / 100 : winnerProbRaw)
    : null;
  return {
    sport: 'IPL',
    source: 'IPL Model',
    pick: `WINNER: ${predictedWinner}`,
    date: dateLabel,
    units: 1,
    odds: null,
    result: 'pending',
    notes: 'IPL Winner',
    start_time: null,
    game: String(data && (data.match_label || data.match || data.fixture || '')).trim(),
    team1,
    team2,
    team: predictedWinner,
    confidence: probability == null ? null : Math.round(probability * 100),
    probability,
  };
}

function _buildIplFantasyLedgerPick(data, index) {
  const players = Array.isArray(data && data.selected_players) ? data.selected_players : [];
  const player = players[index];
  if (!player) return null;
  const dateLabel = formatTodayPickDateLabel();
  const playerName = String(player.player_name || player.name || player.player || `Player ${index + 1}`).trim();
  const role = String(player.role || player.position || '').trim();
  const team = String(player.team || player.franchise || player.squad || '').trim();
  const fantasyPct = Number(player.fantasy_probability_pct ?? player.probability ?? player.confidence);
  const safePct = Number.isFinite(fantasyPct) ? fantasyPct : 0;
  const decision = String(player.decision || player.pick_decision || (player.is_bet ? 'BET' : 'PASS') || 'PASS').trim().toUpperCase();
  return {
    sport: 'IPL',
    source: 'IPL Model',
    pick: `FANTASY: ${playerName} | ${role} | ${team} | ${safePct.toFixed(1)}% ${decision}`,
    date: dateLabel,
    units: 1,
    odds: null,
    result: 'pending',
    notes: 'IPL Fantasy',
    start_time: null,
    game: String(data && (data.match_label || data.match || data.fixture || '')).trim(),
    player_name: playerName,
    role,
    team,
    probability: safePct > 0 ? safePct / 100 : null,
    confidence: Math.round(safePct),
  };
}

function _getIplActionKey(type, value) {
  return `${type}:${String(value || '').trim()}`;
}

function _isIplActionLocked(actionKey, pick) {
  if (!pick) return true;
  return iplPredictionPendingKeys.has(actionKey) || iplPredictionAddedKeys.has(actionKey) || isExactLedgerDuplicate(pick);
}

function _appendIplPickToLedger(actionKey, pick) {
  if (!pick) return false;
  const key = String(actionKey || '').trim();
  if (!key) return false;
  if (iplPredictionPendingKeys.has(key) || iplPredictionAddedKeys.has(key) || isExactLedgerDuplicate(pick)) {
    iplPredictionAddedKeys.add(key);
    if (pendingIplPrediction && typeof renderIPLPrediction === 'function') {
      renderIPLPrediction(pendingIplPrediction);
    }
    return false;
  }

  iplPredictionPendingKeys.add(key);
  try {
    const { added } = _appendModelPicksToLedger([pick]);
    if (added > 0) {
      iplPredictionAddedKeys.add(key);
    }
    render();
    if (document.getElementById('tab-search').classList.contains('active')) {
      renderSearch();
    }
    if (pendingIplPrediction && typeof renderIPLPrediction === 'function') {
      renderIPLPrediction(pendingIplPrediction);
    }
    return added > 0;
  } finally {
    iplPredictionPendingKeys.delete(key);
  }
}

function getIplWinnerActionState(data) {
  const pick = _buildIplWinnerLedgerPick(data);
  const actionKey = _getIplActionKey('winner', `${pick.game || ''}::${pick.pick}`);
  const locked = _isIplActionLocked(actionKey, pick);
  return { actionKey, pick, locked };
}

function getIplFantasyActionState(data, index) {
  const pick = _buildIplFantasyLedgerPick(data, index);
  if (!pick) return { actionKey: '', pick: null, locked: true };
  const actionKey = _getIplActionKey('fantasy', `${pick.game || ''}::${index}:${pick.pick}`);
  const locked = _isIplActionLocked(actionKey, pick);
  return { actionKey, pick, locked };
}

function addIplWinnerPick() {
  if (!pendingIplPrediction) return;
  const state = getIplWinnerActionState(pendingIplPrediction);
  _appendIplPickToLedger(state.actionKey, state.pick);
}

function addIplFantasyPick(index) {
  if (!pendingIplPrediction) return;
  const state = getIplFantasyActionState(pendingIplPrediction, index);
  if (!state.pick) return;
  _appendIplPickToLedger(state.actionKey, state.pick);
}

function isExactLedgerDuplicate(candidate) {
  const candidateGame = String(candidate && candidate.game || '').trim().toLowerCase();
  return getAllLedgerPicks().some((existing) => (
    String(existing.sport || '').toUpperCase() === String(candidate.sport || '').toUpperCase() &&
    String(existing.source || '') === String(candidate.source || '') &&
    String(existing.date || '') === String(candidate.date || '') &&
    String(existing.pick || '') === String(candidate.pick || '') &&
    (() => {
      const existingGame = String(existing.game || '').trim().toLowerCase();
      if (!existingGame || !candidateGame) return true;
      return existingGame === candidateGame;
    })()
  ));
}

function getRankingSourceKey(p) {
  return p.source;
}

const REMOVED_RANKING_SOURCE_KEYS = new Set(['scores' + '24']);

function getRankingEligiblePicks(picks) {
  return (Array.isArray(picks) ? picks : []).filter((pick) => {
    const sourceKey = String(getRankingSourceKey(pick) || '').trim().toLowerCase();
    return !REMOVED_RANKING_SOURCE_KEYS.has(sourceKey);
  });
}

function getSourceStats(source, picks = getRankingsPicks()) {
  const all=Array.isArray(picks) ? picks : getPicks(), allSp=all.filter(p=>getRankingSourceKey(p)===source);
  if(!allSp.length) return null;
  const sp=allSp.filter(p=>p.result!=='pending');
  const w=sp.filter(p=>p.result==='win').length, l=sp.filter(p=>p.result==='loss').length;
  const pu=sp.filter(p=>p.result==='push').length, pe=allSp.filter(p=>p.result==='pending').length;
  const d=w+l, acc=d>0?w/d:0;
  const nu=sp.reduce((s,p)=>s+p.pl,0), tw=sp.reduce((s,p)=>s+(p.result!=='push'?p.units:0),0);
  const roi=tw>0?nu/tw:0;
  if(!sp.length) return {source,count:allSp.length,wins:0,losses:0,pushes:0,pending:pe,acc:0,roi:0,netUnits:0,accScore:0,roiScore:50,consistencyScore:100,composite:0,eligible:false};
  const mean=nu/sp.length, variance=sp.reduce((s,p)=>s+Math.pow(p.pl-mean,2),0)/sp.length;
  const consistency=Math.max(0,1-Math.sqrt(variance)/3);
  const aS=acc*100, rS=Math.min(100,Math.max(0,roi*100+50)), cS=consistency*100;
  return {source,count:allSp.length,wins:w,losses:l,pushes:pu,pending:pe,acc,roi,netUnits:nu,accScore:aS,roiScore:rS,consistencyScore:cS,composite:parseFloat(((aS*0.4)+(rS*0.4)+(cS*0.2)).toFixed(1)),eligible:sp.length>=3};
}
function getColor(s) { return s>=65?'var(--win)':s>=45?'var(--push)':'var(--loss)'; }

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const MONTH_ABBREV_TO_INDEX = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};
let dayOfWeekChartFrame = 0;

function normalizeDayOfWeekDateString(dateStr) {
  const raw = String(dateStr || '').trim();
  if (!raw) return '';
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(raw)) {
    const parts = raw.split(/[-\\/]/);
    return `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`;
  }
  const monthDayMatch = raw.match(/^([A-Za-z]{3,9})\s+(\d{1,2})(?:,\s*(\d{4}))?$/);
  if (!monthDayMatch) return '';
  const monthKey = monthDayMatch[1].slice(0, 3).toLowerCase();
  const month = MONTH_ABBREV_TO_INDEX[monthKey];
  if (!month) return '';
  const day = String(parseInt(monthDayMatch[2], 10)).padStart(2, '0');
  const year = String(parseInt(monthDayMatch[3] || new Date().getFullYear(), 10));
  return `${year}-${month}-${day}`;
}

function safeDayOfWeek(dateStr) {
  if (!dateStr) return -1;
  const parts = String(dateStr).split(/[-\/]/);
  if (parts.length < 3) return -1;
  const year  = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day   = parseInt(parts[2], 10);
  const d = new Date(year, month, day, 12, 0, 0);
  return isNaN(d.getTime()) ? -1 : d.getDay();
  // Returns: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
}

function createDayOfWeekStatsBucket() {
  return { totalPicks: 0, wins: 0, losses: 0, pushes: 0 };
}

function addPickToDayOfWeekStats(bucket, pick) {
  if (!bucket || !pick) return;
  const result = String(pick.result || pick.Result || '').trim().toUpperCase();
  if (result === 'PENDING' || !result) return;
  bucket.totalPicks += 1;
  if (result === 'W' || result === 'WIN') bucket.wins += 1;
  else if (result === 'L' || result === 'LOSS') bucket.losses += 1;
  else if (result === 'PUSH') bucket.pushes += 1;
}

function getDayOfWeekWinRate(stats) {
  if (!stats) return null;
  const graded = stats.wins + stats.losses;
  return graded > 0 ? (stats.wins / graded) * 100 : null;
}

function getDayOfWeekPalette(rate) {
  if (rate == null) return { text: '#666', fill: 'rgba(255,255,255,0.12)' };
  if (rate >= 55) return { text: '#00ff88', fill: 'linear-gradient(90deg, #00ff88, #00e5a0)' };
  if (rate >= 50) return { text: '#ffc800', fill: 'linear-gradient(90deg, #ffd84d, #ffc800)' };
  return { text: '#ff5050', fill: 'linear-gradient(90deg, #ff8a80, #ff5050)' };
}

function getDayOfWeekCellClass(stats) {
  const rate = getDayOfWeekWinRate(stats);
  if (!stats || stats.totalPicks < 3 || rate == null) return 'dow-cell-gray';
  if (rate >= 55) return 'dow-cell-green';
  if (rate >= 50) return 'dow-cell-yellow';
  return 'dow-cell-red';
}

function formatDayOfWeekRate(rate, digits = 1) {
  return rate == null ? '—' : `${rate.toFixed(digits)}%`;
}

function escapeDayOfWeekHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildDayOfWeekChart() {
  const heatmap = document.getElementById('dow-overall-heatmap');
  const breakdown = document.getElementById('dow-model-breakdown');
  if (!heatmap || !breakdown) return;

  const allPicks = getRankingsPicks();
  if (!allPicks.length) {
    heatmap.innerHTML = '<div class="empty-state">No decided picks yet</div>';
    breakdown.innerHTML = '';
    return;
  }

  const overallByDay = DAY_LABELS.map(() => createDayOfWeekStatsBucket());
  const sportDayStats = {
    NBA: DAY_LABELS.map(() => createDayOfWeekStatsBucket()),
    MLB: DAY_LABELS.map(() => createDayOfWeekStatsBucket()),
  };
  const sourceByDay = new Map();

  allPicks.forEach((pick) => {
    const normalizedDate = normalizeDayOfWeekDateString(pick.date || pick.game_date || pick.Date);
    const dayIndex = safeDayOfWeek(normalizedDate);
    if (dayIndex === -1 || !overallByDay[dayIndex]) return;

    const result = String(pick.result || pick.Result || '').trim().toUpperCase();
    if (result !== 'W' && result !== 'WIN' && result !== 'L' && result !== 'LOSS') return;

    addPickToDayOfWeekStats(overallByDay[dayIndex], pick);
    const sportKey = String(pick.sport || '').trim().toUpperCase();
    if (sportDayStats[sportKey]) {
      addPickToDayOfWeekStats(sportDayStats[sportKey][dayIndex], pick);
    }

    const sourceKey = getRankingSourceKey(pick);
    if (!sourceByDay.has(sourceKey)) {
      sourceByDay.set(sourceKey, DAY_LABELS.map(() => createDayOfWeekStatsBucket()));
    }
    addPickToDayOfWeekStats(sourceByDay.get(sourceKey)[dayIndex], pick);
  });

  const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
  const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const getDowDisplay = (wins, losses, sportLabel = '') => {
    const totalPicks = wins + losses;
    if (totalPicks < 5) {
      return { color: '#555', verdictLabel: 'NO DATA', rateText: '—', barWidth: 0, tone: 'nodata' };
    }

    const winRate = totalPicks > 0 ? (wins / totalPicks) * 100 : 0;
    if (winRate >= 62) return { color: '#00e676', verdictLabel: `🔥 BET HEAVY${sportLabel ? ' ' + sportLabel : ''}`, rateText: `${winRate.toFixed(1)}%`, barWidth: winRate, tone: 'good' };
    if (winRate >= 55) return { color: '#00cfc2', verdictLabel: `✓ GOOD${sportLabel ? ' ' + sportLabel : ''}`, rateText: `${winRate.toFixed(1)}%`, barWidth: winRate, tone: 'good' };
    if (winRate >= 50) return { color: '#ffc107', verdictLabel: `~ CAUTION${sportLabel ? ' ' + sportLabel : ''}`, rateText: `${winRate.toFixed(1)}%`, barWidth: winRate, tone: 'caution' };
    if (winRate >= 1) return { color: '#ff5252', verdictLabel: `✗ SKIP${sportLabel ? ' ' + sportLabel : ''}`, rateText: `${winRate.toFixed(1)}%`, barWidth: winRate, tone: 'skip' };
    return { color: '#ff5252', verdictLabel: `✗ SKIP${sportLabel ? ' ' + sportLabel : ''}`, rateText: `${winRate.toFixed(1)}%`, barWidth: winRate, tone: 'skip' };
  };

  const buildSportPanel = (sportKey, display) => {
    const sportClass = sportKey.toLowerCase();
    const panelClass = `dow-sport-panel is-${display.tone}`;
    const statsText = display.recordText;
    return `<div class="${panelClass}">
      <div class="dow-sport-head">
        <div class="dow-sport-pill ${sportClass}">${sportKey}</div>
        <div class="dow-rate" style="color: ${display.color}">${display.rateText}</div>
      </div>
      <div class="dow-heat-bar-track"><div class="dow-heat-bar-fill" style="width: ${Math.max(0, Math.min(display.barWidth, 100))}%; background: ${display.color}"></div></div>
      <div class="dow-verdict" style="color: ${display.color}">${display.verdictLabel}</div>
      <div class="dow-record">${statsText}</div>
    </div>`;
  };

  const buildDaySummary = (dayLabel, nbaDisplay, mlbDisplay) => {
    const liveDisplays = [nbaDisplay, mlbDisplay].filter(display => display.tone !== 'nodata');
    if (!liveDisplays.length) return `${dayLabel} is thin across both leagues. No reliable sample yet.`;
    if (liveDisplays.length === 1) {
      const only = liveDisplays[0];
      const league = only.sportKey;
      if (only.tone === 'good') return `${league} is carrying ${dayLabel}. Lean ${league} only.`;
      if (only.tone === 'caution') return `${league} is breakeven on ${dayLabel}. Keep volume light.`;
      return `${dayLabel} has been rough for ${league}. Pass weak ${league} looks.`;
    }
    if (nbaDisplay.tone === 'good' && mlbDisplay.tone === 'good') return `${dayLabel} is live for both leagues. Press the strongest edges.`;
    if (nbaDisplay.tone === 'skip' && mlbDisplay.tone === 'skip') return `${dayLabel} is a weak board overall. Skip low-conviction spots.`;
    if (nbaDisplay.tone === 'good' && mlbDisplay.tone !== 'good') return `NBA is the cleaner ${dayLabel} angle. Be selective with MLB.`;
    if (mlbDisplay.tone === 'good' && nbaDisplay.tone !== 'good') return `MLB has the stronger ${dayLabel} profile. Treat NBA cautiously.`;
    return `${dayLabel} is mixed across NBA and MLB. Pick spots, not volume.`;
  };

  const decidedCount = overallByDay.reduce((sum, stats) => sum + stats.wins + stats.losses, 0);
  if (!decidedCount) {
    heatmap.innerHTML = '<div class="empty-state">No decided picks yet</div>';
    breakdown.innerHTML = '';
    return;
  }

  const todayDow = new Date().getDay();
  heatmap.innerHTML = DOW_ORDER.map((dayIndex, displayIndex) => {
    const dayLabel = DOW_LABELS[displayIndex];
    const nbaStats = sportDayStats.NBA[dayIndex];
    const mlbStats = sportDayStats.MLB[dayIndex];
    const totalPicks = nbaStats.wins + nbaStats.losses + mlbStats.wins + mlbStats.losses;
    const nbaDisplay = {
      ...getDowDisplay(nbaStats.wins, nbaStats.losses, 'NBA'),
      sportKey: 'NBA',
      recordText: `${nbaStats.wins}W – ${nbaStats.losses}L`,
    };
    const mlbDisplay = {
      ...getDowDisplay(mlbStats.wins, mlbStats.losses, 'MLB'),
      sportKey: 'MLB',
      recordText: `${mlbStats.wins}W – ${mlbStats.losses}L`,
    };
    const summary = buildDaySummary(dayLabel, nbaDisplay, mlbDisplay);
    return `<div class="dow-day-card" data-dow="${dayIndex}" title="${DOW_LABELS[displayIndex]} • ${totalPicks} decided picks">
      <div class="dow-day-name">${dayLabel}</div>
      ${todayDow === dayIndex ? '<div class="dow-today-pill">Today</div>' : ''}
      <div class="dow-sport-stack">
        ${buildSportPanel('NBA', nbaDisplay)}
        ${buildSportPanel('MLB', mlbDisplay)}
      </div>
      <div class="dow-day-summary">${summary}</div>
    </div>`;
  }).join('');

  document.querySelectorAll('.dow-day-card').forEach(card => {
    if (parseInt(card.dataset.dow, 10) === todayDow) {
      card.classList.add('is-today');
    }
  });

  const sortedSources = [...sourceByDay.keys()].sort((a, b) => {
    const aStats = getSourceStats(a, allPicks);
    const bStats = getSourceStats(b, allPicks);
    const compositeDelta = (bStats ? bStats.composite : -Infinity) - (aStats ? aStats.composite : -Infinity);
    if (compositeDelta) return compositeDelta;
    const countDelta = (bStats ? bStats.count : 0) - (aStats ? aStats.count : 0);
    if (countDelta) return countDelta;
    return a.localeCompare(b);
  });

  if (!sortedSources.length) {
    breakdown.innerHTML = '<div class="empty-state">No source breakdown available yet</div>';
    return;
  }

  breakdown.innerHTML = `<table class="dow-table">
    <thead>
      <tr>
        <th>Source</th>
        ${DAY_DISPLAY_ORDER.map((dayIndex) => `<th>${DAY_LABELS[dayIndex]}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${sortedSources.map((source) => {
        const dayBuckets = sourceByDay.get(source) || DAY_LABELS.map(() => createDayOfWeekStatsBucket());
        return `<tr>
          <td class="dow-model-name">${escapeDayOfWeekHtml(source)}</td>
          ${DAY_DISPLAY_ORDER.map((dayIndex) => {
            const stats = dayBuckets[dayIndex];
            const rate = getDayOfWeekWinRate(stats);
            return `<td class="${getDayOfWeekCellClass(stats)}" title="${stats.wins}W-${stats.losses}L across ${stats.totalPicks} decided picks">${formatDayOfWeekRate(rate, 0)}</td>`;
          }).join('')}
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

function scheduleBuildDayOfWeekChart() {
  if (dayOfWeekChartFrame) cancelAnimationFrame(dayOfWeekChartFrame);
  dayOfWeekChartFrame = requestAnimationFrame(() => {
    dayOfWeekChartFrame = 0;
    buildDayOfWeekChart();
  });
}

function initDayOfWeekChartRendering() {
  const leaderboard = document.getElementById('leaderboard');
  if (!leaderboard) return;
  const observer = new MutationObserver(() => {
    scheduleBuildDayOfWeekChart();
  });
  observer.observe(leaderboard, { childList: true, subtree: true });
  scheduleBuildDayOfWeekChart();
}

// ── Tabs ──
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
  const activeTab = document.querySelector(`.tab[onclick*="${name}"]`);
  const activePanel = document.getElementById('tab-'+name);
  if (name !== 'home') closeHomeDatePicker();
  if (activeTab) activeTab.classList.add('active');
  if (activePanel) activePanel.classList.add('active');
  localStorage.setItem('pickledger_tab', name);
  if (name === 'search') {
    if (typeof renderSearch === 'function') renderSearch();
    setTimeout(() => document.getElementById('search-input').focus(), 50);
  } else if (name === 'daily') {
    renderDaily();
  } else if (name === 'trends') {
    renderTrends();
  } else if (name === 'home') {
    renderHomePulse();
  }
  // Force Chrome to recalculate hover hit-testing after display:none toggle
  if (name === 'home') {
    const feed = document.getElementById('pick-feed');
    if (feed) {
      feed.style.pointerEvents = 'none';
      void feed.offsetHeight; // force synchronous reflow
      requestAnimationFrame(() => {
        feed.style.pointerEvents = '';
      });
    }
  }
}

// ── Search ──
function normalizeMLBTeam(name) {
  if (!name) return '';
  const trimmed = String(name).trim();
  const n = trimmed.toLowerCase();
  const map = {
    // Angels
    'anaheim': 'Los Angeles Angels',
    'angels': 'Los Angeles Angels',
    'la angels': 'Los Angeles Angels',
    'los angeles angels': 'Los Angeles Angels',
    // Astros
    'astros': 'Houston Astros',
    'houston': 'Houston Astros',
    'houston astros': 'Houston Astros',
    // Athletics
    'athletics': 'Oakland Athletics',
    'oakland': 'Oakland Athletics',
    'a\'s': 'Oakland Athletics',
    'oakland athletics': 'Oakland Athletics',
    // Blue Jays
    'blue jays': 'Toronto Blue Jays',
    'toronto': 'Toronto Blue Jays',
    'toronto blue jays': 'Toronto Blue Jays',
    // Braves
    'braves': 'Atlanta Braves',
    'atlanta': 'Atlanta Braves',
    'atlanta braves': 'Atlanta Braves',
    // Brewers
    'brewers': 'Milwaukee Brewers',
    'milwaukee': 'Milwaukee Brewers',
    'milwaukee brewers': 'Milwaukee Brewers',
    // Cardinals
    'cardinals': 'St. Louis Cardinals',
    'st. louis': 'St. Louis Cardinals',
    'stl': 'St. Louis Cardinals',
    'st louis': 'St. Louis Cardinals',
    // Cubs
    'cubs': 'Chicago Cubs',
    'chicago cubs': 'Chicago Cubs',
    // Dodgers
    'dodgers': 'Los Angeles Dodgers',
    'la dodgers': 'Los Angeles Dodgers',
    'los angeles dodgers': 'Los Angeles Dodgers',
    // Giants
    'giants': 'San Francisco Giants',
    'sf giants': 'San Francisco Giants',
    'san francisco': 'San Francisco Giants',
    'san francisco giants': 'San Francisco Giants',
    // Guardians
    'guardians': 'Cleveland Guardians',
    'gardians': 'Cleveland Guardians',
    'cleveland': 'Cleveland Guardians',
    'cleveland guardians': 'Cleveland Guardians',
    // Mariners
    'mariners': 'Seattle Mariners',
    'seattle': 'Seattle Mariners',
    'seattle mariners': 'Seattle Mariners',
    // Marlins
    'marlins': 'Miami Marlins',
    'miami': 'Miami Marlins',
    'miami marlins': 'Miami Marlins',
    // Mets
    'mets': 'New York Mets',
    'ny mets': 'New York Mets',
    'new york mets': 'New York Mets',
    // Nationals
    'nationals': 'Washington Nationals',
    'washington': 'Washington Nationals',
    'washington nationals': 'Washington Nationals',
    // Orioles
    'orioles': 'Baltimore Orioles',
    'baltimore': 'Baltimore Orioles',
    'baltimore orioles': 'Baltimore Orioles',
    // Padres
    'padres': 'San Diego Padres',
    'san diego': 'San Diego Padres',
    'san diego padres': 'San Diego Padres',
    'sd padres': 'San Diego Padres',
    // phillies
    'phillies': 'Philadelphia Phillies',
    'philadelphia': 'Philadelphia Phillies',
    'philadelphia phillies': 'Philadelphia Phillies',
    // Pirates
    'pirates': 'Pittsburgh Pirates',
    'pittsburgh': 'Pittsburgh Pirates',
    'pittsburgh pirates': 'Pittsburgh Pirates',
    // Rangers
    'rangers': 'Texas Rangers',
    'texas': 'Texas Rangers',
    'texas rangers': 'Texas Rangers',
    // rays
    'rays': 'Tampa Bay Rays',
    'tampa bay': 'Tampa Bay Rays',
    'tb rays': 'Tampa Bay Rays',
    'tampa bay rays': 'Tampa Bay Rays',
    // Red Sox
    'red sox': 'Boston Red Sox',
    'boston': 'Boston Red Sox',
    'boston red sox': 'Boston Red Sox',
    // Reds
    'reds': 'Cincinnati Reds',
    'cincinnati': 'Cincinnati Reds',
    'cincinnati reds': 'Cincinnati Reds',
    // Rockies
    'rockies': 'Colorado Rockies',
    'colorado': 'Colorado Rockies',
    'colorado rockies': 'Colorado Rockies',
    // Royals
    'royals': 'Kansas City Royals',
    'kansas city': 'Kansas City Royals',
    'kansas city royals': 'Kansas City Royals',
    // Tigers
    'tigers': 'Detroit Tigers',
    'detroit': 'Detroit Tigers',
    'detroit tigers': 'Detroit Tigers',
    // Twins
    'twins': 'Minnesota Twins',
    'minnesota': 'Minnesota Twins',
    // White Sox
    'white sox': 'Chicago White Sox',
    'chicago white sox': 'Chicago White Sox',
    // Yankees
    'yankees': 'New York Yankees',
    'ny yankees': 'New York Yankees',
    'new york yankees': 'New York Yankees',
    // Diamondbacks
    'diamondbacks': 'Arizona Diamondbacks',
    'arizona': 'Arizona Diamondbacks',
    'd-backs': 'Arizona Diamondbacks',
    'arizona diamondbacks': 'Arizona Diamondbacks',
  };
  return map[n] || trimmed;
}

function extractGameKey(pickText, sport) {
  const parens = Array.from(String(pickText || '').matchAll(/\(([^)]+)\)/g), m => m[1].trim());
  const inside = parens.find(s => /\s+(vs|@)\s+/i.test(s) && !/inc\.?\s*ot/i.test(s))
    || parens.find(s => /\s+(vs|@)\s+/i.test(s))
    || parens[0];
  if (!inside) return null;
  if (/\s+(vs|@)\s+/i.test(inside)) {
    const parts = inside.split(/\s+(?:vs|@)\s+/i).map(t => t.trim()).filter(Boolean);
    if (parts.length !== 2) return inside;
    if (String(sport || '').toUpperCase() === 'MLB') {
      return parts.map(t => normalizeMLBTeam(t)).join(' vs ');
    }
    if (String(sport || '').toUpperCase() === 'WNBA') {
      return parts.map(t => normalizeWNBATeam(t)).join(' vs ');
    }
    return parts.join(' vs ');
  }
  return inside;
}

const NBA_TEAM_NAME_ALIASES = {
  'ATLANTA HAWKS': 'Hawks',
  'HAWKS': 'Hawks',
  'BOSTON CELTICS': 'Celtics',
  'CELTICS': 'Celtics',
  'BROOKLYN NETS': 'Nets',
  'NETS': 'Nets',
  'CHARLOTTE HORNETS': 'Hornets',
  'CHARLOTTE': 'Hornets',
  'HORNETS': 'Hornets',
  'CHICAGO BULLS': 'Bulls',
  'BULLS': 'Bulls',
  'CLEVELAND CAVALIERS': 'Cavaliers',
  'CLEVELAND': 'Cavaliers',
  'CAVALIERS': 'Cavaliers',
  'CAVS': 'Cavaliers',
  'DALLAS MAVERICKS': 'Mavericks',
  'MAVERICKS': 'Mavericks',
  'MAVS': 'Mavericks',
  'DENVER NUGGETS': 'Nuggets',
  'NUGGETS': 'Nuggets',
  'DETROIT PISTONS': 'Pistons',
  'DETROIT': 'Pistons',
  'PISTONS': 'Pistons',
  'GOLDEN STATE WARRIORS': 'Warriors',
  'WARRIORS': 'Warriors',
  'HOUSTON ROCKETS': 'Rockets',
  'ROCKETS': 'Rockets',
  'INDIANA PACERS': 'Pacers',
  'PACERS': 'Pacers',
  'LOS ANGELES CLIPPERS': 'Clippers',
  'LA CLIPPERS': 'Clippers',
  'CLIPPERS': 'Clippers',
  'LOS ANGELES LAKERS': 'Lakers',
  'LAKERS': 'Lakers',
  'MEMPHIS GRIZZLIES': 'Grizzlies',
  'GRIZZLIES': 'Grizzlies',
  'MIAMI HEAT': 'Heat',
  'HEAT': 'Heat',
  'MILWAUKEE BUCKS': 'Bucks',
  'BUCKS': 'Bucks',
  'MINNESOTA TIMBERWOLVES': 'Timberwolves',
  'MINNESOTA': 'Timberwolves',
  'TIMBERWOLVES': 'Timberwolves',
  'WOLVES': 'Timberwolves',
  'NEW ORLEANS PELICANS': 'Pelicans',
  'NEW ORLEANS': 'Pelicans',
  'PELICANS': 'Pelicans',
  'NEW YORK KNICKS': 'Knicks',
  'KNICKS': 'Knicks',
  'OKLAHOMA CITY THUNDER': 'Thunder',
  'OKLAHOMA': 'Thunder',
  'THUNDER': 'Thunder',
  'ORLANDO MAGIC': 'Magic',
  'MAGIC': 'Magic',
  'PHILADELPHIA 76ERS': '76ers',
  '76ERS': '76ers',
  'SIXERS': '76ers',
  'PHOENIX SUNS': 'Suns',
  'PHOENIX': 'Suns',
  'SUNS': 'Suns',
  'PORTLAND TRAIL BLAZERS': 'Trail Blazers',
  'PORTLAND': 'Trail Blazers',
  'TRAIL BLAZERS': 'Trail Blazers',
  'BLAZERS': 'Trail Blazers',
  'SACRAMENTO KINGS': 'Kings',
  'KINGS': 'Kings',
  'SAN ANTONIO SPURS': 'Spurs',
  'SAN ANTONIO': 'Spurs',
  'SPURS': 'Spurs',
  'TORONTO RAPTORS': 'Raptors',
  'RAPTORS': 'Raptors',
  'UTAH JAZZ': 'Jazz',
  'JAZZ': 'Jazz',
  'WASHINGTON WIZARDS': 'Wizards',
  'WIZARDS': 'Wizards',
};

function normalizeNBATeam(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '';
  const upper = trimmed.toUpperCase().replace(/[.'"]/g, '').replace(/\s+/g, ' ').trim();
  return NBA_TEAM_NAME_ALIASES[upper] || trimmed;
}

const WNBA_TEAM_NAME_ALIASES = {
  'ATL': 'Atlanta Dream',
  'ATLANTA': 'Atlanta Dream',
  'DREAM': 'Atlanta Dream',
  'ATLANTA DREAM': 'Atlanta Dream',
  'CHI': 'Chicago Sky',
  'CHICAGO': 'Chicago Sky',
  'SKY': 'Chicago Sky',
  'CHICAGO SKY': 'Chicago Sky',
  'CON': 'Connecticut Sun',
  'CONN': 'Connecticut Sun',
  'CONNECTICUT': 'Connecticut Sun',
  'SUN': 'Connecticut Sun',
  'CONNECTICUT SUN': 'Connecticut Sun',
  'DAL': 'Dallas Wings',
  'DALLAS': 'Dallas Wings',
  'WINGS': 'Dallas Wings',
  'DALLAS WINGS': 'Dallas Wings',
  'GSV': 'Golden State Valkyries',
  'GS': 'Golden State Valkyries',
  'GOLDEN STATE': 'Golden State Valkyries',
  'VALKYRIES': 'Golden State Valkyries',
  'GOLDEN STATE VALKYRIES': 'Golden State Valkyries',
  'IND': 'Indiana Fever',
  'INDIANA': 'Indiana Fever',
  'FEVER': 'Indiana Fever',
  'INDIANA FEVER': 'Indiana Fever',
  'LA': 'Los Angeles Sparks',
  'LAS': 'Los Angeles Sparks',
  'LOS ANGELES': 'Los Angeles Sparks',
  'SPARKS': 'Los Angeles Sparks',
  'LOS ANGELES SPARKS': 'Los Angeles Sparks',
  'LV': 'Las Vegas Aces',
  'LVA': 'Las Vegas Aces',
  'LAS VEGAS': 'Las Vegas Aces',
  'ACES': 'Las Vegas Aces',
  'LAS VEGAS ACES': 'Las Vegas Aces',
  'MIN': 'Minnesota Lynx',
  'MINNESOTA': 'Minnesota Lynx',
  'LYNX': 'Minnesota Lynx',
  'MINNESOTA LYNX': 'Minnesota Lynx',
  'NY': 'New York Liberty',
  'NYL': 'New York Liberty',
  'NEW YORK': 'New York Liberty',
  'LIBERTY': 'New York Liberty',
  'NEW YORK LIBERTY': 'New York Liberty',
  'PHX': 'Phoenix Mercury',
  'PHO': 'Phoenix Mercury',
  'PHOENIX': 'Phoenix Mercury',
  'MERCURY': 'Phoenix Mercury',
  'PHOENIX MERCURY': 'Phoenix Mercury',
  'POR': 'Portland Fire',
  'PORTLAND': 'Portland Fire',
  'FIRE': 'Portland Fire',
  'PORTLAND FIRE': 'Portland Fire',
  'SEA': 'Seattle Storm',
  'SEATTLE': 'Seattle Storm',
  'STORM': 'Seattle Storm',
  'SEATTLE STORM': 'Seattle Storm',
  'TOR': 'Toronto Tempo',
  'TORONTO': 'Toronto Tempo',
  'TEMPO': 'Toronto Tempo',
  'TORONTO TEMPO': 'Toronto Tempo',
  'WAS': 'Washington Mystics',
  'WSH': 'Washington Mystics',
  'WASHINGTON': 'Washington Mystics',
  'MYSTICS': 'Washington Mystics',
  'WASHINGTON MYSTICS': 'Washington Mystics',
};

function normalizeWNBATeam(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '';
  const upper = trimmed.toUpperCase().replace(/[.'"]/g, '').replace(/\s+/g, ' ').trim();
  return WNBA_TEAM_NAME_ALIASES[upper] || trimmed;
}

function normalizeTeamForGameLabel(name, sport) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '';
  const upperSport = String(sport || '').toUpperCase();
  if (upperSport === 'MLB') return normalizeMLBTeam(trimmed);
  if (upperSport === 'NBA') return normalizeNBATeam(trimmed);
  if (upperSport === 'WNBA') return normalizeWNBATeam(trimmed);
  return trimmed;
}

function matchupLabelFromTeams(teamA, teamB, sport) {
  const parts = [teamA, teamB].map(team => normalizeTeamForGameLabel(team, sport)).filter(Boolean);
  if (parts.length !== 2) return '';
  return `${parts[0]} vs ${parts[1]}`;
}

function deriveGameLabel(p, allPicks) {
  const sport = String(p && p.sport || '').toUpperCase();
  const explicit = String(p && (p.matchup || p.game) || '').trim();
  if (/\s+(?:vs|@)\s+/i.test(explicit)) {
    const explicitParts = explicit.split(/\s+(?:vs|@)\s+/i).map(s => s.trim()).filter(Boolean);
    const explicitLabel = matchupLabelFromTeams(explicitParts[0], explicitParts[1], sport);
    if (explicitLabel) return explicitLabel;
  }
  const fromTeams = matchupLabelFromTeams(p && p.away_team, p && p.home_team, sport);
  if (fromTeams) return fromTeams;
  const extracted = extractGameKey(p && p.pick, sport);
  if (extracted) {
    const parts = String(extracted).split(/\s+(?:vs|@)\s+/i).map(s => s.trim()).filter(Boolean);
    const extractedLabel = matchupLabelFromTeams(parts[0], parts[1], sport);
    if (extractedLabel) return extractedLabel;
    return extracted;
  }
  const fallbackKey = String(p && p._gameKey || '').trim();
  if (fallbackKey) return fallbackKey;
  return inferNbaPropsMatchupLabel(p, allPicks || getPicks()) || '';
}

function deriveGameGroupKey(p, allPicks) {
  const sport = String(p && p.sport || 'OTHER').toUpperCase();
  const dateKey = getPickGameDateKeyLocal(p) || getPickDateKey(p && (p.date || p.game_date || p.Date)) || '';
  const teams = _pickAwayHomePair(p || {});
  const matchupKey = _matchupKeyFromTeams(teams.away, teams.home, sport);
  if (matchupKey) return `${sport}::${dateKey}::${matchupKey}`;
  const label = deriveGameLabel(p, allPicks || []);
  return `${sport}::${dateKey}::${normalizeStableToken(label || (p && p.id) || '')}`;
}

const NBA_OPP_ABBR_TO_TEAM_NAMES = {
  ATL: ['Hawks'], BOS: ['Celtics'], BKN: ['Nets'], CHA: ['Hornets'], CHI: ['Bulls'],
  CLE: ['Cavaliers', 'Cavs'], DAL: ['Mavericks', 'Mavs'], DEN: ['Nuggets'], DET: ['Pistons'],
  GSW: ['Warriors'], HOU: ['Rockets'], IND: ['Pacers'], LAC: ['Clippers'], LAL: ['Lakers'],
  MEM: ['Grizzlies'], MIA: ['Heat'], MIL: ['Bucks'], MIN: ['Timberwolves', 'Wolves'],
  NOP: ['Pelicans'], NYK: ['Knicks'], OKC: ['Thunder'], ORL: ['Magic'], PHI: ['76ers', 'Sixers'],
  PHX: ['Suns'], POR: ['Trail Blazers', 'Blazers'], SAC: ['Kings'], SAS: ['Spurs'],
  TOR: ['Raptors'], UTA: ['Jazz'], WAS: ['Wizards'],
};

function inferNbaPropsMatchupLabel(p, allPicks) {
  if (!p || String(p.sport || '').toUpperCase() !== 'NBA') return null;
  if (extractGameKey(p.pick, p.sport)) return null;
  const m = String(p.pick || '').match(/\bvs\s+([A-Z]{2,3})\b/i);
  if (!m) return null;
  const names = NBA_OPP_ABBR_TO_TEAM_NAMES[String(m[1] || '').toUpperCase()];
  if (!names || !names.length) return null;
  const sameDay = (allPicks || []).filter(x => x && x.id !== p.id && x.sport === p.sport && x.date === p.date);
  const matchupCounts = new Map();
  sameDay.forEach(x => {
    const label = extractGameKey(x.pick, x.sport);
    if (!label) return;
    const lowered = label.toLowerCase();
    if (!names.some(n => lowered.includes(String(n).toLowerCase()))) return;
    matchupCounts.set(label, (matchupCounts.get(label) || 0) + 1);
  });
  let best = null;
  let bestCount = 0;
  matchupCounts.forEach((count, label) => {
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  });
  return best;
}

// ── Start-time sync (ESPN public scoreboard) ───────────────────────────────
// The Live Board shows "TBD" whenever `gameTimes[pickId]` is empty. The
// backend grader (pickgrader_server.py) fills this map authoritatively when
// it runs, but on GitHub Pages the backend is not running continuously, so
// new MLB/NBA/WNBA picks land on the board with no start time until an admin
// fires the grader. This client-side mirror hits ESPN's public scoreboard
// for the selected board date and populates `gameTimes` directly, using
// the same team-normalizers the rest of the code uses so the join key stays
// consistent across schedules, picks, and the grader's own matcher.

const ESPN_SPORT_ENDPOINTS = {
  MLB: { sport: 'baseball', league: 'mlb' },
  NBA: { sport: 'basketball', league: 'nba' },
  WNBA: { sport: 'basketball', league: 'wnba' },
  NHL: { sport: 'hockey', league: 'nhl' },
};

let _lastStartTimeSyncForBoard = { dateKey: '', synced: 0, total: 0, unmatched: 0, ran: false };
const _espnScoreboardCache = new Map();
const HOME_SCOREBOARD_CACHE_TTL_MS = 45000;
const homeScoreboardGameMap = new Map();
const homeScoreboardFetchMeta = new Map();
let homeScoreRefreshInFlightKey = '';
const ESPN_FINAL_STATUS_NAMES = new Set(['STATUS_FINAL', 'STATUS_FULL_TIME']);
const ESPN_VOID_STATUS_NAMES = new Set(['STATUS_POSTPONED', 'STATUS_SUSPENDED', 'STATUS_CANCELED', 'STATUS_CANCELLED']);
const TEAM_ABBREVIATION_ALIASES_JS = {
  WAS: ['WSH'],
  WSH: ['WAS'],
  NOP: ['NO'],
  NO: ['NOP'],
  GSW: ['GS'],
  GS: ['GSW', 'GSV'],
  GSV: ['GS'],
  PHX: ['PHO'],
  PHO: ['PHX'],
  SAS: ['SA'],
  SA: ['SAS'],
  NYK: ['NY'],
  NY: ['NYK', 'NYL'],
  NYL: ['NY'],
  BKN: ['BRK'],
  BRK: ['BKN'],
  CON: ['CONN'],
  CONN: ['CON'],
  LV: ['LVA'],
  LVA: ['LV'],
  LA: ['LAS'],
  LAS: ['LA'],
};

function _boardDateKeyToYyyymmdd(dateKey) {
  const dt = parseLocalDateKey(dateKey);
  if (!dt) return '';
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function _pickShouldJoinEspnBoardDate(pick, boardDateKey) {
  const key = String(boardDateKey || '').trim();
  const pickKey = getPickDateKey(pick && (pick.date || pick.game_date || pick.Date));
  if (!key || !pickKey) return pickKey === key;
  if (pickKey === key) return true;
  const sport = String(pick && pick.sport || '').toUpperCase();
  if (sport !== 'MLB' && sport !== 'NBA' && sport !== 'WNBA') return false;
  const boardDt = parseLocalDateKey(key);
  const pickDt = parseLocalDateKey(pickKey);
  if (!boardDt || !pickDt) return false;
  const diffDays = Math.abs(boardDt.getTime() - pickDt.getTime()) / 86400000;
  return diffDays <= 1;
}

// Canonical, direction-agnostic matchup key used on BOTH sides of the join:
// ESPN competitors and the pick's (away, home) pair both normalize through
// the same `normalizeTeamForGameLabel(sport)` before being sorted. This is
// the single shared helper — no ad-hoc string fixes per source.
function _matchupKeyFromTeams(teamA, teamB, sport) {
  const upper = String(sport || '').toUpperCase();
  const a = String(normalizeTeamForGameLabel(teamA, upper) || '').toLowerCase();
  const b = String(normalizeTeamForGameLabel(teamB, upper) || '').toLowerCase();
  if (!a || !b) return '';
  return [a, b].sort().join('|');
}

function _pickAwayHomePair(pick) {
  const sport = String(pick && pick.sport || '').toUpperCase();
  const away = String(pick && pick.away_team || '').trim();
  const home = String(pick && pick.home_team || '').trim();
  if (away && home) return { away, home, sport };
  const matchup = String(pick && (pick.matchup || pick.game) || '').trim();
  if (matchup) {
    const parts = matchup.split(/\s+(?:vs|@)\s+/i).map(s => s.trim()).filter(Boolean);
    if (parts.length === 2) return { away: parts[0], home: parts[1], sport };
  }
  const extracted = extractGameKey(pick && pick.pick, sport);
  if (extracted) {
    const parts = String(extracted).split(/\s+(?:vs|@)\s+/i).map(s => s.trim()).filter(Boolean);
    if (parts.length === 2) return { away: parts[0], home: parts[1], sport };
  }
  return { away: '', home: '', sport };
}

async function _fetchEspnScoreboard(sport, league, yyyymmdd, options = {}) {
  const cacheKey = `${sport}/${league}/${yyyymmdd}`;
  const force = Boolean(options && options.force);
  if (!force && _espnScoreboardCache.has(cacheKey)) return _espnScoreboardCache.get(cacheKey);
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?dates=${yyyymmdd}`;
  const resp = await fetch(url, { cache: 'no-store', signal: _createTimeoutSignal(8000) });
  if (!resp.ok) throw new Error(`ESPN ${sport}/${league} ${yyyymmdd} -> HTTP ${resp.status}`);
  const payload = await resp.json();
  _espnScoreboardCache.set(cacheKey, payload);
  return payload;
}

function _espnCompetitorName(comp) {
  const team = comp && comp.team ? comp.team : {};
  return String(team.displayName || team.shortDisplayName || team.name || team.abbreviation || '').trim();
}

function _espnCompetitorFields(comp) {
  const team = comp && comp.team ? comp.team : {};
  return [
    team.displayName,
    team.shortDisplayName,
    team.name,
    team.abbreviation,
  ].map(v => String(v || '').trim()).filter(Boolean);
}

function _teamCodeAliasesJs(value) {
  const code = String(value || '').replace(/[^A-Za-z]/g, '').toUpperCase();
  if (!code) return new Set();
  return new Set([code, ...(TEAM_ABBREVIATION_ALIASES_JS[code] || [])]);
}

function _setsOverlap(a, b) {
  for (const value of a) {
    if (b.has(value)) return true;
  }
  return false;
}

function _teamMatchesEspnCompetitor(teamText, comp, sport) {
  const normalizedTeam = normalizeStableTeamToken(teamText, sport);
  if (!normalizedTeam) return false;

  const compCodeAliases = _teamCodeAliasesJs(comp && comp.team && comp.team.abbreviation);
  if (_setsOverlap(_teamCodeAliasesJs(teamText), compCodeAliases)) return true;

  for (const field of _espnCompetitorFields(comp)) {
    const normalizedField = normalizeStableTeamToken(field, sport);
    if (normalizedTeam === normalizedField) return true;
    if (normalizedTeam.length > 3 && normalizedField.includes(normalizedTeam)) return true;
    if (normalizedField.length > 2 && normalizedTeam.includes(normalizedField)) return true;
  }

  const tokens = normalizedTeam.split(' ').filter(Boolean);
  const last = tokens[tokens.length - 1] || '';
  if (last.length >= 3) {
    for (const field of _espnCompetitorFields(comp)) {
      const fieldTokens = normalizeStableTeamToken(field, sport).split(' ').filter(Boolean);
      if (fieldTokens.includes(last)) return true;
    }
  }

  return false;
}

function _buildEspnGameIndex(payload, sport) {
  const games = [];
  const events = Array.isArray(payload && payload.events) ? payload.events : [];
  events.forEach((event) => {
    const comp = (event && event.competitions && event.competitions[0]) || null;
    if (!comp) return;
    const competitors = Array.isArray(comp.competitors) ? comp.competitors : [];
    if (competitors.length !== 2) return;
    const parsed = competitors.map((competitor) => {
      const score = Number(competitor && competitor.score);
      return {
        raw: competitor,
        score: Number.isFinite(score) ? score : 0,
        homeAway: String(competitor && competitor.homeAway || '').toLowerCase(),
      };
    });
    const away = parsed.find(c => c.homeAway === 'away') || parsed[0];
    const home = parsed.find(c => c.homeAway === 'home') || parsed[1];
    const awayName = _espnCompetitorName(away.raw);
    const homeName = _espnCompetitorName(home.raw);
    const status = comp.status && comp.status.type ? comp.status.type : {};
    const statusName = String(status.name || status.type || '').toUpperCase();
    const statusState = String(status.state || '').toUpperCase();
    const statusDescription = String(status.description || status.detail || status.shortDetail || statusName || '').trim();
    const startTime = String(comp.date || event.date || '').trim();
    const matchKey = _matchupKeyFromTeams(awayName, homeName, sport);
    games.push({
      sport: String(sport || '').toUpperCase(),
      competitors: parsed,
      away,
      home,
      awayName,
      homeName,
      label: matchupLabelFromTeams(awayName, homeName, sport),
      matchKey,
      startTime,
      eventId: String(event && event.id || ''),
      statusName,
      statusState,
      statusDescription,
      completed: Boolean(status.completed),
    });
  });
  return games;
}

function _buildEspnStartTimeIndex(payload, sport) {
  const out = new Map();
  _buildEspnGameIndex(payload, sport).forEach((game) => {
    if (game.matchKey && game.startTime) out.set(game.matchKey, game.startTime);
  });
  return out;
}

function _findEspnGameForPick(games, pick) {
  const sport = String(pick && pick.sport || '').toUpperCase();
  const teams = _pickAwayHomePair(pick || {});
  const matchKey = _matchupKeyFromTeams(teams.away, teams.home, sport);
  if (matchKey) {
    const matched = games.find(game => game.matchKey === matchKey);
    if (matched) return matched;
  }

  const matchup = String(pick && pick.pick || '').match(/\(([^)]+)\)/);
  if (!matchup) return null;
  const parts = matchup[1].split(/\s+(?:vs|@)\s+/i).map(s => s.trim()).filter(Boolean);
  if (parts.length !== 2) return null;
  return games.find((game) => {
    const [a, b] = parts;
    const direct = _teamMatchesEspnCompetitor(a, game.competitors[0].raw, sport)
      && _teamMatchesEspnCompetitor(b, game.competitors[1].raw, sport);
    const reverse = _teamMatchesEspnCompetitor(a, game.competitors[1].raw, sport)
      && _teamMatchesEspnCompetitor(b, game.competitors[0].raw, sport);
    return direct || reverse;
  }) || null;
}

function _homeScoreTeamCode(comp) {
  const team = comp && comp.raw && comp.raw.team ? comp.raw.team : {};
  return String(team.abbreviation || team.shortDisplayName || team.name || '').trim();
}

function _homeScoreTone(game) {
  const statusName = String(game && game.statusName || '').toUpperCase();
  const statusState = String(game && game.statusState || '').toUpperCase();
  if (ESPN_VOID_STATUS_NAMES.has(statusName)) return 'delayed';
  if (game && (game.completed || ESPN_FINAL_STATUS_NAMES.has(statusName) || statusState === 'POST')) return 'final';
  if (statusState === 'IN') return 'live';
  return 'pregame';
}

function _homeScoreInfoFromEspnGame(game) {
  if (!game) return null;
  const tone = _homeScoreTone(game);
  const awayCode = _homeScoreTeamCode(game.away) || game.awayName || 'Away';
  const homeCode = _homeScoreTeamCode(game.home) || game.homeName || 'Home';
  const awayScore = Number(game.away && game.away.score);
  const homeScore = Number(game.home && game.home.score);
  const hasScore = Number.isFinite(awayScore) && Number.isFinite(homeScore);
  const scoreText = hasScore ? `${awayCode} ${awayScore} - ${homeCode} ${homeScore}` : '';
  const statusText = String(game.statusDescription || '').trim();
  let text = statusText || 'Scheduled';
  if (tone === 'final') text = scoreText ? `Final | ${scoreText}` : 'Final';
  else if (tone === 'live') text = scoreText ? `${scoreText} | ${statusText || 'Live'}` : (statusText || 'Live');
  else if (tone === 'delayed') text = statusText || 'Delayed';
  else if (game.startTime) text = `Starts ${formatStartLabel(game.startTime)}`;

  return {
    eventId: game.eventId || '',
    sport: String(game.sport || '').toUpperCase(),
    tone,
    text,
    statusText,
    awayCode,
    homeCode,
    awayScore: hasScore ? awayScore : null,
    homeScore: hasScore ? homeScore : null,
    startTime: game.startTime || '',
    updatedAt: Date.now(),
  };
}

function _homeScoreEspnUrl(scoreInfo) {
  if (!scoreInfo || !scoreInfo.eventId) return '';
  const sportSlug = {
    MLB: 'mlb',
    NBA: 'nba',
    WNBA: 'wnba',
    NHL: 'nhl',
  }[String(scoreInfo.sport || '').toUpperCase()];
  if (!sportSlug) return '';
  return `https://www.espn.com/${sportSlug}/game/_/gameId/${encodeURIComponent(scoreInfo.eventId)}`;
}

function _homeScoreGoogleUrl(scoreInfo, gameLabel) {
  const queryParts = [];
  if (scoreInfo && scoreInfo.awayCode) queryParts.push(scoreInfo.awayCode);
  if (scoreInfo && scoreInfo.homeCode) queryParts.push(scoreInfo.homeCode);
  const label = String(gameLabel || '').trim();
  if (!queryParts.length && label) queryParts.push(label);
  if (!queryParts.length) return '';
  queryParts.push('live score');
  return `https://www.google.com/search?q=${encodeURIComponent(queryParts.join(' '))}`;
}

function _homeScoreLinkUrl(scoreInfo, gameLabel) {
  return _homeScoreEspnUrl(scoreInfo) || _homeScoreGoogleUrl(scoreInfo, gameLabel);
}

function _homeScoreInfoSignature(info) {
  if (!info) return '';
  return [
    info.eventId,
    info.tone,
    info.text,
    info.awayScore,
    info.homeScore,
    info.statusText,
  ].join('|');
}

function _homeScoreRefreshKey(dateKey, picksForDate, allPicks) {
  const keys = new Set();
  (Array.isArray(picksForDate) ? picksForDate : []).forEach((pick) => {
    if (!pick) return;
    const sport = String(pick.sport || '').toUpperCase();
    if (!ESPN_SPORT_ENDPOINTS[sport]) return;
    keys.add(deriveGameGroupKey(pick, allPicks || picksForDate));
  });
  return `${dateKey}::${[...keys].sort().join('|')}`;
}

function isHomeTabActive() {
  const panel = document.getElementById('tab-home');
  return Boolean(panel && panel.classList.contains('active'));
}

async function refreshHomeScoreboardForDate(dateKey, picksForDate = []) {
  const key = String(dateKey || '').trim();
  if (!key || !Array.isArray(picksForDate) || !picksForDate.length || !isHomeTabActive()) return;
  const yyyymmdd = _boardDateKeyToYyyymmdd(key);
  if (!yyyymmdd) return;

  const allPicks = typeof getPicks === 'function' ? getPicks() : picksForDate;
  const supported = picksForDate.filter((pick) => {
    const sport = String(pick && pick.sport || '').toUpperCase();
    return ESPN_SPORT_ENDPOINTS[sport] && _pickShouldJoinEspnBoardDate(pick, key);
  });
  if (!supported.length) return;

  const refreshKey = _homeScoreRefreshKey(key, supported, allPicks);
  const now = Date.now();
  const lastFetchAt = Number(homeScoreboardFetchMeta.get(refreshKey) || 0);
  if (homeScoreRefreshInFlightKey === refreshKey) return;
  if (lastFetchAt && now - lastFetchAt < HOME_SCOREBOARD_CACHE_TTL_MS) return;

  homeScoreRefreshInFlightKey = refreshKey;
  homeScoreboardFetchMeta.set(refreshKey, now);
  let changed = false;
  const bySport = new Map();
  supported.forEach((pick) => {
    const sport = String(pick.sport || '').toUpperCase();
    if (!bySport.has(sport)) bySport.set(sport, []);
    bySport.get(sport).push(pick);
  });

  try {
    for (const [sport, picksForSport] of bySport.entries()) {
      const endpoint = ESPN_SPORT_ENDPOINTS[sport];
      let games = [];
      try {
        const payload = await _fetchEspnScoreboard(endpoint.sport, endpoint.league, yyyymmdd, { force: true });
        games = _buildEspnGameIndex(payload, sport);
      } catch (err) {
        console.warn(`[HomeScoreboard] ${sport} ${yyyymmdd}: scoreboard fetch failed -> ${err && err.message ? err.message : err}`);
        continue;
      }

      picksForSport.forEach((pick) => {
        const game = _findEspnGameForPick(games, pick);
        if (!game) return;
        const groupKey = deriveGameGroupKey(pick, allPicks);
        if (!groupKey) return;
        const nextInfo = _homeScoreInfoFromEspnGame(game);
        const prevInfo = homeScoreboardGameMap.get(groupKey);
        if (_homeScoreInfoSignature(prevInfo) !== _homeScoreInfoSignature(nextInfo)) {
          homeScoreboardGameMap.set(groupKey, nextInfo);
          changed = true;
        }
      });
    }
  } finally {
    homeScoreRefreshInFlightKey = '';
  }

  if (changed && isHomeTabActive()) render();
}

function homeScoreChipHtml(scoreInfo, fallbackStartIso, gameLabel = '') {
  const linkUrl = _homeScoreLinkUrl(scoreInfo, gameLabel);
  const chipAttrs = linkUrl
    ? `href="${_dailyEscape(linkUrl)}" target="_blank" rel="noopener noreferrer" title="Open live score"`
    : '';
  if (scoreInfo && scoreInfo.text) {
    const tag = linkUrl ? 'a' : 'span';
    return `<${tag} class="home-score-chip ${_dailyEscape(scoreInfo.tone || 'pregame')}" ${chipAttrs}>${_dailyEscape(scoreInfo.text)}</${tag}>`;
  }
  if (fallbackStartIso) {
    const tag = linkUrl ? 'a' : 'span';
    return `<${tag} class="home-score-chip pregame" ${chipAttrs}>${_dailyEscape(`Starts ${formatStartLabel(fallbackStartIso)}`)}</${tag}>`;
  }
  return '';
}

function _resolveTeamScoreForAutoGrade(game, teamText, pick) {
  const sport = String(pick && pick.sport || '').toUpperCase();
  for (let idx = 0; idx < game.competitors.length; idx += 1) {
    const competitor = game.competitors[idx];
    if (_teamMatchesEspnCompetitor(teamText, competitor.raw, sport)) {
      const opponent = game.competitors[1 - idx];
      return [competitor.score, opponent.score];
    }
  }
  return null;
}

function _autoGradeGameIsFinal(game) {
  return Boolean(game && (game.completed || ESPN_FINAL_STATUS_NAMES.has(game.statusName)));
}

function _autoGradeGameIsVoid(game) {
  return Boolean(game && ESPN_VOID_STATUS_NAMES.has(game.statusName));
}

function _autoGradeResultCode(result) {
  return { win: 'W', loss: 'L', push: 'P' }[normalizeResultValue(result)] || 'P';
}

function _lineScoreEntryRuns(entry) {
  if (!entry || typeof entry !== 'object') return null;
  for (const key of ['value', 'score', 'runs']) {
    const value = entry[key];
    if (value === null || value === undefined || value === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  const display = String(entry.displayValue || '').trim();
  const m = display.match(/^-?\d+/);
  if (!m) return null;
  const parsed = Number(m[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function _espnCompetitorInningRuns(comp, inning) {
  if (!comp || !Number.isFinite(inning) || inning < 1) return null;
  const raw = comp.raw || comp;
  const linescores = Array.isArray(comp.linescores)
    ? comp.linescores
    : (Array.isArray(raw.linescores) ? raw.linescores : (Array.isArray(raw.lineScores) ? raw.lineScores : []));
  if (!Array.isArray(linescores) || linescores.length < inning) return null;
  return _lineScoreEntryRuns(linescores[inning - 1]);
}

function gradeMlbNoRunInningPickFromEspnGame(pick, game) {
  if (String(pick && pick.sport || '').toUpperCase() !== 'MLB') return null;
  const inning = parseMlbNoRunInningPick(pick && pick.pick);
  if (inning == null) return null;
  if (inning >= 9) return 'pending';
  const runs = (game && Array.isArray(game.competitors) ? game.competitors : []).map(comp => _espnCompetitorInningRuns(comp, inning));
  if (runs.length !== 2 || runs.some(value => value == null)) return 'pending';
  return runs.reduce((sum, value) => sum + value, 0) === 0 ? 'win' : 'loss';
}

function gradePickFromEspnGame(pick, game) {
  const pickText = String(pick && pick.pick || '');
  const head = pickText.split('(', 1)[0].trim();
  const lower = head.toLowerCase();

  const totalPoints = game.competitors[0].score + game.competitors[1].score;

  const inningGrade = gradeMlbNoRunInningPickFromEspnGame(pick, game);
  if (inningGrade !== null) return inningGrade;

  // Full-game totals (Over/Under X)
  const mTotal = lower.match(/\b(over|under)\s+(\d+(?:\.\d+)?)\b/);
  // Skip if "team total" or team-prefixed TG (e.g. "senators over 3 tg"),
  // but allow game-level TG (e.g. "over 5.5 tg" where over/under is first word)
  const hasTeamTg = lower.endsWith(' tg') && !/^(over|under)\b/.test(lower);
  if (mTotal && !lower.includes('team total') && !hasTeamTg) {
    const side = mTotal[1];
    const line = Number(mTotal[2]);
    if (totalPoints === line) return 'push';
    if (side === 'over') return totalPoints > line ? 'win' : 'loss';
    return totalPoints < line ? 'win' : 'loss';
  }

  // Team total over/under, e.g. "Korea Team Total Over 9.5"
  const mTeamTotal = lower.match(/^(.*?)\s+team total\s+(over|under)\s+(\d+(?:\.\d+)?)/);
  if (mTeamTotal) {
    const teamLabel = mTeamTotal[1].trim();
    const side = mTeamTotal[2];
    const line = Number(mTeamTotal[3]);
    const resolved = _resolveTeamScoreForAutoGrade(game, teamLabel, pick);
    if (resolved === null) return 'pending';
    const teamScore = resolved[0];
    if (teamScore === line) return 'push';
    if (side === 'over') return teamScore > line ? 'win' : 'loss';
    return teamScore < line ? 'win' : 'loss';
  }

  // Team goals shorthand, e.g. "Senators Over 3 TG"
  const mTg = lower.match(/^(.*?)\s+(over|under)\s+(\d+(?:\.\d+)?)\s*tg\b/);
  if (mTg) {
    const teamLabel = mTg[1].trim();
    const side = mTg[2];
    const line = Number(mTg[3]);
    const resolved = _resolveTeamScoreForAutoGrade(game, teamLabel, pick);
    if (resolved === null) return 'pending';
    const teamScore = resolved[0];
    if (teamScore === line) return 'push';
    if (side === 'over') return teamScore > line ? 'win' : 'loss';
    return teamScore < line ? 'win' : 'loss';
  }

  // Skip 1H / partial-game markets for now.
  if (/\b1h\b|first half|period/.test(lower)) {
    return 'pending';
  }

  // Draw pick (soccer): "Draw (Team A vs Team B)"
  if (/^draw$/.test(lower)) {
    const c0 = game.competitors[0].score;
    const c1 = game.competitors[1].score;
    return c0 === c1 ? 'win' : 'loss';
  }

  // Both Teams to Score: "BTTS Yes" or "BTTS No"
  const mBtts = lower.match(/^btts\s+(yes|no)$/);
  if (mBtts) {
    const c0 = game.competitors[0].score;
    const c1 = game.competitors[1].score;
    const bothScored = c0 > 0 && c1 > 0;
    const side = mBtts[1];
    if (side === 'yes') return bothScored ? 'win' : 'loss';
    return !bothScored ? 'win' : 'loss';
  }

  // Spread / run line / puck line, e.g. "Knicks -11.5"
  const mSpread = head.match(/^(.*?)\s*([+-]\d+(?:\.\d+)?)\b/);
  if (mSpread) {
    const teamLabel = mSpread[1].trim();
    const spread = Number(mSpread[2]);
    if (!Number.isFinite(spread)) return 'pending';
    const resolved = _resolveTeamScoreForAutoGrade(game, teamLabel, pick);
    if (resolved === null) return 'pending';
    const [teamScore, oppScore] = resolved;
    const adj = teamScore + spread;
    if (Math.abs(adj - oppScore) < 1e-9) return 'push';
    return adj > oppScore ? 'win' : 'loss';
  }

  // Moneyline explicit: "Team ML"
  const mMl = lower.match(/^(.*?)\s+ml\b/);
  if (mMl) {
    const teamLabel = mMl[1].trim();
    const resolved = _resolveTeamScoreForAutoGrade(game, teamLabel, pick);
    if (resolved === null) return 'pending';
    const [teamScore, oppScore] = resolved;
    if (teamScore === oppScore) return 'push';
    return teamScore > oppScore ? 'win' : 'loss';
  }

  // Fallback: treat leading team label as winner pick.
  const fallbackTeam = head.replace(/\s*[+-]\d+(?:\.\d+)?\s*$/i, '').trim();
  if (fallbackTeam) {
    const resolved = _resolveTeamScoreForAutoGrade(game, fallbackTeam, pick);
    if (resolved === null) return 'pending';
    const [teamScore, oppScore] = resolved;
    if (teamScore === oppScore) return 'push';
    return teamScore > oppScore ? 'win' : 'loss';
  }

  return 'pending';
}

function _applyEspnScheduleMatchToOpenPick(pick, game, addedById, gameTimes) {
  if (!pick || !game) return false;
  const idStr = String(pick.id);
  const added = addedById.get(idStr);
  let mutatedAdded = false;
  if (game.startTime) {
    gameTimes[idStr] = game.startTime;
  }
  if (!added || normalizeResultValue(pick.result) !== 'pending') return false;

  if (game.startTime && added.start_time !== game.startTime) {
    added.start_time = game.startTime;
    mutatedAdded = true;
  }
  if (game.awayName && added.away_team !== game.awayName) {
    added.away_team = game.awayName;
    mutatedAdded = true;
  }
  if (game.homeName && added.home_team !== game.homeName) {
    added.home_team = game.homeName;
    mutatedAdded = true;
  }
  if (game.label && (added.matchup !== game.label || added.game !== game.label)) {
    added.matchup = game.label;
    added.game = game.label;
    mutatedAdded = true;
  }

  const espnDateKey = getLeagueLocalDateKeyFromIso(game.startTime, pick.sport);
  const storedDateRaw = String(added.date || pick.date || pick.game_date || pick.Date || '').trim();
  const storedDateKey = getPickDateKey(storedDateRaw);
  if (espnDateKey && storedDateKey && espnDateKey !== storedDateKey) {
    console.log(`[DateFix] ${pick.source || '?'} ${game.label || deriveGameLabel(pick) || '?'} stored=${storedDateKey} espn=${espnDateKey}`);
    const nextDateLabel = formatDateKeyForPickLabel(espnDateKey);
    if (nextDateLabel && added.date !== nextDateLabel) {
      added.date = nextDateLabel;
      mutatedAdded = true;
    }
  }

  return mutatedAdded;
}

async function autoGradeOpenPicksForBoardDate(boardDateKey) {
  const key = String(boardDateKey || '').trim();
  if (!key) return { dateKey: key, graded: 0, skipped: 0, ran: false };
  const yyyymmdd = _boardDateKeyToYyyymmdd(key);
  if (!yyyymmdd) return { dateKey: key, graded: 0, skipped: 0, ran: false };

  const picks = typeof getPicks === 'function' ? getPicks() : [];
  const openPicks = picks.filter((p) => (
    p && normalizeResultValue(p.result) === 'pending' &&
    _pickShouldJoinEspnBoardDate(p, key) &&
    ESPN_SPORT_ENDPOINTS[String(p.sport || '').toUpperCase()]
  ));
  const bySport = new Map();
  openPicks.forEach((p) => {
    const sport = String(p.sport || '').toUpperCase();
    if (!bySport.has(sport)) bySport.set(sport, []);
    bySport.get(sport).push(p);
  });
  if (!bySport.size) return { dateKey: key, graded: 0, skipped: 0, ran: true };

  const addedPicks = typeof getAddedPicks === 'function' ? getAddedPicks() : [];
  const addedById = new Map(addedPicks.map((p) => [String(p.id), p]));
  const gameTimes = getGameTimes();
  let mutatedAdded = false;
  let graded = 0;
  let skipped = 0;

  for (const [sport, picksForSport] of bySport.entries()) {
    const endpoint = ESPN_SPORT_ENDPOINTS[sport];
    let games = [];
    try {
      const payload = await _fetchEspnScoreboard(endpoint.sport, endpoint.league, yyyymmdd);
      games = _buildEspnGameIndex(payload, sport);
    } catch (err) {
      picksForSport.forEach((p) => {
        skipped += 1;
        console.warn(`[AutoGrade] skipped: fetch failed ${p.source || '?'} ${sport} ${deriveGameLabel(p) || p.pick || '?'} -> ${err && err.message ? err.message : err}`);
      });
      continue;
    }

    picksForSport.forEach((p) => {
      const game = _findEspnGameForPick(games, p);
      const matchup = game && game.label ? game.label : (deriveGameLabel(p, picks) || p.pick || '?');
      const market = getStablePickMarketParts(p).market || 'market';
      if (!game) {
        skipped += 1;
        const storedKey = getPickDateKey(p.date || p.game_date || p.Date);
        const reason = storedKey === key ? 'unmatched' : 'date-probe no match';
        console.warn(`[AutoGrade] skipped: ${reason} ${p.source || '?'} ${sport} ${matchup} ${market}`);
        return;
      }

      const scheduleChanged = _applyEspnScheduleMatchToOpenPick(p, game, addedById, gameTimes);
      if (scheduleChanged) {
        mutatedAdded = true;
        try {
          localStorage.setItem(ADDED_PICKS_KEY, JSON.stringify(addedPicks));
        } catch {
          console.warn('[AutoGrade] failed to stage ESPN matchup/date fixes before grading');
        }
      }
      if (_autoGradeGameIsVoid(game)) {
        setResultFromAutoGrade(p.id, 'push');
        graded += 1;
        console.log(`[AutoGrade] graded ${p.source || '?'} ${sport} ${matchup} ${market} \u2192 P`);
        return;
      }
      if (!_autoGradeGameIsFinal(game)) {
        skipped += 1;
        console.log(`[AutoGrade] skipped: non-final ${p.source || '?'} ${sport} ${matchup} status=${game.statusName || game.statusDescription || 'unknown'}`);
        return;
      }

      const result = gradePickFromEspnGame(p, game);
      if (result === 'win' || result === 'loss' || result === 'push') {
        setResultFromAutoGrade(p.id, result);
        graded += 1;
        console.log(`[AutoGrade] graded ${p.source || '?'} ${sport} ${matchup} ${market} \u2192 ${_autoGradeResultCode(result)}`);
      } else {
        skipped += 1;
        console.log(`[AutoGrade] skipped: unsupported ${p.source || '?'} ${sport} ${matchup} ${market}`);
      }
    });
  }

  try {
    localStorage.setItem(GAME_TIMES_KEY, JSON.stringify(gameTimes));
  } catch {
    console.warn('[AutoGrade] failed to persist gameTimes to localStorage');
  }
  if (mutatedAdded) {
    try {
      saveAddedPicks(addedPicks);
    } catch (err) {
      console.warn(`[AutoGrade] failed to persist ESPN matchup/date fixes: ${err && err.message ? err.message : err}`);
    }
  }
  if (graded > 0 || mutatedAdded) {
    null;
    if (typeof scheduleLedgerStateSync === 'function') null;
  }

  return { dateKey: key, graded, skipped, ran: true };
}

async function syncStartTimesForBoardDate(boardDateKey) {
  const key = String(boardDateKey || '').trim();
  const emptyResult = { dateKey: key, synced: 0, total: 0, unmatched: 0, ran: false };
  if (!key) {
    _lastStartTimeSyncForBoard = emptyResult;
    return emptyResult;
  }

  const picks = typeof getPicks === 'function' ? getPicks() : [];
  const todaysPicks = picks.filter((p) => (
    p && p.result === 'pending' && _pickShouldJoinEspnBoardDate(p, key)
  ));
  const bySport = new Map();
  todaysPicks.forEach((p) => {
    const sport = String(p.sport || '').toUpperCase();
    if (!ESPN_SPORT_ENDPOINTS[sport]) return;
    if (!bySport.has(sport)) bySport.set(sport, []);
    bySport.get(sport).push(p);
  });

  if (!bySport.size) {
    const result = { dateKey: key, synced: 0, total: 0, unmatched: 0, ran: true };
    _lastStartTimeSyncForBoard = result;
    return result;
  }

  const yyyymmdd = _boardDateKeyToYyyymmdd(key);
  if (!yyyymmdd) {
    _lastStartTimeSyncForBoard = emptyResult;
    return emptyResult;
  }

  const gameTimes = getGameTimes();
  const addedPicks = typeof getAddedPicks === 'function' ? getAddedPicks() : [];
  const addedById = new Map(addedPicks.map((p) => [String(p.id), p]));
  let synced = 0;
  let unmatched = 0;
  let total = 0;
  let mutatedAdded = false;

  for (const [sport, picksForSport] of bySport.entries()) {
    total += picksForSport.length;
    const endpoint = ESPN_SPORT_ENDPOINTS[sport];
    let games;
    try {
      const payload = await _fetchEspnScoreboard(endpoint.sport, endpoint.league, yyyymmdd);
      games = _buildEspnGameIndex(payload, sport);
    } catch (err) {
      console.warn(`[StartTimeSync] ${sport} ${yyyymmdd}: schedule fetch failed -> ${err && err.message ? err.message : err}`);
      unmatched += picksForSport.length;
      picksForSport.forEach((p) => {
        const teams = _pickAwayHomePair(p);
        console.warn(`[StartTimeSync] unmatched pick (fetch failed): source=${p.source || '?'} sport=${sport} matchup="${teams.away || '?'} @ ${teams.home || '?'}" date=${key} id=${p.id}`);
      });
      continue;
    }

    picksForSport.forEach((p) => {
      const teams = _pickAwayHomePair(p);
      const game = _findEspnGameForPick(games, p);
      if (game && game.startTime) {
        mutatedAdded = _applyEspnScheduleMatchToOpenPick(p, game, addedById, gameTimes) || mutatedAdded;
        synced += 1;
      } else {
        unmatched += 1;
        console.warn(`[StartTimeSync] unmatched pick: source=${p.source || '?'} sport=${sport} matchup="${teams.away || '?'} @ ${teams.home || '?'}" date=${key} id=${p.id}`);
      }
    });
  }

  try {
    localStorage.setItem(GAME_TIMES_KEY, JSON.stringify(gameTimes));
  } catch {
    // localStorage quota issues should never silently drop the sync; log it
    // so a future miss is debuggable rather than invisible.
    console.warn('[StartTimeSync] failed to persist gameTimes to localStorage');
  }
  if (mutatedAdded) {
    try {
      saveAddedPicks(addedPicks);
    } catch (err) {
      console.warn(`[StartTimeSync] failed to persist start_time on added picks: ${err && err.message ? err.message : err}`);
    }
  }
  if (synced > 0 || mutatedAdded) {
    null;
    if (typeof scheduleLedgerStateSync === 'function') {
      // Propagate the fresh gameTimes to Firestore so the grader picks up
      // the same start_time column it already expects via the sync payload.
      null;
    }
  }

  const result = { dateKey: key, synced, total, unmatched, ran: true };
  _lastStartTimeSyncForBoard = result;
  return result;
}

function formatBoardDateForStatus(dateKey) {
  const label = formatHomeDateKey(dateKey, { month: 'short', day: 'numeric' });
  return label || String(dateKey || '');
}

function highlightText(text, query) {
  return text;
}

function renderSearch() {
  const query = document.getElementById('search-input').value.trim().toLowerCase();
  const container = document.getElementById('search-results');
  const meta = document.getElementById('search-meta');
  const picks = getPicks();

  if (!query) {
    meta.textContent = '';
    container.innerHTML = '<div class="empty-state">Type a team name, matchup, or source to search saved picks</div>';
    return;
  }

  const matches = picks.filter(p =>
    p.pick.toLowerCase().includes(query) ||
    p.source.toLowerCase().includes(query) ||
    p.sport.toLowerCase().includes(query) ||
    p.date.toLowerCase().includes(query)
  );

  meta.textContent = `${matches.length} result${matches.length !== 1 ? 's' : ''} for "${query}"`;

  if (!matches.length) {
    container.innerHTML = '<div class="empty-state">No saved picks match your search</div>';
    return;
  }

  container.innerHTML = matches.map(p => {
    const gameKey = deriveGameLabel(p, picks);
    const related = gameKey ? picks.filter(rp => rp.id !== p.id && deriveGameLabel(rp, picks) === gameKey) : [];
    const resultBadge = p.result === 'win' ? 'badge-win' : p.result === 'loss' ? 'badge-loss' : p.result === 'push' ? 'badge-push' : 'badge-pending';
    const resultLabel = p.result.toUpperCase();
    const plStr = p.result === 'pending' ? '—' : (p.pl >= 0 ? '+' : '') + p.pl + 'u';
    const plClass = p.pl > 0 ? 'positive' : p.pl < 0 ? 'negative' : 'neutral';
    const uc = 'units-1';

    let relatedHTML = '';
    if (related.length) {
      relatedHTML = `<div class="search-card-related">
        <div class="search-card-related-title">RELATED PICKS ON THIS GAME (${related.length})</div>
        ${related.map(rp => {
          const rb = rp.result === 'win' ? 'badge-win' : rp.result === 'loss' ? 'badge-loss' : rp.result === 'push' ? 'badge-push' : 'badge-pending';
          return `<div class="search-related-item">
            <span class="badge badge-source">${rp.source}</span>
            <span style="flex:1">${rp.pick}</span>
            <span class="units-cell units-1">1u</span>
            <span style="font-family:'DM Mono',monospace;font-size:11px">${formatOddsOrProbabilityDisplay(rp.odds, rp.probability)}</span>
            <span class="badge ${rb}" style="font-size:9px">${rp.result.toUpperCase()}</span>
          </div>`;
        }).join('')}
      </div>`;
    }

    return `<div class="search-card" onclick="this.classList.toggle('expanded')">
      <div class="search-card-top">
        <span class="search-card-pick">${highlightText(p.pick, query)}</span>
        <span class="badge badge-source">${highlightText(p.source, query)}</span>
        <span style="color:var(--muted);font-size:12px">${p.sport}</span>
        <span class="badge ${resultBadge}">${resultLabel}</span>
      </div>
      <div class="search-card-row">
        <div class="search-card-field"><span class="search-card-field-label">UNITS</span><span class="search-card-field-val units-1">1u</span></div>
        <div class="search-card-field"><span class="search-card-field-label">ODDS</span><span class="search-card-field-val">${formatOddsOrProbabilityDisplay(p.odds, p.probability)}</span></div>
        <div class="search-card-field"><span class="search-card-field-label">DATE</span><span class="search-card-field-val">${p.date}</span></div>
        <div class="search-card-field"><span class="search-card-field-label">P/L</span><span class="search-card-field-val ${plClass}">${plStr}</span></div>
      </div>
      <div class="search-card-details">
        <div class="search-card-row">
          <div class="search-card-field"><span class="search-card-field-label">RESULT</span>
            <select class="result-select" onclick="event.stopPropagation()" onchange="event.stopPropagation();setResult(${p.id},this.value);renderSearch()">
              <option value="pending" ${p.result==='pending'?'selected':''}>PENDING</option>
              <option value="win" ${p.result==='win'?'selected':''}>WIN</option>
              <option value="loss" ${p.result==='loss'?'selected':''}>LOSS</option>
              <option value="push" ${p.result==='push'?'selected':''}>PUSH</option>
              <option value="delete">DELETE</option>
            </select>
          </div>
        </div>
        ${relatedHTML}
      </div>
    </div>`;
  }).join('');
}

// ── Trends ──
function normalizeTrendTeam(name) {
  return String(name || '').toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function canonicalGameKeyFromMatchup(matchupText) {
  const parts = String(matchupText || '').split(/\s+(?:vs|@)\s+/i).map(s => normalizeTrendTeam(s)).filter(Boolean);
  if (parts.length !== 2) return normalizeTrendTeam(matchupText);
  return parts.sort((a, b) => a.localeCompare(b)).join(' vs ');
}

function formatLine(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return 'n/a';
  const abs = Math.abs(v);
  const asText = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
  const sign = v > 0 ? '+' : '-';
  return `${sign}${asText}`;
}

function formatTotal(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return 'n/a';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function parseSpreadSignal(pickText) {
  const head = String(pickText || '').split('(', 1)[0].trim();
  if (!head || /\b(over|under)\b/i.test(head)) return null;
  if (/\b1h\b|first half|period/i.test(head)) return null;
  const m = head.match(/^(.*?)\s*([+-]\d+(?:\.\d+)?)\b/i);
  if (!m) return null;
  const team = normalizeTrendTeam(m[1]);
  const line = parseFloat(m[2]);
  if (!team || Number.isNaN(line)) return null;
  return { team, line };
}

function parseTotalSignal(pickText) {
  const lower = String(pickText || '').toLowerCase();
  if (lower.includes('team total') || /\btg\b/.test(lower)) return null;
  const m = lower.match(/\b(over|under)\s+(\d+(?:\.\d+)?)\b/);
  if (!m) return null;
  const side = m[1].toUpperCase();
  const line = parseFloat(m[2]);
  if (Number.isNaN(line)) return null;
  return { side, line };
}

function parseMoneylineSignal(pickText) {
  const head = String(pickText || '').split('(', 1)[0].trim();
  // Match "X ML" (SportyTrader style, e.g. "Orioles ML")
  const mlMatch = head.match(/^(.*?)\s+ml\b/i);
  if (mlMatch) {
    const team = normalizeTrendTeam(mlMatch[1]);
    if (team) return { team, line: null };
  }
  // Match "X to Win" or "X to Win the Match" (SportsGambler style)
  const toWinMatch = head.match(/^(.*?)\s+to\s+win\b/i);
  if (toWinMatch) {
    const team = normalizeTrendTeam(toWinMatch[1]);
    if (team) return { team, line: null };
  }
  // Match "X win the match" or "X wins" (SportyTrader alternate style)
  const winMatchStyle = head.match(/^(.*?)\s+wins?\b/i);
  if (winMatchStyle) {
    const team = normalizeTrendTeam(winMatchStyle[1]);
    if (team) return { team, line: null };
  }
  return null;
}

const MANUAL_MODEL_SIGNALS = [
  { source: 'NBA Model v2', sport: 'NBA', matchup: 'Nets @ 76ers', market: 'spread', team: '76ers', line: -6.4, decision: 'BET' },
  { source: 'NBA Model v2', sport: 'NBA', matchup: 'Nets @ 76ers', market: 'total', side: 'OVER', line: 224.2, decision: 'PASS' },
  { source: 'NBA Model v2', sport: 'NBA', matchup: 'Bucks @ Hawks', market: 'spread', team: 'Hawks', line: -7.4, decision: 'BET' },
  { source: 'NBA Model v2', sport: 'NBA', matchup: 'Bucks @ Hawks', market: 'total', side: 'OVER', line: 239.1, decision: 'BET' },
  { source: 'NBA Model v2', sport: 'NBA', matchup: 'Hornets @ Spurs', market: 'spread', team: 'Spurs', line: -6.3, decision: 'BET' },
  { source: 'NBA Model v2', sport: 'NBA', matchup: 'Hornets @ Spurs', market: 'total', side: 'OVER', line: 224.3, decision: 'PASS' },
  { source: 'NBA Model v2', sport: 'NBA', matchup: 'Wizards @ Celtics', market: 'spread', team: 'Celtics', line: -13.5, decision: 'BET' },
  { source: 'NBA Model v2', sport: 'NBA', matchup: 'Wizards @ Celtics', market: 'total', side: 'OVER', line: 227.9, decision: 'PASS' },
  { source: 'NBA Model v2', sport: 'NBA', matchup: 'Magic @ Heat', market: 'spread', team: 'Magic', line: 0, decision: 'PASS' },
  { source: 'NBA Model v2', sport: 'NBA', matchup: 'Magic @ Heat', market: 'total', side: 'OVER', line: 235.5, decision: 'BET' },
  { source: 'NBA Model v2', sport: 'NBA', matchup: 'Nuggets @ Lakers', market: 'spread', team: 'Lakers', line: -5.2, decision: 'BET' },
  { source: 'NBA Model v2', sport: 'NBA', matchup: 'Nuggets @ Lakers', market: 'total', side: 'OVER', line: 229.4, decision: 'BET' },
  { source: 'NBA Model v2', sport: 'NBA', matchup: 'Kings @ Clippers', market: 'spread', team: 'Clippers', line: -13.4, decision: 'BET' },
  { source: 'NBA Model v2', sport: 'NBA', matchup: 'Kings @ Clippers', market: 'total', side: 'OVER', line: 229.6, decision: 'BET' },
];

function getManualModelSignalsForToday() {
  const todayLabel = formatTodayPickDateLabel();
  return MANUAL_MODEL_SIGNALS.map(sig => ({ ...sig, date: todayLabel }));
}

function summarizeMarketVotes(votes, marketType) {
  if (!votes.length) {
    return {
      hasSignal: false,
      tone: 'split',
      label: 'No actionable signal',
      detail: 'No source has a live bet here.',
      sourceList: [],
      consensusCount: 0,
      totalVotes: 0,
      lineRange: null,
    };
  }

  const groups = {};
  votes.forEach(v => {
    const key = marketType === 'total' ? v.side : v.team;
    if (!groups[key]) groups[key] = { votes: [], lines: [], sources: new Set() };
    groups[key].votes.push(v);
    if (typeof v.line === 'number' && !Number.isNaN(v.line)) groups[key].lines.push(v.line);
    groups[key].sources.add(v.source);
  });

  const ranked = Object.entries(groups)
    .map(([key, g]) => ({ key, count: g.votes.length, lines: g.lines, sources: [...g.sources] }))
    .sort((a, b) => b.count - a.count);

  const top = ranked[0];
  const totalVotes = votes.length;
  const lineMin = top.lines.length ? Math.min(...top.lines) : null;
  const lineMax = top.lines.length ? Math.max(...top.lines) : null;
  const lineRange = lineMin != null && lineMax != null ? Math.abs(lineMax - lineMin) : null;
  const unanimous = top.count === totalVotes;
  const tone = (top.count >= 2 && unanimous) ? 'strong' : top.count >= 2 ? 'lean' : 'split';

  let label = '';
  if (marketType !== 'total') {
    if (lineMin != null && lineMax != null) {
      const lineText = lineMin === lineMax ? formatLine(lineMin) : `${formatLine(lineMin)} to ${formatLine(lineMax)}`;
      label = `${top.key} ${lineText}`;
    } else {
      label = top.key;
    }
  } else {
    if (lineMin != null && lineMax != null) {
      const totalText = lineMin === lineMax ? formatTotal(lineMin) : `${formatTotal(lineMin)} to ${formatTotal(lineMax)}`;
      label = `${top.key} ${totalText}`;
    } else {
      label = top.key;
    }
  }

  const disagreeCount = totalVotes - top.count;
  const detail = disagreeCount > 0
    ? `${top.count}/${totalVotes} sources align, ${disagreeCount} disagree.`
    : `${top.count}/${totalVotes} sources align.`;

  return {
    hasSignal: true,
    tone,
    label,
    detail,
    sourceList: top.sources,
    consensusCount: top.count,
    totalVotes,
    lineRange,
  };
}

function buildMarketBlock(title, summary, passCount) {
  const toneClass = summary.tone;
  const passText = passCount ? ` ${passCount} source${passCount !== 1 ? 's' : ''} passed.` : '';
  return `<div class="trend-market">
    <div class="trend-market-row">
      <div class="trend-market-label">${title}</div>
      <div class="trend-market-signal">${summary.label}</div>
    </div>
    <div class="trend-market-detail">${summary.detail}${passText}</div>
    <div class="trend-source-row">${summary.sourceList.map(s => `<span class="trend-source-pill">${s}</span>`).join('')}</div>
    <div class="trend-strength-pill ${toneClass}" style="margin-top:8px;display:inline-block">${toneClass.toUpperCase()}</div>
  </div>`;
}

const expandedTrendGameKeys = new Set();
const expandedTrendPropsKeys = new Set();
const expandedSourceKeys = new Set();

function toggleTrendGame(key) {
  if (!key) return;
  if (expandedTrendGameKeys.has(key)) expandedTrendGameKeys.delete(key);
  else expandedTrendGameKeys.add(key);
  renderTrends();
}

function toggleTrendGameFromEl(el) {
  if (!el) return;
  const key = String(el.getAttribute('data-game-key') || '');
  toggleTrendGame(key);
}

function toggleTrendPropsBucket(key) {
  if (!key) return;
  if (expandedTrendPropsKeys.has(key)) expandedTrendPropsKeys.delete(key);
  else expandedTrendPropsKeys.add(key);
  renderTrends();
}

function toggleTrendPropsFromEl(el) {
  if (!el) return;
  const key = String(el.getAttribute('data-props-key') || '');
  toggleTrendPropsBucket(key);
}

function toggleSourceCard(key, cardEl = null) {
  if (!key) return;
  let expanded = false;
  if (expandedSourceKeys.has(key)) {
    expandedSourceKeys.delete(key);
  } else {
    expandedSourceKeys.add(key);
    expanded = true;
  }
  const target = cardEl || (window.CSS && CSS.escape
    ? document.querySelector(`.source-card[data-source-key="${CSS.escape(key)}"]`)
    : null);
  if (target) {
    target.classList.toggle('expanded', expanded);
    target.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }
}

function toggleSourceCardFromEl(el) {
  if (!el) return;
  const key = String(el.getAttribute('data-source-key') || '');
  toggleSourceCard(key, el);
}

function describeTrendVote(v, marketType) {
  if (marketType === 'total') {
    return `${v.side} ${formatTotal(v.line)}`;
  }
  if (typeof v.line === 'number' && !Number.isNaN(v.line)) {
    return `${v.team} ${formatLine(v.line)}`;
  }
  return `${v.team} ML`;
}

function buildTrendEvidenceBlock(title, votes, passes, marketType) {
  const voteRows = votes.map(v => `<div class="trend-evidence-item">
      <div class="trend-evidence-row">
        <span class="trend-evidence-source">${v.source}</span>
        <span class="trend-evidence-origin">${v.origin}</span>
      </div>
      <div class="trend-evidence-text">${describeTrendVote(v, marketType)}</div>
    </div>`).join('');

  const passRows = passes.map(v => `<div class="trend-evidence-item">
      <div class="trend-evidence-row">
        <span class="trend-evidence-source">${v.source}</span>
        <span class="trend-evidence-origin">${v.origin}</span>
      </div>
      <div class="trend-evidence-text">PASS</div>
    </div>`).join('');

  const allRows = voteRows + passRows;
  if (!allRows) {
    return `<div class="trend-market"><div class="trend-market-label">${title} PROVENANCE</div><div class="trend-market-detail">No source signal logged.</div></div>`;
  }

  return `<div class="trend-market">
    <div class="trend-market-label">${title} PROVENANCE</div>
    <div class="trend-evidence-list">${allRows}</div>
  </div>`;
}

function isNbaPropsSource(source) {
  const text = String(source || '').toUpperCase();
  return text.includes('NBA PROPS');
}

function getNbaPropsBuckets(propsPicks) {
  const buckets = [
    { key: '60-70', label: '60-70%', min: 60, max: 70, includeUpper: false },
    { key: '70-80', label: '70-80%', min: 70, max: 80, includeUpper: false },
    { key: '80-90', label: '80-90%', min: 80, max: 90, includeUpper: false },
    { key: '90-100', label: '90-100%', min: 90, max: 100, includeUpper: true },
  ];
  return buckets.map(bucket => ({
    ...bucket,
    picks: propsPicks
      .filter((p) => bucket.includeUpper ? (p.probabilityPct >= bucket.min && p.probabilityPct <= bucket.max) : (p.probabilityPct >= bucket.min && p.probabilityPct < bucket.max))
      .sort((a, b) => b.probabilityPct - a.probabilityPct),
  }));
}

function _parsePropPickParts(pickText) {
  const text = String(pickText || '').trim();
  const m = text.match(/^(.+?)\s+(points|rebounds|assists)\s+(OVER|UNDER)\s+([0-9.]+)\s+vs\s+([A-Z]{2,3})(?:\s*\([^)]*\))?$/i);
  if (!m) return null;
  return {
    playerName: m[1].trim(),
    propWord: m[2].toLowerCase(),
    direction: m[3].toUpperCase(),
    line: Number(m[4]),
    oppAbbr: m[5].toUpperCase(),
  };
}

function _extractParlayProbabilityFromDisplay(pick) {
  const display = String(formatOddsOrProbabilityDisplay(pick.odds, pick.probability) || '').trim();
  const m = display.match(/([0-9]+(?:\.[0-9]+)?)%/);
  if (m) {
    const pct = Number(m[1]);
    if (Number.isFinite(pct)) {
      return {
        display: `${pct.toFixed(1)}%`,
        pct,
        prob: pct / 100,
      };
    }
  }
  const fallbackProb = normalizeProbabilityValue(pick.probability);
  if (fallbackProb == null) return null;
  const fallbackPct = fallbackProb * 100;
  return {
    display: `${fallbackPct.toFixed(1)}%`,
    pct: fallbackPct,
    prob: fallbackProb,
  };
}

function _canonicalParlayGameLabel(pickText) {
  const matchup = extractGameKey(pickText);
  if (!matchup) return null;
  const parts = matchup.split(/\s+(?:vs|@)\s+/i).map(s => s.trim()).filter(Boolean);
  if (parts.length !== 2) return matchup;
  return `${parts[0]}@${parts[1]}`;
}

function _formatFairAmericanOdds(prob) {
  if (!Number.isFinite(prob) || prob <= 0 || prob >= 1) return 'n/a';
  const fair = Math.round(((1 / prob) - 1) * 100);
  return `${fair > 0 ? '+' : ''}${fair}`;
}

function _getParlaySuggestions() {
  try {
    const pendingToday = getPicks().filter(p => (
      p.result === 'pending' &&
      p.sport === 'NBA' &&
      String(p.source || '') === 'NBA Props Model' &&
      isTodayPickDateLabel(p.date)
    ));

    const predictions = pendingToday
      .map(p => {
        const parts = _parsePropPickParts(p.pick);
        const probabilityInfo = _extractParlayProbabilityFromDisplay(p);
        return {
          ...p,
          parts,
          probabilityInfo,
          prob: probabilityInfo ? probabilityInfo.prob : null,
          probPct: probabilityInfo ? probabilityInfo.pct : null,
          probDisplay: probabilityInfo ? probabilityInfo.display : '—',
          gameKey: _canonicalParlayGameLabel(p.pick) || `pick-${p.id}`,
          gameLabel: extractGameKey(p.pick, p.sport) || _canonicalParlayGameLabel(p.pick) || `Game ${p.id}`,
        };
      })
      .filter(p => p.parts && p.prob != null);

    const tier1 = predictions.filter(p => (
      p.parts.propWord === 'rebounds' &&
      p.probPct >= 61 &&
      p.probPct <= 74
    ));

    const tier2 = tier1.length >= 3 ? [] : predictions.filter(p => (
      p.parts.propWord === 'assists' &&
      p.probPct >= 65 &&
      p.probPct <= 74 &&
      Math.round(p.probPct) !== 78
    ));

    const candidates = [...tier1];
    if (candidates.length < 3) {
      tier2.forEach(p => {
        if (!candidates.includes(p)) candidates.push(p);
      });
    }

    if (candidates.length < 3) {
      return { candidates, combos: [] };
    }

    const combos = [];
    for (let i = 0; i < candidates.length - 2; i++) {
      for (let j = i + 1; j < candidates.length - 1; j++) {
        for (let k = j + 1; k < candidates.length; k++) {
          const legs = [candidates[i], candidates[j], candidates[k]];
          const gameCounts = {};
          legs.forEach(leg => {
            gameCounts[leg.gameKey] = (gameCounts[leg.gameKey] || 0) + 1;
          });
          if (Math.max(...Object.values(gameCounts)) > 2) continue;
          combos.push({
            legs,
            gameCounts,
            combinedProb: legs.reduce((acc, leg) => acc * leg.prob, 1),
          });
        }
      }
    }

    combos.sort((a, b) => b.combinedProb - a.combinedProb);
    return { candidates, combos: combos.slice(0, 3) };
  } catch (err) {
    return {
      candidates: [],
      combos: [],
      error: err,
    };
  }
}

// ── Daily tab ──
// Today's slate: live picks, daily source ranking, rollover on day change.
let _dailyRolloverDay = null;  // YYYY-MM-DD string marker
let _dailyClockTimerId = null;

function _dailyDayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _dailyFormatLongDate() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function _dailyFormatClock() {
  return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function _dailyCountdownToMidnight() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const ms = midnight - now;
  if (ms <= 0) return 'rolling over…';
  const totalSec = Math.floor(ms / 1000);
  const hh = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  return `${hh}h ${String(mm).padStart(2, '0')}m ${String(ss).padStart(2, '0')}s TO ROLLOVER`;
}

function _dailyTickClock() {
  const clock = document.getElementById('daily-clock-time');
  const cd = document.getElementById('daily-countdown');
  if (clock) clock.textContent = _dailyFormatClock();
  if (cd) cd.textContent = _dailyCountdownToMidnight();

  // Detect day rollover.
  const currentDay = _dailyDayKey();
  if (_dailyRolloverDay && currentDay !== _dailyRolloverDay) {
    _dailyRolloverDay = currentDay;
    try { renderDaily(); } catch (e) { /* noop */ }
  }
}

function _dailyStartClockTimer() {
  if (_dailyClockTimerId) return;
  _dailyClockTimerId = setInterval(_dailyTickClock, 1000);
}

function _dailyScoreSource(stats) {
  // Composite daily score (0-100ish): heavily rewards net units + accuracy, nudges for volume.
  if (!stats.decided) {
    // pending-only source: show pick volume as a faint signal
    return Math.min(25, stats.pending * 3);
  }
  const accPart = stats.acc * 55;                       // 0-55
  const unitsPart = Math.max(-25, Math.min(40, stats.netUnits * 6));  // -25..40
  const volumePart = Math.min(10, Math.log2(1 + stats.count) * 3);    // 0-10
  const pushPenalty = stats.pushes > 0 ? -1 : 0;
  return Math.max(0, Math.round(accPart + unitsPart + volumePart + pushPenalty));
}

function _dailyBuildSourceRanking(picks) {
  const bySource = {};
  picks.forEach(p => {
    const key = getRankingSourceKey(p) || 'Unknown';
    if (!bySource[key]) bySource[key] = { source: key, count: 0, wins: 0, losses: 0, pushes: 0, pending: 0, netUnits: 0, units: 0 };
    const bucket = bySource[key];
    bucket.count += 1;
    if (p.result === 'win') bucket.wins += 1;
    else if (p.result === 'loss') bucket.losses += 1;
    else if (p.result === 'push') bucket.pushes += 1;
    else bucket.pending += 1;
    bucket.netUnits += Number(p.pl) || 0;
    if (p.result !== 'push' && p.result !== 'pending') bucket.units += Number(p.units) || 0;
  });
  const list = Object.values(bySource).map(s => {
    const decided = s.wins + s.losses;
    const acc = decided > 0 ? s.wins / decided : 0;
    const roi = s.units > 0 ? s.netUnits / s.units : 0;
    const score = _dailyScoreSource({ ...s, decided, acc });
    return { ...s, decided, acc, roi, score };
  });
  list.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.netUnits !== a.netUnits) return b.netUnits - a.netUnits;
    if (b.acc !== a.acc) return b.acc - a.acc;
    return b.count - a.count;
  });
  return list;
}

function _dailySourcePastSummary(source, allPicks) {
  // quick past stats from the non-today decided picks
  const past = allPicks.filter(p => p.source === source && !isTodayPickDateLabel(p.date) && (p.result === 'win' || p.result === 'loss'));
  const w = past.filter(p => p.result === 'win').length;
  const l = past.filter(p => p.result === 'loss').length;
  const total = w + l;
  if (!total) return 'No prior record';
  return `${w}-${l} overall (${((w / total) * 100).toFixed(0)}% all-time)`;
}

function _dailyGroupByGame(picks) {
  const groups = {};
  picks.forEach(p => {
    const label = deriveGameLabel(p, picks) || p.pick || `Pick ${p.id}`;
    const key = `${p.sport || 'OTHER'}::${label}`;
    if (!groups[key]) groups[key] = { key, sport: p.sport || 'OTHER', label, picks: [] };
    groups[key].picks.push(p);
  });
  return Object.values(groups).sort((a, b) => {
    // sort: active/pending first, then by sport, then alpha
    const aPending = a.picks.some(p => p.result === 'pending');
    const bPending = b.picks.some(p => p.result === 'pending');
    if (aPending !== bPending) return aPending ? -1 : 1;
    if (a.sport !== b.sport) return a.sport.localeCompare(b.sport);
    return a.label.localeCompare(b.label);
  });
}

function _dailyGroupVerdict(picks) {
  const results = picks.map(p => p.result);
  const hasWin = results.includes('win');
  const hasLoss = results.includes('loss');
  const hasPending = results.includes('pending');
  if (hasPending) return { key: 'live', label: hasWin || hasLoss ? 'IN PROGRESS' : 'PENDING' };
  if (hasWin && !hasLoss) return { key: 'win', label: 'ALL HIT' };
  if (hasLoss && !hasWin) return { key: 'loss', label: 'ALL MISS' };
  if (hasWin && hasLoss) return { key: 'mixed', label: 'MIXED' };
  return { key: 'live', label: 'SETTLED' };
}

function _dailyEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderDaily() {
  const container = document.getElementById('daily-container');
  if (!container) return;
  _dailyRolloverDay = _dailyDayKey();

  try {
    const allPicks = getPicks();
    const todayLabel = formatTodayPickDateLabel();
    const todayPicks = allPicks.filter(p => isTodayPickDateLabel(p.date));

    // Hero aggregates
    const total = todayPicks.length;
    const wins = todayPicks.filter(p => p.result === 'win').length;
    const losses = todayPicks.filter(p => p.result === 'loss').length;
    const pushes = todayPicks.filter(p => p.result === 'push').length;
    const pending = todayPicks.filter(p => p.result === 'pending').length;
    const decided = wins + losses;
    const acc = decided > 0 ? ((wins / decided) * 100).toFixed(1) + '%' : '—';
    const netUnits = todayPicks.reduce((s, p) => s + (Number(p.pl) || 0), 0);
    const risked = todayPicks.filter(p => p.result !== 'push' && p.result !== 'pending').reduce((s, p) => s + (Number(p.units) || 0), 0);
    const roi = risked > 0 ? ((netUnits / risked) * 100).toFixed(1) + '%' : '—';
    const netUnitsStr = (netUnits >= 0 ? '+' : '') + netUnits.toFixed(2) + 'u';
    const netClass = netUnits > 0 ? 'positive' : netUnits < 0 ? 'negative' : 'neutral';
    const roiClass = roi === '—' ? 'neutral' : (parseFloat(roi) >= 0 ? 'positive' : 'negative');

    const heroHtml = `
      <div class="daily-hero">
        <div class="daily-hero-row">
          <div>
            <div class="daily-eyebrow"><span class="daily-eyebrow-dot"></span>Today's Slate · ${_dailyEscape(todayLabel)}</div>
            <div class="daily-title">${_dailyEscape(_dailyFormatLongDate())}</div>
            <div class="daily-sub">Live picks, live scores, fresh slate at midnight local.</div>
          </div>
          <div class="daily-clock-wrap">
            <div class="daily-clock-label">LOCAL TIME</div>
            <div class="daily-clock" id="daily-clock-time">${_dailyEscape(_dailyFormatClock())}</div>
            <div class="daily-countdown" id="daily-countdown">${_dailyEscape(_dailyCountdownToMidnight())}</div>
          </div>
        </div>
        <div class="daily-stats-strip">
          <div class="daily-stat"><div class="daily-stat-val">${total}</div><div class="daily-stat-label">Picks Today</div></div>
          <div class="daily-stat"><div class="daily-stat-val accent3">${pending}</div><div class="daily-stat-label">Pending</div></div>
          <div class="daily-stat"><div class="daily-stat-val positive">${wins}</div><div class="daily-stat-label">Wins</div></div>
          <div class="daily-stat"><div class="daily-stat-val negative">${losses}</div><div class="daily-stat-label">Losses</div></div>
          <div class="daily-stat"><div class="daily-stat-val ${pushes > 0 ? 'neutral' : ''}">${pushes}</div><div class="daily-stat-label">Pushes</div></div>
          <div class="daily-stat"><div class="daily-stat-val ${decided ? (wins >= losses ? 'positive' : 'negative') : ''}">${acc}</div><div class="daily-stat-label">Hit Rate</div></div>
          <div class="daily-stat"><div class="daily-stat-val ${netClass}">${netUnitsStr}</div><div class="daily-stat-label">Net Units</div></div>
          <div class="daily-stat"><div class="daily-stat-val ${roiClass}">${roi}</div><div class="daily-stat-label">ROI Today</div></div>
        </div>
      </div>`;

    _dailyStartClockTimer();

    if (!todayPicks.length) {
      container.innerHTML = heroHtml + `
        <div class="daily-empty">
          <div class="daily-empty-icon">📭</div>
          <div class="daily-empty-title">No picks logged for ${_dailyEscape(todayLabel)} yet</div>
          <div class="daily-empty-sub">When picks get added to the ledger today they'll show up here instantly — ranked, scored, and live.</div>
        </div>`;
      return;
    }

    // Daily source ranking
    const ranking = _dailyBuildSourceRanking(todayPicks);
    const maxScore = Math.max(1, ...ranking.map(r => r.score));

    const podium = ranking.slice(0, 3);
    const podiumClass = ['gold', 'silver', 'bronze'];
    const podiumMedal = ['🥇 #1 TODAY', '🥈 #2 TODAY', '🥉 #3 TODAY'];

    const podiumHtml = podium.length ? `
      <div class="daily-section-head">
        <div class="daily-section-title">Daily Leaderboard · Pick Label Podium</div>
        <div class="daily-section-sub">Scoring: accuracy × units × volume · resets at midnight local</div>
      </div>
      <div class="daily-podium">
        ${podium.map((r, idx) => {
          const recordParts = [];
          if (r.wins) recordParts.push(`<span class="daily-podium-chip win">${r.wins}W</span>`);
          if (r.losses) recordParts.push(`<span class="daily-podium-chip loss">${r.losses}L</span>`);
          if (r.pushes) recordParts.push(`<span class="daily-podium-chip">${r.pushes}P</span>`);
          if (r.pending) recordParts.push(`<span class="daily-podium-chip pending">${r.pending} pending</span>`);
          const uStr = (r.netUnits >= 0 ? '+' : '') + r.netUnits.toFixed(2) + 'u';
          const scoreClass = r.netUnits > 0 ? 'positive' : r.netUnits < 0 ? 'negative' : 'neutral';
          return `
          <div class="daily-podium-card ${podiumClass[idx]}">
            <div class="daily-podium-medal">${podiumMedal[idx]}</div>
            <div class="daily-podium-source">${_dailyEscape(r.source)}</div>
            <div class="daily-podium-score ${scoreClass}">${r.score}<span style="font-size:14px;font-family:'DM Mono',monospace;letter-spacing:1px;margin-left:6px;color:var(--muted)">PTS</span></div>
            <div class="daily-podium-metrics">
              <span class="daily-podium-chip">${r.count} pick${r.count === 1 ? '' : 's'}</span>
              ${recordParts.join('')}
              <span class="daily-podium-chip ${r.netUnits >= 0 ? 'win' : 'loss'}">${uStr}</span>
            </div>
            <div class="daily-podium-rank">${idx + 1}</div>
          </div>`;
        }).join('')}
      </div>` : '';

    const rankingHeader = `
      <div class="daily-ranking-row header daily-ranking-header-row">
        <span>#</span>
        <span>Source</span>
        <span class="daily-ranking-hide-sm">Record</span>
        <span>Units</span>
        <span class="daily-ranking-hide-sm">Hit %</span>
        <span>Score</span>
      </div>`;

    const rankingRows = ranking.map((r, idx) => {
      const rank = idx + 1;
      const rankClass = rank <= 3 ? `rank-${rank}` : '';
      const record = [`${r.wins}-${r.losses}`, r.pushes ? `-${r.pushes}` : '', r.pending ? ` · ${r.pending}P` : ''].join('');
      const uStr = (r.netUnits >= 0 ? '+' : '') + r.netUnits.toFixed(2) + 'u';
      const uClass = r.netUnits > 0 ? 'positive' : r.netUnits < 0 ? 'negative' : 'muted';
      const accStr = r.decided ? (r.acc * 100).toFixed(0) + '%' : '—';
      const accClass = !r.decided ? 'muted' : r.acc >= 0.55 ? 'positive' : r.acc < 0.4 ? 'negative' : '';
      const barPct = Math.max(6, Math.round((r.score / maxScore) * 100));
      return `
        <div class="daily-ranking-row ${rankClass}" data-source="${_dailyEscape(r.source)}" title="${_dailyEscape(r.source)} — ${_dailyEscape(_dailySourcePastSummary(r.source, allPicks))}" onclick="_dailyJumpToSourceFromEl(this)" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();_dailyJumpToSourceFromEl(this);}">
          <span class="daily-ranking-rank">${rank}</span>
          <span class="daily-ranking-source">${_dailyEscape(r.source)}</span>
          <span class="daily-ranking-metric daily-ranking-hide-sm">${record}</span>
          <span class="daily-ranking-metric ${uClass}">${uStr}</span>
          <span class="daily-ranking-metric ${accClass} daily-ranking-hide-sm">${accStr}</span>
          <span class="daily-ranking-metric">
            <div class="daily-ranking-bar-wrap"><div class="daily-ranking-bar-fill" style="width:${barPct}%"></div></div>
            <div style="margin-top:4px;font-size:11px;color:var(--muted)">${r.score}</div>
          </span>
        </div>`;
    }).join('');

    const rankingHtml = ranking.length > 3 ? `
      <div class="daily-section-head">
        <div class="daily-section-title">Full Ranking · All Sources Today</div>
        <div class="daily-section-sub">Click a row to filter the pick log by that source</div>
      </div>
      <div class="daily-ranking-list">
        ${rankingHeader}
        ${rankingRows}
      </div>` : '';

    // Today's slate grouped by game
    const groups = _dailyGroupByGame(todayPicks);
    const slateHtml = `
      <div class="daily-section-head">
        <div class="daily-section-title">Today's Slate · ${groups.length} Game${groups.length === 1 ? '' : 's'}</div>
        <div class="daily-section-sub">Pending games bubble to the top · results update as they come in</div>
      </div>
      <div class="daily-slate-grid">
        ${groups.map(g => {
          const verdict = _dailyGroupVerdict(g.picks);
          const groupPL = g.picks.reduce((s, p) => s + (Number(p.pl) || 0), 0);
          const groupPLStr = (groupPL >= 0 ? '+' : '') + groupPL.toFixed(2) + 'u';
          const groupPLClass = groupPL > 0 ? 'positive' : groupPL < 0 ? 'negative' : 'neutral';
          const pendingCount = g.picks.filter(p => p.result === 'pending').length;
          const groupDecided = g.picks.filter(p => p.result !== 'pending').length;
          const startIso = g.picks.map(p => p.start_time).filter(Boolean).sort()[0] || null;
          const startLabel = startIso ? formatStartLabel(startIso) : (pendingCount ? 'TBD' : 'Done');
          return `
            <div class="daily-slate-card decided-${verdict.key}">
              <div class="daily-slate-head">
                <div>
                  <div class="daily-slate-game">${_dailyEscape(g.label)}</div>
                  <div class="daily-slate-meta">${_dailyEscape(g.sport)} · ${_dailyEscape(startLabel)} · ${g.picks.length} pick${g.picks.length === 1 ? '' : 's'}</div>
                </div>
                <div class="daily-slate-badge ${verdict.key}">${verdict.label}</div>
              </div>
              <div class="daily-slate-picks">
                ${g.picks.map(p => {
                  const rClass = `result-${p.result}`;
                  const oddsDisplay = formatOddsOrProbabilityDisplay(p.odds, p.probability);
                  const plDisplay = p.result === 'pending' ? '—' : ((p.pl >= 0 ? '+' : '') + (Number(p.pl) || 0).toFixed(2) + 'u');
                  const plClass = (Number(p.pl) || 0) > 0 ? 'positive' : (Number(p.pl) || 0) < 0 ? 'negative' : 'neutral';
                  const resultLabel = p.result === 'pending' ? 'PENDING' : p.result.toUpperCase();
                  return `
                    <div class="daily-slate-pick ${rClass}">
                      <span class="daily-slate-source" title="${_dailyEscape(p.source || '')}">${_dailyEscape(p.source || 'Unknown')}</span>
                      <span class="daily-slate-text">${_dailyEscape(p.pick || '')}</span>
                      <span class="daily-slate-odds">${_dailyEscape(oddsDisplay)}</span>
                      <span class="daily-slate-result ${p.result}">${resultLabel}${p.result !== 'pending' ? ' · ' + `<span class="${plClass}">${_dailyEscape(plDisplay)}</span>` : ''}</span>
                    </div>`;
                }).join('')}
              </div>
              <div class="daily-slate-footer">
                <span>${pendingCount ? `${pendingCount} live / ` : ''}${groupDecided} decided</span>
                <span class="daily-slate-pl ${groupPLClass}">${groupPLStr}</span>
              </div>
            </div>`;
        }).join('')}
      </div>`;

    container.innerHTML = heroHtml + podiumHtml + rankingHtml + `<div class="daily-divider"></div>` + slateHtml;
  } catch (err) {
    console.error('Failed to render daily tab:', err);
    container.innerHTML = `
      <div class="section-title clean-title">Daily</div>
      <div class="empty-state">Could not load daily dashboard right now. Please refresh and try again.</div>
    `;
  }
}

function _dailyJumpToSourceFromEl(el) {
  const source = el && el.getAttribute ? el.getAttribute('data-source') : null;
  if (!source) return;
  if (typeof activeFilter !== 'undefined') {
    activeFilter = source;
  }
  switchTab('home');
  if (typeof render === 'function') render();
}

// ── Pick Log (Home tab, bottom panel) ──
// Renders the "Grade & Review" panel: filter chips (range + sport), running
// counters, and a scrollable list of pick rows with a W/L/P/PENDING/DELETE
// dropdown on each row so picks can be graded from the Home tab.
function renderHomePulse() {
  // Home tab is back to the classic hero+calendar+feed layout; the only
  // pulse-era holdover on this page is the PICK LOG (Grade & Review) panel.
  // Bail early if the log isn't in the DOM (e.g. different tab rendered).
  const logRowsEl = document.getElementById('pulse-log-rows');
  if (!logRowsEl) return;

  let picks = [];
  try { picks = (typeof getPicks === 'function') ? getPicks() : []; }
  catch (e) { picks = []; }
  if (!Array.isArray(picks)) picks = [];

  // ── Pick Log (grading + history) ──
  const logSportsEl = document.getElementById('pulse-log-sports');
  const logMetaEl = document.getElementById('pulse-log-meta');
  const logRangeEl = document.getElementById('pulse-log-range');
  if (!logSportsEl) return;

  // Reflect active range chip
  if (logRangeEl) {
    logRangeEl.querySelectorAll('.pulse-log-chip').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-pulse-range') === pulseLogRange);
    });
  }

  // Range filter
  let pool = picks.slice();
  const todayDate = new Date(); todayDate.setHours(23, 59, 59, 999);
  if (pulseLogRange === 'pending') {
    pool = pool.filter(p => p.result === 'pending');
  } else if (pulseLogRange === 'today') {
    const todayKey = getTodayDateKey();
    pool = pool.filter(p => getPickDateKey(p.date || p.game_date || p.Date) === todayKey);
  } else if (pulseLogRange === '7d' || pulseLogRange === '30d') {
    const days = pulseLogRange === '7d' ? 7 : 30;
    const cutoff = new Date(); cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - (days - 1));
    pool = pool.filter(p => {
      const d = parsePickDateLabel(p.date || p.game_date || p.Date);
      return d && d >= cutoff && d <= todayDate;
    });
  }

  // Dynamic sport chips (from the pool)
  const sportSet = new Set(pool.map(p => String(p.sport || 'OTHER').toUpperCase()));
  const sportsInView = ['ALL', ...[...sportSet].sort()];
  if (!sportsInView.includes(pulseLogSport)) pulseLogSport = 'ALL';
  logSportsEl.innerHTML = sportsInView.map(sp =>
    `<button type="button" class="pulse-log-chip ${pulseLogSport === sp ? 'active' : ''}" onclick="setPulseLogSport('${_dailyEscape(sp).replace(/'/g, "\\'")}')">${_dailyEscape(sp)}</button>`
  ).join('');

  // Sport filter
  let filtered = pool;
  if (pulseLogSport !== 'ALL') {
    filtered = pool.filter(p => String(p.sport || 'OTHER').toUpperCase() === pulseLogSport);
  }

  // Sort: pending first (earliest start), then decided most-recent-first
  filtered.sort((a, b) => {
    const aPending = a.result === 'pending';
    const bPending = b.result === 'pending';
    if (aPending !== bPending) return aPending ? -1 : 1;
    const aDate = parsePickDateLabel(a.date || a.game_date || a.Date);
    const bDate = parsePickDateLabel(b.date || b.game_date || b.Date);
    if (aPending) {
      const at = a.start_time ? new Date(a.start_time).getTime() : (aDate ? aDate.getTime() : Infinity);
      const bt = b.start_time ? new Date(b.start_time).getTime() : (bDate ? bDate.getTime() : Infinity);
      if (at !== bt) return at - bt;
    } else {
      const aT = aDate ? aDate.getTime() : 0;
      const bT = bDate ? bDate.getTime() : 0;
      if (aT !== bT) return bT - aT;
    }
    return (b.id || 0) - (a.id || 0);
  });

  // Cap for DOM sanity
  const CAP = 400;
  const visible = filtered.slice(0, CAP);

  // Meta counters (based on the full filtered set, not just the capped slice)
  const visPending = filtered.filter(p => p.result === 'pending').length;
  const visWins = filtered.filter(p => p.result === 'win').length;
  const visLosses = filtered.filter(p => p.result === 'loss').length;
  const visPushes = filtered.filter(p => p.result === 'push').length;
  const visNet = filtered
    .filter(p => p.result !== 'pending')
    .reduce((s, p) => s + (Number(p.pl) || 0), 0);
  const netClass = visNet > 0 ? 'positive' : visNet < 0 ? 'negative' : '';
  const netStr = `${visNet >= 0 ? '+' : ''}${visNet.toFixed(2)}u`;
  const recordStr = `${visWins}-${visLosses}${visPushes ? '-' + visPushes : ''}`;
  if (logMetaEl) {
    logMetaEl.innerHTML = `
      <span class="pulse-log-meta-item"><strong class="${visPending ? 'pending' : ''}">${visPending}</strong> <small>PENDING</small></span>
      <span class="pulse-log-meta-item"><strong>${_dailyEscape(recordStr)}</strong> <small>RECORD</small></span>
      <span class="pulse-log-meta-item"><strong class="${netClass}">${_dailyEscape(netStr)}</strong> <small>NET</small></span>
    `;
  }

  if (!visible.length) {
    const hint = pulseLogRange === 'pending'
      ? 'No pending picks — everything is graded.'
      : 'No picks match these filters.';
    logRowsEl.innerHTML = `<div class="pulse-log-empty">${_dailyEscape(hint)}</div>`;
  } else {
    logRowsEl.innerHTML = visible.map(p => {
      const sportKey = String(p.sport || 'OTHER').toUpperCase();
      let source = p.source || 'Unknown';
      try { if (typeof getRankingSourceKey === 'function') source = getRankingSourceKey(p) || source; }
      catch (e) { /* noop */ }
      let oddsDisplay = '';
      try {
        if (typeof formatOddsOrProbabilityDisplay === 'function') {
          oddsDisplay = formatOddsOrProbabilityDisplay(p.odds, p.probability) || '';
        } else if (p.odds != null) {
          oddsDisplay = String(p.odds);
        }
      } catch (e) { /* noop */ }
      const pl = Number(p.pl) || 0;
      const isPending = p.result === 'pending';
      const units = Number(p.units) || 0;
      const plDisplay = isPending
        ? `${units.toFixed(2)}u risk`
        : `${pl >= 0 ? '+' : ''}${pl.toFixed(2)}u`;
      const plCls = isPending ? 'neutral' : pl > 0 ? 'positive' : pl < 0 ? 'negative' : 'neutral';
      const dateLabel = p.date || '';
      const control = renderPickResultControl(p);
      const metaBits = [dateLabel, oddsDisplay, `${units}u`].filter(Boolean).join(' · ');
      return `
        <div class="pulse-log-row result-${p.result}">
          <span class="pulse-log-sport">${_dailyEscape(sportKey)}</span>
          <div class="pulse-log-body">
            <div class="pulse-log-source">${_dailyEscape(source)}</div>
            <div class="pulse-log-pick" title="${_dailyEscape(p.pick || '')}">${_dailyEscape(p.pick || '')}</div>
            <div class="pulse-log-date">${_dailyEscape(metaBits)}</div>
          </div>
          <div class="pulse-log-pl ${plCls}">${_dailyEscape(plDisplay)}</div>
          <div class="pulse-log-control">${control}</div>
        </div>`;
    }).join('');
  }
}

function setPulseLogRange(range) {
  const allowed = ['pending', 'today', '7d', '30d', 'all'];
  if (!allowed.includes(range)) return;
  pulseLogRange = range;
  // Reset sport filter when range changes, since available sports may shift
  pulseLogSport = 'ALL';
  renderHomePulse();
}

function setPulseLogSport(sport) {
  pulseLogSport = String(sport || 'ALL');
  renderHomePulse();
}

function renderTrends() {
  const todayLabel = formatTodayPickDateLabel();
  const container = document.getElementById('trends-container');
  const includedSports = new Set(['NBA', 'MLB']);
  const pendingToday = getPicks().filter(p => p.result === 'pending' && isTodayPickDateLabel(p.date));
  const picks = pendingToday.filter(p => includedSports.has(p.sport));
  const trendPicks = picks.filter(p => !(p.sport === 'NBA' && isNbaPropsSource(p.source)));
  const nbaPropsPicks = pendingToday
    .filter(p => p.sport === 'NBA' && isNbaPropsSource(p.source))
    .map(p => ({ ...p, probabilityPct: normalizeProbabilityValue(p.probability) == null ? null : normalizeProbabilityValue(p.probability) * 100 }))
    .filter(p => p.probabilityPct != null && p.probabilityPct >= 60);

  if (!trendPicks.length && !nbaPropsPicks.length) {
    container.innerHTML = `<div class="empty-state">No pending NBA/MLB trends for ${todayLabel}</div>`;
    return;
  }

  const gameMap = {};
  trendPicks.forEach(p => {
    const gameLabel = deriveGameLabel(p, trendPicks);
    if (!gameLabel) return;
    const gameKey = `${p.sport}::${canonicalGameKeyFromMatchup(gameLabel)}`;
    if (!gameMap[gameKey]) {
      gameMap[gameKey] = {
        key: gameKey,
        sport: p.sport,
        gameLabel,
        picks: [],
        sources: new Set(),
        sideVotes: [],
        totalVotes: [],
        sidePasses: 0,
        totalPasses: 0,
        sidePassSources: [],
        totalPassSources: [],
      };
    }

    gameMap[gameKey].picks.push(p);
    gameMap[gameKey].sources.add(p.source);
    const spread = parseSpreadSignal(p.pick);
    const moneyline = spread ? null : parseMoneylineSignal(p.pick);
    // Normalize team names through sport-aware lookup so 'ORIOLES' and 'BALTIMORE ORIOLES'
    // collapse to the same canonical key in summarizeMarketVotes.
    const canonicalizeSideTeam = (rawTeam) => {
      if (!rawTeam) return rawTeam;
      const sport = String(p.sport || '').toUpperCase();
      if (sport === 'MLB') {
        const full = normalizeMLBTeam(rawTeam);
        return full ? full.toUpperCase() : rawTeam;
      }
      if (sport === 'NBA') {
        const full = normalizeNBATeam(rawTeam);
        return full ? full.toUpperCase() : rawTeam;
      }
      if (sport === 'WNBA') {
        const full = normalizeWNBATeam(rawTeam);
        return full ? full.toUpperCase() : rawTeam;
      }
      return rawTeam;
    };
    if (spread) gameMap[gameKey].sideVotes.push({ source: p.source, origin: 'Ledger pick', ...spread, team: canonicalizeSideTeam(spread.team) });
    if (moneyline) gameMap[gameKey].sideVotes.push({ source: p.source, origin: 'Ledger pick', ...moneyline, team: canonicalizeSideTeam(moneyline.team) });
    const total = parseTotalSignal(p.pick);
    if (total) gameMap[gameKey].totalVotes.push({ source: p.source, origin: 'Ledger pick', ...total });
  });

  const todayLiveGameKeys = new Set(Object.keys(gameMap));
  const manualSignals = getManualModelSignalsForToday()
    .filter(sig => includedSports.has(sig.sport))
    .filter(sig => todayLiveGameKeys.has(`${sig.sport}::${canonicalGameKeyFromMatchup(sig.matchup)}`));

  manualSignals.forEach(sig => {
    const gameKey = `${sig.sport}::${canonicalGameKeyFromMatchup(sig.matchup)}`;
    if (!gameMap[gameKey]) {
      gameMap[gameKey] = {
        key: gameKey,
        sport: sig.sport,
        gameLabel: sig.matchup.replace(/\s*@\s*/g, ' vs '),
        picks: [],
        sources: new Set(),
        sideVotes: [],
        totalVotes: [],
        sidePasses: 0,
        totalPasses: 0,
        sidePassSources: [],
        totalPassSources: [],
      };
    }
    gameMap[gameKey].sources.add(sig.source);
    if (sig.market === 'spread') {
      if (sig.decision === 'BET') gameMap[gameKey].sideVotes.push({ source: sig.source, origin: 'Manual model sheet', team: normalizeTrendTeam(sig.team), line: sig.line });
      else {
        gameMap[gameKey].sidePasses += 1;
        gameMap[gameKey].sidePassSources.push({ source: sig.source, origin: 'Manual model sheet' });
      }
    }
    if (sig.market === 'side') {
      if (sig.decision === 'BET') gameMap[gameKey].sideVotes.push({ source: sig.source, origin: 'Manual model sheet', team: normalizeTrendTeam(sig.team), line: sig.line ?? null });
      else {
        gameMap[gameKey].sidePasses += 1;
        gameMap[gameKey].sidePassSources.push({ source: sig.source, origin: 'Manual model sheet' });
      }
    }
    if (sig.market === 'total') {
      if (sig.decision === 'BET') gameMap[gameKey].totalVotes.push({ source: sig.source, origin: 'Manual model sheet', side: sig.side, line: sig.line });
      else {
        gameMap[gameKey].totalPasses += 1;
        gameMap[gameKey].totalPassSources.push({ source: sig.source, origin: 'Manual model sheet' });
      }
    }
  });

  const games = Object.values(gameMap).map(g => {
    const sideSummary = summarizeMarketVotes(g.sideVotes, 'side');
    const totalSummary = summarizeMarketVotes(g.totalVotes, 'total');
    const strongSignals = [sideSummary, totalSummary].filter(s => s.tone === 'strong').length;
    const splitSignals = [sideSummary, totalSummary].filter(s => s.tone === 'split' && s.totalVotes >= 2).length;
    const cardTone = strongSignals > 0 ? 'strong' : splitSignals > 0 ? 'split' : 'lean';
    const threeWay = [sideSummary, totalSummary].some(s => s.tone === 'strong' && s.consensusCount >= 3);
    return { ...g, sideSummary, totalSummary, strongSignals, splitSignals, cardTone, threeWay };
  }).sort((a, b) => {
    if (a.sport !== b.sport) return a.sport.localeCompare(b.sport);
    if (b.strongSignals !== a.strongSignals) return b.strongSignals - a.strongSignals;
    if (a.splitSignals !== b.splitSignals) return a.splitSignals - b.splitSignals;
    return a.gameLabel.localeCompare(b.gameLabel);
  });

  const bySport = games.reduce((acc, g) => {
    if (!acc[g.sport]) acc[g.sport] = [];
    acc[g.sport].push(g);
    return acc;
  }, {});

  const fullConsensus = games.filter(g => g.threeWay).length;
  const conflictGames = games.filter(g => g.splitSignals > 0).length;
  const strongGames = games.filter(g => g.strongSignals > 0).length;
  const propsBuckets = getNbaPropsBuckets(nbaPropsPicks);
  const props80to90Count = propsBuckets.find(b => b.key === '80-90')?.picks.length || 0;
  const props90to100Count = propsBuckets.find(b => b.key === '90-100')?.picks.length || 0;

  container.innerHTML = `
    <div class="trend-head">
      <div class="trend-title">Consensus Radar</div>
      <div class="trend-subtitle">${todayLabel} only • Sports: NBA + MLB • Sources blended with manual model sheet</div>
    </div>
    <div class="trend-summary-grid">
      <div class="trend-summary-box"><div class="trend-summary-val">${strongGames}</div><div class="trend-summary-label">STRONG SPOTS</div></div>
      <div class="trend-summary-box"><div class="trend-summary-val">${fullConsensus}</div><div class="trend-summary-label">3-WAY AGREEMENTS</div></div>
      <div class="trend-summary-box"><div class="trend-summary-val">${conflictGames}</div><div class="trend-summary-label">CONFLICT GAMES</div></div>
      <div class="trend-summary-box"><div class="trend-summary-val">${props80to90Count}</div><div class="trend-summary-label">80-90%</div></div>
      <div class="trend-summary-box"><div class="trend-summary-val">${props90to100Count}</div><div class="trend-summary-label">90-100%</div></div>
    </div>
    ${Object.entries(bySport).map(([sport, sportGames]) => `
      <div class="trend-sport-section">
        <div class="trend-sport-title">${sport}</div>
        <div class="trend-sport-meta">${sportGames.length} games with pending signals</div>
        <div class="trend-board">
          ${sportGames.map(g => `
            <div class="trend-game-card ${g.cardTone} ${expandedTrendGameKeys.has(g.key) ? 'expanded' : ''}" data-game-key="${g.key}" onclick="toggleTrendGameFromEl(this)" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleTrendGameFromEl(this)}">
              <div class="trend-game-head">
                <div>
                  <div class="trend-game-name">${g.gameLabel}</div>
                  <div class="trend-game-meta">${g.sources.size} sources active</div>
                </div>
                <div class="trend-strength-pill ${g.cardTone}">${g.cardTone === 'strong' ? 'HIGH ALIGNMENT' : g.cardTone === 'split' ? 'MIXED SIGNALS' : 'LEAN'}</div>
              </div>
              ${buildMarketBlock('SIDE', g.sideSummary, g.sidePasses)}
              ${buildMarketBlock('TOTAL', g.totalSummary, g.totalPasses)}
              <div class="trend-click-hint">Click card for source provenance and deeper signal context</div>
              <div class="trend-deep-dive" onclick="event.stopPropagation()">
                <div class="trend-deep-title">WHERE THIS CAME FROM</div>
                <div class="trend-deep-note">Signal details are generated from today\'s pending ledger picks plus active manual model-sheet entries. This panel does not fabricate external writeups.</div>
                ${buildTrendEvidenceBlock('SIDE', g.sideVotes, g.sidePassSources, 'side')}
                ${buildTrendEvidenceBlock('TOTAL', g.totalVotes, g.totalPassSources, 'total')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('')}
    ${Object.keys(bySport).length ? '' : '<div class="trend-subsection-empty">No pending game consensus cards right now.</div>'}
    <div class="trend-sport-section">
      <div class="trend-sport-title">NBA Player Props</div>
      <div class="trend-sport-meta">Top props from 60%+ confidence, split by range</div>
      <div class="trend-board">
        ${propsBuckets.map(bucket => `
          <div class="trend-game-card trend-props-card ${bucket.min >= 80 ? 'strong' : 'lean'} ${expandedTrendPropsKeys.has(bucket.key) ? 'expanded' : ''}" data-props-key="${bucket.key}" onclick="toggleTrendPropsFromEl(this)" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleTrendPropsFromEl(this)}">
            <div class="trend-game-head">
              <div>
                <div class="trend-game-name">${bucket.label}</div>
                <div class="trend-game-meta">${bucket.picks.length} top props</div>
              </div>
              <div class="trend-strength-pill ${bucket.min >= 80 ? 'strong' : 'lean'}">${bucket.label}</div>
            </div>
            <div class="trend-market">
              <div class="trend-market-row">
                <div class="trend-market-label">CONFIDENCE BAND</div>
                <div class="trend-market-signal">${bucket.label}</div>
              </div>
              <div class="trend-market-detail">${bucket.picks.length ? `Showing ${bucket.picks.length} pending NBA props.` : 'No props in this range yet.'}</div>
            </div>
            <div class="trend-click-hint">Click card to view props in this confidence band</div>
            <div class="trend-deep-dive" onclick="event.stopPropagation()">
              <div class="trend-deep-title">TOP PROPS (${bucket.label})</div>
              <div class="trend-evidence-list">
                ${bucket.picks.length ? bucket.picks.map(p => `
                  <div class="trend-evidence-item">
                    <div class="trend-evidence-row">
                      <span class="trend-evidence-source">${p.source}</span>
                      <span class="trend-evidence-origin">${p.probabilityPct.toFixed(1)}%</span>
                    </div>
                    <div class="trend-evidence-text">${p.pick}</div>
                  </div>
                `).join('') : '<div class="trend-market-detail">No pending props at this confidence level.</div>'}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ── Source Rankings Chooser ──
const SOURCE_CHOOSER_STORAGE_KEY = 'pickledger_visible_ranking_sources';
const SOURCE_CHOOSER_CATALOG_KEY = 'pickledger_visible_ranking_sources_catalog';
const DEPLOYED_RANKING_SOURCES = [
  'MLB Model',
  'MLB Inning',
  'MLB First Five',
  'NBA New',
  'NBA Playoffs',
  'WNBA Model',
  'SportyTrader',
  'SportsGambler',
];
const DEPLOYED_RANKING_SOURCE_SET = new Set(DEPLOYED_RANKING_SOURCES);
let sourceChooserVisibleSources = null;
let sourceChooserBound = false;
let sourceChooserOpen = false;

function readStoredArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    return Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function saveVisibleRankingSources(set) {
  try {
    localStorage.setItem(SOURCE_CHOOSER_STORAGE_KEY, JSON.stringify([...set]));
  } catch (_) {}
}

function getVisibleRankingSources(sourceNames) {
  const allSources = [...new Set((Array.isArray(sourceNames) ? sourceNames : [])
    .map(source => String(source || '').trim())
    .filter(source => source && DEPLOYED_RANKING_SOURCE_SET.has(source)))];
  const allSourceSet = new Set(allSources);
  const stored = readStoredArray(SOURCE_CHOOSER_STORAGE_KEY);
  if (!sourceChooserVisibleSources) {
    sourceChooserVisibleSources = Array.isArray(stored)
      ? new Set(stored.map(source => String(source || '').trim()).filter(source => allSourceSet.has(source)))
      : new Set(allSources);
  }

  let knownSources = readStoredArray(SOURCE_CHOOSER_CATALOG_KEY);
  if (!knownSources) knownSources = Array.isArray(stored) ? allSources : [];
  const knownSourceSet = new Set(knownSources.map(source => String(source || '').trim()).filter(Boolean));
  let changed = false;

  allSources.forEach(source => {
    if (!knownSourceSet.has(source) && !sourceChooserVisibleSources.has(source)) {
      sourceChooserVisibleSources.add(source);
      changed = true;
    }
  });

  [...sourceChooserVisibleSources].forEach(source => {
    if (!allSourceSet.has(source)) {
      sourceChooserVisibleSources.delete(source);
      changed = true;
    }
  });

  try {
    localStorage.setItem(SOURCE_CHOOSER_CATALOG_KEY, JSON.stringify(allSources));
  } catch (_) {}
  if (changed) saveVisibleRankingSources(sourceChooserVisibleSources);
  return sourceChooserVisibleSources;
}

function setSourceChooserOpen(open) {
  sourceChooserOpen = Boolean(open);
  const trigger = document.getElementById('source-chooser-trigger');
  const dd = document.getElementById('source-chooser-dropdown');
  if (trigger) trigger.classList.toggle('open', sourceChooserOpen);
  if (dd) dd.classList.toggle('open', sourceChooserOpen);
}

function initSourceChooserInteractions() {
  if (sourceChooserBound) return;
  const trigger = document.getElementById('source-chooser-trigger');
  const wrap = document.getElementById('source-chooser-wrap');
  const dd = document.getElementById('source-chooser-dropdown');
  if (!trigger || !wrap || !dd) return;
  sourceChooserBound = true;

  trigger.addEventListener('click', function(e) {
    e.stopPropagation();
    setSourceChooserOpen(!sourceChooserOpen);
  });

  dd.addEventListener('click', function(e) {
    e.stopPropagation();
    const item = e.target.closest('.model-chooser-item[data-source-name]');
    if (!item) return;
    const source = String(item.getAttribute('data-source-name') || '').trim();
    if (!source) return;
    if (!sourceChooserVisibleSources) sourceChooserVisibleSources = new Set();
    if (sourceChooserVisibleSources.has(source)) sourceChooserVisibleSources.delete(source);
    else sourceChooserVisibleSources.add(source);
    sourceChooserOpen = true;
    saveVisibleRankingSources(sourceChooserVisibleSources);
    render();
  });

  document.addEventListener('click', function(e) {
    if (!wrap.contains(e.target)) setSourceChooserOpen(false);
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') setSourceChooserOpen(false);
  });
}

function renderSourceChooser(stats, visibleSet) {
  const dd = document.getElementById('source-chooser-dropdown');
  const countEl = document.getElementById('source-chooser-count');
  if (!dd) return;
  const visibleCount = visibleSet ? visibleSet.size : 0;
  if (countEl) countEl.textContent = visibleCount;

  if (!Array.isArray(stats) || !stats.length) {
    dd.innerHTML = '<div class="model-chooser-section-label">NO RANKED SOURCES</div>';
  } else {
    dd.innerHTML = '<div class="model-chooser-section-label">AVAILABLE SOURCES</div>' +
      stats.map(function(s) {
        const selected = visibleSet && visibleSet.has(s.source) ? ' selected' : '';
        const pending = s.pending > 0 ? ' &bull; ' + s.pending + ' pending' : '';
        const desc = s.wins + '-' + s.losses + ' record &bull; ' + s.count + ' picks' + pending;
        return '<div class="model-chooser-item' + selected + '" data-source-name="' + _dailyEscape(s.source) + '">' +
          '<span class="model-chooser-item-icon">' + (s.source && s.source.toUpperCase().includes('MLB') ? '&#9918;' : '&#127936;') + '</span>' +
          '<div class="model-chooser-item-info">' +
            '<div class="model-chooser-item-name">' + _dailyEscape(s.source) + '</div>' +
            '<div class="model-chooser-item-desc">' + desc + '</div>' +
          '</div>' +
          '<div class="model-chooser-cb"><span class="model-chooser-cb-check">&#10003;</span></div>' +
        '</div>';
      }).join('');
  }

  initSourceChooserInteractions();
  setSourceChooserOpen(sourceChooserOpen);
}

// ── Render ──
function render() {
  // Keep the rankings tab in sync with live grades. rankingsLedgerState
  // is the source for getRankingsPicks(); without this refresh it only
  // updates when the debounced ledger sync fires, so the leaderboard
  // lags behind the header/home tab after a grade change.
   
  let picks = getPicks();
  const gameTimes = getGameTimes();

  // Re-normalize MLB/WNBA game keys on every render so existing picks get fixed.
  if (typeof normalizeMLBTeam === 'function' && typeof normalizeWNBATeam === 'function') {
    picks = picks.map(p => {
      const sport = (p.sport || '').toUpperCase();
      if (sport !== 'MLB' && sport !== 'WNBA') return p;
      const normalizeTeam = sport === 'WNBA' ? normalizeWNBATeam : normalizeMLBTeam;
      let t1 = normalizeTeam(p.away_team || p.team1 || '');
      let t2 = normalizeTeam(p.home_team || p.team2 || '');
      if (!t1 || !t2) {
        const parsedKey = extractGameKey(p.pick, p.sport);
        const parts = String(parsedKey || '').split(/\s+(?:vs|@)\s+/i).map(s => s.trim()).filter(Boolean);
        if (parts.length === 2) {
          t1 = t1 || normalizeTeam(parts[0]);
          t2 = t2 || normalizeTeam(parts[1]);
        }
      }
      const newKey = [t1, t2].filter(Boolean).sort((a, b) => a.localeCompare(b)).join(' vs ');
      if (newKey && newKey !== ' vs ') {
        return { ...p, _gameKey: newKey };
      }
      return p;
    });
  }

  // Leaderboard (Rankings tab)
  const rankingsPicks = getRankingsPicks();
  const rankedPicks = getRankingEligiblePicks(rankingsPicks);
  const rankingSources = [...new Set(rankedPicks.map(p => getRankingSourceKey(p)))];
  const stats = rankingSources.map(s=>getSourceStats(s, rankedPicks)).filter(s=>s&&s.eligible);
  stats.sort((a,b)=>b.composite-a.composite);
  // Source chooser shows the union of (eligible-in-leaderboard) ∪ (known
  // model sources) so users can opt in/out of, e.g., MLB First Five before
  // it has 3 graded picks. Stubs render with a 0-0 record badge.
  const KNOWN_PICKLEDGER_SOURCES = DEPLOYED_RANKING_SOURCES;
  const knownStatsSources = new Set(stats.map(s => s.source));
  const chooserStats = [...stats];
  KNOWN_PICKLEDGER_SOURCES.forEach(name => {
    if (knownStatsSources.has(name)) return;
    chooserStats.push({
      source: name,
      wins: 0, losses: 0, pending: 0, count: 0,
      acc: 0, accScore: 0, roi: 0, roiScore: 0, netUnits: 0,
      consistencyScore: 0, composite: 0, eligible: false,
    });
  });
  chooserStats.sort((a, b) => (b.composite - a.composite) || String(a.source).localeCompare(String(b.source)));
  const visibleRankingSources = getVisibleRankingSources(chooserStats.map(s => s.source));
  const deployedStats = stats.filter(s => DEPLOYED_RANKING_SOURCE_SET.has(s.source));
  const visibleStats = deployedStats.filter(s => visibleRankingSources.has(s.source));
  const deployedChooserStats = chooserStats.filter(s => DEPLOYED_RANKING_SOURCE_SET.has(s.source));
  renderSourceChooser(deployedChooserStats, visibleRankingSources);
  const lb = document.getElementById('leaderboard');
  if(!deployedStats.length) lb.innerHTML='<div class="empty-state" style="grid-column:1/-1">Need 3+ decided picks per deployed source to rank</div>';
  else if(!visibleStats.length) lb.innerHTML='<div class="empty-state" style="grid-column:1/-1">Choose at least one source to show rankings</div>';
  else lb.innerHTML=visibleStats.map((s,i)=>{
    const rank=i+1, rc=rank<=3?`rank-${rank}`:'', c=getColor(s.composite);
    const roiStr=(s.roi>=0?'+':'')+(s.roi*100).toFixed(1)+'%', netStr=(s.netUnits>=0?'+':'')+s.netUnits+'u';
    const pn=s.pending>0?` &bull; ${s.pending} pending`:'';
    const recordLines = getSourcePastRecordLines(s.source, rankingsPicks);
    return `<div class="source-card ${rc} ${expandedSourceKeys.has(s.source) ? 'expanded' : ''}" data-source-key="${String(s.source).replace(/"/g, '&quot;')}" onclick="toggleSourceCardFromEl(this)" role="button" tabindex="0" aria-expanded="${expandedSourceKeys.has(s.source) ? 'true' : 'false'}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleSourceCardFromEl(this)}"><div class="card-rank">${rank}</div><div class="card-name">${s.source}</div>
      <div class="score-bar-wrap"><div class="score-label"><span>ACCURACY</span><span class="score-val">${(s.acc*100).toFixed(1)}% (${s.wins}-${s.losses})</span></div><div class="bar-bg"><div class="bar-fill bar-acc" style="width:${s.accScore}%"></div></div></div>
      <div class="score-bar-wrap"><div class="score-label"><span>ROI</span><span class="score-val" style="color:${s.roi>=0?'var(--win)':'var(--loss)'}">${roiStr} (${netStr})</span></div><div class="bar-bg"><div class="bar-fill bar-roi" style="width:${s.roiScore}%"></div></div></div>
      <div class="score-bar-wrap"><div class="score-label"><span>CONSISTENCY</span><span class="score-val">${s.consistencyScore.toFixed(0)}/100</span></div><div class="bar-bg"><div class="bar-fill bar-score" style="width:${s.consistencyScore}%"></div></div></div>
      <div class="algo-score"><div class="algo-score-val" style="color:${c}">${s.composite}</div><div class="algo-score-info">COMPOSITE SCORE<br>${s.count} picks${pn}<br>CLICK TO SEE PAST RECORD</div></div>
      <div class="source-click-hint">Click card to expand past performance</div>
      <div class="source-deep-dive" onclick="event.stopPropagation()">
        <div class="trend-deep-title">PAST RECORD</div>
        <div class="source-record-list">
          ${recordLines.map(line => `<div class="source-record-item"><div class="source-record-label">${line.label}</div><div class="source-record-value">${line.text}</div></div>`).join('')}
        </div>
      </div></div>`;
  }).join('');

  const sportBoard = document.getElementById('sport-board');
  const decidedBySport = {};
  rankingsPicks.filter(p=>p.result!=='pending').forEach(p => {
    if(!decidedBySport[p.sport]) decidedBySport[p.sport] = [];
    decidedBySport[p.sport].push(p);
  });
  const sportStats = Object.entries(decidedBySport).map(([sport, sp]) => {
    const w = sp.filter(p=>p.result==='win').length;
    const l = sp.filter(p=>p.result==='loss').length;
    const net = sp.reduce((s,p)=>s+p.pl,0);
    const risk = sp.filter(p=>p.result!=='push').reduce((s,p)=>s+p.units,0);
    const roi = risk>0 ? (net/risk*100) : 0;
    return { sport, count: sp.length, w, l, net, roi };
  }).sort((a,b)=>b.net-a.net);
  if(!sportStats.length) {
    sportBoard.innerHTML = '<div class="empty-state" style="grid-column:1/-1">No decided picks yet</div>';
  } else {
    sportBoard.innerHTML = sportStats.map(s => {
      const pc = s.net>0 ? 'positive' : s.net<0 ? 'negative' : 'neutral';
      const roiClass = s.roi>=0 ? 'positive' : 'negative';
      return `<div class="sport-card">
        <div class="sport-name">${s.sport}</div>
        <div class="sport-meta">${s.w}-${s.l} record<br>${s.count} decided picks</div>
        <div class="sport-units ${pc}">${s.net>=0?'+':''}${s.net}u</div>
        <div class="sport-meta ${roiClass}">ROI ${s.roi>=0?'+':''}${s.roi.toFixed(1)}%</div>
      </div>`;
    }).join('');
  }

  // Filters (Home tab)
  const PRIMARY_SPORTS = ['ALL', 'MLB', 'NBA', 'WNBA'];
  const sports = [...new Set(picks
    .map(p => String(p.sport || '').toUpperCase())
    .filter(s => s && s !== 'EPL'))].sort((a, b) => a.localeCompare(b));
  const sources = [...new Set(picks
    .map(p => getRankingSourceKey(p))
    .filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
  const moreFilters = [...new Set([
    ...sports.filter(s => !PRIMARY_SPORTS.includes(s)),
    ...sources.filter(s => !PRIMARY_SPORTS.includes(String(s).toUpperCase())),
  ])];
  if (![...PRIMARY_SPORTS, ...moreFilters].includes(activeFilter)) activeFilter = 'ALL';
  const moreHasActive = moreFilters.includes(activeFilter);
  let filterHtml = PRIMARY_SPORTS.map(f=>
    `<button class="filter-btn ${activeFilter===f?'active':''}" data-filter="${_dailyEscape(f)}" onclick="setActiveFilterFromEl(this)">${_dailyEscape(f)}</button>`
  ).join('');
  if (moreFilters.length) {
    filterHtml += `<div class="filter-more-wrap"><button class="filter-more-btn ${moreHasActive?'has-selection':''}" onclick="toggleMoreFilters(event)" title="More filters">+</button>`;
    filterHtml += `<div class="filter-dropdown" id="filter-dropdown">`;
    filterHtml += moreFilters.map(f=>
      `<button class="filter-btn ${activeFilter===f?'active':''}" data-filter="${_dailyEscape(f)}" onclick="setActiveFilterFromEl(this)">${_dailyEscape(f)}</button>`
    ).join('');
    filterHtml += `</div></div>`;
  }
  const filterBarEl = document.getElementById('filter-bar');
  if (filterBarEl) filterBarEl.innerHTML = filterHtml;
  syncHomeSettledToggleButton();
  const homeMode = normalizeHomeResultMode(homeResultMode);
  homeResultMode = homeMode;
  showSettled = homeMode === 'settled';
  const homeModeCountLabel = homeMode === 'pending' ? 'open' : homeMode === 'settled' ? 'settled' : 'ledger';

  // Home feed
  const { entries: allDateEntries, todayKey } = ensureHomeSelectedDate(picks);
  let filteredByFilter = picks;
  if(activeFilter!=='ALL') filteredByFilter=picks.filter(p=>String(p.sport || '').toUpperCase()===activeFilter||p.source===activeFilter||getRankingSourceKey(p)===activeFilter);
  let filteredByModeAndFilter = filteredByFilter;
  if(homeMode === 'settled') filteredByModeAndFilter=filteredByModeAndFilter.filter(p=>p.result!=='pending');
  else if(homeMode === 'pending') filteredByModeAndFilter=filteredByModeAndFilter.filter(p=>p.result==='pending');

  const allFilteredDateEntries = buildHomeDateEntries(filteredByFilter);
  const allFilteredDateCountMap = new Map(allFilteredDateEntries.map((entry) => [entry.key, entry.count]));
  const visibleDateEntries = buildHomeDateEntries(filteredByModeAndFilter);
  const visibleDateCountMap = new Map(visibleDateEntries.map((entry) => [entry.key, entry.count]));
  const latestVisibleDateKey = visibleDateEntries[visibleDateEntries.length - 1]?.key
    || allDateEntries[allDateEntries.length - 1]?.key
    || todayKey;
  const selectedDateLabel = formatHomeDateKey(homeSelectedDateKey) || formatTodayPickDateLabel();
  const selectedDateLong = formatHomeDateKey(homeSelectedDateKey, { month: 'long', day: 'numeric' }) || selectedDateLabel;
  const selectedDateUpper = selectedDateLabel.toUpperCase();
  const selectedDateCount = Number(visibleDateCountMap.get(homeSelectedDateKey) || 0);
  const selectedDateTotalCount = Number(allFilteredDateCountMap.get(homeSelectedDateKey) || 0);
  const hiddenByModeCount = homeMode === 'all' ? 0 : Math.max(0, selectedDateTotalCount - selectedDateCount);
  const hiddenModeLabel = homeMode === 'pending' ? 'settled' : 'open';
  const dateTriggerValueEl = document.getElementById('home-date-trigger-value');
  const dateTriggerMetaEl = document.getElementById('home-date-trigger-meta');
  const datePopoverEl = document.getElementById('home-date-popover');
  if (dateTriggerValueEl) dateTriggerValueEl.textContent = selectedDateLong;
  if (dateTriggerMetaEl) {
    const countText = selectedDateCount > 0
      ? `${selectedDateCount} ${homeModeCountLabel} picks`
      : `No ${homeModeCountLabel} picks`;
    dateTriggerMetaEl.textContent = hiddenByModeCount > 0
      ? `${countText} | ${hiddenByModeCount} ${hiddenModeLabel} hidden`
      : countText;
  }
  if (datePopoverEl) {
    datePopoverEl.innerHTML = buildHomeCalendarPopoverHtml({
      selectedDateKey: homeSelectedDateKey,
      monthKey: homeCalendarMonthKey || getLocalMonthKey(parseLocalDateKey(homeSelectedDateKey) || new Date()),
      todayKey,
      dateCounts: visibleDateCountMap,
      latestDateKey: latestVisibleDateKey,
      modeLabel: homeModeCountLabel,
    });
  }
  syncHomeDatePickerVisibility();

  let filtered = filteredByModeAndFilter.filter((pick) => getPickDateKey(pick.date || pick.game_date || pick.Date) === homeSelectedDateKey);

  const allGameStartIso = {};
  picks.forEach(p => {
    const gameLabel = deriveGameLabel(p, picks) || p.pick;
    const key = deriveGameGroupKey(p, picks) || `${p.sport}::${gameLabel || p.id}`;
    const iso = gameTimes[String(p.id)] || '';
    if (!iso) return;
    const nextTs = new Date(iso).getTime();
    if (Number.isNaN(nextTs)) return;
    const prevIso = allGameStartIso[key] || '';
    const prevTs = prevIso ? new Date(prevIso).getTime() : NaN;
    if (!prevIso || Number.isNaN(prevTs) || nextTs < prevTs) {
      allGameStartIso[key] = iso;
    }
  });

  const detailedSeed = filtered.map(p => {
    const gameLabel = deriveGameLabel(p, picks) || p.pick;
    const pickDateLabel = p.date || p.game_date || p.Date || '';
    const key = deriveGameGroupKey(p, picks) || `${p.sport}::${gameLabel || p.id}`;
    const ownIso = gameTimes[String(p.id)] || '';
    const resolvedIso = allGameStartIso[key] || ownIso;
    const fromIso = resolvedIso ? new Date(resolvedIso).getTime() : NaN;
    const fromDate = parsePickDateLabel(pickDateLabel);
    const dayTs = fromDate ? fromDate.getTime() : Number.MAX_SAFE_INTEGER;
    return { ...p, gameKey:key, gameLabel, startIso:resolvedIso, fromIso, dayTs };
  });
  const groupSortTs = {};
  detailedSeed.forEach(p => {
    const ts = Number.isNaN(p.fromIso) ? p.dayTs : p.fromIso;
    if (groupSortTs[p.gameKey] == null || ts < groupSortTs[p.gameKey]) {
      groupSortTs[p.gameKey] = ts;
    }
  });
  const detailed = detailedSeed.map(p => ({
    ...p,
    sortTs: groupSortTs[p.gameKey] ?? p.dayTs,
  })).sort((a,b) => {
    if(a.sortTs!==b.sortTs) return a.sortTs-b.sortTs;
    if(a.gameKey!==b.gameKey) return a.gameKey.localeCompare(b.gameKey);
    return a.id-b.id;
  });

  const formatUnitsCompact = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return '0';
    return Number.isInteger(num) ? String(num) : num.toFixed(2).replace(/\.?0+$/, '');
  };

  const visibleWins = filtered.filter(p=>p.result==='win').length;
  const visibleLosses = filtered.filter(p=>p.result==='loss').length;
  const visiblePushes = filtered.filter(p=>p.result==='push').length;
  const visibleNet = filtered.reduce((sum, p) => sum + p.pl, 0);
  const visibleRisk = filtered
    .filter(p => p.result !== 'pending' && p.result !== 'push')
    .reduce((sum, p) => sum + Number(p.units || 0), 0);
  const visibleRoi = visibleRisk > 0 ? ((visibleNet / visibleRisk) * 100).toFixed(1) + '%' : '—';
  const visibleGames = new Set(detailed.map(p => p.gameKey)).size;
  const visibleSources = new Set(filtered.map(p => getRankingSourceKey(p))).size;
  const visibleSports = [...new Set(filtered.map(p => String(p.sport || 'OTHER').toUpperCase()))];
  const nextStartIso = detailed
    .filter(p => Number.isFinite(p.fromIso))
    .sort((a, b) => a.fromIso - b.fromIso)[0]?.startIso || '';

  const filterLabel = activeFilter === 'ALL' ? 'All Sources' : String(activeFilter || 'All Sources');
  const modeLabel = homeMode === 'pending' ? 'PENDING PICKS' : homeMode === 'settled' ? 'SETTLED PICKS' : 'ALL PICKS';
  const headlineLabel = homeMode === 'pending' ? 'LIVE BOARD' : homeMode === 'settled' ? 'RESULTS REPLAY' : 'LEDGER BOARD';
  const titleEl = document.getElementById('home-title');
  const eyebrowEl = document.getElementById('home-eyebrow');
  const subEl = document.getElementById('home-sub');
  const modeChipEl = document.getElementById('home-mode-chip');
  const dateChipEl = document.getElementById('home-date-chip');
  const filterChipEl = document.getElementById('home-filter-chip');
  const summaryGridEl = document.getElementById('home-summary-grid');
  const scopeCopy = activeFilter === 'ALL' ? 'all sources' : filterLabel;
  if (eyebrowEl) eyebrowEl.textContent = `${headlineLabel} | ${selectedDateUpper}`;
  if (titleEl) {
    titleEl.textContent = homeMode === 'pending'
      ? `${selectedDateLong} board, matchup first`
      : homeMode === 'settled'
        ? `${selectedDateLong} settled, without the clutter`
        : `${selectedDateLong} ledger, all in one view`;
  }
  if (subEl) {
    subEl.textContent = homeMode === 'pending'
      ? `Showing ${scopeCopy} with open action on ${selectedDateLong}, grouped by matchup so the slate stays clean.`
      : homeMode === 'settled'
        ? `Showing ${scopeCopy} that already closed on ${selectedDateLong}, grouped by matchup so the recap stays readable.`
        : `Showing pending and settled picks from ${scopeCopy} on ${selectedDateLong}, with each game kept together.`;
  }
  if (modeChipEl) modeChipEl.textContent = modeLabel;
  if (dateChipEl) dateChipEl.textContent = selectedDateUpper;
  if (filterChipEl) filterChipEl.textContent = activeFilter === 'ALL' ? 'ALL SOURCES' : String(activeFilter);
  if (summaryGridEl) {
    const visiblePending = filtered.filter(p => p.result === 'pending').length;
    const visibleSettled = filtered.length - visiblePending;
    let summaryCards;
    if (homeMode === 'settled') {
      summaryCards = [
        { value: filtered.length, label: 'Settled Picks' },
        { value: visibleGames, label: 'Matchups' },
        { value: `${visibleWins}-${visibleLosses}${visiblePushes ? '-' + visiblePushes : ''}`, label: 'Record', className: 'small' },
        { value: `${visibleNet >= 0 ? '+' : ''}${formatUnitsCompact(visibleNet)}u`, label: 'Net Units', className: visibleNet > 0 ? 'positive' : visibleNet < 0 ? 'negative' : 'neutral' },
        { value: visibleRoi, label: 'ROI', className: visibleRoi !== '—' ? (parseFloat(visibleRoi) >= 0 ? 'positive' : 'negative') : 'neutral' },
      ];
    } else if (homeMode === 'all') {
      summaryCards = [
        { value: filtered.length, label: 'Total Picks' },
        { value: visiblePending, label: 'Pending' },
        { value: visibleSettled, label: 'Settled' },
        { value: visibleGames, label: 'Matchups' },
        { value: `${visibleNet >= 0 ? '+' : ''}${formatUnitsCompact(visibleNet)}u`, label: 'Net Units', className: visibleNet > 0 ? 'positive' : visibleNet < 0 ? 'negative' : 'neutral' },
      ];
    } else {
      summaryCards = [
        { value: filtered.length, label: 'Open Picks' },
        { value: visibleGames, label: 'Matchups' },
        { value: visibleSources, label: 'Pick Labels' },
        { value: nextStartIso ? formatStartLabel(nextStartIso) : 'TBD', label: 'Next Start', className: 'small' },
        { value: visibleSports.length || 0, label: 'Sports In View' },
      ];
    }
    summaryGridEl.innerHTML = summaryCards.map(card => `
      <div class="home-summary-card">
        <div class="home-summary-value ${card.className || ''}">${_dailyEscape(card.value)}</div>
        <div class="home-summary-label">${_dailyEscape(card.label)}</div>
      </div>
    `).join('');
  }

  const feed = document.getElementById('pick-feed');
  const modeNoticeHtml = hiddenByModeCount > 0 ? `
    <div class="home-mode-notice">
      <div>
        <div class="home-mode-notice-title">${_dailyEscape(`${hiddenByModeCount} saved ${hiddenModeLabel} pick${hiddenByModeCount === 1 ? '' : 's'} hidden`)}</div>
        <div class="home-mode-notice-copy">${_dailyEscape(`They are still in the ledger for ${selectedDateLong}; All shows the full date.`)}</div>
      </div>
      <button type="button" class="home-mode-notice-action" onclick="setHomeResultMode('all')">All</button>
    </div>` : '';
  if (!feed) {
    // pick-feed element is expected on the Home tab; null-guarded in case the
    // Home layout ever changes again.
  }
  else if(!detailed.length) {
    const emptyTitle = homeMode === 'settled'
      ? `No settled picks on ${selectedDateLong}`
      : homeMode === 'all'
        ? `No picks on ${selectedDateLong}`
        : `No open picks on ${selectedDateLong}`;
    const emptySub = homeMode === 'settled'
      ? `${filterLabel} has nothing closed for this date. Try another day in the calendar or jump back to pending view.`
      : homeMode === 'all'
        ? `${filterLabel} has nothing logged for this date. Try another day in the calendar or clear the source filter.`
        : `${filterLabel} has nothing open for this date. Try another day in the calendar or switch over to settled results.`;
    feed.innerHTML = `${modeNoticeHtml}
      <div class="pick-feed-empty">
        <div class="home-empty-kicker">${_dailyEscape(modeLabel)} | ${_dailyEscape(selectedDateUpper)}</div>
        <div class="home-empty-title">${_dailyEscape(emptyTitle)}</div>
        <div class="home-empty-sub">${_dailyEscape(emptySub)}</div>
      </div>`;
  }
  else {
    const gameMap = new Map();
    detailed.forEach((p) => {
      if (!gameMap.has(p.gameKey)) {
        gameMap.set(p.gameKey, {
          key: p.gameKey,
          sport: p.sport || 'OTHER',
          label: p.gameLabel || p.pick,
          date: p.date,
          startIso: p.startIso,
          sortTs: p.sortTs,
          picks: [],
        });
      }
      gameMap.get(p.gameKey).picks.push(p);
    });

    const sectionMap = new Map();
    [...gameMap.values()].forEach((game) => {
      const sportKey = String(game.sport || 'OTHER').toUpperCase();
      if (!sectionMap.has(sportKey)) {
        sectionMap.set(sportKey, {
          sport: sportKey,
          games: [],
          sortTs: game.sortTs,
        });
      }
      const section = sectionMap.get(sportKey);
      section.games.push(game);
      if (game.sortTs < section.sortTs) section.sortTs = game.sortTs;
    });

    const sections = [...sectionMap.values()].sort((a, b) => {
      if (a.sortTs !== b.sortTs) return a.sortTs - b.sortTs;
      return a.sport.localeCompare(b.sport);
    });

    const renderHomePickRow = (p, game, sectionSport) => {
      const sportKey = String(p.sport || sectionSport || 'OTHER').toUpperCase();
      const source = getRankingSourceKey(p) || (p.source || 'Unknown');
      const oddsDisplay = formatOddsOrProbabilityDisplay(p.odds, p.probability) || '';
      const isPending = p.result === 'pending';
      const units = Number(p.units) || 0;
      const pl = Number(p.pl) || 0;
      const plDisplay = isPending
        ? `${formatUnitsCompact(units)}u risk`
        : `${pl >= 0 ? '+' : ''}${formatUnitsCompact(pl)}u`;
      const plCls = isPending ? 'neutral' : pl > 0 ? 'positive' : pl < 0 ? 'negative' : 'neutral';
      const control = renderPickResultControl(p);
      const dateLabel = game.date || p.date || '';
      const startLabel = formatStartLabel(game.startIso);
      const rowGameLabel = String(game.label || deriveGameLabel(p, filtered) || '').trim();
      const visibleGameLabel = rowGameLabel && !String(p.pick || '').toLowerCase().includes(rowGameLabel.toLowerCase())
        ? rowGameLabel
        : '';
      const metaBits = [visibleGameLabel, dateLabel, oddsDisplay, `${formatUnitsCompact(units)}u`, startLabel].filter(Boolean).join(' | ');
      const sourceUpper = String(p.source || '').toUpperCase();
      const isNbaNewPick = sourceUpper.includes('NBANEW') || sourceUpper.includes('NBA NEW');
      const kellyHtml = (isNbaNewPick && p.kelly_edge) ? (() => {
        const ke = p.kelly_edge;
        const v  = ke.verdict || 'PASS';
        const verdictLabel = {
          BET: '🔥 Bet',
          LEAN: '~ Lean',
          PASS: '— Pass',
          FADE: '✗ Fade',
          NO_LINE: '— No Line',
          ERROR: '— Error',
          NO_MODEL_SPREAD: '— No Spread'
        }[v] || v;
        return `<span class="home-row-kelly kelly-badge ${v}">${verdictLabel}${ke.edge_pct != null ? ` · ${ke.edge_pct}%` : ''}</span>`;
      })() : '';
      return `
        <div class="home-feed-row result-${p.result}">
          <span class="home-feed-row-sport">${_dailyEscape(sportKey)}</span>
          <div class="home-feed-row-body">
            <div class="home-feed-row-source">${_dailyEscape(source)}${kellyHtml}</div>
            <div class="home-feed-row-pick" title="${_dailyEscape(p.pick || '')}">${_dailyEscape(p.pick || '')}</div>
            <div class="home-feed-row-meta">${_dailyEscape(metaBits)}</div>
          </div>
          <div class="home-feed-row-pl ${plCls}">${_dailyEscape(plDisplay)}</div>
          <div class="home-feed-row-control">${control}</div>
        </div>`;
    };

    feed.innerHTML = modeNoticeHtml + sections.map(section => {
      section.games.sort((a, b) => {
        if (a.sortTs !== b.sortTs) return a.sortTs - b.sortTs;
        return String(a.label || '').localeCompare(String(b.label || ''));
      });
      const sectionPickCount = section.games.reduce((sum, game) => sum + game.picks.length, 0);
      const sectionMeta = `${sectionPickCount} pick${sectionPickCount === 1 ? '' : 's'} | ${section.games.length} matchup${section.games.length === 1 ? '' : 's'}`;
      const sportLabel = getSportBadgeText(section.sport);
      const gameCards = section.games.map((game) => {
        const gamePicks = game.picks.slice().sort((a, b) => {
          const aPending = a.result === 'pending';
          const bPending = b.result === 'pending';
          if (aPending !== bPending) return aPending ? -1 : 1;
          return String(a.pick || '').localeCompare(String(b.pick || ''));
        });
        const verdict = _dailyGroupVerdict(gamePicks);
        const pendingCount = gamePicks.filter(p => p.result === 'pending').length;
        const wins = gamePicks.filter(p => p.result === 'win').length;
        const losses = gamePicks.filter(p => p.result === 'loss').length;
        const pushes = gamePicks.filter(p => p.result === 'push').length;
        const settledCount = wins + losses + pushes;
        const net = gamePicks.reduce((sum, p) => sum + (Number(p.pl) || 0), 0);
        const netText = `${net >= 0 ? '+' : ''}${formatUnitsCompact(net)}u`;
        const plCls = settledCount ? (net > 0 ? 'positive' : net < 0 ? 'negative' : 'neutral') : 'neutral';
        const plDisplay = settledCount ? netText : `${pendingCount} open`;
        const recordText = settledCount ? `${wins}-${losses}${pushes ? '-' + pushes : ''}` : `${pendingCount} pending`;
        const sourceCount = new Set(gamePicks.map(p => getRankingSourceKey(p))).size;
        const dateLabel = game.date || selectedDateLabel;
        const startLabel = formatStartLabel(game.startIso);
        const metaBits = [
          dateLabel,
          startLabel,
          `${gamePicks.length} pick${gamePicks.length === 1 ? '' : 's'}`,
          `${sourceCount} label${sourceCount === 1 ? '' : 's'}`,
        ].filter(Boolean).join(' | ');
        const scoreChip = homeScoreChipHtml(homeScoreboardGameMap.get(game.key), game.startIso, game.label);
        const caption = recordText;
        const sportPillClass = String(section.sport || '').toUpperCase() === 'IPL' ? ' is-ipl' : '';
        const rowsHtml = gamePicks.map(p => renderHomePickRow(p, game, section.sport)).join('');
        return `
          <article class="home-game-card status-${_dailyEscape(verdict.key || 'live')}">
            <div class="home-game-top">
              <div class="home-game-kicker">
                <span class="home-sport-pill${sportPillClass}">${_dailyEscape(sportLabel)}</span>
                <span class="home-status-pill ${_dailyEscape(verdict.key || 'live')}">${_dailyEscape(verdict.label || 'PENDING')}</span>
              </div>
              <div class="home-game-right-stack">
                ${scoreChip}
                <div class="home-game-pl ${plCls}">${_dailyEscape(plDisplay)}</div>
                <div class="home-game-caption">${_dailyEscape(caption)}</div>
              </div>
            </div>
            <div>
              <div class="home-game-title">${_dailyEscape(game.label || 'Matchup')}</div>
              <div class="home-game-meta">${_dailyEscape(metaBits)}</div>
            </div>
            <div class="home-game-picks">${rowsHtml}</div>
          </article>`;
      }).join('');

      return `
        <section class="home-feed-section">
          <div class="home-feed-section-head">
            <div>
              <div class="home-feed-section-title">${_dailyEscape(sportLabel)}</div>
              <div class="home-feed-section-meta">${_dailyEscape(sectionMeta)}</div>
            </div>
          </div>
          <div class="home-feed-grid">${gameCards}</div>
        </section>`;
    }).join('');

    refreshHomeScoreboardForDate(homeSelectedDateKey, filtered).catch(() => {});
  }

  // Overall stats
  const statsPicks = getRankingsPicks();
  const decided=statsPicks.filter(p=>p.result!=='pending');
  const w=decided.filter(p=>p.result==='win').length, l=decided.filter(p=>p.result==='loss').length;
  const pu=decided.filter(p=>p.result==='push').length, pe=statsPicks.filter(p=>p.result==='pending').length;
  const d=w+l, acc=d>0?(w/d*100).toFixed(1)+'%':'—';
  const nu=decided.reduce((s,p)=>s+p.pl,0), tw=decided.filter(p=>p.result!=='push').reduce((s,p)=>s+p.units,0);
  const roi=tw>0?((nu/tw)*100).toFixed(1)+'%':'—', nuf=nu;
  document.getElementById('stat-picks').textContent=statsPicks.length;
  document.getElementById('stat-wins').textContent=w;
  document.getElementById('stat-losses').textContent=l;
  document.getElementById('stat-pushes').textContent=pu;
  document.getElementById('stat-pending').textContent=pe;
  document.getElementById('stat-acc').textContent=acc;
  const ue=document.getElementById('stat-units');
  ue.textContent=(nuf>=0?'+':'')+nu+'u'; ue.className='stat-box-val '+(nuf>0?'positive':nuf<0?'negative':'neutral');
  const re=document.getElementById('stat-roi'); re.textContent=roi;
  if(roi!=='—') re.className='stat-box-val '+(parseFloat(roi)>=0?'positive':'negative');

  // Heavy secondary tabs rebuild only while visible; switchTab renders them on demand.
  const activeContent = document.querySelector('.tab-content.active');
  const activeTabId = activeContent ? activeContent.id : 'tab-home';
  if (activeTabId === 'tab-trends') renderTrends();
  if (activeTabId === 'tab-daily') renderDaily();
  if (activeTabId === 'tab-home') renderHomePulse();
  if (activeTabId === 'tab-search' && typeof renderSearch === 'function') renderSearch();
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const data = await loadAllData();
    PICKS.push(...data);
    render();
  } catch (err) {
    console.error('Failed to load picks:', err);
  }
});
