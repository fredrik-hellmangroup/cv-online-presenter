export interface SkillGroup {
  readonly name: string;
  readonly skills: readonly string[];
}

export interface AssignmentKeywords {
  readonly title: string;
  readonly keywords: readonly string[];
}

export interface ConstellationData {
  readonly groups: readonly SkillGroup[];
  readonly assignments: readonly AssignmentKeywords[];
}

export interface SkillNode {
  readonly name: string;
  readonly group: number;
}

export interface SkillEdge {
  readonly a: number;
  readonly b: number;
  readonly strong: boolean;
}

const MAX_STRONG_EDGES = 70;

const tokens = (value: string): string[] =>
  value.toLowerCase().split(/[\s/,()]+/).filter(Boolean);

const containsSequence = (haystack: readonly string[], needle: readonly string[]): boolean => {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    if (needle.every((token, offset) => haystack[start + offset] === token)) return true;
  }
  return false;
};

/** A keyword matches a skill when one is a whole-word run inside the other ("SQL" matches "SQL Server"). */
export const matchesSkill = (skill: string, keyword: string): boolean => {
  const skillTokens = tokens(skill);
  const keywordTokens = tokens(keyword);
  if (skillTokens.length === 0 || keywordTokens.length === 0) return false;
  return containsSequence(skillTokens, keywordTokens) || containsSequence(keywordTokens, skillTokens);
};

export const toNodes = (groups: readonly SkillGroup[]): SkillNode[] =>
  groups.flatMap((group, index) => group.skills.map(name => ({ name, group: index })));

export const nodesMatching = (nodes: readonly SkillNode[], keywords: readonly string[]): Set<number> => {
  const matched = new Set<number>();
  nodes.forEach((node, index) => {
    if (keywords.some(keyword => matchesSkill(node.name, keyword))) matched.add(index);
  });
  return matched;
};

export const nodesMatchingQuery = (nodes: readonly SkillNode[], query: string): Set<number> => {
  const needle = query.trim().toLowerCase();
  const matched = new Set<number>();
  if (!needle) return matched;
  nodes.forEach((node, index) => {
    if (node.name.toLowerCase().includes(needle)) matched.add(index);
  });
  return matched;
};

/**
 * Strong edges join technologies that were used together in at least two assignments.
 * Weak edges chain neighbours inside a group so every node stays connected.
 */
export const buildEdges = (nodes: readonly SkillNode[], assignments: readonly AssignmentKeywords[]): SkillEdge[] => {
  const pairCounts = new Map<string, number>();
  for (const assignment of assignments) {
    const matched = [...nodesMatching(nodes, assignment.keywords)].sort((a, b) => a - b);
    for (let i = 0; i < matched.length; i++) {
      for (let j = i + 1; j < matched.length; j++) {
        const key = `${matched[i]}:${matched[j]}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }

  const strong = [...pairCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_STRONG_EDGES)
    .map(([key]) => {
      const [a, b] = key.split(':').map(Number);
      return { a, b, strong: true } satisfies SkillEdge;
    });

  const seen = new Set(strong.map(edge => `${edge.a}:${edge.b}`));
  const weak: SkillEdge[] = [];
  for (let index = 0; index + 1 < nodes.length; index++) {
    if (nodes[index].group !== nodes[index + 1].group) continue;
    const key = `${index}:${index + 1}`;
    if (!seen.has(key)) weak.push({ a: index, b: index + 1, strong: false });
  }
  return [...strong, ...weak];
};

export const parseConstellationData = (json: string | undefined): ConstellationData | null => {
  if (!json) return null;
  try {
    const value = JSON.parse(json) as Partial<ConstellationData>;
    if (!Array.isArray(value.groups) || value.groups.length === 0) return null;
    return { groups: value.groups, assignments: Array.isArray(value.assignments) ? value.assignments : [] };
  } catch {
    return null;
  }
};
