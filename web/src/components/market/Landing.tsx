"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, ArrowRight, BadgeCheck, Gauge, KeyRound, Plus } from "lucide-react";
import { useMarkets } from "@/hooks/useProtocol";
import { PoolScene, SCENE } from "@/components/viz/PoolScene";
import { RateCurve } from "@/components/viz/RateCurve";
import { HealthBar, PriceRunway, UtilBar } from "@/components/viz/Thermal";
import { Num, Segmented, Skeleton, TimeAgo } from "@/components/ui/Primitives";
import { Badge, Card, CardBody, CardHeader, StatCell, StatGrid, Table, Td, Th } from "@/components/ui/Card";
import { Term } from "@/components/ui/Term";
import { Button } from "@/components/ui/Button";
import { TokenDot } from "@/components/ui/AmountInput";
import { metrics, rateParams, marketColor } from "./useMarketMetrics";
import { fmtNum, fmtPct, fmtUsd } from "@/lib/format";
import { heat, heatColor } from "@/lib/math";
import { setSettings } from "@/lib/store";
import { FAUCET } from "@/config/contracts";

const wrap = "mx-auto max-w-[1240px] px-4 sm:px-6";

export function Landing() {
  const { markets } = useMarkets();

  const totals = useMemo(() => {
    if (!markets) return undefined;
    const all = markets.map(metrics);
    return {
      supplied: all.reduce((a, x) => a + x.supplied, 0),
      borrowed: all.reduce((a, x) => a + x.borrowed, 0),
      collateralUsd: all.reduce((a, x) => a + x.collateralUsd, 0),
      btcPrice: all[0]?.btcPrice ?? 0,
      updatedAt: all[0]?.btcUpdatedAt ?? 0,
    };
  }, [markets]);

  return (
    <div>
      {/* ───────────── Hero ───────────── */}
      <section className={`${wrap} grid items-center gap-12 pt-14 pb-16 lg:grid-cols-[1fr_1.02fr] lg:pt-20`}>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.2, 0.7, 0.1, 1] }}>
          <Badge tone="orange">
            <span className="h-1.5 w-1.5 rounded-full bg-tang" /> Live on Mezo Testnet
          </Badge>
          <h1 className="t-display mt-5 text-[40px] sm:text-[52px]">Lend and borrow MUSD against bitcoin</h1>
          <p className="mt-5 max-w-[34rem] text-[17px] leading-relaxed text-mute">
            Supply MUSD to earn interest from borrowers, or post BTC as collateral and borrow MUSD without selling. Rates, balances
            and liquidations are handled by verified smart contracts on Mezo.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/supply">
              <Button variant="supply" size="lg">
                Supply MUSD
              </Button>
            </Link>
            <Link href="/borrow">
              <Button variant="borrow" size="lg">
                Borrow MUSD
              </Button>
            </Link>
          </div>
          <ul className="mt-10 grid gap-4 text-[13.5px] sm:grid-cols-3">
            {[
              { icon: BadgeCheck, t: "Verified contracts", d: "Source published on the Mezo explorer" },
              { icon: KeyRound, t: "Self-custody", d: "Your wallet signs every action" },
              { icon: Gauge, t: "Live risk data", d: "BTC price updates every block" },
            ].map(({ icon: Icon, t, d }) => (
              <li key={t} className="flex gap-2.5">
                <Icon size={18} className="mt-0.5 shrink-0 text-tang-deep" aria-hidden />
                <span>
                  <span className="block font-semibold">{t}</span>
                  <span className="text-mute">{d}</span>
                </span>
              </li>
            ))}
          </ul>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.7, ease: [0.2, 0.7, 0.1, 1] }}>
          <LivePoolCard />
        </motion.div>
      </section>

      {/* ───────────── Protocol metrics ───────────── */}
      <section className={wrap}>
        <StatGrid>
          <StatCell label="Total value locked" sub="MUSD supplied plus BTC collateral">
            {totals ? <Num value={totals.supplied + totals.collateralUsd} format={(n) => fmtUsd(n)} /> : <Skeleton className="h-7 w-24" />}
          </StatCell>
          <StatCell label="MUSD supplied" sub="across all markets">
            {totals ? <Num value={totals.supplied} format={(n) => fmtNum(n, 2, 2)} /> : <Skeleton className="h-7 w-20" />}
          </StatCell>
          <StatCell label="MUSD borrowed" sub={totals && totals.supplied ? `${fmtPct(totals.borrowed / totals.supplied, 1)} of supply` : undefined}>
            {totals ? <Num value={totals.borrowed} format={(n) => fmtNum(n, 2, 2)} /> : <Skeleton className="h-7 w-20" />}
          </StatCell>
          <StatCell label="BTC price" sub={<>Skip oracle{totals?.updatedAt ? <TimeAgo ts={totals.updatedAt} prefix=", updated " /> : null}</>}>
            {totals ? <Num value={totals.btcPrice} format={(n) => fmtUsd(n)} /> : <Skeleton className="h-7 w-28" />}
          </StatCell>
        </StatGrid>
      </section>

      {/* ───────────── Markets ───────────── */}
      <section className={`${wrap} pt-20`}>
        <SectionHead title="Markets" lead="Each market is a separate pool with its own collateral limits and rate curve." link={{ href: "/markets", label: "Compare markets" }} />
        <Card className="mt-6">
          <Table minWidth={820}>
            <thead>
              <tr>
                <Th>Market</Th>
                <Th align="right">Supplied</Th>
                <Th>
                  <Term k="utilization" />
                </Th>
                <Th align="right">
                  <Term k="supplyApy" />
                </Th>
                <Th align="right">
                  <Term k="borrowApy" />
                </Th>
                <Th align="right">
                  <Term k="ltv" align="right" />
                </Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {(markets ?? []).map((x) => {
                const k = metrics(x);
                const id = Number(x.id);
                return (
                  <tr key={x.name} className="transition-colors hover:bg-[#fffaf5]">
                    <Td>
                      <Link href={`/markets/${id}`} className="flex items-center gap-3">
                        <span className="grid h-9 w-9 place-items-center rounded-full border border-line bg-wash">
                          <TokenDot symbol="MUSD" size={22} />
                        </span>
                        <span>
                          <span className="flex items-center gap-2 font-semibold">
                            {x.name}
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: marketColor(id) }} />
                          </span>
                          <span className="flex items-center gap-1 text-[12.5px] text-mute">
                            MUSD <span className="text-faint">against</span> <TokenDot symbol="BTC" size={12} /> BTC
                          </span>
                        </span>
                      </Link>
                    </Td>
                    <Td align="right">
                      <span className="t-num font-medium">{fmtNum(k.supplied, 2)}</span>
                      <span className="block text-[12.5px] text-faint">{fmtNum(k.idle, 2)} available</span>
                    </Td>
                    <Td>
                      <span className="t-num text-[13px]">{fmtPct(k.utilization, 1)}</span>
                      <UtilBar u={k.utilization} className="mt-1.5 w-28" />
                    </Td>
                    <Td align="right">
                      <span className="t-num font-semibold text-tang-deep">{fmtPct(k.supplyApy)}</span>
                    </Td>
                    <Td align="right">
                      <span className="t-num font-semibold">{fmtPct(k.borrowApy)}</span>
                    </Td>
                    <Td align="right">
                      <span className="t-num">{fmtPct(k.ltv, 0)}</span>
                    </Td>
                    <Td align="right">
                      <span className="inline-flex gap-2">
                        <Link href="/supply" onClick={() => setSettings({ marketId: id })}>
                          <Button variant="supply" size="sm">
                            Supply
                          </Button>
                        </Link>
                        <Link href="/borrow" onClick={() => setSettings({ marketId: id })}>
                          <Button variant="outline" size="sm">
                            Borrow
                          </Button>
                        </Link>
                      </span>
                    </Td>
                  </tr>
                );
              })}
              {!markets &&
                [0, 1].map((i) => (
                  <tr key={i}>
                    <td colSpan={7} className="border-b border-line px-5 py-5">
                      <Skeleton className="h-6 w-full" />
                    </td>
                  </tr>
                ))}
            </tbody>
          </Table>
        </Card>
      </section>

      {/* ───────────── How it works ───────────── */}
      <section className={`${wrap} pt-24`}>
        <SectionHead title="How MezoLend works" lead="Two groups of people share one pool. Smart contracts set the rate, hold the collateral and enforce the limits." />
        <FlowDiagram />
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {[
            {
              t: "For lenders",
              d: "Supply MUSD and receive pool shares. Their value rises every second as borrowers pay interest. Withdraw whenever the pool has idle MUSD.",
            },
            {
              t: "For borrowers",
              d: "Post BTC and borrow MUSD up to the market's limit. Repay any time, partly or in full, and take your BTC back.",
            },
            {
              t: "If BTC falls too far",
              d: "When a loan's health factor drops below 1.0, anyone can repay part of it and receive BTC at a small discount. Lenders stay whole.",
            },
          ].map((c) => (
            <Card key={c.t} as="div" className="p-5">
              <h3 className="font-semibold">{c.t}</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-mute">{c.d}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* ───────────── Feature: risk ───────────── */}
      <section className={`${wrap} grid items-center gap-10 pt-24 lg:grid-cols-[0.85fr_1.15fr]`}>
        <div>
          <h2 className="t-title text-[30px] sm:text-[34px]">See your liquidation price before you borrow</h2>
          <p className="mt-4 text-[15.5px] leading-relaxed text-mute">
            Every loan has a <Term k="healthFactor">health factor</Term>. MezoLend shows how it changes before you sign, how far BTC can fall
            before you&apos;re at risk, and alerts you when a loan gets close.
          </p>
          <ul className="mt-6 space-y-2.5 text-[14.5px]">
            {[
              "Live preview of health factor and liquidation price on every form",
              "Price scenarios: see your loan at any BTC price",
              "Alerts in the app and in your browser when health drops",
            ].map((t) => (
              <li key={t} className="flex gap-2.5">
                <Plus size={16} className="mt-1 shrink-0 text-tang-deep" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <RiskDemo price={totals?.btcPrice ?? 0} lt={markets ? metrics(markets[0]).lt : 0.8} />
      </section>

      {/* ───────────── Feature: rates ───────────── */}
      <section className={`${wrap} grid items-center gap-10 pt-24 lg:grid-cols-[1.15fr_0.85fr]`}>
        <Card className="order-2 p-4 lg:order-1">
          {markets ? (
            <RateCurve series={markets.map((x) => ({ name: x.name, params: rateParams(x), current: metrics(x).utilization, color: marketColor(Number(x.id)) }))} />
          ) : (
            <Skeleton className="h-[280px] w-full" />
          )}
        </Card>
        <div className="order-1 lg:order-2">
          <h2 className="t-title text-[30px] sm:text-[34px]">Rates set by supply and demand</h2>
          <p className="mt-4 text-[15.5px] leading-relaxed text-mute">
            Each market has a rate curve stored on-chain. When more of the pool is borrowed, rates rise to attract lenders and
            encourage repayment. The chart is drawn from the live contract parameters, and the dots show where each market is now.
          </p>
          <Link href="/markets" className="mt-5 inline-flex items-center gap-1.5 text-[14.5px] font-semibold text-tang-deep hover:underline">
            View market parameters <ArrowRight size={15} />
          </Link>
        </div>
      </section>

      {/* ───────────── FAQ ───────────── */}
      <section className={`${wrap} grid gap-10 pt-24 lg:grid-cols-[0.85fr_1.15fr]`}>
        <div>
          <h2 className="t-title text-[30px] sm:text-[34px]">Questions</h2>
          <p className="mt-3 text-[15.5px] text-mute">
            More in the{" "}
            <Link href="/docs" className="font-medium text-tang-deep hover:underline">
              docs
            </Link>
            .
          </p>
        </div>
        <div className="divide-y divide-line border-y border-line">
          {faqs.map((f) => (
            <details key={f.q} className="group py-4">
              <summary className="flex cursor-pointer items-center justify-between gap-4 text-[15px] font-semibold">
                {f.q}
                <Plus size={18} className="shrink-0 text-faint transition-transform group-open:rotate-45" aria-hidden />
              </summary>
              <p className="mt-2 pr-8 text-[14.5px] leading-relaxed text-mute">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ───────────── CTA ───────────── */}
      <section className={`${wrap} pt-24`}>
        <div className="flex flex-col items-start justify-between gap-6 rounded-[18px] border border-tang-line bg-tang-soft px-6 py-8 sm:flex-row sm:items-center sm:px-10">
          <div>
            <h2 className="t-title text-[24px] sm:text-[28px]">Try it with testnet BTC</h2>
            <p className="mt-1.5 text-[15px] text-mute">Get free testnet BTC, borrow some MUSD against it, then supply it back and watch it earn.</p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <a href={FAUCET} target="_blank" rel="noreferrer">
              <Button variant="outline" size="lg">
                Get testnet BTC
              </Button>
            </a>
            <Link href="/borrow">
              <Button variant="borrow" size="lg">
                Open the app
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

const faqs = [
  {
    q: "Where does the interest for lenders come from?",
    a: "From borrowers. Every loan accrues interest each second at the market's borrow rate. After the reserve share (10% in Core, 15% in Edge), it is added to the pool, so each pool share is worth more MUSD over time.",
  },
  {
    q: "What happens to my BTC when I borrow?",
    a: "It is held by the market's collateral contract, not by a person. You can withdraw it once you repay, or partly earlier as long as your loan stays within the borrowing limit.",
  },
  {
    q: "When can a loan be liquidated?",
    a: "Only when its health factor drops below 1.0, meaning debt has grown past the liquidation threshold of the collateral's value. A liquidator then repays part of the debt and receives that much BTC plus a 5% (Core) or 7.5% (Edge) bonus.",
  },
  {
    q: "Can I always withdraw my MUSD?",
    a: "You can withdraw up to the MUSD that is idle in the pool. If most of it is lent out, rates rise to encourage repayments and new deposits, which frees liquidity again.",
  },
  {
    q: "How is this different from minting MUSD on Mezo?",
    a: "Mezo Borrow mints new MUSD against BTC. MezoLend lends existing MUSD from holders to borrowers, so MUSD holders can earn, and borrowers get smaller loans and rates that follow demand.",
  },
  {
    q: "Is this audited?",
    a: "Not yet. The contracts are covered by unit, fuzz and invariant tests and are deployed on Mezo Testnet, where assets have no value.",
  },
];

function SectionHead({ title, lead, link }: { title: string; lead?: string; link?: { href: string; label: string } }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="t-title text-[30px] sm:text-[34px]">{title}</h2>
        {lead && <p className="mt-2 max-w-2xl text-[15.5px] text-mute">{lead}</p>}
      </div>
      {link && (
        <Link href={link.href} className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-tang-deep hover:underline">
          {link.label} <ArrowRight size={15} />
        </Link>
      )}
    </div>
  );
}

function LivePoolCard() {
  const { markets } = useMarkets();
  const [mid, setMid] = useState(0);
  const m = markets?.[mid];
  const k = m ? metrics(m) : undefined;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-tang opacity-50" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-tang" />
            </span>
            {m ? `${m.name} pool, live` : "Live pool"}
          </span>
        }
        description="Read from the contracts on every block"
        action={
          <Segmented
            size="sm"
            label="Market"
            value={mid}
            onChange={setMid}
            options={(markets ?? [{ name: "Core" }, { name: "Edge" }]).map((x, i) => ({ value: i, label: x.name }))}
          />
        }
      />
      <div className="relative mx-5 mt-4 aspect-[16/10]">
        <PoolScene
          state={{
            utilization: k?.utilization ?? 0.4,
            borrowApy: k?.borrowApy ?? 0.04,
            collateralWeight: k && k.supplied ? Math.min(1, k.collateralUsd / (k.supplied * 2.5)) : 0.5,
          }}
        />
        <span className="pointer-events-none absolute text-[11.5px] font-medium text-mute" style={{ left: `${SCENE.tank.x0 * 100}%`, top: `${(SCENE.tank.y1 + 0.03) * 100}%` }}>
          MUSD pool
        </span>
        <span className="pointer-events-none absolute text-[11.5px] font-medium text-mute" style={{ left: `${SCENE.vault.x0 * 100}%`, top: `${(SCENE.vault.y1 + 0.03) * 100}%` }}>
          BTC collateral
        </span>
        <span className="pointer-events-none absolute text-[11px] text-faint" style={{ left: "46%", top: `${(SCENE.outlet + 0.025) * 100}%` }}>
          loans
        </span>
        <span className="pointer-events-none absolute text-[11px] text-faint" style={{ left: "56%", top: "6%" }}>
          interest
        </span>
      </div>
      <div className="mt-5 grid grid-cols-2 border-t border-line sm:grid-cols-4">
        {[
          { l: "Supplied", v: k ? fmtNum(k.supplied, 2) : undefined, s: "MUSD" },
          { l: "Borrowed", v: k ? fmtNum(k.borrowed, 2) : undefined, s: k ? `${fmtPct(k.utilization, 1)} utilized` : "" },
          { l: "Supply APY", v: k ? fmtPct(k.supplyApy) : undefined, s: "lenders earn", tone: "text-tang-deep" },
          { l: "Borrow APY", v: k ? fmtPct(k.borrowApy) : undefined, s: "borrowers pay" },
        ].map((x, i) => (
          <div
            key={x.l}
            className={`px-5 py-3.5 ${i % 2 ? "border-l border-line" : ""} ${i > 1 ? "border-t border-line sm:border-t-0" : ""} ${i === 2 ? "sm:border-l" : ""}`}
          >
            <p className="text-[12px] text-mute">{x.l}</p>
            <p className={`t-num mt-0.5 text-[17px] font-semibold ${x.tone ?? ""}`}>{x.v ?? <Skeleton className="h-5 w-16" />}</p>
            <p className="text-[11.5px] text-faint">{x.s}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function FlowNode({ title, body, tone }: { title: string; body: string; tone: "supply" | "pool" | "borrow" }) {
  return (
    <div className={`rounded-[12px] border px-5 py-4 ${tone === "pool" ? "border-tang-line bg-tang-soft" : "border-line bg-card"}`}>
      <p className="flex items-center gap-2 font-semibold">
        {tone === "supply" && <TokenDot symbol="MUSD" size={18} />}
        {tone === "borrow" && <TokenDot symbol="BTC" size={18} />}
        {tone === "pool" && <span className="h-2.5 w-2.5 rounded-full bg-tang" />}
        {title}
      </p>
      <p className="mt-1 text-[13.5px] text-mute">{body}</p>
    </div>
  );
}

function FlowLink({ top, bottom }: { top: string; bottom: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-3 text-[12px] text-mute lg:px-3">
      <span className="flex items-center gap-1.5">
        {top} <ArrowRight size={14} className="text-ink max-lg:rotate-90" />
      </span>
      <span className="flex items-center gap-1.5">
        <ArrowLeft size={14} className="text-tang-deep max-lg:rotate-90" /> {bottom}
      </span>
    </div>
  );
}

function FlowDiagram() {
  return (
    <Card className="mt-6 p-5 sm:p-6">
      <div className="grid items-center lg:grid-cols-[1fr_auto_1.1fr_auto_1fr]">
        <FlowNode tone="supply" title="Lenders" body="Supply MUSD and receive mlMUSD pool shares" />
        <FlowLink top="MUSD" bottom="interest" />
        <FlowNode tone="pool" title="MezoLend pool" body="Core or Edge market. The rate follows how much is borrowed." />
        <FlowLink top="MUSD loans" bottom="interest and repayments" />
        <FlowNode tone="borrow" title="Borrowers" body="Post BTC, borrow up to 70% (Core) or 78% (Edge) of its value" />
      </div>
    </Card>
  );
}

function RiskDemo({ price, lt }: { price: number; lt: number }) {
  const [drop, setDrop] = useState(20);
  const collateral = 0.01;
  const debt = price ? Math.round(price * collateral * 0.5) : 400;
  const p = price * (1 - drop / 100);
  const hfNum = p && debt ? (p * collateral * lt) / debt : 0;
  const hf = hfNum ? BigInt(Math.round(hfNum * 1e6)) * 10n ** 12n : undefined;
  const liq = price ? debt / (collateral * lt) : 0;
  const status = hfNum < 1 ? "Can be liquidated" : hfNum < 1.2 ? "Close to liquidation" : hfNum < 1.6 ? "Keep an eye on it" : "Comfortable";
  return (
    <Card>
      <CardHeader title="Example loan" description={`0.01 BTC posted in Core, ${debt} MUSD borrowed`} />
      <CardBody>
        <label className="block">
          <span className="flex justify-between text-[13.5px]">
            <span className="text-mute">If BTC falls by</span>
            <span className="t-num font-semibold">{drop}%</span>
          </span>
          <input type="range" min={0} max={60} value={drop} onChange={(e) => setDrop(Number(e.target.value))} className="thermal mt-1 w-full" aria-label="BTC price drop" />
        </label>
        <div className="mt-3 flex items-end justify-between gap-4">
          <div>
            <p className="text-[12.5px] text-mute">Health factor</p>
            <p className="t-num text-[40px] leading-none font-semibold tracking-[-0.03em]" style={{ color: hf ? heatColor(heat(hf)) : undefined }}>
              {hfNum ? hfNum.toFixed(2) : "—"}
            </p>
          </div>
          <Badge tone={hfNum < 1 ? "danger" : hfNum < 1.6 ? "warn" : "safe"}>{status}</Badge>
        </div>
        <div className="mt-4">
          <HealthBar hf={hf} />
        </div>
        <div className="mt-5 border-t border-line pt-4">
          <PriceRunway price={p} liqPrice={liq} />
        </div>
      </CardBody>
    </Card>
  );
}
