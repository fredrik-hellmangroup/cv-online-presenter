import type { Area } from './constellation-layout.js';
import { nodesMatching } from './skills.js';
import type { AssignmentKeywords, SkillNode } from './skills.js';

export interface UsableSize {
  readonly width: number;
  readonly height: number;
}

export const usageCounts = (
  nodes: readonly SkillNode[],
  assignments: readonly Pick<AssignmentKeywords, 'keywords'>[]
): number[] => {
  const counts = nodes.map(() => 0);
  for (const assignment of assignments) {
    for (const index of nodesMatching(nodes, assignment.keywords)) counts[index]++;
  }
  return counts;
};

/** Estimate a legible label footprint, with a small minimum even on phone-sized screens. */
export const visibleBudget = (
  size: UsableSize,
  nodeCount: number,
  labelWidth = 130,
  labelHeight = 30
): number => {
  if (nodeCount <= 0) return 0;
  const footprint = Math.max(1, labelWidth * labelHeight * 2.5);
  const estimate = Math.floor(Math.max(0, size.width) * Math.max(0, size.height) / footprint);
  return Math.min(nodeCount, Math.max(Math.min(6, nodeCount), estimate));
};

export const selectVisible = (nodes: readonly SkillNode[], usage: readonly number[], budget: number): number[] => {
  const limit = Math.min(nodes.length, Math.max(0, Math.floor(budget)));
  if (limit === 0) return [];
  const ranked = nodes.map((_, index) => index).sort((a, b) => (usage[b] ?? 0) - (usage[a] ?? 0) || a - b);
  const categories = new Map<number, number>();
  nodes.forEach((node, index) => {
    if (node.isOther) return;
    const current = categories.get(node.group);
    if (current === undefined || (usage[index] ?? 0) > (usage[current] ?? 0)) categories.set(node.group, index);
  });

  const selected: number[] = [];
  if (categories.size <= limit / 2) {
    selected.push(...[...categories.values()].sort((a, b) => (usage[b] ?? 0) - (usage[a] ?? 0) || a - b));
  }
  const selectedSet = new Set(selected);
  for (const index of ranked) {
    if (selected.length >= limit) break;
    if (!selectedSet.has(index)) {
      selected.push(index);
      selectedSet.add(index);
    }
  }
  return selected;
};

export const poppedOut = (
  hiddenSortedByUsage: readonly number[],
  focusSet: ReadonlySet<number>,
  limit: number
): { readonly shown: number[]; readonly remaining: number } => {
  const matches = hiddenSortedByUsage.filter(index => focusSet.has(index));
  const shown = matches.slice(0, Math.max(0, Math.floor(limit)));
  return { shown, remaining: matches.length - shown.length };
};

export const easeOutCubic = (progress: number): number => {
  const t = Math.min(1, Math.max(0, progress));
  return 1 - (1 - t) ** 3;
};

export const introProgress = (time: number, start: number, duration: number, stagger = 0): number =>
  easeOutCubic((time - start - stagger) / Math.max(1, duration));

export const introPosition = <T extends { readonly x: number; readonly y: number }>(
  home: T,
  origin: T,
  progress: number
): { x: number; y: number } => ({
  x: origin.x + (home.x - origin.x) * progress,
  y: origin.y + (home.y - origin.y) * progress
});

export const clusterAreas = (area: Area, count: number): Area[] => {
  const total = Math.max(0, Math.floor(count));
  if (total === 0) return [];
  const width = Math.max(1, area.right - area.left);
  const height = Math.max(1, area.bottom - area.top);
  const columns = Math.ceil(Math.sqrt(total * width / height));
  const rows = Math.ceil(total / columns);
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  return Array.from({ length: total }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const insetX = Math.min(20, cellWidth * 0.08);
    const insetY = Math.min(18, cellHeight * 0.08);
    return {
      left: area.left + column * cellWidth + insetX,
      top: area.top + row * cellHeight + insetY,
      right: area.left + (column + 1) * cellWidth - insetX,
      bottom: area.top + (row + 1) * cellHeight - insetY
    };
  });
};
