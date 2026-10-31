import { EGG_REVEAL_EVENT } from './easter-egg-engine.js';
import { CV_QUERY_EVENT } from './events.js';
import type { ExperienceEngine } from './experience.js';
import {
  buildEdges,
  nodesMatching,
  nodesMatchingQuery,
  parseConstellationData,
  toNodes
} from './skills.js';
import type { SkillEdge, SkillNode } from './skills.js';
import { hoursOf, skyPalette, toCss } from './sky-palette.js';

interface Body extends SkillNode {
  hx: number;
  hy: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  glow: number;
}

interface Packet {
  edge: SkillEdge;
  progress: number;
  speed: number;
  reverse: boolean;
}

const MAX_PIXEL_RATIO = 1.5;
const MAX_PACKETS = 26;
const AMBIENT_GLOW = 0.38;
const DIM_GLOW = 0.07;
const NARROW_VIEWPORT = 700;
const POINTER_RADIUS = 140;
const COLOUR_REFRESH_MS = 30_000;
const TAU = Math.PI * 2;

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
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pointer = { x: -9999, y: -9999 };
    let bodies: Body[] = [];
    let packets: Packet[] = [];
    let focus: Set<number> | null = null;
    let litEdges: SkillEdge[] = [];
    let ambientEdges: SkillEdge[] = edges.filter(edge => edge.strong);
    let query = '';
    let hovered: string[] | null = null;
    let inView: string[] | null = null;
    let width = 0;
    let height = 0;
    let frame = 0;
    let last = 0;
    let colour = '255, 140, 80';
    let colourAt = -COLOUR_REFRESH_MS;

    const refreshColour = (time: number) => {
      colourAt = time;
      colour = root.dataset.theme === 'light'
        ? getComputedStyle(root).getPropertyValue('--particle-rgb').trim() || colour
        : toCss(skyPalette(hoursOf(new Date())).curtain);
    };

    const layout = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      const groupCount = data.groups.length;
      const radius = Math.min(width, height) * (nodes.length > 24 ? 0.17 : 0.21);
      const seen = new Array<number>(groupCount).fill(0);
      bodies = nodes.map(node => {
        const index = seen[node.group]++;
        const groupAngle = (node.group / groupCount) * TAU - Math.PI / 2;
        const centreX = width / 2 + Math.cos(groupAngle) * width * 0.34;
        const centreY = height / 2 + Math.sin(groupAngle) * height * 0.3;
        const angle = (index / data.groups[node.group].skills.length) * TAU + node.group;
        const x = centreX + Math.cos(angle) * radius;
        const y = centreY + Math.sin(angle) * radius;
        return { ...node, hx: x, hy: y, x, y, vx: 0, vy: 0, phase: Math.random() * TAU, glow: AMBIENT_GLOW };
      });
    };

    const targetGlow = (index: number) => focus ? (focus.has(index) ? 1 : DIM_GLOW) : AMBIENT_GLOW;

    const recompute = () => {
      const keywords = hovered ?? inView;
      if (query.trim()) focus = nodesMatchingQuery(nodes, query);
      else if (keywords) focus = nodesMatching(nodes, keywords);
      else focus = null;
      if (focus?.size === 0) focus = null;

      const active = focus;
      litEdges = active ? edges.filter(edge => active.has(edge.a) && active.has(edge.b)) : [];
      ambientEdges = edges.filter(edge => edge.strong);
      if (motion.matches) {
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

    const update = (delta: number, time: number) => {
      for (const body of bodies) {
        const targetX = body.hx + Math.sin(time / 1700 + body.phase) * 9;
        const targetY = body.hy + Math.cos(time / 2100 + body.phase) * 9;
        let forceX = (targetX - body.x) * 0.02;
        let forceY = (targetY - body.y) * 0.02;
        const dx = body.x - pointer.x;
        const dy = body.y - pointer.y;
        const distance = Math.hypot(dx, dy);
        if (distance < POINTER_RADIUS && distance > 0.1) {
          forceX += (dx / distance) * (POINTER_RADIUS - distance) * 0.012;
          forceY += (dy / distance) * (POINTER_RADIUS - distance) * 0.012;
        }
        body.vx = (body.vx + forceX) * 0.86;
        body.vy = (body.vy + forceY) * 0.86;
        body.x += body.vx * delta;
        body.y += body.vy * delta;
      }
      bodies.forEach((body, index) => {
        body.glow += (targetGlow(index) - body.glow) * Math.min(1, 0.08 * delta);
      });
      if (Math.random() < (litEdges.length > 0 ? 0.18 : 0.05) * delta) spawnPacket();
      for (const packet of packets) packet.progress += packet.speed * delta;
      packets = packets.filter(packet => packet.progress < 1);
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      const narrow = width < NARROW_VIEWPORT;

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
        halo.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
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
        context.fillStyle = body.glow > 0.6 ? '#fff' : `rgba(${colour}, ${0.35 + body.glow * 0.5})`;
        context.beginPath();
        context.arc(body.x, body.y, 2.2 + body.glow * 2.8, 0, TAU);
        context.fill();
        if (narrow && body.glow < 0.6) continue;
        context.fillStyle = `rgba(215, 222, 238, ${0.14 + body.glow * 0.8})`;
        context.fillText(body.name, body.x, body.y - 12);
      }
    };

    const step = (time: number) => {
      frame = requestAnimationFrame(step);
      const delta = Math.min((time - last) / 16.67, 3);
      last = time;
      if (time - colourAt > COLOUR_REFRESH_MS) refreshColour(time);
      update(delta, time);
      draw();
    };

    const sync = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      refreshColour(performance.now());
      if (motion.matches || document.hidden) {
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

    window.addEventListener('resize', () => { layout(); recompute(); if (!frame) draw(); });
    window.addEventListener('pointermove', event => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    }, { passive: true });
    document.documentElement.addEventListener('mouseleave', () => { pointer.x = pointer.y = -9999; });
    document.addEventListener('pointerover', onEnter);
    document.addEventListener('pointerout', onLeave);
    document.addEventListener('focusin', onEnter);
    document.addEventListener('focusout', onLeave);
    document.addEventListener(CV_QUERY_EVENT, event => {
      query = (event as CustomEvent<string>).detail ?? '';
      recompute();
    });
    document.addEventListener(EGG_REVEAL_EVENT, () => {
      if (motion.matches) return;
      for (let count = 0; count < MAX_PACKETS; count++) spawnPacket();
    });
    document.addEventListener('visibilitychange', sync);
    motion.addEventListener('change', sync);
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
  }
}
