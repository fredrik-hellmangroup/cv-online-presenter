import type { ExperienceEngine } from './experience.js';

const MAX_ROWS = 3;
const CLAMP_TARGETS = '.project-card .tags';

/** Counts the leading items that sit on the first `maxRows` visual rows, given each item's top offset. */
export const visibleItemCount = (tops: readonly number[], maxRows: number): number => {
  let rows = 0;
  let lastTop: number | null = null;
  for (let index = 0; index < tops.length; index++) {
    if (tops[index] !== lastTop) {
      rows++;
      lastTop = tops[index];
    }
    if (rows > maxRows) return index;
  }
  return tops.length;
};

export const moreLabel = (hiddenCount: number): string => `+${hiddenCount}`;

const clamp = (list: HTMLElement): void => {
  list.querySelector('[data-tags-more]')?.remove();
  const items = [...list.querySelectorAll<HTMLElement>(':scope > li')];
  items.forEach(item => { item.hidden = false; });

  let visible = visibleItemCount(items.map(item => Math.round(item.offsetTop)), MAX_ROWS);
  if (visible >= items.length) return;

  const more = document.createElement('li');
  more.dataset.tagsMore = '';
  list.append(more);

  // The "+N" chip must also fit on the last allowed row, so trade visible chips for it until it does.
  const apply = (): number => {
    items.forEach((item, index) => { item.hidden = index >= visible; });
    const hidden = items.slice(visible).map(item => item.textContent?.trim() ?? '');
    more.textContent = moreLabel(hidden.length);
    more.title = hidden.join(', ');
    more.setAttribute('aria-label', `${hidden.length} fler tekniker: ${hidden.join(', ')}`);
    return Math.round(more.offsetTop);
  };
  const firstTop = Math.round(items[0].offsetTop);
  const rowHeight = Math.max(1, Math.round(items[0].offsetHeight));
  const lastRowTop = (): number => {
    const tops = items.slice(0, visible).map(item => Math.round(item.offsetTop));
    return tops.length > 0 ? tops[tops.length - 1] : firstTop;
  };
  while (visible > 1 && apply() > lastRowTop() + rowHeight / 2) visible--;
  apply();
};

/** Limits each project card's technology tags to three rows and shows a "+N" chip when more exist. */
export class TagClampEngine implements ExperienceEngine {
  readonly id = 'tag-clamp';

  start(): void {
    const lists = [...document.querySelectorAll<HTMLElement>(CLAMP_TARGETS)];
    if (lists.length === 0) return;

    let lastWidth = -1;
    const run = (): void => {
      lastWidth = Math.round(lists[0].clientWidth);
      lists.forEach(clamp);
    };
    run();
    document.fonts?.ready.then(run).catch(() => undefined);

    let frame = 0;
    new ResizeObserver(() => {
      if (Math.round(lists[0].clientWidth) === lastWidth) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(run);
    }).observe(lists[0]);
  }
}
