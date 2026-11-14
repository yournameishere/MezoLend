"use client";

import { motion, useReducedMotion } from "motion/react";
import { MAX_UINT, fmtHF, fmtUsd, toNum } from "@/lib/format";
import { heat, heatColor } from "@/lib/math";

/** Health factor on a thermal scale: 1.0 (hot, liquidation) on the left → 3.0+ (cool) on the right. */
export function HealthBar({
  hf,
  projected,
  compact = false,
}: {
  hf?: bigint;
  projected?: bigint;
  compact?: boolean;
}) {
  const reduce = useReducedMotion();
  const pos = (x?: bigint) => {
    if (x === undefined) return undefined;
    if (x >= MAX_UINT / 2n) return 100;
    const n = toNum(x);
    return Math.min(100, Math.max(0, ((n - 0.8) / (3 - 0.8)) * 100));
  };
  const p = pos(hf);
  const pp = pos(projected);
  const liqAt = ((1 - 0.8) / 2.2) * 100;

  return (
    <div>
      <div className={`relative ${compact ? "h-2" : "h-3"} rounded-full`}>
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "linear-gradient(90deg, #d7383f 0%, #d7383f 9%, #f08a24 24%, #f6c96b 42%, #9fd18a 62%, #23885b 82%, #23885b 100%)",
          }}
        />
        <div className="absolute inset-y-[-3px] w-px bg-paper" style={{ left: `${liqAt}%` }} aria-hidden />
        {pp !== undefined && pp !== p && (
          <motion.div
            className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-ink bg-paper/40"
            animate={{ left: `${pp}%` }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 30 }}
            aria-hidden
          />
        )}
        {p !== undefined && (
          <motion.div
            className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-paper shadow-[0_0_0_1px_rgba(31,26,21,.35),0_3px_8px_rgba(31,26,21,.25)]"
            style={{ background: heatColor(heat(hf ?? 0n)) }}
            animate={{ left: `${p}%` }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 200, damping: 28 }}
          />
        )}
      </div>
      {!compact && (
        <div className="mt-2 flex justify-between text-[11.5px] text-faint">
          <span style={{ marginLeft: `calc(${liqAt}% - 18px)` }}>1.0 liquidation</span>
          <span>3.0+</span>
        </div>
      )}
    </div>
  );
}

export function HealthNumber({ hf, className = "" }: { hf?: bigint; className?: string }) {
  const color = hf === undefined ? "#c9bcb0" : heatColor(heat(hf));
  return (
    <span className={`t-num ${className}`} style={{ color }}>
      {fmtHF(hf)}
    </span>
  );
}

/**
 * Price runway: where BTC is now vs. where this loan gets liquidated.
 * The distance between them is the cushion the borrower has.
 */
export function PriceRunway({ price, liqPrice, projectedLiq }: { price: number; liqPrice: number; projectedLiq?: number }) {
  if (!price) return null;
  const hi = price * 1.15;
  const scale = (v: number) => Math.min(100, Math.max(0, (v / hi) * 100));
  const cushion = liqPrice > 0 ? (1 - liqPrice / price) * 100 : 100;
  const h = liqPrice > 0 ? Math.min(1, Math.max(0, 1 - cushion / 60)) : 0;
  return (
    <div>
      <div className="relative h-14">
        <div className="absolute top-7 right-0 left-0 h-px bg-line" />
        {liqPrice > 0 && (
          <div
            className="absolute top-[22px] h-[11px] rounded-[3px] opacity-70"
            style={{
              left: `${scale(liqPrice)}%`,
              width: `${scale(price) - scale(liqPrice)}%`,
              background: `linear-gradient(90deg, #d7383f, ${heatColor(h * 0.6)})`,
            }}
          />
        )}
        {liqPrice > 0 && (
          <Mark x={scale(liqPrice)} label={`Liquidation ${fmtUsd(liqPrice)}`} tone="text-danger" below />
        )}
        {projectedLiq !== undefined && projectedLiq > 0 && Math.abs(projectedLiq - liqPrice) > 1 && (
          <div className="absolute top-[18px] h-[19px] w-px border-l border-dashed border-ink" style={{ left: `${scale(projectedLiq)}%` }} />
        )}
        <Mark x={scale(price)} label={`BTC now ${fmtUsd(price)}`} tone="text-ink" />
      </div>
      <p className="mt-6 text-[13px] text-mute">
        {liqPrice > 0 ? (
          <>
            BTC can fall <span className="t-num font-semibold text-ink">{cushion.toFixed(1)}%</span> before this loan can be liquidated.
          </>
        ) : (
          "No loan open, so there's no liquidation price."
        )}
      </p>
    </div>
  );
}

function Mark({ x, label, tone, below }: { x: number; label: string; tone: string; below?: boolean }) {
  return (
    <div className="absolute top-0 h-14" style={{ left: `${x}%` }}>
      <div className={`absolute top-[18px] h-[19px] w-[2px] -translate-x-1/2 ${tone === "text-danger" ? "bg-danger" : "bg-ink"}`} />
      <span
        className={`t-num absolute -translate-x-1/2 text-[11.5px] font-semibold whitespace-nowrap ${tone} ${below ? "top-10" : "top-0"}`}
        style={{ transform: `translateX(${x > 75 ? "-90%" : x < 20 ? "-10%" : "-50%"})` }}
      >
        {label}
      </span>
    </div>
  );
}

/** Thin utilization bar: lent out (orange fill) vs idle. */
export function UtilBar({ u, className = "" }: { u: number; className?: string }) {
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-line ${className}`} role="meter" aria-valuenow={Math.round(u * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Utilization">
      <div
        className="h-full rounded-full transition-[width] duration-700"
        style={{
          width: `${Math.min(100, u * 100)}%`,
          background: u > 0.9 ? "#d7383f" : u > 0.8 ? "#c46a00" : "#ff9a3c",
        }}
      />
    </div>
  );
}
