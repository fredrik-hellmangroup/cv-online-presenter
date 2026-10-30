export type CalendarLayer = 'christmas' | 'new-year';

export interface CalendarRule {
  readonly id: CalendarLayer;
  readonly month: number;
  readonly day: number;
}

export interface ThemeManifest {
  readonly storageKey: string;
  readonly layers: readonly CalendarRule[];
}

export interface EasterEggManifest {
  readonly id: string;
  readonly trigger: string;
  readonly content: string;
}

export const themeManifest: ThemeManifest = {
  storageKey: 'theme',
  layers: [
    { id: 'christmas', month: 12, day: 24 },
    { id: 'christmas', month: 12, day: 25 },
    { id: 'christmas', month: 12, day: 26 },
    { id: 'new-year', month: 12, day: 31 },
    { id: 'new-year', month: 1, day: 1 }
  ]
};

export const easterEggManifest: EasterEggManifest = {
  id: 'permanent-surprise',
  trigger: '#easter-egg-toggle',
  content: '#easter-egg'
};

export const selectCalendarLayer = (date: Date, rules: readonly CalendarRule[]): CalendarLayer | null => {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return rules.find(rule => rule.month === month && rule.day === day)?.id ?? null;
};
