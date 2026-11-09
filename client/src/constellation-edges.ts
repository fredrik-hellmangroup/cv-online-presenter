import type { Point } from './constellation-layout.js';
import type { SkillEdge, SkillNode } from './skills.js';

export interface RoutedConstellationEdge {
  readonly a: number;
  readonly b: number;
  readonly strong: boolean;
  readonly fallback: boolean;
}

export const constellationEdgeStyle = (
  edge: Pick<RoutedConstellationEdge, 'strong' | 'fallback'>,
  lit: number
): { alpha: number; width: number } => ({
  alpha: edge.strong ? 0.05 + lit * 0.5 : 0.03 + lit * 0.18,
  width: edge.strong && lit > 0.6 ? 1.4 : 1
});

/** Routes hidden endpoints through the bubble and gives isolated drawn nodes a visible fallback link. */
export const routeConstellationEdges = (
  edges: readonly SkillEdge[],
  nodes: readonly SkillNode[],
  positions: readonly Point[],
  visibleIndices: ReadonlySet<number>,
  poppedIndices: ReadonlySet<number>,
  bubbleVisible: boolean,
  bubblePosition?: Point
): RoutedConstellationEdge[] => {
  const drawn = new Set([...visibleIndices, ...poppedIndices]);
  const routed = new Map<string, RoutedConstellationEdge>();
  const add = (a: number, b: number, strong: boolean, fallback: boolean) => {
    if (a === b || (a < 0 && b < 0)) return;
    const first = Math.min(a, b);
    const second = Math.max(a, b);
    const key = `${first}:${second}`;
    const current = routed.get(key);
    if (!current || (current.fallback && !fallback) || (!current.strong && strong))
      routed.set(key, { a: first, b: second, strong: current?.strong || strong, fallback: current ? current.fallback && fallback : fallback });
  };
  const endpoint = (index: number): number => drawn.has(index) ? index : bubbleVisible ? -1 : -2;

  for (const edge of edges) {
    const a = endpoint(edge.a);
    const b = endpoint(edge.b);
    if (a === -2 || b === -2 || (a < 0 && b < 0)) continue;
    add(a, b, edge.strong, false);
  }

  const degree = (index: number): number => [...routed.values()]
    .filter(edge => edge.a === index || edge.b === index).length;
  const nearest = (index: number, candidates: readonly number[]): number | undefined => {
    let best: number | undefined;
    let distance = Infinity;
    for (const candidate of candidates) {
      if (candidate === index) continue;
      const first = index === -1 ? bubblePosition : positions[index];
      const second = candidate === -1 ? bubblePosition : positions[candidate];
      const next = first && second ? Math.hypot(first.x - second.x, first.y - second.y) : candidate;
      if (next < distance) { best = candidate; distance = next; }
    }
    return best;
  };

  for (const index of drawn) {
    if (degree(index) > 0) continue;
    const node = nodes[index];
    if (bubbleVisible && (node?.isOther || poppedIndices.has(index))) {
      add(index, -1, false, true);
      continue;
    }
    const sameCategory = [...drawn].filter(candidate => candidate !== index && nodes[candidate]?.group === node?.group);
    const peer = nearest(index, sameCategory.length > 0 ? sameCategory : [...drawn]);
    if (peer !== undefined) add(index, peer, false, true);
    else if (bubbleVisible) add(index, -1, false, true);
  }

  if (bubbleVisible && degree(-1) === 0) {
    const peer = nearest(-1, [...drawn]);
    if (peer !== undefined) add(-1, peer, false, true);
  }

  return [...routed.values()];
};
