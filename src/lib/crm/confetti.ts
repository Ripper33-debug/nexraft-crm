// Dependency-free confetti burst for celebratory moments (a won deal). Renders a
// throwaway full-screen canvas, runs a short particle simulation, then cleans
// itself up. Safe to call from anywhere on the client; a no-op on the server.

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  vrot: number;
  color: string;
  shape: "rect" | "circle";
};

const COLORS = ["#2dd4bf", "#14b8a6", "#38bdf8", "#f59e0b", "#a855f7", "#e8ede9", "#34d399"];

let running = false;

export function fireConfetti(): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  // Respect users who prefer reduced motion.
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (running) return;
  running = true;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:120";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    running = false;
    return;
  }

  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  // Two side cannons firing toward the centre, plus a light center fountain.
  const particles: Particle[] = [];
  const spawn = (originX: number, angleDeg: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const angle = (angleDeg + (Math.random() * 40 - 20)) * (Math.PI / 180);
      const speed = 8 + Math.random() * 8;
      particles.push({
        x: originX,
        y: H * 0.62,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 5 + Math.random() * 6,
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 0.3,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        shape: Math.random() > 0.5 ? "rect" : "circle",
      });
    }
  };
  spawn(W * 0.12, -70, 70);
  spawn(W * 0.88, -110, 70);
  spawn(W * 0.5, -90, 40);

  const gravity = 0.22;
  const drag = 0.992;
  const start = performance.now();
  const life = 2600;

  const frame = (now: number) => {
    const elapsed = now - start;
    ctx.clearRect(0, 0, W, H);
    const fade = Math.max(0, 1 - Math.max(0, elapsed - 1600) / 1000);

    for (const p of particles) {
      p.vx *= drag;
      p.vy = p.vy * drag + gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vrot;

      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === "rect") {
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    if (elapsed < life) {
      requestAnimationFrame(frame);
    } else {
      canvas.remove();
      running = false;
    }
  };
  requestAnimationFrame(frame);
}
