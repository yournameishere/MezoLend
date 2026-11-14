"use client";

import { motion } from "motion/react";
import { fmtNum } from "@/lib/format";

/**
 * The loan meter: the whole bar is what your BTC is worth. The dark fill is what you owe against it.
 * Two marks show where the market stops new borrowing (max LTV) and where the loan can be liquidated
 * (liquidation threshold). An optional ghost fill previews the debt after the action being typed.
 */
export function LoanMeter({
  collateralUsd,
  debtUsd,
  nextDebtUsd,
  ltv,
  lt,
  size = "md",
  className = "",
}: {
  collateralUsd: number;
  debtUsd: number;
  /** Debt after the pending action, shown as a hatched preview. */
  nextDebtUsd?: number;
  ltv: number;
  lt: number;
  size?: "md" | "lg";
  className?: string;
}) {
  const ratio = collateralUsd > 0 ? debtUsd / collateralUsd : debtUsd > 0 ? 1 : 0;
  const next = nextDebtUsd !== undefined && collateralUsd > 0 ? nextDebtUsd / collateralUsd : undefined;
  const shown = next ?? ratio;
  const over = shown >= lt;
  const nearLimit = shown > ltv;
  const pct = (x: number) => `${Math.min(Math.max(x, 0), 1) * 100}%`;
  const h = size === "lg" ? "h-5" : "h-3.5";

  return (
    <div className={className}>
      <div className="relative pt-5">
        {/* marks */}
        <Mark at={ltv} label={`Limit ${fmtNum(ltv * 100, 0)}%`} tone="limit" />
        <Mark at={lt} label={`Liquidation ${fmtNum(lt * 100, 0)}%`} tone="liq" />
        <div
          className={`relative ${h} overflow-hidden rounded-[4px] border border-tang-line bg-tang-soft`}
          role="meter"
          aria-label="Debt as a share of collateral value"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(Math.min(shown, 1) * 100)}
          aria-valuetext={`${fmtNum(shown * 100, 1)}% of collateral value borrowed`}
        >
          {/* danger zone beyond the liquidation threshold */}
          <div className="absolute inset-y-0 right-0 bg-danger-soft" style={{ left: pct(lt) }} />
          {next !== undefined && next > ratio && (
            <motion.div
              className="meter-hatch absolute inset-y-0 left-0"
              initial={false}
              animate={{ width: pct(next) }}
              transition={{ type: "spring", stiffness: 260, damping: 30 }}
            />
          )}
          <motion.div
            className={`absolute inset-y-0 left-0 ${over ? "bg-danger" : "bg-ink"}`}
            initial={false}
            animate={{ width: pct(next !== undefined && next < ratio ? next : ratio) }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
          />
        </div>
      </div>
      <div className="mt-2 flex justify-between text-[12.5px] text-mute">
        <span>
          <span className={`font-semibold ${over ? "text-danger" : nearLimit ? "text-warn" : "text-ink"}`}>
            {fmtNum(shown * 100, 1)}%
          </span>{" "}
          of your BTC value borrowed
        </span>
        <span className="hidden sm:inline">100%</span>
      </div>
    </div>
  );
}

function Mark({ at, label, tone }: { at: number; label: string; tone: "limit" | "liq" }) {
  const color = tone === "limit" ? "bg-tang-deep" : "bg-danger";
  const text = tone === "limit" ? "text-tang-deep" : "text-danger";
  // The limit label ends at its mark; the liquidation label starts at its mark, or hugs the bar's right
  // edge in a short form when the mark is near the end, so the two never collide or overflow on phones.
  const tight = tone === "liq" && at > 0.72;
  return (
    <>
      <span
        aria-hidden
        className={`pointer-events-none absolute top-[15px] -bottom-[3px] z-10 w-[2px] -translate-x-1/2 rounded-full ${color}`}
        style={{ left: `${at * 100}%` }}
      />
      <span
        aria-hidden
        className={`pointer-events-none absolute top-0 text-[11.5px] leading-none font-semibold whitespace-nowrap ${text}`}
        style={
          tone === "limit"
            ? { right: `calc(${(1 - at) * 100}% + 5px)` }
            : tight
              ? { right: 0 }
              : { left: `calc(${at * 100}% + 5px)` }
        }
      >
        {tight ? (
          <>
            <span className="sm:hidden">{label.replace("Liquidation", "Liq.")}</span>
            <span className="hidden sm:inline">{label}</span>
          </>
        ) : (
          label
        )}
      </span>
    </>
  );
}
