import { useEffect, useRef } from "react";

/**
 * OrbStage — the whole Discover page, as a living scene.
 *
 * A molten "LEADS" star burns in the middle of a slow starfield, wrapped in a
 * rotating flare ring. Every teammate rides the orbit ring around it as a
 * rim-lit orb with their name and session tally. Energy motes stream along the
 * tethers from the core out to each rep. When the radar lands a lead, the core
 * fires a spark-trailing comet at the assigned rep — it detonates in a particle
 * burst, the tally ticks up, and the lead's name drifts off the impact.
 *
 * Live: everything burns hot and spins faster. Off: the system cools and idles.
 *
 * Canvas hygiene (same as the Embers layer): client-only, a static frame for
 * prefers-reduced-motion, paused when the tab is hidden, DPR capped at 2,
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
      seedStars();
      if (reduced.matches) drawStatic();
    });
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    // ---- Scene state ----
    type Rep = {
      name: string;
      angle: number;
      wobble: number;
      count: number;
      flash: number; // 1 → 0 impact flash
      spark: number; // phase of the little satellite spark circling the orb
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
      spark: Math.random() * Math.PI * 2,
      x: 0,
      y: 0,
      r: 30,
    }));

    type Shot = {
      t: number;
      speed: number;
      sx: number;
      sy: number;
      curve: number;
      target: Rep | null;
      lead: string;
      px: number; // last drawn position, for spark trails
      py: number;
    };
    const shots: Shot[] = [];

    // Free-flying spark particles: comet trails + impact bursts.
    type Particle = { x: number; y: number; vx: number; vy: number; a: number; fade: number; r: number };
    const particles: Particle[] = [];

    type Floater = { x: number; y: number; vy: number; a: number; text: string };
    const floaters: Floater[] = [];

    type Ring = { x: number; y: number; r: number; max: number; a: number };
    const rings: Ring[] = [];

    // Two-layer parallax starfield + a few warm nebula patches.
    type Star = { x: number; y: number; r: number; v: number; tw: number; tws: number; a: number };
    let starsFar: Star[] = [];
    let starsNear: Star[] = [];
    type Nebula = { x: number; y: number; r: number; a: number; drift: number };
    let nebulas: Nebula[] = [];

    function seedStars() {
      const W = w || 800;
      const H = h || 500;
      const mk = (n: number, rMin: number, rMax: number, vBase: number, aMax: number): Star[] =>
        Array.from({ length: n }, () => ({
          x: Math.random() * W,
          y: Math.random() * H,
          r: rMin + Math.random() * (rMax - rMin),
          v: vBase * (0.6 + Math.random() * 0.8),
          tw: Math.random() * Math.PI * 2,
          tws: 0.004 + Math.random() * 0.02,
          a: 0.05 + Math.random() * aMax,
        }));
      starsFar = mk(70, 0.4, 1.0, 0.02, 0.2);
      starsNear = mk(26, 0.9, 1.8, 0.06, 0.3);
      nebulas = Array.from({ length: 4 }, (_, i) => ({
        x: (0.15 + 0.7 * Math.random()) * W,
        y: (0.1 + 0.8 * Math.random()) * H,
        r: Math.max(W, H) * (0.22 + Math.random() * 0.18),
        a: 0.05 + Math.random() * 0.04,
        drift: (i % 2 === 0 ? 1 : -1) * (0.02 + Math.random() * 0.03),
      }));
    }
    seedStars();

    let orbit = 0;
    let breath = 0;
    let flare = 0; // rotation of the center flare ring
    let flow = 0; // phase of the tether energy motes
    let nextIdleSpark = 0;

    const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

    const orbitRx = () => Math.max(120, w * 0.36);
    const orbitRy = () => Math.max(100, h * 0.34);

    function layout(now: number) {
      const cx = w / 2;
      const cy = h / 2;
      const rx = orbitRx();
      const ry = orbitRy();
      for (const r of repOrbs) {
        const a = r.angle + orbit;
        r.x = cx + Math.cos(a) * rx;
        r.y = cy + Math.sin(a) * ry + Math.sin(now * 0.0011 + r.wobble) * 6;
      }
    }

    function drawBackdrop(dim: number) {
      if (!ctx) return;
      // Nebula haze
      for (const n of nebulas) {
        n.x += n.drift;
        if (n.x < -n.r) n.x = w + n.r;
        if (n.x > w + n.r) n.x = -n.r;
        const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
        g.addColorStop(0, `rgba(120, 45, 25, ${(n.a * dim).toFixed(3)})`);
        g.addColorStop(0.6, `rgba(60, 22, 14, ${(n.a * 0.5 * dim).toFixed(3)})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2);
      }
      // Stars, far layer then near layer (parallax drift left).
      for (const layer of [starsFar, starsNear]) {
        for (const s of layer) {
          s.x -= s.v;
          s.tw += s.tws;
          if (s.x < -2) {
            s.x = w + 2;
            s.y = Math.random() * h;
          }
          const alpha = s.a * (0.55 + 0.45 * Math.sin(s.tw)) * (0.7 + 0.3 * dim);
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 214, 170, ${alpha.toFixed(3)})`;
          ctx.fill();
        }
      }
    }

    function drawOrbitRing(dim: number) {
      if (!ctx) return;
      const cx = w / 2;
      const cy = h / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, orbitRy() / orbitRx());
      ctx.beginPath();
      ctx.arc(0, 0, orbitRx(), 0, Math.PI * 2);
      ctx.restore();
      ctx.setLineDash([2, 7]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(249, 110, 60, ${(0.14 * dim).toFixed(3)})`;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    function drawTethers(dim: number) {
      if (!ctx) return;
      const cx = w / 2;
      const cy = h / 2;
      for (const r of repOrbs) {
        // Faint beam that brightens near whichever end the flow is at.
        const grad = ctx.createLinearGradient(cx, cy, r.x, r.y);
        grad.addColorStop(0, `rgba(249, 110, 60, ${(0.1 * dim + r.flash * 0.15).toFixed(3)})`);
        grad.addColorStop(1, `rgba(249, 110, 60, ${(0.02 * dim + r.flash * 0.1).toFixed(3)})`);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(r.x, r.y);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1;
        ctx.stroke();
        // Energy motes streaming outward along the tether, staggered per rep.
        const motesN = 3;
        for (let k = 0; k < motesN; k++) {
          const t = (flow + k / motesN + r.wobble * 0.15) % 1;
          const mx = cx + (r.x - cx) * t;
          const my = cy + (r.y - cy) * t;
          const ma = Math.sin(Math.PI * t) * (0.35 * dim + r.flash * 0.3);
          ctx.beginPath();
          ctx.arc(mx, my, 1.4, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 180, 120, ${ma.toFixed(3)})`;
          ctx.fill();
        }
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
      const halo = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 2.8);
      halo.addColorStop(0, `rgba(249, 110, 60, ${(0.24 * dim).toFixed(3)})`);
      halo.addColorStop(0.5, `rgba(200, 55, 30, ${(0.09 * dim).toFixed(3)})`);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 2.8, 0, Math.PI * 2);
      ctx.fill();

      // Three slow-churning plasma cells inside the core, so the surface moves.
      for (let i = 0; i < 3; i++) {
        const pa = now * 0.00035 * (i % 2 === 0 ? 1 : -1) + (i * Math.PI * 2) / 3;
        const px = cx + Math.cos(pa) * R * 0.35;
        const py = cy + Math.sin(pa) * R * 0.35;
        const pg = ctx.createRadialGradient(px, py, 0, px, py, R * 0.7);
        pg.addColorStop(0, `rgba(255, 170, 100, ${(0.3 * dim).toFixed(3)})`);
        pg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(px, py, R * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }

      // Core body
      const core = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.25, R * 0.1, cx, cy, R);
      core.addColorStop(0, `rgba(255, 190, 130, ${(0.95 * dim).toFixed(3)})`);
      core.addColorStop(0.45, `rgba(249, 110, 60, ${(0.75 * dim).toFixed(3)})`);
      core.addColorStop(1, `rgba(140, 35, 20, ${(0.35 * dim).toFixed(3)})`);
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();

      // Rotating flare ring: three bright arc segments circling the core.
      const ringR = R * 1.35;
      for (let i = 0; i < 3; i++) {
        const a0 = flare + (i * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.arc(cx, cy, ringR, a0, a0 + Math.PI * 0.45);
        ctx.strokeStyle = `rgba(255, 150, 80, ${(0.4 * dim).toFixed(3)})`;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
      // Counter-rotating faint outer ring.
      for (let i = 0; i < 2; i++) {
        const a0 = -flare * 0.6 + i * Math.PI;
        ctx.beginPath();
        ctx.arc(cx, cy, ringR * 1.22, a0, a0 + Math.PI * 0.3);
        ctx.strokeStyle = `rgba(249, 110, 60, ${(0.2 * dim).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";

      // Label
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `800 ${Math.round(R * 0.3)}px ${FONT}`;
      ctx.fillStyle = `rgba(20, 8, 4, ${(0.9 * dim).toFixed(3)})`;
      ctx.fillText("LEADS", cx, cy + 1.5);
      ctx.fillStyle = `rgba(255, 240, 226, ${(0.96 * dim).toFixed(3)})`;
      ctx.fillText("LEADS", cx, cy);

      if (isLive && now > nextIdleSpark) {
        nextIdleSpark = now + 1400 + Math.random() * 2200;
        rings.push({ x: cx, y: cy, r: R * 0.9, max: R * 2.4, a: 0.18 });
      }
    }

    function drawRep(rep: Rep, dim: number) {
      if (!ctx) return;
      const flash = rep.flash;
      const R = rep.r + flash * 8;
      ctx.globalCompositeOperation = "lighter";
      const halo = ctx.createRadialGradient(rep.x, rep.y, R * 0.2, rep.x, rep.y, R * 2.1);
      halo.addColorStop(0, `rgba(249, 110, 60, ${((0.15 + flash * 0.45) * dim).toFixed(3)})`);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(rep.x, rep.y, R * 2.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";

      // Glassy dark body…
      const g = ctx.createRadialGradient(rep.x - R * 0.3, rep.y - R * 0.35, R * 0.1, rep.x, rep.y, R);
      g.addColorStop(0, `rgba(82, 36, 22, ${(0.96 * dim).toFixed(3)})`);
      g.addColorStop(0.7, `rgba(30, 13, 8, ${(0.96 * dim).toFixed(3)})`);
      g.addColorStop(1, `rgba(18, 8, 5, ${(0.96 * dim).toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(rep.x, rep.y, R, 0, Math.PI * 2);
      ctx.fill();
      // …with a hot rim light on the side facing the core.
      const toCore = Math.atan2(h / 2 - rep.y, w / 2 - rep.x);
      ctx.beginPath();
      ctx.arc(rep.x, rep.y, R - 0.5, toCore - 1.15, toCore + 1.15);
      ctx.strokeStyle = `rgba(255, 150, 85, ${((0.5 + flash * 0.5) * dim).toFixed(3)})`;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      // Full faint outline.
      ctx.beginPath();
      ctx.arc(rep.x, rep.y, R, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(249, 110, 60, ${((0.22 + flash * 0.5) * dim).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Tiny satellite spark circling each orb.
      rep.spark += 0.02 + flash * 0.05;
      const sx = rep.x + Math.cos(rep.spark) * (R + 6);
      const sy = rep.y + Math.sin(rep.spark) * (R + 6) * 0.55;
      ctx.beginPath();
      ctx.arc(sx, sy, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 190, 130, ${((0.5 + flash * 0.4) * dim).toFixed(3)})`;
      ctx.fill();

      // Tally inside the orb.
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${Math.round(R * 0.58)}px ${FONT}`;
      ctx.fillStyle = `rgba(255, 190, 130, ${((0.85 + flash * 0.15) * dim).toFixed(3)})`;
      ctx.fillText(String(rep.count), rep.x, rep.y + 1);

      // Name plate under the orb.
      const label = rep.name.toUpperCase();
      ctx.font = `700 11px ${FONT}`;
      const tw2 = ctx.measureText(label).width;
      const plateY = rep.y + R + 16;
      ctx.fillStyle = `rgba(12, 5, 3, ${(0.55 * dim).toFixed(3)})`;
      ctx.beginPath();
      ctx.roundRect(rep.x - tw2 / 2 - 8, plateY - 9, tw2 + 16, 18, 9);
      ctx.fill();
      ctx.strokeStyle = `rgba(249, 110, 60, ${((0.2 + flash * 0.4) * dim).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = `rgba(255, 226, 205, ${(0.9 * dim).toFixed(3)})`;
      ctx.fillText(label, rep.x, plateY + 0.5);

      if (rep.flash > 0) rep.flash = Math.max(0, rep.flash - 0.025);
    }

    function burst(x: number, y: number, n: number, power: number) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = (0.5 + Math.random()) * power;
        particles.push({
          x,
          y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          a: 0.9,
          fade: 0.015 + Math.random() * 0.02,
          r: 1 + Math.random() * 1.6,
        });
      }
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
        px: w / 2,
        py: h / 2,
      });
      burst(w / 2, h / 2, 8, 1.2); // muzzle flash off the core
    }

    function stepShots(dim: number) {
      if (!ctx) return;
      for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i];
        s.t += s.speed * (liveRef.current ? 1 : 1.4);
        const tx = s.target ? s.target.x : s.sx;
        const ty = s.target ? s.target.y : s.sy - 40;
        const t = Math.min(1, s.t);
        const e = t * t * (3 - 2 * t);
        const px = s.sx + (tx - s.sx) * e + -(ty - s.sy) * 0.0016 * s.curve * Math.sin(Math.PI * t);
        const py = s.sy + (ty - s.sy) * e + (tx - s.sx) * 0.0016 * s.curve * Math.sin(Math.PI * t);

        if (t >= 1) {
          shots.splice(i, 1);
          rings.push({ x: tx, y: ty, r: 6, max: 52, a: 0.55 });
          burst(tx, ty, 18, 1.8);
          if (s.target) {
            s.target.count += 1;
            s.target.flash = 1;
            floaters.push({ x: tx, y: ty - s.target.r - 30, vy: -0.25, a: 1, text: s.lead });
          } else {
            floaters.push({ x: tx, y: ty - 18, vy: -0.25, a: 1, text: `${s.lead} → pool` });
          }
          continue;
        }

        // Spark trail: shed a particle at the comet's previous position.
        particles.push({
          x: s.px,
          y: s.py,
          vx: (Math.random() - 0.5) * 0.4,
          vy: (Math.random() - 0.5) * 0.4,
          a: 0.6,
          fade: 0.03,
          r: 0.8 + Math.random(),
        });
        s.px = px;
        s.py = py;

        ctx.globalCompositeOperation = "lighter";
        const tail = ctx.createRadialGradient(px, py, 0, px, py, 18);
        tail.addColorStop(0, `rgba(255, 200, 140, ${(0.85 * dim).toFixed(3)})`);
        tail.addColorStop(0.4, `rgba(249, 110, 60, ${(0.35 * dim).toFixed(3)})`);
        tail.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = tail;
        ctx.beginPath();
        ctx.arc(px, py, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        ctx.beginPath();
        ctx.arc(px, py, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 238, 220, ${(0.95 * dim).toFixed(3)})`;
        ctx.fill();
      }
    }

    function stepParticles(dim: number) {
      if (!ctx) return;
      ctx.globalCompositeOperation = "lighter";
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.98;
        p.vy *= 0.98;
        p.a -= p.fade;
        if (p.a <= 0) {
          particles.splice(i, 1);
          continue;
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 175, 110, ${(p.a * dim).toFixed(3)})`;
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    }

    function drawStatic() {
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      orbit = 0;
      drawBackdrop(0.9);
      drawOrbitRing(0.9);
      layout(0);
      drawTethers(0.9);
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
      flare += isLive ? 0.008 : 0.003;
      flow = (flow + (isLive ? 0.004 : 0.0015)) % 1;

      drawBackdrop(dim);
      drawOrbitRing(dim);
      layout(now);
      drawTethers(dim);
      drawCenter(now, dim);
      for (const r of repOrbs) drawRep(r, dim);

      while (eventQueue.current.length > 0) {
        const ev = eventQueue.current.shift();
        if (ev) spawnShot(ev);
      }
      stepShots(dim);
      stepParticles(dim);

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
