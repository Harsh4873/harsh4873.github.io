type Theme = 'light' | 'dark';

const root = document.documentElement;
const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
const themeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-theme-option]'));
const systemTheme = window.matchMedia('(prefers-color-scheme: light)');

function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem('harsh-theme');
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function applyTheme(theme: Theme, persist = false): void {
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  themeMeta?.setAttribute('content', theme === 'light' ? '#f7f7f5' : '#151515');

  themeButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.themeOption === theme));
  });

  if (persist) {
    try {
      window.localStorage.setItem('harsh-theme', theme);
    } catch {
      // The selected theme still applies for this visit when storage is unavailable.
    }
  }
}

const initialTheme = root.dataset.theme === 'light' || root.dataset.theme === 'dark'
  ? root.dataset.theme
  : storedTheme() ?? (systemTheme.matches ? 'light' : 'dark');

applyTheme(initialTheme);

themeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const requestedTheme = button.dataset.themeOption;
    if (requestedTheme === 'light' || requestedTheme === 'dark') {
      applyTheme(requestedTheme, true);
    }
  });
});

systemTheme.addEventListener('change', (event) => {
  if (!storedTheme()) {
    applyTheme(event.matches ? 'light' : 'dark');
  }
});

const year = document.querySelector<HTMLElement>('#current-year');
if (year) {
  year.textContent = String(new Date().getFullYear());
}

const sectionLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('[data-section-link]'));
const trackedSections = sectionLinks
  .map((link) => document.getElementById(link.dataset.sectionLink ?? ''))
  .filter((section): section is HTMLElement => Boolean(section));

function markCurrentSection(sectionId: string): void {
  sectionLinks.forEach((link) => {
    if (link.dataset.sectionLink === sectionId) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

if ('IntersectionObserver' in window && trackedSections.length > 0) {
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      if (visible?.target.id) {
        markCurrentSection(visible.target.id);
      }
    },
    { rootMargin: '-20% 0px -60%', threshold: [0, 0.2, 0.6] },
  );

  trackedSections.forEach((section) => observer.observe(section));
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;

  const rail = document.querySelector<HTMLElement>('.identity-rail');
  const activeElement = document.activeElement;
  if (rail && activeElement instanceof HTMLElement && rail.contains(activeElement)) {
    activeElement.blur();
  }
});

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
root.dataset.motion = reducedMotion.matches ? 'reduced' : 'full';
