"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMarkets, type MarketInfo } from "@/hooks/useProtocol";
import { useRecentActivity } from "@/hooks/useActivity";
import { LoanMeter } from "@/components/viz/LoanMeter";
import { UtilBar } from "@/components/viz/Thermal";
import { ExplorerLink, Segmented, Skeleton, TimeAgo } from "@/components/ui/Primitives";
import { ButtonLink } from "@/components/ui/Button";
import { metrics } from "./useMarketMetrics";
import { fmtAmount, fmtNum, fmtPct, fmtUsd, shortAddr } from "@/lib/format";
import { deployment } from "@/config/deployment";
import { FAUCET, SKIP_FEED } from "@/config/contracts";

const wrap = "mx-auto w-full max-w-[1200px] px-4 sm:px-6";

export function Landing() {
  const { markets, isLoading, error } = useMarkets();
  return (
    <div>
      <section className={`${wrap} grid gap-12 pt-12 pb-16 lg:grid-cols-[1fr_minmax(0,500px)] lg:items-start lg:gap-16 lg:pt-20 lg:pb-24`}>
        <div className="lg:pt-6">
          <Link href="/docs#contracts" className="inline-flex items-center gap-2 text-[13.5px] font-medium text-mute hover:text-ink">
            <span className="h-2 w-2 rounded-full bg-safe" aria-hidden />
            Live on Mezo Testnet with verified contracts
          </Link>
          <h1 className="t-display mt-6 max-w-[12ch] text-[44px] sm:text-[60px] lg:text-[68px]">Borrow dollars against your bitcoin.</h1>
          <p className="mt-6 max-w-[36rem] text-[17.5px] leading-[1.6] text-mute">
            MezoLend is a lending market for MUSD, Mezo&apos;s bitcoin-backed dollar. Post BTC and borrow MUSD without selling it, or lend
            MUSD and earn the interest borrowers pay. Every balance, rate and liquidation lives in contracts you can read.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <ButtonLink href="/borrow" variant="borrow" size="lg">
              Borrow MUSD
            </ButtonLink>
            <ButtonLink href="/lend" variant="supply" size="lg">
              Lend MUSD
            </ButtonLink>
          </div>
          <p className="mt-6 text-[14.5px] text-mute">
            Only have test BTC?{" "}
            <Link href="/swap" className="font-semibold text-tang-deep underline decoration-tang-line underline-offset-4 hover:decoration-tang-deep">
              Swap it for MUSD and start earning in one transaction
            </Link>
            .
          </p>
        </div>
        <LoanCalculator markets={markets} loading={isLoading} failed={!!error && !markets} />
      </section>

      <MarketsSection markets={markets} loading={isLoading} />
      <FaucetPath />
      <MezoSection />
      <RecentActivity />

      <section className={`${wrap} pb-20`}>
        <p className="max-w-[46rem] border-t border-line pt-6 text-[13.5px] leading-relaxed text-mute">
          MezoLend runs on Mezo Testnet, where BTC and MUSD have no real value. The contracts are tested and were reviewed for this release
          (see the{" "}
          <Link href="/docs#security" className="font-medium text-ink underline decoration-line-2 underline-offset-2">
            security notes
          </Link>
          ), but they have not had an external audit. Lenders take liquidity and bad-debt risk; borrowers can be liquidated if BTC falls.
        </p>
      </section>
    </div>
  );
}

// ───────────────────────── Try a loan ─────────────────────────

const PRESETS = ["0.01", "0.05", "0.25", "1"];

function LoanCalculator({ markets, loading, failed }: { markets?: readonly MarketInfo[]; loading: boolean; failed: boolean }) {
  const [mid, setMid] = useState(0);
  const [btc, setBtc] = useState("0.05");
  const [share, setShare] = useState(55);
  const m = markets?.[mid] ?? markets?.[0];
  const k = m ? metrics(m) : undefined;

  const r = useMemo(() => {
    const price = k?.btcPrice ?? 0;
    const amount = Math.max(Number.parseFloat(btc) || 0, 0);
    const value = amount * price;
    const fee = k?.originationFee ?? 0;
    const limit = value * (k?.ltv ?? 0);
    const borrow = (limit * share) / 100 / (1 + fee);
    const debt = borrow * (1 + fee);
    const hf = debt > 0 ? (value * (k?.lt ?? 0)) / debt : Infinity;
    const liqPrice = debt > 0 && amount > 0 ? debt / (amount * (k?.lt ?? 1)) : 0;
    return { price, amount, value, borrow, debt, fee: debt - borrow, hf, liqPrice, drop: price > 0 && liqPrice > 0 ? 1 - liqPrice / price : 0 };
  }, [btc, share, k]);

  const hfTone = r.hf < 1.2 ? "text-danger" : r.hf < 1.6 ? "text-warn" : "text-safe";
  const href = m ? `/borrow?market=${Number(m.id)}&btc=${encodeURIComponent(btc)}&musd=${Math.floor(r.borrow * 100) / 100}` : "/borrow";

  return (
    <section aria-labelledby="calc-title" className="rounded-[16px] border-[1.5px] border-ink bg-paper">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 pt-5 pb-4 sm:px-6">
        <div>
          <h2 id="calc-title" className="text-[17px] font-bold tracking-[-0.01em]">
            Try a loan
          </h2>
          <p className="mt-0.5 text-[13.5px] text-mute">
            {k?.btcPriceOk ? (
              <>Using today&apos;s BTC price of {fmtUsd(r.price)} from Mezo&apos;s oracle.</>
            ) : failed ? (
              "Live prices are unavailable right now."
            ) : (
              "Loading the live BTC price."
            )}
          </p>
        </div>
        {markets && markets.length > 1 && (
          <Segmented
            size="sm"
            label="Market"
            value={mid}
            onChange={setMid}
            options={markets.map((x, i) => ({ value: i, label: x.name }))}
          />
        )}
      </div>

      <div className="space-y-6 px-5 pt-5 pb-6 sm:px-6">
        <div>
          <label htmlFor="calc-btc" className="text-[13.5px] font-semibold">
            BTC you post as collateral
          </label>
          <div className="mt-2 flex items-center gap-3 rounded-[var(--radius-ctl)] border border-line-2 bg-paper px-3.5 focus-within:border-ink">
            <input
              id="calc-btc"
              inputMode="decimal"
              autoComplete="off"
              value={btc}
              onChange={(e) => setBtc(e.target.value.replace(/[^0-9.]/g, ""))}
              className="h-12 min-w-0 flex-1 bg-transparent text-[22px] font-bold tracking-[-0.02em] outline-none"
            />
            <span className="text-[14px] font-semibold text-mute">BTC</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setBtc(p)}
                  className={`rounded-[6px] border px-2.5 py-1 text-[12.5px] font-semibold transition-colors ${
                    btc === p ? "border-ink bg-ink text-paper" : "border-line-2 text-mute hover:border-ink hover:text-ink"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <span className="text-[13px] text-mute">Worth {fmtUsd(r.value)}</span>
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="calc-share" className="text-[13.5px] font-semibold">
              MUSD you borrow
            </label>
            <span className="text-[13px] text-mute">{share}% of your limit</span>
          </div>
          <p className="mt-1 text-[34px] leading-tight font-extrabold tracking-[-0.03em]">
            {loading && !k ? <Skeleton className="h-9 w-40" /> : <>{fmtNum(r.borrow, 2)} MUSD</>}
          </p>
          <input
            id="calc-share"
            type="range"
            min={0}
            max={100}
            step={1}
            value={share}
            onChange={(e) => setShare(Number(e.target.value))}
            className="thermal mt-1 w-full"
            aria-valuetext={`${fmtNum(r.borrow, 2)} MUSD, ${share}% of the borrowing limit`}
          />
        </div>

        {k && <LoanMeter collateralUsd={r.value} debtUsd={r.debt} ltv={k.ltv} lt={k.lt} size="lg" />}

        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5">
          <div>
            <dt className="text-[13px] text-mute">Loan health</dt>
            <dd className={`mt-0.5 text-[22px] font-extrabold tracking-[-0.02em] ${r.debt > 0 ? hfTone : "text-mute"}`}>
              {r.debt > 0 ? fmtNum(r.hf, 2) : "No loan"}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-mute">Liquidated if BTC falls to</dt>
            <dd className="mt-0.5 text-[22px] font-extrabold tracking-[-0.02em]">
              {r.liqPrice > 0 ? fmtUsd(r.liqPrice) : "Never"}
            </dd>
            {r.liqPrice > 0 && <p className="text-[12.5px] text-mute">{fmtNum(r.drop * 100, 0)}% below today</p>}
          </div>
          <div>
            <dt className="text-[13px] text-mute">Interest</dt>
            <dd className="mt-0.5 font-semibold">{k ? `${fmtPct(k.borrowApy)} a year` : "…"}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-mute">One-time fee</dt>
            <dd className="mt-0.5 font-semibold">{fmtNum(r.fee, 2)} MUSD</dd>
          </div>
        </dl>

        <ButtonLink href={href} variant="borrow" size="lg" className="w-full">
          {r.borrow > 0 && m ? `Borrow ${fmtNum(r.borrow, 2)} MUSD in ${m.name}` : "Open the borrow page"}
        </ButtonLink>
      </div>
    </section>
  );
}

// ───────────────────────── Markets ─────────────────────────

function MarketsSection({ markets, loading }: { markets?: readonly MarketInfo[]; loading: boolean }) {
  return (
    <section className="border-y border-line bg-wash">
      <div className={`${wrap} py-16`}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="t-title text-[30px]">Markets</h2>
            <p className="mt-2 max-w-[40rem] text-[15.5px] text-mute">
              Each market is a separate pool with its own limits and interest curve, so losses in one never reach lenders in another.
              Rates move with demand: the more of a pool is lent out, the more borrowers pay and lenders earn.
            </p>
          </div>
          <Link href="/markets" className="text-[14px] font-semibold text-tang-deep underline decoration-tang-line underline-offset-4 hover:decoration-tang-deep">
            Compare markets in detail
          </Link>
        </div>

        <div className="mt-8 overflow-hidden rounded-[var(--radius-panel)] border border-line-2 bg-paper">
          <div className="hidden grid-cols-[1.4fr_repeat(5,1fr)] gap-4 border-b border-line px-6 py-3 text-[13px] font-medium text-mute md:grid">
            <span>Market</span>
            <span className="text-right">Lenders earn</span>
            <span className="text-right">Borrowers pay</span>
            <span>Lent out</span>
            <span className="text-right">Available</span>
            <span className="text-right">Max LTV / liquidation</span>
          </div>
          {loading && !markets && (
            <div className="space-y-3 p-6">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}
          {!loading && !markets && (
            <p className="p-6 text-[14.5px] text-mute">Market data couldn&apos;t be loaded from Mezo. It will retry automatically.</p>
          )}
          {markets?.map((m) => {
            const k = metrics(m);
            return (
              <Link
                key={String(m.id)}
                href={`/markets/${Number(m.id)}`}
                className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-line px-5 py-5 last:border-b-0 hover:bg-wash md:grid-cols-[1.4fr_repeat(5,1fr)] md:items-center md:px-6"
              >
                <span className="col-span-2 md:col-span-1">
                  <span className="block text-[16px] font-bold">{m.name}</span>
                  <span className="block text-[13px] text-mute">{m.description}</span>
                </span>
                <Cell label="Lenders earn" className="md:text-right">
                  <span className="text-[17px] font-bold text-tang-deep">{fmtPct(k.supplyApy)}</span>
                </Cell>
                <Cell label="Borrowers pay" className="md:text-right">
                  <span className="text-[17px] font-bold">{fmtPct(k.borrowApy)}</span>
                </Cell>
                <Cell label="Lent out">
                  <span className="flex items-center gap-2.5">
                    <span className="w-10 font-semibold">{fmtNum(k.utilization * 100, 0)}%</span>
                    <UtilBar u={k.utilization} className="flex-1" />
                  </span>
                </Cell>
                <Cell label="Available" className="md:text-right">
                  <span className="font-semibold">{fmtNum(k.idle, 0)} MUSD</span>
                </Cell>
                <Cell label="Max LTV / liquidation" className="md:text-right">
                  <span className="font-semibold">
                    {fmtNum(k.ltv * 100, 0)}% / {fmtNum(k.lt * 100, 0)}%
                  </span>
                </Cell>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Cell({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <span className={`block ${className}`}>
      <span className="block text-[12.5px] text-mute md:hidden">{label}</span>
      {children}
    </span>
  );
}

// ───────────────────────── Faucet to position ─────────────────────────

function FaucetPath() {
  const steps = [
    {
      title: "Get test BTC",
      body: "Claim BTC from the Mezo faucet. The same BTC pays for gas, so there is nothing else to set up.",
      link: { href: FAUCET, label: "Open the Mezo faucet", external: true },
    },
    {
      title: "Swap and lend in one transaction",
      body: "Send BTC to MezoLend. It is swapped for MUSD on Mezo Pools and supplied to a market in the same transaction, with no approval step.",
      link: { href: "/swap", label: "Swap and lend" },
    },
    {
      title: "Or keep the BTC and borrow",
      body: "Post the BTC as collateral and borrow MUSD against it. Repay whenever you like and take your BTC back.",
      link: { href: "/borrow", label: "Borrow MUSD" },
    },
  ];
  return (
    <section className={`${wrap} py-20`}>
      <h2 className="t-title max-w-[22ch] text-[30px]">From the faucet to a working position in about a minute</h2>
      <ol className="mt-10 grid gap-10 md:grid-cols-3 md:gap-8">
        {steps.map((s, i) => (
          <li key={s.title} className="border-t-[3px] border-ink pt-5">
            <span className="text-[14px] font-bold text-tang-deep">Step {i + 1}</span>
            <h3 className="mt-1 text-[19px] font-bold tracking-[-0.015em]">{s.title}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-mute">{s.body}</p>
            {s.link.external ? (
              <a
                href={s.link.href}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block text-[14px] font-semibold text-ink underline decoration-tang underline-offset-4 hover:decoration-ink"
              >
                {s.link.label}
              </a>
            ) : (
              <Link
                href={s.link.href}
                className="mt-3 inline-block text-[14px] font-semibold text-ink underline decoration-tang underline-offset-4 hover:decoration-ink"
              >
                {s.link.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

// ───────────────────────── Built on Mezo ─────────────────────────

function MezoSection() {
  const items = [
    {
      name: "MUSD",
      body: "The unit of account. Loans, interest, fees and liquidations are all in MUSD. Its permit signatures let you lend, repay or liquidate in a single transaction, without a separate approval.",
      address: deployment.musd,
      linkLabel: "MUSD token",
    },
    {
      name: "Native BTC",
      body: "Collateral is BTC itself, sent along with the transaction. There is nothing to wrap or bridge, and withdrawals send BTC straight back to your wallet.",
      address: deployment.core.collateralManager,
      linkLabel: "Core collateral manager",
    },
    {
      name: "Mezo Pools",
      body: "The route from BTC or MEZO into MUSD. MezoLend's swap contract trades on Mezo Pools and then lends or repays in the same transaction, enforcing your minimum output.",
      address: deployment.zap,
      linkLabel: "Swap contract",
    },
    {
      name: "Mezo's price oracle",
      body: "BTC/USD comes from the Skip feed built into Mezo, refreshed every block, with Pyth as a fallback. If neither is fresh, borrowing pauses instead of trusting an old price.",
      address: SKIP_FEED,
      linkLabel: "Skip BTC/USD feed",
    },
  ];
  return (
    <section className="bg-ink text-paper">
      <div className={`${wrap} py-20`}>
        <h2 className="t-title max-w-[24ch] text-[30px]">Built from Mezo&apos;s own parts</h2>
        <p className="mt-3 max-w-[40rem] text-[15.5px] text-[#d9c8b8]">
          MezoLend adds the lending logic. Everything else is native to Mezo, which keeps the contracts small and every step checkable on the
          explorer.
        </p>
        <div className="mt-10 grid gap-x-10 gap-y-9 md:grid-cols-2">
          {items.map((it) => (
            <div key={it.name} className="border-l-[3px] border-tang pl-5">
              <h3 className="text-[19px] font-bold">{it.name}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-[#e9dccf]">{it.body}</p>
              <a
                href={`https://explorer.test.mezo.org/address/${it.address}`}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block text-[13.5px] font-semibold text-tang underline decoration-[#7a5a3a] underline-offset-4 hover:decoration-tang"
              >
                {it.linkLabel} on the explorer
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ───────────────────────── Recent activity ─────────────────────────

const verb: Record<string, string> = {
  supply: "lent",
  withdraw: "withdrew",
  borrow: "borrowed",
  repay: "repaid",
  liquidation: "was liquidated for",
};

function RecentActivity() {
  const q = useRecentActivity(8);
  return (
    <section className={`${wrap} py-20`}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="t-title text-[30px]">Happening on-chain</h2>
          <p className="mt-2 text-[15.5px] text-mute">The latest actions in every market, read from contract events.</p>
        </div>
        <Link href="/analytics" className="text-[14px] font-semibold text-tang-deep underline decoration-tang-line underline-offset-4 hover:decoration-tang-deep">
          See protocol analytics
        </Link>
      </div>
      <ul className="mt-8 divide-y divide-line border-y border-line">
        {q.isLoading &&
          [0, 1, 2, 3].map((i) => (
            <li key={i} className="py-4">
              <Skeleton className="h-5 w-2/3" />
            </li>
          ))}
        {q.isError && <li className="py-5 text-[14.5px] text-mute">The explorer API didn&apos;t respond. Activity will reload shortly.</li>}
        {q.data?.length === 0 && <li className="py-5 text-[14.5px] text-mute">No activity yet. Be the first to lend or borrow.</li>}
        {q.data?.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-4 text-[15px]">
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{shortAddr(a.account)}</span> {verb[a.kind]}{" "}
              <span className="font-semibold">{fmtAmount(a.amount, 18, { max: 2 })} MUSD</span> in {a.marketName}
            </span>
            <span className="text-[13.5px] text-mute">
              <TimeAgo ts={a.ts} />
            </span>
            <ExplorerLink hash={a.hash}>View transaction</ExplorerLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
