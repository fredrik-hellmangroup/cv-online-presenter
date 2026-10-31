import type { ExperienceEngine } from './experience.js';

type SearchResult = { path: string; title: string; description: string };

export class CvSearchEngine implements ExperienceEngine {
  readonly id = 'cv-search';

  start(): void {
    const container = document.querySelector<HTMLElement>('#cv-search');
    const toggle = document.querySelector<HTMLButtonElement>('#cv-search-toggle');
    const panel = document.querySelector<HTMLElement>('#cv-search-panel');
    const input = document.querySelector<HTMLInputElement>('#cv-search-input');
    const results = document.querySelector<HTMLUListElement>('#cv-search-results');
    if (!container || !toggle || !panel || !input || !results) return;

    container.hidden = false;
    const isOpen = () => !panel.hidden;
    const setOpen = (open: boolean) => {
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      if (open) input.focus();
      else toggle.focus();
    };

    toggle.addEventListener('click', () => setOpen(!isOpen()));
    document.addEventListener('keydown', event => {
      const target = event.target as HTMLElement | null;
      const inField = target?.matches('input, textarea, select, [contenteditable]') ?? false;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      } else if (event.key === '/' && !inField && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        setOpen(true);
      } else if (event.key === 'Escape' && isOpen() && container.contains(target)) {
        setOpen(false);
      }
    });

    let requestNumber = 0;
    input.addEventListener('input', async () => {
      const currentRequest = ++requestNumber;
      results.replaceChildren();
      const query = input.value.trim();
      if (!query) return;
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (!response.ok || currentRequest !== requestNumber) return;
        const matches = await response.json() as SearchResult[];
        if (currentRequest !== requestNumber) return;
        if (matches.length === 0) {
          const empty = document.createElement('li');
          empty.className = 'cv-search-empty';
          empty.textContent = 'Inga träffar.';
          results.append(empty);
          return;
        }
        for (const match of matches) {
          const item = document.createElement('li');
          const link = document.createElement('a');
          link.href = match.path;
          link.textContent = match.title;
          const description = document.createElement('span');
          description.textContent = match.description;
          item.append(link, description);
          results.append(item);
        }
      } catch {
        results.replaceChildren();
      }
    });
  }
}
