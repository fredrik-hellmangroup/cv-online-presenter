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
  const footprint = Math.max(1, labelWidth * labelHeight * 7);
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

export const BUBBLE_COLLAPSE_DELAY_MS = 4000;
export const COLLAPSE_STAGGER_MS = 150;

export interface RevealState {
  readonly batches: readonly (readonly number[])[];
  readonly seen: readonly number[];
  readonly held: readonly number[];
}

export const createRevealState = (): RevealState => ({ batches: [], seen: [], held: [] });

export const revealedIndices = (state: RevealState): number[] =>
  [...new Set([...state.batches.flat(), ...state.held])];

export const reconcileRevealState = (state: RevealState, hiddenRanking: readonly number[]): RevealState => {
  const hidden = new Set(hiddenRanking);
  const seen = state.seen.filter(index => hidden.has(index));
  const seenSet = new Set(seen);
  return {
    batches: state.batches.map(batch => batch.filter(index => hidden.has(index) && seenSet.has(index)))
      .filter(batch => batch.length > 0),
    seen,
    held: state.held.filter(index => hidden.has(index))
  };
};

export const revealNextBatch = (
  state: RevealState,
  hiddenRanking: readonly number[],
  batchSize: number,
  maxVisible: number,
  protectedIndices: ReadonlySet<number> = new Set()
): RevealState => {
  const reconciled = reconcileRevealState(state, hiddenRanking);
  const seen = new Set(reconciled.seen);
  const held = new Set(reconciled.held);
  const next = hiddenRanking.filter(index => !seen.has(index) && !held.has(index))
    .slice(0, Math.max(0, Math.floor(batchSize)));
  if (next.length === 0) return reconciled;

  const batches = reconciled.batches.map(batch => [...batch]);
  batches.push(next);
  const capacity = Math.max(next.length, Math.floor(maxVisible));
  const activeCount = () => new Set([...batches.flat(), ...held, ...protectedIndices]).size;
  while (batches.length > 1 && activeCount() > capacity) batches.shift();
  return {
    batches,
    seen: [...seen, ...next],
    held: reconciled.held
  };
};

export const unrevealedCount = (state: RevealState, hiddenRanking: readonly number[]): number => {
  const seen = new Set(state.seen);
  return hiddenRanking.filter(index => !seen.has(index)).length;
};

export const isRevealCycleComplete = (state: RevealState, hiddenRanking: readonly number[]): boolean =>
  hiddenRanking.length > 0 && unrevealedCount(state, hiddenRanking) === 0;

export const collapseRevealOrder = (
  state: RevealState,
  highlightedIndices: ReadonlySet<number>
): number[] => revealedIndices(state).reverse().filter(index => !highlightedIndices.has(index));

export const returnRevealedItem = (state: RevealState, index: number): RevealState => ({
  batches: state.batches.map(batch => batch.filter(item => item !== index)).filter(batch => batch.length > 0),
  seen: state.seen.filter(item => item !== index),
  held: state.held.filter(item => item !== index)
});

export const collapseRevealState = (
  state: RevealState,
  highlightedIndices: ReadonlySet<number>
): RevealState => ({
  batches: [],
  seen: [],
  held: revealedIndices(state).filter(index => highlightedIndices.has(index))
});

export const retainHighlightedReveals = (
  state: RevealState,
  highlightedIndices: ReadonlySet<number>
): RevealState => ({
  ...state,
  held: state.held.filter(index => highlightedIndices.has(index))
});

export const bubbleCollapseDeadline = (now: number): number => now + BUBBLE_COLLAPSE_DELAY_MS;

export const isBubbleCollapseDue = (deadline: number | null, now: number): boolean =>
  deadline !== null && now >= deadline;

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

export const clusterAreas = (area: Area, weightsOrCount: number | readonly number[]): Area[] => {
  const weights = typeof weightsOrCount === 'number'
    ? Array.from({ length: Math.max(0, Math.floor(weightsOrCount)) }, () => 1)
    : [...weightsOrCount].map(weight => Math.max(0, weight));
  if (weights.length === 0) return [];
  const regions = Array.from({ length: weights.length }, () => area);
  const active = weights.map((weight, index) => weight > 0 ? index : -1).filter(index => index >= 0);
  if (active.length === 0) return regions;

  const partition = (indices: readonly number[], bounds: Area): void => {
    if (indices.length === 1) {
      const insetX = Math.min(20, (bounds.right - bounds.left) * 0.08);
      const insetY = Math.min(18, (bounds.bottom - bounds.top) * 0.08);
      regions[indices[0]] = {
        left: bounds.left + insetX,
        top: bounds.top + insetY,
        right: bounds.right - insetX,
        bottom: bounds.bottom - insetY
      };
      return;
    }
    const total = indices.reduce((sum, index) => sum + weights[index], 0);
    let split = 1;
    let subtotal = weights[indices[0]];
    while (split < indices.length - 1 && subtotal < total / 2) subtotal += weights[indices[split++]];
    const ratio = subtotal / total;
    const first = indices.slice(0, split);
    const second = indices.slice(split);
    if (bounds.right - bounds.left >= bounds.bottom - bounds.top) {
      const middle = bounds.left + (bounds.right - bounds.left) * ratio;
      partition(first, { ...bounds, right: middle });
      partition(second, { ...bounds, left: middle });
    } else {
      const middle = bounds.top + (bounds.bottom - bounds.top) * ratio;
      partition(first, { ...bounds, bottom: middle });
      partition(second, { ...bounds, top: middle });
    }
  };

  partition(active, area);
  return regions;
};

export const assignClusterGroups = (
  nodes: readonly SkillNode[],
  visibleIndices: readonly number[],
  groupCount: number
): number[] => {
  const assignments = nodes.map(node => node.group);
  const loads = Array.from({ length: groupCount }, () => 0);
  const candidates = [...new Set(nodes.filter(node => !node.isOther).map(node => node.group))];
  const destinations = candidates.length > 0
    ? candidates
    : [...new Set(nodes.map(node => node.group))];
  for (const index of visibleIndices) {
    if (!nodes[index]?.isOther && nodes[index]?.group >= 0 && nodes[index]?.group < groupCount)
      loads[nodes[index].group]++;
  }
  let cursor = 0;
  for (const index of visibleIndices) {
    if (!nodes[index]?.isOther || destinations.length === 0) continue;
    let chosen = destinations[cursor % destinations.length];
    for (let offset = 1; offset < destinations.length; offset++) {
      const candidate = destinations[(cursor + offset) % destinations.length];
      if ((loads[candidate] ?? 0) < (loads[chosen] ?? 0)) chosen = candidate;
    }
    assignments[index] = chosen;
    loads[chosen]++;
    cursor = (destinations.indexOf(chosen) + 1) % destinations.length;
  }
  return assignments;
};

export const settlePopout = (
  shouldPop: boolean,
  popPoint: { readonly x: number; readonly y: number },
  bubblePoint: { readonly x: number; readonly y: number }
): { readonly x: number; readonly y: number; readonly alpha: number } => ({
  x: shouldPop ? popPoint.x : bubblePoint.x,
  y: shouldPop ? popPoint.y : bubblePoint.y,
  alpha: shouldPop ? 1 : 0
});
