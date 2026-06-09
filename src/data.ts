/**
 * data.ts — Static JSON data layer for PickLedger Viewer.
 *
 * All picks are loaded from committed JSON files in data/model_cache/ and
 * data/cannon_mlb_daily.json. No Firebase, no user auth.
 */

// ── Types ──

export interface Pick {
  id: number;
  source: string;
  pick: string;
  sport: string;
  date: string;
  units: number;
  odds: number | null;
  result: string;
  probability?: number | null;
  confidence?: number | null;
  start_time?: string | null;
  game_start_time?: string | null;
  away_team?: string;
  home_team?: string;
  team?: string;
  matchup?: string;
  game?: string;
  market_edge?: number | null;
  edge?: number | null;
  line?: number | null;
  market_line?: number | null;
  kelly_edge?: {
    verdict?: string;
    edge_pct?: number;
    bet_side?: string;
    vegas_spread?: number;
    kelly_frac_pct?: number;
  } | null;
  decision?: string;
  notes?: string;
  model_prediction?: number | null;
  assumed_odds?: number | null;
  game_date_key?: string;
  game_date?: string;
  Date?: string;
  inning?: number | null;
  game_id?: string;
  game_order?: number | null;
  _gameKey?: string;
  [key: string]: unknown;
}

export interface ModelCachePayload {
  date: string;
  generatedAt?: string;
  updatedAt?: string;
  models?: Record<string, ModelBucket>;
  [key: string]: unknown;
}

export interface ModelBucket {
  ok?: boolean;
  picks?: Pick[];
  games?: unknown[];
  note?: string;
  [key: string]: unknown;
}

export interface CannonPayload {
  slate_date: string;
  games?: CannonGame[];
  [key: string]: unknown;
}

export interface CannonGame {
  matchup?: string;
  away_team?: string;
  home_team?: string;
  ml_edge_pct?: number;
  cannon_ml_prob?: number;
  sportsline_away_ml?: number;
  sportsline_home_ml?: number;
  game_start_time?: string;
  [key: string]: unknown;
}

// ── State ──

let _allPicks: Pick[] = [];
let _results: Record<string, string> = {};
let _gameTimes: Record<string, string> = {};
let _cachePayload: ModelCachePayload | null = null;
let _cannonPayload: CannonPayload | null = null;
let _nextPickId = 100000;

const STORAGE_VERSION = 'viewer_v1';
const RESULTS_KEY = `pickledger_results_${STORAGE_VERSION}`;
const GAME_TIMES_KEY = `pickledger_game_times_${STORAGE_VERSION}`;

// ── Initialization ──

function loadResultsFromStorage(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(RESULTS_KEY) || '{}');
  } catch {
    return {};
  }
}

function loadGameTimesFromStorage(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(GAME_TIMES_KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveResults(results: Record<string, string>): void {
  _results = results;
  try {
    localStorage.setItem(RESULTS_KEY, JSON.stringify(results));
  } catch {
    // Storage full or blocked — non-fatal
  }
}

export function saveGameTimes(gameTimes: Record<string, string>): void {
  _gameTimes = gameTimes;
  try {
    localStorage.setItem(GAME_TIMES_KEY, JSON.stringify(gameTimes));
  } catch {
    // Storage full or blocked — non-fatal
  }
}

export function getResults(): Record<string, string> {
  return _results;
}

export function getGameTimes(): Record<string, string> {
  return _gameTimes;
}

export function getAllPicks(): Pick[] {
  return _allPicks;
}

export function getCachePayload(): ModelCachePayload | null {
  return _cachePayload;
}

export function getCannonPayload(): CannonPayload | null {
  return _cannonPayload;
}

// ── JSON Fetch ──

export async function fetchLatestCache(): Promise<ModelCachePayload | null> {
  const candidates = ['latest.json'];
  for (const file of candidates) {
    try {
      const resp = await fetch(`./data/model_cache/${file}?t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!resp.ok) continue;
      const data: ModelCachePayload = await resp.json();
      if (data && typeof data === 'object' && data.date) {
        _cachePayload = data;
        return data;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

export async function fetchCannonDaily(): Promise<CannonPayload | null> {
  try {
    const resp = await fetch(`./data/cannon_mlb_daily.json?t=${Date.now()}`, {
      cache: 'no-store',
    });
    if (!resp.ok) return null;
    const data: CannonPayload = await resp.json();
    if (data && typeof data === 'object') {
      _cannonPayload = data;
      return data;
    }
  } catch {
    // Cannon daily is optional
  }
  return null;
}

// ── Pick Parsing ──

function sanitizeModelPicks(picks: unknown[]): Pick[] {
  if (!Array.isArray(picks)) return [];
  return picks.filter((pick: Pick) => {
    const source = String(pick?.source || '').trim().toUpperCase();
    if (source !== 'MLB INNING') return true;
    const pickText = String(pick?.pick || '');
    const m = pickText.match(/\binning\s+([1-9])\s*[-\u2013\u2014:]?\s*no\s+runs?\s+scored\b/i);
    if (!m) return true;
    const inning = Number(m[1]);
    return !Number.isFinite(inning) || inning < 9;
  }) as Pick[];
}

function extractPicksFromBucket(bucket: ModelBucket, source: string): Pick[] {
  if (!bucket || typeof bucket !== 'object') return [];
  let rawPicks: unknown[] = [];
  if (Array.isArray(bucket.picks)) rawPicks = bucket.picks;
  else if (Array.isArray(bucket)) rawPicks = bucket;

  const games = Array.isArray(bucket.games) ? bucket.games : [];
  const picks = sanitizeModelPicks(rawPicks);

  // Enrich MLB inning picks with game data
  if (games.length) {
    const byMatchup = new Map<string, unknown>();
    games.forEach((game: Record<string, unknown>) => {
      const matchup = String(game?.matchup || '').trim();
      if (matchup) byMatchup.set(matchup, game);
    });
    return picks.map((pick) => {
      const s = String(pick?.source || '').trim().toUpperCase();
      if (s !== 'MLB INNING') return { ...pick, source: pick.source || source };
      const matchup = String(pick?.matchup || pick?.game || '').trim();
      const game = byMatchup.get(matchup) as Record<string, unknown> | undefined;
      if (!game) return { ...pick, source: pick.source || source };
      return {
        ...pick,
        source: pick.source || source,
        start_time: pick.start_time ?? (game.game_start_time as string) ?? null,
        game_start_time: pick.game_start_time ?? (game.game_start_time as string) ?? null,
      };
    });
  }

  return picks.map((p) => ({ ...p, source: p.source || source }));
}

// Source label mapping from model keys to display names
const MODEL_SOURCE_LABELS: Record<string, string> = {
  mlb_new: 'MLB Model',
  mlb_inning: 'MLB Inning',
  mlb_first_five: 'MLB First Five',
  wnba: 'WNBA Model',
  nba: 'NBA Model',
  nba_new: 'NBA New',
  nba_playoffs: 'NBA Playoffs',
  sportytrader: 'SportyTrader',
  sportsgambler: 'SportsGambler',
};

export function parseAllPicks(cache: ModelCachePayload): Pick[] {
  const allPicks: Pick[] = [];
  const models = cache.models && typeof cache.models === 'object' ? cache.models : {};

  for (const [key, bucket] of Object.entries(models)) {
    if (!bucket || typeof bucket !== 'object') continue;
    const sourceLabel = MODEL_SOURCE_LABELS[key] || key;
    const picks = extractPicksFromBucket(bucket as ModelBucket, sourceLabel);
    picks.forEach((pick) => {
      allPicks.push({
        ...pick,
        id: pick.id || _nextPickId++,
        date: pick.date || pick.game_date || pick.Date || cache.date || '',
        units: pick.units ?? 1,
        odds: pick.odds ?? null,
        result: pick.result || 'pending',
      });
    });
  }

  return allPicks;
}

export function parseCannonPicks(cannon: CannonPayload): Pick[] {
  if (!cannon || !Array.isArray(cannon.games)) return [];
  const picks: Pick[] = [];

  cannon.games.forEach((game) => {
    const matchup = String(game.matchup || '').trim();
    const edgePct = Number(game.ml_edge_pct || 0);
    const prob = Number(game.cannon_ml_prob || 0);
    if (!matchup || !edgePct) return;

    const verdict = edgePct >= 5 ? 'BET' : edgePct >= 3 ? 'LEAN' : 'PASS';
    if (verdict === 'PASS') return;

    const away = String(game.away_team || '').trim();
    const home = String(game.home_team || '').trim();
    const favored = prob > 0.5 ? away : home;

    picks.push({
      id: _nextPickId++,
      source: 'Cannon',
      pick: `${favored} ML`,
      sport: 'MLB',
      date: cannon.slate_date || '',
      units: 1,
      odds: null,
      result: 'pending',
      probability: prob,
      confidence: Math.round(prob * 100),
      start_time: game.game_start_time || null,
      away_team: away,
      home_team: home,
      team: favored,
      matchup,
      decision: verdict,
      market_edge: edgePct,
    });
  });

  return picks;
}

// ── Main Load ──

export async function loadAllData(): Promise<Pick[]> {
  _results = loadResultsFromStorage();
  _gameTimes = loadGameTimesFromStorage();

  const [cache, cannon] = await Promise.all([
    fetchLatestCache(),
    fetchCannonDaily(),
  ]);

  const picks: Pick[] = [];

  if (cache) {
    picks.push(...parseAllPicks(cache));
  }
  if (cannon) {
    picks.push(...parseCannonPicks(cannon));
  }

  _allPicks = picks;
  return picks;
}

// ── Cache Status ──

export function getCacheStatus(): { date: string; fresh: boolean; bucketCount: number; runTime: string } {
  if (!_cachePayload) return { date: '', fresh: false, bucketCount: 0, runTime: '' };
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const cacheDate = String(_cachePayload.date || '').trim();
  const models = _cachePayload.models && typeof _cachePayload.models === 'object' ? _cachePayload.models : {};
  const bucketCount = Object.values(models).filter(
    (b) => b && typeof b === 'object' && (b as ModelBucket).ok === true
  ).length;
  const rawTime = String(_cachePayload.generatedAt || _cachePayload.updatedAt || '').trim();
  let runTime = '';
  if (rawTime) {
    const parsed = new Date(rawTime);
    if (!Number.isNaN(parsed.getTime())) {
      runTime = parsed.toLocaleTimeString('en-US', {
        timeZone: 'America/Chicago',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      });
    }
  }
  return {
    date: cacheDate,
    fresh: cacheDate === todayKey && bucketCount > 0,
    bucketCount,
    runTime,
  };
}
