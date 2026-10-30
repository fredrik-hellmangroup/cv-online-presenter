export type Theme = 'light' | 'dark';

export const resolveTheme = (savedTheme: string | null, prefersDark: boolean): Theme =>
  savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : prefersDark ? 'dark' : 'light';

export const nextTheme = (currentTheme: Theme): Theme => currentTheme === 'dark' ? 'light' : 'dark';
