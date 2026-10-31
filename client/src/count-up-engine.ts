import type { ExperienceEngine } from './experience.js';

const DURATION_MS = 1100;

const easeOutCubic = (amount: number): number => 1 - (1 - amount) ** 3;

/** Counts the hero figures up from zero when they scroll into view. The final value is already in the HTML. */
export class CountUpEngine implements ExperienceEngine {
  readonly id = 'count-up';

  start(): void {
    const figures = Array.from(document.querySelectorAll<HTMLElement>('[data-count]'));
    if (figures.length === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const run = (element: HTMLElement) => {
      const target = Number(element.dataset.count);
      const suffix = element.dataset.suffix ?? '';
      if (!Number.isFinite(target)) return;
      const startedAt = performance.now();
      const tick = (now: number) => {
        const amount = Math.min((now - startedAt) / DURATION_MS, 1);
        element.textContent = `${Math.round(target * easeOutCubic(amount))}${suffix}`;
        if (amount < 1) requestAnimationFrame(tick);
      };
      element.textContent = `0${suffix}`;
      requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        run(entry.target as HTMLElement);
      }
    }, { threshold: 0.6 });
    figures.forEach(figure => observer.observe(figure));
  }
}
