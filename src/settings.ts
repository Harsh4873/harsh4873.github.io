const MOBILE_MODE_KEY = 'pickledger_mobile_mode';

export function initTheme(): void {
  if ((localStorage.getItem('pickledger_theme') || 'dark') === 'light') {
    document.body.setAttribute('data-theme', 'light');
    const label = document.getElementById('theme-label');
    if (label) label.textContent = 'LIGHT';
  }
}

export function toggleTheme(): void {
  const label = document.getElementById('theme-label');
  const light = document.body.getAttribute('data-theme') === 'light';
  if (light) {
    document.body.removeAttribute('data-theme');
    localStorage.setItem('pickledger_theme', 'dark');
    if (label) label.textContent = 'DARK';
  } else {
    document.body.setAttribute('data-theme', 'light');
    localStorage.setItem('pickledger_theme', 'light');
    if (label) label.textContent = 'LIGHT';
  }
}

function applyMobileMode(enabled: boolean): void {
  document.body.classList.toggle('mobile-app-mode', enabled);
  const btn = document.getElementById('mobile-mode-toggle');
  const label = document.getElementById('mobile-mode-label');
  if (btn) btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  if (label) label.textContent = enabled ? 'MOBILE' : 'DESK';
}

export function initMobileMode(): void {
  applyMobileMode(localStorage.getItem(MOBILE_MODE_KEY) === 'mobile');
}

export function toggleMobileMode(): void {
  const enabled = !document.body.classList.contains('mobile-app-mode');
  localStorage.setItem(MOBILE_MODE_KEY, enabled ? 'mobile' : 'desktop');
  applyMobileMode(enabled);
}

export function initSettingsUI(): void {
  Object.assign(window, {
    toggleTheme,
    toggleMobileMode,
  });
}
