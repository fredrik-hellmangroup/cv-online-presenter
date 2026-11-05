import { CardGlowEngine } from './card-glow-engine.js';
import { ConstellationEngine } from './constellation-engine.js';
import { CountUpEngine } from './count-up-engine.js';
import { CvSearchEngine } from './cv-search-engine.js';
import { CvTocEngine } from './cv-toc-engine.js';
import { EasterEggEngine } from './easter-egg-engine.js';
import { startExperience } from './experience.js';
import { PrintEngine } from './print-engine.js';
import { ThemeEngine } from './theme-engine.js';
import { TechnologyFilterEngine } from './technology-filter-engine.js';

startExperience([
  new ConstellationEngine(),
  new TechnologyFilterEngine(),
  new ThemeEngine(),
  new EasterEggEngine(),
  new CvTocEngine(),
  new CvSearchEngine(),
  new CountUpEngine(),
  new CardGlowEngine(),
  new PrintEngine()
]);
