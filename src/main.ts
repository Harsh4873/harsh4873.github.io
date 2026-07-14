const year = document.querySelector<HTMLElement>('#current-year');

if (year) {
  year.textContent = String(new Date().getFullYear());
}

let scrollTicking = false;

function updateScrollProgress() {
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  const percentage = scrollable > 0 ? Math.min(100, Math.max(0, (window.scrollY / scrollable) * 100)) : 0;
  document.documentElement.style.setProperty('--scroll-progress', `${percentage}%`);
  scrollTicking = false;
}

function requestScrollUpdate() {
  if (scrollTicking) return;
  scrollTicking = true;
  window.requestAnimationFrame(updateScrollProgress);
}

updateScrollProgress();
window.addEventListener('scroll', requestScrollUpdate, { passive: true });
window.addEventListener('resize', requestScrollUpdate);

const filterPanel = document.querySelector<HTMLElement>('[data-project-filters]');
const filterButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-filter]')];
const projectCards = [...document.querySelectorAll<HTMLElement>('.project-card')];
const filterCount = document.querySelector<HTMLElement>('[data-filter-count]');

if (filterPanel && filterButtons.length > 0) {
  filterPanel.hidden = false;

  filterButtons.forEach(button => {
    button.addEventListener('click', () => {
      const selected = button.dataset.filter ?? 'all';
      let visibleCount = 0;

      filterButtons.forEach(candidate => {
        candidate.setAttribute('aria-pressed', String(candidate === button));
      });

      projectCards.forEach(card => {
        const lenses = (card.dataset.lens ?? '').split(/\s+/);
        const matches = selected === 'all' || lenses.includes(selected);
        card.hidden = !matches;
        card.classList.toggle('is-filtered-in', matches);
        if (matches) visibleCount += 1;
      });

      if (filterCount) filterCount.textContent = String(visibleCount);
      requestScrollUpdate();
    });
  });
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const revealTargets = [
  ...document.querySelectorAll<HTMLElement>(
    '.profile, .section-heading, .project-card, .curiosity-grid article, .trajectory-list article',
  ),
];

if (reducedMotion || !('IntersectionObserver' in window)) {
  revealTargets.forEach(target => target.classList.add('is-visible'));
} else {
  document.documentElement.classList.add('has-reveal-motion');

  const revealObserver = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      });
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.1 },
  );

  revealTargets.forEach(target => revealObserver.observe(target));
}

const sectionLinks = [...document.querySelectorAll<HTMLAnchorElement>('.site-nav a[href^="#"]')];
const sections = [...document.querySelectorAll<HTMLElement>('.site-section[id]')];

if ('IntersectionObserver' in window && sectionLinks.length > 0) {
  const sectionObserver = new IntersectionObserver(
    entries => {
      const active = entries
        .filter(entry => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];

      if (!active) return;
      const activeId = `#${active.target.id}`;
      sectionLinks.forEach(link => {
        if (link.getAttribute('href') === activeId && activeId !== '#top') {
          link.dataset.active = '';
        } else {
          delete link.dataset.active;
        }
      });
    },
    { rootMargin: '-25% 0px -58% 0px', threshold: [0, 0.2, 0.5] },
  );

  sections.forEach(section => sectionObserver.observe(section));
}

if (!reducedMotion && window.matchMedia('(pointer: fine)').matches) {
  projectCards.forEach(card => {
    let pointerFrame: number | undefined;
    let pointerX = 0;
    let pointerY = 0;

    card.addEventListener('pointermove', event => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (pointerFrame !== undefined) return;

      pointerFrame = window.requestAnimationFrame(() => {
        const bounds = card.getBoundingClientRect();
        card.style.setProperty('--spot-x', `${pointerX - bounds.left}px`);
        card.style.setProperty('--spot-y', `${pointerY - bounds.top}px`);
        pointerFrame = undefined;
      });
    });

    card.addEventListener('pointerleave', () => {
      if (pointerFrame !== undefined) window.cancelAnimationFrame(pointerFrame);
      pointerFrame = undefined;
      card.style.removeProperty('--spot-x');
      card.style.removeProperty('--spot-y');
    });
  });
}
