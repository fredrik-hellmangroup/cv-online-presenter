import type { ExperienceEngine } from './experience.js';

const GLOW_TARGETS = '.assignment, .cv-figures > div, .skill-group';

/** Moves a soft highlight with the pointer across cards (CSS reads --mx and --my). */
export class CardGlowEngine implements ExperienceEngine {
  readonly id = 'card-glow';

  start(): void {
    if (!window.matchMedia('(hover: hover)').matches) return;
    document.addEventListener('pointermove', event => {
      if (!(event.target instanceof Element)) return;
      const card = event.target.closest<HTMLElement>(GLOW_TARGETS);
      if (!card) return;
      const box = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${event.clientX - box.left}px`);
      card.style.setProperty('--my', `${event.clientY - box.top}px`);
    }, { passive: true });
  }
}
