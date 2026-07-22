import { useEffect, useRef } from "react";

/**
 * Drifting embers — the signature ambient layer of the Ember Command theme.
 * A fixed, pointer-events-none canvas behind all content that renders ~26
 * slow-rising warm particles with a gentle twinkle. Client-only (mounted via
 * useEffect), fully disabled for prefers-reduced-motion users, and paused
 * automatically when the tab is hidden so it never burns battery.
 */
export function Embers() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let raf = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      if (!canvas) return;
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    type Ember = {
      x: number;
      y: number;
      r: number;
      vy: number;
      vx: number;
      tw: number; // twinkle phase
      tws: number; // twinkle speed
      a: number; // base alpha
    };
    const N = 26;
    const embers: Ember[] = Array.from({ length: N }, () => spawn(true));

    function spawn(anywhere: boolean): Ember {
      return {
        x: Math.random() * w,
        y: anywhere ? Math.random() * h : h + 8,
        r: 0.6 + Math.random() * 1.6,
        vy: 0.08 + Math.random() * 0.22,
        vx: (Math.random() - 0.5) * 0.12,
        tw: Math.random() * Math.PI * 2,
        tws: 0.008 + Math.random() * 0.02,
        a: 0.12 + Math.random() * 0.3,
      };
    }

    let running = true;
    function frame() {
      if (!running) return;
      ctx?.clearRect(0, 0, w, h);
      if (!ctx) return;
      for (let i = 0; i < embers.length; i++) {
        const e = embers[i];
        e.y -= e.vy;
        e.x += e.vx + Math.sin(e.tw * 0.7) * 0.05;
        e.tw += e.tws;
        if (e.y < -10 || e.x < -10 || e.x > w + 10) {
          embers[i] = spawn(false);
          continue;
        }
        const alpha = e.a * (0.55 + 0.45 * Math.sin(e.tw));
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(249, 110, 60, ${alpha.toFixed(3)})`;
        ctx.shadowColor = "rgba(201, 166, 72, 0.5)";
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    function onVisibility() {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    }
    document.addEventListener("visibilitychange", onVisibility);

    function onReducedChange() {
      if (reduced.matches) {
        running = false;
        cancelAnimationFrame(raf);
        ctx?.clearRect(0, 0, w, h);
      }
    }
    reduced.addEventListener("change", onReducedChange);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      reduced.removeEventListener("change", onReducedChange);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0"
    />
  );
}
