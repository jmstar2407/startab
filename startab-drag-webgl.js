(() => {
  'use strict';

  class StarTabDragWebGLRenderer {
    constructor() {
      this.canvas = null;
      this.gl = null;
      this.program = null;
      this.buffer = null;
      this.locations = null;
      this.active = false;
      this.frameId = 0;
      this.lastFrame = 0;
      this.lastTrailAt = 0;
      this.pointer = { x: 0, y: 0, px: 0, py: 0 };
      this.targetRect = null;
      this.particles = [];
      this.dpr = 1;
      this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      this.webglAvailable = true;
      this.resize = this.resize.bind(this);
      this.frame = this.frame.bind(this);
    }

    ensure() {
      if (this.reducedMotion || !this.webglAvailable) return false;
      if (this.gl && this.canvas?.isConnected) return true;

      const canvas = document.createElement('canvas');
      canvas.className = 'startab-drag-webgl-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      document.body.appendChild(canvas);

      const gl = canvas.getContext('webgl2', {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance'
      }) || canvas.getContext('webgl', {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance'
      });

      if (!gl) {
        canvas.remove();
        this.webglAvailable = false;
        return false;
      }

      const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
      const vertexShader = isWebGL2 ? `#version 300 es
        in vec2 a_position;
        in float a_size;
        in float a_alpha;
        in vec3 a_color;
        uniform vec2 u_resolution;
        uniform float u_dpr;
        out float v_alpha;
        out vec3 v_color;
        void main() {
          vec2 zeroToOne = a_position / u_resolution;
          vec2 clip = zeroToOne * 2.0 - 1.0;
          gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
          gl_PointSize = max(1.0, a_size * u_dpr);
          v_alpha = a_alpha;
          v_color = a_color;
        }
      ` : `
        attribute vec2 a_position;
        attribute float a_size;
        attribute float a_alpha;
        attribute vec3 a_color;
        uniform vec2 u_resolution;
        uniform float u_dpr;
        varying float v_alpha;
        varying vec3 v_color;
        void main() {
          vec2 zeroToOne = a_position / u_resolution;
          vec2 clip = zeroToOne * 2.0 - 1.0;
          gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
          gl_PointSize = max(1.0, a_size * u_dpr);
          v_alpha = a_alpha;
          v_color = a_color;
        }
      `;

      const fragmentShader = isWebGL2 ? `#version 300 es
        precision mediump float;
        in float v_alpha;
        in vec3 v_color;
        out vec4 outColor;
        void main() {
          vec2 p = gl_PointCoord - vec2(0.5);
          float d = length(p) * 2.0;
          float core = 1.0 - smoothstep(0.0, 1.0, d);
          float halo = 1.0 - smoothstep(0.18, 1.0, d);
          float alpha = (core * 0.42 + halo * 0.58) * v_alpha;
          if (alpha <= 0.003) discard;
          outColor = vec4(v_color, alpha);
        }
      ` : `
        precision mediump float;
        varying float v_alpha;
        varying vec3 v_color;
        void main() {
          vec2 p = gl_PointCoord - vec2(0.5);
          float d = length(p) * 2.0;
          float core = 1.0 - smoothstep(0.0, 1.0, d);
          float halo = 1.0 - smoothstep(0.18, 1.0, d);
          float alpha = (core * 0.42 + halo * 0.58) * v_alpha;
          if (alpha <= 0.003) discard;
          gl_FragColor = vec4(v_color, alpha);
        }
      `;

      const createShader = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          const error = gl.getShaderInfoLog(shader);
          gl.deleteShader(shader);
          throw new Error(error || 'No se pudo compilar el shader WebGL.');
        }
        return shader;
      };

      try {
        const vs = createShader(gl.VERTEX_SHADER, vertexShader);
        const fs = createShader(gl.FRAGMENT_SHADER, fragmentShader);
        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          throw new Error(gl.getProgramInfoLog(program) || 'No se pudo enlazar WebGL.');
        }

        this.canvas = canvas;
        this.gl = gl;
        this.program = program;
        this.buffer = gl.createBuffer();
        this.locations = {
          position: gl.getAttribLocation(program, 'a_position'),
          size: gl.getAttribLocation(program, 'a_size'),
          alpha: gl.getAttribLocation(program, 'a_alpha'),
          color: gl.getAttribLocation(program, 'a_color'),
          resolution: gl.getUniformLocation(program, 'u_resolution'),
          dpr: gl.getUniformLocation(program, 'u_dpr')
        };

        gl.useProgram(program);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.DEPTH_TEST);
        this.resize();
        window.addEventListener('resize', this.resize, { passive: true });
        return true;
      } catch (error) {
        console.warn('StarTab WebGL drag: se usará la animación GPU CSS como respaldo.', error);
        canvas.remove();
        this.canvas = null;
        this.gl = null;
        this.webglAvailable = false;
        return false;
      }
    }

    resize() {
      if (!this.canvas || !this.gl) return;
      this.dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const width = Math.max(1, window.innerWidth);
      const height = Math.max(1, window.innerHeight);
      const pixelWidth = Math.round(width * this.dpr);
      const pixelHeight = Math.round(height * this.dpr);
      if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
        this.canvas.width = pixelWidth;
        this.canvas.height = pixelHeight;
      }
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
      this.gl.viewport(0, 0, pixelWidth, pixelHeight);
    }

    start(x, y, targetRect = null) {
      if (!this.ensure()) return;
      this.active = true;
      this.pointer.x = this.pointer.px = x;
      this.pointer.y = this.pointer.py = y;
      this.targetRect = targetRect;
      this.particles.length = 0;
      this.lastFrame = performance.now();
      this.lastTrailAt = this.lastFrame;
      this.canvas.classList.add('is-active');
      this.spawnBurst(x, y, 10, 0.52, 26, 58);
      this.requestFrame();
    }

    move(x, y, targetRect = null, speed = 0) {
      if (!this.active || !this.gl) return;
      this.pointer.px = this.pointer.x;
      this.pointer.py = this.pointer.y;
      this.pointer.x = x;
      this.pointer.y = y;
      this.targetRect = targetRect;
      const now = performance.now();
      const distance = Math.hypot(x - this.pointer.px, y - this.pointer.py);
      if (distance > 1.5 && now - this.lastTrailAt > 12) {
        const size = Math.min(52, 24 + distance * 0.72 + speed * 0.08);
        this.particles.push({
          x, y,
          vx: (x - this.pointer.px) * -0.055,
          vy: (y - this.pointer.py) * -0.055,
          life: 1,
          decay: 0.052,
          size,
          r: 0.68,
          g: 0.82,
          b: 1.0,
          alpha: 0.17
        });
        this.lastTrailAt = now;
      }
      this.requestFrame();
    }

    pulseRect(rect) {
      if (!this.active || !rect || !this.gl) return;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const count = 9;
      const radius = Math.max(14, Math.min(rect.width, rect.height) * 0.34);
      for (let i = 0; i < count; i += 1) {
        const angle = (Math.PI * 2 * i) / count;
        this.particles.push({
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
          vx: Math.cos(angle) * 0.32,
          vy: Math.sin(angle) * 0.32,
          life: 1,
          decay: 0.085,
          size: 19,
          r: 0.73,
          g: 0.90,
          b: 1.0,
          alpha: 0.22
        });
      }
      this.requestFrame();
    }

    spawnBurst(x, y, count, alpha, minSize, maxSize) {
      for (let i = 0; i < count; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const velocity = 0.18 + Math.random() * 0.62;
        this.particles.push({
          x, y,
          vx: Math.cos(angle) * velocity,
          vy: Math.sin(angle) * velocity,
          life: 1,
          decay: 0.06 + Math.random() * 0.025,
          size: minSize + Math.random() * (maxSize - minSize),
          r: 0.82,
          g: 0.90,
          b: 1.0,
          alpha
        });
      }
    }

    stop(x = this.pointer.x, y = this.pointer.y) {
      if (!this.gl) return;
      this.active = false;
      this.targetRect = null;
      this.spawnBurst(x, y, 12, 0.34, 18, 48);
      this.requestFrame();
    }

    requestFrame() {
      if (!this.frameId) this.frameId = requestAnimationFrame(this.frame);
    }

    frame(now) {
      this.frameId = 0;
      if (!this.gl || !this.canvas) return;
      const dt = Math.min(2.2, Math.max(0.55, (now - this.lastFrame) / 16.667 || 1));
      this.lastFrame = now;

      const points = [];
      const addPoint = (x, y, size, alpha, r, g, b) => {
        points.push(x, y, size, alpha, r, g, b);
      };

      if (this.active) {
        const velocity = Math.hypot(this.pointer.x - this.pointer.px, this.pointer.y - this.pointer.py);
        addPoint(this.pointer.x, this.pointer.y, 72 + Math.min(34, velocity * 1.8), 0.12, 0.72, 0.86, 1.0);
        addPoint(this.pointer.x, this.pointer.y, 24 + Math.min(10, velocity), 0.20, 0.94, 0.97, 1.0);

        if (this.targetRect) {
          const rect = this.targetRect;
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const pulse = 0.5 + 0.5 * Math.sin(now * 0.0105);
          addPoint(cx, cy, Math.max(rect.width, rect.height) * (1.06 + pulse * 0.09), 0.065 + pulse * 0.028, 0.60, 0.84, 1.0);
          addPoint(cx, cy, Math.max(22, Math.min(rect.width, rect.height) * 0.34), 0.10, 0.88, 0.95, 1.0);
        }
      }

      const nextParticles = [];
      for (const particle of this.particles) {
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vx *= Math.pow(0.94, dt);
        particle.vy *= Math.pow(0.94, dt);
        particle.life -= particle.decay * dt;
        if (particle.life <= 0) continue;
        nextParticles.push(particle);
        addPoint(
          particle.x,
          particle.y,
          particle.size * (0.72 + particle.life * 0.28),
          particle.alpha * particle.life * particle.life,
          particle.r,
          particle.g,
          particle.b
        );
      }
      this.particles = nextParticles.slice(-70);

      const gl = this.gl;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      if (points.length) {
        const data = new Float32Array(points);
        gl.useProgram(this.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);

        const stride = 7 * Float32Array.BYTES_PER_ELEMENT;
        gl.enableVertexAttribArray(this.locations.position);
        gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(this.locations.size);
        gl.vertexAttribPointer(this.locations.size, 1, gl.FLOAT, false, stride, 2 * 4);
        gl.enableVertexAttribArray(this.locations.alpha);
        gl.vertexAttribPointer(this.locations.alpha, 1, gl.FLOAT, false, stride, 3 * 4);
        gl.enableVertexAttribArray(this.locations.color);
        gl.vertexAttribPointer(this.locations.color, 3, gl.FLOAT, false, stride, 4 * 4);
        gl.uniform2f(this.locations.resolution, window.innerWidth, window.innerHeight);
        gl.uniform1f(this.locations.dpr, this.dpr);
        gl.drawArrays(gl.POINTS, 0, data.length / 7);
      }

      if (this.active || this.particles.length) {
        this.canvas.classList.add('is-active');
        this.requestFrame();
      } else {
        this.canvas.classList.remove('is-active');
      }
    }
  }

  window.StarTabDragWebGL = new StarTabDragWebGLRenderer();
})();
