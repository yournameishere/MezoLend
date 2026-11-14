"use client";

import { useMemo, useState } from "react";
import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import { useMarkets, type MarketInfo } from "@/hooks/useProtocol";
import { useSnapshots } from "@/hooks/useActivity";
import { PageHeader } from "./PageHeader";
import { metrics, marketColor } from "./useMarketMetrics";
import { LineChart } from "@/components/viz/LineChart";
import { Num, Skeleton } from "@/components/ui/Primitives";
import { Card, CardBody, CardHeader, EmptyState, StatCell, StatGrid } from "@/components/ui/Card";
import { Term } from "@/components/ui/Term";
import { LENS, mezoLendLensAbi } from "@/config/contracts";
import { fmtNum, fmtUsd, toNum } from "@/lib/format";
import { aprToApy, heatColor, heat } from "@/lib/math";
import { chain } from "@/lib/wagmi";

type Pos = { account: Address; debt: bigint; collateralValue: bigint; liquidationCapacity: bigint; healthFactor: bigint; dataOk: boolean };

export function AnalyticsView() {
  const { markets } = useMarkets();
  const accounts = useReadContracts({
    contracts: (markets ?? []).map((m) => ({
      address: LENS,
      abi: mezoLendLensAbi,
      functionName: "getAccounts" as const,
      args: [m.id, 0n, 500n] as const,
      chainId: chain.id,
    })),
    query: { enabled: !!markets?.length, refetchInterval: 15_000 },
  });

  const loans: (Pos & { market: string })[] = useMemo(() => {
    if (!accounts.data || !markets) return [];
    return accounts.data.flatMap((r, i) => {
      if (r.status !== "success") return [];
      const [list] = r.result as unknown as [readonly Pos[], bigint];
      return list.filter((p) => p.debt > 0n && p.dataOk).map((p) => ({ ...p, market: markets[i].name }));
    });
  }, [accounts.data, markets]);

  const totals = useMemo(() => {
    if (!markets) return undefined;
    const ms = markets.map(metrics);
    return {
      supplied: ms.reduce((a, x) => a + x.supplied, 0),
      borrowed: ms.reduce((a, x) => a + x.borrowed, 0),
      collateralUsd: ms.reduce((a, x) => a + x.collateralUsd, 0),
      collateralBtc: ms.reduce((a, x) => a + x.collateralBtc, 0),
      reserves: ms.reduce((a, x) => a + x.reserves, 0),
      badDebt: markets.reduce((a, m) => a + toNum(m.totalBadDebt), 0),
    };
  }, [markets]);

  const loading = accounts.isPending && !!markets?.length;

  return (
    <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
      <PageHeader title="Analytics" intro="Protocol-wide numbers, borrower health and a BTC price stress test, all computed live from the contracts." />

      <StatGrid cols={6}>
        <StatCell label="Total value locked" sub="MUSD plus BTC collateral">
          {totals ? <Num value={totals.supplied + totals.collateralUsd} format={(n) => fmtUsd(n)} /> : <Skeleton className="h-7 w-24" />}
        </StatCell>
        <StatCell label="MUSD supplied">{totals ? <Num value={totals.supplied} format={(n) => fmtNum(n, 2, 2)} /> : <Skeleton className="h-7 w-20" />}</StatCell>
        <StatCell label="MUSD borrowed">{totals ? <Num value={totals.borrowed} format={(n) => fmtNum(n, 2, 2)} /> : <Skeleton className="h-7 w-20" />}</StatCell>
        <StatCell label="BTC collateral" sub={totals ? fmtUsd(totals.collateralUsd) : undefined}>
          {totals ? fmtNum(totals.collateralBtc, 5) : <Skeleton className="h-7 w-20" />}
        </StatCell>
        <StatCell label={<Term k="reserveFactor">Protocol reserves</Term>} sub="MUSD">
          {totals ? fmtNum(totals.reserves, 4) : <Skeleton className="h-7 w-16" />}
        </StatCell>
        <StatCell label="Bad debt" sub="MUSD socialised">
          {totals ? fmtNum(totals.badDebt, 2) : <Skeleton className="h-7 w-12" />}
        </StatCell>
      </StatGrid>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Borrower health" description="Debt in each health factor range, across all markets" />
          <CardBody>{loading ? <Skeleton className="h-52 w-full" /> : <HealthHistogram loans={loans} />}</CardBody>
        </Card>
        <Card>
          <CardHeader title="Stress test" description="Debt that would become liquidatable if BTC fell, holding everything else equal" />
          <CardBody>{loading ? <Skeleton className="h-52 w-full" /> : <StressTest loans={loans} />}</CardBody>
        </Card>
      </div>

      {markets?.map((m) => <MarketCharts key={m.name} m={m} />)}
    </div>
  );
}

const buckets = [
  { label: "< 1.0", lo: 0, hi: 1 },
  { label: "1.0–1.2", lo: 1, hi: 1.2 },
  { label: "1.2–1.5", lo: 1.2, hi: 1.5 },
  { label: "1.5–2", lo: 1.5, hi: 2 },
  { label: "2–3", lo: 2, hi: 3 },
  { label: "3+", lo: 3, hi: Infinity },
];

function HealthHistogram({ loans }: { loans: Pos[] }) {
  if (!loans.length) return <EmptyState title="No open loans yet" />;
  const data = buckets.map((b) => {
    const inB = loans.filter((l) => {
      const hf = toNum(l.healthFactor);
      return hf >= b.lo && hf < b.hi;
    });
    return { ...b, count: inB.length, debt: inB.reduce((a, l) => a + toNum(l.debt), 0) };
  });
  const max = Math.max(...data.map((d) => d.debt), 1);
  return (
    <div className="flex h-52 items-end gap-3">
      {data.map((d) => (
        <div key={d.label} className="flex h-full flex-1 flex-col justify-end text-center">
          <span className="t-num mb-1 text-[12px] text-mute">{d.count ? fmtNum(d.debt, 1) : ""}</span>
          <div
            className="w-full rounded-t-[6px] transition-[height] duration-700"
            style={{ height: `${(d.debt / max) * 76 + (d.count ? 4 : 1)}%`, background: d.count ? heatColor(heat(Math.min(d.lo + 0.01, 3))) : "#efe3d6" }}
          />
          <span className="mt-2 text-[12px] font-medium">{d.label}</span>
          <span className="text-[11.5px] text-faint">
            {d.count} loan{d.count === 1 ? "" : "s"}
          </span>
        </div>
      ))}
    </div>
  );
}

function StressTest({ loans }: { loans: Pos[] }) {
  const [drop, setDrop] = useState(30);
  if (!loans.length) return <EmptyState title="No open loans to stress" />;
  const steps = [0, 10, 20, 30, 40, 50, 60];
  const at = (d: number) => {
    const f = BigInt(Math.round((1 - d / 100) * 1e6));
    const hit = loans.filter((l) => (l.liquidationCapacity * f) / 1_000_000n < l.debt);
    return { count: hit.length, debt: hit.reduce((a, l) => a + toNum(l.debt), 0) };
  };
  const total = loans.reduce((a, l) => a + toNum(l.debt), 0);
  const cur = at(drop);
  return (
    <div>
      <label className="block">
        <span className="flex justify-between text-[13.5px]">
          <span className="text-mute">BTC falls by</span>
          <span className="t-num font-semibold">{drop}%</span>
        </span>
        <input type="range" min={0} max={80} value={drop} onChange={(e) => setDrop(Number(e.target.value))} className="thermal w-full" aria-label="BTC price drop" />
      </label>
      <p className="mt-2 text-[14.5px]">
        <span className="t-num text-[24px] font-semibold tracking-[-0.02em]">{fmtNum(cur.debt, 2)} MUSD</span>{" "}
        <span className="text-mute">
          of {fmtNum(total, 2)} borrowed ({cur.count} loan{cur.count === 1 ? "" : "s"}) would be liquidatable.
        </span>
      </p>
      <div className="mt-4 grid grid-cols-7 gap-1.5">
        {steps.map((s) => {
          const r = at(s);
          const share = total ? r.debt / total : 0;
          return (
            <button key={s} type="button" onClick={() => setDrop(s)} className="text-center" aria-label={`BTC down ${s}%`}>
              <div className={`relative h-16 overflow-hidden rounded-[6px] ${s === drop ? "ring-2 ring-ink/70" : ""} bg-wash`}>
                <div className="absolute inset-x-0 bottom-0 bg-danger/80 transition-[height] duration-500" style={{ height: `${share * 100}%` }} />
              </div>
              <span className={`mt-1 block text-[11.5px] ${s === drop ? "font-semibold text-ink" : "text-faint"}`}>−{s}%</span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[12px] text-faint">A liquidation repays at most half a loan per call, so less collateral changes hands than this shows.</p>
    </div>
  );
}

function MarketCharts({ m }: { m: MarketInfo }) {
  const snaps = useSnapshots(m.pool);
  const s = snaps.data ?? [];
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: marketColor(Number(m.id)) }} />
              {m.name}: supplied and borrowed
            </span>
          }
          description="MUSD, recorded at every pool action"
        />
        <CardBody>
          {snaps.isLoading ? (
            <Skeleton className="h-[220px] w-full" />
          ) : (
            <LineChart
              format={(v) => fmtNum(v, 0)}
              series={[
                { name: "Supplied", color: "#f7931a", area: true, points: s.map((x) => ({ t: x.ts, v: x.totalAssets })) },
                { name: "Borrowed", color: "#2a1c10", points: s.map((x) => ({ t: x.ts, v: x.totalBorrows })) },
              ]}
            />
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: marketColor(Number(m.id)) }} />
              {m.name}: utilization and APY
            </span>
          }
          description="How rates followed demand"
        />
        <CardBody>
          {snaps.isLoading ? (
            <Skeleton className="h-[220px] w-full" />
          ) : (
            <LineChart
              format={(v) => `${(v * 100).toFixed(0)}%`}
              series={[
                { name: "Utilization", color: "#8f7c6c", points: s.map((x) => ({ t: x.ts, v: x.utilization })) },
                { name: "Borrowers pay", color: "#2a1c10", dashed: true, points: s.map((x) => ({ t: x.ts, v: aprToApy(x.borrowApr) })) },
                { name: "Lenders earn", color: "#f7931a", area: true, points: s.map((x) => ({ t: x.ts, v: aprToApy(x.supplyApr) })) },
              ]}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
