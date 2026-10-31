import { AuroraEngine } from './aurora-engine.js';
import { CardGlowEngine } from './card-glow-engine.js';
import { ConstellationEngine } from './constellation-engine.js';
import { CountUpEngine } from './count-up-engine.js';
import { CvSearchEngine } from './cv-search-engine.js';
import { CvTocEngine } from './cv-toc-engine.js';
import { EasterEggEngine } from './easter-egg-engine.js';
import { startExperience } from './experience.js';
import { ThemeEngine } from './theme-engine.js';

startExperience([
  new AuroraEngine(),
  new ConstellationEngine(),
  new ThemeEngine(),
  new EasterEggEngine(),
  new CvTocEngine(),
  new CvSearchEngine(),
  new CountUpEngine(),
  new CardGlowEngine()
]);
