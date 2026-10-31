import { CV_QUERY_EVENT } from './events.js';
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
      announce(open ? input.value.trim() : '');
    };
    const announce = (query: string) => document.dispatchEvent(new CustomEvent(CV_QUERY_EVENT, { detail: query }));

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
      announce(query);
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
          link.addEventListener('click', event => goTo(event, match.path));
          const description = document.createElement('span');
          appendHighlighted(description, match.description, query);
          item.append(link, description);
          results.append(item);
        }
      } catch {
        results.replaceChildren();
      }
    });

    // Same-page hits scroll to and flash the matching heading instead of reloading the page.
    const goTo = (event: MouseEvent, path: string) => {
      const url = new URL(path, location.href);
      if (url.pathname !== location.pathname || !url.hash) return;
      const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
      if (!target) return;
      event.preventDefault();
      setOpen(false);
      history.pushState(null, '', url.hash);
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      target.classList.add('cv-search-hit');
      window.setTimeout(() => target.classList.remove('cv-search-hit'), 2500);
    };
  }
}

function appendHighlighted(parent: HTMLElement, text: string, query: string): void {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let position = 0;
  let index = lowerQuery ? lowerText.indexOf(lowerQuery) : -1;
  while (index >= 0) {
    if (index > position) parent.append(text.slice(position, index));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(index, index + query.length);
    parent.append(mark);
    position = index + query.length;
    index = lowerText.indexOf(lowerQuery, position);
  }
  if (position < text.length) parent.append(text.slice(position));
}
