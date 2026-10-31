import type { SkillNode } from './skills.js';

export interface Area {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Placement {
  x: number;
  y: number;
  /** Half of the label width including padding. */
  half: number;
}

// Labels are drawn centred above a node, and nodes drift a little around their home position.
export const LABEL_HEIGHT = 26;
export const LABEL_PADDING = 10;
export const WOBBLE = 9;

const TAU = Math.PI * 2;

export const clampRange = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), Math.max(low, high));

/**
 * Places every node on a ring around its group, with the groups spread around the centre of the area.
 * Positions are clamped so that the node, its label and its drift stay inside the area.
 */
export const placeNodes = (
  nodes: readonly SkillNode[],
  groupSizes: readonly number[],
  area: Area,
  labelWidth: (name: string) => number
): Placement[] => {
  const areaWidth = area.right - area.left;
  const areaHeight = area.bottom - area.top;
  const centreX = area.left + areaWidth / 2;
  const centreY = area.top + areaHeight / 2;
  const radius = Math.min(areaWidth, areaHeight) * (nodes.length > 24 ? 0.17 : 0.21);
  const spreadX = Math.max(0, areaWidth / 2 - radius - LABEL_PADDING);
  const spreadY = Math.max(0, areaHeight / 2 - radius - LABEL_PADDING);
  const seen = new Array<number>(groupSizes.length).fill(0);

  return nodes.map(node => {
    const index = seen[node.group]++;
    const groupAngle = (node.group / groupSizes.length) * TAU - Math.PI / 2;
    const angle = (index / groupSizes[node.group]) * TAU + node.group;
    const half = labelWidth(node.name) / 2 + LABEL_PADDING;
    return {
      x: clampRange(
        centreX + Math.cos(groupAngle) * spreadX + Math.cos(angle) * radius,
        area.left + half + WOBBLE, area.right - half - WOBBLE),
      y: clampRange(
        centreY + Math.sin(groupAngle) * spreadY + Math.sin(angle) * radius,
        area.top + LABEL_HEIGHT + WOBBLE, area.bottom - WOBBLE),
      half
    };
  });
};
