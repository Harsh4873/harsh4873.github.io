// @ts-nocheck
export interface ModelsUIDeps {
  runModel: (model: string, event?: unknown) => Promise<void> | void;
  loadCannonDailyPicks: (event?: unknown) => Promise<void> | void;
  loadNbaPropsGames: () => Promise<void> | void;
  toggleAllModelPicks: () => void;
  updateModelSelectAll: () => void;
  addSelectedPicksToLedger: () => void;
  addModelPicksToLedger: () => void;
}

// ── Model Console ──
let selectedModelCardId = 'model-card-mlb-new';
let modelStatusObserver = null;
let modelWheelInitialized = false;
let modelChooserInitialized = false;
let modelDeps = null;
let suggestedModelCardId = null;

function getModelWheelCards(options = {}) {
  const cards = Array.from(document.querySelectorAll('#model-wheel-orbit .model-card'));
  if (!options.visibleOnly) return cards;
  return cards.filter(card => !card.classList.contains('model-hidden'));
}

function getSelectedModelCard() {
  const visibleCards = getModelWheelCards({ visibleOnly: true });
  const selected = selectedModelCardId ? document.getElementById(selectedModelCardId) : null;
  if (selected && visibleCards.includes(selected)) return selected;
  return visibleCards[0] || null;
}

function getModelCardRunButton(card) {
  if (!card) return null;
  return card.querySelector('.model-card-actions .model-run-btn');
}

function getModelCardStatusElement(card) {
  if (!card) return null;
  const key = String(card.dataset.modelKey || '').trim();
  return key ? document.getElementById('status-' + key) : null;
}

function getModelCardState(card) {
  const statusEl = getModelCardStatusElement(card);
  if (!statusEl) return '';
  if (statusEl.classList.contains('running')) return 'running';
  if (statusEl.classList.contains('error')) return 'error';
  if (statusEl.classList.contains('ok')) return 'ok';
  return '';
}

function getModelCardLastRunMs(card) {
  if (!card) return 0;
  const badge = card.querySelector('.model-timestamp-badge');
  if (!badge) return 0;
  const ms = Number(badge.dataset.tsMs || 0);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

function formatRelativeAge(ms) {
  if (!ms || ms < 0) return '';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function refreshModelCardStatusClasses() {
  getModelWheelCards().forEach(card => {
    card.classList.remove('has-status-running', 'has-status-error', 'has-status-ok');
    const state = getModelCardState(card);
    if (state) card.classList.add('has-status-' + state);
  });
}

function refreshRailGroupCounts() {
  document.querySelectorAll('#model-wheel-orbit .models-rail-group').forEach(group => {
    const cards = Array.from(group.querySelectorAll('.model-card'));
    const visible = cards.filter(c => !c.classList.contains('model-hidden')).length;
    const countEl = group.querySelector('[data-group-count]');
    if (countEl) countEl.textContent = visible ? `${visible}` : '';
    group.classList.toggle('is-empty', visible === 0);
  });
}

function computeSuggestedNextCard() {
  const cards = getModelWheelCards({ visibleOnly: true });
  if (!cards.length) return { card: null, reason: 'no models visible' };

  const errorCard = cards.find(c => getModelCardState(c) === 'error');
  if (errorCard) {
    const title = errorCard.querySelector('.model-card-title')?.textContent || 'Model';
    return { card: errorCard, reason: `${title} hit an error — retry` };
  }

  const runningCard = cards.find(c => getModelCardState(c) === 'running');
  if (runningCard) {
    const title = runningCard.querySelector('.model-card-title')?.textContent || 'Model';
    return { card: null, reason: `${title} is running` };
  }

  const neverRun = cards.filter(c => !getModelCardLastRunMs(c));
  if (neverRun.length) {
    const top = neverRun[0];
    const title = top.querySelector('.model-card-title')?.textContent || 'Model';
    return { card: top, reason: `${title} — no recent run` };
  }

  const withTs = cards
    .map(c => ({ card: c, ms: getModelCardLastRunMs(c) }))
    .filter(x => x.ms)
    .sort((a, b) => a.ms - b.ms);
  if (withTs.length) {
    const stalest = withTs[0];
    const ageMs = Date.now() - stalest.ms;
    if (ageMs > 4 * 3600000) {
      const title = stalest.card.querySelector('.model-card-title')?.textContent || 'Model';
      return { card: stalest.card, reason: `${title} — last ${formatRelativeAge(ageMs)}` };
    }
  }

  return { card: null, reason: 'all caught up' };
}

function refreshLabPulseStats() {
  const cards = getModelWheelCards({ visibleOnly: true });
  const active = cards.length;
  let ready = 0;
  let running = 0;
  let errors = 0;
  cards.forEach(c => {
    const s = getModelCardState(c);
    if (s === 'ok') ready++;
    else if (s === 'running') running++;
    else if (s === 'error') errors++;
  });

  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  };
  set('lab-stat-active', active);
  set('lab-stat-ready', ready);
  set('lab-stat-running', running);
  set('lab-stat-errors', errors);

  const runDetail = document.getElementById('lab-stat-running-detail');
  if (runDetail) runDetail.textContent = running ? 'live now' : 'idle';
  const runVal = document.getElementById('lab-stat-running');
  if (runVal) runVal.classList.toggle('is-warn', running > 0);

  const errDetail = document.getElementById('lab-stat-errors-detail');
  if (errDetail) errDetail.textContent = errors ? 'need attention' : 'no errors';
  const errVal = document.getElementById('lab-stat-errors');
  if (errVal) errVal.classList.toggle('is-bad', errors > 0);

  const readyDetail = document.getElementById('lab-stat-ready-detail');
  if (readyDetail) {
    readyDetail.textContent = ready
      ? (ready === active ? 'all loaded' : `of ${active} loaded`)
      : 'picks loaded';
  }

  const suggestion = computeSuggestedNextCard();
  suggestedModelCardId = suggestion.card ? suggestion.card.id : null;
  const nextEl = document.getElementById('lab-stat-next');
  const nextDetail = document.getElementById('lab-stat-next-detail');
  const suggestWrap = document.getElementById('lab-stat-suggest');
  if (suggestWrap) suggestWrap.classList.toggle('is-idle', !suggestion.card);
  if (nextEl) {
    if (suggestion.card) {
      const title = suggestion.card.querySelector('.model-card-title')?.textContent || 'Model';
      nextEl.textContent = title;
      nextEl.setAttribute('aria-label', `Select suggested next model: ${title}`);
    } else {
      nextEl.textContent = errors ? 'Fix errors' : (running ? 'Running…' : 'All caught up');
      nextEl.removeAttribute('aria-label');
    }
  }
  if (nextDetail) nextDetail.textContent = suggestion.reason;
}

export function selectSuggestedModel() {
  if (!suggestedModelCardId) return;
  const card = document.getElementById(suggestedModelCardId);
  if (!card) return;
  selectModelCard(card);
  try {
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } catch (_e) {
    card.scrollIntoView();
  }
  card.focus({ preventScroll: true });
}

function updateStageFreshnessPill(card) {
  const pill = document.getElementById('model-stage-freshness');
  if (!pill) return;
  pill.classList.remove('is-stale', 'is-warn', 'is-running');
  if (!card) {
    pill.textContent = '—';
    return;
  }
  const state = getModelCardState(card);
  if (state === 'running') {
    pill.textContent = 'Running now';
    pill.classList.add('is-running');
    return;
  }
  if (state === 'error') {
    pill.textContent = 'Last run failed';
    pill.classList.add('is-stale');
    return;
  }
  const ms = getModelCardLastRunMs(card);
  if (!ms) {
    pill.textContent = 'No recent run';
    pill.classList.add('is-warn');
    return;
  }
  const age = Date.now() - ms;
  pill.textContent = `Updated ${formatRelativeAge(age)}`;
  if (age > 12 * 3600000) pill.classList.add('is-stale');
  else if (age > 4 * 3600000) pill.classList.add('is-warn');
}

export function syncModelFocusStatus(model) {
  refreshModelCardStatusClasses();
  refreshLabPulseStats();
  const card = getSelectedModelCard();
  updateStageFreshnessPill(card);
  if (!card) return;
  const key = String(card.dataset.modelKey || '').trim();
  const action = String(card.dataset.runAction || '').trim();
  const modelName = String(model || '').trim();
  const shouldSync = !modelName || modelName === key || modelName === action;
  if (!shouldSync) return;
  const statusEl = getModelCardStatusElement(card);
  const focusStatus = document.getElementById('model-focus-status');
  if (!focusStatus || !statusEl) return;
  const state = getModelCardState(card);
  focusStatus.textContent = statusEl.textContent || '';
  focusStatus.className = 'model-status model-stage-status model-focus-status' + (state ? ' ' + state : '');
}

export function setModelFocusButtonState(model, isRunning, label) {
  const card = getSelectedModelCard();
  const btn = document.getElementById('model-focus-run');
  if (!card || !btn) return;
  const key = String(card.dataset.modelKey || '').trim();
  const action = String(card.dataset.runAction || '').trim();
  if (model !== key && model !== action) return;
  btn.disabled = Boolean(isRunning);
  btn.textContent = label || card.dataset.runLabel || 'RUN MODEL';
}

export function refreshModelFocusFromSelected() {
  const card = getSelectedModelCard();
  const focusRun = document.getElementById('model-focus-run');
  const visibleCards = getModelWheelCards({ visibleOnly: true });
  const countEl = document.getElementById('model-focus-count');
  if (countEl) countEl.textContent = String(visibleCards.length);

  refreshRailGroupCounts();

  if (!card) {
    ['model-focus-category', 'model-focus-title', 'model-focus-desc', 'model-focus-insight', 'model-focus-timestamp', 'model-focus-status'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '';
    });
    const propsExtra = document.getElementById('model-focus-props-extra');
    if (propsExtra) propsExtra.classList.remove('active');
    if (focusRun) {
      focusRun.disabled = true;
      focusRun.textContent = 'NO MODEL SELECTED';
    }
    updateStageFreshnessPill(null);
    refreshLabPulseStats();
    return;
  }

  selectedModelCardId = card.id;
  getModelWheelCards().forEach(item => {
    const active = item === card;
    item.classList.toggle('is-active', active);
    item.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  const icon = card.querySelector('.model-card-icon')?.innerHTML || '';
  const title = card.querySelector('.model-card-title')?.textContent || 'Model';
  const desc = card.querySelector('.model-card-desc')?.textContent || '';
  const category = card.dataset.category || card.querySelector('.model-card-kicker')?.textContent || 'Model';
  const insight = card.dataset.insight || '';
  const timestamp = card.querySelector('.model-timestamp-badge');
  const runButton = getModelCardRunButton(card);
  const propsExtra = document.getElementById('model-focus-props-extra');

  const focusIcon = document.getElementById('model-focus-icon');
  const focusTitle = document.getElementById('model-focus-title');
  const focusDesc = document.getElementById('model-focus-desc');
  const focusCategory = document.getElementById('model-focus-category');
  const focusInsight = document.getElementById('model-focus-insight');
  const focusTimestamp = document.getElementById('model-focus-timestamp');

  if (focusIcon) focusIcon.innerHTML = icon;
  if (focusTitle) focusTitle.textContent = title;
  if (focusDesc) focusDesc.textContent = desc;
  if (focusCategory) focusCategory.textContent = category;
  if (focusInsight) focusInsight.textContent = insight;
  if (focusTimestamp) {
    const tsText = timestamp && timestamp.style.display !== 'none' ? timestamp.textContent : '';
    focusTimestamp.textContent = '';
    if (tsText) {
      const span = document.createElement('span');
      span.className = 'model-timestamp-badge';
      span.textContent = tsText;
      focusTimestamp.appendChild(span);
    }
  }
  if (propsExtra) propsExtra.classList.toggle('active', card.dataset.modelKey === 'nba-props');
  if (focusRun) {
    focusRun.disabled = runButton ? runButton.disabled : false;
    focusRun.textContent = runButton && runButton.textContent ? runButton.textContent : (card.dataset.runLabel || 'RUN MODEL');
  }
  updateStageFreshnessPill(card);
  refreshLabPulseStats();
  syncModelFocusStatus();
}

// Backwards-compat stub: the old orbital wheel layout call no longer
// positions cards, but other code still calls this name.
function layoutModelWheel() {}

function selectModelCard(cardOrId) {
  const card = typeof cardOrId === 'string' ? document.getElementById(cardOrId) : cardOrId;
  if (!card || card.classList.contains('model-hidden')) return;
  selectedModelCardId = card.id;
  refreshModelFocusFromSelected();
}

function afterModelVisibilityChanged() {
  const selected = document.getElementById(selectedModelCardId);
  if (!selected || selected.classList.contains('model-hidden')) {
    const next = getModelWheelCards({ visibleOnly: true })[0];
    if (next) selectedModelCardId = next.id;
  }
  refreshModelFocusFromSelected();
}

export async function runSelectedModel(event) {
  const card = getSelectedModelCard();
  if (!card) return;
  const key = String(card.dataset.modelKey || '').trim();
  const action = String(card.dataset.runAction || 'runModel').trim();
  if (action === 'cannon') {
    const focusRun = document.getElementById('model-focus-run');
    if (focusRun) {
      focusRun.disabled = true;
      focusRun.textContent = 'LOADING...';
    }
    try {
      await modelDeps.loadCannonDailyPicks(event || {});
    } finally {
      refreshModelFocusFromSelected();
    }
    return;
  }
  if (key) await modelDeps.runModel(key, event || {});
}

function observeModelStatusChanges() {
  if (modelStatusObserver) return;
  modelStatusObserver = new MutationObserver(() => syncModelFocusStatus());
  getModelWheelCards().forEach(card => {
    const statusEl = getModelCardStatusElement(card);
    if (statusEl) {
      modelStatusObserver.observe(statusEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }
  });
}

function _modelsTabIsActive() {
  const tab = document.getElementById('tab-models');
  return !!tab && tab.classList.contains('active');
}

function _moveSelectionByOffset(offset) {
  const visible = getModelWheelCards({ visibleOnly: true });
  if (!visible.length) return;
  const current = getSelectedModelCard();
  const idx = current ? visible.indexOf(current) : -1;
  const nextIdx = (idx < 0 ? 0 : (idx + offset + visible.length) % visible.length);
  const next = visible[nextIdx];
  if (next) {
    selectModelCard(next);
    try {
      next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (_e) {
      next.scrollIntoView();
    }
  }
}

function _modelsKeydownHandler(event) {
  if (!_modelsTabIsActive()) return;
  const tag = (event.target && event.target.tagName) || '';
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (event.target && event.target.isContentEditable)) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
    event.preventDefault();
    _moveSelectionByOffset(1);
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
    event.preventDefault();
    _moveSelectionByOffset(-1);
  } else if (event.key === 'Enter') {
    if (event.target && event.target.closest && event.target.closest('.model-card')) return;
    const focusRun = document.getElementById('model-focus-run');
    if (!focusRun || focusRun.disabled) return;
    event.preventDefault();
    runSelectedModel(event);
  } else if (event.key === 'r' || event.key === 'R') {
    if (!suggestedModelCardId) return;
    event.preventDefault();
    selectSuggestedModel();
  }
}

function initModelWheel() {
  if (modelWheelInitialized) return;
  modelWheelInitialized = true;
  const cards = getModelWheelCards();
  cards.forEach(card => {
    card.addEventListener('click', event => {
      if (event.target.closest('.model-card-actions')) return;
      selectModelCard(card);
    });
    card.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      selectModelCard(card);
    });
  });
  observeModelStatusChanges();
  refreshRailGroupCounts();
  afterModelVisibilityChanged();
  document.addEventListener('keydown', _modelsKeydownHandler);
}

function initModelWheelWhenReady() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initModelWheel, { once: true });
  } else {
    initModelWheel();
  }
}

// ── Model Chooser ──
function initModelChooser() {
  if (modelChooserInitialized) return;
  modelChooserInitialized = true;
  const STORAGE_KEY = 'pickledger_visible_models';
  const CATALOG_KEY = 'pickledger_visible_models_catalog';
  // Legacy catalog kept on this list so anything NEW (or anything previously
  // hidden but still active) gets re-added to the visible set on next load.
  // Bumping the entries here is how we force MLB First Five and the renamed
  // MLB Model card back into a stale localStorage that hid them.
  const LEGACY_MODEL_IDS = [
    'model-card-mlb-old-stub-removed-2026-05',
  ];
  const ALL_MODELS = [
    { id: 'model-card-mlb-new',          icon: '\u26BE', name: 'MLB Model',                     desc: 'Current MLB moneyline pipeline (2024-25 artifacts)' },
    { id: 'model-card-mlb-inning',       icon: '\u26BE', name: 'MLB Inning',                    desc: 'Least likely run-scoring innings' },
    { id: 'model-card-mlb-first-five',   icon: '\u26BE', name: 'MLB First Five',                desc: 'F5 side and total model' },
    { id: 'model-card-ipl',              icon: '\u{1F3DF}', name: 'IPL Model',                  desc: 'Cached IPL winner + fantasy XI' },
    { id: 'model-card-nba-new',          icon: '\u{1F3C0}', name: 'NBA New',                    desc: 'Refined NBA spread + calibration' },
    { id: 'model-card-nba-playoffs',     icon: '\u{1F3C6}', name: 'NBA Playoffs',               desc: 'Postseason-only verified moneyline model' },
    { id: 'model-card-nba-old',          icon: '\u{1F4DC}', name: 'NBA Model',                  desc: 'Legacy NBA confidence path' },
    { id: 'model-card-nba-props',        icon: '\u{1F3AF}', name: 'NBA Props Model',            desc: 'Player props with Kelly sizing' },
    { id: 'model-card-sportytrader',     icon: '\u{1F3C0}', name: 'SportyTrader Feed',          desc: 'NBA + MLB scraper feed' },
    { id: 'model-card-sportsgambler',    icon: '\u{1F3B1}', name: 'SportsGambler Feed',         desc: 'NBA + MLB scraper feed' },
    { id: 'model-card-cannon-analytics', icon: '\u{1F4E1}', name: 'Cannon Analytics',           desc: 'MLB daily projections + EV picks' },
    { id: 'model-card-wnba',             icon: '\u{1F3C0}', name: 'WNBA Model',                 desc: 'Live WNBA picks and off-season placeholder support' },
  ];

  // Default: show all
  function getVisible() {
    const allIds = ALL_MODELS.map(m => m.id);
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (Array.isArray(stored)) {
        const visible = new Set(stored.filter(id => allIds.includes(id)));
        let known = JSON.parse(localStorage.getItem(CATALOG_KEY));
        if (!Array.isArray(known)) known = LEGACY_MODEL_IDS;
        const knownSet = new Set(known);
        let changed = false;
        allIds.forEach(function(id) {
          if (!knownSet.has(id)) {
            visible.add(id);
            changed = true;
          }
        });
        if (changed) saveVisible(visible);
        localStorage.setItem(CATALOG_KEY, JSON.stringify(allIds));
        return visible;
      }
    } catch {}
    localStorage.setItem(CATALOG_KEY, JSON.stringify(allIds));
    return new Set(allIds);
  }

  function saveVisible(set) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  }

  function applyVisibility(visibleSet) {
    ALL_MODELS.forEach(function(m) {
      const card = document.getElementById(m.id);
      if (!card) return;
      if (visibleSet.has(m.id)) {
        card.classList.remove('model-hidden');
      } else {
        card.classList.add('model-hidden');
      }
    });
    const countEl = document.getElementById('model-chooser-count');
    if (countEl) countEl.textContent = visibleSet.size;
    if (typeof afterModelVisibilityChanged === 'function') afterModelVisibilityChanged();
  }

  function buildDropdown(visibleSet) {
    const dd = document.getElementById('model-chooser-dropdown');
    if (!dd) return;
    dd.innerHTML = '<div class="model-chooser-section-label">AVAILABLE MODELS</div>' +
      ALL_MODELS.map(function(m) {
        const sel = visibleSet.has(m.id) ? ' selected' : '';
        return '<div class="model-chooser-item' + sel + '" data-model-id="' + m.id + '">' +
          '<span class="model-chooser-item-icon">' + m.icon + '</span>' +
          '<div class="model-chooser-item-info">' +
            '<div class="model-chooser-item-name">' + m.name + '</div>' +
            '<div class="model-chooser-item-desc">' + m.desc + '</div>' +
          '</div>' +
          '<div class="model-chooser-cb"><span class="model-chooser-cb-check">\u2713</span></div>' +
        '</div>';
      }).join('');
  }

  // Init
  var visible = getVisible();
  applyVisibility(visible);
  buildDropdown(visible);

  // Toggle dropdown open/close
  var trigger = document.getElementById('model-chooser-trigger');
  var wrap = document.getElementById('model-chooser-wrap');
  var dd = document.getElementById('model-chooser-dropdown');

  if (trigger && dd) {
    trigger.addEventListener('click', function(e) {
      e.stopPropagation();
      dd.classList.toggle('open');
      trigger.classList.toggle('open');
    });

    // Click item to toggle
    dd.addEventListener('click', function(e) {
      e.stopPropagation();
      var item = e.target.closest('.model-chooser-item');
      if (!item) return;
      var id = item.getAttribute('data-model-id');
      if (!id) return;
      if (visible.has(id)) {
        visible.delete(id);
        item.classList.remove('selected');
      } else {
        visible.add(id);
        item.classList.add('selected');
      }
      saveVisible(visible);
      applyVisibility(visible);
    });

    // Close on outside click
    document.addEventListener('click', function(e) {
      if (wrap && !wrap.contains(e.target)) {
        dd.classList.remove('open');
        trigger.classList.remove('open');
      }
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        dd.classList.remove('open');
        trigger.classList.remove('open');
      }
    });
  }
}

export function initModelsUI(deps: ModelsUIDeps): void {
  modelDeps = deps;
  Object.assign(window, {
    runModel: deps.runModel,
    loadCannonDailyPicks: deps.loadCannonDailyPicks,
    loadNbaPropsGames: deps.loadNbaPropsGames,
    runSelectedModel,
    selectSuggestedModel,
    toggleAllModelPicks: deps.toggleAllModelPicks,
    updateModelSelectAll: deps.updateModelSelectAll,
    addSelectedPicksToLedger: deps.addSelectedPicksToLedger,
    addModelPicksToLedger: deps.addModelPicksToLedger,
  });
  initModelWheelWhenReady();
  initModelChooser();
}
