"use client";

import { useId, useMemo, useRef, useState } from "react";
import { fmtDate } from "@/lib/format";

export type Series = { name: string; color: string; points: { t: number; v: number }[]; area?: boolean; dashed?: boolean };

const W = 640;

/** Step-line time series for on-chain snapshots (values only change at transactions). */
export function LineChart({
  series,
  height = 220,
  format,
  emptyText = "No activity recorded yet.",
}: {
  series: Series[];
  height?: number;
  format: (v: number) => string;
  emptyText?: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId().replace(/:/g, "");
  const PAD = { l: 52, r: 14, t: 14, b: 28 };
  const [now] = useState(() => Date.now() / 1000);

  const { t0, t1, vMax } = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    const t0 = all.length ? Math.min(...all.map((p) => p.t)) : now - 3600;
    const t1 = Math.max(now, ...all.map((p) => p.t));
    const vMax = Math.max(...all.map((p) => p.v), 0) * 1.15 || 1;
    return { t0, t1: t1 === t0 ? t0 + 60 : t1, vMax };
  }, [series, now]);

  const hasData = series.some((s) => s.points.length > 0);
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (v: number) => height - PAD.b - (v / vMax) * (height - PAD.t - PAD.b);

  const stepPath = (pts: { t: number; v: number }[]) => {
    if (!pts.length) return "";
    let d = `M${x(pts[0].t)},${y(pts[0].v)}`;
    for (let i = 1; i < pts.length; i++) d += `H${x(pts[i].t)}V${y(pts[i].v)}`;
    d += `H${x(t1)}`;
    return d;
  };

  const valueAt = (pts: { t: number; v: number }[], t: number) => {
    let v: number | undefined;
    for (const p of pts) if (p.t <= t) v = p.v;
    return v;
  };

  if (!hasData) {
    return (
      <div className="grid place-items-center rounded-[12px] border border-dashed border-line text-[13px] text-faint" style={{ height }}>
        {emptyText}
      </div>
    );
  }

  return (
    <div className="relative">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${height}`}
        className="w-full touch-none select-none"
        onPointerMove={(e) => {
          const r = ref.current?.getBoundingClientRect();
          if (!r) return;
          const px = ((e.clientX - r.left) / r.width) * W;
          const f = Math.min(1, Math.max(0, (px - PAD.l) / (W - PAD.l - PAD.r)));
          setHover(t0 + f * (t1 - t0));
        }}
        onPointerLeave={() => setHover(null)}
        role="img"
      >
        <defs>
          {series.map((s, i) => (
            <linearGradient key={i} id={`${gid}-${i}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(vMax * f)} y2={y(vMax * f)} stroke="#ece6df" strokeDasharray={f ? "2 4" : ""} />
            <text x={PAD.l - 8} y={y(vMax * f) + 4} textAnchor="end" fontSize="11" fill="#a0948a" className="t-num">
              {format(vMax * f)}
            </text>
          </g>
        ))}
        <text x={PAD.l} y={height - 8} fontSize="11" fill="#a0948a">
          {fmtDate(t0)}
        </text>
        <text x={W - PAD.r} y={height - 8} fontSize="11" fill="#a0948a" textAnchor="end">
          now
        </text>
        {series.map((s, i) => {
          const d = stepPath(s.points);
          return (
            <g key={s.name}>
              {s.area && d && <path d={`${d}V${y(0)}H${x(s.points[0].t)}Z`} fill={`url(#${gid}-${i})`} />}
              <path d={d} fill="none" stroke={s.color} strokeWidth="1.8" strokeDasharray={s.dashed ? "5 4" : undefined} />
            </g>
          );
        })}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={height - PAD.b} stroke="#1f1a15" strokeOpacity="0.25" />}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-2 left-16 rounded-[10px] border border-line bg-paper/90 px-3 py-2 text-[12.5px] backdrop-blur">
          <p className="mb-1 text-mute">{fmtDate(hover)}</p>
          {series.map((s) => {
            const v = valueAt(s.points, hover);
            return (
              <p key={s.name} className="t-num flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                <span className="text-mute">{s.name}</span>
                <span className="ml-auto pl-3 text-ink">{v === undefined ? "—" : format(v)}</span>
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}
