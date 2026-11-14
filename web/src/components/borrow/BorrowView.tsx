"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Abi, Address } from "viem";
import { useSelectedMarket, useUserOverview, type MarketInfo, type UserMarket } from "@/hooks/useProtocol";
import { NO_PERMIT, useTx, type PermitArg, type TxStep } from "@/hooks/useTx";
import { MarketPicker, PageHeader, Panel, Stat } from "@/components/market/PageHeader";
import { Badge, Card, CardBody, CardHeader } from "@/components/ui/Card";
import { AlertTriangle } from "lucide-react";
import { metrics } from "@/components/market/useMarketMetrics";
import { AmountInput } from "@/components/ui/AmountInput";
import { Button } from "@/components/ui/Button";
import { Delta, Num, Row, Segmented, Skeleton } from "@/components/ui/Primitives";
import { Steps } from "@/components/ui/Steps";
import { Term } from "@/components/ui/Term";
import { ConnectPrompt, useMounted } from "@/components/shell/Wallet";
import { HealthNumber, PriceRunway } from "@/components/viz/Thermal";
import { LoanMeter } from "@/components/viz/LoanMeter";
import { borrowManagerAbi, BTC, FAUCET, GAS_RESERVE, lendingPoolAbi, MUSD } from "@/config/contracts";
import { MAX_UINT, fmtAmount, fmtHF, fmtNum, fmtPct, fmtUsd, parseAmount, toNum } from "@/lib/format";
import { liquidationPrice, maxBorrow, riskBand, riskCopy, simulate, type CollateralParams } from "@/lib/math";

type Tab = "borrow" | "repay" | "collateral" | "close";

export function BorrowView() {
  const mounted = useMounted();
  const { market, marketId } = useSelectedMarket();
  const { user, account } = useUserOverview();
  const um = user?.markets[marketId];
  const [tab, setTab] = useState<Tab>("borrow");
  const connected = mounted && !!account;

  const btc = market?.collaterals[0];
  const cparams: CollateralParams | undefined = btc
    ? { price: btc.price, decimals: btc.decimals, ltv: btc.ltv, liquidationThreshold: btc.liquidationThreshold }
    : undefined;
  const k = market ? metrics(market) : undefined;
  const coll = um?.collaterals[0];
  const pos = {
    collateralValue: um?.collateralValue ?? 0n,
    borrowCapacity: um?.borrowCapacity ?? 0n,
    liquidationCapacity: um?.liquidationCapacity ?? 0n,
    debt: um?.debt ?? 0n,
  };
  const band = riskBand(um?.healthFactor, um?.debt);
  const interest = um && um.debt > um.borrowPrincipal ? um.debt - um.borrowPrincipal : 0n;
  const used = pos.borrowCapacity > 0n ? toNum(pos.debt) / toNum(pos.borrowCapacity) : 0;

  const [projection, setProjection] = useState<Projection>({});
  const { select } = useSelectedMarket();
  // Prefill from the home page calculator: /borrow?market=0&btc=0.05&musd=1200
  const params = useSearchParams();
  const prefill = useMemo(() => {
    const ok = (x: string) => /^\d*\.?\d*$/.test(x);
    const b = params.get("btc") ?? "";
    const d = params.get("musd") ?? "";
    return b || d ? { btc: ok(b) ? b : "", musd: ok(d) ? d : "", k: `${b}|${d}` } : undefined;
  }, [params]);
  const marketParam = params.get("market");
  useEffect(() => {
    if (marketParam !== null && /^\d+$/.test(marketParam)) select(Number(marketParam));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketParam]);

  return (
    <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
      <PageHeader
        title="Borrow MUSD"
        intro="Post BTC as collateral and borrow MUSD from lenders, without selling your bitcoin. Keep the health factor above 1.0 and your BTC stays yours."
      >
        <MarketPicker show="borrow" />
      </PageHeader>

      {k && !k.btcPriceOk && (
        <div className="mb-6 flex items-start gap-3 rounded-[12px] border border-[#f6dfb3] bg-warn-soft px-4 py-3 text-[14px] text-warn">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
          The BTC price feed is stale right now, so new borrowing and collateral withdrawals are on hold. Repaying and adding
          collateral still work.
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader
              title="Loan health"
              description={connected ? (um && um.debt > 0n ? `${market?.name} market` : "No open loan in this market") : "Connect a wallet to see your loan"}
              action={<Badge tone={band === "safe" ? "safe" : band === "watch" ? "warn" : band === "none" ? "neutral" : "danger"}>{riskCopy[band].label}</Badge>}
            />
            <CardBody>
              <div className="grid gap-6 sm:grid-cols-[auto_1fr] sm:items-end">
                <div className="sm:pr-6">
                  <div className="text-[12.5px] text-mute">
                    <Term k="healthFactor" />
                  </div>
                  <div className="t-num mt-1 text-[48px] leading-none font-semibold tracking-[-0.035em]">
                    <HealthNumber hf={connected && um && um.debt > 0n ? um.healthFactor : undefined} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                  <Stat label="Collateral" sub={coll && coll.balance > 0n ? fmtUsd(toNum(um!.collateralValue)) : undefined}>
                    {coll ? `${fmtAmount(coll.balance, 18, { max: 6 })} BTC` : "—"}
                  </Stat>
                  <Stat label="Debt" sub={um && um.debt > 0n ? `${fmtAmount(interest, 18, { max: 6 })} interest so far` : undefined}>
                    {um ? <Num value={toNum(um.debt)} format={(n) => `${fmtNum(n, 4)} MUSD`} /> : "—"}
                  </Stat>
                  <Stat label={<Term k="liquidationPrice" align="right" />} sub={k ? `BTC now ${fmtUsd(k.btcPrice)}` : undefined}>
                    {coll && coll.liquidationPrice > 0n ? fmtUsd(toNum(coll.liquidationPrice)) : "—"}
                  </Stat>
                </div>
              </div>
              {k && btc && (
                <LoanMeter
                  className="mt-6"
                  collateralUsd={projection.coll ?? toNum(pos.collateralValue)}
                  debtUsd={toNum(pos.debt)}
                  nextDebtUsd={projection.debt}
                  ltv={toNum(btc.ltv)}
                  lt={toNum(btc.liquidationThreshold)}
                  size="lg"
                />
              )}
              {um && um.debt > 0n && (
                <p className="mt-4 text-[13.5px] text-mute">
                  You&apos;re using <span className="t-num font-semibold text-ink">{(used * 100).toFixed(1)}%</span> of your borrowing limit (
                  {fmtNum(toNum(pos.borrowCapacity), 2)} MUSD at {fmtPct(btc?.ltv, 0)} max LTV).
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Distance to liquidation" description="Where BTC is now compared with the price that would make this loan liquidatable" />
            <CardBody>
              {k ? <PriceRunway price={k.btcPrice} liqPrice={coll ? toNum(coll.liquidationPrice) : 0} projectedLiq={projection.liq} /> : <Skeleton className="h-20 w-full" />}
            </CardBody>
          </Card>

          {um && um.debt > 0n && k && <Simulator um={um} price={k.btcPrice} ltv={k.ltv} lt={k.lt} />}

          <Card>
            <CardHeader title={`${market?.name ?? ""} market terms`} />
            <CardBody className="grid gap-x-10 pt-2 sm:grid-cols-2">
              <Row label={<Term k="borrowApy" />}>{fmtPct(k?.borrowApy)}</Row>
              <Row label={<Term k="ltv" />}>{fmtPct(btc?.ltv, 0)}</Row>
              <Row label={<Term k="liquidationThreshold" />}>{fmtPct(btc?.liquidationThreshold, 0)}</Row>
              <Row label={<Term k="liquidationBonus" />}>{fmtPct(btc?.liquidationBonus, 1)}</Row>
              <Row label={<Term k="originationFee" />}>{fmtPct(market?.originationFee, 2)}</Row>
              <Row label={<Term k="availableLiquidity" />}>{k ? `${fmtNum(k.idle, 2)} MUSD` : "—"}</Row>
            </CardBody>
          </Card>
        </div>

        {/* action panel */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <Panel tone="borrow">
            <div className="p-5">
              <Segmented
                tone="borrow"
                label="Action"
                value={tab}
                onChange={(t) => {
                  setTab(t);
                  setProjection({});
                }}
                options={[
                  { value: "borrow", label: "Borrow" },
                  { value: "repay", label: "Repay" },
                  { value: "collateral", label: "Collateral" },
                  { value: "close", label: "Close" },
                ]}
              />
              <div className="mt-5">
                {!market || !cparams ? (
                  <Skeleton className="h-60 w-full" />
                ) : tab === "borrow" ? (
                  <BorrowForm
                    key={prefill?.k}
                    initial={prefill}
                    market={market}
                    um={um}
                    cparams={cparams}
                    native={user?.nativeBalance ?? 0n}
                    connected={connected}
                    account={account}
                    onProject={setProjection}
                  />
                ) : tab === "repay" ? (
                  <RepayForm market={market} um={um} cparams={cparams} musd={user?.musdBalance ?? 0n} connected={connected} account={account} onProject={setProjection} />
                ) : tab === "collateral" ? (
                  <CollateralForm market={market} um={um} cparams={cparams} native={user?.nativeBalance ?? 0n} connected={connected} onProject={setProjection} />
                ) : (
                  <CloseForm market={market} um={um} musd={user?.musdBalance ?? 0n} connected={connected} account={account} />
                )}
              </div>
            </div>
          </Panel>
          {tab === "repay" && (
            <p className="mt-3 text-[13.5px] text-mute">
              Short on MUSD?{" "}
              <Link href="/swap" className="font-semibold text-tang-deep underline decoration-tang-line underline-offset-2">
                Repay with BTC or MEZO
              </Link>{" "}
              through Mezo Pools in one transaction.
            </p>
          )}
          {connected && user && user.nativeBalance < GAS_RESERVE * 5n && (
            <p className="mt-3 text-[13px] text-mute">
              Low on testnet BTC?{" "}
              <a href={FAUCET} target="_blank" rel="noreferrer" className="text-ink underline">
                Get some from the Mezo faucet
              </a>
              .
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── forms ─────────────────────────

/** What the pending action would do, for the health card: health, liquidation price, and meter values (USD). */
type Projection = { hf?: bigint; liq?: number; coll?: number; debt?: number };
const projectionOf = (s: { healthFactor: bigint; debt: bigint; collateralValue: bigint }, liq: number): Projection => ({
  hf: s.debt > 0n ? s.healthFactor : undefined,
  liq,
  coll: toNum(s.collateralValue),
  debt: toNum(s.debt),
});

type FormProps = {
  market: MarketInfo;
  um?: UserMarket;
  cparams: CollateralParams;
  connected: boolean;
  onProject: (p: Projection) => void;
};

const posOf = (um?: UserMarket) => ({
  collateralValue: um?.collateralValue ?? 0n,
  borrowCapacity: um?.borrowCapacity ?? 0n,
  liquidationCapacity: um?.liquidationCapacity ?? 0n,
  debt: um?.debt ?? 0n,
});

function useProjection(
  um: UserMarket | undefined,
  cparams: CollateralParams,
  market: MarketInfo,
  opts: { collateralDelta?: bigint; borrow?: bigint; repay?: bigint },
) {
  return useMemo(() => {
    const sim = simulate(posOf(um), cparams, { ...opts, originationFee: market.originationFee });
    const bal = (um?.collaterals[0]?.balance ?? 0n) + (opts.collateralDelta ?? 0n);
    const liq = toNum(liquidationPrice(sim.debt, bal > 0n ? bal : 0n, cparams));
    return { sim, liq };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [um, cparams, market.originationFee, opts.collateralDelta, opts.borrow, opts.repay]);
}

function ProjectionRows({ um, sim, liq, cparams }: { um?: UserMarket; sim: ReturnType<typeof simulate>; liq: number; cparams: CollateralParams }) {
  const hasDebt = (um?.debt ?? 0n) > 0n;
  const curLiq = toNum(um?.collaterals[0]?.liquidationPrice ?? 0n);
  return (
    <div className="mt-1 rounded-[10px] bg-wash px-3.5 py-1.5">
      <Row label="Health factor">
        <Delta from={hasDebt ? fmtHF(um?.healthFactor) : "—"} to={sim.debt > 0n ? fmtHF(sim.healthFactor) : "—"} />
      </Row>
      <Row label="Debt">
        <Delta from={`${fmtAmount(um?.debt ?? 0n, 18, { max: 4 })}`} to={`${fmtAmount(sim.debt, 18, { max: 4 })} MUSD`} />
      </Row>
      <Row label="Collateral value">
        <Delta from={fmtUsd(toNum(um?.collateralValue ?? 0n))} to={fmtUsd(toNum(sim.collateralValue))} />
      </Row>
      <Row label="Liquidation price">
        <Delta from={curLiq ? fmtUsd(curLiq) : "—"} to={liq ? fmtUsd(liq) : "—"} />
      </Row>
      <p className="sr-only">BTC price {fmtUsd(toNum(cparams.price))}</p>
    </div>
  );
}

function RiskNote({ hf, debt }: { hf: bigint; debt: bigint }) {
  if (debt === 0n) return null;
  const n = toNum(hf);
  if (n >= 1.5) return null;
  return (
    <p className={`mt-3 rounded-[10px] border px-3 py-2 text-[13px] ${n < 1.2 ? "border-[#f6cfd1] bg-danger-soft text-danger" : "border-[#f6dfb3] bg-warn-soft text-warn"}`}>
      {n < 1.2
        ? `A ${((1 - 1 / n) * 100).toFixed(1)}% drop in BTC would make this loan liquidatable. Consider borrowing less or adding BTC.`
        : `This leaves a ${((1 - 1 / n) * 100).toFixed(1)}% cushion before liquidation. BTC can move that much in a day.`}
    </p>
  );
}

function BorrowForm({
  market,
  um,
  cparams,
  native,
  connected,
  account,
  onProject,
  initial,
}: FormProps & { native: bigint; account?: Address; initial?: { btc: string; musd: string } }) {
  const tx = useTx();
  const [collStr, setCollStr] = useState(initial?.btc ?? "");
  const [borrowStr, setBorrowStr] = useState(initial?.musd ?? "");
  const coll = parseAmount(collStr) ?? 0n;
  const amt = parseAmount(borrowStr) ?? 0n;
  const maxColl = native > GAS_RESERVE ? native - GAS_RESERVE : 0n;

  const withColl = simulate(posOf(um), cparams, { collateralDelta: coll, originationFee: market.originationFee });
  const maxAmt = maxBorrow(withColl.borrowCapacity, withColl.debt, market.originationFee, market.totalCash);
  const { sim, liq } = useProjection(um, cparams, market, { collateralDelta: coll, borrow: amt });

  const debtAfter = sim.debt;
  let error: string | undefined;
  if (connected && coll > maxColl) error = "That's more BTC than your wallet can spare after gas.";
  else if (amt > market.totalCash) error = "The pool doesn't have that much idle MUSD right now.";
  else if (amt > maxAmt) error = "That's above your borrowing limit. Add more BTC or borrow less.";
  else if (amt > 0n && debtAfter < market.minBorrow) error = `Loans start at ${fmtAmount(market.minBorrow)} MUSD.`;

  const project = (c: bigint, b: bigint) => {
    const s = simulate(posOf(um), cparams, { collateralDelta: c, borrow: b, originationFee: market.originationFee });
    const bal = (um?.collaterals[0]?.balance ?? 0n) + c;
    onProject(projectionOf(s, toNum(liquidationPrice(s.debt, bal, cparams))));
  };
  // Show a prefilled loan on the meter straight away.
  useEffect(() => {
    if (initial && (coll > 0n || amt > 0n)) project(coll, amt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const steps: TxStep[] = useMemo(() => {
    if (coll > 0n && amt > 0n)
      return [
        {
          key: "both",
          label: `Deposit ${fmtAmount(coll)} BTC and borrow ${fmtAmount(amt)} MUSD`,
          address: market.borrowManager,
          abi: borrowManagerAbi as Abi,
          functionName: "depositAndBorrow",
          args: [BTC, coll, amt],
          value: coll,
          done: { title: `Borrowed ${fmtAmount(amt)} MUSD`, body: `Against ${fmtAmount(coll)} BTC in ${market.name}.` },
        },
      ];
    if (coll > 0n)
      return [
        {
          key: "deposit",
          label: `Deposit ${fmtAmount(coll)} BTC`,
          address: market.borrowManager,
          abi: borrowManagerAbi as Abi,
          functionName: "depositCollateral",
          args: [BTC, coll],
          value: coll,
          done: { title: `Deposited ${fmtAmount(coll)} BTC`, body: `Collateral added in ${market.name}.` },
        },
      ];
    return [
      {
        key: "borrow",
        label: `Borrow ${fmtAmount(amt)} MUSD`,
        address: market.borrowManager,
        abi: borrowManagerAbi as Abi,
        functionName: "borrow",
        args: [amt],
        done: { title: `Borrowed ${fmtAmount(amt)} MUSD`, body: `Your ${market.name} loan was created.` },
      },
    ];
  }, [coll, amt, market]);

  const label =
    coll > 0n && amt > 0n ? `Deposit ${fmtAmount(coll)} BTC and borrow ${fmtAmount(amt)} MUSD` : coll > 0n ? `Deposit ${fmtAmount(coll)} BTC` : amt > 0n ? `Borrow ${fmtAmount(amt)} MUSD` : "Enter an amount";

  return (
    <div>
      <AmountInput
        label="Add BTC collateral"
        value={collStr}
        onChange={(v) => {
          setCollStr(v);
          tx.reset();
          project(parseAmount(v) ?? 0n, amt);
        }}
        symbol="BTC"
        max={connected ? maxColl : undefined}
        maxLabel="Wallet"
        usdPrice={toNum(cparams.price)}
        tone="borrow"
        disabled={tx.busy}
      />
      <div className="mt-3">
        <AmountInput
          label="Borrow"
          value={borrowStr}
          onChange={(v) => {
            setBorrowStr(v);
            tx.reset();
            project(coll, parseAmount(v) ?? 0n);
          }}
          symbol="MUSD"
          max={connected ? maxAmt : undefined}
          maxLabel="Limit"
          usdPrice={1}
          tone="borrow"
          disabled={tx.busy}
        />
      </div>
      <ProjectionRows um={um} sim={sim} liq={liq} cparams={cparams} />
      <Row label={<Term k="originationFee" />}>{sim.fee > 0n ? `${fmtAmount(sim.fee, 18, { max: 4 })} MUSD` : fmtPct(market.originationFee, 2)}</Row>
      <Row label="Borrow APY" tone="text-char">
        {fmtPct(Math.expm1(toNum(market.borrowRatePerYear)))}
      </Row>
      <RiskNote hf={sim.healthFactor} debt={sim.debt} />
      <div className="mt-5">
        {!connected ? (
          <ConnectPrompt tone="borrow" />
        ) : (
          <Button variant="borrow" size="lg" className="w-full" disabled={(coll === 0n && amt === 0n) || !!error} loading={tx.busy} onClick={async () => {
            if (await tx.run(steps)) {
              setCollStr("");
              setBorrowStr("");
              onProject({});
            }
          }}>
            {label}
          </Button>
        )}
        {error && (coll > 0n || amt > 0n) && <p className="mt-2 text-[13px] text-danger">{error}</p>}
        {tx.error && <p className="mt-2 text-[13px] text-danger">{tx.error}</p>}
      </div>
      <Steps steps={tx.steps} states={tx.states} hashes={tx.hashes} tone="borrow" />
      {account && (um?.collaterals[0]?.balance ?? 0n) === 0n && (
        <p className="mt-4 text-[12.5px] leading-relaxed text-faint">
          Your BTC is held by the market&apos;s collateral contract until you repay. If its value falls until the health factor
          drops below 1.0, part of it can be sold to liquidators at a {fmtPct(cparams.liquidationThreshold && market.collaterals[0].liquidationBonus, 1)} discount.
        </p>
      )}
    </div>
  );
}

function RepayForm({
  market,
  um,
  cparams,
  musd,
  connected,
  account,
  onProject,
}: FormProps & { musd: bigint; account?: Address }) {
  const tx = useTx();
  const [str, setStr] = useState("");
  const amt = parseAmount(str) ?? 0n;
  const debt = um?.debt ?? 0n;
  const max = debt < musd ? debt : musd;
  const full = debt > 0n && amt >= debt && musd >= debt;
  const { sim, liq } = useProjection(um, cparams, market, { repay: amt });

  let error: string | undefined;
  if (amt > musd) error = "Your wallet doesn't hold that much MUSD.";
  else if (amt > debt + debt / 100n + 1n) error = "That's more than you owe.";

  // Interest accrues until the transaction lands, so a full repayment signs a little headroom (capped at the wallet).
  const permitValue = full ? min(debt + debt / 500n + 10n ** 15n, musd) : amt;
  const steps: TxStep[] = useMemo(() => {
    const build = (p: PermitArg) => [account, full ? MAX_UINT : amt, p] as const;
    return [
      {
        key: "repay",
        label: full ? "Repay the full loan" : `Repay ${fmtAmount(amt)} MUSD`,
        address: market.pool,
        abi: lendingPoolAbi as Abi,
        functionName: "repayWithPermit",
        args: build(NO_PERMIT),
        permit: { token: MUSD, spender: market.pool, value: permitValue, buildArgs: build },
        gasFloor: 300_000n,
        done: full
          ? { title: "Loan repaid in full", body: `Your ${market.name} debt is cleared. You can now withdraw your BTC.` }
          : { title: `Repaid ${fmtAmount(amt)} MUSD`, body: `${market.name} loan updated.` },
      },
    ];
  }, [market, permitValue, full, amt, account]);

  if (connected && debt === 0n && !Object.keys(tx.states).length) {
    return <p className="py-6 text-center text-[14px] text-mute">You don&apos;t owe anything in this market.</p>;
  }

  return (
    <div>
      <AmountInput
        label="Amount to repay"
        value={str}
        onChange={(v) => {
          setStr(v);
          tx.reset();
          const a = parseAmount(v) ?? 0n;
          const s = simulate(posOf(um), cparams, { repay: a, originationFee: market.originationFee });
          onProject(projectionOf(s, toNum(liquidationPrice(s.debt, um?.collaterals[0]?.balance ?? 0n, cparams))));
        }}
        symbol="MUSD"
        max={connected ? max : undefined}
        maxLabel={musd < debt ? "Wallet" : "Owed"}
        usdPrice={1}
        tone="borrow"
        disabled={tx.busy}
      />
      <ProjectionRows um={um} sim={sim} liq={liq} cparams={cparams} />
      {musd < debt && connected && (
        <p className="mt-3 text-[12.5px] text-mute">
          You hold {fmtAmount(musd, 18, { max: 4 })} MUSD, less than the {fmtAmount(debt, 18, { max: 4 })} owed. You can repay part now.
        </p>
      )}
      <div className="mt-5">
        {!connected ? (
          <ConnectPrompt tone="borrow" />
        ) : (
          <Button variant="borrow" size="lg" className="w-full" disabled={amt === 0n || !!error} loading={tx.busy} onClick={async () => {
            if (await tx.run(steps)) {
              setStr("");
              onProject({});
            }
          }}>
            {amt === 0n ? "Enter an amount" : full ? "Repay full loan" : `Repay ${fmtAmount(amt)} MUSD`}
          </Button>
        )}
        {error && amt > 0n && <p className="mt-2 text-[13px] text-danger">{error}</p>}
        {tx.error && <p className="mt-2 text-[13px] text-danger">{tx.error}</p>}
      </div>
      <Steps steps={tx.steps} states={tx.states} hashes={tx.hashes} tone="borrow" />
    </div>
  );
}

function CollateralForm({ market, um, cparams, native, connected, onProject }: FormProps & { native: bigint }) {
  const tx = useTx();
  const [dir, setDir] = useState<"add" | "withdraw">("add");
  const [str, setStr] = useState("");
  const amt = parseAmount(str) ?? 0n;
  const bal = um?.collaterals[0]?.balance ?? 0n;
  const maxW = um?.collaterals[0]?.maxWithdrawable ?? 0n;
  const maxAdd = native > GAS_RESERVE ? native - GAS_RESERVE : 0n;
  const max = dir === "add" ? maxAdd : maxW;
  const delta = dir === "add" ? amt : -amt;
  const { sim, liq } = useProjection(um, cparams, market, { collateralDelta: delta });

  let error: string | undefined;
  if (amt > max) error = dir === "add" ? "That's more BTC than your wallet can spare after gas." : "Withdrawing that much would put your loan over its limit.";

  const isMax = dir === "withdraw" && amt > 0n && amt === maxW;
  const steps: TxStep[] = useMemo(
    () =>
      dir === "add"
        ? [
            {
              key: "add",
              label: `Deposit ${fmtAmount(amt)} BTC`,
              address: market.borrowManager,
              abi: borrowManagerAbi as Abi,
              functionName: "depositCollateral",
              args: [BTC, amt],
              value: amt,
              done: { title: `Deposited ${fmtAmount(amt)} BTC`, body: `Your ${market.name} health factor went up.` },
            },
          ]
        : [
            {
              key: "withdraw",
              label: `Withdraw ${fmtAmount(amt)} BTC`,
              address: market.borrowManager,
              abi: borrowManagerAbi as Abi,
              functionName: "withdrawCollateral",
              args: [BTC, isMax && (um?.debt ?? 0n) > 0n ? MAX_UINT : amt],
              done: { title: `Withdrew ${fmtAmount(amt)} BTC`, body: `From ${market.name} collateral.` },
            },
          ],
    [dir, amt, market, isMax, um],
  );

  return (
    <div>
      <Segmented
        size="sm"
        label="Direction"
        value={dir}
        onChange={(d) => {
          setDir(d);
          setStr("");
          tx.reset();
          onProject({});
        }}
        options={[
          { value: "add", label: "Add BTC" },
          { value: "withdraw", label: "Withdraw BTC" },
        ]}
      />
      <div className="mt-4">
        <AmountInput
          label={dir === "add" ? "BTC to add" : "BTC to withdraw"}
          value={str}
          onChange={(v) => {
            setStr(v);
            tx.reset();
            const a = parseAmount(v) ?? 0n;
            const s = simulate(posOf(um), cparams, { collateralDelta: dir === "add" ? a : -a, originationFee: market.originationFee });
            const b = bal + (dir === "add" ? a : -a);
            onProject(projectionOf(s, toNum(liquidationPrice(s.debt, b > 0n ? b : 0n, cparams))));
          }}
          symbol="BTC"
          max={connected ? max : undefined}
          maxLabel={dir === "add" ? "Wallet" : "Withdrawable"}
          usdPrice={toNum(cparams.price)}
          tone="borrow"
          disabled={tx.busy}
        />
      </div>
      <ProjectionRows um={um} sim={sim} liq={liq} cparams={cparams} />
      {dir === "withdraw" && (um?.debt ?? 0n) > 0n && (
        <p className="mt-3 text-[12.5px] text-faint">
          With a loan open you can withdraw down to your {fmtPct(cparams.ltv, 0)} borrowing limit. Repay to free up the rest.
        </p>
      )}
      <div className="mt-5">
        {!connected ? (
          <ConnectPrompt tone="borrow" />
        ) : (
          <Button variant="borrow" size="lg" className="w-full" disabled={amt === 0n || !!error} loading={tx.busy} onClick={async () => {
            if (await tx.run(steps)) {
              setStr("");
              onProject({});
            }
          }}>
            {amt === 0n ? "Enter an amount" : dir === "add" ? `Deposit ${fmtAmount(amt)} BTC` : `Withdraw ${fmtAmount(amt)} BTC`}
          </Button>
        )}
        {error && amt > 0n && <p className="mt-2 text-[13px] text-danger">{error}</p>}
        {tx.error && <p className="mt-2 text-[13px] text-danger">{tx.error}</p>}
      </div>
      <Steps steps={tx.steps} states={tx.states} hashes={tx.hashes} tone="borrow" />
    </div>
  );
}

function CloseForm({ market, um, musd, connected }: { market: MarketInfo; um?: UserMarket; musd: bigint; connected: boolean; account?: Address }) {
  const tx = useTx();
  const debt = um?.debt ?? 0n;
  const bal = um?.collaterals[0]?.balance ?? 0n;
  const permitValue = min(debt + debt / 500n + 10n ** 15n, musd);
  const short = debt > musd;

  const steps: TxStep[] = useMemo(() => {
    if (debt === 0n)
      return [
        {
          key: "withdraw",
          label: `Withdraw ${fmtAmount(bal)} BTC`,
          address: market.borrowManager,
          abi: borrowManagerAbi as Abi,
          functionName: "withdrawCollateral",
          args: [BTC, bal],
          done: { title: `Withdrew ${fmtAmount(bal)} BTC`, body: `Your ${market.name} position is closed.` },
        },
      ];
    const build = (p: PermitArg) => [MAX_UINT, BTC, MAX_UINT, p] as const;
    return [
      {
        key: "close",
        label: "Repay everything and withdraw all BTC",
        address: market.borrowManager,
        abi: borrowManagerAbi as Abi,
        functionName: "repayAndWithdrawWithPermit",
        args: build(NO_PERMIT),
        permit: { token: MUSD, spender: market.pool, value: permitValue, buildArgs: build },
        gasFloor: 450_000n,
        done: { title: "Position closed", body: `Repaid ${fmtAmount(debt, 18, { max: 4 })} MUSD and withdrew ${fmtAmount(bal)} BTC.` },
      },
    ];
  }, [debt, bal, market, permitValue]);

  if (connected && debt === 0n && bal === 0n && !Object.keys(tx.states).length) {
    return (
      <p className="py-6 text-center text-[14px] text-mute">
        Nothing to close in this market. <Link href="/dashboard" className="text-ink underline">See your dashboard</Link>.
      </p>
    );
  }

  return (
    <div>
      <p className="text-[14px] leading-relaxed text-mute">
        Repay the whole loan, including interest, and get all your BTC back in one transaction.
      </p>
      <div className="mt-4 rounded-[10px] bg-wash px-3.5 py-1.5">
        <Row label="You repay">{fmtAmount(debt, 18, { max: 6 })} MUSD</Row>
        <Row label="You receive">{fmtAmount(bal, 18, { max: 8 })} BTC</Row>
        <Row label="Wallet MUSD">{fmtAmount(musd, 18, { max: 4 })}</Row>
      </div>
      {short && connected && (
        <p className="mt-3 rounded-[10px] border border-[#f6dfb3] bg-warn-soft px-3 py-2 text-[13px] text-warn">
          You need {fmtAmount(debt - musd, 18, { max: 4 })} more MUSD to close this loan. Repay part of it from the Repay tab, or get MUSD by
          withdrawing a supply position.
        </p>
      )}
      <div className="mt-5">
        {!connected ? (
          <ConnectPrompt tone="borrow" />
        ) : (
          <Button variant="borrow" size="lg" className="w-full" disabled={short || (debt === 0n && bal === 0n)} loading={tx.busy} onClick={() => tx.run(steps)}>
            {debt === 0n ? "Withdraw all BTC" : "Close position"}
          </Button>
        )}
        {tx.error && <p className="mt-2 text-[13px] text-danger">{tx.error}</p>}
      </div>
      <Steps steps={tx.steps} states={tx.states} hashes={tx.hashes} tone="borrow" />
    </div>
  );
}

function Simulator({ um, price, ltv, lt }: { um: UserMarket; price: number; ltv: number; lt: number }) {
  const [move, setMove] = useState(-20);
  const hf = toNum(um.healthFactor) * (1 + move / 100);
  const hfBig = BigInt(Math.max(0, Math.round(hf * 1e6))) * 10n ** 12n;
  const p = price * (1 + move / 100);
  const band = riskBand(hfBig, um.debt);
  return (
    <Card>
      <CardHeader title="What if BTC moves?" description="Drag to see this loan at a different BTC price" />
      <CardBody>
      <div className="grid items-center gap-6 sm:grid-cols-[1fr_auto]">
        <label className="block">
          <span className="flex justify-between text-[13.5px] text-mute">
            <span>
              BTC {move >= 0 ? "rises" : "falls"} {Math.abs(move)}% to <span className="t-num text-ink">{fmtUsd(p)}</span>
            </span>
          </span>
          <input type="range" className="thermal mt-1 w-full" min={-60} max={60} value={move} onChange={(e) => setMove(Number(e.target.value))} aria-label="BTC price change" />
          <LoanMeter className="mt-2" collateralUsd={toNum(um.collateralValue) * (1 + move / 100)} debtUsd={toNum(um.debt)} ltv={ltv} lt={lt} />
        </label>
        <div className="text-right">
          <p className="text-[12.5px] text-mute">Health factor would be</p>
          <p className="t-num text-[30px] font-semibold tracking-[-0.03em]">
            <HealthNumber hf={hfBig} />
          </p>
          <p className={`text-[12.5px] font-semibold ${riskCopy[band].tone}`}>{riskCopy[band].label}</p>
        </div>
      </div>
      <p className="mt-3 text-[12.5px] text-faint">
        Ignores interest accrued in the meantime. {hf < 1 ? "At that price, liquidators could repay part of your debt and take BTC at a discount." : ""}
      </p>
      </CardBody>
    </Card>
  );
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);
