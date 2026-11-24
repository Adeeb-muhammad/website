/* Original cinematic About atmosphere: a small raymarched WebGL scene. */
const section = document.querySelector('#view-about');
const container = document.querySelector('.about-atmosphere');
const canvas = document.querySelector('#about-atmosphere-canvas');
if (section && container && canvas) initAboutAtmosphere(section, container, canvas);

function initAboutAtmosphere(about, wrap, surface) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = matchMedia('(max-width: 700px)');
  if (reduced.matches) wrap.classList.add('is-static');
  let gl = null, program = null, buffer = null, locations = null;
  let initialized = false, running = false, intersecting = false;
  let lastFrame = 0, raf = 0;

  const fallback = () => {
    wrap.classList.remove('is-animated');
    wrap.classList.add('is-fallback');
    running = false;
    cancelAnimationFrame(raf);
  };

  const shader = (type, source) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'Shader compile failed');
    return sh;
  };

  const init = () => {
    if (initialized) return !wrap.classList.contains('is-fallback');
    initialized = true;
    if (reduced.matches) { wrap.classList.add('is-static'); return false; }
    try {
      gl = surface.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
      if (!gl) throw new Error('WebGL is unavailable');
      const vs = shader(gl.VERTEX_SHADER, `
        attribute vec2 aPosition;
        void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
      `);
      const fs = shader(gl.FRAGMENT_SHADER, `
        precision highp float;
        uniform vec2 uResolution;
        uniform float uTime;
        uniform float uSteps;

        float hash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float sphere(vec3 p, float r) { return length(p) - r; }
        float torus3(vec3 p, vec2 t) { vec2 q = vec2(length(p.xz) - t.x, p.y); return length(q) - t.y; }
        float smin(float a, float b, float k) {
          float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
          return mix(b, a, h) - k * h * (1.0 - h);
        }
        float field(vec3 p) {
          float t = uTime * 0.16;
          vec3 q = p;
          q.x += sin(p.y * 1.45 + t) * 0.18;
          q.y += cos(p.z * 1.15 - t * 0.8) * 0.15;
          q.z += sin(p.x * 1.05 + t * 0.65) * 0.12;
          float d = sphere(q - vec3(-1.12 + sin(t * 0.7) * 0.28, 0.28 + cos(t * 0.9) * 0.2, 0.0), 1.04);
          d = smin(d, sphere(q - vec3(1.1 + cos(t * 0.6) * 0.24, -0.34 + sin(t * 0.8) * 0.18, 0.34), 0.82), 0.58);
          d = smin(d, sphere(q - vec3(0.18, 0.9 + sin(t * 0.52) * 0.14, -0.38), 0.58), 0.5);
          d = smin(d, sphere(q - vec3(0.06, -0.78 + cos(t * 0.72) * 0.16, -0.2), 0.5), 0.46);
          vec3 ring = q - vec3(0.08, 0.02, 0.0);
          float ringAngle = 0.72 + sin(t * 0.34) * 0.09;
          ring.yz = mat2(cos(ringAngle), -sin(ringAngle), sin(ringAngle), cos(ringAngle)) * ring.yz;
          d = smin(d, torus3(ring, vec2(1.68, 0.052)), 0.38);
          float ripple = sin(q.x * 3.1 + t * 1.25) * sin(q.y * 3.65 - t) * sin(q.z * 3.0 + t * 0.55);
          return d + ripple * 0.07;
        }
        vec3 normalAt(vec3 p) {
          vec2 e = vec2(0.0015, 0.0);
          return normalize(vec3(
            field(p + e.xyy) - field(p - e.xyy),
            field(p + e.yxy) - field(p - e.yxy),
            field(p + e.yyx) - field(p - e.yyx)
          ));
        }
        float march(vec3 ro, vec3 rd) {
          float t = 0.0;
          for (int i = 0; i < 64; i++) {
            if (float(i) >= uSteps) break;
            float d = field(ro + rd * t);
            if (d < 0.0012) return t;
            if (t > 18.0) break;
            t += max(0.02, d * 0.86);
          }
          return -1.0;
        }
        void main() {
          vec2 uv = (gl_FragCoord.xy * 2.0 - uResolution) / uResolution.y;
          vec3 ro = vec3(sin(uTime * 0.11) * 0.13, cos(uTime * 0.14) * 0.08, 5.35);
          vec3 rd = normalize(vec3(uv, -1.52));
          vec3 col = mix(vec3(0.034, 0.036, 0.03), vec3(0.009, 0.01, 0.009), smoothstep(0.0, 1.25, length(uv * 0.8)));
          col += vec3(0.17, 0.16, 0.035) * exp(-4.2 * length(uv - vec2(-0.62, 0.24)));
          col += vec3(0.035, 0.09, 0.04) * exp(-5.2 * length(uv - vec2(0.78, -0.18)));
          float t = march(ro, rd);
          if (t > 0.0) {
            vec3 p = ro + rd * t;
            vec3 n = normalAt(p);
            vec3 v = -rd;
            vec3 key = normalize(vec3(-0.62, 0.82, 0.72));
            vec3 fill = normalize(vec3(0.84, -0.24, 0.44));
            float diffuse = max(dot(n, key), 0.0);
            float fillDiffuse = max(dot(n, fill), 0.0);
            float fresnel = pow(1.0 - max(dot(n, v), 0.0), 2.15);
            vec3 halfDir = normalize(key + v);
            float specular = pow(max(dot(n, halfDir), 0.0), 46.0);
            vec3 r = reflect(rd, n);
            float rim = pow(1.0 - max(dot(n, v), 0.0), 1.35);
            vec3 body = vec3(0.038, 0.04, 0.034);
            body += vec3(0.19, 0.16, 0.09) * diffuse;
            body += vec3(0.035, 0.105, 0.055) * fillDiffuse;
            body += vec3(0.9, 0.96, 0.42) * specular * 0.72;
            body += vec3(0.54, 0.63, 0.16) * rim * 0.24;
            body += vec3(0.08, 0.09, 0.035) * smoothstep(-0.4, 0.9, r.y);
            col = mix(col, body, 0.94);
            col += vec3(0.5, 0.6, 0.15) * exp(-0.26 * t) * 0.07;
          }
          float vignette = 0.72 + 0.28 * smoothstep(1.35, 0.2, length(uv));
          col *= vignette;
          col += (hash(gl_FragCoord.xy + uTime * 0.35) - 0.5) * 0.014;
          gl_FragColor = vec4(max(col, 0.0), 1.0);
        }
      `);
      program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Shader link failed');
      gl.useProgram(program);
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'aPosition');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      locations = {
        resolution: gl.getUniformLocation(program, 'uResolution'),
        time: gl.getUniformLocation(program, 'uTime'),
        steps: gl.getUniformLocation(program, 'uSteps'),
      };
      wrap.classList.remove('is-fallback', 'is-static');
      wrap.classList.add('is-animated');
      return true;
    } catch {
      fallback();
      return false;
    }
  };

  const resize = () => {
    if (!gl) return;
    const rect = wrap.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const narrow = mobile.matches;
    const dpr = Math.min(devicePixelRatio || 1, narrow ? 1.15 : 1.5);
    const scale = narrow ? 0.52 : 0.72;
    const width = Math.max(1, Math.min(1100, Math.round(rect.width * scale * dpr)));
    const height = Math.max(1, Math.min(900, Math.round(rect.height * scale * dpr)));
    if (surface.width !== width || surface.height !== height) {
      surface.width = width;
      surface.height = height;
      gl.viewport(0, 0, width, height);
    }
    gl.uniform2f(locations.resolution, width, height);
    gl.uniform1f(locations.steps, narrow ? 34 : 56);
  };

  const draw = (now) => {
    const seconds = now * 0.001;
    gl.uniform1f(locations.time, seconds);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  const frame = (now) => {
    if (!running) return;
    const interval = mobile.matches ? 1000 / 30 : 1000 / 45;
    if (now - lastFrame >= interval) {
      lastFrame = now;
      resize();
      draw(now);
    }
    raf = requestAnimationFrame(frame);
  };

  const start = () => {
    if (running || document.hidden || !init()) return;
    running = true;
    wrap.classList.add('is-animated');
    lastFrame = 0;
    resize();
    raf = requestAnimationFrame(frame);
  };

  const stop = () => {
    running = false;
    cancelAnimationFrame(raf);
    wrap.classList.remove('is-animated');
  };

  const inViewport = () => {
    const rect = about.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < innerHeight;
  };

  const sync = () => {
    if (!about.hidden && !document.hidden && !reduced.matches && (intersecting || inViewport())) start();
    else stop();
  };

  const intersection = new IntersectionObserver((entries) => {
    intersecting = entries.some((entry) => entry.isIntersecting);
    sync();
  }, { threshold: 0.01 });
  intersection.observe(about);

  new MutationObserver(sync).observe(about, { attributes: true, attributeFilter: ['hidden', 'class'] });
  document.addEventListener('visibilitychange', sync);
  new ResizeObserver(() => { if (running) resize(); }).observe(wrap);
  reduced.addEventListener?.('change', () => {
    if (reduced.matches) {
      stop();
      wrap.classList.remove('is-animated');
      wrap.classList.add('is-static');
    } else {
      wrap.classList.remove('is-static');
      initialized = false;
      sync();
    }
  });
  surface.addEventListener('webglcontextlost', (event) => { event.preventDefault(); fallback(); });
  sync();
  requestAnimationFrame(sync);
}
