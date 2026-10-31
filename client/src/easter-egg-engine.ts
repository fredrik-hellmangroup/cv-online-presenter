import { createClickCounter, createSequenceMatcher } from './egg-triggers.js';
import type { ExperienceEngine } from './experience.js';
import { easterEggManifest } from './experience-manifest.js';

export const EGG_REVEAL_EVENT = 'egg:reveal';

export class EasterEggEngine implements ExperienceEngine {
  readonly id = 'easter-egg';

  start(): void {
    const content = document.querySelector<HTMLElement>(easterEggManifest.content);
    if (!content) return;

    const reveal = () => {
      content.hidden = false;
      document.dispatchEvent(new CustomEvent(EGG_REVEAL_EVENT));
    };
    const dismiss = () => { content.hidden = true; };

    const brandMark = document.querySelector<HTMLElement>(easterEggManifest.brandMark);
    if (brandMark) {
      const registerClick = createClickCounter(easterEggManifest.clickCount, easterEggManifest.clickWindowMs);
      brandMark.addEventListener('click', () => {
        if (registerClick(performance.now())) reveal();
      });
    }

    const matchesSequence = createSequenceMatcher(easterEggManifest.keySequence);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        dismiss();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (event.ctrlKey || event.metaKey || event.altKey || target?.matches('input, textarea, select, [contenteditable]')) return;
      if (event.key.length === 1 && matchesSequence(event.key)) reveal();
    });

    document.querySelector<HTMLButtonElement>(easterEggManifest.close)?.addEventListener('click', dismiss);
  }
}
