export type Rgb = readonly [number, number, number];

export interface SkyPalette {
  readonly curtain: Rgb;
  readonly glow: Rgb;
}

// Hour of day, aurora curtain colour, background glow colour (0–1 per channel).
const keyframes: readonly (readonly [number, Rgb, Rgb])[] = [
  [0, [0.15, 0.85, 0.65], [0.45, 0.25, 0.95]],
  [5, [0.2, 0.8, 0.7], [0.55, 0.3, 0.9]],
  [7, [1, 0.55, 0.3], [0.9, 0.3, 0.55]],
  [12, [0.2, 0.75, 0.95], [0.3, 0.5, 1]],
  [17, [1, 0.6, 0.25], [0.85, 0.25, 0.5]],
  [20, [0.4, 0.35, 0.95], [0.9, 0.3, 0.6]],
  [24, [0.15, 0.85, 0.65], [0.45, 0.25, 0.95]]
];

const mix = (from: Rgb, to: Rgb, amount: number): Rgb =>
  [0, 1, 2].map(channel => from[channel] + (to[channel] - from[channel]) * amount) as unknown as Rgb;

export const hoursOf = (date: Date): number => date.getHours() + date.getMinutes() / 60;

/** The sky changes colour through the day: green and violet at night, warm at dawn and dusk. */
export const skyPalette = (hours: number): SkyPalette => {
  const hour = ((hours % 24) + 24) % 24;
  for (let index = 0; index + 1 < keyframes.length; index++) {
    const [startHour, startCurtain, startGlow] = keyframes[index];
    const [endHour, endCurtain, endGlow] = keyframes[index + 1];
    if (hour >= startHour && hour <= endHour) {
      const amount = (hour - startHour) / (endHour - startHour);
      return { curtain: mix(startCurtain, endCurtain, amount), glow: mix(startGlow, endGlow, amount) };
    }
  }
  return { curtain: keyframes[0][1], glow: keyframes[0][2] };
};

export const toCss = (colour: Rgb): string => colour.map(value => Math.round(value * 255)).join(', ');
