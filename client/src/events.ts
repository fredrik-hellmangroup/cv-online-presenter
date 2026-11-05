export const CV_QUERY_EVENT = 'cv:query';
export const SKILL_PIN_EVENT = 'skill:pin';

export interface SkillPinDetail {
  readonly skill: string | null;
}

export type SkillPinEvent = CustomEvent<SkillPinDetail>;

export const createSkillPinEvent = (skill: string | null): SkillPinEvent =>
  new CustomEvent<SkillPinDetail>(SKILL_PIN_EVENT, { detail: { skill } });
