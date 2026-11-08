export const CV_QUERY_EVENT = 'cv:query';
export const SKILL_PIN_EVENT = 'skill:pin';

export interface SkillPin {
  readonly kind: 'skill' | 'group';
  readonly name: string;
  readonly keywords: readonly string[];
}

export interface SkillPinDetail {
  readonly pin: SkillPin | null;
}

export type SkillPinEvent = CustomEvent<SkillPinDetail>;

export const createSkillPinEvent = (pin: SkillPin | null): SkillPinEvent =>
  new CustomEvent<SkillPinDetail>(SKILL_PIN_EVENT, { detail: { pin } });
