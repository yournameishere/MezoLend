"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useMarkets, useUserOverview } from "@/hooks/useProtocol";
import { useActivity } from "@/hooks/useActivity";
import { PageHeader } from "@/components/market/PageHeader";
import { metrics } from "@/components/market/useMarketMetrics";
import { ActivityTable } from "./ActivityTable";
import { ConnectPrompt, useMounted, Avatar } from "@/components/shell/Wallet";
import { HealthBar, HealthNumber } from "@/components/viz/Thermal";
import { ExplorerLink, Num, Skeleton } from "@/components/ui/Primitives";
import { Badge, Card, CardBody, CardHeader, EmptyState, StatCell, StatGrid, Table, Td, Th } from "@/components/ui/Card";
import { Term } from "@/components/ui/Term";
import { Button } from "@/components/ui/Button";
import { TokenDot } from "@/components/ui/AmountInput";
import { MAX_UINT, fmtAmount, fmtNum, fmtPct, fmtUsd, timeAgo, toNum } from "@/lib/format";
import { riskBand, riskCopy } from "@/lib/math";
import { setSettings, useNotices } from "@/lib/store";

const bandTone = { none: "neutral", safe: "safe", watch: "warn", hot: "danger", liquidatable: "danger" } as const;

export function DashboardView() {
  const mounted = useMounted();
  const { markets } = useMarkets();
  const { user, account, isLoading } = useUserOverview();
  const activity = useActivity(account);
  const notices = useNotices(account);
  const alerts = notices.filter((n) => n.kind === "alert").slice(0, 4);

  if (!mounted || !account) {
    return (
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
        <PageHeader title="Dashboard" intro="Your supplies, loans and full on-chain history across MezoLend markets." />
        <Card>
          <EmptyState title="Connect a wallet to see your dashboard" action={<div className="w-56"><ConnectPrompt /></div>}>
            Positions are read directly from the MezoLend contracts on Mezo Testnet.
          </EmptyState>
        </Card>
      </div>
    );
  }

  const rows = (user?.markets ?? []).map((um) => ({ um, m: markets?.[Number(um.id)] }));
  const supplied = rows.reduce((a, r) => a + toNum(r.um.supplied), 0);
  const debt = rows.reduce((a, r) => a + toNum(r.um.debt), 0);
  const collUsd = rows.reduce((a, r) => a + toNum(r.um.collateralValue), 0);
  const earnPerYear = rows.reduce((a, r) => a + (r.m ? toNum(r.um.supplied) * metrics(r.m).supplyApy : 0), 0);
  const payPerYear = rows.reduce((a, r) => a + (r.m ? toNum(r.um.debt) * metrics(r.m).borrowApy : 0), 0);
  const netWorth = supplied + collUsd - debt;
  const netApy = netWorth > 0 ? (earnPerYear - payPerYear) / netWorth : 0;
  const available = rows.reduce((a, r) => a + toNum(r.um.availableToBorrow), 0);
  const loans = rows.filter((r) => r.um.debt > 0n || r.um.collaterals.some((c) => c.balance > 0n));
  const lending = rows.filter((r) => r.um.shares > 0n);
  const lowestHf = loans.filter((r) => r.um.debt > 0n).reduce<bigint | undefined>((a, r) => (a === undefined || r.um.healthFactor < a ? r.um.healthFactor : a), undefined);

  return (
    <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
      <PageHeader title="Dashboard" intro="Your supplies, loans and full on-chain history across MezoLend markets.">
        <div className="flex items-center gap-2.5 rounded-[12px] border border-line bg-paper px-3 py-2">
          <Avatar address={account} size={28} />
          <div>
            <p className="text-[12px] text-mute">Wallet</p>
            <ExplorerLink address={account} className="text-[13px] text-ink" />
          </div>
        </div>
      </PageHeader>

      <StatGrid>
        <StatCell label="Net worth" sub="supplied + collateral − debt">
          {user ? <Num value={netWorth} format={(n) => fmtUsd(n)} /> : <Skeleton className="h-7 w-24" />}
        </StatCell>
        <StatCell label="Net APY" sub={`earning ${fmtNum(earnPerYear, 4)}, paying ${fmtNum(payPerYear, 4)} MUSD a year`}>
          {user ? <span className={netApy >= 0 ? "text-safe" : "text-danger"}>{fmtPct(netApy)}</span> : <Skeleton className="h-7 w-16" />}
        </StatCell>
        <StatCell label={<Term k="healthFactor">Lowest health factor</Term>} sub={lowestHf === undefined ? "no open loans" : "across your loans"}>
          {user ? <HealthNumber hf={lowestHf} /> : <Skeleton className="h-7 w-14" />}
        </StatCell>
        <StatCell label="Available to borrow" sub="against your current collateral">
          {user ? <Num value={available} format={(n) => `${fmtNum(n, 2, 2)} MUSD`} /> : <Skeleton className="h-7 w-24" />}
        </StatCell>
      </StatGrid>

      {alerts.length > 0 && (
        <Card className="mt-6 border-[#f6dfb3]">
          <CardHeader title="Recent alerts" />
          <ul className="divide-y divide-line px-5 pt-2 pb-3">
            {alerts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5 text-[14px]">
                <span className="flex gap-2.5">
                  <AlertTriangle size={16} className={`mt-0.5 shrink-0 ${a.tone === "error" ? "text-danger" : "text-warn"}`} />
                  <span>
                    <span className="font-semibold">{a.title}</span>
                    {a.body && <span className="block text-[13px] text-mute">{a.body}</span>}
                  </span>
                </span>
                <span className="text-[12.5px] text-faint">{timeAgo(a.ts / 1000)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Your supplies"
            description={lending.length ? `${fmtNum(supplied, 4, 2)} MUSD earning interest` : undefined}
            action={
              <Link href="/lend">
                <Button variant="supply" size="sm">
                  Supply
                </Button>
              </Link>
            }
          />
          <div className="mt-4">
            {isLoading ? (
              <CardBody>
                <Skeleton className="h-16 w-full" />
              </CardBody>
            ) : lending.length === 0 ? (
              <EmptyState title="Nothing supplied yet">
                {user && toNum(user.musdBalance) > 0
                  ? `You have ${fmtAmount(user.musdBalance, 18, { max: 2 })} MUSD in your wallet that could be earning.`
                  : "Supply MUSD to start earning from borrowers."}
              </EmptyState>
            ) : (
              <Table minWidth={520}>
                <thead>
                  <tr>
                    <Th>Market</Th>
                    <Th align="right">Balance</Th>
                    <Th align="right">APY</Th>
                    <Th align="right">Earned</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {lending.map(({ um, m }) => {
                    const earned = um.supplied > um.supplyPrincipal ? um.supplied - um.supplyPrincipal : 0n;
                    return (
                      <tr key={String(um.id)}>
                        <Td>
                          <span className="flex items-center gap-2 font-semibold">
                            <TokenDot symbol="MUSD" /> {m?.name}
                          </span>
                        </Td>
                        <Td align="right">
                          <span className="t-num font-medium">{fmtAmount(um.supplied, 18, { max: 4 })}</span>
                          <span className="block text-[12px] text-faint">{fmtAmount(um.maxWithdraw, 18, { max: 2 })} withdrawable</span>
                        </Td>
                        <Td align="right">
                          <span className="t-num text-tang-deep">{m ? fmtPct(metrics(m).supplyApy) : "—"}</span>
                        </Td>
                        <Td align="right">
                          <span className="t-num text-safe">+{fmtAmount(earned, 18, { max: 6 })}</span>
                        </Td>
                        <Td align="right">
                          <Link href="/lend" onClick={() => setSettings({ marketId: Number(um.id) })}>
                            <Button variant="outline" size="sm">
                              Manage
                            </Button>
                          </Link>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Your loans"
            description={loans.length ? `${fmtNum(debt, 4, 2)} MUSD owed against ${fmtUsd(collUsd)} of BTC` : undefined}
            action={
              <Link href="/borrow">
                <Button variant="borrow" size="sm">
                  Borrow
                </Button>
              </Link>
            }
          />
          <div className="mt-4">
            {isLoading ? (
              <CardBody>
                <Skeleton className="h-16 w-full" />
              </CardBody>
            ) : loans.length === 0 ? (
              <EmptyState title="No loans or collateral">Post BTC as collateral to borrow MUSD without selling it.</EmptyState>
            ) : (
              <Table minWidth={560}>
                <thead>
                  <tr>
                    <Th>Market</Th>
                    <Th align="right">Debt</Th>
                    <Th align="right">Collateral</Th>
                    <Th align="right">Health</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {loans.map(({ um, m }) => {
                    const c = um.collaterals[0];
                    const band = riskBand(um.healthFactor, um.debt);
                    return (
                      <tr key={String(um.id)}>
                        <Td>
                          <span className="flex items-center gap-2 font-semibold">
                            <TokenDot symbol="BTC" /> {m?.name}
                          </span>
                          <span className="mt-0.5 block">
                            <Badge tone={bandTone[band]}>{riskCopy[band].label}</Badge>
                          </span>
                        </Td>
                        <Td align="right">
                          <span className="t-num font-medium">{fmtAmount(um.debt, 18, { max: 4 })} MUSD</span>
                          <span className="block text-[12px] text-faint">
                            liq. at {c && c.liquidationPrice > 0n ? fmtUsd(toNum(c.liquidationPrice)) : "—"}
                          </span>
                        </Td>
                        <Td align="right">
                          <span className="t-num">{fmtAmount(c?.balance ?? 0n, 18, { max: 6 })} BTC</span>
                          <span className="block text-[12px] text-faint">{fmtUsd(toNum(um.collateralValue))}</span>
                        </Td>
                        <Td align="right" className="w-[120px]">
                          <span className="t-num font-semibold">
                            <HealthNumber hf={um.debt > 0n ? um.healthFactor : undefined} />
                          </span>
                          {um.debt > 0n && um.healthFactor < MAX_UINT / 2n && (
                            <span className="mt-1 block">
                              <HealthBar hf={um.healthFactor} compact />
                            </span>
                          )}
                        </Td>
                        <Td align="right">
                          <Link href="/borrow" onClick={() => setSettings({ marketId: Number(um.id) })}>
                            <Button variant="outline" size="sm">
                              Manage
                            </Button>
                          </Link>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Activity" description="Every action on this wallet, read from contract events on Mezo Testnet" />
        <div className="mt-4">
          <ActivityTable items={activity.data} loading={activity.isLoading} error={activity.isError} />
        </div>
      </Card>
    </div>
  );
}
