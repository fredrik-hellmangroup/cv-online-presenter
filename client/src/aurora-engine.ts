import type { ExperienceEngine } from './experience.js';
import { hoursOf, skyPalette } from './sky-palette.js';

const VERTEX = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 r,m;uniform float t,s;uniform vec3 c1,c2;
float h(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*n(p);p=p*2.03+vec2(7.1,3.7);a*=.5;}return v;}
void main(){
  vec2 uv=gl_FragCoord.xy/r;vec2 p=(gl_FragCoord.xy-.5*r)/min(r.x,r.y);
  p+=(m-.5)*.18;p.y+=s*.25;float tt=t*.06;
  vec2 q=vec2(fbm(p*1.2+tt),fbm(p*1.2+vec2(5.2,1.3)-tt));
  vec2 w=vec2(fbm(p*1.4+3.5*q+vec2(1.7,9.2)+tt*1.4),fbm(p*1.4+3.5*q+vec2(8.3,2.8)-tt));
  float f=fbm(p*1.2+2.8*w);
  float ribbon=.58+.2*sin(p.x*2.4+tt*5.+w.x*3.5);
  float curtain=pow(max(0.,1.-abs(uv.y-ribbon)*2.1),2.2);
  float haze=smoothstep(.25,.95,f);
  vec3 col=vec3(.02,.03,.07)+c1*curtain*(.35+f*1.1)+c2*haze*.32*(1.-uv.y*.6);
  col*=1.-.55*length(uv-.5);
  gl_FragColor=vec4(clamp(col,0.,1.),1.);
}`;

const RENDER_SCALE = 0.45;
const FRAME_INTERVAL_MS = 1000 / 30;
const STILL_TIME_SECONDS = 20;

const compile = (gl: WebGLRenderingContext): WebGLProgram | null => {
  const shader = (type: number, source: string) => {
    const handle = gl.createShader(type);
    if (!handle) return null;
    gl.shaderSource(handle, source);
    gl.compileShader(handle);
    return gl.getShaderParameter(handle, gl.COMPILE_STATUS) ? handle : null;
  };
  const vertex = shader(gl.VERTEX_SHADER, VERTEX);
  const fragment = shader(gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
};

/** A faint, slowly moving northern-light shader whose colours follow the local time of day. */
export class AuroraEngine implements ExperienceEngine {
  readonly id = 'aurora';

  start(): void {
    const canvas = document.querySelector<HTMLCanvasElement>('#aurora-field');
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { antialias: false, powerPreference: 'low-power' });
    const program = gl ? compile(gl) : null;
    if (!gl || !program) {
      canvas.remove();
      return;
    }

    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uniform = (name: string) => gl.getUniformLocation(program, name);
    const [resolution, mouse, time, scroll, curtain, glow] = ['r', 'm', 't', 's', 'c1', 'c2'].map(uniform);

    const root = document.documentElement;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pointer = { x: 0.5, y: 0.5 };
    let scrollAmount = 0;
    let frame = 0;
    let lastDraw = 0;

    const isLight = () => root.dataset.theme === 'light';

    const draw = (seconds: number) => {
      const palette = skyPalette(hoursOf(new Date()));
      gl.uniform2f(resolution, canvas.width, canvas.height);
      gl.uniform2f(mouse, pointer.x, 1 - pointer.y);
      gl.uniform1f(time, seconds);
      gl.uniform1f(scroll, scrollAmount);
      gl.uniform3f(curtain, ...palette.curtain);
      gl.uniform3f(glow, ...palette.glow);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const loop = (timestamp: number) => {
      frame = requestAnimationFrame(loop);
      if (timestamp - lastDraw < FRAME_INTERVAL_MS) return;
      lastDraw = timestamp;
      draw(timestamp / 1000);
    };

    const sync = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (isLight()) return;
      if (motion.matches || document.hidden) {
        draw(STILL_TIME_SECONDS);
        return;
      }
      frame = requestAnimationFrame(loop);
    };

    const resize = () => {
      canvas.width = Math.max(2, Math.round(window.innerWidth * RENDER_SCALE));
      canvas.height = Math.max(2, Math.round(window.innerHeight * RENDER_SCALE));
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (!frame && !isLight()) draw(STILL_TIME_SECONDS);
    };

    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      cancelAnimationFrame(frame);
      canvas.remove();
    });
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', event => {
      pointer.x = event.clientX / window.innerWidth;
      pointer.y = event.clientY / window.innerHeight;
    }, { passive: true });
    window.addEventListener('scroll', () => {
      const range = document.documentElement.scrollHeight - window.innerHeight;
      scrollAmount = range > 0 ? window.scrollY / range : 0;
    }, { passive: true });
    document.addEventListener('visibilitychange', sync);
    motion.addEventListener('change', sync);
    new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

    resize();
    sync();
  }
}
