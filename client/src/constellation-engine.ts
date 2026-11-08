import { EGG_REVEAL_EVENT } from './easter-egg-engine.js';
import { CV_QUERY_EVENT, SKILL_PIN_EVENT, type SkillPinEvent } from './events.js';
import type { ExperienceEngine } from './experience.js';
import {
  LABEL_HEIGHT,
  LABEL_PADDING,
  PROBE_OFFSET,
  WOBBLE,
  clampRange,
  effectiveObstacles,
  exitVector,
  scatterPoint
} from './constellation-layout.js';
import type { Area } from './constellation-layout.js';
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
  buildEdges,
  nodesMatching,
  nodesMatchingQuery,
  parseConstellationData,
  toNodes
} from './skills.js';
import type { SkillEdge, SkillNode } from './skills.js';

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
}

interface Packet {
  edge: SkillEdge;
  progress: number;
  speed: number;
  reverse: boolean;
}

const MAX_PIXEL_RATIO = 1.5;
const MAX_PACKETS = 40;
const AMBIENT_GLOW = 0.38;
const DIM_GLOW = 0.07;
const NARROW_VIEWPORT = 700;
const NARROW_LABEL_ALPHA = 0.34;
const POINTER_RADIUS = 190;
// Ambient dust reacts to the cursor and to highlighted technologies within these distances.
const MOTE_POINTER_RADIUS = 160;
const MOTE_LIT_RADIUS = 170;
// Technology nodes are always larger than the dust (MOTE_MAX_RADIUS) and grow further when highlighted.
const NODE_BASE_RADIUS = 4;
const NODE_GLOW_RADIUS = 3.6;
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
const SURFACE_SELECTOR = '.project-card, .assignment, .skill-group, .contact-card, .git-graph, .cv-figures > div, '
  + '.page-hero-panel, .practical > div, .project-facts > div, .project-detail > section, .service-cv-cta, .cv-toc';
const OVERLAP_ALLOWED = 8;
const OBSTACLE_PUSH = 0.018;
const RETARGET_COOLDOWN_MS = 3000;
const OBSTACLE_REFRESH_MS = 600;
const OBSTACLE_REFRESH_WHILE_SCROLLING_MS = 60;
// Every technology now and then picks a new place and glides there slowly.
const RETARGET_MIN_MS = 20000;
const RETARGET_SPREAD_MS = 40000;
const HOME_EASE = 0.005;

export type MotionState = 'running' | 'paused' | 'reduced';

export const resolveMotionState = (reducedMotion: boolean, saved: string | null, viewportWidth: number): MotionState => {
  if (reducedMotion) return 'reduced';
  if (saved === 'paused' || saved === 'running') return saved;
  return viewportWidth < NARROW_VIEWPORT ? 'paused' : 'running';
};

export const shouldAnimateConstellation = (state: MotionState, documentVisible: boolean): boolean =>
  state === 'running' && documentVisible;

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

    const edges = buildEdges(nodes, data.assignments);
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
    let state: MotionState = 'running';
    const pointer = { x: -9999, y: -9999 };
    let bodies: Body[] = [];
    let packets: Packet[] = [];
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

    // On a narrow screen the text and cards cover nearly all of the viewport, so there is no clear space to steer
    // the technologies towards: they simply float behind the content.
    const isNarrow = () => width < NARROW_VIEWPORT;

    // The visible text (measured tightly around the letters) and the cards that cover the background right now.
    const refreshObstacles = (time: number) => {
      lastObstacleRefresh = time;
      obstaclesDirty = false;
      if (isNarrow()) {
        obstacles = [];
        return;
      }
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
    };

    const areaWidth = () => area.right - area.left;
    const areaHeight = () => area.bottom - area.top;

    const homeOf = (body: Pick<Body, 'u' | 'v' | 'half'>): { hx: number; hy: number } => ({
      hx: clampRange(area.left + body.u * areaWidth(), area.left + body.half + WOBBLE, area.right - body.half - WOBBLE),
      hy: clampRange(area.top + body.v * areaHeight(), area.top + LABEL_HEIGHT + WOBBLE, area.bottom - WOBBLE)
    });

    const share = (point: { x: number; y: number }) => ({
      u: areaWidth() > 0 ? (point.x - area.left) / areaWidth() : 0.5,
      v: areaHeight() > 0 ? (point.y - area.top) / areaHeight() : 0.5
    });

    // A new destination for one technology: random, clear of text, and away from where the others are heading.
    const retarget = (index: number) => {
      const body = bodies[index];
      const others = bodies.filter((_, other) => other !== index).map(other => homeOf({ u: other.tu, v: other.tv, half: other.half }))
        .map(home => ({ x: home.hx, y: home.hy }));
      const { u, v } = share(scatterPoint(area, body.half, obstacles, others));
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
      context.font = '600 13px "Segoe UI", system-ui, sans-serif';

      area = { left: SIDE_INSET, top: stickyTop() + TOP_GAP, right: width - SIDE_INSET, bottom: height - BOTTOM_INSET };
      refreshObstacles(performance.now());
      motes = createMotes(moteCount(width, height), width, height);
      const previous = bodies;
      const taken: { x: number; y: number }[] = [];
      bodies = nodes.map((node, index) => {
        const half = context.measureText(node.name).width / 2 + LABEL_PADDING;
        const earlier = previous[index];
        // A fresh page load scatters the technologies at random; a resize keeps the places they already had.
        const { u, v } = earlier ?? share(scatterPoint(area, half, obstacles, taken));
        const { hx, hy } = homeOf({ u, v, half });
        taken.push({ x: hx, y: hy });
        return {
          ...node, u, v, tu: earlier?.tu ?? u, tv: earlier?.tv ?? v, nextMove: earlier?.nextMove ?? 0, coolUntil: 0,
          hx, hy, x: hx, y: hy, vx: 0, vy: 0, phase: Math.random() * TAU, glow: ambientGlow, boost: 0, half
        };
      });
    };

    const targetGlow = (index: number) => {
      if (focus) return focus.has(index) ? 1 : DIM_GLOW;
      return Math.max(ambientGlow, bodies[index]?.boost ?? 0);
    };

    const recompute = () => {
      const keywords = hovered ?? pinned ?? inView ?? pageKeywords;
      if (query.trim()) focus = nodesMatchingQuery(nodes, query);
      else if (keywords) focus = nodesMatching(nodes, keywords);
      else focus = null;
      if (focus?.size === 0) focus = null;

      const active = focus;
      litEdges = active ? edges.filter(edge => active.has(edge.a) && active.has(edge.b)) : [];
      ambientEdges = edges.filter(edge => edge.strong);
      if (frame === 0) {
        bodies.forEach((body, index) => { body.glow = targetGlow(index); });
        draw();
      }
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

    const shockwave = (event: PointerEvent) => {
      if (frame === 0 || (event.target instanceof Element && event.target.closest('a, button, input, textarea, select'))) return;
      for (const body of bodies) {
        const dx = body.x - event.clientX;
        const dy = body.y - event.clientY;
        const distance = Math.hypot(dx, dy);
        if (distance > SHOCK_RADIUS || distance < 0.1) continue;
        const push = (1 - distance / SHOCK_RADIUS) * 14;
        body.vx += (dx / distance) * push;
        body.vy += (dy / distance) * push;
        body.boost = 1;
      }
      for (let count = 0; count < 8; count++) spawnPacket();
    };

    const update = (delta: number, time: number) => {
      if (playful) updatePlay(time);
      driftMotes(motes, delta, width, height);
      repelMotes(motes, pointer.x, pointer.y, MOTE_POINTER_RADIUS);
      if (time - lastObstacleRefresh > (obstaclesDirty ? OBSTACLE_REFRESH_WHILE_SCROLLING_MS : OBSTACLE_REFRESH_MS)) refreshObstacles(time);
      bodies.forEach((body, index) => {
        if (time >= body.nextMove) {
          if (body.nextMove > 0) retarget(index);
          body.nextMove = time + RETARGET_MIN_MS + Math.random() * RETARGET_SPREAD_MS;
        }
        // Text scrolled over the destination: pick another place right away (but not every frame).
        const destination = homeOf({ u: body.tu, v: body.tv, half: body.half });
        if (time >= body.coolUntil && exitVector(destination.hx, destination.hy - PROBE_OFFSET, obstacles)) {
          retarget(index);
          body.coolUntil = time + RETARGET_COOLDOWN_MS;
        }
        body.u += (body.tu - body.u) * HOME_EASE * delta;
        body.v += (body.tv - body.v) * HOME_EASE * delta;
        Object.assign(body, homeOf(body));
      });
      for (const body of bodies) {
        const targetX = body.hx
          + Math.sin(time / 1700 + body.phase) * WOBBLE * 1.8
          + Math.cos(time / 4300 + body.phase * 1.7) * 14
          + Math.sin(time / 7200) * 16;
        const targetY = body.hy
          + Math.cos(time / 2100 + body.phase) * WOBBLE * 1.8
          + Math.sin(time / 5100 + body.phase * 1.3) * 12
          + Math.cos(time / 8300) * 12;
        let forceX = (targetX - body.x) * 0.02;
        let forceY = (targetY - body.y) * 0.02;
        // Technologies under a text block or a card are nudged out to its nearest edge.
        const exit = exitVector(body.x, body.y - PROBE_OFFSET, obstacles);
        if (exit) {
          forceX += exit.dx * OBSTACLE_PUSH;
          forceY += exit.dy * OBSTACLE_PUSH;
        }
        const dx = body.x - pointer.x;
        const dy = body.y - pointer.y;
        const distance = Math.hypot(dx, dy);
        if (distance < POINTER_RADIUS && distance > 0.1) {
          forceX += (dx / distance) * (POINTER_RADIUS - distance) * 0.012;
          forceY += (dy / distance) * (POINTER_RADIUS - distance) * 0.012;
        }
        body.vx = (body.vx + forceX) * 0.86;
        body.vy = (body.vy + forceY) * 0.86;
        body.x = clampRange(body.x + body.vx * delta, area.left + body.half, area.right - body.half);
        body.y = clampRange(body.y + body.vy * delta, area.top + LABEL_HEIGHT, area.bottom);
      }
      bodies.forEach((body, index) => {
        body.glow += (targetGlow(index) - body.glow) * Math.min(1, 0.08 * delta);
      });
      if (Math.random() < (litEdges.length > 0 ? 0.18 : 0.05) * delta) spawnPacket();
      for (const packet of packets) packet.progress += packet.speed * delta;
      packets = packets.filter(packet => packet.progress < 1);
    };

    // Background dust: it links up faintly, twinkles, and lights up near the cursor and near highlighted technologies.
    const drawMotes = () => {
      const lit = bodies.filter(body => body.glow > 0.6);
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
      // Behind the content of a narrow screen the labels need a little more strength than on a wide one to be read.
      const restingLabelAlpha = isNarrow() ? Math.max(labelAlpha, NARROW_LABEL_ALPHA) : labelAlpha;
      drawMotes();

      for (const edge of edges) {
        const from = bodies[edge.a];
        const to = bodies[edge.b];
        const lit = Math.min(from.glow, to.glow);
        const alpha = edge.strong ? 0.05 + lit * 0.5 : 0.03 + lit * 0.18;
        context.strokeStyle = `rgba(${colour}, ${alpha})`;
        context.lineWidth = edge.strong && lit > 0.6 ? 1.4 : 1;
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
        context.stroke();
      }

      for (const packet of packets) {
        const from = bodies[packet.edge.a];
        const to = bodies[packet.edge.b];
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

      context.font = '600 13px "Segoe UI", system-ui, sans-serif';
      context.textAlign = 'center';
      for (const body of bodies) {
        if (body.glow > 0.3) {
          const halo = context.createRadialGradient(body.x, body.y, 0, body.x, body.y, 28);
          halo.addColorStop(0, `rgba(${colour}, ${body.glow * 0.5})`);
          halo.addColorStop(1, `rgba(${colour}, 0)`);
          context.fillStyle = halo;
          context.beginPath();
          context.arc(body.x, body.y, 28, 0, TAU);
          context.fill();
        }
        context.fillStyle = body.glow > 0.6 ? `rgb(${coreColour})` : `rgba(${colour}, ${0.35 + body.glow * 0.5})`;
        context.beginPath();
        context.arc(body.x, body.y, NODE_BASE_RADIUS + body.glow * NODE_GLOW_RADIUS, 0, TAU);
        context.fill();
        context.fillStyle = `rgba(${labelColour}, ${Math.min(1, restingLabelAlpha + body.glow * 0.8)})`;
        context.fillText(body.name, body.x, body.y - 12);
      }
    };

    const step = (time: number) => {
      frame = requestAnimationFrame(step);
      const delta = Math.min((time - last) / 16.67, 3);
      last = time;
      frameTime = time;
      update(delta, time);
      draw();
    };

    const sync = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      state = resolveMotionState(motion.matches, savedChoice, window.innerWidth);
      root.dataset.constellationMotion = state;
      if (motionToggle) {
        motionToggle.hidden = state === 'reduced';
        motionToggle.setAttribute('aria-pressed', String(state === 'paused'));
      }
      refreshColour();
      if (!shouldAnimateConstellation(state, !document.hidden)) {
        bodies.forEach((body, index) => { body.glow = targetGlow(index); });
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
    window.addEventListener('scroll', () => { obstaclesDirty = true; }, { passive: true });
    // Web fonts and late layout change where the text ends up, so measure again once they are in.
    void document.fonts?.ready.then(() => { obstaclesDirty = true; });
    window.addEventListener('pointermove', event => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    }, { passive: true });
    document.documentElement.addEventListener('mouseleave', () => { pointer.x = pointer.y = -9999; });
    if (playful) window.addEventListener('pointerdown', shockwave, { passive: true });
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
    requestAnimationFrame(() => { layout(); recompute(); });
  }
}
