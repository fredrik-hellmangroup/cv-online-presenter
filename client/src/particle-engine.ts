import type { ExperienceEngine } from './experience.js';
import { EGG_REVEAL_EVENT } from './easter-egg-engine.js';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

const MAX_PIXEL_RATIO = 2;
const MIN_PARTICLES = 24;
const MAX_PARTICLES = 90;
const LINK_DISTANCE = 150;
const POINTER_DISTANCE = 190;

export class ParticleEngine implements ExperienceEngine {
  readonly id = 'particles';

  start(): void {
    const canvas = document.querySelector<HTMLCanvasElement>('#particle-field');
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const root = document.documentElement;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let particles: Particle[] = [];
    let width = 0;
    let height = 0;
    let ratio = 1;
    let rgb = '255, 140, 80';
    let boost = 0;
    let frame = 0;
    let last = 0;
    const pointer = { x: -9999, y: -9999 };

    const readColor = () => {
      rgb = getComputedStyle(root).getPropertyValue('--particle-rgb').trim() || rgb;
    };

    const seed = () => {
      const count = Math.min(MAX_PARTICLES, Math.max(MIN_PARTICLES, Math.round((width * height) / 18000)));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        r: 1 + Math.random() * 1.6
      }));
    };

    const resize = () => {
      ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      seed();
      draw();
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        context.fillStyle = `rgba(${rgb}, 0.85)`;
        context.beginPath();
        context.arc(a.x, a.y, a.r, 0, Math.PI * 2);
        context.fill();
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j];
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          if (distance > LINK_DISTANCE) continue;
          context.strokeStyle = `rgba(${rgb}, ${0.28 * (1 - distance / LINK_DISTANCE)})`;
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(a.x, a.y);
          context.lineTo(b.x, b.y);
          context.stroke();
        }
        const pointerDistance = Math.hypot(a.x - pointer.x, a.y - pointer.y);
        if (pointerDistance < POINTER_DISTANCE) {
          context.strokeStyle = `rgba(${rgb}, ${0.55 * (1 - pointerDistance / POINTER_DISTANCE)})`;
          context.beginPath();
          context.moveTo(a.x, a.y);
          context.lineTo(pointer.x, pointer.y);
          context.stroke();
        }
      }
    };

    const step = (time: number) => {
      const delta = Math.min((time - last) / 16.67, 3);
      last = time;
      const speed = 1 + boost;
      boost = Math.max(0, boost - 0.02 * delta);
      for (const p of particles) {
        p.x += p.vx * delta * speed;
        p.y += p.vy * delta * speed;
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;
      }
      draw();
      frame = requestAnimationFrame(step);
    };

    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };

    const run = () => {
      stop();
      if (motion.matches || document.hidden) {
        draw();
        return;
      }
      last = performance.now();
      frame = requestAnimationFrame(step);
    };

    readColor();
    resize();
    run();

    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', event => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    }, { passive: true });
    document.documentElement.addEventListener('mouseleave', () => { pointer.x = pointer.y = -9999; });
    document.addEventListener('visibilitychange', run);
    motion.addEventListener('change', run);
    document.addEventListener(EGG_REVEAL_EVENT, () => { boost = 6; });
    new MutationObserver(() => { readColor(); if (!frame) draw(); })
      .observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-calendar-layer'] });
  }
}
