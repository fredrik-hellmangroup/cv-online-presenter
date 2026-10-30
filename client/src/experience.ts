export interface ExperienceEngine {
  readonly id: string;
  start(): void;
}

// Optional browser effects must never prevent the other engines from starting.
export const startExperience = (engines: readonly ExperienceEngine[]): void => {
  for (const engine of engines) {
    try {
      engine.start();
    } catch (error) {
      console.warn(`Experience engine ${engine.id} failed`, error);
    }
  }
};
