"use client";

import { useId, useMemo, useRef, useState } from "react";
import { borrowAprAt, supplyAprAt, aprToApy, type RateParams } from "@/lib/math";
import { toNum } from "@/lib/format";
import { Segmented } from "@/components/ui/Primitives";

export type CurveSeries = {
  name: string;
  params: RateParams;
  current: number; // utilization 0..1
  color: string;
};

const W = 640;
const H = 280;
const PAD = { l: 44, r: 16, t: 48, b: 32 };

/**
 * Borrow (solid) and supply (dashed) APY across utilization, straight from each market's on-chain
 * InterestRateModel parameters. Hover or drag to read any point; dots mark where each market is now.
 */
export function RateCurve({ series, height = H }: { series: CurveSeries[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [full, setFull] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const gid = useId().replace(/:/g, "");

  const maxY = useMemo(() => {
    const nice = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10];
    // Zoomed view frames the useful range (up to a little past each kink); full view shows 100% utilization.
    const m = full
      ? Math.max(...series.map((s) => aprToApy(borrowAprAt(1, s.params))), 0.1)
      : Math.max(...series.map((s) => aprToApy(borrowAprAt(toNum(s.params.kink), s.params)) * 2.2), ...series.map((s) => aprToApy(borrowAprAt(s.current, s.params)) * 1.3), 0.05);
    return nice.find((n) => n >= m) ?? m;
  }, [series, full]);

  const x = (u: number) => PAD.l + u * (W - PAD.l - PAD.r);
  const y = (v: number) => height - PAD.b - (v / maxY) * (height - PAD.t - PAD.b);

  const path = (fn: (u: number) => number) => {
    let d = "";
    for (let i = 0; i <= 200; i++) {
      const u = i / 200;
      d += `${i === 0 ? "M" : "L"}${x(u).toFixed(2)},${y(fn(u)).toFixed(2)}`;
    }
    return d;
  };

  const onMove = (clientX: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((clientX - r.left) / r.width) * W;
    setHover(Math.min(1, Math.max(0, (px - PAD.l) / (W - PAD.l - PAD.r))));
  };

  const ticksY = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxY);
  const hv = hover;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${height}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label="Interest rate curves by utilization"
        onPointerMove={(e) => onMove(e.clientX)}
        onPointerDown={(e) => onMove(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <clipPath id={`${gid}-clip`}>
            <rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={height - PAD.t - PAD.b} />
          </clipPath>
          {series.map((s, i) => (
            <linearGradient key={i} id={`${gid}-g${i}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {ticksY.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#ece6df" strokeDasharray={t === 0 ? "" : "2 4"} />
            <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#a0948a" className="t-num">
              {(t * 100).toFixed(0)}%
            </text>
          </g>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((u) => (
          <text key={u} x={x(u)} y={height - 10} textAnchor="middle" fontSize="11" fill="#a0948a" className="t-num">
            {u * 100}%
          </text>
        ))}
        {series.map((s, i) => {
          const k = toNum(s.params.kink);
          return (
            <g key={s.name} clipPath={`url(#${gid}-clip)`}>
              <path
                d={`${path((u) => aprToApy(borrowAprAt(u, s.params)))}L${x(1)},${y(0)}L${x(0)},${y(0)}Z`}
                fill={`url(#${gid}-g${i})`}
              />
              <path d={path((u) => aprToApy(borrowAprAt(u, s.params)))} stroke={s.color} strokeWidth="2" fill="none" />
              <path
                d={path((u) => aprToApy(supplyAprAt(u, s.params)))}
                stroke={s.color}
                strokeWidth="1.5"
                strokeDasharray="5 5"
                fill="none"
                opacity="0.8"
              />
              <line x1={x(k)} x2={x(k)} y1={y(0)} y2={y(aprToApy(borrowAprAt(k, s.params)))} stroke={s.color} strokeOpacity="0.35" strokeDasharray="1 3" />
              <circle cx={x(s.current)} cy={y(aprToApy(borrowAprAt(s.current, s.params)))} r="5" fill={s.color} stroke="#ffffff" strokeWidth="2.5" />
            </g>
          );
        })}
        {hv !== null && (
          <g pointerEvents="none">
            <line x1={x(hv)} x2={x(hv)} y1={PAD.t} y2={height - PAD.b} stroke="#2a1c10" strokeOpacity="0.25" />
            {series.map((s) => (
              <circle key={s.name} cx={x(hv)} cy={y(aprToApy(borrowAprAt(hv, s.params)))} r="3.5" fill="#2a1c10" />
            ))}
          </g>
        )}
      </svg>
      <div className="absolute top-1 left-12">
        <Segmented size="sm" label="Chart range" value={full ? "full" : "zoom"} onChange={(v) => setFull(v === "full")} options={[{ value: "zoom", label: "Near the kink" }, { value: "full", label: "0–100%" }]} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-[10px] bg-wash px-3.5 py-2 text-[12.5px]">
        <p className="t-num min-w-[150px] font-medium text-ink">
          {hv === null ? "Now" : `At ${(hv * 100).toFixed(0)}% utilization`}
        </p>
        {series.map((s) => {
          const u = hv ?? s.current;
          return (
            <p key={s.name} className="t-num flex items-center gap-3">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.name}
              </span>
              <span>
                <span className="text-ink">{(aprToApy(borrowAprAt(u, s.params)) * 100).toFixed(2)}%</span>
                <span className="text-faint"> / </span>
                <span className="text-mute">{(aprToApy(supplyAprAt(u, s.params)) * 100).toFixed(2)}%</span>
              </span>
            </p>
          );
        })}
        <p className="ml-auto text-[11.5px] text-faint">borrow / supply APY</p>
      </div>
    </div>
  );
}
