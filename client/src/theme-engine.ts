import type { ExperienceEngine } from './experience.js';
import { selectCalendarLayer, themeManifest } from './experience-manifest.js';
import { nextTheme, resolveTheme } from './theme.js';

export class ThemeEngine implements ExperienceEngine {
  readonly id = 'theme';

  start(): void {
    const toggle = document.querySelector<HTMLButtonElement>('#theme-toggle');
    if (!toggle) return;

    const root = document.documentElement;
    let savedTheme: string | null = null;
    try {
      savedTheme = window.localStorage.getItem(themeManifest.storageKey);
    } catch {
      // Storage is optional.
    }
    const applyTheme = (theme: 'light' | 'dark') => {
      root.dataset.theme = theme;
      toggle.setAttribute('aria-pressed', String(theme === 'dark'));
    };

    applyTheme(resolveTheme(savedTheme, true));
    toggle.hidden = false;
    toggle.addEventListener('click', () => {
      const updatedTheme = nextTheme(root.dataset.theme === 'dark' ? 'dark' : 'light');
      applyTheme(updatedTheme);
      try {
        window.localStorage.setItem(themeManifest.storageKey, updatedTheme);
      } catch {
        // The selection still works for this page.
      }
    });

    const layer = selectCalendarLayer(new Date(), themeManifest.layers);
    if (layer) root.dataset.calendarLayer = layer;
  }
}
