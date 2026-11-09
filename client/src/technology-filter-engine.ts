import { matchesSkill, parseConstellationData } from './skills.js';
import { createSkillPinEvent, SKILL_PIN_EVENT, type SkillPin, type SkillPinEvent } from './events.js';
import type { ExperienceEngine } from './experience.js';

export interface TechnologyFilterResult {
  readonly matches: readonly boolean[];
  readonly visibleCount: number;
  readonly totalCount: number;
  readonly countLabel: string;
  readonly isEmpty: boolean;
}

export const filterTechnologies = (skills: readonly string[], query: string): TechnologyFilterResult => {
  const normalizedQuery = query.trim().toLowerCase();
  const matches = skills.map(skill => !normalizedQuery || skill.toLowerCase().includes(normalizedQuery));
  const visibleCount = matches.filter(Boolean).length;
  return {
    matches,
    visibleCount,
    totalCount: skills.length,
    countLabel: normalizedQuery ? `${visibleCount} av ${skills.length}` : `${skills.length} tekniker`,
    isEmpty: visibleCount === 0
  };
};

export const togglePin = (current: SkillPin | null, next: SkillPin): SkillPin | null =>
  current?.kind === next.kind && current.name === next.name ? null : next;

export const escapePin = (current: SkillPin | null, key: string, searchIsOpen: boolean): SkillPin | null =>
  key === 'Escape' && !searchIsOpen ? null : current;

export const countSkillAssignments = (
  skill: string,
  assignments: readonly { readonly keywords: readonly string[] }[]
): number => assignments.filter(assignment => assignment.keywords.some(keyword => matchesSkill(skill, keyword))).length;

export const pinStatusText = (
  pin: SkillPin | null,
  assignments: readonly { readonly keywords: readonly string[] }[]
): string => {
  if (!pin) return '';
  if (pin.kind === 'group') {
    const count = pin.keywords.length === 1 ? '1 teknik' : `${pin.keywords.length} tekniker`;
    return `Markerat omr\u00e5de: ${pin.name} \u00b7 ${count}: ${pin.keywords.join(', ')}`;
  }
  return `Markerad: ${pin.name} \u00b7 anv\u00e4nds i ${countSkillAssignments(pin.name, assignments)} av ${assignments.length} uppdrag`;
};

/** Enhances the service-page technology list and keeps button, status, and constellation state in sync. */
export class TechnologyFilterEngine implements ExperienceEngine {
  readonly id = 'technology-filter';

  start(): void {
    const filter = document.querySelector<HTMLInputElement>('[data-tech-filter]');
    if (filter) {
      const items = [...document.querySelectorAll<HTMLElement>('[data-tech-item]')];
      const groups = [...document.querySelectorAll<HTMLElement>('.skill-group')];
      const count = document.querySelector<HTMLElement>('[data-tech-count]');
      const empty = document.querySelector<HTMLElement>('[data-tech-empty]');
      const skills = items.map(item => item.querySelector<HTMLElement>('[data-skill]')?.dataset.skill ?? item.textContent?.trim() ?? '');
      const applyFilter = () => {
        const result = filterTechnologies(skills, filter.value);
        items.forEach((item, index) => { item.hidden = !result.matches[index]; });
        groups.forEach(group => { group.hidden = !group.querySelector('[data-tech-item]:not([hidden])'); });
        if (count) count.textContent = result.countLabel;
        if (empty) empty.hidden = !result.isEmpty;
      };
      filter.addEventListener('input', applyFilter);
      applyFilter();
    }

    const assignments = parseConstellationData(
      document.querySelector<HTMLElement>('#constellation-data')?.dataset.json
    )?.assignments ?? [];
    const status = document.querySelector<HTMLElement>('[data-pin-status]');
    let pinned: SkillPin | null = null;
    const syncPressed = () => {
      document.querySelectorAll<HTMLButtonElement>('button[data-skill], button[data-group]').forEach(button => {
        const isPinned = pinned?.kind === 'skill'
          ? button.dataset.skill === pinned.name
          : pinned?.kind === 'group' && button.dataset.group === pinned.name;
        button.setAttribute('aria-pressed', String(isPinned));
      });
    };

    document.addEventListener('click', event => {
      const button = event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>('button[data-skill], button[data-group]')
        : null;
      if (!button) return;

      const skill = button.dataset.skill;
      const group = button.dataset.group;
      let next: SkillPin;
      if (skill) {
        next = { kind: 'skill', name: skill, keywords: [skill] };
      } else if (group) {
        const keywords = button.closest<HTMLElement>('.skill-group')?.dataset.keywords?.split('|').filter(Boolean) ?? [];
        next = { kind: 'group', name: group, keywords };
      } else {
        return;
      }

      pinned = togglePin(pinned, next);
      syncPressed();
      document.dispatchEvent(createSkillPinEvent(pinned));
    });

    document.addEventListener('keydown', event => {
      const searchIsOpen = document.querySelector<HTMLElement>('#cv-search-panel')?.hidden === false;
      const next = escapePin(pinned, event.key, searchIsOpen);
      if (next === pinned) return;
      pinned = next;
      syncPressed();
      document.dispatchEvent(createSkillPinEvent(pinned));
    });

    document.addEventListener(SKILL_PIN_EVENT, event => {
      const pin = (event as SkillPinEvent).detail.pin;
      if (!status) return;
      status.textContent = pinStatusText(pin, assignments);
    });
  }
}
