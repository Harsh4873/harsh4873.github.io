import './styles/pickledger.css';
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

const ESPN_ENDPOINTS: Record<string, [string, string]> = {
  MLB: ['baseball', 'mlb'],
  NBA: ['basketball', 'nba'],
  WNBA: ['basketball', 'wnba'],
  NHL: ['hockey', 'nhl'],
};

let activeFilter = 'ALL';
let homeMode: 'pending' | 'all' | 'settled' = 'pending';
let selectedDate = '';
let calendarMonth = '';
let calendarOpen = false;
let refreshInFlight = false;

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
  return Number.isNaN(parsed.getTime()) ? '' : localDateKey(parsed);
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
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
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
  return `${pick.sport}::${pickDateKey(pick)}::${gameName(pick).toLowerCase()}`;
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
  if (!dates.includes(selectedDate)) selectedDate = dates.includes(localDateKey()) ? localDateKey() : dates.at(-1) || localDateKey();
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
    const key = localDateKey(date);
    const count = counts.get(key) || 0;
    return `<button class="home-calendar-day ${date.getMonth() !== monthDate.getMonth() ? 'is-outside' : ''} ${key === localDateKey() ? 'is-today' : ''} ${key === selectedDate ? 'is-selected' : ''} ${count ? 'has-picks' : ''}" data-date="${key}">
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
      calendarMonth = localDateKey(current).slice(0, 7);
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
  if (triggerMeta) triggerMeta.textContent = selectedDate === localDateKey() ? 'Today' : `${selectedAll.length} picks`;
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
}

function renderGameCard(picks: Pick[]): string {
  const stats = statsFor(picks);
  const pending = stats.pending > 0;
  const start = picks.map(pick => pick.start_time).filter(Boolean).sort()[0];
  return `<article class="home-game-card status-${statusClass(picks)}">
    <div class="home-game-top">
      <div class="home-game-kicker"><span class="home-sport-pill">${escapeHtml(picks[0]?.sport)}</span><span class="home-status-pill ${statusClass(picks)}">${pending ? 'PENDING' : `${stats.wins}-${stats.losses}${stats.pushes ? `-${stats.pushes}` : ''}`}</span></div>
      <div class="home-game-right-stack"><div class="home-game-pl ${stats.net > 0 ? 'positive' : stats.net < 0 ? 'negative' : 'neutral'}">${pending ? `${stats.pending} open` : signedUnits(stats.net)}</div><div class="home-game-caption">${formatStart(start)}</div></div>
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
  if (leaderboard) leaderboard.innerHTML = ranked.length ? ranked.map((item, index) => `
    <div class="source-card ${index < 3 ? `rank-${index + 1}` : ''}">
      <div class="card-rank">${index + 1}</div><div class="card-name">${escapeHtml(item.source)}</div>
      <div class="score-bar-wrap"><div class="score-label"><span>ACCURACY</span><span class="score-val">${item.stats.winRate == null ? '—' : `${(item.stats.winRate * 100).toFixed(1)}%`} (${item.stats.wins}-${item.stats.losses})</span></div><div class="bar-bg"><div class="bar-fill bar-acc" style="width:${(item.stats.winRate || 0) * 100}%"></div></div></div>
      <div class="score-bar-wrap"><div class="score-label"><span>ROI</span><span class="score-val">${item.stats.roi == null ? '—' : `${(item.stats.roi * 100).toFixed(1)}%`} (${signedUnits(item.stats.net)})</span></div><div class="bar-bg"><div class="bar-fill bar-roi" style="width:${Math.max(0, Math.min(100, 50 + (item.stats.roi || 0) * 100))}%"></div></div></div>
      <div class="algo-score"><div class="algo-score-val">${item.stats.total}</div><div class="algo-score-info">TRACKED PICKS<br>${item.stats.pending} PENDING</div></div>
    </div>`).join('') : '<div class="empty-state">No committed grades yet. The scheduled grader will build rankings as games finish.</div>';

  const bySport = new Map<string, Pick[]>();
  getAllPicks().forEach(pick => bySport.set(pick.sport, [...(bySport.get(pick.sport) || []), pick]));
  const sportBoard = document.getElementById('sport-board');
  if (sportBoard) sportBoard.innerHTML = [...bySport.entries()].map(([sport, picks]) => {
    const stats = statsFor(picks);
    return `<div class="sport-card"><div class="sport-name">${escapeHtml(sport)}</div><div class="sport-meta">${stats.wins}-${stats.losses}${stats.pushes ? `-${stats.pushes}` : ''} record<br>${stats.total} tracked picks</div><div class="sport-units ${stats.net >= 0 ? 'positive' : 'negative'}">${signedUnits(stats.net)}</div><div class="sport-meta">ROI ${stats.roi == null ? '—' : `${(stats.roi * 100).toFixed(1)}%`}</div></div>`;
  }).join('');

  const daySection = document.getElementById('dow-overall-heatmap');
  if (daySection) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    daySection.innerHTML = `<div class="sport-board">${days.map((day, index) => {
      const picks = getAllPicks().filter(pick => parseDateKey(pickDateKey(pick))?.getDay() === index);
      const stats = statsFor(picks);
      return `<div class="sport-card"><div class="sport-name">${day}</div><div class="sport-meta">${stats.wins}-${stats.losses}${stats.pushes ? `-${stats.pushes}` : ''}<br>${stats.total} picks</div><div class="sport-units">${stats.winRate == null ? '—' : `${(stats.winRate * 100).toFixed(0)}%`}</div></div>`;
    }).join('')}</div>`;
  }
}

function renderSearch(): void {
  const input = document.getElementById('search-input') as HTMLInputElement | null;
  const results = document.getElementById('search-results');
  const meta = document.getElementById('search-meta');
  if (!input || !results || !meta) return;
  const query = input.value.trim().toLowerCase();
  if (!query) {
    meta.textContent = '';
    results.innerHTML = '<div class="empty-state">Type a team name, matchup, or source to search picks</div>';
    return;
  }
  const picks = getAllPicks().filter(pick => [pick.pick, sourceName(pick), pick.sport, pick.date, gameName(pick)].some(value => String(value).toLowerCase().includes(query)));
  meta.textContent = `${picks.length} result${picks.length === 1 ? '' : 's'} for "${input.value.trim()}"`;
  results.innerHTML = picks.length ? picks.map(pick => `
    <div class="search-card"><div class="search-card-top">${resultBadge(pick.result)}<span class="badge badge-source">${escapeHtml(sourceName(pick))}</span><div class="search-card-pick">${escapeHtml(pick.pick)}</div><div class="search-card-odds">${escapeHtml(formatOdds(pick))}</div></div>
      <div class="search-card-row"><div class="search-card-field"><span class="search-card-field-label">GAME</span><span class="search-card-field-val">${escapeHtml(gameName(pick))}</span></div><div class="search-card-field"><span class="search-card-field-label">DATE</span><span class="search-card-field-val">${escapeHtml(pick.date)}</span></div><div class="search-card-field"><span class="search-card-field-label">P/L</span><span class="search-card-field-val">${signedUnits(pick.pl)}</span></div></div>
    </div>`).join('') : '<div class="empty-state">No picks match your search</div>';
}

function renderTrends(): void {
  const container = document.getElementById('trends-container');
  if (!container) return;
  const pending = getAllPicks().filter(pick => pick.result === 'pending');
  const groups = new Map<string, Pick[]>();
  pending.forEach(pick => groups.set(gameKey(pick), [...(groups.get(gameKey(pick)) || []), pick]));
  const consensus = [...groups.values()].sort((a, b) => b.length - a.length);
  container.innerHTML = `<div class="trend-head"><div class="trend-title">Active Consensus</div><div class="trend-subtitle">Pending picks grouped by matchup from committed model data.</div></div>
    <div class="trend-summary-grid"><div class="trend-summary-box"><div class="trend-summary-val">${pending.length}</div><div class="trend-summary-label">PENDING PICKS</div></div><div class="trend-summary-box"><div class="trend-summary-val">${groups.size}</div><div class="trend-summary-label">MATCHUPS</div></div><div class="trend-summary-box"><div class="trend-summary-val">${new Set(pending.map(sourceName)).size}</div><div class="trend-summary-label">SOURCES</div></div></div>
    <div class="trend-board">${consensus.map(picks => `<div class="trend-game-card ${picks.length >= 3 ? 'strong' : ''}"><div class="trend-game-head"><div><div class="trend-game-name">${escapeHtml(gameName(picks[0]))}</div><div class="trend-game-meta">${escapeHtml(picks[0].sport)} | ${escapeHtml(dateLabel(pickDateKey(picks[0])))}</div></div><div class="trend-strength-pill ${picks.length >= 3 ? 'strong' : 'lean'}">${picks.length} signals</div></div>${picks.map(pick => `<div class="trend-market"><div class="trend-market-row"><span class="trend-market-label">${escapeHtml(sourceName(pick))}</span><span class="trend-market-signal">${escapeHtml(pick.pick)}</span></div><div class="trend-market-detail">${escapeHtml([formatOdds(pick), pick.decision, pick.edge != null ? `edge ${pick.edge}` : ''].filter(Boolean).join(' | '))}</div></div>`).join('')}</div>`).join('')}</div>`;
}

function renderDaily(): void {
  const container = document.getElementById('daily-container');
  if (!container) return;
  const dates = [...new Set(getAllPicks().map(pickDateKey).filter(Boolean))].sort();
  const key = dates.includes(localDateKey()) ? localDateKey() : dates.at(-1) || localDateKey();
  const picks = getAllPicks().filter(pick => pickDateKey(pick) === key);
  const stats = statsFor(picks);
  const groups = new Map<string, Pick[]>();
  picks.forEach(pick => groups.set(gameKey(pick), [...(groups.get(gameKey(pick)) || []), pick]));
  container.innerHTML = `<div class="daily-hero"><div class="daily-hero-row"><div><div class="daily-eyebrow">LATEST COMMITTED SLATE</div><div class="daily-title">${escapeHtml(dateLabel(key, true))}</div><div class="daily-sub">Automated picks and grades from repository JSON.</div></div><div class="daily-clock-wrap"><div class="daily-clock-label">CACHE DATE</div><div class="daily-clock">${escapeHtml(key)}</div></div></div>
    <div class="daily-stats-strip">${[[stats.total, 'Picks'], [stats.pending, 'Pending'], [`${stats.wins}-${stats.losses}`, 'Record'], [signedUnits(stats.net), 'Net Units'], [groups.size, 'Matchups']].map(([value, label]) => `<div class="daily-stat"><div class="daily-stat-val">${escapeHtml(value)}</div><div class="daily-stat-label">${label}</div></div>`).join('')}</div></div>
    <div class="daily-section-head"><div class="daily-section-title">Slate</div><div class="daily-section-sub">${groups.size} matchup${groups.size === 1 ? '' : 's'}</div></div>
    <div class="daily-slate-grid">${[...groups.values()].map(picksInGame => `<div class="daily-slate-card decided-${statusClass(picksInGame)}"><div class="daily-slate-head"><div><div class="daily-slate-game">${escapeHtml(gameName(picksInGame[0]))}</div><div class="daily-slate-meta">${escapeHtml(picksInGame[0].sport)} | ${picksInGame.length} picks</div></div><span class="daily-slate-badge ${statusClass(picksInGame)}">${statusClass(picksInGame).toUpperCase()}</span></div><div class="daily-slate-picks">${picksInGame.map(pick => `<div class="daily-slate-pick result-${pick.result}"><span class="daily-slate-source">${escapeHtml(sourceName(pick))}</span><span class="daily-slate-text">${escapeHtml(pick.pick)}</span><span class="daily-slate-odds">${escapeHtml(formatOdds(pick))}</span><span class="daily-slate-result ${pick.result}">${pick.result.toUpperCase()}</span></div>`).join('')}</div></div>`).join('')}</div>`;
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

function findEspnGame(pick: Pick, events: unknown[]): Record<string, unknown> | null {
  const teams = teamsForPick(pick);
  if (!teams) return null;
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const competition = (event as Record<string, unknown>).competitions;
    const game = Array.isArray(competition) ? competition[0] as Record<string, unknown> : null;
    const competitors = Array.isArray(game?.competitors) ? game.competitors as Record<string, unknown>[] : [];
    if (competitors.length !== 2) continue;
    const teamObjects = competitors.map(competitor => competitor.team as Record<string, unknown>);
    if ((teamMatches(teams[0], teamObjects[0]) && teamMatches(teams[1], teamObjects[1])) ||
        (teamMatches(teams[0], teamObjects[1]) && teamMatches(teams[1], teamObjects[0]))) return game;
  }
  return null;
}

function scoreForTeam(game: Record<string, unknown>, label: string): [number, number] | null {
  const competitors = Array.isArray(game.competitors) ? game.competitors as Record<string, unknown>[] : [];
  const selected = competitors.find(competitor => teamMatches(label, competitor.team as Record<string, unknown>));
  const opponent = competitors.find(competitor => competitor !== selected);
  if (!selected || !opponent) return null;
  return [Number(selected.score), Number(opponent.score)];
}

function gradePick(pick: Pick, game: Record<string, unknown>): PickResult {
  const text = pick.pick.split('(', 1)[0].trim();
  const lower = text.toLowerCase();
  const competitors = Array.isArray(game.competitors) ? game.competitors as Record<string, unknown>[] : [];
  const scores = competitors.map(competitor => Number(competitor.score));
  if (scores.some(score => !Number.isFinite(score))) return 'pending';
  const total = scores[0] + scores[1];
  const totalMatch = lower.match(/\b(over|under)\s+(\d+(?:\.\d+)?)/);
  if (totalMatch && !lower.includes('team total')) {
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
  const moneyline = text.match(/^(.*?)\s+ML\b/i);
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
  setRefreshStatus('Checking final scores...');
  const button = document.getElementById('refresh-btn') as HTMLButtonElement | null;
  if (button) button.disabled = true;
  try {
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
  const status = getCacheStatus();
  const syncStatus = document.getElementById('sync-status');
  if (syncStatus) syncStatus.textContent = status.date ? `cache ${status.date}${status.runTime ? ` | ${status.runTime}` : ''}` : 'cache unavailable';
  render();
});
