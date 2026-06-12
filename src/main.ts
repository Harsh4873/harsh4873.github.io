import { initMobileMode, initSettingsUI, initTheme } from './settings';
import {
  getAllPicks,
  getCacheStatus,
  loadAllData,
  setLocalGameTime,
  setLocalResult,
  type Pick,
  type PickResult,
} from './data';

type Stats = {
  total: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  net: number;
  risk: number;
  winRate: number | null;
  roi: number | null;
};

type HomeScoreInfo = {
  eventId: string;
  sport: string;
  tone: 'pregame' | 'live' | 'final' | 'delayed';
  text: string;
  startTime: string;
};

type TrendSignalGroup = {
  key: string;
  label: string;
  picks: Pick[];
  matching: boolean;
  pass: boolean;
};

type DailySourceForm = {
  source: string;
  recentStats: Stats;
  lastStats: Stats;
  recentDates: string[];
  todayBets: Pick[];
  score: number;
};

const ESPN_ENDPOINTS: Record<string, [string, string]> = {
  MLB: ['baseball', 'mlb'],
  NBA: ['basketball', 'nba'],
  WNBA: ['basketball', 'wnba'],
  NHL: ['hockey', 'nhl'],
};

let activeFilter = 'ALL';
let homeMode: 'pending' | 'all' | 'settled' = 'pending';
let selectedDate = '';
let followCentralToday = true;
let calendarMonth = '';
let calendarOpen = false;
let refreshInFlight = false;
const homeScores = new Map<string, HomeScoreInfo>();
const homeScoreFetches = new Map<string, number>();
const expandedSourceKeys = new Set<string>();
let homeScoreRefreshKey = '';
const HOME_SCORE_TTL_MS = 45_000;
const DISPLAY_TIME_ZONE = 'America/Chicago';
const AUTO_REFRESH_MS = 5 * 60_000;
let lastCentralDate = '';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function calendarDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function centralDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DISPLAY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseDateKey(value: string): Date | null {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function pickDateKey(pick: Pick): string {
  const raw = String(pick.date || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '' : centralDateKey(parsed);
}

function dateLabel(key: string, long = false): string {
  const date = parseDateKey(key);
  if (!date) return key;
  return date.toLocaleDateString('en-US', long
    ? { weekday: 'long', month: 'long', day: 'numeric' }
    : { month: 'short', day: 'numeric' });
}

function formatStart(value: unknown): string {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return 'TBD';
  return date.toLocaleTimeString('en-US', {
    timeZone: DISPLAY_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function formatOdds(pick: Pick): string {
  if (pick.odds != null) return pick.odds > 0 ? `+${pick.odds}` : String(pick.odds);
  const probability = Number(pick.probability);
  return Number.isFinite(probability)
    ? `${Math.round((probability <= 1 ? probability * 100 : probability))}%`
    : '';
}

function sourceName(pick: Pick): string {
  return String(pick.source || 'Unknown').trim();
}

function gameName(pick: Pick): string {
  const explicit = String(pick.matchup || pick.game || '').trim();
  if (explicit) return explicit;
  if (pick.away_team && pick.home_team) return `${pick.away_team} vs ${pick.home_team}`;
  const parenthetical = pick.pick.match(/\(([^)]+(?:vs|@)[^)]+)\)/i);
  return parenthetical?.[1] || pick.pick;
}

function gameKey(pick: Pick): string {
  const teams = teamsForPick(pick);
  const matchup = teams
    ? teams.map(canonicalTeamToken).sort().join('|')
    : normalizeTeam(gameName(pick));
  return `${pick.sport}::${pickDateKey(pick)}::${matchup}`;
}

function statsFor(picks: Pick[]): Stats {
  const wins = picks.filter(pick => pick.result === 'win').length;
  const losses = picks.filter(pick => pick.result === 'loss').length;
  const pushes = picks.filter(pick => pick.result === 'push').length;
  const pending = picks.filter(pick => pick.result === 'pending').length;
  const decided = wins + losses;
  const net = Number(picks.reduce((sum, pick) => sum + pick.pl, 0).toFixed(2));
  const risk = Number(picks.filter(pick => pick.result !== 'pending' && pick.result !== 'push')
    .reduce((sum, pick) => sum + pick.units, 0).toFixed(2));
  return {
    total: picks.length,
    wins,
    losses,
    pushes,
    pending,
    net,
    risk,
    winRate: decided ? wins / decided : null,
    roi: risk ? net / risk : null,
  };
}

function signedUnits(value: number): string {
  return `${value >= 0 ? '+' : ''}${Number(value.toFixed(2))}u`;
}

function shiftedDateKey(key: string, days: number): string {
  const date = parseDateKey(key);
  if (!date) return key;
  date.setDate(date.getDate() + days);
  return calendarDateKey(date);
}

function sourceRecordText(picks: Pick[]): string {
  const stats = statsFor(picks);
  const record = `${stats.wins}-${stats.losses}${stats.pushes ? `-${stats.pushes}` : ''}`;
  return [
    record,
    signedUnits(stats.net),
    stats.winRate == null ? '' : `${(stats.winRate * 100).toFixed(1)}%`,
    stats.pending ? `${stats.pending} pending` : '',
  ].filter(Boolean).join(' | ');
}

function sourceRecordLines(picks: Pick[]): Array<{ label: string; text: string }> {
  const today = centralDateKey();
  const yesterday = shiftedDateKey(today, -1);
  const lastSevenStart = shiftedDateKey(today, -6);
  const forDate = (key: string): Pick[] => picks.filter(pick => pickDateKey(pick) === key);
  return [
    { label: 'TODAY', text: sourceRecordText(forDate(today)) },
    { label: 'YESTERDAY', text: sourceRecordText(forDate(yesterday)) },
    {
      label: 'LAST 7 DAYS',
      text: sourceRecordText(picks.filter(pick => {
        const key = pickDateKey(pick);
        return key >= lastSevenStart && key <= today;
      })),
    },
    { label: 'ALL TIME', text: sourceRecordText(picks) },
  ];
}

function resultBadge(result: PickResult): string {
  return `<span class="badge badge-${result}">${result.toUpperCase()}</span>`;
}

function statusClass(picks: Pick[]): string {
  if (picks.some(pick => pick.result === 'pending')) return 'live';
  const results = new Set(picks.map(pick => pick.result));
  if (results.size > 1) return 'mixed';
  return picks[0]?.result || 'live';
}

function ensureSelection(): void {
  const dates = [...new Set(getAllPicks().map(pickDateKey).filter(Boolean))].sort();
  const today = centralDateKey();
  if (followCentralToday) selectedDate = today;
  else if (!dates.includes(selectedDate)) selectedDate = dates.at(-1) || today;
  if (!calendarMonth) calendarMonth = selectedDate.slice(0, 7);
}

function filteredPicks(): Pick[] {
  return getAllPicks().filter(pick => (
    activeFilter === 'ALL' ||
    pick.sport === activeFilter ||
    sourceName(pick) === activeFilter
  ));
}

function boardPicks(): Pick[] {
  return filteredPicks().filter(pick => {
    if (pickDateKey(pick) !== selectedDate) return false;
    if (homeMode === 'pending') return pick.result === 'pending';
    if (homeMode === 'settled') return pick.result !== 'pending';
    return true;
  });
}

function setRefreshStatus(message: string, state = ''): void {
  const status = document.getElementById('refresh-status');
  if (status) {
    status.textContent = message;
    status.classList.toggle('ok', state === 'ok');
    status.classList.toggle('error', state === 'error');
  }
}

function renderFilters(): void {
  const container = document.getElementById('filter-bar');
  if (!container) return;
  const picks = getAllPicks();
  const filters = ['ALL', ...new Set([
    ...picks.map(pick => pick.sport),
    ...picks.map(sourceName),
  ])];
  container.innerHTML = filters.map(filter => (
    `<button class="filter-btn ${activeFilter === filter ? 'active' : ''}" data-filter="${escapeHtml(filter)}">${escapeHtml(filter)}</button>`
  )).join('');
  container.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(button => {
    button.addEventListener('click', () => {
      activeFilter = button.dataset.filter || 'ALL';
      render();
    });
  });
}

function calendarHtml(): string {
  const monthDate = parseDateKey(`${calendarMonth}-01`) || parseDateKey(selectedDate) || new Date();
  const gridStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1 - monthDate.getDay());
  const counts = new Map<string, number>();
  filteredPicks().forEach(pick => counts.set(pickDateKey(pick), (counts.get(pickDateKey(pick)) || 0) + 1));
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
    const key = calendarDateKey(date);
    const count = counts.get(key) || 0;
    return `<button class="home-calendar-day ${date.getMonth() !== monthDate.getMonth() ? 'is-outside' : ''} ${key === centralDateKey() ? 'is-today' : ''} ${key === selectedDate ? 'is-selected' : ''} ${count ? 'has-picks' : ''}" data-date="${key}">
      <span class="home-calendar-day-num">${date.getDate()}</span>
      <span class="home-calendar-day-count">${count || '&middot;'}</span>
    </button>`;
  }).join('');
  return `<div class="home-date-popover-top">
    <div><div class="home-date-popover-label">Calendar View</div><div class="home-date-popover-month">${monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div></div>
    <div class="home-date-nav-wrap"><button class="home-date-nav" data-month-shift="-1">&#8249;</button><button class="home-date-nav" data-month-shift="1">&#8250;</button></div>
  </div>
  <div class="home-date-weekdays">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => `<div class="home-date-weekday">${day}</div>`).join('')}</div>
  <div class="home-calendar-grid">${days}</div>`;
}

function bindCalendar(): void {
  const popover = document.getElementById('home-date-popover');
  if (!popover) return;
  popover.querySelectorAll<HTMLButtonElement>('[data-date]').forEach(button => {
    button.addEventListener('click', () => {
      selectedDate = button.dataset.date || selectedDate;
      followCentralToday = selectedDate === centralDateKey();
      calendarMonth = selectedDate.slice(0, 7);
      calendarOpen = false;
      render();
    });
  });
  popover.querySelectorAll<HTMLButtonElement>('[data-month-shift]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const current = parseDateKey(`${calendarMonth}-01`) || new Date();
      current.setMonth(current.getMonth() + Number(button.dataset.monthShift || 0));
      calendarMonth = calendarDateKey(current).slice(0, 7);
      render();
    });
  });
}

function renderHome(): void {
  ensureSelection();
  renderFilters();
  const picks = boardPicks();
  const stats = statsFor(picks);
  const selectedAll = filteredPicks().filter(pick => pickDateKey(pick) === selectedDate);
  const groups = new Map<string, Pick[]>();
  picks.forEach(pick => groups.set(gameKey(pick), [...(groups.get(gameKey(pick)) || []), pick]));

  const title = document.getElementById('home-title');
  const sub = document.getElementById('home-sub');
  const dateChip = document.getElementById('home-date-chip');
  const filterChip = document.getElementById('home-filter-chip');
  const modeChip = document.getElementById('home-mode-chip');
  const triggerValue = document.getElementById('home-date-trigger-value');
  const triggerMeta = document.getElementById('home-date-trigger-meta');
  if (title) title.textContent = `${dateLabel(selectedDate, true)} Slate`;
  if (sub) sub.textContent = `${selectedAll.length} committed picks from automated model and feed refreshes.`;
  if (dateChip) dateChip.textContent = dateLabel(selectedDate).toUpperCase();
  if (filterChip) filterChip.textContent = activeFilter === 'ALL' ? 'ALL SOURCES' : activeFilter.toUpperCase();
  if (modeChip) modeChip.textContent = `${homeMode.toUpperCase()} VIEW`;
  if (triggerValue) triggerValue.textContent = dateLabel(selectedDate, true);
  if (triggerMeta) triggerMeta.textContent = selectedDate === centralDateKey() ? 'Today | CT' : `${selectedAll.length} picks`;
  document.querySelectorAll<HTMLElement>('[data-home-mode]').forEach(button => button.classList.toggle('active', button.dataset.homeMode === homeMode));

  const summary = document.getElementById('home-summary-grid');
  if (summary) summary.innerHTML = [
    [stats.total, homeMode === 'pending' ? 'Open Picks' : 'Picks'],
    [groups.size, 'Matchups'],
    [new Set(picks.map(sourceName)).size, 'Sources'],
    [stats.pending, 'Pending'],
    [signedUnits(stats.net), 'Net Units'],
  ].map(([value, label]) => `<div class="home-summary-card"><div class="home-summary-value">${escapeHtml(value)}</div><div class="home-summary-label">${label}</div></div>`).join('');

  const popover = document.getElementById('home-date-popover');
  if (popover) {
    popover.innerHTML = calendarHtml();
    popover.classList.toggle('open', calendarOpen);
  }
  document.getElementById('home-date-trigger')?.setAttribute('aria-expanded', String(calendarOpen));
  bindCalendar();

  const feed = document.getElementById('pick-feed');
  if (!feed) return;
  if (!picks.length) {
    feed.innerHTML = `<div class="pick-feed-empty"><div class="home-empty-kicker">${homeMode.toUpperCase()} | ${escapeHtml(dateLabel(selectedDate).toUpperCase())}</div><div class="home-empty-title">No ${homeMode} picks in this view</div><div class="home-empty-sub">Choose another date, result mode, sport, or source.</div></div>`;
    return;
  }
  const bySport = new Map<string, Array<[string, Pick[]]>>();
  [...groups.entries()].forEach(entry => {
    const sport = entry[1][0]?.sport || 'OTHER';
    bySport.set(sport, [...(bySport.get(sport) || []), entry]);
  });
  feed.innerHTML = [...bySport.entries()].map(([sport, games]) => `
    <section class="home-feed-section">
      <div class="home-feed-section-head"><div><div class="home-feed-section-title">${escapeHtml(sport)}</div><div class="home-feed-section-meta">${games.reduce((sum, game) => sum + game[1].length, 0)} picks | ${games.length} matchups</div></div></div>
      <div class="home-feed-grid">${games.map(([, gamePicks]) => renderGameCard(gamePicks)).join('')}</div>
    </section>`).join('');
  void refreshHomeScores(selectedDate, picks);
}

function renderGameCard(picks: Pick[]): string {
  const stats = statsFor(picks);
  const pending = stats.pending > 0;
  const start = picks.map(pick => pick.start_time).filter(Boolean).sort()[0];
  const scoreChip = homeScoreChipHtml(homeScores.get(gameKey(picks[0])), start, gameName(picks[0]));
  return `<article class="home-game-card status-${statusClass(picks)}">
    <div class="home-game-top">
      <div class="home-game-kicker"><span class="home-sport-pill">${escapeHtml(picks[0]?.sport)}</span><span class="home-status-pill ${statusClass(picks)}">${pending ? 'PENDING' : `${stats.wins}-${stats.losses}${stats.pushes ? `-${stats.pushes}` : ''}`}</span></div>
      <div class="home-game-right-stack">${scoreChip}<div class="home-game-pl ${stats.net > 0 ? 'positive' : stats.net < 0 ? 'negative' : 'neutral'}">${pending ? `${stats.pending} open` : signedUnits(stats.net)}</div><div class="home-game-caption">${formatStart(start)}</div></div>
    </div>
    <div><div class="home-game-title">${escapeHtml(gameName(picks[0]))}</div><div class="home-game-meta">${escapeHtml(dateLabel(pickDateKey(picks[0])))} | ${picks.length} picks | ${new Set(picks.map(sourceName)).size} sources</div></div>
    <div class="home-game-picks">${picks.map(renderPickRow).join('')}</div>
  </article>`;
}

function renderPickRow(pick: Pick): string {
  return `<div class="home-feed-row result-${pick.result}">
    <span class="home-feed-row-sport">${escapeHtml(pick.sport)}</span>
    <div class="home-feed-row-body"><div class="home-feed-row-source">${escapeHtml(sourceName(pick))}</div><div class="home-feed-row-pick">${escapeHtml(pick.pick)}</div><div class="home-feed-row-meta">${escapeHtml([formatOdds(pick), `${pick.units}u`, formatStart(pick.start_time), pick.decision].filter(Boolean).join(' | '))}</div></div>
    <div class="home-feed-row-pl ${pick.pl > 0 ? 'positive' : pick.pl < 0 ? 'negative' : 'neutral'}">${pick.result === 'pending' ? `${pick.units}u risk` : signedUnits(pick.pl)}</div>
    <div class="home-feed-row-control">${resultBadge(pick.result)}</div>
  </div>`;
}

function updateOverallStats(): void {
  const stats = statsFor(getAllPicks());
  const values: Record<string, string | number> = {
    'stat-picks': stats.total,
    'stat-wins': stats.wins,
    'stat-losses': stats.losses,
    'stat-pushes': stats.pushes,
    'stat-pending': stats.pending,
    'stat-acc': stats.winRate == null ? '—' : `${(stats.winRate * 100).toFixed(1)}%`,
    'stat-units': signedUnits(stats.net),
    'stat-roi': stats.roi == null ? '—' : `${(stats.roi * 100).toFixed(1)}%`,
  };
  Object.entries(values).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value);
  });
}

function renderRankings(): void {
  const bySource = new Map<string, Pick[]>();
  getAllPicks().forEach(pick => bySource.set(sourceName(pick), [...(bySource.get(sourceName(pick)) || []), pick]));
  const ranked = [...bySource.entries()].map(([source, picks]) => ({ source, picks, stats: statsFor(picks) }))
    .filter(item => item.stats.wins + item.stats.losses > 0)
    .sort((a, b) => (b.stats.roi ?? -999) - (a.stats.roi ?? -999) || b.stats.net - a.stats.net);
  const leaderboard = document.getElementById('leaderboard');
  if (leaderboard) {
    leaderboard.innerHTML = ranked.length ? ranked.map((item, index) => {
      const expanded = expandedSourceKeys.has(item.source);
      const records = sourceRecordLines(item.picks);
      return `<article class="source-card ${index < 3 ? `rank-${index + 1}` : ''} ${expanded ? 'expanded' : ''}" data-source-card="${escapeHtml(item.source)}" role="button" tabindex="0" aria-expanded="${expanded}">
        <div class="card-rank">${index + 1}</div><div class="card-name">${escapeHtml(item.source)}</div>
        <div class="score-bar-wrap"><div class="score-label"><span>ACCURACY</span><span class="score-val">${item.stats.winRate == null ? '—' : `${(item.stats.winRate * 100).toFixed(1)}%`} (${item.stats.wins}-${item.stats.losses})</span></div><div class="bar-bg"><div class="bar-fill bar-acc" style="width:${(item.stats.winRate || 0) * 100}%"></div></div></div>
        <div class="score-bar-wrap"><div class="score-label"><span>ROI</span><span class="score-val">${item.stats.roi == null ? '—' : `${(item.stats.roi * 100).toFixed(1)}%`} (${signedUnits(item.stats.net)})</span></div><div class="bar-bg"><div class="bar-fill bar-roi" style="width:${Math.max(0, Math.min(100, 50 + (item.stats.roi || 0) * 100))}%"></div></div></div>
        <div class="algo-score"><div class="algo-score-val">${item.stats.total}</div><div class="algo-score-info">TRACKED PICKS<br>${item.stats.pending} PENDING</div></div>
        <div class="source-expand-control"><span data-source-expand-label>${expanded ? 'Hide period records' : 'View period records'}</span><span class="source-expand-icon" aria-hidden="true">&#9662;</span></div>
        <div class="source-deep-dive">
          <div class="trend-deep-title">PERIOD RECORDS</div>
          <div class="source-record-list">${records.map(record => `<div class="source-record-item"><div class="source-record-label">${record.label}</div><div class="source-record-value">${record.text}</div></div>`).join('')}</div>
        </div>
      </article>`;
    }).join('') : '<div class="empty-state">No committed grades yet. The scheduled grader will build rankings as games finish.</div>';
    bindSourceCards(leaderboard);
  }

  const bySport = new Map<string, Pick[]>();
  getAllPicks().forEach(pick => bySport.set(pick.sport, [...(bySport.get(pick.sport) || []), pick]));
  const sportBoard = document.getElementById('sport-board');
  if (sportBoard) sportBoard.innerHTML = [...bySport.entries()].map(([sport, picks]) => {
    const stats = statsFor(picks);
    return `<div class="sport-card"><div class="sport-name">${escapeHtml(sport)}</div><div class="sport-meta">${stats.wins}-${stats.losses}${stats.pushes ? `-${stats.pushes}` : ''} record<br>${stats.total} tracked picks</div><div class="sport-units ${stats.net >= 0 ? 'positive' : 'negative'}">${signedUnits(stats.net)}</div><div class="sport-meta">ROI ${stats.roi == null ? '—' : `${(stats.roi * 100).toFixed(1)}%`}</div></div>`;
  }).join('');

  renderDayOfWeekTable();
}

function bindSourceCards(leaderboard: HTMLElement): void {
  leaderboard.querySelectorAll<HTMLElement>('[data-source-card]').forEach(card => {
    const toggle = (): void => {
      const source = card.dataset.sourceCard || '';
      if (!source) return;
      const expanded = !expandedSourceKeys.has(source);
      if (expanded) expandedSourceKeys.add(source);
      else expandedSourceKeys.delete(source);
      card.classList.toggle('expanded', expanded);
      card.setAttribute('aria-expanded', String(expanded));
      const label = card.querySelector<HTMLElement>('[data-source-expand-label]');
      if (label) label.textContent = expanded ? 'Hide period records' : 'View period records';
    };
    card.addEventListener('click', toggle);
    card.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggle();
    });
  });
}

function renderDayOfWeekTable(): void {
  const container = document.getElementById('dow-model-breakdown');
  if (!container) return;
  const dayOrder = [1, 2, 3, 4, 5, 6, 0];
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const bySource = new Map<string, Pick[][]>();

  getAllPicks().filter(pick => pick.result === 'win' || pick.result === 'loss').forEach(pick => {
    const day = parseDateKey(pickDateKey(pick))?.getDay();
    if (day == null) return;
    const buckets = bySource.get(sourceName(pick)) || Array.from({ length: 7 }, () => []);
    buckets[day].push(pick);
    bySource.set(sourceName(pick), buckets);
  });

  const sources = [...bySource.keys()].sort((a, b) => a.localeCompare(b));
  if (!sources.length) {
    container.innerHTML = '<div class="empty-state">No decided picks yet</div>';
    return;
  }

  container.innerHTML = `<table class="dow-table">
    <thead><tr><th>Source</th>${dayLabels.map(day => `<th>${day}</th>`).join('')}</tr></thead>
    <tbody>${sources.map(source => `<tr><td class="dow-model-name">${escapeHtml(source)}</td>${dayOrder.map(day => {
      const stats = statsFor(bySource.get(source)?.[day] || []);
      const decided = stats.wins + stats.losses;
      const rate = stats.winRate == null ? null : stats.winRate * 100;
      const tone = decided < 3 || rate == null
        ? 'dow-cell-gray'
        : rate >= 55 ? 'dow-cell-green' : rate >= 50 ? 'dow-cell-yellow' : 'dow-cell-red';
      const text = rate == null ? '—' : `${rate.toFixed(0)}% (${stats.wins}-${stats.losses})`;
      return `<td class="${tone}" title="${decided} decided picks">${text}</td>`;
    }).join('')}</tr>`).join('')}</tbody>
  </table>`;
}

function renderSearch(): void {
  const input = document.getElementById('search-input') as HTMLInputElement | null;
  const results = document.getElementById('search-results');
  const meta = document.getElementById('search-meta');
  if (!input || !results || !meta) return;
  ensureSelection();
  const query = input.value.trim().toLowerCase();
  const pending = getAllPicks().filter(pick => pick.result === 'pending' && pickDateKey(pick) === selectedDate);
  const scope = `${dateLabel(selectedDate, true)} pending picks (Central time)`;
  if (!query) {
    meta.textContent = `${pending.length} ${scope.toLowerCase()}`;
    results.innerHTML = '<div class="empty-state">Type a team name, matchup, or source to search pending picks for the selected Home date</div>';
    return;
  }
  const picks = pending.filter(pick => [pick.pick, sourceName(pick), pick.sport, pick.date, gameName(pick)].some(value => String(value).toLowerCase().includes(query)));
  meta.textContent = `${picks.length} pending result${picks.length === 1 ? '' : 's'} for "${input.value.trim()}" | ${scope}`;
  results.innerHTML = picks.length ? picks.map(pick => `
    <div class="search-card"><div class="search-card-top">${resultBadge(pick.result)}<span class="badge badge-source">${escapeHtml(sourceName(pick))}</span><div class="search-card-pick">${escapeHtml(pick.pick)}</div><div class="search-card-odds">${escapeHtml(formatOdds(pick))}</div></div>
      <div class="search-card-row"><div class="search-card-field"><span class="search-card-field-label">GAME</span><span class="search-card-field-val">${escapeHtml(gameName(pick))}</span></div><div class="search-card-field"><span class="search-card-field-label">DATE</span><span class="search-card-field-val">${escapeHtml(pick.date)}</span></div><div class="search-card-field"><span class="search-card-field-label">P/L</span><span class="search-card-field-val">${signedUnits(pick.pl)}</span></div></div>
    </div>`).join('') : '<div class="empty-state">No pending picks match your search for the selected Home date</div>';
}

function canonicalTeamForPick(pick: Pick, label: string): string {
  const target = normalizeTeam(label);
  const matched = teamsForPick(pick)?.find(team => {
    const normalized = normalizeTeam(team);
    return normalized === target || normalized.includes(target) || target.includes(normalized);
  });
  return canonicalTeamToken(matched || label);
}

function trendMarketScope(pick: Pick, selection: string): string {
  const lower = selection.toLowerCase();
  const inning = lower.match(/\binning\s*(\d+)|\b(\d+)(?:st|nd|rd|th)?\s+inning\b/);
  if (inning) return `inning:${inning[1] || inning[2]}`;
  if (/\bf5\b|first five/.test(lower)) return 'first-five';
  if (lower.includes('team total')) {
    return `team-total:${canonicalTeamForPick(pick, String(pick.team || selection.split(/team total/i)[0]))}`;
  }
  return 'full-game';
}

function canonicalTrendSignal(pick: Pick): { key: string; label: string; pass: boolean } {
  const selection = pick.pick.split('(', 1)[0].trim();
  const pass = String(pick.decision || '').trim().toUpperCase() === 'PASS';
  const scope = trendMarketScope(pick, selection);
  const total = selection.match(/\b(over|under)\s+(\d+(?:\.\d+)?)/i);
  if (total) return { key: `${scope}:total:${total[1].toLowerCase()}`, label: selection, pass };

  const noRun = selection.match(/\binning\s*(\d+).*?\bno runs?\b|\bno runs?\b.*?\binning\s*(\d+)/i);
  if (noRun) return { key: `inning:no-run:${noRun[1] || noRun[2]}`, label: selection, pass };

  const spread = selection.match(/^(.*?)\s+([+-]\d+(?:\.\d+)?)(?:\s|$)/);
  if (spread) return { key: `${scope}:side:${canonicalTeamForPick(pick, spread[1])}`, label: selection, pass };

  const moneyline = selection.match(/^(.*?)\s+(?:ML|moneyline|to win|wins?)\b/i);
  if (moneyline) return { key: `${scope}:side:${canonicalTeamForPick(pick, moneyline[1])}`, label: selection, pass };

  return { key: `pick:${normalizeTeam(selection)}`, label: selection, pass };
}

function trendSignalGroups(picks: Pick[]): TrendSignalGroup[] {
  const grouped = new Map<string, { labels: Set<string>; picks: Pick[]; pass: boolean }>();
  picks.forEach(pick => {
    const signal = canonicalTrendSignal(pick);
    const key = `${signal.pass ? 'pass' : 'bet'}:${signal.key}`;
    const current = grouped.get(key) || { labels: new Set<string>(), picks: [], pass: signal.pass };
    current.labels.add(signal.label);
    current.picks.push(pick);
    grouped.set(key, current);
  });
  return [...grouped.entries()].map(([key, group]) => ({
    key,
    label: [...group.labels].join(' / '),
    picks: group.picks,
    matching: !group.pass && new Set(group.picks.map(sourceName)).size >= 2,
    pass: group.pass,
  })).sort((a, b) => Number(b.matching) - Number(a.matching) || b.picks.length - a.picks.length);
}

function renderTrendSignal(group: TrendSignalGroup): string {
  const sources = [...new Set(group.picks.map(sourceName))];
  const details = [...new Set(group.picks.flatMap(pick => [
    formatOdds(pick),
    pick.edge != null ? `edge ${pick.edge}` : '',
  ]).filter(Boolean))];
  return `<div class="trend-market ${group.matching ? 'matching' : ''} ${group.pass ? 'pass' : ''}">
    <div class="trend-market-row"><span class="trend-market-label">${group.matching ? `${sources.length} MATCHING SOURCES` : group.pass ? 'PASS' : 'SINGLE SIGNAL'}</span><span class="trend-market-signal">${escapeHtml(group.label)}</span></div>
    <div class="trend-source-row">${sources.map(source => `<span class="trend-source-pill">${escapeHtml(source)}</span>`).join('')}</div>
    ${details.length ? `<div class="trend-market-detail">${escapeHtml(details.join(' | '))}</div>` : ''}
  </div>`;
}

function renderTrends(): void {
  const container = document.getElementById('trends-container');
  if (!container) return;
  ensureSelection();
  const pending = getAllPicks().filter(pick => pick.result === 'pending' && pickDateKey(pick) === selectedDate);
  const games = new Map<string, Pick[]>();
  pending.forEach(pick => games.set(gameKey(pick), [...(games.get(gameKey(pick)) || []), pick]));
  const consensus = [...games.values()].map(picks => {
    const signals = trendSignalGroups(picks);
    const matching = signals.filter(signal => signal.matching).length;
    const actionable = signals.filter(signal => !signal.pass).length;
    return { picks, signals, matching, split: matching === 0 && actionable > 1 };
  }).sort((a, b) => b.matching - a.matching || b.picks.length - a.picks.length);
  const matchingGroups = consensus.reduce((total, game) => total + game.matching, 0);
  const conflictGames = consensus.filter(game => game.split).length;

  container.innerHTML = `<div class="trend-head"><div class="trend-title">Consensus Radar</div><div class="trend-subtitle">${escapeHtml(dateLabel(selectedDate, true))} pending picks. Green appears only when two or more sources make the same market selection.</div></div>
    <div class="trend-summary-grid"><div class="trend-summary-box"><div class="trend-summary-val">${matchingGroups}</div><div class="trend-summary-label">MATCHING SIGNALS</div></div><div class="trend-summary-box"><div class="trend-summary-val">${games.size}</div><div class="trend-summary-label">MATCHUPS</div></div><div class="trend-summary-box"><div class="trend-summary-val">${conflictGames}</div><div class="trend-summary-label">CONFLICT GAMES</div></div><div class="trend-summary-box"><div class="trend-summary-val">${new Set(pending.map(sourceName)).size}</div><div class="trend-summary-label">SOURCES</div></div></div>
    ${consensus.length ? `<div class="trend-board">${consensus.map(game => `<div class="trend-game-card ${game.split ? 'split' : ''}"><div class="trend-game-head"><div><div class="trend-game-name">${escapeHtml(gameName(game.picks[0]))}</div><div class="trend-game-meta">${escapeHtml(game.picks[0].sport)} | ${escapeHtml(dateLabel(pickDateKey(game.picks[0])))}</div></div><div class="trend-strength-pill ${game.matching ? 'strong' : game.split ? 'split' : 'lean'}">${game.matching ? `${game.matching} MATCHING` : game.split ? 'MIXED SIGNALS' : 'LEAN'}</div></div>${game.signals.map(renderTrendSignal).join('')}</div>`).join('')}</div>` : '<div class="empty-state">No pending trends for this slate.</div>'}`;
}

function pickProbability(pick: Pick): number | null {
  if (pick.probability == null) return null;
  const raw = Number(pick.probability);
  if (!Number.isFinite(raw)) return null;
  const probability = raw > 1 ? raw / 100 : raw;
  return probability >= 0 && probability <= 1 ? probability : null;
}

function pickEdgePercent(pick: Pick): number | null {
  if (pick.market_edge == null && pick.edge == null) return null;
  const raw = Number(pick.market_edge ?? pick.edge);
  if (!Number.isFinite(raw)) return null;
  return Math.abs(raw) <= 1 ? raw * 100 : raw;
}

function dailyDecision(pick: Pick): string {
  return String(pick.decision || 'WATCH').trim().toUpperCase();
}

function dailySourceForms(date: string, todaysPicks: Pick[]): DailySourceForm[] {
  const historical = getAllPicks().filter(pick => pickDateKey(pick) < date);
  const recentDates = [...new Set(historical.map(pickDateKey).filter(Boolean))].sort().slice(-3);
  const lastDate = recentDates.at(-1) || '';
  const sources = new Set(todaysPicks.map(sourceName));
  return [...sources].map(source => {
    const recent = historical.filter(pick => sourceName(pick) === source && recentDates.includes(pickDateKey(pick)) && pick.result !== 'pending');
    const last = recent.filter(pick => pickDateKey(pick) === lastDate);
    const recentStats = statsFor(recent);
    const lastStats = statsFor(last);
    const todayBets = todaysPicks.filter(pick => sourceName(pick) === source && pick.result === 'pending' && dailyDecision(pick) === 'BET');
    const score = (recentStats.winRate || 0) * 100 + Math.min(recentStats.wins + recentStats.losses, 20) * 0.35 + recentStats.net * 0.08;
    return { source, recentStats, lastStats, recentDates, todayBets, score };
  }).filter(form => form.recentStats.wins + form.recentStats.losses >= 3)
    .sort((a, b) => b.score - a.score);
}

function dailyPickScore(pick: Pick, forms: Map<string, DailySourceForm>): number {
  const probability = pickProbability(pick);
  const edge = pickEdgePercent(pick);
  const sourceRate = forms.get(sourceName(pick))?.recentStats.winRate;
  return (probability == null ? 45 : probability * 100)
    + Math.max(-10, Math.min(25, edge || 0)) * 0.65
    + (sourceRate == null ? 0 : (sourceRate - 0.5) * 30)
    + (dailyDecision(pick) === 'BET' ? 8 : dailyDecision(pick) === 'LEAN' ? 2 : 0);
}

function dailyPickCard(pick: Pick, note: string): string {
  const probability = pickProbability(pick);
  const edge = pickEdgePercent(pick);
  const decision = dailyDecision(pick);
  const pricey = pick.odds != null && pick.odds <= -300;
  const metric = probability != null
    ? `${(probability * 100).toFixed(1)}%`
    : edge != null ? `${edge >= 0 ? '+' : ''}${edge.toFixed(1)}%` : formatOdds(pick) || 'TRACK';
  const metricLabel = probability != null ? 'MODEL WIN PROB' : edge != null ? 'MODEL EDGE' : 'MARKET PRICE';
  return `<article class="daily-bet-card decision-${decision.toLowerCase()} ${pricey ? 'is-pricey' : ''}">
    <div class="daily-bet-top"><div><div class="daily-bet-source">${escapeHtml(sourceName(pick))} | ${escapeHtml(pick.sport)}</div><div class="daily-bet-pick">${escapeHtml(pick.pick)}</div></div><div class="daily-bet-score"><strong>${escapeHtml(metric)}</strong><span>${metricLabel}</span></div></div>
    <div class="daily-bet-game">${escapeHtml(gameName(pick))} | ${escapeHtml(formatStart(pick.start_time))}</div>
    <div class="daily-bet-tags"><span class="daily-decision-tag ${decision.toLowerCase()}">${escapeHtml(decision)}</span>${formatOdds(pick) ? `<span>${escapeHtml(formatOdds(pick))}</span>` : ''}${edge != null ? `<span>${edge >= 0 ? '+' : ''}${edge.toFixed(1)}% edge</span>` : ''}${pricey ? '<span class="pricey">PRICEY FAVORITE</span>' : ''}</div>
    <div class="daily-bet-note">${escapeHtml(note)}</div>
  </article>`;
}

function dailySection(title: string, subtitle: string, body: string): string {
  return `<section class="daily-zone"><div class="daily-section-head"><div class="daily-section-title">${escapeHtml(title)}</div><div class="daily-section-sub">${escapeHtml(subtitle)}</div></div>${body}</section>`;
}

function dailyPickGrid(picks: Pick[], note: (pick: Pick) => string): string {
  if (!picks.length) return '<div class="daily-empty"><div class="daily-empty-title">Nothing qualifies yet</div><div class="daily-empty-sub">This zone will populate when the committed models meet its rules.</div></div>';
  return `<div class="daily-bet-grid">${picks.map(pick => dailyPickCard(pick, note(pick))).join('')}</div>`;
}

function dailyHotModelCard(form: DailySourceForm): string {
  const recentDecided = form.recentStats.wins + form.recentStats.losses;
  const lastDecided = form.lastStats.wins + form.lastStats.losses;
  const todays = form.todayBets.slice(0, 3);
  return `<article class="daily-model-card">
    <div class="daily-model-head"><div><div class="daily-model-kicker">HOT SOURCE</div><div class="daily-model-name">${escapeHtml(form.source)}</div></div><div class="daily-model-rate">${form.recentStats.winRate == null ? '—' : `${(form.recentStats.winRate * 100).toFixed(0)}%`}</div></div>
    <div class="daily-model-records"><span>Last ${form.recentDates.length} slates: ${form.recentStats.wins}-${form.recentStats.losses}${form.recentStats.pushes ? `-${form.recentStats.pushes}` : ''}</span><span>Last slate: ${lastDecided ? `${form.lastStats.wins}-${form.lastStats.losses}${form.lastStats.pushes ? `-${form.lastStats.pushes}` : ''}` : 'No decisions'}</span></div>
    <div class="daily-model-picks">${todays.length ? todays.map(pick => `<div><strong>${escapeHtml(pick.pick)}</strong><span>${escapeHtml([formatOdds(pick), pickProbability(pick) == null ? '' : `${(pickProbability(pick)! * 100).toFixed(1)}%`].filter(Boolean).join(' | '))}</span></div>`).join('') : '<div><strong>No BET call today</strong><span>Recent form is hot, but the model is sitting out.</span></div>'}</div>
    <div class="daily-model-foot">${recentDecided} recent decisions | ${signedUnits(form.recentStats.net)}</div>
  </article>`;
}

function dailyConsensusCards(picks: Pick[]): string {
  const games = new Map<string, Pick[]>();
  picks.forEach(pick => games.set(gameKey(pick), [...(games.get(gameKey(pick)) || []), pick]));
  const matching = [...games.values()].flatMap(gamePicks => trendSignalGroups(gamePicks)
    .filter(signal => signal.matching)
    .map(signal => ({ signal, game: gamePicks[0] })))
    .sort((a, b) => b.signal.picks.length - a.signal.picks.length)
    .slice(0, 6);
  if (!matching.length) return '<div class="daily-empty"><div class="daily-empty-title">No true consensus yet</div><div class="daily-empty-sub">Two independent sources must make the same market selection.</div></div>';
  return `<div class="daily-consensus-grid">${matching.map(({ signal, game }) => `<article class="daily-consensus-card"><div class="daily-consensus-count">${new Set(signal.picks.map(sourceName)).size} SOURCES</div><div class="daily-consensus-pick">${escapeHtml(signal.label)}</div><div class="daily-consensus-game">${escapeHtml(gameName(game))}</div><div class="trend-source-row">${[...new Set(signal.picks.map(sourceName))].map(source => `<span class="trend-source-pill">${escapeHtml(source)}</span>`).join('')}</div></article>`).join('')}</div>`;
}

function renderDaily(): void {
  const container = document.getElementById('daily-container');
  if (!container) return;
  const dates = [...new Set(getAllPicks().map(pickDateKey).filter(Boolean))].sort();
  const today = centralDateKey();
  const key = dates.includes(today) ? today : dates.at(-1) || today;
  const picks = getAllPicks().filter(pick => pickDateKey(pick) === key);
  const stats = statsFor(picks);
  const pending = picks.filter(pick => pick.result === 'pending');
  const forms = dailySourceForms(key, picks);
  const formsBySource = new Map(forms.map(form => [form.source, form]));
  const ranked = (candidates: Pick[]) => [...candidates].sort((a, b) => dailyPickScore(b, formsBySource) - dailyPickScore(a, formsBySource));
  const modelBets = ranked(pending.filter(pick => dailyDecision(pick) === 'BET')).slice(0, 8);
  const probabilityLeaders = [...pending].filter(pick => pickProbability(pick) != null)
    .sort((a, b) => (pickProbability(b) || 0) - (pickProbability(a) || 0)).slice(0, 8);
  const valueZone = ranked(pending.filter(pick => dailyDecision(pick) === 'BET' && ((pick.odds || 0) > 0 || (pickEdgePercent(pick) || 0) >= 10))).slice(0, 6);
  const researchQueue = [...pending].filter(pick => (
    (pickProbability(pick) || 0) >= 0.6 && dailyDecision(pick) !== 'BET'
  ) || (pick.odds != null && pick.odds <= -300)).sort((a, b) => (pickProbability(b) || 0) - (pickProbability(a) || 0)).slice(0, 6);
  const priceyCount = pending.filter(pick => pick.odds != null && pick.odds <= -300).length;
  const consensusCount = (() => {
    const games = new Map<string, Pick[]>();
    pending.forEach(pick => games.set(gameKey(pick), [...(games.get(gameKey(pick)) || []), pick]));
    return [...games.values()].reduce((total, gamePicks) => total + trendSignalGroups(gamePicks).filter(signal => signal.matching).length, 0);
  })();

  container.innerHTML = `<div class="daily-hero"><div class="daily-hero-row"><div><div class="daily-eyebrow">TODAY'S BETTING TLDR</div><div class="daily-title">The Shortlist</div><div class="daily-sub">${escapeHtml(dateLabel(key, true))} | Probability is not the same as value. Prices, edges, recent form, and consensus are labeled separately.</div></div><div class="daily-clock-wrap"><div class="daily-clock-label">SLATE DATE</div><div class="daily-clock">${escapeHtml(key)}</div></div></div>
    <div class="daily-stats-strip">${[[modelBets.length, 'Model Greenlights'], [probabilityLeaders.length, 'Probability Leaders'], [consensusCount, 'Consensus Signals'], [forms.filter(form => form.todayBets.length).length, 'Hot Models Betting'], [priceyCount, 'Pricey Favorites']].map(([value, label]) => `<div class="daily-stat"><div class="daily-stat-val">${escapeHtml(value)}</div><div class="daily-stat-label">${label}</div></div>`).join('')}</div></div>
    ${dailySection('Best Bets: Model Greenlights', 'BET calls ranked by probability, edge, and recent source form', dailyPickGrid(modelBets, pick => {
      const form = formsBySource.get(sourceName(pick));
      return form?.recentStats.winRate != null ? `${sourceName(pick)} is ${(form.recentStats.winRate * 100).toFixed(0)}% across the last ${form.recentDates.length} completed slates.` : 'The model marked this as a BET; compare the probability and price before sizing.';
    }))}
    ${dailySection('Success Zone: Highest Probability', 'Raw model win probability, including expensive favorites and non-BET calls', dailyPickGrid(probabilityLeaders, pick => {
      if (pick.odds != null && pick.odds <= -300) return 'High expected hit rate, but the price is expensive. This is intentionally shown even when Kelly sizing is small.';
      if (dailyDecision(pick) !== 'BET') return `High model probability, but the official decision is ${dailyDecision(pick)}. Treat it as research, not an automatic bet.`;
      return 'One of today’s highest raw model probabilities. Check price and edge before treating probability as value.';
    }))}
    ${dailySection('Best Bets From Hot Models', 'Recent three-slate form, with the latest completed-slate record shown separately', forms.filter(form => form.todayBets.length).slice(0, 6).length ? `<div class="daily-model-grid">${forms.filter(form => form.todayBets.length).slice(0, 6).map(dailyHotModelCard).join('')}</div>` : '<div class="daily-empty"><div class="daily-empty-title">No hot model has a BET today</div><div class="daily-empty-sub">Strong recent records remain visible only when that source has a current greenlight.</div></div>')}
    ${dailySection('Consensus Zone', 'Same market selection from at least two independent sources', dailyConsensusCards(pending))}
    ${dailySection('Value Zone', 'Plus-money BETs or model edges of at least 10%', dailyPickGrid(valueZone, pick => (pick.odds || 0) > 0 ? 'Plus-money upside with an active BET call. Higher payout still means higher variance.' : 'The model reports a double-digit edge; verify that the market line has not moved.'))}
    ${dailySection('Research Queue', 'Likely outcomes that may still be poor bets, plus strong non-BET signals', dailyPickGrid(researchQueue, pick => pick.odds != null && pick.odds <= -300 ? 'This favorite may win often, but the payout is thin. Compare price, parlay temptation, and downside.' : `The model sees probability, but its official call is ${dailyDecision(pick)}. Research the reason before betting.`))}
    <div class="daily-disclaimer"><strong>Quick read, not a blind card.</strong> Model probability estimates the chance of winning. Edge compares that chance with the market price. Recent records and consensus add context, but none guarantees the next result. ${stats.pending} picks remain open on this slate.</div>`;
}

function render(): void {
  renderHome();
  updateOverallStats();
  renderRankings();
  const active = document.querySelector('.tab-content.active')?.id;
  if (active === 'tab-search') renderSearch();
  if (active === 'tab-trends') renderTrends();
  if (active === 'tab-daily') renderDaily();
}

function switchTab(name: string): void {
  document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  document.querySelector<HTMLElement>(`.tab[onclick*="'${name}'"]`)?.classList.add('active');
  document.getElementById(`tab-${name}`)?.classList.add('active');
  if (name === 'home') renderHome();
  if (name === 'search') renderSearch();
  if (name === 'trends') renderTrends();
  if (name === 'daily') renderDaily();
}

function setHomeResultMode(mode: string): void {
  if (mode === 'pending' || mode === 'all' || mode === 'settled') {
    homeMode = mode;
    renderHome();
  }
}

function toggleHomeDatePicker(event?: Event): void {
  event?.stopPropagation();
  calendarOpen = !calendarOpen;
  renderHome();
}

function normalizeTeam(value: unknown): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\b(the|baseball|basketball|club)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

function canonicalTeamToken(value: unknown): string {
  const normalized = normalizeTeam(value);
  const multiWordNames = [
    'red sox',
    'white sox',
    'blue jays',
    'trail blazers',
    'golden knights',
    'maple leafs',
    'red wings',
  ];
  const suffix = multiWordNames.find(name => normalized === name || normalized.endsWith(` ${name}`));
  return suffix || normalized.split(' ').at(-1) || normalized;
}

function teamMatches(label: string, team: Record<string, unknown>): boolean {
  const target = normalizeTeam(label);
  const names = [team.displayName, team.shortDisplayName, team.name, team.abbreviation].map(normalizeTeam);
  return names.some(name => name && (name === target || name.includes(target) || target.includes(name)));
}

function teamsForPick(pick: Pick): [string, string] | null {
  if (pick.away_team && pick.home_team) return [String(pick.away_team), String(pick.home_team)];
  const matchup = gameName(pick).split(/\s+(?:vs|@)\s+/i).map(value => value.trim()).filter(Boolean);
  return matchup.length === 2 ? [matchup[0], matchup[1]] : null;
}

function findEspnEventForPick(pick: Pick, events: unknown[]): { event: Record<string, unknown>; game: Record<string, unknown> } | null {
  const teams = teamsForPick(pick);
  if (!teams) return null;
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const eventObject = event as Record<string, unknown>;
    const competition = eventObject.competitions;
    const game = Array.isArray(competition) ? competition[0] as Record<string, unknown> : null;
    const competitors = Array.isArray(game?.competitors) ? game.competitors as Record<string, unknown>[] : [];
    if (competitors.length !== 2) continue;
    const teamObjects = competitors.map(competitor => competitor.team as Record<string, unknown>);
    if ((teamMatches(teams[0], teamObjects[0]) && teamMatches(teams[1], teamObjects[1])) ||
        (teamMatches(teams[0], teamObjects[1]) && teamMatches(teams[1], teamObjects[0]))) return { event: eventObject, game };
  }
  return null;
}

function findEspnGame(pick: Pick, events: unknown[]): Record<string, unknown> | null {
  return findEspnEventForPick(pick, events)?.game || null;
}

function espnStatus(event: Record<string, unknown>, game: Record<string, unknown>): Record<string, unknown> {
  const status = game.status || event.status;
  if (!status || typeof status !== 'object') return {};
  const type = (status as Record<string, unknown>).type;
  return type && typeof type === 'object' ? type as Record<string, unknown> : {};
}

function homeScoreInfo(sport: string, event: Record<string, unknown>, game: Record<string, unknown>): HomeScoreInfo {
  const competitors = Array.isArray(game.competitors) ? game.competitors as Record<string, unknown>[] : [];
  const away = competitors.find(competitor => competitor.homeAway === 'away') || competitors[0] || {};
  const home = competitors.find(competitor => competitor.homeAway === 'home') || competitors[1] || {};
  const teamCode = (competitor: Record<string, unknown>): string => {
    const team = competitor.team && typeof competitor.team === 'object' ? competitor.team as Record<string, unknown> : {};
    return String(team.abbreviation || team.shortDisplayName || team.name || '').trim();
  };
  const type = espnStatus(event, game);
  const state = String(type.state || '').toLowerCase();
  const name = String(type.name || '').toUpperCase();
  const detail = String(type.shortDetail || type.detail || type.description || '').trim();
  const delayed = ['STATUS_POSTPONED', 'STATUS_SUSPENDED', 'STATUS_CANCELED', 'STATUS_CANCELLED'].includes(name);
  const final = Boolean(type.completed) || state === 'post' || ['STATUS_FINAL', 'STATUS_FULL_TIME'].includes(name);
  const live = state === 'in';
  const awayScore = Number(away.score);
  const homeScore = Number(home.score);
  const hasScore = Number.isFinite(awayScore) && Number.isFinite(homeScore);
  const score = hasScore ? `${teamCode(away)} ${awayScore} - ${teamCode(home)} ${homeScore}` : '';
  const startTime = String(game.date || event.date || '');
  const tone: HomeScoreInfo['tone'] = delayed ? 'delayed' : final ? 'final' : live ? 'live' : 'pregame';
  const text = delayed
    ? detail || 'Delayed'
    : final ? score ? `Final | ${score}` : 'Final'
      : live ? score ? `${score} | ${detail || 'Live'}` : detail || 'Live'
        : startTime ? `Starts ${formatStart(startTime)}` : detail || 'Scheduled';
  return { eventId: String(event.id || ''), sport, tone, text, startTime };
}

function homeScoreChipHtml(info: HomeScoreInfo | undefined, fallbackStart: unknown, gameLabel: string): string {
  if (!info) {
    return fallbackStart ? `<span class="home-score-chip pregame">${escapeHtml(`Starts ${formatStart(fallbackStart)}`)}</span>` : '';
  }
  const sportSlug = info.sport.toLowerCase();
  const url = info.eventId ? `https://www.espn.com/${sportSlug}/game/_/gameId/${encodeURIComponent(info.eventId)}` : '';
  const tag = url ? 'a' : 'span';
  const attrs = url ? ` href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="Open ESPN box score for ${escapeHtml(gameLabel)}"` : '';
  return `<${tag} class="home-score-chip ${info.tone}"${attrs}>${escapeHtml(info.text)}</${tag}>`;
}

function homeTabActive(): boolean {
  return Boolean(document.getElementById('tab-home')?.classList.contains('active'));
}

async function refreshHomeScores(date: string, picks: Pick[]): Promise<void> {
  if (!date || !picks.length || !homeTabActive()) return;
  const supported = picks.filter(pick => ESPN_ENDPOINTS[pick.sport]);
  if (!supported.length) return;
  const key = `${date}::${[...new Set(supported.map(gameKey))].sort().join('|')}`;
  const now = Date.now();
  if (homeScoreRefreshKey === key || now - (homeScoreFetches.get(key) || 0) < HOME_SCORE_TTL_MS) return;
  homeScoreRefreshKey = key;
  homeScoreFetches.set(key, now);
  let changed = false;
  const bySport = new Map<string, Pick[]>();
  supported.forEach(pick => bySport.set(pick.sport, [...(bySport.get(pick.sport) || []), pick]));

  try {
    for (const [sport, sportPicks] of bySport) {
      const endpoint = ESPN_ENDPOINTS[sport];
      try {
        const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${endpoint[0]}/${endpoint[1]}/scoreboard?dates=${date.replace(/-/g, '')}`, { cache: 'no-store' });
        if (!response.ok) continue;
        const payload = await response.json() as { events?: unknown[] };
        sportPicks.forEach(pick => {
          const matched = findEspnEventForPick(pick, payload.events || []);
          if (!matched) return;
          const next = homeScoreInfo(sport, matched.event, matched.game);
          const previous = homeScores.get(gameKey(pick));
          if (JSON.stringify(previous) !== JSON.stringify(next)) {
            homeScores.set(gameKey(pick), next);
            changed = true;
          }
          if (next.startTime) setLocalGameTime(pick.id, next.startTime);
        });
      } catch {
        // A missing scoreboard should not prevent the rest of the Home slate from rendering.
      }
    }
  } finally {
    homeScoreRefreshKey = '';
  }

  if (changed && homeTabActive()) renderHome();
}

function scoreForTeam(game: Record<string, unknown>, label: string): [number, number] | null {
  const competitors = Array.isArray(game.competitors) ? game.competitors as Record<string, unknown>[] : [];
  const selected = competitors.find(competitor => teamMatches(label, competitor.team as Record<string, unknown>));
  const opponent = competitors.find(competitor => competitor !== selected);
  if (!selected || !opponent) return null;
  return [Number(selected.score), Number(opponent.score)];
}

function lineScoreRuns(competitor: Record<string, unknown>, inning: number): number | null {
  const linescores = Array.isArray(competitor.linescores)
    ? competitor.linescores
    : Array.isArray(competitor.lineScores) ? competitor.lineScores : [];
  const entry = linescores[inning - 1];
  if (!entry || typeof entry !== 'object') return null;
  const raw = (entry as Record<string, unknown>).value
    ?? (entry as Record<string, unknown>).score
    ?? (entry as Record<string, unknown>).runs;
  const runs = Number(raw);
  return Number.isFinite(runs) ? runs : null;
}

function firstFiveRuns(competitor: Record<string, unknown>): number | null {
  const runs = Array.from({ length: 5 }, (_, index) => lineScoreRuns(competitor, index + 1));
  return runs.some(value => value == null) ? null : runs.reduce<number>((sum, value) => sum + Number(value), 0);
}

function firstFiveScoreForTeam(game: Record<string, unknown>, label: string): [number, number] | null {
  const competitors = Array.isArray(game.competitors) ? game.competitors as Record<string, unknown>[] : [];
  const selected = competitors.find(competitor => teamMatches(label, competitor.team as Record<string, unknown>));
  const opponent = competitors.find(competitor => competitor !== selected);
  if (!selected || !opponent) return null;
  const selectedRuns = firstFiveRuns(selected);
  const opponentRuns = firstFiveRuns(opponent);
  return selectedRuns == null || opponentRuns == null ? null : [selectedRuns, opponentRuns];
}

function gradePick(pick: Pick, game: Record<string, unknown>): PickResult {
  const text = pick.pick.split('(', 1)[0].trim();
  const lower = text.toLowerCase();
  const competitors = Array.isArray(game.competitors) ? game.competitors as Record<string, unknown>[] : [];
  const scores = competitors.map(competitor => Number(competitor.score));
  if (scores.some(score => !Number.isFinite(score))) return 'pending';

  const noRunInning = lower.match(/\binning\s+([1-8])\s*[-:–—]?\s*no\s+runs?\s+scored\b/);
  if (pick.sport === 'MLB' && noRunInning) {
    const runs = competitors.map(competitor => lineScoreRuns(competitor, Number(noRunInning[1])));
    if (runs.some(value => value == null)) return 'pending';
    return runs.reduce<number>((sum, value) => sum + Number(value), 0) === 0 ? 'win' : 'loss';
  }

  const firstFive = pick.sport === 'MLB' && (
    ['f5_side', 'f5_total', 'first_five', 'first-five'].includes(String(pick.market || '').toLowerCase())
    || /\bf5\b|first\s*five/.test(lower)
  );
  if (firstFive) {
    const totalMatch = lower.match(/\b(over|under)\s+(\d+(?:\.\d+)?)\s*(?:f5|first\s*five)\b/);
    if (totalMatch) {
      const firstFiveScores = competitors.map(firstFiveRuns);
      if (firstFiveScores.some(value => value == null)) return 'pending';
      const total = firstFiveScores.reduce<number>((sum, value) => sum + Number(value), 0);
      const line = Number(totalMatch[2]);
      if (total === line) return 'push';
      return totalMatch[1] === 'over' ? (total > line ? 'win' : 'loss') : (total < line ? 'win' : 'loss');
    }
    const team = String(pick.team || text.replace(/\s+(?:f5|first\s*five)\s+ml\b/i, '')).trim();
    const score = firstFiveScoreForTeam(game, team);
    if (!score) return 'pending';
    return score[0] === score[1] ? 'push' : score[0] > score[1] ? 'win' : 'loss';
  }

  const total = scores[0] + scores[1];
  const totalMatch = lower.match(/\b(over|under)\s+(\d+(?:\.\d+)?)/);
  const teamGoals = lower.match(/^(.*?)\s+(over|under)\s+(\d+(?:\.\d+)?)\s*tg\b/);
  const teamTotal = lower.match(/^(.*?)\s+team total\s+(over|under)\s+(\d+(?:\.\d+)?)/);
  const teamMarket = teamTotal || teamGoals;
  if (teamMarket) {
    const score = scoreForTeam(game, teamMarket[1]);
    if (!score) return 'pending';
    const line = Number(teamMarket[3]);
    if (score[0] === line) return 'push';
    return teamMarket[2] === 'over' ? (score[0] > line ? 'win' : 'loss') : (score[0] < line ? 'win' : 'loss');
  }
  if (totalMatch) {
    const line = Number(totalMatch[2]);
    if (total === line) return 'push';
    return totalMatch[1] === 'over' ? (total > line ? 'win' : 'loss') : (total < line ? 'win' : 'loss');
  }
  const spread = text.match(/^(.*?)\s+([+-]\d+(?:\.\d+)?)/);
  if (spread) {
    const score = scoreForTeam(game, spread[1]);
    if (!score) return 'pending';
    const adjusted = score[0] + Number(spread[2]);
    return adjusted === score[1] ? 'push' : adjusted > score[1] ? 'win' : 'loss';
  }
  const moneyline = text.match(/^(.*?)\s+(?:ML|moneyline|to win|wins?)\b/i);
  const team = moneyline?.[1] || String(pick.team || '').trim();
  if (team) {
    const score = scoreForTeam(game, team);
    if (!score) return 'pending';
    return score[0] === score[1] ? 'push' : score[0] > score[1] ? 'win' : 'loss';
  }
  return 'pending';
}

async function gradeDate(date: string, picks: Pick[]): Promise<number> {
  let graded = 0;
  const dateParam = date.replace(/-/g, '');
  for (const [sport, endpoint] of Object.entries(ESPN_ENDPOINTS)) {
    const sportPicks = picks.filter(pick => pick.sport === sport && pick.result === 'pending');
    if (!sportPicks.length) continue;
    try {
      const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${endpoint[0]}/${endpoint[1]}/scoreboard?dates=${dateParam}`, { cache: 'no-store' });
      if (!response.ok) continue;
      const payload = await response.json() as { events?: unknown[] };
      for (const pick of sportPicks) {
        const game = findEspnGame(pick, payload.events || []);
        if (!game) continue;
        const startTime = String(game.date || '');
        if (startTime) setLocalGameTime(pick.id, startTime);
        const status = game.status as { type?: { completed?: boolean; name?: string } } | undefined;
        const statusName = String(status?.type?.name || '').toUpperCase();
        if (['STATUS_POSTPONED', 'STATUS_CANCELED', 'STATUS_CANCELLED'].includes(statusName)) {
          setLocalResult(pick.id, 'push');
          graded += 1;
        } else if (status?.type?.completed) {
          const result = gradePick(pick, game);
          if (result !== 'pending') {
            setLocalResult(pick.id, result);
            graded += 1;
          }
        }
      }
    } catch {
      // One unavailable scoreboard should not block other sports or dates.
    }
  }
  return graded;
}

async function refreshAutoGrades(): Promise<void> {
  if (refreshInFlight) return;
  refreshInFlight = true;
  setRefreshStatus('Loading latest picks and final scores...');
  const button = document.getElementById('refresh-btn') as HTMLButtonElement | null;
  if (button) button.disabled = true;
  try {
    await loadAllData();
    updateSyncStatus();
    const pending = getAllPicks().filter(pick => pick.result === 'pending');
    const byDate = new Map<string, Pick[]>();
    pending.forEach(pick => byDate.set(pickDateKey(pick), [...(byDate.get(pickDateKey(pick)) || []), pick]));
    let graded = 0;
    for (const [date, picks] of byDate) graded += await gradeDate(date, picks);
    render();
    setRefreshStatus(graded ? `Graded ${graded} pick${graded === 1 ? '' : 's'} locally` : 'No new final scores', 'ok');
  } catch {
    setRefreshStatus('Could not refresh scores', 'error');
  } finally {
    refreshInFlight = false;
    if (button) button.disabled = false;
  }
}

async function refreshForCentralClock(): Promise<void> {
  const today = centralDateKey();
  if (today !== lastCentralDate && followCentralToday) {
    selectedDate = today;
    calendarMonth = today.slice(0, 7);
  }
  lastCentralDate = today;
  await refreshAutoGrades();
}

function updateSyncStatus(): void {
  const status = getCacheStatus();
  const syncStatus = document.getElementById('sync-status');
  if (syncStatus) syncStatus.textContent = status.date ? `cache ${status.date}${status.runTime ? ` | ${status.runTime}` : ''}` : 'cache unavailable';
}

Object.assign(window, {
  switchTab,
  setHomeResultMode,
  toggleHomeDatePicker,
  refreshAutoGrades,
  renderSearch,
});

document.addEventListener('click', event => {
  const wrap = document.getElementById('home-date-wrap');
  if (calendarOpen && wrap && !wrap.contains(event.target as Node)) {
    calendarOpen = false;
    renderHome();
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initMobileMode();
  initSettingsUI();
  await loadAllData();
  lastCentralDate = centralDateKey();
  updateSyncStatus();
  render();
  window.setInterval(() => void refreshForCentralClock(), AUTO_REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshForCentralClock();
  });
});
