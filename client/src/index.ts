import { startCommandPalette } from './command-palette.js';
import { EasterEggEngine } from './easter-egg-engine.js';
import { startExperience } from './experience.js';
import { ThemeEngine } from './theme-engine.js';

startCommandPalette();
startExperience([new ThemeEngine(), new EasterEggEngine()]);
