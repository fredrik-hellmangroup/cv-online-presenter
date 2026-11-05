import type { ExperienceEngine } from './experience.js';

/** Shows the print button of the CV and makes sure count-up figures show their final values on paper. */
export class PrintEngine implements ExperienceEngine {
  readonly id = 'print';

  start(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-print]').forEach(button => {
      button.hidden = false;
      button.addEventListener('click', () => window.print());
    });

    window.addEventListener('beforeprint', () => {
      document.querySelectorAll<HTMLElement>('dd[data-count]').forEach(figure => {
        figure.textContent = `${figure.dataset.count ?? ''}${figure.dataset.suffix ?? ''}`;
      });
    });
  }
}
