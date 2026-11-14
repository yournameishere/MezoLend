import type { Metadata } from "next";
import Link from "next/link";
import { glossary } from "@/lib/glossary";
import { contractLinks, FAUCET, MEZO_BORROW } from "@/config/contracts";
import { ExplorerLink } from "@/components/ui/Primitives";
import { Card } from "@/components/ui/Card";

export const metadata: Metadata = {
  title: "Documentation",
  description: "How MezoLend works: supplying, borrowing, health factor, liquidations, fees, risks and contract addresses.",
};

const toc = [
  { id: "overview", label: "Overview" },
  { id: "lending", label: "Supplying MUSD" },
  { id: "borrowing", label: "Borrowing MUSD" },
  { id: "health", label: "Health factor" },
  { id: "liquidations", label: "Liquidations" },
  { id: "rates", label: "Interest rates" },
  { id: "mezo-borrow", label: "MezoLend vs Mezo Borrow" },
  { id: "fees", label: "Fees" },
  { id: "risks", label: "Risks" },
  { id: "testnet", label: "Testnet assets" },
  { id: "glossary", label: "Glossary" },
  { id: "contracts", label: "Contracts and security" },
];

const lenderSteps = [
  ["Connect a wallet", "Any EVM wallet on Mezo Testnet. MezoLend adds the network for you."],
  ["Pick a market", "Core is conservative. Edge pays lenders more because its borrowers can borrow closer to their limit."],
  ["Approve and supply MUSD", "Two transactions the first time: a spending approval, then the deposit. You receive pool shares (mlMUSD)."],
  ["Earn while it's lent out", "Borrowers pay interest every second. Your shares become worth more MUSD, and the dashboard shows what you've earned."],
  ["Withdraw when you like", "Instantly, up to the pool's idle MUSD. If most of it is lent out, rates rise to bring repayments in."],
];

const borrowerSteps = [
  ["Deposit BTC", "Your BTC goes into the market's collateral contract, not to a person and not to the lenders."],
  ["Borrow MUSD", "Up to the market's max LTV. A one-time origination fee is added to your debt."],
  ["Watch your health factor", "It falls if BTC drops or interest builds up. MezoLend alerts you before it gets close to 1.0."],
  ["Repay any time", "Partly or in full, with no penalty. Anyone can also repay on your behalf."],
  ["Take your BTC back", "Once repaid, or partly earlier as long as you stay within your limit."],
];

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
      <div className="grid gap-10 pt-10 lg:grid-cols-[220px_1fr]">
        <aside className="hidden lg:block">
          <nav aria-label="On this page" className="sticky top-24">
            <p className="mb-3 text-[12.5px] font-semibold text-ink">Documentation</p>
            <ul className="space-y-0.5 border-l border-line">
              {toc.map((t) => (
                <li key={t.id}>
                  <a href={`#${t.id}`} className="-ml-px block border-l border-transparent py-1.5 pl-4 text-[13.5px] text-mute transition-colors hover:border-tang hover:text-ink">
                    {t.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <article className="min-w-0 max-w-3xl text-[15px] leading-relaxed text-mute">
          <header id="overview" className="scroll-mt-24">
            <h1 className="t-title text-[34px] text-ink">How MezoLend works</h1>
            <p className="mt-4 text-[16.5px]">
              MezoLend is a lending market for MUSD, Mezo&apos;s bitcoin-backed dollar. People who hold MUSD supply it to a pool and earn
              interest. People who hold BTC post it as collateral and borrow from that pool. Smart contracts hold the funds, set the rates and
              enforce the rules.
            </p>
          </header>

          <Section id="lending" title="Supplying MUSD">
            <Steps steps={lenderSteps} />
            <p className="mt-4">
              <Link href="/supply" className="font-semibold text-tang-deep hover:underline">
                Go to Supply
              </Link>
            </p>
          </Section>

          <Section id="borrowing" title="Borrowing MUSD">
            <Steps steps={borrowerSteps} />
            <p className="mt-4">
              <Link href="/borrow" className="font-semibold text-tang-deep hover:underline">
                Go to Borrow
              </Link>
            </p>
          </Section>

          <Section id="health" title="Health factor">
            <p>
              Health factor = collateral value × liquidation threshold ÷ debt. With 0.01 BTC at $70,000 in Core (80% liquidation threshold)
              and 400 MUSD of debt, the health factor is 700 × 0.8 ÷ 400 = 1.4. It falls as BTC drops or interest accrues, and rises when you
              add BTC or repay.
            </p>
            <Callout>
              Below 1.0 a loan can be liquidated. MezoLend shows the BTC price where that happens on every form, and sends an alert when a loan
              crosses your warning level (1.5 by default, adjustable in the notification panel).
            </Callout>
          </Section>

          <Section id="liquidations" title="Liquidations">
            <p>
              When a health factor drops below 1.0, anyone can call the market&apos;s liquidation contract. They repay part of the debt in MUSD
              and receive BTC worth that amount plus a bonus (5% in Core, 7.5% in Edge). A share of the bonus goes to protocol reserves.
            </p>
            <ul className="mt-3 list-disc space-y-1.5 pl-5">
              <li>At most 50% of a loan can be repaid per liquidation, so borrowers keep part of their position.</li>
              <li>Loans below health factor 0.95, or with 100 MUSD of debt or less, can be closed in one go.</li>
              <li>If a loan runs out of collateral with debt left, the remainder is written off: reserves absorb it first, then lenders.</li>
            </ul>
            <p className="mt-3">
              The{" "}
              <Link href="/liquidations" className="font-semibold text-tang-deep hover:underline">
                Liquidations page
              </Link>{" "}
              lists every open loan. A keeper script in the repository can also liquidate automatically.
            </p>
          </Section>

          <Section id="rates" title="Interest rates">
            <p>
              Each market uses a kinked rate curve stored in its rate-model contract. Below the kink, the borrow rate rises gently with
              utilization; above it, steeply, to pull borrowers back and bring lenders in. Lenders earn the borrow rate × utilization × (1 −
              reserve factor). Interest accrues every second.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[480px] text-[14px]">
                <thead>
                  <tr className="border-b border-line text-left text-[12.5px] text-mute">
                    <th className="py-2 pr-4 font-medium">Market</th>
                    <th className="py-2 pr-4 font-medium">Base</th>
                    <th className="py-2 pr-4 font-medium">Up to kink</th>
                    <th className="py-2 pr-4 font-medium">Kink</th>
                    <th className="py-2 font-medium">Above kink</th>
                  </tr>
                </thead>
                <tbody className="text-ink">
                  <tr className="border-b border-line">
                    <td className="py-2 pr-4 font-medium">Core</td>
                    <td className="py-2 pr-4">1%</td>
                    <td className="py-2 pr-4">+6%</td>
                    <td className="py-2 pr-4">80%</td>
                    <td className="py-2">+80%</td>
                  </tr>
                  <tr className="border-b border-line">
                    <td className="py-2 pr-4 font-medium">Edge</td>
                    <td className="py-2 pr-4">2%</td>
                    <td className="py-2 pr-4">+10%</td>
                    <td className="py-2 pr-4">85%</td>
                    <td className="py-2">+120%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="mezo-borrow" title="MezoLend vs Mezo Borrow">
            <p>
              Mezo&apos;s own borrowing (Troves) mints new MUSD against BTC, with a fixed rate and a 2,000 MUSD minimum. MezoLend doesn&apos;t mint
              anything. It moves existing MUSD from people who have it to people who need it, at a rate set by supply and demand. That gives MUSD
              holders a way to earn, and gives borrowers smaller loans (from 10 MUSD), a choice of markets, and rates that fall when demand is low.
            </p>
          </Section>

          <Section id="fees" title="Fees">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>Origination fee: 0.10% in Core, 0.25% in Edge, added to your debt when you borrow.</li>
              <li>Reserve factor: 10% (Core) or 15% (Edge) of borrower interest goes to protocol reserves, which absorb bad debt first.</li>
              <li>Liquidation share: 10% (Core) or 15% (Edge) of a liquidator&apos;s bonus goes to reserves.</li>
              <li>Supplying, withdrawing, repaying and adding collateral are free apart from network gas, paid in BTC on Mezo.</li>
            </ul>
          </Section>

          <Section id="risks" title="Risks">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <span className="font-semibold text-ink">Liquidation risk for borrowers.</span> If BTC falls far enough that your health factor drops below
                1.0, part of your BTC can be sold to a liquidator at a discount.
              </li>
              <li>
                <span className="font-semibold text-ink">Liquidity risk for lenders.</span> You can only withdraw MUSD that isn&apos;t lent out. At high
                utilization you may need to wait for repayments or new deposits.
              </li>
              <li>
                <span className="font-semibold text-ink">Bad debt for lenders.</span> If a loan&apos;s collateral is worth less than its debt when liquidated,
                reserves cover the gap first, then lenders in that market share it.
              </li>
              <li>
                <span className="font-semibold text-ink">Oracle risk.</span> Prices come from Mezo&apos;s Skip oracle with a Pyth fallback. If both go stale,
                borrowing, withdrawals and liquidations pause until prices return.
              </li>
              <li>
                <span className="font-semibold text-ink">Smart-contract risk.</span> The contracts are tested with unit, fuzz and invariant tests but not
                audited. This deployment is on testnet with valueless assets.
              </li>
            </ul>
          </Section>

          <Section id="testnet" title="Testnet assets">
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>
                Get testnet BTC from the{" "}
                <a href={FAUCET} target="_blank" rel="noreferrer" className="font-medium text-tang-deep hover:underline">
                  Mezo faucet
                </a>
                . It pays for gas and works as collateral.
              </li>
              <li>
                Get MUSD by borrowing it here against your BTC, or by minting it on{" "}
                <a href={MEZO_BORROW} target="_blank" rel="noreferrer" className="font-medium text-tang-deep hover:underline">
                  Mezo Borrow
                </a>
                .
              </li>
              <li>Add MUSD to your wallet from the wallet menu in the top right.</li>
            </ol>
          </Section>

          <Section id="glossary" title="Glossary">
            <dl className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
              {Object.values(glossary).map((g) => (
                <div key={g.term}>
                  <dt className="font-semibold text-ink">{g.term}</dt>
                  <dd className="mt-1 text-[14.5px]">{g.text}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section id="contracts" title="Contracts and security">
            <p>
              Each market is four contracts: a lending pool (an ERC-4626 vault plus the debt ledger), a collateral manager (custody and risk
              settings), a borrow manager (limits and health checks) and a liquidation manager, plus its own rate model. A registry lists the
              markets and a read-only lens powers this site. All are verified on the Mezo Testnet explorer.
            </p>
            <Card as="div" className="mt-5">
              <ul className="divide-y divide-line">
                {contractLinks.map((c) => (
                  <li key={c.label} className="flex items-center justify-between gap-4 px-5 py-2.5 text-[14px]">
                    <span className="text-ink">{c.label}</span>
                    <ExplorerLink address={c.address} />
                  </li>
                ))}
              </ul>
            </Card>
            <h3 className="mt-8 font-semibold text-ink">Safety measures in the code</h3>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>Reentrancy guards on every state-changing entry point, with checks-effects-interactions ordering.</li>
              <li>Oracle validation: staleness windows, min/max price bounds, a Pyth confidence ceiling, and a fallback source.</li>
              <li>New debt and collateral withdrawals checked against the LTV limit; liquidations only below health factor 1.0, capped by a close factor.</li>
              <li>A bad-debt write-off path so insolvent accounts can&apos;t linger; reserves absorb losses first.</li>
              <li>Role-based admin with an emergency pause that never blocks repaying or adding collateral.</li>
              <li>Internal cash accounting so token donations can&apos;t manipulate share prices; supply and borrow caps.</li>
            </ul>
          </Section>
        </article>
      </div>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-12 scroll-mt-24 border-t border-line pt-10">
      <h2 className="t-title mb-4 text-[24px] text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Steps({ steps }: { steps: string[][] }) {
  return (
    <ol className="space-y-4">
      {steps.map(([t, d], i) => (
        <li key={t} className="grid grid-cols-[28px_1fr] gap-3">
          <span className="t-num grid h-6 w-6 place-items-center rounded-full bg-tang-soft text-[12.5px] font-semibold text-tang-deep">{i + 1}</span>
          <div>
            <p className="font-semibold text-ink">{t}</p>
            <p className="mt-0.5 text-[14.5px]">{d}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return <div className="mt-4 rounded-[12px] border border-tang-line bg-tang-soft px-4 py-3 text-[14.5px] text-ink">{children}</div>;
}
