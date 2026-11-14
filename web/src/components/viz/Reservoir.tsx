"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";

export type ReservoirState = {
  utilization: number; // 0..1 share of supplied MUSD lent out
  borrowApy: number; // drives how much interest flows back
  collateralWeight: number; // 0..1 relative size of the BTC bed
};

/*
 * Scene (normalised 0..1 coords):
 *   ┌──────────────┐  ← supplied line (ghost)
 *   │ ~~~~~~~~~~~~ │  ← idle MUSD (water level = 1 - utilization)
 *   │ ············ │                 ⌒⌒⌒ interest arcs back
 *   │ ············ │══ lent out ══►  ▲▲▲ BTC collateral (ember bed)
 *   └──────────────┘
 */
const TANK = { x0: 0.07, x1: 0.56, y0: 0.14, y1: 0.86, r: 0.06 };
const BED = { cx: 0.8, cy: 0.86, rx: 0.15, ry: 0.13 };
const OUTLET = { x: 0.56, y: 0.79 };

type P = { hx: number; hy: number; x: number; y: number; vx: number; vy: number; s: number; ph: number };
type Flow = { t: number; speed: number; jitter: number; ph: number };

export function Reservoir({ state, className = "" }: { state: ReservoirState; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const reduce = useReducedMotion();
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = 0;
    let H = 0;
    let dpr = 1;
    const mouse = { x: -9999, y: -9999, active: false };
    let level = 1 - stateRef.current.utilization; // animated water level fraction
    let raf = 0;
    let laidU = stateRef.current.utilization;
    let laidC = stateRef.current.collateralWeight;
    let running = true;
    let visible = true;
    const t0 = performance.now();

    // ── glow sprites ──
    const sprite = (r: number, g: number, b: number, size: number) => {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const x = c.getContext("2d")!;
      const grad = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
      grad.addColorStop(0.25, `rgba(${r},${g},${b},0.6)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      x.fillStyle = grad;
      x.fillRect(0, 0, size, size);
      return c;
    };
    const emberGlow = sprite(214, 96, 14, 32); // BTC collateral (burnt orange)
    const flareGlow = sprite(31, 26, 21, 32); // dense collateral grains / interest (ink)
    const iceGlow = sprite(255, 154, 60, 32); // MUSD liquidity (light orange)

    // ── particles ──
    const small = () => W < 520;
    let water: P[] = [];
    let bed: P[] = [];
    let stream: Flow[] = [];
    let interest: Flow[] = [];

    const tankPx = () => ({
      x0: TANK.x0 * W,
      x1: TANK.x1 * W,
      y0: TANK.y0 * H,
      y1: TANK.y1 * H,
    });

    const layoutWater = () => {
      const n = small() ? 420 : 900;
      const t = tankPx();
      const cols = Math.round(Math.sqrt((n * (t.x1 - t.x0)) / (t.y1 - t.y0)));
      const rows = Math.ceil(n / cols);
      const fillTop = t.y1 - (t.y1 - t.y0) * Math.max(level, 0.04);
      const cw = (t.x1 - t.x0 - 16) / cols;
      const ch = (t.y1 - fillTop - 10) / rows;
      const next: P[] = [];
      for (let i = 0; i < n; i++) {
        const c = i % cols;
        const r = Math.floor(i / cols);
        const prev = water[i];
        const ph = prev?.ph ?? Math.random() * Math.PI * 2;
        const seedX = ph / (Math.PI * 2);
        const seedY = (ph * 7.31) % 1;
        const hx = t.x0 + 8 + (c + 0.5) * cw + (seedX - 0.5) * cw * 1.6;
        const hy = t.y1 - 8 - (r + 0.5) * ch + (seedY - 0.5) * ch * 1.2;
        next.push({
          hx,
          hy,
          x: prev?.x ?? hx,
          y: prev?.y ?? hy,
          vx: prev?.vx ?? 0,
          vy: prev?.vy ?? 0,
          s: prev?.s ?? 0.7 + Math.random() * 0.9,
          ph,
        });
      }
      water = next;
    };

    const layoutBed = () => {
      const n = Math.round((small() ? 90 : 170) * (0.35 + 0.65 * Math.min(1, stateRef.current.collateralWeight)));
      bed = [];
      for (let i = 0; i < n; i++) {
        // sample inside a half-ellipse mound
        let px = 0;
        let py = 0;
        for (;;) {
          px = Math.random() * 2 - 1;
          py = Math.random();
          if (px * px + py * py <= 1) break;
        }
        const hx = (BED.cx + px * BED.rx) * W;
        const hy = (BED.cy - py * BED.ry) * H;
        bed.push({ hx, hy, x: hx, y: hy, vx: 0, vy: 0, s: 0.6 + Math.random() * 1.1, ph: Math.random() * Math.PI * 2 });
      }
    };

    const layoutFlows = () => {
      const u = stateRef.current.utilization;
      const ns = Math.round((small() ? 26 : 56) * Math.min(1, 0.15 + u));
      stream = Array.from({ length: ns }, () => ({
        t: Math.random(),
        speed: 0.0028 + Math.random() * 0.003,
        jitter: (Math.random() - 0.5) * 10,
        ph: Math.random() * 6,
      }));
      const ni = Math.max(3, Math.round(Math.min(1, stateRef.current.borrowApy * 6) * (small() ? 12 : 22)));
      interest = Array.from({ length: ni }, () => ({
        t: Math.random(),
        speed: 0.0016 + Math.random() * 0.0016,
        jitter: (Math.random() - 0.5) * 14,
        ph: Math.random() * 6,
      }));
    };

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = r.width;
      H = r.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      water = [];
      layoutWater();
      layoutBed();
      layoutFlows();
    };

    // ── paths ──
    const streamPoint = (t: number, j: number) => {
      // cubic bezier from outlet to bed top-left
      const p0 = { x: OUTLET.x * W, y: OUTLET.y * H };
      const p1 = { x: (OUTLET.x + 0.08) * W, y: OUTLET.y * H };
      const p2 = { x: (BED.cx - BED.rx * 0.9) * W, y: (BED.cy - BED.ry * 1.6) * H };
      const p3 = { x: (BED.cx - BED.rx * 0.2) * W, y: (BED.cy - BED.ry * 0.9) * H };
      const m = 1 - t;
      const x = m * m * m * p0.x + 3 * m * m * t * p1.x + 3 * m * t * t * p2.x + t * t * t * p3.x;
      const y = m * m * m * p0.y + 3 * m * m * t * p1.y + 3 * m * t * t * p2.y + t * t * t * p3.y;
      return { x, y: y + j * Math.sin(t * Math.PI) * 0.6 };
    };

    const interestPoint = (t: number, j: number, surfaceY: number) => {
      // arc from bed top back over into the tank surface
      const a = { x: (BED.cx + BED.rx * 0.1) * W, y: (BED.cy - BED.ry) * H };
      const b = { x: (TANK.x0 + (TANK.x1 - TANK.x0) * 0.62) * W, y: surfaceY };
      const cx = (a.x + b.x) / 2;
      const cy = Math.min(a.y, b.y) - H * 0.3;
      const m = 1 - t;
      return {
        x: m * m * a.x + 2 * m * t * cx + t * t * b.x + j * Math.sin(t * Math.PI),
        y: m * m * a.y + 2 * m * t * cy + t * t * b.y,
      };
    };

    // ── draw ──
    const drawTank = (surfaceY: number, time: number) => {
      const t = tankPx();
      const r = TANK.r * W;
      // water body tint
      const g = ctx.createLinearGradient(0, surfaceY, 0, t.y1);
      g.addColorStop(0, "rgba(255,154,60,0.10)");
      g.addColorStop(1, "rgba(255,154,60,0.26)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(t.x0 + 1.5, surfaceY);
      for (let x = t.x0; x <= t.x1; x += 6) {
        ctx.lineTo(x, surfaceY + Math.sin(x * 0.035 + time * 1.6) * 2.4 + Math.sin(x * 0.011 - time) * 1.6);
      }
      ctx.lineTo(t.x1 - 1.5, t.y1 - r);
      ctx.quadraticCurveTo(t.x1 - 1.5, t.y1 - 1.5, t.x1 - r, t.y1 - 1.5);
      ctx.lineTo(t.x0 + r, t.y1 - 1.5);
      ctx.quadraticCurveTo(t.x0 + 1.5, t.y1 - 1.5, t.x0 + 1.5, t.y1 - r);
      ctx.closePath();
      ctx.fill();

      // surface line
      ctx.beginPath();
      for (let x = t.x0 + 2; x <= t.x1 - 2; x += 4) {
        const yy = surfaceY + Math.sin(x * 0.035 + time * 1.6) * 2.4 + Math.sin(x * 0.011 - time) * 1.6;
        if (x === t.x0 + 2) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.strokeStyle = "rgba(240,128,30,0.95)";
      ctx.lineWidth = 1.3;
      ctx.stroke();

      // glass
      ctx.beginPath();
      ctx.moveTo(t.x0, t.y0);
      ctx.lineTo(t.x0, t.y1 - r);
      ctx.quadraticCurveTo(t.x0, t.y1, t.x0 + r, t.y1);
      ctx.lineTo(t.x1 - r, t.y1);
      ctx.quadraticCurveTo(t.x1, t.y1, t.x1, t.y1 - r);
      ctx.lineTo(t.x1, t.y0);
      ctx.strokeStyle = "rgba(31,26,21,0.55)";
      ctx.lineWidth = 1.4;
      ctx.stroke();
      // glass highlight
      ctx.beginPath();
      ctx.moveTo(t.x0 + 7, t.y0 + 18);
      ctx.lineTo(t.x0 + 7, t.y1 - r - 6);
      ctx.strokeStyle = "rgba(31,26,21,0.05)";
      ctx.lineWidth = 3;
      ctx.stroke();
      // rim ticks (graduations)
      for (let i = 1; i < 10; i++) {
        const yy = t.y1 - ((t.y1 - t.y0) * i) / 10;
        ctx.beginPath();
        ctx.moveTo(t.x1, yy);
        ctx.lineTo(t.x1 - (i % 5 === 0 ? 10 : 5), yy);
        ctx.strokeStyle = "rgba(31,26,21,0.35)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // full-supply ghost line
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(t.x0, t.y0);
      ctx.lineTo(t.x1, t.y0);
      ctx.strokeStyle = "rgba(31,26,21,0.4)";
      ctx.stroke();
      ctx.setLineDash([]);

      // outlet pipe
      ctx.beginPath();
      ctx.moveTo(t.x1, OUTLET.y * H - 6);
      ctx.lineTo(t.x1 + 16, OUTLET.y * H - 6);
      ctx.moveTo(t.x1, OUTLET.y * H + 6);
      ctx.lineTo(t.x1 + 16, OUTLET.y * H + 6);
      ctx.strokeStyle = "rgba(31,26,21,0.55)";
      ctx.lineWidth = 1.4;
      ctx.stroke();
    };

    const frame = (now: number) => {
      const time = (now - t0) / 1000;
      const st = stateRef.current;
      if (Math.abs(st.utilization - laidU) > 0.02 || Math.abs(st.collateralWeight - laidC) > 0.05) {
        laidU = st.utilization;
        laidC = st.collateralWeight;
        layoutFlows();
        layoutBed();
      }
      const target = 1 - st.utilization;
      if (Math.abs(level - target) > 0.002) {
        level += (target - level) * 0.04;
        if (Math.random() < 0.15) layoutWater();
      }
      const t = tankPx();
      const surfaceY = t.y1 - (t.y1 - t.y0) * Math.max(level, 0.04);

      ctx.clearRect(0, 0, W, H);
      drawTank(surfaceY, time);

      // water particles
      ctx.fillStyle = "rgba(242,130,30,1)";
      for (const p of water) {
        const wave = p.hy < surfaceY + 26 ? Math.sin(p.hx * 0.035 + time * 1.6) * 2.4 : 0;
        const tx = p.hx + Math.sin(time * 0.8 + p.ph) * 1.6;
        const ty = p.hy + wave + Math.cos(time * 0.9 + p.ph) * 1.4;
        p.vx += (tx - p.x) * 0.06;
        p.vy += (ty - p.y) * 0.06;
        if (mouse.active) {
          const dx = p.x - mouse.x;
          const dy = p.y - mouse.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 4900) {
            const f = (1 - d2 / 4900) * 2.2;
            const d = Math.sqrt(d2) || 1;
            p.vx += (dx / d) * f;
            p.vy += (dy / d) * f;
          }
        }
        p.vx *= 0.82;
        p.vy *= 0.82;
        p.x += p.vx;
        p.y += p.vy;
        const depth = Math.min(1, Math.max(0, (p.y - surfaceY) / (t.y1 - surfaceY + 1)));
        const shimmer = 0.75 + 0.25 * Math.sin(time * 2 + p.ph * 4);
        ctx.globalAlpha = (p.y < surfaceY + 3 ? 0.3 : 0.95 - depth * 0.55) * shimmer;
        ctx.fillRect(p.x, p.y, p.s * 1.2, p.s * 1.2);
      }
      ctx.globalAlpha = 1;

      ctx.globalCompositeOperation = "source-over";

      // stream: MUSD lent out → borrowers (cools to ember as it arrives)
      for (const f of stream) {
        f.t += f.speed;
        if (f.t > 1) f.t -= 1;
        const pt = streamPoint(f.t, f.jitter + Math.sin(time * 2 + f.ph) * 2);
        const spr = f.t > 0.75 ? emberGlow : iceGlow;
        const size = 7 + Math.sin(f.t * Math.PI) * 4;
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(f.t * Math.PI);
        ctx.drawImage(spr, pt.x - size / 2, pt.y - size / 2, size, size);
      }

      // collateral bed (heat shimmer)
      for (const p of bed) {
        const flick = 0.55 + 0.45 * Math.sin(time * 2.4 + p.ph * 3);
        let ox = 0;
        let oy = Math.sin(time * 1.3 + p.ph) * 0.8;
        if (mouse.active) {
          const dx = p.hx - mouse.x;
          const dy = p.hy - mouse.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 3600) {
            const f = (1 - d2 / 3600) * 14;
            const d = Math.sqrt(d2) || 1;
            ox = (dx / d) * f;
            oy += (dy / d) * f;
          }
        }
        p.x += (p.hx + ox - p.x) * 0.12;
        p.y += (p.hy + oy - p.y) * 0.12;
        const size = 6 + p.s * 5 * flick;
        ctx.globalAlpha = 0.35 + 0.5 * flick;
        ctx.drawImage(p.s > 1.62 ? flareGlow : emberGlow, p.x - size / 2, p.y - size / 2, size, size);
      }

      // interest returning to lenders
      for (const f of interest) {
        f.t += f.speed;
        if (f.t > 1) f.t -= 1;
        const pt = interestPoint(f.t, f.jitter, surfaceY);
        const size = 5 + Math.sin(f.t * Math.PI) * 5;
        ctx.globalAlpha = Math.sin(f.t * Math.PI) * 0.9;
        ctx.drawImage(f.t < 0.5 ? flareGlow : iceGlow, pt.x - size / 2, pt.y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";

      if (running && visible && !reduce) raf = requestAnimationFrame(frame);
    };

    resize();
    const ro = new ResizeObserver(() => {
      resize();
      if (reduce) frame(performance.now());
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      const was = visible;
      visible = e.isIntersecting;
      if (visible && !was && !reduce) raf = requestAnimationFrame(frame);
    });
    io.observe(canvas);

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
      mouse.active = true;
    };
    const onLeave = () => {
      mouse.active = false;
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    const onVis = () => {
      const was = running;
      running = document.visibilityState === "visible";
      if (running && !was && !reduce) raf = requestAnimationFrame(frame);
    };
    document.addEventListener("visibilitychange", onVis);

    if (reduce) {
      // settle particles at home and render a still frame
      for (const p of water) {
        p.x = p.hx;
        p.y = p.hy;
      }
      frame(performance.now());
    } else {
      raf = requestAnimationFrame(frame);
    }

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [reduce]);

  return <canvas ref={canvasRef} className={`block h-full w-full ${className}`} aria-hidden />;
}

export const RESERVOIR_GEOMETRY = { TANK, BED, OUTLET };
