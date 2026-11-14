"use client";

import { useMemo, useState } from "react";
import { useConnection, usePublicClient, useReadContract } from "wagmi";
import { erc20Abi, type Abi, type Address } from "viem";
import { useAccounts, useMarkets, useUserOverview, type MarketInfo } from "@/hooks/useProtocol";
import { useLiquidationFeed } from "@/hooks/useActivity";
import { useTx, type TxStep } from "@/hooks/useTx";
import { PageHeader } from "@/components/market/PageHeader";
import { Badge, Card, CardBody, CardHeader, EmptyState, StatCell, StatGrid, Table, Td, Th } from "@/components/ui/Card";
import { metrics } from "@/components/market/useMarketMetrics";
import { HealthNumber } from "@/components/viz/Thermal";
import { Dialog } from "@/components/ui/Dialog";
import { AmountInput } from "@/components/ui/AmountInput";
import { Button } from "@/components/ui/Button";
import { ExplorerLink, Row, Segmented, Skeleton } from "@/components/ui/Primitives";
import { Steps } from "@/components/ui/Steps";
import { Term } from "@/components/ui/Term";
import { Avatar, ConnectPrompt, useMounted } from "@/components/shell/Wallet";
import { BTC, MUSD, liquidationManagerAbi } from "@/config/contracts";
import { MAX_UINT, WAD, fmtAmount, fmtNum, fmtPct, fmtUsd, parseAmount, shortAddr, timeAgo, toNum, toInput } from "@/lib/format";
import { riskBand, riskCopy } from "@/lib/math";
import { chain } from "@/lib/wagmi";

type Pos = { account: Address; debt: bigint; collateralValue: bigint; liquidationCapacity: bigint; healthFactor: bigint; dataOk: boolean; collateralBalances: readonly bigint[] };

export function LiquidationsView() {
  const { markets } = useMarkets();
  const [mid, setMid] = useState(0);
  const m = markets?.[mid];
  const accounts = useAccounts(mid);
  const feed = useLiquidationFeed();
  const { address } = useConnection();
  const [target, setTarget] = useState<Pos | null>(null);

  const positions = useMemo(() => {
    const [list] = accounts.data ?? [[], 0n];
    return [...(list as readonly Pos[])]
      .filter((p) => p.debt > 0n)
      .sort((a, b) => (a.healthFactor < b.healthFactor ? -1 : a.healthFactor > b.healthFactor ? 1 : 0));
  }, [accounts.data]);

  const liquidatable = positions.filter((p) => p.dataOk && p.healthFactor < WAD);
  const atRisk = positions.filter((p) => p.dataOk && p.healthFactor >= WAD && p.healthFactor < (WAD * 12n) / 10n);

  return (
    <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
      <PageHeader
        title="Liquidations"
        intro="When a loan's health factor drops below 1.0, anyone can repay part of its debt and receive the borrower's BTC at a discount. This keeps lenders whole. Every open loan is listed here, read straight from the contracts."
      >
        {markets && <Segmented label="Market" value={mid} onChange={setMid} options={markets.map((x, i) => ({ value: i, label: `${x.name} market` }))} />}
      </PageHeader>

      <StatGrid>
        <StatCell label="Open loans">{accounts.data ? positions.length : <Skeleton className="h-7 w-8" />}</StatCell>
        <StatCell label="Liquidatable now">
          {accounts.data ? <span className={liquidatable.length ? "text-danger" : ""}>{liquidatable.length}</span> : <Skeleton className="h-7 w-8" />}
        </StatCell>
        <StatCell label="Within 20% of liquidation">
          {accounts.data ? <span className={atRisk.length ? "text-warn" : ""}>{atRisk.length}</span> : <Skeleton className="h-7 w-8" />}
        </StatCell>
        <StatCell label={<Term k="liquidationBonus">Liquidator bonus</Term>} sub={m ? `${fmtPct(m.protocolLiquidationShare, 0)} of it goes to reserves` : undefined}>
          {m ? fmtPct(m.collaterals[0]?.liquidationBonus, 1) : <Skeleton className="h-7 w-12" />}
        </StatCell>
      </StatGrid>

      <Card className="mt-6">
        <CardHeader title="Open loans" description="Sorted by health factor, riskiest first" />
        <div className="mt-4">
          <Table minWidth={760}>
            <thead>
              <tr>
                <Th>Borrower</Th>
                <Th align="right">
                  <Term k="healthFactor" />
                </Th>
                <Th align="right">Debt</Th>
                <Th align="right">Collateral</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {accounts.isLoading &&
                [0, 1].map((i) => (
                  <tr key={i}>
                    <td colSpan={6} className="border-b border-line px-5 py-4">
                      <Skeleton className="h-6 w-full" />
                    </td>
                  </tr>
                ))}
              {accounts.data && positions.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <EmptyState title="No open loans in this market" />
                  </td>
                </tr>
              )}
              {positions.map((p) => {
                const band = riskBand(p.healthFactor, p.debt);
                const mine = address && p.account.toLowerCase() === address.toLowerCase();
                return (
                  <tr key={p.account} className={band === "liquidatable" ? "bg-danger-soft/60" : "transition-colors hover:bg-[#fffaf5]"}>
                    <Td>
                      <span className="flex items-center gap-2.5">
                        <Avatar address={p.account} />
                        <ExplorerLink address={p.account} />
                        {mine && <Badge tone="orange">You</Badge>}
                      </span>
                    </Td>
                    <Td align="right">
                      <span className="t-num text-[15px] font-semibold">{p.dataOk ? <HealthNumber hf={p.healthFactor} /> : <span className="text-faint">price stale</span>}</span>
                    </Td>
                    <Td align="right">
                      <span className="t-num">{fmtAmount(p.debt, 18, { max: 4 })} MUSD</span>
                    </Td>
                    <Td align="right">
                      <span className="t-num">{fmtAmount(p.collateralBalances[0] ?? 0n, 18, { max: 6 })} BTC</span>
                      <span className="block text-[12px] text-faint">{fmtUsd(toNum(p.collateralValue))}</span>
                    </Td>
                    <Td>
                      <Badge tone={band === "safe" ? "safe" : band === "watch" ? "warn" : "danger"}>{riskCopy[band].label}</Badge>
                    </Td>
                    <Td align="right">
                      {band === "liquidatable" && !mine ? (
                        <Button variant="danger" size="sm" onClick={() => setTarget(p)}>
                          Liquidate
                        </Button>
                      ) : band === "liquidatable" ? (
                        <span className="text-[12.5px] text-danger">Your loan, repay it</span>
                      ) : null}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      </Card>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader title="How a liquidation works" />
          <CardBody>
            <ol className="space-y-3.5 text-[14px] leading-relaxed text-mute">
              {[
                ["The oracle moves", "Mezo's Skip oracle updates BTC/USD every block. If a loan's collateral times its liquidation threshold falls below its debt, its health factor drops under 1.0."],
                ["Anyone repays part of the debt", `Up to ${fmtPct(m?.closeFactor, 0)} per call, or all of it if the loan is deeply underwater or small. The liquidator pays in MUSD.`],
                ["They receive BTC at a discount", `BTC worth the repaid debt plus a ${fmtPct(m?.collaterals[0]?.liquidationBonus, 1)} bonus. ${fmtPct(m?.protocolLiquidationShare, 0)} of the bonus goes to protocol reserves.`],
                ["The loan gets healthier", "If collateral runs out with debt left, the remainder is written off. Reserves absorb it first, then lenders."],
              ].map(([t, d], i) => (
                <li key={t} className="grid grid-cols-[26px_1fr] gap-2.5">
                  <span className="t-num grid h-6 w-6 place-items-center rounded-full bg-wash text-[12px] font-semibold text-ink">{i + 1}</span>
                  <span>
                    <span className="font-semibold text-ink">{t}.</span> {d}
                  </span>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent liquidations" description="Across all markets" />
          {feed.isLoading ? (
            <CardBody>
              <Skeleton className="h-24 w-full" />
            </CardBody>
          ) : !feed.data?.length ? (
            <EmptyState title="No liquidations yet">Every loan has stayed above its liquidation line.</EmptyState>
          ) : (
            <ul className="mt-3 divide-y divide-line border-t border-line">
              {feed.data.slice(0, 12).map((e) => (
                <li key={e.hash + e.borrower} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3 text-[13.5px]">
                  <span>
                    <span className="font-semibold">{e.marketName}</span>: {shortAddr(e.liquidator)} repaid {fmtAmount(e.repaid, 18, { max: 2 })} MUSD of{" "}
                    {shortAddr(e.borrower)}&apos;s loan for {fmtAmount(e.seized, 18, { max: 6 })} BTC
                    {e.badDebt > 0n && <span className="text-danger">, {fmtAmount(e.badDebt, 18, { max: 2 })} MUSD bad debt</span>}
                  </span>
                  <span className="flex items-center gap-3 text-[12.5px] text-faint">
                    {timeAgo(e.ts)} <ExplorerLink hash={e.hash}>tx</ExplorerLink>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {m && target && <LiquidateDialog market={m} pos={target} onClose={() => setTarget(null)} />}
    </div>
  );
}


function LiquidateDialog({ market, pos, onClose }: { market: MarketInfo; pos: Pos; onClose: () => void }) {
  const mounted = useMounted();
  const { user, account } = useUserOverview();
  const publicClient = usePublicClient({ chainId: chain.id });
  const tx = useTx();
  const [str, setStr] = useState("");
  const typed = parseAmount(str);

  const preview = useReadContract({
    address: market.liquidationManager,
    abi: liquidationManagerAbi,
    functionName: "previewLiquidation",
    args: [pos.account, BTC, typed ?? 0n],
    chainId: chain.id,
    query: { refetchInterval: 6_000 },
  });
  const p = preview.data;
  const maxRepay = p?.maxRepay ?? 0n;
  const musd = user?.musdBalance ?? 0n;
  const repay = p?.repayAmount ?? 0n;
  const minSeize = p ? (p.seizeToLiquidator * 995n) / 1000n : 0n;
  const price = metrics(market).btcPrice;
  const stillLiquidatable = p ? p.healthFactor < WAD && p.debt > 0n : true;

  let error: string | undefined;
  if (!stillLiquidatable) error = "This loan is healthy again — it can't be liquidated right now.";
  else if (repay > musd) error = `You need ${fmtAmount(repay, 18, { max: 4 })} MUSD; your wallet has ${fmtAmount(musd, 18, { max: 4 })}.`;

  const approveAmount = repay + repay / 200n + 1n;
  const steps: TxStep[] = [
    {
      key: "approve",
      label: "Approve MUSD",
      address: MUSD,
      abi: erc20Abi as Abi,
      functionName: "approve",
      args: [market.pool, approveAmount],
      done: { title: "MUSD approved" },
      skip: async () =>
        (await publicClient!.readContract({ address: MUSD, abi: erc20Abi, functionName: "allowance", args: [account!, market.pool] })) >= approveAmount,
    },
    {
      key: "liquidate",
      label: `Repay ${fmtAmount(repay, 18, { max: 4 })} MUSD and seize BTC`,
      address: market.liquidationManager,
      abi: liquidationManagerAbi as Abi,
      functionName: "liquidate",
      args: [pos.account, BTC, repay, minSeize],
      done: {
        title: "Liquidation complete",
        body: `Repaid ${fmtAmount(repay, 18, { max: 4 })} MUSD of ${shortAddr(pos.account)}'s loan and received ${fmtAmount(p?.seizeToLiquidator ?? 0n)} BTC.`,
      },
    },
  ];

  return (
    <Dialog open onClose={onClose} title={`Liquidate ${shortAddr(pos.account)}`} width="max-w-lg">
      <div className="flex items-baseline justify-between">
        <span className="text-[13.5px] text-mute">Health factor</span>
        <span className="text-[22px] font-bold">
          <HealthNumber hf={p?.healthFactor ?? pos.healthFactor} />
        </span>
      </div>
      <div className="mt-4">
        <AmountInput
          label="MUSD to repay"
          value={str}
          onChange={(v) => {
            setStr(v);
            tx.reset();
          }}
          symbol="MUSD"
          usdPrice={1}
          max={maxRepay < MAX_UINT ? maxRepay : undefined}
          maxLabel="Max this call"
          tone="borrow"
          disabled={tx.busy}
        />
        {!str && maxRepay > 0n && (
          <button type="button" className="text-[12.5px] text-mute underline" onClick={() => setStr(toInput(maxRepay, 18, 6))}>
            Use the maximum ({fmtAmount(maxRepay, 18, { max: 4 })} MUSD)
          </button>
        )}
      </div>
      <div className="mt-3 border-t border-line pt-3">
        <Row label="Borrower's debt">{fmtAmount(p?.debt ?? pos.debt, 18, { max: 4 })} MUSD</Row>
        <Row label="You repay">{fmtAmount(repay, 18, { max: 4 })} MUSD</Row>
        <Row label="You receive">
          {fmtAmount(p?.seizeToLiquidator ?? 0n, 18, { max: 8 })} BTC ({fmtUsd(toNum(p?.seizeToLiquidator ?? 0n) * price)})
        </Row>
        <Row label="Your profit at oracle price" tone="text-safe">
          {fmtUsd(toNum(p?.bonusValue ?? 0n))}
        </Row>
        <Row label="Protocol share">{fmtAmount(p?.protocolCut ?? 0n, 18, { max: 8 })} BTC</Row>
        <Row label="Slippage guard">min {fmtAmount(minSeize, 18, { max: 8 })} BTC</Row>
      </div>
      <div className="mt-5">
        {!mounted || !account ? (
          <ConnectPrompt tone="borrow" />
        ) : (
          <Button variant="danger" size="lg" className="w-full" disabled={!p || repay === 0n || !!error} loading={tx.busy} onClick={async () => {
            if (await tx.run(steps)) setTimeout(onClose, 1500);
          }}>
            {repay > 0n ? `Liquidate for ${fmtNum(toNum(p?.seizeToLiquidator ?? 0n), 6)} BTC` : "Enter an amount"}
          </Button>
        )}
        {error && <p className="mt-2 text-[13px] text-danger">{error}</p>}
        {tx.error && <p className="mt-2 text-[13px] text-danger">{tx.error}</p>}
      </div>
      <Steps steps={tx.steps} states={tx.states} hashes={tx.hashes} tone="borrow" />
    </Dialog>
  );
}
