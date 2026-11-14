"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";

export type PoolSceneState = {
  utilization: number; // share of supplied MUSD that is lent out (0..1)
  borrowApy: number; // drives the interest return flow
  collateralWeight: number; // 0..1 how full the BTC vault looks
};

/*
 * Normalised layout (0..1):
 *
 *   ┌────────────┐          ╭── interest ──╮
 *   │ ~~~~~~~~~~ │  ◄───────╯              │
 *   │  MUSD pool │                    ┌────┴─────┐
 *   │            │ ── loans ────────► │ BTC vault│
 *   └────────────┘                    └──────────┘
 */
export const SCENE = {
  tank: { x0: 0.05, x1: 0.41, y0: 0.1, y1: 0.84 },
  vault: { x0: 0.62, x1: 0.95, y0: 0.44, y1: 0.84 },
  outlet: 0.76,
};

type P = { hx: number; hy: number; x: number; y: number; vx: number; vy: number; s: number; ph: number };
type Flow = { t: number; v: number; j: number; ph: number };

const ORANGE = [242, 130, 30] as const;
const DEEP = [184, 83, 10] as const;
const INK = [23, 19, 15] as const;

export function PoolScene({ state, className = "" }: { state: PoolSceneState; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const reduce = useReducedMotion();

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let W = 0;
    let H = 0;
    let raf = 0;
    let running = true;
    let visible = true;
    let level = 1 - stateRef.current.utilization;
    let laidU = -1;
    let laidC = -1;
    const mouse = { x: -1e4, y: -1e4, on: false };
    const t0 = performance.now();

    let liquid: P[] = [];
    let grains: P[] = [];
    let loans: Flow[] = [];
    let interest: Flow[] = [];

    const px = (r: { x0: number; x1: number; y0: number; y1: number }) => ({ x0: r.x0 * W, x1: r.x1 * W, y0: r.y0 * H, y1: r.y1 * H });

    const layoutLiquid = () => {
      const t = px(SCENE.tank);
      const n = W < 480 ? 320 : 640;
      const top = t.y1 - (t.y1 - t.y0) * Math.max(level, 0.05);
      const cols = Math.max(4, Math.round(Math.sqrt((n * (t.x1 - t.x0)) / Math.max(t.y1 - top, 10))));
      const rows = Math.ceil(n / cols);
      const cw = (t.x1 - t.x0 - 14) / cols;
      const ch = (t.y1 - top - 10) / rows;
      const next: P[] = [];
      for (let i = 0; i < n; i++) {
        const prev = liquid[i];
        const ph = prev?.ph ?? Math.random() * Math.PI * 2;
        const c = i % cols;
        const r = Math.floor(i / cols);
        const hx = t.x0 + 7 + (c + 0.5) * cw + (ph / (Math.PI * 2) - 0.5) * cw * 1.4;
        const hy = t.y1 - 6 - (r + 0.5) * ch + (((ph * 7.31) % 1) - 0.5) * ch;
        next.push({ hx, hy, x: prev?.x ?? hx, y: prev?.y ?? hy, vx: prev?.vx ?? 0, vy: prev?.vy ?? 0, s: prev?.s ?? 1 + Math.random() * 0.9, ph });
      }
      liquid = next;
    };

    const layoutGrains = () => {
      const v = px(SCENE.vault);
      const gap = W < 480 ? 7 : 8.5;
      const cols = Math.floor((v.x1 - v.x0 - 16) / gap);
      const maxRows = Math.floor((v.y1 - v.y0 - 16) / (gap * 0.87));
      const rows = Math.max(2, Math.round(maxRows * (0.25 + 0.7 * Math.min(1, stateRef.current.collateralWeight))));
      grains = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols - (r % 2); c++) {
          const hx = v.x0 + 8 + gap / 2 + c * gap + (r % 2) * (gap / 2);
          const hy = v.y1 - 8 - gap / 2 - r * gap * 0.87;
          grains.push({ hx, hy, x: hx, y: hy, vx: 0, vy: 0, s: Math.random(), ph: Math.random() * Math.PI * 2 });
        }
      }
    };

    const layoutFlows = () => {
      const u = stateRef.current.utilization;
      const nl = Math.round((W < 480 ? 18 : 30) * (0.25 + u));
      loans = Array.from({ length: nl }, () => ({ t: Math.random(), v: 0.0035 + Math.random() * 0.0025, j: (Math.random() - 0.5) * 6, ph: Math.random() * 6 }));
      const ni = Math.max(4, Math.round(Math.min(1, stateRef.current.borrowApy * 8) * (W < 480 ? 10 : 16)));
      interest = Array.from({ length: ni }, () => ({ t: Math.random(), v: 0.0022 + Math.random() * 0.0015, j: (Math.random() - 0.5) * 8, ph: Math.random() * 6 }));
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = rect.width;
      H = rect.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      liquid = [];
      layoutLiquid();
      layoutGrains();
      layoutFlows();
    };

    const bez = (t: number, a: number[], b: number[], c: number[], d: number[]) => {
      const m = 1 - t;
      return [
        m * m * m * a[0] + 3 * m * m * t * b[0] + 3 * m * t * t * c[0] + t * t * t * d[0],
        m * m * m * a[1] + 3 * m * m * t * b[1] + 3 * m * t * t * c[1] + t * t * t * d[1],
      ];
    };

    const loanPath = () => {
      const t = px(SCENE.tank);
      const v = px(SCENE.vault);
      const y = SCENE.outlet * H;
      return [
        [t.x1, y],
        [t.x1 + (v.x0 - t.x1) * 0.5, y],
        [t.x1 + (v.x0 - t.x1) * 0.5, y],
        [v.x0, y],
      ];
    };
    const interestPath = (surfaceY: number) => {
      const t = px(SCENE.tank);
      const v = px(SCENE.vault);
      const sx = (v.x0 + v.x1) / 2;
      return [
        [sx, v.y0],
        [sx, v.y0 - H * 0.32],
        [t.x1 - (t.x1 - t.x0) * 0.25, t.y0 - H * 0.06],
        [t.x1 - (t.x1 - t.x0) * 0.3, surfaceY - 4],
      ];
    };

    const rr = (x0: number, y0: number, x1: number, y1: number, r: number) => {
      ctx.beginPath();
      ctx.moveTo(x0 + r, y0);
      ctx.lineTo(x1 - r, y0);
      ctx.quadraticCurveTo(x1, y0, x1, y0 + r);
      ctx.lineTo(x1, y1 - r);
      ctx.quadraticCurveTo(x1, y1, x1 - r, y1);
      ctx.lineTo(x0 + r, y1);
      ctx.quadraticCurveTo(x0, y1, x0, y1 - r);
      ctx.lineTo(x0, y0 + r);
      ctx.quadraticCurveTo(x0, y0, x0 + r, y0);
      ctx.closePath();
    };

    const rgba = (c: readonly number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

    const frame = (now: number) => {
      const time = (now - t0) / 1000;
      const st = stateRef.current;
      if (Math.abs(st.utilization - laidU) > 0.02 || Math.abs(st.collateralWeight - laidC) > 0.05) {
        laidU = st.utilization;
        laidC = st.collateralWeight;
        layoutFlows();
        layoutGrains();
      }
      const target = 1 - st.utilization;
      if (Math.abs(level - target) > 0.002) {
        level += (target - level) * 0.05;
        layoutLiquid();
      }

      const t = px(SCENE.tank);
      const v = px(SCENE.vault);
      const surfaceY = t.y1 - (t.y1 - t.y0) * Math.max(level, 0.05);
      const wave = (x: number) => Math.sin(x * 0.04 + time * 1.5) * 2 + Math.sin(x * 0.013 - time * 0.9) * 1.4;
      ctx.clearRect(0, 0, W, H);

      // channels (guides)
      const lp = loanPath();
      const ip = interestPath(surfaceY);
      ctx.setLineDash([2, 5]);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = rgba(INK, 0.16);
      ctx.beginPath();
      ctx.moveTo(lp[0][0], lp[0][1]);
      ctx.bezierCurveTo(lp[1][0], lp[1][1], lp[2][0], lp[2][1], lp[3][0], lp[3][1]);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ip[0][0], ip[0][1]);
      ctx.bezierCurveTo(ip[1][0], ip[1][1], ip[2][0], ip[2][1], ip[3][0], ip[3][1]);
      ctx.stroke();
      ctx.setLineDash([]);
      // arrowheads
      const arrow = (x: number, y: number, ang: number) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-7, -4);
        ctx.lineTo(-7, 4);
        ctx.closePath();
        ctx.fillStyle = rgba(INK, 0.35);
        ctx.fill();
        ctx.restore();
      };
      arrow(v.x0 - 3, SCENE.outlet * H, 0);
      arrow(ip[3][0], ip[3][1] - 6, Math.PI / 2);

      // tank liquid body
      ctx.save();
      rr(t.x0, t.y0, t.x1, t.y1, 16);
      ctx.clip();
      const g = ctx.createLinearGradient(0, surfaceY, 0, t.y1);
      g.addColorStop(0, "rgba(255,154,60,0.14)");
      g.addColorStop(1, "rgba(255,154,60,0.32)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(t.x0, surfaceY);
      for (let x = t.x0; x <= t.x1 + 6; x += 6) ctx.lineTo(x, surfaceY + wave(x));
      ctx.lineTo(t.x1, t.y1);
      ctx.lineTo(t.x0, t.y1);
      ctx.closePath();
      ctx.fill();

      for (const p of liquid) {
        const tx = p.hx + Math.sin(time * 0.8 + p.ph) * 1.5;
        const ty = p.hy + (p.hy < surfaceY + 24 ? wave(p.hx) : 0) + Math.cos(time * 0.9 + p.ph) * 1.2;
        p.vx += (tx - p.x) * 0.06;
        p.vy += (ty - p.y) * 0.06;
        if (mouse.on) {
          const dx = p.x - mouse.x;
          const dy = p.y - mouse.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 4200) {
            const f = (1 - d2 / 4200) * 2.4;
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
        ctx.fillStyle = rgba(ORANGE, (p.y < surfaceY + 2 ? 0.25 : 0.9 - depth * 0.45) * (0.8 + 0.2 * Math.sin(time * 2 + p.ph * 4)));
        ctx.fillRect(p.x, p.y, p.s * 1.3, p.s * 1.3);
      }
      ctx.restore();

      // surface line
      ctx.beginPath();
      for (let x = t.x0 + 1; x <= t.x1 - 1; x += 4) {
        const y = surfaceY + wave(x);
        if (x === t.x0 + 1) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(ORANGE, 0.95);
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // tank glass + supplied mark
      rr(t.x0, t.y0, t.x1, t.y1, 16);
      ctx.strokeStyle = "rgba(23,19,15,0.28)";
      ctx.lineWidth = 1.4;
      ctx.stroke();
      for (let i = 1; i < 10; i++) {
        const y = t.y1 - ((t.y1 - t.y0) * i) / 10;
        ctx.beginPath();
        ctx.moveTo(t.x1, y);
        ctx.lineTo(t.x1 - (i % 5 === 0 ? 9 : 5), y);
        ctx.strokeStyle = "rgba(23,19,15,0.22)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // vault
      rr(v.x0, v.y0, v.x1, v.y1, 14);
      ctx.fillStyle = "rgba(255,241,227,0.55)";
      ctx.fill();
      ctx.strokeStyle = "rgba(23,19,15,0.55)";
      ctx.lineWidth = 1.4;
      ctx.stroke();
      for (const p of grains) {
        let ox = 0;
        let oy = 0;
        if (mouse.on) {
          const dx = p.hx - mouse.x;
          const dy = p.hy - mouse.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 2500) {
            const f = (1 - d2 / 2500) * 6;
            const d = Math.sqrt(d2) || 1;
            ox = (dx / d) * f;
            oy = (dy / d) * f;
          }
        }
        p.x += (p.hx + ox - p.x) * 0.15;
        p.y += (p.hy + oy - p.y) * 0.15;
        const glow = 0.65 + 0.35 * Math.sin(time * 1.8 + p.ph * 3);
        ctx.fillStyle = p.s > 0.72 ? rgba(DEEP, 0.55 + 0.4 * glow) : rgba(ORANGE, 0.45 + 0.45 * glow);
        ctx.beginPath();
        ctx.arc(p.x, p.y, W < 480 ? 1.9 : 2.3, 0, Math.PI * 2);
        ctx.fill();
      }

      // loans: MUSD out to borrowers
      for (const f of loans) {
        f.t = (f.t + f.v) % 1;
        const [x, y] = bez(f.t, lp[0], lp[1], lp[2], lp[3]);
        const yy = y + f.j * Math.sin(f.t * Math.PI) + Math.sin(time * 2 + f.ph) * 0.8;
        ctx.fillStyle = rgba(f.t > 0.8 ? DEEP : ORANGE, 0.35 + 0.6 * Math.sin(f.t * Math.PI));
        ctx.beginPath();
        ctx.arc(x, yy, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      // interest: back to lenders
      for (const f of interest) {
        f.t = (f.t + f.v) % 1;
        const [x, y] = bez(f.t, ip[0], ip[1], ip[2], ip[3]);
        ctx.fillStyle = rgba(INK, 0.15 + 0.6 * Math.sin(f.t * Math.PI));
        ctx.beginPath();
        ctx.arc(x + f.j * Math.sin(f.t * Math.PI) * 0.4, y, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }

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
      mouse.on = true;
    };
    const onLeave = () => {
      mouse.on = false;
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
      for (const p of liquid) {
        p.x = p.hx;
        p.y = p.hy;
      }
      frame(performance.now());
    } else raf = requestAnimationFrame(frame);

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

  return <canvas ref={ref} className={`block h-full w-full ${className}`} aria-hidden />;
}
