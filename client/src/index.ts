const themeToggle = document.querySelector<HTMLButtonElement>('#theme-toggle');
const easterEggToggle = document.querySelector<HTMLButtonElement>('#easter-egg-toggle');
const easterEgg = document.querySelector<HTMLParagraphElement>('#easter-egg');
const root = document.documentElement;
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');

let savedTheme: string | null = null;
try {
  savedTheme = window.localStorage.getItem('theme');
} catch {
  // Storage can be unavailable; the system preference remains the default.
}
let hasExplicitTheme = savedTheme === 'light' || savedTheme === 'dark';

const applyTheme = (theme: 'light' | 'dark') => {
  root.dataset.theme = theme;
  themeToggle?.setAttribute('aria-pressed', String(theme === 'dark'));
};

if (themeToggle) {
  themeToggle.hidden = false;
  applyTheme(savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : systemTheme.matches ? 'dark' : 'light');
  themeToggle.addEventListener('click', () => {
    const nextTheme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
    hasExplicitTheme = true;
    try {
      window.localStorage.setItem('theme', nextTheme);
      savedTheme = nextTheme;
    } catch {
      // Theme still changes for the current page when storage is unavailable.
    }
  });
  systemTheme.addEventListener('change', event => {
    if (!hasExplicitTheme) applyTheme(event.matches ? 'dark' : 'light');
  });
}

if (easterEggToggle && easterEgg) {
  easterEggToggle.hidden = false;
  easterEggToggle.addEventListener('click', () => {
    const expanded = easterEggToggle.getAttribute('aria-expanded') !== 'true';
    easterEggToggle.setAttribute('aria-expanded', String(expanded));
    easterEgg.hidden = !expanded;
  });
}
