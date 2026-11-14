"use client";

import type { ReactNode } from "react";
import { useSelectedMarket } from "@/hooks/useProtocol";
import { metrics } from "./useMarketMetrics";
import { fmtPct } from "@/lib/format";

export function PageHeader({ title, intro, children }: { title: string; intro?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-6 pt-10 pb-8 sm:pt-14">
      <div className="max-w-2xl">
        <h1 className="t-display text-[36px] sm:text-[46px]">{title}</h1>
        {intro && <p className="mt-3 text-[16px] leading-relaxed text-mute">{intro}</p>}
      </div>
      {children}
    </div>
  );
}

/** Choose a market; each option shows the rate that matters on the current page. */
export function MarketPicker({ show }: { show: "supply" | "borrow" }) {
  const { markets, marketId, select } = useSelectedMarket();
  if (!markets) return <div className="h-[58px] w-[300px] animate-pulse rounded-[10px] bg-tang-soft" />;
  return (
    <div role="radiogroup" aria-label="Market" className="flex w-full gap-2 sm:w-auto">
      {markets.map((m) => {
        const k = metrics(m);
        const active = Number(m.id) === marketId;
        return (
          <button
            key={m.name}
            role="radio"
            aria-checked={active}
            onClick={() => select(Number(m.id))}
            className={`min-w-0 flex-1 rounded-[10px] border-[1.5px] px-4 py-2.5 text-left transition-colors sm:min-w-[160px] sm:flex-none ${
              active
                ? show === "supply"
                  ? "border-ink bg-tang-soft"
                  : "border-ink bg-paper"
                : "border-line-2 bg-paper hover:border-ink"
            }`}
          >
            <span className="block text-[14px] font-bold">{m.name} market</span>
            <span className={`t-num block text-[12.5px] ${show === "supply" ? "text-tang-deep" : "text-mute"}`}>
              {show === "supply" ? `Lenders earn ${fmtPct(k.supplyApy)}` : `Borrowers pay ${fmtPct(k.borrowApy)}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Action panel: the ticket that holds a transaction form. The one strongly outlined surface on a page. */
export function Panel({ children, className = "" }: { children: ReactNode; tone?: "supply" | "borrow"; className?: string }) {
  return <section className={`relative rounded-[16px] border-[1.5px] border-ink bg-paper ${className}`}>{children}</section>;
}

export function Stat({ label, children, sub }: { label: ReactNode; children: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div className="text-[12.5px] text-mute">{label}</div>
      <div className="t-num mt-1 text-[22px] font-bold tracking-[-0.02em]">{children}</div>
      {sub && <div className="t-num mt-0.5 text-[12.5px] text-mute">{sub}</div>}
    </div>
  );
}
