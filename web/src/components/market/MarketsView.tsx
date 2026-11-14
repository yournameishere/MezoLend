"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useMarkets } from "@/hooks/useProtocol";
import { PageHeader } from "./PageHeader";
import { metrics, marketColor, rateParams } from "./useMarketMetrics";
import { RateCurve } from "@/components/viz/RateCurve";
import { UtilBar } from "@/components/viz/Thermal";
import { Skeleton } from "@/components/ui/Primitives";
import { Badge, Card, CardBody, CardHeader, Table, Td, Th } from "@/components/ui/Card";
import { Term } from "@/components/ui/Term";
import { Button } from "@/components/ui/Button";
import { TokenDot } from "@/components/ui/AmountInput";
import { fmtNum, fmtPct, toNum } from "@/lib/format";
import type { GlossaryKey } from "@/lib/glossary";
import { setSettings } from "@/lib/store";

export function MarketsView() {
  const { markets } = useMarkets();

  const rows: { label: string; term?: GlossaryKey; get: (m: NonNullable<typeof markets>[number]) => string }[] = [
    { label: "Supply APY", term: "supplyApy", get: (m) => fmtPct(metrics(m).supplyApy) },
    { label: "Borrow APY", term: "borrowApy", get: (m) => fmtPct(metrics(m).borrowApy) },
    { label: "Total supplied", get: (m) => `${fmtNum(metrics(m).supplied, 2)} MUSD` },
    { label: "Total borrowed", get: (m) => `${fmtNum(metrics(m).borrowed, 2)} MUSD` },
    { label: "Available liquidity", term: "availableLiquidity", get: (m) => `${fmtNum(metrics(m).idle, 2)} MUSD` },
    { label: "Utilization", term: "utilization", get: (m) => fmtPct(metrics(m).utilization, 1) },
    { label: "Collateral", get: (m) => m.collaterals.map((c) => c.symbol).join(", ") },
    { label: "Max LTV", term: "ltv", get: (m) => fmtPct(m.collaterals[0]?.ltv, 0) },
    { label: "Liquidation threshold", term: "liquidationThreshold", get: (m) => fmtPct(m.collaterals[0]?.liquidationThreshold, 0) },
    { label: "Liquidation bonus", term: "liquidationBonus", get: (m) => fmtPct(m.collaterals[0]?.liquidationBonus, 1) },
    { label: "Close factor", term: "closeFactor", get: (m) => fmtPct(m.closeFactor, 0) },
    { label: "Origination fee", term: "originationFee", get: (m) => fmtPct(m.originationFee, 2) },
    { label: "Reserve factor", term: "reserveFactor", get: (m) => fmtPct(m.reserveFactor, 0) },
    { label: "Rate kink", get: (m) => `${fmtPct(m.kink, 0)} utilization` },
    { label: "Minimum loan", get: (m) => `${fmtNum(toNum(m.minBorrow), 0)} MUSD` },
    { label: "Open accounts", get: (m) => String(Number(m.accountCount)) },
  ];

  return (
    <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
      <PageHeader
        title="Markets"
        intro="Each market is a separate MUSD pool with its own collateral rules and rate curve, so a problem in one can't spill into another."
      />

      <div className="grid gap-6 md:grid-cols-2">
        {(markets ?? [undefined, undefined]).map((m, i) =>
          m ? (
            <Card key={m.name} as="article">
              <div className="flex items-start justify-between gap-4 px-6 pt-6">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-full border border-line bg-wash">
                    <TokenDot symbol="MUSD" size={26} />
                  </span>
                  <div>
                    <h2 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-0.02em]">
                      {m.name}
                      <span className="h-2 w-2 rounded-full" style={{ background: marketColor(Number(m.id)) }} />
                    </h2>
                    <p className="flex items-center gap-1 text-[13px] text-mute">
                      MUSD against <TokenDot symbol="BTC" size={13} /> BTC
                    </p>
                  </div>
                </div>
                {m.poolPaused || m.borrowPaused ? <Badge tone="danger">Paused</Badge> : <Badge tone="safe">Open</Badge>}
              </div>
              <p className="mt-3 px-6 text-[14px] text-mute">{m.description}</p>
              <div className="mt-5 grid grid-cols-3 border-y border-line">
                {[
                  { l: "Supply APY", v: fmtPct(metrics(m).supplyApy), tone: "text-tang-deep" },
                  { l: "Borrow APY", v: fmtPct(metrics(m).borrowApy) },
                  { l: "Max LTV", v: fmtPct(m.collaterals[0]?.ltv, 0) },
                ].map((x, j) => (
                  <div key={x.l} className={`px-6 py-4 ${j ? "border-l border-line" : ""}`}>
                    <p className="text-[12.5px] text-mute">{x.l}</p>
                    <p className={`t-num mt-0.5 text-[22px] font-semibold tracking-[-0.02em] ${x.tone ?? ""}`}>{x.v}</p>
                  </div>
                ))}
              </div>
              <div className="px-6 pt-4">
                <div className="flex justify-between text-[13px] text-mute">
                  <span>
                    {fmtNum(metrics(m).borrowed, 2)} of {fmtNum(metrics(m).supplied, 2)} MUSD lent out
                  </span>
                  <span className="t-num">{fmtPct(metrics(m).utilization, 1)}</span>
                </div>
                <UtilBar u={metrics(m).utilization} className="mt-2" />
              </div>
              <div className="flex flex-wrap items-center gap-2 px-6 pt-5 pb-6">
                <Link href="/supply" onClick={() => setSettings({ marketId: Number(m.id) })}>
                  <Button variant="supply">Supply</Button>
                </Link>
                <Link href="/borrow" onClick={() => setSettings({ marketId: Number(m.id) })}>
                  <Button variant="borrow">Borrow</Button>
                </Link>
                <Link href={`/markets/${Number(m.id)}`} className="ml-auto inline-flex items-center gap-1 text-[13.5px] font-semibold text-tang-deep hover:underline">
                  Details <ArrowRight size={14} />
                </Link>
              </div>
            </Card>
          ) : (
            <Skeleton key={i} className="h-[330px] w-full rounded-[var(--radius-panel)]" />
          ),
        )}
      </div>

      <Card className="mt-6">
        <CardHeader title="Side by side" description="Every parameter is read from the market's contracts" />
        <div className="mt-4">
          <Table minWidth={560}>
            <thead>
              <tr>
                <Th>Parameter</Th>
                {markets?.map((m) => (
                  <Th key={m.name} align="right">
                    {m.name}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <Td className="text-mute">{r.term ? <Term k={r.term}>{r.label}</Term> : r.label}</Td>
                  {markets?.map((m) => (
                    <Td key={m.name} align="right" className="t-num font-medium">
                      {r.get(m)}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Interest rate curves" description="Borrow APY (solid) and supply APY (dashed) by utilization. Dots mark where each market is now." />
        <CardBody>
          {markets ? (
            <RateCurve series={markets.map((x) => ({ name: x.name, params: rateParams(x), current: metrics(x).utilization, color: marketColor(Number(x.id)) }))} />
          ) : (
            <Skeleton className="h-[280px] w-full" />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
