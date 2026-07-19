import { useEffect, useRef } from "react";

/**
 * OrbStage — the whole Discover page, as a living scene.
 *
 * One molten "LEADS" orb burns in the middle. Every teammate floats around it
 * as a named orb on a slow orbit. When the radar lands a lead and assigns it,
 * the center fires a bright lead-orb across the void at that rep's orb — it
 * impacts with a flash ring, the rep's tally ticks up, and the lead's name
 * drifts off the impact point. Unassigned imports burst at the center instead.
 *
 * While the scan is live everything burns brighter and orbits faster; switched
 * off, the scene cools down and idles.
 *
 * Same canvas hygiene as the Embers layer: client-only, static single frame
 * for prefers-reduced-motion, paused when the tab is hidden, DPR-capped,
 * ResizeObserver-sized to its parent, fully cleaned up on unmount.
 */

export type OrbStageEvent = { id: number; lead: string; rep: string | null };

export function OrbStage({
  reps,
  live,
  feed,
}: {
  reps: string[];
  live: boolean;
  feed: OrbStageEvent[];
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  // Live mirrors of props so the animation effect mounts once and never
  // restarts as scanner state changes around it.
  const liveRef = useRef(live);
  const lastEventId = useRef(0);
  const eventQueue = useRef<OrbStageEvent[]>([]);

  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  useEffect(() => {
    // Queue any feed entries we haven't animated yet, newest last.
    for (const ev of feed) {
      if (ev.id > lastEventId.current) {
        eventQueue.current.push(ev);
        lastEventId.current = ev.id;
      }
    }
  }, [feed]);

  // Key the effect on the roster so a changed team rebuilds the scene, but
  // ordinary re-renders never do.
  const rosterKey = reps.join("\u0000");

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const names = rosterKey ? rosterKey.split("\u0000") : [];

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
    const ro = new ResizeObserver(() => {
      resize();
      if (reduced.matches) drawStatic();
    });
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    // ---- Scene state ----
    type Rep = {
      name: string;
      angle: number; // position on the orbit
      wobble: number; // personal bob phase
      count: number; // leads landed on this orb this session
      flash: number; // 1 → 0 impact flash
      x: number;
      y: number;
      r: number;
    };
    const repOrbs: Rep[] = names.map((name, i) => ({
      name,
      angle: (i / Math.max(1, names.length)) * Math.PI * 2 - Math.PI / 2,
      wobble: Math.random() * Math.PI * 2,
      count: 0,
      flash: 0,
      x: 0,
      y: 0,
      r: 30,
    }));

    type Shot = {
      t: number; // 0..1 progress
      speed: number;
      sx: number;
      sy: number;
      curve: number; // sideways bow of the flight path
      target: Rep | null; // null → unassigned, bursts at center
      lead: string;
    };
    const shots: Shot[] = [];

    type Floater = { x: number; y: number; vy: number; a: number; text: string };
    const floaters: Floater[] = [];

    type Ring = { x: number; y: number; r: number; max: number; a: number };
    const rings: Ring[] = [];

    type Mote = { x: number; y: number; r: number; vx: number; vy: number; tw: number; tws: number; a: number };
    const motes: Mote[] = Array.from({ length: 14 }, () => ({
      x: Math.random() * (w || 800),
      y: Math.random() * (h || 500),
      r: 0.6 + Math.random() * 1.4,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.2,
      tw: Math.random() * Math.PI * 2,
      tws: 0.008 + Math.random() * 0.02,
      a: 0.1 + Math.random() * 0.22,
    }));

    let orbit = 0; // global orbit rotation
    let breath = 0; // center orb breathing phase
    let nextIdleSpark = 0;

    const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

    function layout(now: number) {
      const cx = w / 2;
      const cy = h / 2;
      const rx = Math.max(120, w * 0.36);
      const ry = Math.max(100, h * 0.34);
      for (const r of repOrbs) {
        const a = r.angle + orbit;
        r.x = cx + Math.cos(a) * rx;
        r.y = cy + Math.sin(a) * ry + Math.sin(now * 0.0011 + r.wobble) * 6;
      }
    }

    function drawCenter(now: number, dim: number) {
      if (!ctx) return;
      const cx = w / 2;
      const cy = h / 2;
      const isLive = liveRef.current;
      const pulse = 0.85 + 0.15 * Math.sin(breath);
      const R = Math.min(84, Math.max(56, Math.min(w, h) * 0.13)) * pulse;

      ctx.globalCompositeOperation = "lighter";
      // Outer corona
      const halo = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 2.6);
      halo.addColorStop(0, `rgba(249, 110, 60, ${(0.22 * dim).toFixed(3)})`);
      halo.addColorStop(0.5, `rgba(200, 55, 30, ${(0.08 * dim).toFixed(3)})`);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 2.6, 0, Math.PI * 2);
      ctx.fill();
      // Core
      const core = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.25, R * 0.1, cx, cy, R);
      core.addColorStop(0, `rgba(255, 190, 130, ${(0.95 * dim).toFixed(3)})`);
      core.addColorStop(0.45, `rgba(249, 110, 60, ${(0.75 * dim).toFixed(3)})`);
      core.addColorStop(1, `rgba(140, 35, 20, ${(0.35 * dim).toFixed(3)})`);
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";

      // Label
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `800 ${Math.round(R * 0.32)}px ${FONT}`;
      ctx.fillStyle = `rgba(20, 8, 4, ${(0.9 * dim).toFixed(3)})`;
      ctx.fillText("LEADS", cx, cy + 1.5);
      ctx.fillStyle = `rgba(255, 236, 220, ${(0.95 * dim).toFixed(3)})`;
      ctx.fillText("LEADS", cx, cy);

      // Idle sparks so the core smolders even between finds.
      if (isLive && now > nextIdleSpark) {
        nextIdleSpark = now + 1400 + Math.random() * 2200;
        rings.push({ x: cx, y: cy, r: R * 0.9, max: R * 2.2, a: 0.18 });
      }
    }

    function drawRep(rep: Rep, dim: number) {
      if (!ctx) return;
      const flash = rep.flash;
      const R = rep.r + flash * 8;
      ctx.globalCompositeOperation = "lighter";
      const halo = ctx.createRadialGradient(rep.x, rep.y, R * 0.2, rep.x, rep.y, R * 2);
      halo.addColorStop(0, `rgba(249, 110, 60, ${((0.16 + flash * 0.4) * dim).toFixed(3)})`);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(rep.x, rep.y, R * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";

      const g = ctx.createRadialGradient(rep.x - R * 0.25, rep.y - R * 0.3, R * 0.1, rep.x, rep.y, R);
      g.addColorStop(0, `rgba(70, 30, 18, ${(0.95 * dim).toFixed(3)})`);
      g.addColorStop(1, `rgba(24, 10, 6, ${(0.95 * dim).toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(rep.x, rep.y, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(249, 110, 60, ${((0.35 + flash * 0.6) * dim).toFixed(3)})`;
      ctx.stroke();

      // Tally inside the orb.
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${Math.round(R * 0.62)}px ${FONT}`;
      ctx.fillStyle = `rgba(255, 190, 130, ${((0.85 + flash * 0.15) * dim).toFixed(3)})`;
      ctx.fillText(String(rep.count), rep.x, rep.y + 1);

      // Name under the orb.
      ctx.font = `600 12px ${FONT}`;
      ctx.fillStyle = `rgba(255, 226, 205, ${(0.85 * dim).toFixed(3)})`;
      ctx.fillText(rep.name, rep.x, rep.y + R + 15);

      if (rep.flash > 0) rep.flash = Math.max(0, rep.flash - 0.03);
    }

    function spawnShot(ev: OrbStageEvent) {
      const target = ev.rep
        ? repOrbs.find((r) => r.name.toLowerCase() === ev.rep?.toLowerCase()) ?? null
        : null;
      shots.push({
        t: 0,
        speed: 0.008 + Math.random() * 0.004,
        sx: w / 2,
        sy: h / 2,
        curve: (Math.random() - 0.5) * Math.min(w, h) * 0.5,
        target,
        lead: ev.lead,
      });
    }

    function stepShots(dim: number) {
      if (!ctx) return;
      for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i];
        s.t += s.speed * (liveRef.current ? 1 : 1.4);
        const tx = s.target ? s.target.x : s.sx;
        const ty = s.target ? s.target.y : s.sy - 40;
        const t = Math.min(1, s.t);
        // Ease + sideways bow so shots arc instead of tracing straight lines.
        const e = t * t * (3 - 2 * t);
        const px = s.sx + (tx - s.sx) * e + -(ty - s.sy) * 0.0016 * s.curve * Math.sin(Math.PI * t);
        const py = s.sy + (ty - s.sy) * e + (tx - s.sx) * 0.0016 * s.curve * Math.sin(Math.PI * t);

        if (t >= 1) {
          shots.splice(i, 1);
          rings.push({ x: tx, y: ty, r: 6, max: 46, a: 0.5 });
          if (s.target) {
            s.target.count += 1;
            s.target.flash = 1;
            floaters.push({ x: tx, y: ty - s.target.r - 26, vy: -0.25, a: 1, text: s.lead });
          } else {
            floaters.push({ x: tx, y: ty - 18, vy: -0.25, a: 1, text: `${s.lead} → pool` });
          }
          continue;
        }

        ctx.globalCompositeOperation = "lighter";
        // Comet tail
        const tail = ctx.createRadialGradient(px, py, 0, px, py, 16);
        tail.addColorStop(0, `rgba(255, 200, 140, ${(0.8 * dim).toFixed(3)})`);
        tail.addColorStop(0.4, `rgba(249, 110, 60, ${(0.35 * dim).toFixed(3)})`);
        tail.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = tail;
        ctx.beginPath();
        ctx.arc(px, py, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        ctx.beginPath();
        ctx.arc(px, py, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 235, 215, ${(0.95 * dim).toFixed(3)})`;
        ctx.fill();
      }
    }

    function drawStatic() {
      // Reduced motion: one calm, motionless frame so the page isn't blank.
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      orbit = 0;
      layout(0);
      drawCenter(0, 0.9);
      for (const r of repOrbs) drawRep(r, 0.9);
    }

    if (reduced.matches) {
      drawStatic();
      const onChange = () => {
        if (reduced.matches) drawStatic();
      };
      reduced.addEventListener("change", onChange);
      return () => {
        ro.disconnect();
        reduced.removeEventListener("change", onChange);
      };
    }

    let running = true;
    function frame(now: number) {
      if (!running || !ctx) return;
      ctx.clearRect(0, 0, w, h);
      const isLive = liveRef.current;
      const dim = isLive ? 1 : 0.55;
      orbit += isLive ? 0.0012 : 0.0005;
      breath += isLive ? 0.03 : 0.015;

      // Motes
      for (const m of motes) {
        m.x += m.vx;
        m.y += m.vy;
        m.tw += m.tws;
        if (m.x < -4) m.x = w + 4;
        if (m.x > w + 4) m.x = -4;
        if (m.y < -4) m.y = h + 4;
        if (m.y > h + 4) m.y = -4;
        const alpha = m.a * dim * (0.5 + 0.5 * Math.sin(m.tw));
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 160, 90, ${alpha.toFixed(3)})`;
        ctx.fill();
      }

      layout(now);

      // Faint tether lines center → each rep, so the scene reads as one system.
      const cx = w / 2;
      const cy = h / 2;
      for (const r of repOrbs) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(r.x, r.y);
        ctx.strokeStyle = `rgba(249, 110, 60, ${(0.05 * dim + r.flash * 0.12).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      drawCenter(now, dim);
      for (const r of repOrbs) drawRep(r, dim);

      // Fire anything the radar just found.
      while (eventQueue.current.length > 0) {
        const ev = eventQueue.current.shift();
        if (ev) spawnShot(ev);
      }
      stepShots(dim);

      // Impact / idle rings
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.r += 1.1;
        const t = r.r / r.max;
        if (t >= 1) {
          rings.splice(i, 1);
          continue;
        }
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(249, 110, 60, ${(r.a * (1 - t) * dim).toFixed(3)})`;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }

      // Drifting lead-name labels
      for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i];
        f.y += f.vy;
        f.a -= 0.006;
        if (f.a <= 0) {
          floaters.splice(i, 1);
          continue;
        }
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `600 12px ${FONT}`;
        ctx.fillStyle = `rgba(255, 210, 170, ${(f.a * dim).toFixed(3)})`;
        ctx.fillText(f.text, f.x, f.y);
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
        drawStatic();
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
  }, [rosterKey]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
