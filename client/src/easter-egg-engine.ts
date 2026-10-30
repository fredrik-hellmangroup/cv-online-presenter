import type { ExperienceEngine } from './experience.js';
import { easterEggManifest } from './experience-manifest.js';

export class EasterEggEngine implements ExperienceEngine {
  readonly id = 'easter-egg';

  start(): void {
    const toggle = document.querySelector<HTMLButtonElement>(easterEggManifest.trigger);
    const content = document.querySelector<HTMLElement>(easterEggManifest.content);
    if (!toggle || !content) return;

    toggle.hidden = false;
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(expanded));
      content.hidden = !expanded;
    });
  }
}
