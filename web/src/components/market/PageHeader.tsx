"use client";

import type { ReactNode } from "react";
import { useSelectedMarket } from "@/hooks/useProtocol";
import { metrics } from "./useMarketMetrics";
import { fmtPct } from "@/lib/format";
import { Card } from "@/components/ui/Card";

export function PageHeader({ title, intro, children }: { title: string; intro?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-6 pt-10 pb-8">
      <div className="max-w-2xl">
        <h1 className="t-title text-[30px] sm:text-[34px]">{title}</h1>
        {intro && <p className="mt-2 text-[15px] leading-relaxed text-mute">{intro}</p>}
      </div>
      {children}
    </div>
  );
}

/** Choose a market; each option shows the rate that matters on the current page. */
export function MarketPicker({ show }: { show: "supply" | "borrow" }) {
  const { markets, marketId, select } = useSelectedMarket();
  if (!markets) return <div className="h-[58px] w-[300px] animate-pulse rounded-[12px] bg-wash" />;
  return (
    <div role="radiogroup" aria-label="Market" className="flex gap-2">
      {markets.map((m) => {
        const k = metrics(m);
        const active = Number(m.id) === marketId;
        return (
          <button
            key={m.name}
            role="radio"
            aria-checked={active}
            onClick={() => select(Number(m.id))}
            className={`min-w-[150px] rounded-[12px] border px-4 py-2.5 text-left transition-all ${
              active
                ? show === "supply"
                  ? "border-tang bg-tang-soft shadow-[0_0_0_3px_rgba(255,154,60,.18)]"
                  : "border-ink bg-paper shadow-[0_0_0_3px_rgba(23,19,15,.08)]"
                : "border-line bg-paper hover:border-line-2"
            }`}
          >
            <span className="block text-[13.5px] font-semibold">{m.name} market</span>
            <span className={`t-num block text-[12.5px] ${show === "supply" ? "text-tang-deep" : "text-mute"}`}>
              {show === "supply" ? `${fmtPct(k.supplyApy)} supply APY` : `${fmtPct(k.borrowApy)} borrow APY`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Action panel: the card that holds a transaction form, accented by side. */
export function Panel({ children, tone, className = "" }: { children: ReactNode; tone?: "supply" | "borrow"; className?: string }) {
  return (
    <Card accent={tone} className={`shadow-[var(--shadow-pop)] ${className}`}>
      {children}
    </Card>
  );
}

export function Stat({ label, children, sub }: { label: ReactNode; children: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div className="text-[12.5px] text-mute">{label}</div>
      <div className="t-num mt-1 text-[21px] font-semibold tracking-[-0.02em]">{children}</div>
      {sub && <div className="t-num mt-0.5 text-[12.5px] text-faint">{sub}</div>}
    </div>
  );
}
