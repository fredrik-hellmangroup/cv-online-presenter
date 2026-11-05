import { parseConstellationData } from './skills.js';
import { createSkillPinEvent, SKILL_PIN_EVENT, type SkillPinEvent } from './events.js';
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

export const togglePinnedSkill = (current: string | null, skill: string): string | null =>
  current === skill ? null : skill;

export const escapePinnedSkill = (current: string | null, key: string, searchIsOpen: boolean): string | null =>
  key === 'Escape' && !searchIsOpen ? null : current;

export const countSkillAssignments = (
  skill: string,
  assignments: readonly { readonly keywords: readonly string[] }[]
): number => assignments.filter(assignment => assignment.keywords.includes(skill)).length;

export const skillPinStatusText = (
  skill: string | null,
  assignments: readonly { readonly keywords: readonly string[] }[]
): string => skill
  ? `Markerad: ${skill} · används i ${countSkillAssignments(skill, assignments)} av ${assignments.length} uppdrag`
  : 'Ingen teknik markerad';

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
    let pinned: string | null = null;

    document.addEventListener('click', event => {
      const button = event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>('button[data-skill]')
        : null;
      const skill = button?.dataset.skill;
      if (!skill) return;
      pinned = togglePinnedSkill(pinned, skill);
      document.querySelectorAll<HTMLButtonElement>('button[data-skill]').forEach(other => {
        other.setAttribute('aria-pressed', String(pinned === other.dataset.skill));
      });
      document.dispatchEvent(createSkillPinEvent(pinned));
    });

    document.addEventListener('keydown', event => {
      const searchIsOpen = document.querySelector<HTMLElement>('#cv-search-panel')?.hidden === false;
      const next = escapePinnedSkill(pinned, event.key, searchIsOpen);
      if (next === pinned) return;
      pinned = next;
      document.querySelectorAll<HTMLButtonElement>('button[data-skill]').forEach(button => {
        button.setAttribute('aria-pressed', 'false');
      });
      document.dispatchEvent(createSkillPinEvent(null));
    });

    document.addEventListener(SKILL_PIN_EVENT, event => {
      const skill = (event as SkillPinEvent).detail.skill;
      if (!status) return;
      status.textContent = skillPinStatusText(skill, assignments);
    });
  }
}
