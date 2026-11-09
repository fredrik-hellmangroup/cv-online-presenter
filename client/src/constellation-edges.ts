import type { Point } from './constellation-layout.js';
import type { SkillEdge, SkillNode } from './skills.js';

export interface RoutedConstellationEdge {
  readonly a: number;
  readonly b: number;
  readonly strong: boolean;
  readonly fallback: boolean;
  readonly anchor: boolean;
}

export const constellationAnchorAlphaFloor = (medianAlpha: number, lightTheme: boolean): number =>
  Math.max(lightTheme ? 0.18 : 0.16, medianAlpha);

export const constellationEdgeStyle = (
  edge: Pick<RoutedConstellationEdge, 'strong' | 'fallback' | 'anchor'>,
  lit: number,
  anchorFloor = 0
): { alpha: number; width: number } => {
  const alpha = edge.strong ? 0.05 + lit * 0.5 : 0.03 + lit * 0.18;
  const highlightedCeiling = 0.55;
  return {
    alpha: edge.anchor ? Math.min(highlightedCeiling, Math.max(alpha, anchorFloor)) : alpha,
    width: edge.strong && lit > 0.6 ? 1.4 : 1
  };
};

/** Routes hidden endpoints through the bubble and gives isolated drawn nodes a visible fallback link. */
export const routeConstellationEdges = (
  edges: readonly SkillEdge[],
  nodes: readonly SkillNode[],
  positions: readonly Point[],
  visibleIndices: ReadonlySet<number>,
  poppedIndices: ReadonlySet<number>,
  bubbleVisible: boolean,
  bubblePosition?: Point,
  anchorCandidates: readonly SkillEdge[] = edges
): RoutedConstellationEdge[] => {
  const drawn = new Set([...visibleIndices, ...poppedIndices]);
  const routed = new Map<string, RoutedConstellationEdge>();
  const degrees = new Map<number, number>();
  const add = (a: number, b: number, strong: boolean, fallback: boolean, anchor = false) => {
    if (a === b || (a < 0 && b < 0)) return;
    const first = Math.min(a, b);
    const second = Math.max(a, b);
    const key = `${first}:${second}`;
    const current = routed.get(key);
    if (!current) {
      degrees.set(first, (degrees.get(first) ?? 0) + 1);
      degrees.set(second, (degrees.get(second) ?? 0) + 1);
    }
    if (!current || (current.fallback && !fallback) || (!current.strong && strong) || (anchor && !current.anchor)) {
      routed.set(key, {
        a: first,
        b: second,
        strong: current?.strong || strong,
        fallback: current ? current.fallback && fallback : fallback,
        anchor: current?.anchor || anchor
      });
    }
  };
  const endpoint = (index: number): number => drawn.has(index) ? index : bubbleVisible ? -1 : -2;

  for (const edge of edges) {
    const a = endpoint(edge.a);
    const b = endpoint(edge.b);
    if (a === -2 || b === -2 || (a < 0 && b < 0)) continue;
    add(a, b, edge.strong, false);
  }

  const degree = (index: number): number => degrees.get(index) ?? 0;
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

  const indexCandidates = (candidates: readonly SkillEdge[]): SkillEdge[][] => {
    const indexed = Array.from({ length: nodes.length }, () => [] as SkillEdge[]);
    for (const candidate of candidates) {
      indexed[candidate.a]?.push(candidate);
      indexed[candidate.b]?.push(candidate);
    }
    return indexed;
  };
  const cooccurrencesByNode = indexCandidates(anchorCandidates);
  const edgesByNode = indexCandidates(edges);
  const strongest = (candidates: readonly SkillEdge[], index: number, drawnPartnersOnly: boolean): SkillEdge | undefined => {
    let best: SkillEdge | undefined;
    let bestWeight = -Infinity;
    let bestDistance = Infinity;
    for (const candidate of candidates) {
      const partner = candidate.a === index ? candidate.b : candidate.a;
      if (drawn.has(partner) !== drawnPartnersOnly) continue;
      const weight = candidate.weight ?? (candidate.strong ? 1 : 0);
      const first = positions[index];
      const second = positions[partner];
      const distance = first && second ? Math.hypot(first.x - second.x, first.y - second.y) : Infinity;
      if (weight > bestWeight || (weight === bestWeight && distance < bestDistance)) {
        best = candidate;
        bestWeight = weight;
        bestDistance = distance;
      }
    }
    return best;
  };

  for (const index of drawn) {
    const cooccurringDrawn = strongest(cooccurrencesByNode[index] ?? [], index, true);
    if (cooccurringDrawn) {
      const partner = cooccurringDrawn.a === index ? cooccurringDrawn.b : cooccurringDrawn.a;
      add(index, partner, cooccurringDrawn.strong, false, true);
      continue;
    }
    const drawnPartner = strongest(edgesByNode[index] ?? [], index, true);
    if (drawnPartner) {
      const partner = drawnPartner.a === index ? drawnPartner.b : drawnPartner.a;
      add(index, partner, drawnPartner.strong, false, true);
      continue;
    }
    const hiddenPartner = strongest(cooccurrencesByNode[index] ?? [], index, false) ?? strongest(edgesByNode[index] ?? [], index, false);
    if (hiddenPartner && bubbleVisible) {
      add(index, -1, hiddenPartner.strong, false, true);
    }
  }

  for (const index of drawn) {
    if (degree(index) > 0) continue;
    const node = nodes[index];
    if (bubbleVisible && (node?.isOther || poppedIndices.has(index))) {
      add(index, -1, false, true, true);
      continue;
    }
    const sameCategory = [...drawn].filter(candidate => candidate !== index && nodes[candidate]?.group === node?.group);
    const peer = nearest(index, sameCategory.length > 0 ? sameCategory : [...drawn]);
    if (peer !== undefined) add(index, peer, false, true, true);
    else if (bubbleVisible) add(index, -1, false, true, true);
  }

  if (bubbleVisible && degree(-1) === 0) {
    const peer = nearest(-1, [...drawn]);
    if (peer !== undefined) add(-1, peer, false, true);
  }

  return [...routed.values()];
};
