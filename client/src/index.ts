import { CvSearchEngine } from './cv-search-engine.js';
import { CvTocEngine } from './cv-toc-engine.js';
import { EasterEggEngine } from './easter-egg-engine.js';
import { startExperience } from './experience.js';
import { ParticleEngine } from './particle-engine.js';
import { ThemeEngine } from './theme-engine.js';

startExperience([
  new ParticleEngine(),
  new ThemeEngine(),
  new EasterEggEngine(),
  new CvTocEngine(),
  new CvSearchEngine()
]);
