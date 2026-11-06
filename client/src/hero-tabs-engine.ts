import type { ExperienceEngine } from './experience.js';

/** Index of the tab that arrow, Home and End keys move to, or null for any other key. */
export const nextTabIndex = (current: number, count: number, key: string): number | null => {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight': return (current + 1) % count;
    case 'ArrowLeft': return (current - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
};

/** Turns the stacked groups of the services panel into tabs; without scripts the groups simply stay stacked. */
export class HeroTabsEngine implements ExperienceEngine {
  readonly id = 'hero-tabs';

  start(): void {
    document.querySelectorAll<HTMLElement>('[data-hero-tabs]').forEach(container => this.enhance(container));
  }

  private enhance(container: HTMLElement): void {
    const panels = [...container.querySelectorAll<HTMLElement>('[data-hero-tab-panel]')];
    if (panels.length < 2) return;

    const tablist = document.createElement('div');
    tablist.className = 'hero-tablist';
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', 'Kompetens');

    const tabs = panels.map((panel, index) => {
      const label = panel.querySelector<HTMLElement>('[data-hero-tab-label]')?.textContent?.trim() ?? `Del ${index + 1}`;
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'hero-tab';
      tab.id = `hero-tab-${index}`;
      tab.textContent = label;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', `hero-panel-${index}`);
      panel.id = `hero-panel-${index}`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      panel.tabIndex = 0;
      return tab;
    });

    const select = (selected: number, focus: boolean): void => {
      tabs.forEach((tab, index) => {
        const active = index === selected;
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
        panels[index].hidden = !active;
      });
      if (focus) tabs[selected].focus();
    };

    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => select(index, false));
      tab.addEventListener('keydown', event => {
        const next = nextTabIndex(index, tabs.length, event.key);
        if (next === null) return;
        event.preventDefault();
        select(next, true);
      });
    });

    tablist.append(...tabs);
    container.prepend(tablist);
    container.dataset.enhanced = '';
    select(0, false);
  }
}
