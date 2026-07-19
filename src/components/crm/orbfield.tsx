import { useEffect, useRef } from "react";

/**
 * OrbField — the live ambient layer behind the lead radar on /discover.
 *
 * Three kinds of life, all in one absolutely-positioned canvas that fills its
 * parent (the ScannerHero card):
 *
 *   - Orbs: a handful of large, soft molten spheres drifting slowly with a
 *     breathing glow. The "lava lamp" backbone of the effect.
 *   - Motes: small bright sparks weaving between the orbs — the same species
 *     as the app-wide embers, but contained inside the card and wrapping at
 *     its edges instead of floating away.
 *   - Rings: expanding sonar circles. While the scan is live one fires every
 *     few seconds; every time the radar actually lands a lead (`pulse`
 *     increments) a brighter one bursts immediately. The page doesn't just
 *     look alive — it visibly reacts to finds.
 *
 * Same hygiene as the Embers layer: client-only, disabled entirely for
 * prefers-reduced-motion, paused when the tab is hidden, DPR-capped, sized by
 * ResizeObserver so it tracks the card, and fully cleaned up on unmount.
 */
export function OrbField({ live, pulse }: { live: boolean; pulse: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  // Live-updating mirrors of the props, so the animation effect mounts once
  // and never tears down/restarts as the scanner state changes around it.
  const liveRef = useRef(live);
  const pulseSeen = useRef(pulse);
  const burstQueue = useRef(0);

  useEffect(() => {
    liveRef.current = live;
  }, [live]);
  useEffect(() => {
    // Each increment of `pulse` (leads found) queues one bright burst ring.
    if (pulse > pulseSeen.current) burstQueue.current += 1;
    pulseSeen.current = pulse;
  }, [pulse]);

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
      const parent = canvas.parentElement;
      if (!parent) return;
      w = parent.clientWidth;
      h = parent.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    // ---- Orbs: big, soft, slow. ----
    type Orb = {
      x: number;
      y: number;
      r: number;
      vx: number;
      vy: number;
      ph: number; // breathing phase
      phs: number; // breathing speed
      a: number; // peak alpha
      warm: boolean; // orange vs deep-red tint
    };
    const orbs: Orb[] = Array.from({ length: 7 }, (_, i) => ({
      x: Math.random() * (w || 800),
      y: Math.random() * (h || 400),
      r: 46 + Math.random() * 110,
      vx: (Math.random() - 0.5) * 0.16,
      vy: (Math.random() - 0.5) * 0.12,
      ph: Math.random() * Math.PI * 2,
      phs: 0.004 + Math.random() * 0.006,
      a: 0.05 + Math.random() * 0.05,
      warm: i % 3 !== 0,
    }));

    // ---- Motes: small bright sparks that wrap at the edges. ----
    type Mote = {
      x: number;
      y: number;
      r: number;
      vx: number;
      vy: number;
      tw: number;
      tws: number;
      a: number;
    };
    const motes: Mote[] = Array.from({ length: 16 }, () => ({
      x: Math.random() * (w || 800),
      y: Math.random() * (h || 400),
      r: 0.7 + Math.random() * 1.5,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.28,
      tw: Math.random() * Math.PI * 2,
      tws: 0.01 + Math.random() * 0.025,
      a: 0.16 + Math.random() * 0.3,
    }));

    // ---- Rings: expanding sonar pulses. ----
    type Ring = { x: number; y: number; r: number; max: number; a: number; bright: boolean };
    const rings: Ring[] = [];
    let nextAmbientRing = 0;

    function spawnRing(bright: boolean) {
      const o = orbs[Math.floor(Math.random() * orbs.length)];
      rings.push({
        x: o.x,
        y: o.y,
        r: 4,
        max: 60 + Math.random() * 90,
        a: bright ? 0.5 : 0.22,
        bright,
      });
    }

    let running = true;
    function frame(now: number) {
      if (!running || !ctx) return;
      ctx.clearRect(0, 0, w, h);
      const isLive = liveRef.current;
      const speed = isLive ? 1.7 : 1;

      // Orbs — additive glow so overlaps go molten instead of muddy.
      ctx.globalCompositeOperation = "lighter";
      for (const o of orbs) {
        o.x += o.vx * speed;
        o.y += o.vy * speed;
        o.ph += o.phs * speed;
        // Soft-bounce: reverse when the center wanders past the edges, so a
        // resize never strands an orb off-canvas forever.
        if (o.x < -o.r * 0.3 || o.x > w + o.r * 0.3) o.vx *= -1;
        if (o.y < -o.r * 0.3 || o.y > h + o.r * 0.3) o.vy *= -1;
        const breathe = 0.7 + 0.3 * Math.sin(o.ph);
        const alpha = o.a * breathe * (isLive ? 1.35 : 1);
        const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
        if (o.warm) {
          g.addColorStop(0, `rgba(249, 110, 60, ${(alpha * 1.0).toFixed(3)})`);
          g.addColorStop(0.55, `rgba(255, 77, 28, ${(alpha * 0.45).toFixed(3)})`);
        } else {
          g.addColorStop(0, `rgba(200, 55, 30, ${(alpha * 1.0).toFixed(3)})`);
          g.addColorStop(0.55, `rgba(150, 40, 25, ${(alpha * 0.45).toFixed(3)})`);
        }
        g.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";

      // Motes.
      for (const m of motes) {
        m.x += (m.vx + Math.sin(m.tw * 0.6) * 0.06) * speed;
        m.y += (m.vy + Math.cos(m.tw * 0.5) * 0.05) * speed;
        m.tw += m.tws;
        if (m.x < -4) m.x = w + 4;
        if (m.x > w + 4) m.x = -4;
        if (m.y < -4) m.y = h + 4;
        if (m.y > h + 4) m.y = -4;
        const alpha = m.a * (0.5 + 0.5 * Math.sin(m.tw));
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 160, 90, ${alpha.toFixed(3)})`;
        ctx.shadowColor = "rgba(255, 77, 28, 0.55)";
        ctx.shadowBlur = 5;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Rings — ambient ones only while live; burst ones whenever queued.
      while (burstQueue.current > 0) {
        burstQueue.current -= 1;
        spawnRing(true);
      }
      if (isLive && now > nextAmbientRing) {
        spawnRing(false);
        nextAmbientRing = now + 2600 + Math.random() * 2600;
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.r += r.bright ? 1.5 : 0.9;
        const t = r.r / r.max;
        if (t >= 1) {
          rings.splice(i, 1);
          continue;
        }
        const alpha = r.a * (1 - t);
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(249, 110, 60, ${alpha.toFixed(3)})`;
        ctx.lineWidth = r.bright ? 1.6 : 1;
        ctx.stroke();
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
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      reduced.removeEventListener("change", onReducedChange);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
