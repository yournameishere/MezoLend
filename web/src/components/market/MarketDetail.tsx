"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ChevronLeft } from "lucide-react";
import { useMarkets } from "@/hooks/useProtocol";
import { useSnapshots } from "@/hooks/useActivity";
import { metrics, marketColor, rateParams } from "./useMarketMetrics";
import { RateCurve } from "@/components/viz/RateCurve";
import { LineChart } from "@/components/viz/LineChart";
import { UtilBar } from "@/components/viz/Thermal";
import { ExplorerLink, Num, Row, Skeleton, TimeAgo } from "@/components/ui/Primitives";
import { Badge, Card, CardBody, CardHeader, EmptyState, StatCell, StatGrid, Table, Td, Th } from "@/components/ui/Card";
import { Term } from "@/components/ui/Term";
import { Button } from "@/components/ui/Button";
import { TokenDot } from "@/components/ui/AmountInput";
import { fmtNum, fmtPct, fmtUsd, toNum } from "@/lib/format";
import { aprToApy } from "@/lib/math";
import { setSettings } from "@/lib/store";

export function MarketDetail({ id }: { id: number }) {
  const { markets, isLoading } = useMarkets();
  const m = markets?.[id];
  const snaps = useSnapshots(m?.pool);
  const k = m ? metrics(m) : undefined;

  const rateSeries = useMemo(() => {
    const s = snaps.data ?? [];
    return [
      { name: "Borrow APY", color: "#17130f", points: s.map((x) => ({ t: x.ts, v: aprToApy(x.borrowApr) })) },
      { name: "Supply APY", color: "#ff9a3c", area: true, points: s.map((x) => ({ t: x.ts, v: aprToApy(x.supplyApr) })) },
    ];
  }, [snaps.data]);
  const sizeSeries = useMemo(() => {
    const s = snaps.data ?? [];
    return [
      { name: "Supplied", color: "#ff9a3c", area: true, points: s.map((x) => ({ t: x.ts, v: x.totalAssets })) },
      { name: "Borrowed", color: "#17130f", points: s.map((x) => ({ t: x.ts, v: x.totalBorrows })) },
    ];
  }, [snaps.data]);

  if (!isLoading && markets && !m) {
    return (
      <div className="mx-auto max-w-[1240px] px-4 py-16 sm:px-6">
        <Card>
          <EmptyState
            title="This market doesn't exist"
            action={
              <Link href="/markets">
                <Button variant="outline">See all markets</Button>
              </Link>
            }
          >
            MezoLend has {markets.length} markets. Market numbers start at 0.
          </EmptyState>
        </Card>
      </div>
    );
  }

  const paused = m && (m.poolPaused || m.borrowPaused || m.liquidationPaused);

  return (
    <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
      <div className="pt-8">
        <Link href="/markets" className="inline-flex items-center gap-1 text-[13.5px] text-mute hover:text-ink">
          <ChevronLeft size={16} /> All markets
        </Link>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-6 pt-4 pb-8">
        <div className="flex items-center gap-4">
          <span className="grid h-14 w-14 place-items-center rounded-full border border-line bg-wash">
            <TokenDot symbol="MUSD" size={32} />
          </span>
          <div>
            <h1 className="t-title flex items-center gap-2.5 text-[30px] sm:text-[34px]">
              {m?.name ?? <Skeleton className="h-9 w-32" />} market
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: marketColor(id) }} />
            </h1>
            <p className="mt-1 max-w-xl text-[15px] text-mute">{m?.description}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href="/supply" onClick={() => setSettings({ marketId: id })}>
            <Button variant="supply" size="lg">
              Supply
            </Button>
          </Link>
          <Link href="/borrow" onClick={() => setSettings({ marketId: id })}>
            <Button variant="borrow" size="lg">
              Borrow
            </Button>
          </Link>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {m && !paused && <Badge tone="safe">All actions open</Badge>}
        {m?.poolPaused && <Badge tone="danger">Supply and borrowing paused</Badge>}
        {m?.borrowPaused && <Badge tone="danger">Borrowing and withdrawals paused</Badge>}
        {m?.liquidationPaused && <Badge tone="danger">Liquidations paused</Badge>}
        {k && <Badge>{k.btcSource === 1 ? "Price from Skip oracle" : k.btcSource === 2 ? "Price from Pyth fallback" : "Price unavailable"}</Badge>}
      </div>

      <StatGrid>
        <StatCell label={<Term k="supplyApy" />}>
          {k ? <Num value={k.supplyApy * 100} format={(n) => `${n.toFixed(2)}%`} className="text-tang-deep" /> : <Skeleton className="h-7 w-20" />}
        </StatCell>
        <StatCell label={<Term k="borrowApy" />}>{k ? <Num value={k.borrowApy * 100} format={(n) => `${n.toFixed(2)}%`} /> : <Skeleton className="h-7 w-20" />}</StatCell>
        <StatCell label="Total supplied" sub={k ? `${fmtNum(k.idle, 2)} MUSD available` : undefined}>
          {k ? <Num value={k.supplied} format={(n) => `${fmtNum(n, 2, 2)} MUSD`} /> : <Skeleton className="h-7 w-24" />}
        </StatCell>
        <StatCell label="Total borrowed" sub={k ? `${fmtPct(k.utilization, 1)} utilization` : undefined}>
          {k ? <Num value={k.borrowed} format={(n) => `${fmtNum(n, 2, 2)} MUSD`} /> : <Skeleton className="h-7 w-24" />}
        </StatCell>
      </StatGrid>
      {k && <UtilBar u={k.utilization} className="mt-4 h-2" />}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Rates over time" description="Every pool action writes a snapshot on-chain" />
          <CardBody>{snaps.isLoading ? <Skeleton className="h-[220px] w-full" /> : <LineChart series={rateSeries} format={(v) => `${(v * 100).toFixed(1)}%`} />}</CardBody>
        </Card>
        <Card>
          <CardHeader title="Pool size" description="Supplied and borrowed MUSD" />
          <CardBody>{snaps.isLoading ? <Skeleton className="h-[220px] w-full" /> : <LineChart series={sizeSeries} format={(v) => fmtNum(v, 0)} />}</CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Rate model" description="The kinked curve stored in this market's interest-rate contract" />
        <CardBody className="grid gap-8 lg:grid-cols-[1.5fr_1fr]">
          {m ? <RateCurve series={[{ name: m.name, params: rateParams(m), current: k!.utilization, color: marketColor(id) }]} /> : <Skeleton className="h-[280px] w-full" />}
          <div>
            <p className="text-[14px] leading-relaxed text-mute">
              Borrow APR starts at {fmtPct(m?.baseRatePerYear, 1)}, rises by {fmtPct(m?.slope1PerYear, 1)} up to the {fmtPct(m?.kink, 0)} kink, then by
              another {fmtPct(m?.slope2PerYear, 0)} as the pool approaches full utilization. Lenders receive the borrow rate × utilization, minus the{" "}
              {fmtPct(m?.reserveFactor, 0)} reserve factor.
            </p>
            <div className="mt-4 rounded-[10px] bg-wash px-3.5 py-1.5">
              <Row label="Base rate">{fmtPct(m?.baseRatePerYear, 2)} APR</Row>
              <Row label="Slope below kink">{fmtPct(m?.slope1PerYear, 2)} APR</Row>
              <Row label="Slope above kink">{fmtPct(m?.slope2PerYear, 0)} APR</Row>
              <Row label="Kink">{fmtPct(m?.kink, 0)}</Row>
              <Row label={<Term k="reserveFactor" />}>{fmtPct(m?.reserveFactor, 0)}</Row>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Accepted collateral" />
        <div className="mt-4">
          <Table minWidth={760}>
            <thead>
              <tr>
                <Th>Asset</Th>
                <Th align="right">
                  <Term k="oracle">Oracle price</Term>
                </Th>
                <Th align="right">
                  <Term k="ltv" />
                </Th>
                <Th align="right">
                  <Term k="liquidationThreshold" />
                </Th>
                <Th align="right">
                  <Term k="liquidationBonus" align="right" />
                </Th>
                <Th align="right">Deposited</Th>
                <Th align="right">Cap</Th>
              </tr>
            </thead>
            <tbody>
              {m?.collaterals.map((c) => (
                <tr key={c.asset}>
                  <Td>
                    <span className="flex items-center gap-2 font-semibold">
                      <TokenDot symbol={c.symbol} /> {c.symbol}
                    </span>
                    <ExplorerLink address={c.asset} className="text-[11.5px]" />
                  </Td>
                  <Td align="right">
                    <span className="t-num">{c.priceOk ? fmtUsd(toNum(c.price)) : <span className="text-danger">Stale</span>}</span>
                    <span className="block text-[12px] text-faint">
                      {c.priceSource === 1 ? "Skip" : c.priceSource === 2 ? "Pyth" : "No source"}
                      {c.priceUpdatedAt ? <TimeAgo ts={Number(c.priceUpdatedAt)} prefix=", " /> : null}
                    </span>
                  </Td>
                  <Td align="right" className="t-num">
                    {fmtPct(c.ltv, 0)}
                  </Td>
                  <Td align="right" className="t-num">
                    {fmtPct(c.liquidationThreshold, 0)}
                  </Td>
                  <Td align="right" className="t-num">
                    {fmtPct(c.liquidationBonus, 1)}
                  </Td>
                  <Td align="right">
                    <span className="t-num">
                      {fmtNum(toNum(c.totalDeposited, c.decimals), 6)} {c.symbol}
                    </span>
                    <span className="block text-[12px] text-faint">{c.priceOk ? fmtUsd(toNum(c.totalDeposited, c.decimals) * toNum(c.price)) : ""}</span>
                  </Td>
                  <Td align="right" className="t-num">
                    {c.supplyCap > 0n ? `${fmtNum(toNum(c.supplyCap, c.decimals), 0)} ${c.symbol}` : "None"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Liquidation rules" />
          <CardBody className="pt-2">
            <Row label={<Term k="closeFactor" />}>{fmtPct(m?.closeFactor, 0)} of debt per call</Row>
            <Row label="Full liquidation allowed below">health factor {m ? toNum(m.fullLiquidationHealthFactor).toFixed(2) : "—"}</Row>
            <Row label="Small loans closed in full up to">{m ? `${fmtNum(toNum(m.minCloseDebt), 0)} MUSD` : "—"}</Row>
            <Row label="Protocol share of the bonus">{fmtPct(m?.protocolLiquidationShare, 0)}</Row>
            <Row label="Bad debt written off so far">{m ? `${fmtNum(toNum(m.totalBadDebt), 4)} MUSD` : "—"}</Row>
            <Row label="Protocol reserves">{k ? `${fmtNum(k.reserves, 4)} MUSD` : "—"}</Row>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Contracts" description="Verified on the Mezo Testnet explorer" />
          <CardBody className="pt-2">
            {m &&
              [
                ["Lending pool", m.pool],
                ["Borrow manager", m.borrowManager],
                ["Collateral manager", m.collateralManager],
                ["Liquidation manager", m.liquidationManager],
                ["Interest rate model", m.interestRateModel],
              ].map(([l, a]) => (
                <Row key={l} label={l}>
                  <ExplorerLink address={a} />
                </Row>
              ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
