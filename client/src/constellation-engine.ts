import { EGG_REVEAL_EVENT } from './easter-egg-engine.js';
import { CV_QUERY_EVENT, SKILL_PIN_EVENT, type SkillPinEvent } from './events.js';
import type { ExperienceEngine } from './experience.js';
import {
  BUBBLE_DOT_CLEARANCE,
  LABEL_HEIGHT,
  LABEL_PADDING,
  PROBE_OFFSET,
  WOBBLE,
  clampRange,
  effectiveObstacles,
  exitVector,
  labelRectAt,
  labelExitVector,
  orbitCandidateWidths,
  orbitSlots,
  scatterBubblePoint,
  scatterPoint
} from './constellation-layout.js';
import type { Area } from './constellation-layout.js';
import {
  assignClusterGroups,
  bubbleCollapseDeadline,
  BUBBLE_COLLAPSE_DELAY_MS,
  COLLAPSE_STAGGER_MS,
  clusterAreas,
  collapseRevealOrder,
  collapseRevealState,
  createRevealState,
  introPosition,
  introProgress,
  isBubbleCollapseDue,
  isRevealCycleComplete,
  poppedOut,
  reconcileRevealState,
  retainHighlightedReveals,
  revealNextBatch,
  returnRevealedItem,
  revealedIndices,
  selectVisible,
  settlePopout,
  usageCounts,
  visibleBudget
} from './constellation-clusters.js';
import {
  MOTE_LINK_DISTANCE,
  createMotes,
  driftMotes,
  forEachMoteLink,
  moteBrightness,
  moteCount,
  moteRadius,
  repelMotes
} from './constellation-motes.js';
import type { Mote } from './constellation-motes.js';
import {
  buildConstellationGraph,
  nodesMatching,
  nodesMatchingQuery,
  parseConstellationData,
  toNodes
} from './skills.js';
import type { SkillEdge, SkillNode } from './skills.js';
import { constellationAnchorAlphaFloor, constellationEdgeStyle, routeConstellationEdges } from './constellation-edges.js';
import { CONSTELLATION_SEED_KEY, resolveConstellationSession, seededRandom } from './constellation-session.js';
import type { RoutedConstellationEdge } from './constellation-edges.js';
import type { ConstellationSession } from './constellation-session.js';

const openSession = (): ConstellationSession => {
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  let storedSeed: string | null = null;
  try {
    storedSeed = window.sessionStorage.getItem(CONSTELLATION_SEED_KEY);
  } catch {
    // Storage is optional; without it every page load plays the intro.
  }
  const session = resolveConstellationSession(
    { storedSeed, navigationType: navigation?.type, referrer: document.referrer, origin: window.location.origin },
    () => Math.floor(Math.random() * 0x100000000)
  );
  try {
    window.sessionStorage.setItem(CONSTELLATION_SEED_KEY, String(session.seed));
  } catch {
    // Storage is optional.
  }
  return session;
};

interface Body extends SkillNode {
  hx: number;
  hy: number;
  /** Home position as a share (0..1) of the usable area, so it survives a resize. */
  u: number;
  v: number;
  /** Where the home position is slowly moving to, and when it picks its next destination. */
  tu: number;
  tv: number;
  nextMove: number;
  /** Earliest time the technology may pick a new place because text moved over its destination. */
  coolUntil: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  glow: number;
  boost: number;
  half: number;
  cluster: Area;
  clusterGroup: number;
  introX: number;
  introY: number;
  introAlpha: number;
  popAlpha: number;
  popTarget: boolean;
  popX: number;
  popY: number;
  popDx: number;
  popDy: number;
}

interface Packet {
  edge: SkillEdge;
  progress: number;
  speed: number;
  reverse: boolean;
}

interface Bubble {
  x: number;
  y: number;
  hx: number;
  hy: number;
  glow: number;
  labelHalf: number;
  vx: number;
  vy: number;
  phase: number;
  introX: number;
  introY: number;
  introAlpha: number;
}

interface Drifter {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
}

const MAX_PIXEL_RATIO = 1.5;
const MAX_PACKETS = 40;
const AMBIENT_GLOW = 0.38;
const DIM_GLOW = 0.07;
// Keep in sync with the narrow-screen media query in site.css.
const NARROW_VIEWPORT = 700;
const POINTER_RADIUS = 190;
// Ambient dust reacts to the cursor and to highlighted technologies within these distances.
const MOTE_POINTER_RADIUS = 160;
const MOTE_LIT_RADIUS = 170;
// Technology nodes are always larger than the dust (MOTE_MAX_RADIUS) and grow further when highlighted.
// Technology nodes are as small as the ambient dust; a highlighted node grows only a little and lights up.
const NODE_BASE_RADIUS = 2;
const NODE_GLOW_RADIUS = 1.4;
const LIT_GLOW = 0.6;
const HALO_RADIUS = 18;
// Start page only: the cursor wakes nearby nodes, clicks send out a shockwave and a random node pulses now and then.
const WAKE_RADIUS = 220;
const SHOCK_RADIUS = 300;
const PULSE_INTERVAL_MS = 1800;
const PULSE_DURATION_MS = 1600;
const HOME_AMBIENT_GLOW = 0.5;
const TAU = Math.PI * 2;
// Keep the constellation clear of the sticky header and the floating search button.
const SIDE_INSET = 24;
const BOTTOM_INSET = 88;
const TOP_GAP = 16;
// Text blocks and cards cover the canvas, so technologies steer clear of them. A node may sit this far
// behind an edge (partly hidden is fine), and the obstacles are re-measured as the page scrolls.
const TEXT_SELECTOR = 'main h1, main h2, main h3, main h4, main p, main dt, main dd, footer span, footer a';
const SURFACE_SELECTOR = '.site-header, .project-card, .assignment, .skill-group, .contact-card, .git-graph, .cv-figures > div, '
  + '.page-hero-panel, .practical > div, .project-facts > div, .project-detail > section, .service-cv-cta, .cv-toc, ' +
  'main button, main a, main input, main select, main textarea';
const OVERLAP_ALLOWED = 8;
const OBSTACLE_PUSH = 0.018;
const RETARGET_COOLDOWN_MS = 3000;
const OBSTACLE_REFRESH_MS = 600;
const OBSTACLE_REFRESH_WHILE_SCROLLING_MS = 60;
// Every technology now and then picks a new place and glides there slowly.
const RETARGET_MIN_MS = 20000;
const RETARGET_SPREAD_MS = 40000;
const HOME_EASE = 0.005;
const INTRO_DURATION_MS = 1200;
const INTRO_CLUSTER_STAGGER_MS = 110;
const POPOUT_DESKTOP = 3;
const POPOUT_MOBILE = 2;
const BUBBLE_RADIUS = 5;

export type MotionState = 'running' | 'paused' | 'reduced';

export const resolveMotionState = (reducedMotion: boolean, saved: string | null, viewportWidth: number): MotionState => {
  if (reducedMotion) return 'reduced';
  if (saved === 'paused' || saved === 'running') return saved;
  return viewportWidth < NARROW_VIEWPORT ? 'paused' : 'running';
};

export const shouldAnimateConstellation = (state: MotionState, documentVisible: boolean): boolean =>
  state === 'running' && documentVisible;

export const shouldSettleConstellationTransitions = (state: MotionState, initialSync: boolean): boolean =>
  state === 'reduced' || (state === 'paused' && !initialSync);

export const bubbleClickDisposition = (
  pointerStartedOnBubble: boolean,
  clickDetail: number,
  releasedOnBubble: boolean
): { readonly suppress: boolean; readonly reveal: boolean } => ({
  suppress: clickDetail > 0 && (pointerStartedOnBubble || releasedOnBubble),
  reveal: clickDetail > 0 && pointerStartedOnBubble && releasedOnBubble
});

export const constellationLabelFontSize = (viewportWidth: number): number =>
  viewportWidth < NARROW_VIEWPORT ? 11 : 13;

const keywordsOf = (target: EventTarget | null): string[] | null => {
  const element = target instanceof Element ? target.closest('[data-keywords], [data-skill]') : null;
  if (!element) return null;
  const skill = element.getAttribute('data-skill');
  if (skill) return [skill];
  return element.getAttribute('data-keywords')?.split('|').filter(Boolean) ?? null;
};

/**
 * The background: the CV's key technologies as a constellation. Technologies that were used together
 * in assignments are linked, the ones in the assignment being read (or hovered, or searched) light up,
 * and small data packets travel along the links.
 */
export class ConstellationEngine implements ExperienceEngine {
  readonly id = 'constellation';

  start(): void {
    const canvas = document.querySelector<HTMLCanvasElement>('#constellation-field');
    const context = canvas?.getContext('2d');
    const data = parseConstellationData(document.querySelector<HTMLElement>('#constellation-data')?.dataset.json);
    if (!canvas || !context || !data) return;
    const nodes = toNodes(data.groups);
    if (nodes.length < 2) return;

    const { edges, anchorCandidates } = buildConstellationGraph(nodes, data.assignments);
    const usage = usageCounts(nodes, data.assignments);
    const otherGroup = data.groups.find(group => group.isOther === true);
    const otherName = otherGroup?.name ?? 'Övrigt';
    const root = document.documentElement;
    const playful = document.querySelector('main.home') !== null;
    const ambientGlow = playful ? HOME_AMBIENT_GLOW : AMBIENT_GLOW;
    const neighbours = nodes.map(() => new Set<number>());
    for (const edge of edges) {
      neighbours[edge.a].add(edge.b);
      neighbours[edge.b].add(edge.a);
    }
    let pulse: { members: Set<number>; until: number } | null = null;
    let nextPulse = 0;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motionToggle = document.querySelector<HTMLButtonElement>('#motion-toggle');
    let savedChoice: string | null = null;
    try {
      savedChoice = window.localStorage.getItem('constellation-motion');
    } catch {
      // Storage is optional.
    }
    const session = openSession();
    const placementRandom = seededRandom(session.seed);
    let state: MotionState = 'running';
    let motionInitialized = false;
    const pointer = { x: -9999, y: -9999 };
    let bodies: Body[] = [];
    let packets: Packet[] = [];
    let visibleIndices = new Set<number>();
    let hiddenSortedByUsage: number[] = [];
    let renderEdges: RoutedConstellationEdge[] = [];
    const visibleTechEdgeAlphas: number[] = [];
    let bubble: Bubble | null = null;
    let popIndices = new Set<number>();
    let focusedPopIndices = new Set<number>();
    let revealState = createRevealState();
    let popoutBudget = 6;
    let labelHalves: number[] = [];
    let collapseTimer: number | null = null;
    let collapseDeadline: number | null = null;
    let collapseStepTimer: number | null = null;
    let collapseQueue: number[] = [];
    let collapsingIndices = new Set<number>();
    let collapseSequenceActive = false;
    let moreMatches = 0;
    let bubbleHasMatches = false;
    let introActive = false;
    let introStart = 0;
    let firstLayout = true;
    let focus: Set<number> | null = null;
    let litEdges: SkillEdge[] = [];
    let ambientEdges: SkillEdge[] = edges.filter(edge => edge.strong);
    let query = '';
    let hovered: string[] | null = null;
    let pinned: string[] | null = null;
    const pageKeywords = document.querySelector<HTMLElement>('[data-page-keywords]')
      ?.dataset.pageKeywords?.split('|').filter(Boolean) ?? null;
    let inView: string[] | null = null;
    let width = 0;
    let height = 0;
    let frame = 0;
    let deferredLayoutFrame = 0;
    let scrollLayoutFrame = 0;
    let bubblePointerDown = false;
    let last = 0;
    let colour = '255, 140, 80';
    let labelColour = '215, 222, 238';
    let labelAlpha = 0.14;
    // The bright centre of lit nodes and data packets: white on dark, a deep ember on light.
    let coreColour = '255, 255, 255';
    let area: Area = { left: 0, top: 0, right: 0, bottom: 0 };
    let obstacles: Area[] = [];
    let obstaclesDirty = true;
    let lastObstacleRefresh = -Infinity;
    let motes: Mote[] = [];
    let frameTime = 0;
    // Ambient dust is dim, so it is lifted a little on the light theme.
    let moteBoost = 1;

    const bubbleLabel = () => {
      const count = isRevealCycleComplete(revealState, hiddenSortedByUsage)
        ? 0
        : Math.max(0, hiddenSortedByUsage.length - popIndices.size - collapsingIndices.size);
      return moreMatches > 0 ? `${otherName} (+${count}) · +${moreMatches} fler` : `${otherName} (+${count})`;
    };
    const clearBubbleCollapseTimer = () => {
      if (collapseTimer !== null) window.clearTimeout(collapseTimer);
      collapseTimer = null;
      collapseDeadline = null;
    };

    const refreshColour = () => {
      const style = getComputedStyle(root);
      colour = style.getPropertyValue('--particle-rgb').trim() || colour;
      labelColour = style.getPropertyValue('--particle-label-rgb').trim() || labelColour;
      labelAlpha = Number.parseFloat(style.getPropertyValue('--particle-label-alpha')) || labelAlpha;
      coreColour = style.getPropertyValue('--particle-core-rgb').trim() || coreColour;
      moteBoost = root.dataset.theme === 'light' ? 1.7 : 1;
    };

    // The sticky header (desktop) or the sticky table of contents (narrow screens) covers the top of the viewport.
    const stickyTop = (): number => {
      const header = document.querySelector<HTMLElement>('.site-header');
      if (header && getComputedStyle(header).position === 'sticky') return header.getBoundingClientRect().height;
      const toc = document.querySelector<HTMLElement>('#cv-toc');
      if (toc && !toc.hidden && getComputedStyle(toc).position === 'sticky') return toc.getBoundingClientRect().height;
      return 0;
    };

    // Measure text and cards at every width so nodes can steer clear of their visible regions.
    // The visible text (measured tightly around the letters) and the cards that cover the background right now.
    const refreshObstacles = (time: number) => {
      lastObstacleRefresh = time;
      obstaclesDirty = false;
      const rects: Area[] = [];
      const visible = (rect: DOMRect) =>
        rect.width > 8 && rect.height > 8 && rect.bottom > 0 && rect.top < height && rect.right > 0 && rect.left < width;
      const toArea = (rect: DOMRect): Area => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
      document.querySelectorAll<HTMLElement>(SURFACE_SELECTOR).forEach(element => {
        const rect = element.getBoundingClientRect();
        if (visible(rect)) rects.push(toArea(rect));
      });
      const range = document.createRange();
      document.querySelectorAll<HTMLElement>(TEXT_SELECTOR).forEach(element => {
        if (element.closest(SURFACE_SELECTOR) || element.classList.contains('visually-hidden')) return;
        range.selectNodeContents(element);
        const rect = range.getBoundingClientRect();
        if (visible(rect)) rects.push(toArea(rect));
      });
      obstacles = effectiveObstacles(rects, OVERLAP_ALLOWED);
      document.querySelectorAll<HTMLElement>('a, button, input, textarea, select, [contenteditable="true"]')
        .forEach(element => {
          const rect = element.getBoundingClientRect();
          if (visible(rect)) obstacles.push(toArea(rect));
        });
    };

    const areaWidth = () => area.right - area.left;
    const areaHeight = () => area.bottom - area.top;

    const fittingRegion = (cluster: Area, half: number): Area =>
      cluster.right - cluster.left >= half * 2 + WOBBLE * 2 && cluster.bottom - cluster.top >= LABEL_HEIGHT + WOBBLE * 2
        ? cluster
        : area;

    const driftNode = (
      node: Drifter,
      homeX: number,
      homeY: number,
      half: number,
      region: Area,
      delta: number,
      time: number,
      pointerInfluence = true,
      labelOffset = 12,
      labelCollisionIndex?: number
    ) => {
      const targetX = homeX
        + Math.sin(time / 1700 + node.phase) * WOBBLE * 1.8
        + Math.cos(time / 4300 + node.phase * 1.7) * 14
        + Math.sin(time / 7200) * 16;
      const targetY = homeY
        + Math.cos(time / 2100 + node.phase) * WOBBLE * 1.8
        + Math.sin(time / 5100 + node.phase * 1.3) * 12
        + Math.cos(time / 8300) * 12;
      let forceX = (targetX - node.x) * 0.02;
      let forceY = (targetY - node.y) * 0.02;
      const exit = pointerInfluence
        ? exitVector(node.x, node.y - PROBE_OFFSET, obstacles)
        : exitVector(node.x, node.y, obstacles, BUBBLE_DOT_CLEARANCE);
      if (exit) {
        forceX += exit.dx * OBSTACLE_PUSH;
        forceY += exit.dy * OBSTACLE_PUSH;
      }
      if (!pointerInfluence) {
        const labelExit = labelExitVector({ x: node.x, y: node.y }, half, labelOffset, obstacles);
        if (labelExit) {
          forceX += labelExit.dx * OBSTACLE_PUSH;
          forceY += labelExit.dy * OBSTACLE_PUSH;
        }
        const bubbleLabelY = node.y - labelOffset;
        for (let index = 0; index < bodies.length; index++) {
          const other = bodies[index];
          if (!visibleIndices.has(index)) continue;
          const otherLabelY = other.y - 12;
          const overlapX = half + other.half + 4 - Math.abs(node.x - other.x);
          const overlapY = LABEL_HEIGHT + 4 - Math.abs(bubbleLabelY - otherLabelY);
          if (overlapX > 0 && overlapY > 0) {
            const directionX = Math.sign(node.x - other.x) || (node.phase < other.phase ? -1 : 1);
            const directionY = Math.sign(bubbleLabelY - otherLabelY) || (node.phase < other.phase ? -1 : 1);
            if (overlapX < overlapY) forceX += directionX * (overlapX + 2) * 1.4;
            else forceY += directionY * (overlapY + 2) * 1.4;
          }
          const dotX = node.x - other.x;
          const dotY = node.y - other.y;
          const dotDistance = Math.hypot(dotX, dotY);
          const dotGap = BUBBLE_RADIUS + NODE_GLOW_RADIUS + 2;
          if (dotDistance < dotGap && dotDistance > 0.1) {
            forceX += (dotX / dotDistance) * (dotGap - dotDistance) * 1.4;
            forceY += (dotY / dotDistance) * (dotGap - dotDistance) * 1.4;
          }
        }
      }
      if (pointerInfluence) {
        const dx = node.x - pointer.x;
        const dy = node.y - pointer.y;
        const distance = Math.hypot(dx, dy);
        if (distance < POINTER_RADIUS && distance > 0.1) {
          forceX += (dx / distance) * (POINTER_RADIUS - distance) * 0.012;
          forceY += (dy / distance) * (POINTER_RADIUS - distance) * 0.012;
        }
      }
      if (labelCollisionIndex !== undefined) {
        const body = bodies[labelCollisionIndex];
        for (let index = 0; index < bodies.length; index++) {
          if (index === labelCollisionIndex) continue;
          const other = bodies[index];
          if (!visibleIndices.has(index) && other.popAlpha === 0 && !other.popTarget) continue;
          const overlapX = body.half + other.half + 4 - Math.abs(node.x - other.x);
          const overlapY = LABEL_HEIGHT + 4 - Math.abs(node.y - other.y);
          if (overlapX <= 0 || overlapY <= 0) continue;
          const directionX = Math.sign(node.x - other.x) || (body.phase < other.phase ? -1 : 1);
          const directionY = Math.sign(node.y - other.y) || (body.phase < other.phase ? -1 : 1);
          if (overlapX < overlapY) forceX += directionX * (overlapX + 2) * 1.4;
          else forceY += directionY * (overlapY + 2) * 1.4;
        }
        if (bubble && node !== bubble) {
          const overlapX = half + bubble.labelHalf + 4 - Math.abs(node.x - bubble.x);
          const overlapY = LABEL_HEIGHT + 4 - Math.abs(node.y - (bubble.y - 15));
          if (overlapX > 0 && overlapY > 0) {
            const directionX = Math.sign(node.x - bubble.x) || (node.phase < bubble.phase ? -1 : 1);
            const directionY = Math.sign(node.y - (bubble.y - 15)) || (node.phase < bubble.phase ? -1 : 1);
            if (overlapX < overlapY) forceX += directionX * (overlapX + 2) * 1.4;
            else forceY += directionY * (overlapY + 2) * 1.4;
          }
        }
      }
      node.vx = (node.vx + forceX) * 0.86;
      node.vy = (node.vy + forceY) * 0.86;
      node.x = clampRange(node.x + node.vx * delta, region.left + half, region.right - half);
      node.y = clampRange(node.y + node.vy * delta, region.top + LABEL_HEIGHT + labelOffset - 12, region.bottom);
    };

    const separateDrawnLabels = () => {
      if (introActive) return;
      const isDrawn = (index: number) => visibleIndices.has(index)
        ? bodies[index].introAlpha > 0
        : bodies[index].popAlpha > 0;
      const separate = (index: number, otherX: number, otherY: number, otherHalf: number, otherPhase: number) => {
        const body = bodies[index];
        const overlapX = body.half + otherHalf + 4 - Math.abs(body.x - otherX);
        const overlapY = LABEL_HEIGHT + 4 - Math.abs(body.y - otherY);
        if (overlapX <= 0 || overlapY <= 0) return;
        const directionX = Math.sign(body.x - otherX) || (body.phase < otherPhase ? -1 : 1);
        const directionY = Math.sign(body.y - otherY) || (body.phase < otherPhase ? -1 : 1);
        const region = visibleIndices.has(index) ? fittingRegion(body.cluster, body.half) : area;
        const minX = region.left + body.half;
        const maxX = region.right - body.half;
        const minY = region.top + LABEL_HEIGHT;
        const maxY = region.bottom;
        let nextX = body.x;
        let nextY = body.y;
        if (overlapX < overlapY) {
          nextX = clampRange(body.x + directionX * (overlapX + 2), minX, maxX);
          if (Math.abs(nextX - body.x) < overlapX) {
            nextY = clampRange(body.y + directionY * (overlapY + 2), minY, maxY);
            if (Math.abs(nextY - body.y) < overlapY) {
              nextX = clampRange(body.x + directionX * (overlapX + 2), area.left + body.half, area.right - body.half);
              nextY = clampRange(body.y + directionY * (overlapY + 2), area.top + LABEL_HEIGHT, area.bottom);
            }
          }
        } else {
          nextY = clampRange(body.y + directionY * (overlapY + 2), minY, maxY);
          if (Math.abs(nextY - body.y) < overlapY) {
            nextX = clampRange(body.x + directionX * (overlapX + 2), minX, maxX);
            if (Math.abs(nextX - body.x) < overlapX) {
              nextX = clampRange(body.x + directionX * (overlapX + 2), area.left + body.half, area.right - body.half);
              nextY = clampRange(body.y + directionY * (overlapY + 2), area.top + LABEL_HEIGHT, area.bottom);
            }
          }
        }
        const shiftX = nextX - body.x;
        const shiftY = nextY - body.y;
        if (shiftX === 0 && shiftY === 0) return;
        body.x = nextX;
        body.y = nextY;
        body.vx *= 0.35;
        body.vy *= 0.35;
        if (visibleIndices.has(index)) {
          const normalized = share({ x: body.x, y: body.y });
          body.u = normalized.u;
          body.v = normalized.v;
          body.tu = normalized.u;
          body.tv = normalized.v;
          body.hx = body.x;
          body.hy = body.y;
        } else {
          body.popX += shiftX;
          body.popY += shiftY;
          body.popDx += shiftX;
          body.popDy += shiftY;
        }
      };

      for (let pass = 0; pass < 20; pass++) {
        for (let index = 0; index < bodies.length; index++) {
          if (!isDrawn(index)) continue;
          const body = bodies[index];
          for (let otherIndex = 0; otherIndex < index; otherIndex++) {
            if (!isDrawn(otherIndex)) continue;
            const other = bodies[otherIndex];
            separate(index, other.x, other.y, other.half, other.phase);
          }
          if (bubble) separate(index, bubble.x, bubble.y - 15, bubble.labelHalf, bubble.phase);
        }
      }
    };

    const homeOf = (body: Pick<Body, 'u' | 'v' | 'half' | 'cluster'>): { hx: number; hy: number } => {
      const region = fittingRegion(body.cluster, body.half);
      return {
        hx: clampRange(area.left + body.u * areaWidth(), region.left + body.half + WOBBLE, region.right - body.half - WOBBLE),
        hy: clampRange(area.top + body.v * areaHeight(), region.top + LABEL_HEIGHT + WOBBLE, region.bottom - WOBBLE)
      };
    };

    const share = (point: { x: number; y: number }) => ({
      u: areaWidth() > 0 ? (point.x - area.left) / areaWidth() : 0.5,
      v: areaHeight() > 0 ? (point.y - area.top) / areaHeight() : 0.5
    });

    const clusterOrigins = (count: number): { x: number; y: number }[] => {
      const columns = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / columns);
      return Array.from({ length: count }, (_, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        return {
          x: area.left + areaWidth() * (0.5 + (column - (columns - 1) / 2) * 0.035),
          y: area.top + areaHeight() * (0.5 + (row - (rows - 1) / 2) * 0.035)
        };
      });
    };

    // A new destination stays inside the technology's category region, clear of text and other destinations.
    const retarget = (index: number) => {
      const body = bodies[index];
      const others = bodies.flatMap((other, otherIndex) => {
        if (otherIndex === index || !visibleIndices.has(otherIndex)) return [];
        const home = homeOf({ u: other.tu, v: other.tv, half: other.half, cluster: other.cluster });
        return [{ ...home, half: other.half }];
      });
      const taken = others.map(({ hx, hy }) => ({ x: hx, y: hy }));
      const takenLabels = others.map(({ hx, hy, half }) => labelRectAt({ x: hx, y: hy }, half));
      if (bubble) takenLabels.push(labelRectAt({ x: bubble.x, y: bubble.y - 15 }, bubble.labelHalf));
      const { u, v } = share(scatterPoint(fittingRegion(body.cluster, body.half), body.half, obstacles, taken,
        Math.random, 110, 100, takenLabels));
      body.tu = u;
      body.tv = v;
    };

    const layout = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const fontSize = constellationLabelFontSize(width);
      context.font = `600 ${fontSize}px "Segoe UI", system-ui, sans-serif`;

      const previousArea = area;
      const offsetTop = stickyTop();
      // The canvas is only painted below the sticky menu, so nothing is drawn behind it.
      canvas.style.clipPath = offsetTop > 0 ? `inset(${offsetTop}px 0 0 0)` : '';
      area = { left: SIDE_INSET, top: offsetTop + TOP_GAP, right: width - SIDE_INSET, bottom: height - BOTTOM_INSET };
      const remapPoint = (point: { x: number; y: number }) => ({
        x: previousArea.right > previousArea.left
          ? area.left + (point.x - previousArea.left) / (previousArea.right - previousArea.left) * areaWidth()
          : area.left + areaWidth() / 2,
        y: previousArea.bottom > previousArea.top
          ? area.top + (point.y - previousArea.top) / (previousArea.bottom - previousArea.top) * areaHeight()
          : area.top + areaHeight() / 2
      });
      refreshObstacles(performance.now());
      motes = createMotes(moteCount(width, height, nodes.length), width, height);
      const previous = bodies;
      const previouslyVisible = visibleIndices;
      const budget = visibleBudget({ width: areaWidth(), height: areaHeight() }, nodes.length,
        width < NARROW_VIEWPORT ? 150 : 130, fontSize * 2.3);
      const selected = selectVisible(nodes, usage, budget);
      visibleIndices = new Set(selected);
      const clusterGroups = assignClusterGroups(nodes, selected, data.groups.length);
      const clusterLoads = Array.from({ length: data.groups.length }, () => 0);
      selected.forEach(index => { clusterLoads[clusterGroups[index]]++; });
      const categoryAreas = clusterAreas(area, clusterLoads);
      const origins = clusterOrigins(data.groups.length);
      hiddenSortedByUsage = nodes.map((_, index) => index).filter(index => !visibleIndices.has(index))
        .sort((a, b) => usage[b] - usage[a] || a - b);
      revealState = reconcileRevealState(revealState, hiddenSortedByUsage);
      const previousBubble = bubble;
      const bubbleLabelWidth = Math.max(
        context.measureText(`${otherName} (+${hiddenSortedByUsage.length})`).width,
        context.measureText(`${otherName} (+${hiddenSortedByUsage.length}) · +${hiddenSortedByUsage.length} fler`).width
      );
      const bubbleHalf = Math.min(width / 2 - SIDE_INSET, bubbleLabelWidth / 2 + LABEL_PADDING);
      const bubbleX = clampRange(area.right - bubbleHalf - 20, area.left + bubbleHalf, area.right - bubbleHalf);
      const bubbleY = clampRange(area.bottom - 12, area.top + LABEL_HEIGHT, area.bottom);
      const bubbleOrigin = { x: area.left + areaWidth() / 2 + 8, y: area.top + areaHeight() / 2 - 5 };
      const animateIntro = firstLayout && session.playIntro && !motion.matches;
      if (animateIntro) {
        introActive = true;
        introStart = performance.now();
      }
      bubble = hiddenSortedByUsage.length === 0 ? null : {
        x: previousBubble ? remapPoint(previousBubble).x : animateIntro ? bubbleOrigin.x : bubbleX,
        y: previousBubble ? remapPoint(previousBubble).y : animateIntro ? bubbleOrigin.y : bubbleY,
        hx: bubbleX, hy: bubbleY, glow: previousBubble?.glow ?? 0, labelHalf: bubbleHalf,
        vx: previousBubble?.vx ?? 0, vy: previousBubble?.vy ?? 0, phase: previousBubble?.phase ?? Math.random() * TAU,
        introX: bubbleOrigin.x, introY: bubbleOrigin.y,
        introAlpha: previousBubble ? previousBubble.introAlpha : animateIntro ? 0 : 1
      };
      labelHalves = nodes.map(node => context.measureText(node.name).width / 2 + LABEL_PADDING);
      const taken: { x: number; y: number }[] = [];
      const takenLabels: ReturnType<typeof labelRectAt>[] = bubble
        ? [labelRectAt({ x: bubbleX, y: bubbleY - 15 }, bubbleHalf)]
        : [];
      bodies = nodes.map((node, index) => {
        const half = labelHalves[index];
        const clusterGroup = clusterGroups[index];
        const cluster = clusterLoads[clusterGroup] > 0 ? categoryAreas[clusterGroup] ?? area : area;
        const earlier = previous[index];
        const isVisible = visibleIndices.has(index);
        const placement = earlier ?? share(scatterPoint(fittingRegion(cluster, half), half, obstacles,
          isVisible ? taken : [], placementRandom, 110, 500, isVisible ? takenLabels : []));
        const { u, v } = placement;
        const { hx, hy } = homeOf({ u, v, half, cluster });
        const remapped = earlier ? remapPoint(earlier) : null;
        const remappedPop = earlier ? remapPoint({ x: earlier.popX, y: earlier.popY }) : null;
        if (isVisible) {
          taken.push({ x: hx, y: hy });
          takenLabels.push(labelRectAt({ x: hx, y: hy }, half));
        }
        const origin = origins[clusterGroup] ?? { x: area.left + areaWidth() / 2, y: area.top + areaHeight() / 2 };
        return {
          ...node, u, v, tu: earlier?.tu ?? u, tv: earlier?.tv ?? v, nextMove: earlier?.nextMove ?? 0, coolUntil: 0,
          hx, hy, x: remapped?.x ?? (animateIntro ? origin.x : hx), y: remapped?.y ?? (animateIntro ? origin.y : hy),
          vx: earlier?.vx ?? 0, vy: earlier?.vy ?? 0, phase: earlier?.phase ?? Math.random() * TAU,
          glow: ambientGlow, boost: 0, half, cluster, clusterGroup, introX: origin.x, introY: origin.y,
          introAlpha: earlier?.introAlpha ?? (animateIntro ? 0 : 1), popAlpha: earlier?.popAlpha ?? 0,
          popTarget: false, popX: remappedPop?.x ?? hx, popY: remappedPop?.y ?? hy,
          popDx: remappedPop && bubble ? remappedPop.x - bubble.x : 0,
          popDy: remappedPop && bubble ? remappedPop.y - bubble.y : 0
        };
      });
      firstLayout = false;

      bodies.forEach((body, index) => {
        if (previous.length > 0 && visibleIndices.has(index) && !previouslyVisible.has(index)) {
          body.x = body.hx;
          body.y = body.hy;
          body.popAlpha = 0;
          body.popTarget = false;
          body.introAlpha = 1;
        } else if (!visibleIndices.has(index) && body.popAlpha === 0 && bubble) {
          body.x = bubble.x;
          body.y = bubble.y;
        }
      });
      if (bubble) {
        const headerBottom = document.querySelector<HTMLElement>('.site-header')?.getBoundingClientRect().bottom ?? 0;
        const bubbleTaken = bodies.flatMap((body, index) => visibleIndices.has(index) ? [{ x: body.hx, y: body.hy }] : []);
        const bubbleLabels = bodies.flatMap((body, index) => visibleIndices.has(index)
          ? [labelRectAt({ x: body.hx, y: body.hy }, body.half)]
          : []);
        const bubblePoint = scatterBubblePoint(area, bubble.labelHalf, headerBottom, obstacles, bubbleLabels, bubbleTaken,
          hiddenSortedByUsage.map(index => bodies[index].half));
        bubble.hx = bubblePoint.x;
        bubble.hy = bubblePoint.y + 15;
        if (!previousBubble && !animateIntro) {
          bubble.x = bubble.hx;
          bubble.y = bubble.hy;
        }
      }
    };

    const targetGlow = (index: number) => {
      if (focus) return focus.has(index) ? 1 : DIM_GLOW;
      return Math.max(ambientGlow, bodies[index]?.boost ?? 0);
    };

    const rebuildRenderEdges = () => {
      const popped = new Set<number>();
      bodies.forEach((body, index) => {
        if (body.popTarget || body.popAlpha > 0) popped.add(index);
      });
      renderEdges = routeConstellationEdges(
        edges, nodes, bodies, visibleIndices, popped, bubble !== null, bubble ?? undefined, anchorCandidates
      );
    };

    const finishIntro = () => {
      if (!introActive) return;
      introActive = false;
      bodies.forEach((body, index) => {
        if (visibleIndices.has(index)) {
          body.x = body.hx;
          body.y = body.hy;
        }
        body.introAlpha = 1;
        body.vx = 0;
        body.vy = 0;
      });
      if (bubble) {
        bubble.x = bubble.hx;
        bubble.y = bubble.hy;
        bubble.introAlpha = 1;
      }
      separateDrawnLabels();
      recompute();
    };

    const settleHiddenPopouts = () => {
      if (!bubble) return;
      const bubblePoint = { x: bubble.x, y: bubble.y };
      bodies.forEach((body, index) => {
        if (visibleIndices.has(index)) return;
        const settled = settlePopout(body.popTarget, { x: body.popX, y: body.popY }, bubblePoint);
        body.x = settled.x;
        body.y = settled.y;
        body.vx = 0;
        body.vy = 0;
        body.popAlpha = settled.alpha;
      });
      rebuildRenderEdges();
    };

    const recompute = () => {
      const keywords = hovered ?? pinned ?? inView ?? pageKeywords;
      if (query.trim()) focus = nodesMatchingQuery(nodes, query);
      else if (keywords) focus = nodesMatching(nodes, keywords);
      else focus = null;
      if (focus?.size === 0) focus = null;

      revealState = retainHighlightedReveals(revealState, focus ?? new Set());
      for (const index of collapsingIndices) {
        if (focus?.has(index)) collapsingIndices.delete(index);
      }
      const active = focus;
      litEdges = active ? edges.filter(edge => active.has(edge.a) && active.has(edge.b)) : [];
      ambientEdges = edges.filter(edge => edge.strong);
      const baseOrbitLabels = bodies.flatMap((body, index) => visibleIndices.has(index)
        ? [labelRectAt({ x: body.x, y: body.y }, body.half)]
        : []);
      if (bubble) baseOrbitLabels.push(labelRectAt({ x: bubble.x, y: bubble.y - 15 }, bubble.labelHalf));
      const capacity = bubble
        ? orbitSlots(area, bubble, orbitCandidateWidths(area, hiddenSortedByUsage.map(index => bodies[index].half)), obstacles, baseOrbitLabels).length
        : 0;
      popoutBudget = Math.min(hiddenSortedByUsage.length, Math.max(Math.min(3, hiddenSortedByUsage.length), capacity));
      const limit = Math.min(width < NARROW_VIEWPORT ? POPOUT_MOBILE : POPOUT_DESKTOP, popoutBudget);
      const focusedPops = focus ? poppedOut(hiddenSortedByUsage, focus, limit) : { shown: [], remaining: 0 };
      moreMatches = focusedPops.remaining;
      focusedPopIndices = new Set(focusedPops.shown);
      popIndices = new Set(focusedPopIndices);
      revealedIndices(revealState).forEach(index => {
        if (!collapsingIndices.has(index)) popIndices.add(index);
      });
      bubbleHasMatches = !!bubble && !!focus && hiddenSortedByUsage.some(index => focus?.has(index));
      if (bubble && bubbleHasMatches) bubble.glow = Math.max(bubble.glow, 0.65);
      const animationRunning = shouldAnimateConstellation(state, !document.hidden);
      const candidatePopIndices = hiddenSortedByUsage.filter(index => popIndices.has(index));
      const orbitLabels = [...baseOrbitLabels];
      if (animationRunning) {
        for (const index of hiddenSortedByUsage) {
          const body = bodies[index];
          if (!popIndices.has(index) && body.popAlpha > 0)
            orbitLabels.push(labelRectAt({ x: body.x, y: body.y }, body.half));
        }
      }
      const orbitOrder = [...candidatePopIndices].sort((a, b) => bodies[b].half - bodies[a].half);
      const slots = bubble
        ? orbitSlots(area, bubble, orbitOrder.map(index => bodies[index].half), obstacles, orbitLabels)
        : [];
      const placedIndices = orbitOrder.slice(0, slots.length);
      const activeSet = new Set(placedIndices);
      for (const index of candidatePopIndices) {
        if (activeSet.has(index)) continue;
        if (focusedPopIndices.has(index)) moreMatches++;
        else revealState = returnRevealedItem(revealState, index);
      }
      focusedPopIndices = new Set([...focusedPopIndices].filter(index => activeSet.has(index)));
      popIndices = activeSet;
      const slotForNode = new Map(placedIndices.map((index, slot) => [index, slots[slot]]));
      for (const index of hiddenSortedByUsage) {
        const body = bodies[index];
        const shouldPop = activeSet.has(index);
        body.popTarget = shouldPop;
        if (!shouldPop) continue;
        if (introActive) body.introAlpha = bubble?.introAlpha ?? 1;
        const slot = slotForNode.get(index);
        if (slot && bubble) {
          if (body.popAlpha === 0) {
            body.x = bubble.x;
            body.y = bubble.y;
          }
          body.popX = slot.x;
          body.popY = slot.y;
          body.popDx = slot.x - bubble.x;
          body.popDy = slot.y - bubble.y;
        }
      }
      if (!animationRunning) settleHiddenPopouts();
      separateDrawnLabels();
      if (animationRunning) rebuildRenderEdges();
      if (frame === 0) {
        bodies.forEach((body, index) => { body.glow = targetGlow(index); });
        if (bubble) bubble.glow = bubbleHasMatches ? 1 : 0;
        draw();
      }
    };

    const cancelStaggeredCollapse = (): boolean => {
      const wasCollapsing = collapseSequenceActive || collapseQueue.length > 0 || collapsingIndices.size > 0;
      if (collapseStepTimer !== null) window.clearTimeout(collapseStepTimer);
      collapseStepTimer = null;
      collapseQueue = [];
      collapsingIndices.clear();
      collapseSequenceActive = false;
      return wasCollapsing;
    };

    const finishCollapseSequence = () => {
      if (!collapseSequenceActive || collapseQueue.length > 0 || collapsingIndices.size > 0) return;
      collapseSequenceActive = false;
      revealState = collapseRevealState(revealState, focus ?? new Set());
      recompute();
    };

    const finishCollapseImmediately = () => {
      if (collapseStepTimer !== null) window.clearTimeout(collapseStepTimer);
      collapseStepTimer = null;
      collapseQueue = [];
      collapsingIndices.clear();
      collapseSequenceActive = false;
      revealState = collapseRevealState(revealState, focus ?? new Set());
      recompute();
    };

    const startNextCollapseStep = () => {
      if (!collapseSequenceActive) return;
      const index = collapseQueue.shift();
      if (index === undefined) {
        finishCollapseSequence();
        return;
      }
      if (!focus?.has(index)) {
        collapsingIndices.add(index);
        recompute();
      }
      if (collapseQueue.length > 0) {
        collapseStepTimer = window.setTimeout(startNextCollapseStep, COLLAPSE_STAGGER_MS);
      } else {
        collapseStepTimer = null;
        finishCollapseSequence();
      }
    };

    const scheduleBubbleCollapse = () => {
      clearBubbleCollapseTimer();
      collapseDeadline = bubbleCollapseDeadline(performance.now());
      collapseTimer = window.setTimeout(() => {
        if (!isBubbleCollapseDue(collapseDeadline, performance.now())) return;
        collapseTimer = null;
        collapseDeadline = null;
        collapseSequenceActive = true;
        collapseQueue = collapseRevealOrder(revealState, new Set([...(focus ?? []), ...collapsingIndices]));
        if (!shouldAnimateConstellation(state, !document.hidden)) {
          finishCollapseImmediately();
          return;
        }
        startNextCollapseStep();
      }, BUBBLE_COLLAPSE_DELAY_MS);
    };

    const spawnPacket = () => {
      const pool = litEdges.length > 0 ? litEdges : ambientEdges;
      if (pool.length === 0 || packets.length >= MAX_PACKETS) return;
      packets.push({
        edge: pool[Math.floor(Math.random() * pool.length)],
        progress: 0,
        speed: 0.005 + Math.random() * 0.01,
        reverse: Math.random() < 0.5
      });
    };

    const spawnFrom = (index: number, count: number) => {
      const own = edges.filter(edge => edge.a === index || edge.b === index);
      for (let step = 0; step < count && own.length > 0 && packets.length < MAX_PACKETS; step++) {
        const edge = own[Math.floor(Math.random() * own.length)];
        packets.push({ edge, progress: 0, speed: 0.008 + Math.random() * 0.012, reverse: edge.b === index });
      }
    };

    // Boost = how awake a node is: close to the cursor, or part of the current idle pulse.
    const updatePlay = (time: number) => {
      if (time >= nextPulse && bodies.length > 0) {
        const index = Math.floor(Math.random() * bodies.length);
        pulse = { members: new Set([index, ...neighbours[index]]), until: time + PULSE_DURATION_MS };
        spawnFrom(index, 3);
        nextPulse = time + PULSE_INTERVAL_MS;
      }
      if (pulse && time > pulse.until) pulse = null;
      bodies.forEach((body, index) => {
        const near = Math.max(0, 1 - Math.hypot(body.x - pointer.x, body.y - pointer.y) / WAKE_RADIUS);
        const pulsed = pulse?.members.has(index) ? 0.85 : 0;
        body.boost = Math.max(near * 1.1, pulsed);
      });
    };

    const isInteractiveTarget = (target: EventTarget | null): boolean =>
      target instanceof Element && target.closest('a, button, input, textarea, select, [contenteditable="true"]') !== null;

    const hitBubble = (x: number, y: number): boolean => {
      if (!bubble) return false;
      context.font = `600 ${constellationLabelFontSize(width)}px "Segoe UI", system-ui, sans-serif`;
      const labelWidth = context.measureText(bubbleLabel()).width / 2 + 8;
      const onDot = Math.hypot(x - bubble.x, y - bubble.y) <= BUBBLE_RADIUS + 9;
      const onLabel = Math.abs(x - bubble.x) <= labelWidth && y >= bubble.y - 30 && y <= bubble.y - 7;
      return onDot || onLabel;
    };

    // The canvas stays aria-hidden; hit-test its bubble without adding a focusable control.
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary) {
        bubblePointerDown = false;
        return;
      }
      bubblePointerDown = hitBubble(event.clientX, event.clientY);
      if (bubblePointerDown) {
        // The canvas is behind page content; claim bubble hits before an underlying link can navigate.
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (isInteractiveTarget(event.target)) return;
      if (playful && frame !== 0) {
        bodies.forEach((body, index) => {
          const dx = body.x - event.clientX;
          const dy = body.y - event.clientY;
          const distance = Math.hypot(dx, dy);
          if (!visibleIndices.has(index) || distance > SHOCK_RADIUS || distance < 0.1) return;
          const push = (1 - distance / SHOCK_RADIUS) * 14;
          body.vx += (dx / distance) * push;
          body.vy += (dy / distance) * push;
          body.boost = 1;
        });
        for (let count = 0; count < 8; count++) spawnPacket();
      }
    };

    const onPointerCancel = () => { bubblePointerDown = false; };

    const onClick = (event: MouseEvent) => {
      const pointerStartedOnBubble = bubblePointerDown;
      const releasedOnBubble = hitBubble(event.clientX, event.clientY);
      bubblePointerDown = false;
      const disposition = bubbleClickDisposition(pointerStartedOnBubble, event.detail, releasedOnBubble);
      if (!disposition.suppress) return;
      event.preventDefault();
      event.stopPropagation();
      if (!disposition.reveal) return;
      const canceledCollapse = cancelStaggeredCollapse();
      clearBubbleCollapseTimer();
      const previousSeen = revealState.seen.length;
      const reserved = new Set([...focusedPopIndices, ...collapsingIndices]);
      revealState = revealNextBatch(revealState, hiddenSortedByUsage, 3, popoutBudget, reserved);
      if (canceledCollapse || revealState.seen.length !== previousSeen) recompute();
      scheduleBubbleCollapse();
    };

    const settleAfterLayout = () => {
      bodies.forEach((body, index) => {
        if (!visibleIndices.has(index)) return;
        body.x = body.hx;
        body.y = body.hy;
        body.vx = 0;
        body.vy = 0;
      });
      if (bubble) {
        bubble.x = bubble.hx;
        bubble.y = bubble.hy;
      }
      settleHiddenPopouts();
      rebuildRenderEdges();
      draw();
    };

    const update = (delta: number, time: number) => {
      if (playful) updatePlay(time);
      driftMotes(motes, delta, width, height);
      repelMotes(motes, pointer.x, pointer.y, MOTE_POINTER_RADIUS);
      if (time - lastObstacleRefresh > (obstaclesDirty ? OBSTACLE_REFRESH_WHILE_SCROLLING_MS : OBSTACLE_REFRESH_MS)) refreshObstacles(time);

      let edgeRoutesChanged = false;
      if (introActive) {
        bodies.forEach((body, index) => {
          if (!visibleIndices.has(index)) return;
          const progress = introProgress(time, introStart, INTRO_DURATION_MS, body.group * INTRO_CLUSTER_STAGGER_MS);
          const point = introPosition({ x: body.hx, y: body.hy }, { x: body.introX, y: body.introY }, progress);
          body.x = point.x;
          body.y = point.y;
          body.introAlpha = progress;
        });
        if (bubble) {
          const progress = introProgress(time, introStart, INTRO_DURATION_MS, data.groups.length * INTRO_CLUSTER_STAGGER_MS);
          const point = introPosition({ x: bubble.hx, y: bubble.hy }, { x: bubble.introX, y: bubble.introY }, progress);
          bubble.x = point.x;
          bubble.y = point.y;
          bubble.introAlpha = progress;
        }
        if (time >= introStart + INTRO_DURATION_MS + data.groups.length * INTRO_CLUSTER_STAGGER_MS) finishIntro();
      }

      if (bubble && !introActive && shouldAnimateConstellation(state, !document.hidden)) {
        driftNode(bubble, bubble.hx, bubble.hy, bubble.labelHalf, fittingRegion(area, bubble.labelHalf), delta, time, false, 15);
      }

      bodies.forEach((body, index) => {
        const wasPoppedOut = body.popAlpha > 0;
        if (bubble && body.popTarget) {
          body.popX = clampRange(bubble.x + body.popDx, area.left + body.half, area.right - body.half);
          body.popY = clampRange(bubble.y + body.popDy, area.top + LABEL_HEIGHT, area.bottom);
        }
        if (visibleIndices.has(index) && !introActive && shouldAnimateConstellation(state, !document.hidden)) {
          if (time >= body.nextMove) {
            if (body.nextMove > 0) retarget(index);
            body.nextMove = time + RETARGET_MIN_MS + Math.random() * RETARGET_SPREAD_MS;
          }
          const destination = homeOf(body);
          if (time >= body.coolUntil && exitVector(destination.hx, destination.hy - PROBE_OFFSET, obstacles)) {
            retarget(index);
            body.coolUntil = time + RETARGET_COOLDOWN_MS;
          }
          body.u += (body.tu - body.u) * HOME_EASE * delta;
          body.v += (body.tv - body.v) * HOME_EASE * delta;
          Object.assign(body, homeOf(body));
          const movementRegion = fittingRegion(body.cluster, body.half);
          driftNode(body, body.hx, body.hy, body.half, movementRegion, delta, time, true, 12, index);
        } else if (shouldAnimateConstellation(state, !document.hidden) && (body.popAlpha > 0 || body.popTarget)) {
          if (introActive && body.popTarget) body.introAlpha = bubble?.introAlpha ?? 1;
          if (body.popTarget && body.popAlpha >= 1 && !introActive) {
            driftNode(body, body.popX, body.popY, body.half, fittingRegion(area, body.half), delta, time, true, 12, index);
          } else {
            const targetX = body.popTarget ? body.popX : bubble?.x ?? body.x;
            const targetY = body.popTarget ? body.popY : bubble?.y ?? body.y;
            const amount = Math.min(1, (body.popTarget ? 0.075 : 0.075) * delta);
            body.popAlpha = clampRange(body.popAlpha + (body.popTarget ? amount : -amount), 0, 1);
            const forceX = (targetX - body.x) * 0.035;
            const forceY = (targetY - body.y) * 0.035;
            body.vx = (body.vx + forceX) * 0.82;
            body.vy = (body.vy + forceY) * 0.82;
            body.x = clampRange(body.x + body.vx * delta, area.left + body.half, area.right - body.half);
            body.y = clampRange(body.y + body.vy * delta, area.top + LABEL_HEIGHT, area.bottom);
          }
          if (wasPoppedOut !== (body.popAlpha > 0)) edgeRoutesChanged = true;
          if (!body.popTarget && body.popAlpha === 0 && collapsingIndices.delete(index)) {
            if (bubble) {
              body.x = bubble.x;
              body.y = bubble.y;
            }
            body.vx = 0;
            body.vy = 0;
            revealState = returnRevealedItem(revealState, index);
            body.popDx = 0;
            body.popDy = 0;
            popIndices.delete(index);
            finishCollapseSequence();
          }
        }
        body.glow += (targetGlow(index) - body.glow) * Math.min(1, 0.08 * delta);
      });
      separateDrawnLabels();
      if (bubble) {
        const target = bubbleHasMatches ? 1 : 0;
        bubble.glow += (target - bubble.glow) * Math.min(1, 0.08 * delta);
      }
      if (!shouldAnimateConstellation(state, !document.hidden) && !introActive) {
        settleHiddenPopouts();
        bodies.forEach((body, index) => { body.glow = targetGlow(index); });
        if (bubble) bubble.glow = bubbleHasMatches ? 1 : 0;
      }
      if (edgeRoutesChanged) rebuildRenderEdges();
      if (Math.random() < (litEdges.length > 0 ? 0.18 : 0.05) * delta) spawnPacket();
      for (const packet of packets) packet.progress += packet.speed * delta;
      packets = packets.filter(packet => packet.progress < 1);
    };

    // Background dust: it links up faintly, twinkles, and lights up near the cursor and near highlighted technologies.
    const drawMotes = () => {
      const lit = bodies.filter((body, index) => (visibleIndices.has(index) || body.popAlpha > 0) && body.glow > 0.6);
      forEachMoteLink(motes, MOTE_LINK_DISTANCE, (first, second, closeness) => {
        context.strokeStyle = `rgba(${colour}, ${closeness * 0.17 * moteBoost})`;
        context.lineWidth = 0.8;
        context.beginPath();
        context.moveTo(first.x, first.y);
        context.lineTo(second.x, second.y);
        context.stroke();
      });
      for (const mote of motes) {
        let brightness = moteBrightness(mote, frameTime);
        for (const body of lit) {
          const distance = Math.hypot(mote.x - body.x, mote.y - body.y);
          if (distance < MOTE_LIT_RADIUS) brightness += (1 - distance / MOTE_LIT_RADIUS) * 0.55;
        }
        const nearPointer = Math.hypot(mote.x - pointer.x, mote.y - pointer.y);
        if (nearPointer < MOTE_POINTER_RADIUS) brightness += (1 - nearPointer / MOTE_POINTER_RADIUS) * 0.5;
        context.fillStyle = `rgba(${colour}, ${Math.min(1, brightness * moteBoost)})`;
        context.beginPath();
        context.arc(mote.x, mote.y, moteRadius(mote, brightness), 0, TAU);
        context.fill();
      }
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      drawMotes();
      const fontSize = constellationLabelFontSize(width);
      context.font = `600 ${fontSize}px "Segoe UI", system-ui, sans-serif`;
      context.textAlign = 'center';

      const endpoint = (index: number): { x: number; y: number; glow: number } | null => {
        if (index < 0) return bubble ? { x: bubble.x, y: bubble.y, glow: bubble.glow } : null;
        return { x: bodies[index].x, y: bodies[index].y, glow: bodies[index].glow };
      };
      visibleTechEdgeAlphas.length = 0;
      for (const edge of renderEdges) {
        if (edge.a < 0 || edge.b < 0) continue;
        const from = bodies[edge.a];
        const to = bodies[edge.b];
        if (!from || !to || from.x < 0 || from.x > width || from.y < 0 || from.y > height
          || to.x < 0 || to.x > width || to.y < 0 || to.y > height) continue;
        const alphaFade = Math.min(from.introAlpha, to.introAlpha);
        if (alphaFade <= 0) continue;
        const lit = Math.min(from.glow, to.glow);
        visibleTechEdgeAlphas.push(constellationEdgeStyle(edge, lit).alpha * alphaFade);
      }
      visibleTechEdgeAlphas.sort((a, b) => a - b);
      const middle = Math.floor(visibleTechEdgeAlphas.length / 2);
      const medianAlpha = visibleTechEdgeAlphas.length === 0 ? 0
        : visibleTechEdgeAlphas.length % 2 === 0
          ? (visibleTechEdgeAlphas[middle - 1] + visibleTechEdgeAlphas[middle]) / 2
          : visibleTechEdgeAlphas[middle];
      const anchorFloor = constellationAnchorAlphaFloor(medianAlpha, root.dataset.theme === 'light');
      for (const edge of renderEdges) {
        const from = endpoint(edge.a);
        const to = endpoint(edge.b);
        if (!from || !to) continue;
        const lit = Math.min(from.glow, to.glow);
        const fromIntro = edge.a < 0 ? bubble?.introAlpha ?? 1 : bodies[edge.a].introAlpha;
        const toIntro = edge.b < 0 ? bubble?.introAlpha ?? 1 : bodies[edge.b].introAlpha;
        const alphaFade = Math.min(fromIntro, toIntro);
        const style = constellationEdgeStyle(edge, lit, anchorFloor);
        context.strokeStyle = `rgba(${colour}, ${style.alpha * alphaFade})`;
        context.lineWidth = style.width;
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
        context.stroke();
      }

      for (const packet of packets) {
        const edge = packet.edge;
        const hiddenA = !visibleIndices.has(edge.a) && bodies[edge.a].popAlpha === 0;
        const hiddenB = !visibleIndices.has(edge.b) && bodies[edge.b].popAlpha === 0;
        const from = hiddenA && bubble ? { x: bubble.x, y: bubble.y } : bodies[edge.a];
        const to = hiddenB && bubble ? { x: bubble.x, y: bubble.y } : bodies[edge.b];
        const amount = packet.reverse ? 1 - packet.progress : packet.progress;
        const x = from.x + (to.x - from.x) * amount;
        const y = from.y + (to.y - from.y) * amount;
        const halo = context.createRadialGradient(x, y, 0, x, y, 9);
        halo.addColorStop(0, `rgba(${coreColour}, 0.95)`);
        halo.addColorStop(0.35, `rgba(${colour}, 0.7)`);
        halo.addColorStop(1, `rgba(${colour}, 0)`);
        context.fillStyle = halo;
        context.beginPath();
        context.arc(x, y, 9, 0, TAU);
        context.fill();
      }

      for (let index = 0; index < bodies.length; index++) {
        const body = bodies[index];
        if (!visibleIndices.has(index) && body.popAlpha <= 0) continue;
        const alpha = (visibleIndices.has(index) ? 1 : body.popAlpha) * body.introAlpha;
        if (alpha <= 0) continue;
        if (body.glow > LIT_GLOW) {
          const halo = context.createRadialGradient(body.x, body.y, 0, body.x, body.y, HALO_RADIUS);
          halo.addColorStop(0, `rgba(${colour}, ${body.glow * 0.5 * alpha})`);
          halo.addColorStop(1, `rgba(${colour}, 0)`);
          context.fillStyle = halo;
          context.beginPath();
          context.arc(body.x, body.y, HALO_RADIUS, 0, TAU);
          context.fill();
        }
        context.fillStyle = body.glow > LIT_GLOW ? `rgba(${coreColour}, ${alpha})` : `rgba(${colour}, ${(0.35 + body.glow * 0.5) * alpha})`;
        context.beginPath();
        context.arc(body.x, body.y, NODE_BASE_RADIUS + body.glow * NODE_GLOW_RADIUS, 0, TAU);
        context.fill();
        context.fillStyle = `rgba(${labelColour}, ${Math.min(1, labelAlpha + body.glow * 0.8) * alpha})`;
        context.fillText(body.name, body.x, body.y - 12);
      }

      if (bubble && bubble.introAlpha > 0) {
        const emptyAlpha = isRevealCycleComplete(revealState, hiddenSortedByUsage) ? 0.34 : 1;
        const alpha = bubble.introAlpha * emptyAlpha;
        const glow = bubble.glow * alpha;
        if (glow > 0.05) {
          const halo = context.createRadialGradient(bubble.x, bubble.y, BUBBLE_RADIUS, bubble.x, bubble.y, HALO_RADIUS + 4);
          halo.addColorStop(0, `rgba(${colour}, ${glow * 0.65})`);
          halo.addColorStop(1, `rgba(${colour}, 0)`);
          context.fillStyle = halo;
          context.beginPath();
          context.arc(bubble.x, bubble.y, HALO_RADIUS + 4, 0, TAU);
          context.fill();
        }
        context.strokeStyle = `rgba(${colour}, ${(0.22 + glow * 0.55) * alpha})`;
        context.lineWidth = 1.2 + glow;
        context.beginPath();
        context.arc(bubble.x, bubble.y, BUBBLE_RADIUS + 3 + glow * 3, 0, TAU);
        context.stroke();
        context.fillStyle = `rgba(${colour}, ${(0.55 + glow * 0.4) * alpha})`;
        context.beginPath();
        context.arc(bubble.x, bubble.y, BUBBLE_RADIUS + glow, 0, TAU);
        context.fill();
        context.fillStyle = `rgba(${labelColour}, ${Math.min(1, labelAlpha + 0.45 + glow * 0.3) * alpha})`;
        context.fillText(bubbleLabel(), bubble.x, bubble.y - 15);
      }
    };

    const step = (time: number) => {
      frame = 0;
      const delta = Math.min((time - last) / 16.67, 3);
      last = time;
      frameTime = time;
      update(delta, time);
      draw();
      if (shouldAnimateConstellation(state, !document.hidden) || (introActive && !document.hidden)) frame = requestAnimationFrame(step);
    };

    const sync = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      const initialSync = !motionInitialized;
      state = resolveMotionState(motion.matches, savedChoice, window.innerWidth);
      motionInitialized = true;
      const settleTransitions = shouldSettleConstellationTransitions(state, initialSync);
      if (settleTransitions && deferredLayoutFrame) {
        cancelAnimationFrame(deferredLayoutFrame);
        deferredLayoutFrame = 0;
      }
      root.dataset.constellationMotion = state;
      if (motionToggle) {
        motionToggle.hidden = state === 'reduced';
        motionToggle.setAttribute('aria-pressed', String(state === 'paused'));
      }
      refreshColour();
      if (settleTransitions) finishIntro();
      if (!shouldAnimateConstellation(state, !document.hidden) && (collapseSequenceActive || collapsingIndices.size > 0))
        finishCollapseImmediately();
      if (!shouldAnimateConstellation(state, !document.hidden) && !(introActive && !document.hidden)) {
        settleHiddenPopouts();
        bodies.forEach((body, index) => { body.glow = targetGlow(index); });
        if (bubble) bubble.glow = bubbleHasMatches ? 1 : 0;
        draw();
        return;
      }
      last = performance.now();
      frame = requestAnimationFrame(step);
    };

    const onEnter = (event: Event) => {
      const keywords = keywordsOf(event.target);
      if (!keywords) return;
      hovered = keywords;
      recompute();
    };
    const onLeave = (event: Event) => {
      if (!keywordsOf(event.target)) return;
      hovered = null;
      recompute();
    };

    window.addEventListener('resize', () => { layout(); recompute(); sync(); });
    window.addEventListener('scroll', () => {
      obstaclesDirty = true;
      if (shouldAnimateConstellation(state, !document.hidden) || introActive || scrollLayoutFrame) return;
      scrollLayoutFrame = requestAnimationFrame(() => {
        scrollLayoutFrame = 0;
        if (shouldAnimateConstellation(state, !document.hidden) || introActive) return;
        layout();
        recompute();
        settleAfterLayout();
      });
    }, { passive: true });
    // Web fonts and late layout change where the text ends up, so measure again once they are in.
    void document.fonts?.ready.then(() => { obstaclesDirty = true; });
    window.addEventListener('pointermove', event => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    }, { passive: true });
    document.documentElement.addEventListener('mouseleave', () => { pointer.x = pointer.y = -9999; });
    window.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('pointercancel', onPointerCancel, { capture: true });
    window.addEventListener('click', onClick, { capture: true });
    document.addEventListener('pointerover', onEnter);
    document.addEventListener('pointerout', onLeave);
    document.addEventListener('focusin', onEnter);
    document.addEventListener('focusout', onLeave);
    document.addEventListener(SKILL_PIN_EVENT, event => {
      const pin = (event as SkillPinEvent).detail.pin;
      pinned = pin ? [...pin.keywords] : null;
      recompute();
    });
    document.addEventListener(CV_QUERY_EVENT, event => {
      query = (event as CustomEvent<string>).detail ?? '';
      recompute();
    });
    document.addEventListener(EGG_REVEAL_EVENT, () => {
      if (frame === 0) return;
      for (let count = 0; count < MAX_PACKETS; count++) spawnPacket();
    });
    document.addEventListener('visibilitychange', sync);
    motion.addEventListener('change', sync);
    motionToggle?.addEventListener('click', () => {
      savedChoice = state === 'paused' ? 'running' : 'paused';
      try {
        window.localStorage.setItem('constellation-motion', savedChoice);
      } catch {
        // The selection still works for this page.
      }
      sync();
    });
    new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

    const visible = new Map<Element, string[]>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const keywords = keywordsOf(entry.target);
        if (entry.isIntersecting && keywords) visible.set(entry.target, keywords);
        else visible.delete(entry.target);
      }
      inView = [...visible.values()].at(-1) ?? null;
      recompute();
    }, { rootMargin: '-35% 0px -55% 0px' });
    document.querySelectorAll('.assignment[data-keywords]').forEach(card => observer.observe(card));

    layout();
    recompute();
    sync();
    // Sticky elements (the table of contents on narrow screens) are only measurable once enhanced.
    deferredLayoutFrame = requestAnimationFrame(() => {
      deferredLayoutFrame = 0;
      if (!shouldAnimateConstellation(state, !document.hidden) && !introActive) return;
      layout();
      recompute();
    });
  }
}
