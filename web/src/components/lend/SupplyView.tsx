"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePublicClient } from "wagmi";
import { erc20Abi, type Abi } from "viem";
import { useSelectedMarket, useUserOverview } from "@/hooks/useProtocol";
import { useSnapshots } from "@/hooks/useActivity";
import { useTx, type TxStep } from "@/hooks/useTx";
import { MarketPicker, PageHeader, Panel, Stat } from "@/components/market/PageHeader";
import { metrics, rateParams } from "@/components/market/useMarketMetrics";
import { AmountInput } from "@/components/ui/AmountInput";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/Card";
import { Delta, Num, Row, Segmented, Skeleton } from "@/components/ui/Primitives";
import { Steps } from "@/components/ui/Steps";
import { Term } from "@/components/ui/Term";
import { ConnectPrompt, useMounted } from "@/components/shell/Wallet";
import { UtilBar } from "@/components/viz/Thermal";
import { LineChart } from "@/components/viz/LineChart";
import { lendingPoolAbi, MUSD } from "@/config/contracts";
import { fmtAmount, fmtNum, fmtPct, parseAmount, toInput, toNum } from "@/lib/format";
import { aprToApy, supplyAprAt } from "@/lib/math";
import { chain } from "@/lib/wagmi";

type Mode = "supply" | "withdraw";

export function SupplyView() {
  const mounted = useMounted();
  const { market, marketId } = useSelectedMarket();
  const { user, account } = useUserOverview();
  const um = user?.markets[marketId];
  const snaps = useSnapshots(market?.pool);
  const publicClient = usePublicClient({ chainId: chain.id });
  const tx = useTx();

  const [mode, setMode] = useState<Mode>("supply");
  const [value, setValue] = useState("");
  const [isMax, setIsMax] = useState(false);
  const amount = parseAmount(value) ?? 0n;
  const k = market ? metrics(market) : undefined;

  const max = mode === "supply" ? (user?.musdBalance ?? 0n) : (um?.maxWithdraw ?? 0n);
  const earned = um ? (um.supplied > um.supplyPrincipal ? um.supplied - um.supplyPrincipal : 0n) : 0n;

  const preview = useMemo(() => {
    if (!market || !k) return undefined;
    const assets = toNum(market.totalAssets);
    const a = toNum(amount);
    const nextAssets = mode === "supply" ? assets + a : Math.max(assets - a, 0);
    const u = nextAssets > 0 ? Math.min(1, k.borrowed / nextAssets) : 0;
    const apy = aprToApy(supplyAprAt(u, rateParams(market)));
    const myNext = toNum(um?.supplied ?? 0n) + (mode === "supply" ? a : -a);
    return { u, apy, yearly: Math.max(myNext, 0) * apy };
  }, [market, k, amount, mode, um]);

  const error =
    amount > 0n && amount > max
      ? mode === "supply"
        ? "Your wallet doesn't hold that much MUSD."
        : "That's more than you can withdraw right now."
      : undefined;

  const steps: TxStep[] = useMemo(() => {
    if (!market || !account) return [];
    if (mode === "supply") {
      return [
        {
          key: "approve",
          label: "Approve MUSD",
          address: MUSD,
          abi: erc20Abi as Abi,
          functionName: "approve",
          args: [market.pool, amount],
          done: { title: "MUSD approved" },
          skip: async () => {
            const allowance = await publicClient!.readContract({
              address: MUSD,
              abi: erc20Abi,
              functionName: "allowance",
              args: [account, market.pool],
            });
            return allowance >= amount;
          },
        },
        {
          key: "supply",
          label: `Supply ${fmtAmount(amount)} MUSD`,
          address: market.pool,
          abi: lendingPoolAbi as Abi,
          functionName: "deposit",
          args: [amount, account],
          done: { title: `Supplied ${fmtAmount(amount)} MUSD`, body: `Now earning in the ${market.name} pool.` },
        },
      ];
    }
    // Max withdraws every share via redeem() so no dust is left behind (if the pool has the liquidity).
    const all = um && isMax && um.maxWithdraw >= um.supplied - um.supplied / 1_000_000n;
    return [
      all
        ? {
            key: "withdraw",
            label: "Withdraw everything",
            address: market.pool,
            abi: lendingPoolAbi as Abi,
            functionName: "redeem",
            args: [um!.shares, account, account],
            done: { title: `Withdrew ${fmtAmount(um!.supplied)} MUSD`, body: `Your ${market.name} position is closed.` },
          }
        : {
            key: "withdraw",
            label: `Withdraw ${fmtAmount(amount)} MUSD`,
            address: market.pool,
            abi: lendingPoolAbi as Abi,
            functionName: "withdraw",
            args: [amount, account, account],
            done: { title: `Withdrew ${fmtAmount(amount)} MUSD`, body: `From the ${market.name} pool.` },
          },
    ];
  }, [market, account, mode, amount, um, publicClient, isMax]);

  const submit = async () => {
    const ok = await tx.run(steps);
    if (ok) {
      setValue("");
      setIsMax(false);
    }
  };

  const series = useMemo(() => {
    const s = snaps.data ?? [];
    return [
      { name: "Supply APY", color: "#ff9a3c", area: true, points: s.map((x) => ({ t: x.ts, v: aprToApy(x.supplyApr) })) },
      { name: "Borrow APY", color: "#17130f", dashed: true, points: s.map((x) => ({ t: x.ts, v: aprToApy(x.borrowApr) })) },
    ];
  }, [snaps.data]);

  return (
    <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
      <PageHeader
        title="Supply MUSD"
        intro="Earn the supply rate on idle MUSD. Interest is paid by borrowers, and you can withdraw whenever the pool has idle MUSD."
      >
        <MarketPicker show="supply" />
      </PageHeader>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader
              title={market ? `${market.name} pool` : "Pool"}
              description={market?.description}
              action={
                market ? (
                  <Link href={`/markets/${Number(market.id)}`} className="text-[13px] font-medium text-tang-deep hover:underline">
                    Market details
                  </Link>
                ) : null
              }
            />
            <CardBody>
              <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
                <Stat label={<Term k="supplyApy" />}>
                  {k ? <Num value={k.supplyApy * 100} format={(n) => `${n.toFixed(2)}%`} className="text-tang-deep" /> : <Skeleton className="h-7 w-20" />}
                </Stat>
                <Stat label="Total supplied" sub="MUSD">
                  {k ? <Num value={k.supplied} format={(n) => fmtNum(n, 2, 2)} /> : <Skeleton className="h-7 w-24" />}
                </Stat>
                <Stat label={<Term k="availableLiquidity" />} sub="MUSD idle">
                  {k ? <Num value={k.idle} format={(n) => fmtNum(n, 2, 2)} /> : <Skeleton className="h-7 w-24" />}
                </Stat>
                <Stat label={<Term k="utilization" align="right" />} sub={k ? `${fmtNum(k.borrowed, 2)} MUSD lent out` : undefined}>
                  {k ? <Num value={k.utilization * 100} format={(n) => `${n.toFixed(1)}%`} /> : <Skeleton className="h-7 w-16" />}
                </Stat>
              </div>
              {k && <UtilBar u={k.utilization} className="mt-5" />}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Your position" description={um && um.shares > 0n ? `Held as ${market?.shareSymbol} pool shares` : undefined} />
            {!mounted || !account ? (
              <EmptyState title="Connect a wallet">See what you have supplied and how much interest it has earned.</EmptyState>
            ) : !um ? (
              <CardBody>
                <Skeleton className="h-16 w-full" />
              </CardBody>
            ) : um.shares === 0n ? (
              <EmptyState
                title="Nothing supplied yet"
                action={
                  user && user.musdBalance === 0n ? (
                    <Link href="/borrow">
                      <Button variant="outline" size="sm">
                        Borrow MUSD against BTC
                      </Button>
                    </Link>
                  ) : undefined
                }
              >
                {user && user.musdBalance === 0n
                  ? "You need MUSD to supply. You can borrow some against testnet BTC."
                  : "Enter an amount in the panel to start earning."}
              </EmptyState>
            ) : (
              <CardBody>
                <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
                  <Stat label="Supplied balance" sub="MUSD, incl. interest">
                    <Num value={toNum(um.supplied)} format={(n) => fmtNum(n, 4, 2)} />
                  </Stat>
                  <Stat label="Interest earned" sub="MUSD">
                    <Num value={toNum(earned)} format={(n) => `+${fmtNum(n, 6, 2)}`} className="text-safe" />
                  </Stat>
                  <Stat label="Withdrawable now" sub="MUSD">
                    <Num value={toNum(um.maxWithdraw)} format={(n) => fmtNum(n, 4, 2)} />
                  </Stat>
                  <Stat label={<Term k="shares" align="right" />} sub={market?.shareSymbol}>
                    {fmtAmount(um.shares, 18, { max: 4 })}
                  </Stat>
                </div>
              </CardBody>
            )}
          </Card>

          <Card>
            <CardHeader title="Rate history" description="Recorded on-chain at every pool action" />
            <CardBody>
              {snaps.isLoading ? <Skeleton className="h-[220px] w-full" /> : <LineChart series={series} format={(v) => `${(v * 100).toFixed(1)}%`} />}
            </CardBody>
          </Card>
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <Panel tone="supply">
            <div className="p-5">
              <Segmented
                tone="supply"
                label="Action"
                value={mode}
                onChange={(m) => {
                  setMode(m);
                  setValue("");
                  tx.reset();
                }}
                options={[
                  { value: "supply", label: "Supply" },
                  { value: "withdraw", label: "Withdraw" },
                ]}
              />
              <div className="mt-5">
                <AmountInput
                  label={mode === "supply" ? "Amount to supply" : "Amount to withdraw"}
                  value={value}
                  onChange={(v) => {
                    setValue(v);
                    setIsMax(mode === "withdraw" && !!um && v === toInput(um.maxWithdraw, 18, 8));
                    if (Object.keys(tx.states).length) tx.reset();
                  }}
                  symbol="MUSD"
                  usdPrice={1}
                  max={mounted && account ? max : undefined}
                  maxLabel={mode === "supply" ? "Wallet" : "Withdrawable"}
                  tone="supply"
                  disabled={tx.busy}
                />
              </div>

              <div className="mt-1 rounded-[10px] bg-wash px-3.5 py-1.5">
                <Row label="Supply APY">
                  <Delta from={fmtPct(k?.supplyApy)} to={amount > 0n && preview ? fmtPct(preview.apy) : undefined} />
                </Row>
                <Row label="Pool utilization">
                  <Delta from={fmtPct(k?.utilization, 1)} to={amount > 0n && preview ? fmtPct(preview.u, 1) : undefined} />
                </Row>
                <Row label="Estimated yearly earnings">{preview ? `${fmtNum(preview.yearly, 4, 2)} MUSD` : "—"}</Row>
                <Row label="Fees">None</Row>
              </div>

              <div className="mt-5">
                {!mounted || !account ? (
                  <ConnectPrompt tone="supply" />
                ) : (
                  <Button variant="supply" size="lg" className="w-full" disabled={amount === 0n || !!error || !market} loading={tx.busy} onClick={submit}>
                    {amount === 0n ? "Enter an amount" : mode === "supply" ? `Supply ${fmtAmount(amount)} MUSD` : `Withdraw ${fmtAmount(amount)} MUSD`}
                  </Button>
                )}
                {error && <p className="mt-2 text-[13px] text-danger">{error}</p>}
                {tx.error && <p className="mt-2 text-[13px] text-danger">{tx.error}</p>}
              </div>
              <Steps steps={tx.steps} states={tx.states} hashes={tx.hashes} tone="supply" />
              {mode === "supply" && (
                <p className="mt-4 text-[12.5px] leading-relaxed text-faint">
                  Supplied MUSD is lent to borrowers who post BTC worth more than their loan. Returns depend on demand and aren&apos;t
                  guaranteed. If a liquidation ever leaves bad debt, reserves cover it first, then lenders.
                </p>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
