export type PickResult = 'pending' | 'win' | 'loss' | 'push';
export type PickMode = 'team' | 'player';

export interface Pick {
  id: string;
  source: string;
  pick: string;
  sport: string;
  date: string;
  units: number;
  odds: number | null;
  result: PickResult;
  pl: number;
  probability?: number | null;
  confidence?: number | string | null;
  start_time?: string | null;
  game_start_time?: string | null;
  away_team?: string;
  home_team?: string;
  team?: string;
  matchup?: string;
  game?: string;
  decision?: string;
  edge?: number | null;
  market_edge?: number | null;
  line?: number | null;
  market_line?: number | null;
  kelly?: number | string | null;
  kelly_units?: number | string | null;
  full_kelly?: number | string | null;
  quarter_kelly?: number | string | null;
  recommended_units?: number | string | null;
  reason?: string | null;
  rationale?: string | null;
  key_factors?: unknown;
  player?: string;
  player_name?: string;
  market?: string;
  scope?: string;
  ml_rank?: number | string | null;
  model_rank?: number | string | null;
  rank?: number | string | null;
  ml_rank_epoch?: string | null;
  ranking_epoch?: string | null;
  ranking_updated_at?: string | null;
  model_epoch?: string | null;
  [key: string]: unknown;
}

interface ModelBucket {
  ok?: boolean;
  picks?: unknown[];
  games?: unknown[];
  [key: string]: unknown;
}

interface ModelCachePayload {
  date?: string;
  generatedAt?: string;
  updatedAt?: string;
  models?: Record<string, ModelBucket>;
  [key: string]: unknown;
}

interface CacheManifest {
  files?: string[];
}

interface PlayerPropsPayload {
  date?: string;
  slate_date?: string;
  generatedAt?: string;
  updatedAt?: string;
  picks?: unknown[];
  props?: unknown[];
  player_props?: unknown[];
  recommendations?: unknown[];
  models?: Record<string, unknown>;
  sports?: Record<string, unknown>;
  leagues?: Record<string, unknown>;
  [key: string]: unknown;
}

const RESULT_STORAGE_KEY = 'pickledger_static_results_v2';
const GAME_TIME_STORAGE_KEY = 'pickledger_static_game_times_v2';
const ARCHIVED_SPORTS = new Set(['NBA']);
const SOURCE_LABELS: Record<string, string> = {
  mlb_new: 'MLB Model',
  mlb_inning: 'MLB Inning',
  mlb_first_five: 'MLB First Five',
  wnba: 'WNBA Model',
  nba: 'NBA New',
  nba_playoffs: 'NBA Playoffs',
  fifa_world_cup: 'FIFA Model',
  sportytrader: 'SportyTrader',
  sportytrader_nba: 'SportyTraderNBA',
  sportytrader_mlb: 'SportyTraderMLB',
  sportytrader_wnba: 'SportyTraderWNBA',
  sportytrader_fifa_world_cup: 'SportyTraderFIFAWorldCup',
  sportsgambler: 'SportsGambler',
  sportsgambler_nba: 'SportsGamblerNBA',
  sportsgambler_mlb: 'SportsGamblerMLB',
  sportsgambler_wnba: 'SportsGamblerWNBA',
  sportsgambler_fifa_world_cup: 'SportsGamblerFIFAWorldCup',
  scores24_wnba: 'Scores24WNBA',
  scores24_mlb: 'Scores24MLB',
  scores24_fifa_world_cup: 'Scores24FIFAWorldCup',
};

const SOURCE_ALIASES: Record<string, string> = {
  'MLB NEW': 'MLB Model',
  'MLB New': 'MLB Model',
  'FIFA WC In-House': 'FIFA Model',
};

const PLAYER_PROP_SOURCE_LABELS: Record<string, string> = {
  nba_player_props: 'NBAPlayerProps',
  mlb_player_props: 'MLBPlayerProps',
  wnba_player_props: 'WNBAPlayerProps',
};

let activePickMode: PickMode = 'team';
let teamPicks: Pick[] = [];
let playerPicks: Pick[] = [];
let resultOverrides: Record<string, PickResult> = {};
let gameTimes: Record<string, string> = {};
let latestTeamCache: ModelCachePayload | null = null;
let latestPlayerCache: PlayerPropsPayload | null = null;

function readStorage<T>(key: string, fallback: T): T {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '');
    return parsed && typeof parsed === 'object' ? parsed as T : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The viewer remains usable when storage is blocked.
  }
}

function normalizeResult(value: unknown): PickResult {
  const result = String(value || '').trim().toLowerCase();
  if (result === 'win' || result === 'w') return 'win';
  if (result === 'loss' || result === 'l') return 'loss';
  if (result === 'push' || result === 'p') return 'push';
  return 'pending';
}

function numberOrNull(value: unknown): number | null {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function stablePickId(raw: Record<string, unknown>, date: string, source: string): string {
  const existing = String(raw.id || '').trim();
  if (existing) return existing;
  return `pick-${stableHash(JSON.stringify([
    source,
    raw.sport,
    date,
    raw.pick,
    raw.selection || raw.prop || raw.bet,
    raw.player || raw.player_name,
    raw.market || raw.market_type,
    raw.ml_rank_epoch || raw.ranking_epoch || raw.model_epoch,
    raw.matchup || raw.game,
    raw.away_team,
    raw.home_team,
  ]))}`;
}

export function calculateProfit(pick: Pick, result: PickResult = pick.result): number {
  if (result === 'pending' || result === 'push') return 0;
  if (result === 'loss') return -pick.units;
  const odds = numberOrNull(pick.odds);
  if (odds == null || odds === 0) return pick.units;
  return Number((odds > 0 ? pick.units * odds / 100 : pick.units * 100 / Math.abs(odds)).toFixed(2));
}

function normalizePick(
  input: unknown,
  fallbackDate: string,
  fallbackSource: string,
  gameByMatchup: Map<string, Record<string, unknown>> = new Map(),
  playerProp = false,
): Pick | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const pickText = String(raw.pick || raw.selection || raw.prop || raw.bet || '').trim();
  if (!pickText) return null;

  const rawSource = String((playerProp && fallbackSource) ? fallbackSource : (raw.source || fallbackSource || 'Unknown')).trim();
  const source = SOURCE_ALIASES[rawSource] || rawSource;
  const date = String(raw.date || raw.game_date || raw.slate_date || raw.Date || fallbackDate || '').trim();
  const matchup = String(raw.matchup || raw.game || raw.event || '').trim();
  const game = gameByMatchup.get(matchup);
  const id = stablePickId(raw, date, rawSource);
  const embeddedResult = normalizeResult(raw.result);
  const localResult = normalizeResult(resultOverrides[id]);
  const result = embeddedResult === 'pending' ? localResult : embeddedResult;
  const decision = String(raw.decision || '').trim().toUpperCase();
  const units = numberOrNull(raw.units ?? raw.stake_units ?? raw.recommended_units ?? raw.quarter_kelly)
    ?? (playerProp && decision === 'PASS' ? 0 : 1);
  const startTime = String(
    raw.start_time || raw.game_start_time ||
    game?.start_time || game?.game_start_time ||
    gameTimes[id] || '',
  ).trim() || null;

  const pick: Pick = {
    ...raw,
    id,
    source,
    pick: pickText,
    sport: String(raw.sport || raw.league || 'OTHER').trim().toUpperCase(),
    matchup: matchup || undefined,
    player: String(raw.player || raw.player_name || '').trim() || undefined,
    reason: String(raw.reason || raw.rationale || raw.notes || '').trim() || undefined,
    key_factors: raw.key_factors ?? raw.factors ?? raw.guardrail_reasons,
    date,
    units,
    odds: numberOrNull(raw.odds ?? raw.assumed_odds ?? raw.american_odds ?? raw.price),
    probability: numberOrNull(raw.probability ?? raw.model_probability ?? raw.predicted_probability),
    result,
    pl: 0,
    start_time: startTime,
    game_start_time: startTime,
  };
  pick.pl = calculateProfit(pick, result);
  return pick;
}

function isTrackedPick(pick: Pick): boolean {
  const decision = String(pick.decision || '').trim().toUpperCase();
  return decision === 'BET' || decision === 'LEAN';
}

function isTrackedPlayerProp(pick: Pick): boolean {
  const decision = String(pick.decision || '').trim().toUpperCase();
  return decision === 'BET' || decision === 'LEAN' || decision === 'PASS';
}

function isPlayerScopedPick(pick: Pick): boolean {
  return String(pick.scope || '').trim().toLowerCase() === 'player';
}

function picksFromCache(payload: ModelCachePayload): Pick[] {
  const date = String(payload.date || '').trim();
  const models = payload.models && typeof payload.models === 'object' ? payload.models : {};
  const picks: Pick[] = [];

  for (const [modelKey, bucket] of Object.entries(models)) {
    if (!bucket || typeof bucket !== 'object' || bucket.ok === false) continue;
    const gameByMatchup = new Map<string, Record<string, unknown>>();
    if (Array.isArray(bucket.games)) {
      for (const item of bucket.games) {
        if (!item || typeof item !== 'object') continue;
        const game = item as Record<string, unknown>;
        const matchup = String(game.matchup || game.game || '').trim();
        if (matchup) gameByMatchup.set(matchup, game);
      }
    }
    for (const raw of Array.isArray(bucket.picks) ? bucket.picks : []) {
      const pick = normalizePick(raw, date, SOURCE_LABELS[modelKey] || modelKey, gameByMatchup);
      if (pick && isTrackedPick(pick)) picks.push(pick);
    }
  }
  return picks;
}

function playerPropRecords(payload: PlayerPropsPayload): Array<{ raw: unknown; source: string }> {
  const records: Array<{ raw: unknown; source: string }> = [];
  const addBucket = (bucket: unknown, source: string): void => {
    if (Array.isArray(bucket)) {
      bucket.forEach(raw => records.push({ raw, source }));
      return;
    }
    if (!bucket || typeof bucket !== 'object') return;
    const value = bucket as Record<string, unknown>;
    if (value.ok === false) return;
    for (const key of ['picks', 'props', 'player_props', 'recommendations']) {
      if (Array.isArray(value[key])) addBucket(value[key], source);
    }
  };

  addBucket(payload, 'Player Props');
  for (const containerKey of ['models', 'sports', 'leagues']) {
    const container = payload[containerKey];
    if (!container || typeof container !== 'object' || Array.isArray(container)) continue;
    for (const [source, bucket] of Object.entries(container as Record<string, unknown>)) {
      addBucket(bucket, PLAYER_PROP_SOURCE_LABELS[source] || source);
    }
  }
  return records;
}

function picksFromPlayerProps(payload: PlayerPropsPayload): Pick[] {
  const date = String(payload.date || payload.slate_date || '').trim();
  return playerPropRecords(payload)
    .map(({ raw, source }) => normalizePick(raw, date, source, new Map(), true))
    .filter((pick): pick is Pick => Boolean(pick) && isTrackedPlayerProp(pick));
}

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  }
}

async function loadCacheFiles(): Promise<ModelCachePayload[]> {
  const manifest = await fetchJson<CacheManifest>('./data/model_cache/index.json');
  const files = Array.isArray(manifest?.files)
    ? manifest.files.filter(file => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
    : [];
  if (!files.length) {
    const fallback = await fetchJson<ModelCachePayload>('./data/model_cache/latest.json');
    latestTeamCache = fallback;
    return fallback ? [fallback] : [];
  }

  const payloads = (await Promise.all(
    files.map(file => fetchJson<ModelCachePayload>(`./data/model_cache/${file}`)),
  )).filter((payload): payload is ModelCachePayload => Boolean(payload));
  payloads.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  latestTeamCache = payloads[payloads.length - 1] || null;
  return payloads;
}

async function loadPlayerCacheFiles(): Promise<PlayerPropsPayload[]> {
  const manifest = await fetchJson<CacheManifest>('./data/player_props_cache/index.json');
  const files = Array.isArray(manifest?.files)
    ? manifest.files.filter(file => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
    : [];
  if (!files.length) {
    const fallback = await fetchJson<PlayerPropsPayload>('./data/player_props_cache/latest.json');
    latestPlayerCache = fallback;
    return fallback ? [fallback] : [];
  }

  const payloads = (await Promise.all(
    files.map(file => fetchJson<PlayerPropsPayload>(`./data/player_props_cache/${file}`)),
  )).filter((payload): payload is PlayerPropsPayload => Boolean(payload));
  payloads.sort((a, b) => String(a.date || a.slate_date || '').localeCompare(String(b.date || b.slate_date || '')));
  latestPlayerCache = payloads[payloads.length - 1] || null;
  return payloads;
}

function sortPicks(picks: Pick[]): Pick[] {
  return picks.sort((a, b) => (
    a.date.localeCompare(b.date) ||
    a.sport.localeCompare(b.sport) ||
    a.source.localeCompare(b.source) ||
    a.pick.localeCompare(b.pick)
  ));
}

export function setPickMode(mode: PickMode): void {
  activePickMode = mode;
}

export function getPickMode(): PickMode {
  return activePickMode;
}

export async function loadAllData(): Promise<Pick[]> {
  resultOverrides = readStorage<Record<string, PickResult>>(RESULT_STORAGE_KEY, {});
  gameTimes = readStorage<Record<string, string>>(GAME_TIME_STORAGE_KEY, {});
  const [cachePayloads, playerPayloads] = await Promise.all([
    loadCacheFiles(),
    loadPlayerCacheFiles(),
  ]);
  const teamById = new Map<string, Pick>();
  const playerById = new Map<string, Pick>();
  cachePayloads.flatMap(picksFromCache).forEach(pick => {
    if (isPlayerScopedPick(pick)) playerById.set(pick.id, pick);
    else teamById.set(pick.id, pick);
  });
  playerPayloads.flatMap(picksFromPlayerProps).forEach(pick => playerById.set(pick.id, pick));
  teamPicks = sortPicks([...teamById.values()].filter(pick => !ARCHIVED_SPORTS.has(pick.sport)));
  playerPicks = sortPicks([...playerById.values()].filter(pick => !ARCHIVED_SPORTS.has(pick.sport)));
  return getAllPicks();
}

export function getAllPicks(): Pick[] {
  return activePickMode === 'player' ? playerPicks : teamPicks;
}

export function getResults(): Record<string, PickResult> {
  return resultOverrides;
}

export function setLocalResult(id: string, result: PickResult): void {
  resultOverrides[id] = result;
  writeStorage(RESULT_STORAGE_KEY, resultOverrides);
  const pick = getAllPicks().find(item => item.id === id);
  if (pick) {
    pick.result = result;
    pick.pl = calculateProfit(pick, result);
  }
}

export function setLocalGameTime(id: string, startTime: string): void {
  gameTimes[id] = startTime;
  writeStorage(GAME_TIME_STORAGE_KEY, gameTimes);
  const pick = getAllPicks().find(item => item.id === id);
  if (pick) {
    pick.start_time = startTime;
    pick.game_start_time = startTime;
  }
}

function latestPayloadTimestamp(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  let latest = 0;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if ((key === 'generatedAt' || key === 'updatedAt') && typeof nested === 'string') {
      const timestamp = new Date(nested).getTime();
      if (Number.isFinite(timestamp)) latest = Math.max(latest, timestamp);
    } else if (nested && typeof nested === 'object') {
      latest = Math.max(latest, latestPayloadTimestamp(nested));
    }
  }
  return latest;
}

export function getCacheStatus(): { date: string; runTime: string; updatedAt: string; pickCount: number } {
  const latestCache = activePickMode === 'player' ? latestPlayerCache : latestTeamCache;
  const latestTimestamp = latestPayloadTimestamp(latestCache);
  const parsed = new Date(latestTimestamp);
  return {
    date: String(latestCache?.date || latestCache?.slate_date || ''),
    runTime: !latestTimestamp || Number.isNaN(parsed.getTime())
      ? ''
      : parsed.toLocaleTimeString('en-US', {
        timeZone: 'America/Chicago',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      }),
    updatedAt: latestTimestamp ? parsed.toISOString() : '',
    pickCount: getAllPicks().length,
  };
}
