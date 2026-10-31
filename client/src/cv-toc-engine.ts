import type { ExperienceEngine } from './experience.js';

export class CvTocEngine implements ExperienceEngine {
  readonly id = 'cv-toc';

  start(): void {
    const toc = document.querySelector<HTMLElement>('#cv-toc');
    const list = document.querySelector<HTMLOListElement>('#cv-toc-list');
    const headings = Array.from(document.querySelectorAll<HTMLHeadingElement>('article h2[id]'));
    if (!toc || !list || headings.length < 2) return;

    const links = new Map<string, HTMLAnchorElement>();
    for (const heading of headings) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = `#${heading.id}`;
      link.textContent = heading.textContent;
      item.append(link);
      list.append(item);
      links.set(heading.id, link);
    }
    toc.hidden = false;

    const setActive = (id: string) => {
      for (const [key, link] of links) {
        if (key === id) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      }
    };

    const update = () => {
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      const threshold = window.innerHeight * 0.3;
      let current = headings[0];
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top <= threshold) current = heading;
      }
      setActive(atBottom ? headings[headings.length - 1].id : current.id);
    };

    let pending = false;
    const schedule = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        update();
      });
    };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    update();
  }
}
