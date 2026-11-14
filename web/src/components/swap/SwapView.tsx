"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useBalance, useReadContract } from "wagmi";
import { erc20Abi, type Abi, type Address } from "viem";
import { useMarkets, useUserOverview } from "@/hooks/useProtocol";
import { NO_PERMIT, useTx, type TxStep } from "@/hooks/useTx";
import { PageHeader, Panel } from "@/components/market/PageHeader";
import { metrics } from "@/components/market/useMarketMetrics";
import { AmountInput, TokenDot } from "@/components/ui/AmountInput";
import { Button } from "@/components/ui/Button";
import { ExplorerLink, Segmented, Skeleton } from "@/components/ui/Primitives";
import { Steps } from "@/components/ui/Steps";
import { ConnectPrompt, useMounted } from "@/components/shell/Wallet";
import { BTC, FAUCET, GAS_RESERVE, MEZO, ZAP, mezoLendZapAbi } from "@/config/contracts";
import { fmtAmount, fmtNum, fmtPct, fmtUsd, parseAmount, toNum } from "@/lib/format";
import { chain } from "@/lib/wagmi";

type Token = "BTC" | "MEZO";
type Then = "keep" | "lend" | "repay";
const SLIPPAGES = [0.005, 0.01, 0.02];

export function SwapView() {
  const mounted = useMounted();
  const { markets } = useMarkets();
  const { user, account } = useUserOverview();
  const tx = useTx();

  const [token, setToken] = useState<Token>("BTC");
  const [then, setThen] = useState<Then>("keep");
  const [marketId, setMarketId] = useState(0);
  const [value, setValue] = useState("");
  const [slippage, setSlippage] = useState(0.01);

  const tokenAddr: Address = token === "BTC" ? BTC : MEZO;
  const amount = parseAmount(value) ?? 0n;
  const market = markets?.[marketId];
  const um = user?.markets[marketId];
  const debt = um?.debt ?? 0n;

  const btcBal = useBalance({ address: account, chainId: chain.id, query: { enabled: !!account, refetchInterval: 8_000 } });
  const mezoBal = useReadContract({
    address: MEZO,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    chainId: chain.id,
    query: { enabled: !!account, refetchInterval: 8_000 },
  });
  const balance = token === "BTC" ? btcBal.data?.value : mezoBal.data;
  const max = token === "BTC" ? (balance !== undefined ? (balance > GAS_RESERVE ? balance - GAS_RESERVE : 0n) : undefined) : balance;

  // Live quote from Mezo Pools (through the zap's view, which uses the exact route it will trade on).
  const quote = useReadContract({
    address: ZAP,
    abi: mezoLendZapAbi,
    functionName: "quote",
    args: [tokenAddr, amount > 0n ? amount : 10n ** 16n],
    chainId: chain.id,
    query: { refetchInterval: 10_000 },
  });
  const unitQuote = useReadContract({
    address: ZAP,
    abi: mezoLendZapAbi,
    functionName: "quote",
    args: [tokenAddr, 10n ** 18n],
    chainId: chain.id,
    query: { refetchInterval: 15_000 },
  });
  const out = amount > 0n ? quote.data : undefined;
  const minOut = out !== undefined ? (out * BigInt(Math.round((1 - slippage) * 10_000))) / 10_000n : 0n;
  const rate = unitQuote.data !== undefined ? toNum(unitQuote.data) : undefined;
  const oraclePrice = market ? metrics(market).btcPrice : 0;
  const drift = token === "BTC" && rate && oraclePrice ? rate / oraclePrice - 1 : 0;

  useEffect(() => {
    if (then === "repay" && debt === 0n) setThen("keep");
  }, [then, debt]);

  const error =
    amount > 0n && max !== undefined && amount > max
      ? token === "BTC"
        ? "That's more than your BTC balance minus a little kept for gas."
        : "That's more MEZO than your wallet holds."
      : amount > 0n && quote.isError
        ? "Mezo Pools couldn't quote this swap. Try a smaller amount."
        : undefined;

  const steps: TxStep[] = useMemo(() => {
    if (!account || amount === 0n || !market) return [];
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
    const isBtc = token === "BTC";
    const outLabel = out !== undefined ? `${fmtNum(toNum(out), 2)} MUSD` : "MUSD";
    let fn: string;
    let build: (p: typeof NO_PERMIT) => readonly unknown[];
    let label: string;
    let done: TxStep["done"];
    if (then === "lend") {
      fn = "swapAndSupply";
      build = (p) => [tokenAddr, amount, minOut, market.pool, account, deadline, p];
      label = `Swap ${fmtAmount(amount)} ${token} and lend in ${market.name}`;
      done = { title: `Lent about ${outLabel} in ${market.name}`, body: `Swapped ${fmtAmount(amount)} ${token} on Mezo Pools and supplied it in one transaction.` };
    } else if (then === "repay") {
      fn = "swapAndRepay";
      build = (p) => [tokenAddr, amount, minOut, market.pool, account, deadline, p];
      label = `Swap ${fmtAmount(amount)} ${token} and repay in ${market.name}`;
      done = { title: `Repaid with ${fmtAmount(amount)} ${token}`, body: "Any MUSD left after clearing the loan was sent to your wallet." };
    } else {
      fn = "swapToMusd";
      build = (p) => [tokenAddr, amount, minOut, account, deadline, p];
      label = `Swap ${fmtAmount(amount)} ${token} for MUSD`;
      done = { title: `Got about ${outLabel}`, body: `Swapped ${fmtAmount(amount)} ${token} on Mezo Pools.` };
    }
    return [
      {
        key: "swap",
        label,
        address: ZAP,
        abi: mezoLendZapAbi as Abi,
        functionName: fn,
        args: build(NO_PERMIT),
        value: isBtc ? amount : undefined,
        permit: isBtc ? undefined : { token: MEZO, spender: ZAP, value: amount, buildArgs: build },
        gasFloor: 700_000n,
        done,
      },
    ];
  }, [account, amount, market, token, then, tokenAddr, minOut, out]);

  const submit = async () => {
    if (await tx.run(steps)) setValue("");
  };

  const cta =
    then === "lend" ? `Swap and lend in ${market?.name ?? "the market"}` : then === "repay" ? "Swap and repay my loan" : "Swap for MUSD";

  return (
    <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
      <PageHeader
        title="Get MUSD"
        intro="Swap BTC or MEZO for MUSD on Mezo Pools. Keep it, lend it straight away, or put it toward a loan, all in one transaction."
      />

      <div className="grid gap-10 pb-20 lg:grid-cols-[minmax(0,520px)_1fr] lg:gap-14">
        <Panel>
          <div className="space-y-6 p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[14px] font-semibold">You pay with</span>
              <Segmented
                label="Token to swap"
                value={token}
                onChange={(t) => {
                  setToken(t);
                  setValue("");
                  tx.reset();
                }}
                options={[
                  { value: "BTC", label: "BTC" },
                  { value: "MEZO", label: "MEZO" },
                ]}
              />
            </div>

            <AmountInput
              label={`${token} to swap`}
              value={value}
              onChange={(v) => {
                setValue(v);
                tx.reset();
              }}
              symbol={token}
              max={mounted && account ? max : undefined}
              maxLabel={token === "BTC" ? "Usable" : "Balance"}
              usdPrice={token === "BTC" ? oraclePrice : rate}
              error={error}
            />

            <fieldset>
              <legend className="text-[14px] font-semibold">Then</legend>
              <div className="mt-2 grid gap-2">
                <Choice checked={then === "keep"} onSelect={() => setThen("keep")} title="Keep the MUSD in my wallet" body="Use it anywhere on Mezo." />
                <Choice
                  checked={then === "lend"}
                  onSelect={() => setThen("lend")}
                  title="Lend it right away"
                  body={market ? `Supplied to ${market.name}, earning ${fmtPct(metrics(market).supplyApy)} a year now.` : "Supplied to a market."}
                />
                <Choice
                  checked={then === "repay"}
                  onSelect={() => setThen("repay")}
                  disabled={debt === 0n}
                  title="Pay down my loan"
                  body={debt > 0n ? `You owe ${fmtAmount(debt, 18, { max: 2 })} MUSD in ${market?.name}. Extra MUSD comes back to you.` : `No loan in ${market?.name ?? "this market"}.`}
                />
              </div>
              {then !== "keep" && markets && markets.length > 1 && (
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-[13.5px] text-mute">Market</span>
                  <Segmented
                    size="sm"
                    label="Market"
                    value={marketId}
                    onChange={setMarketId}
                    options={markets.map((m, i) => ({ value: i, label: m.name }))}
                  />
                </div>
              )}
            </fieldset>

            <div className="rounded-[10px] bg-tang-soft px-4 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[14px] font-semibold">You get about</span>
                <span className="text-[24px] font-extrabold tracking-[-0.02em]">
                  {amount === 0n ? "0 MUSD" : quote.isLoading ? <Skeleton className="h-6 w-28" /> : out !== undefined ? `${fmtNum(toNum(out), 2)} MUSD` : "…"}
                </span>
              </div>
              <dl className="mt-3 space-y-1.5 text-[13.5px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-mute">Pool rate</dt>
                  <dd className="font-medium">{rate !== undefined ? `1 ${token} = ${fmtNum(rate, rate > 100 ? 0 : 4)} MUSD` : "…"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-mute">Minimum after {fmtNum(slippage * 100, 1)}% slippage</dt>
                  <dd className="font-medium">{out !== undefined ? `${fmtNum(toNum(minOut), 2)} MUSD` : "…"}</dd>
                </div>
              </dl>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-[13px] text-mute">Slippage limit</span>
                <Segmented
                  size="sm"
                  label="Slippage limit"
                  value={slippage}
                  onChange={setSlippage}
                  options={SLIPPAGES.map((s) => ({ value: s, label: `${s * 100}%` }))}
                />
              </div>
            </div>

            {!mounted || !account ? (
              <ConnectPrompt tone="supply" label="Connect a wallet to swap" />
            ) : (
              <Button variant="supply" size="lg" className="w-full" disabled={amount === 0n || !!error || out === undefined} loading={tx.busy} onClick={submit}>
                {cta}
              </Button>
            )}
            {token === "MEZO" && <p className="text-[13px] text-mute">Your wallet asks for one signature (a MEZO permit) and then one transaction.</p>}
            {tx.error && (
              <p role="alert" className="text-[13.5px] font-medium text-danger">
                {tx.error}
              </p>
            )}
            <Steps steps={tx.steps} states={tx.states} hashes={tx.hashes} />
          </div>
        </Panel>

        <aside className="space-y-10">
          <section>
            <h2 className="text-[19px] font-bold tracking-[-0.015em]">How the swap works</h2>
            <ol className="mt-4 space-y-4 text-[15px] leading-relaxed text-mute">
              <li>
                <span className="font-semibold text-ink">One transaction.</span> BTC is sent with the transaction, so there is no approval. MEZO is
                pulled with a permit signature instead of an approval.
              </li>
              <li>
                <span className="font-semibold text-ink">Mezo Pools does the trade.</span> MezoLend&apos;s swap contract routes through the
                {token === "BTC" ? " BTC/MUSD" : " MEZO/MUSD"} pool and refuses to finish if you would get less than your minimum.
              </li>
              <li>
                <span className="font-semibold text-ink">Nothing is held in between.</span> The MUSD goes to your wallet, into the pool in your
                name, or onto your loan before the transaction ends.
              </li>
            </ol>
            <p className="mt-4 text-[13.5px] text-mute">
              Swap contract: <ExplorerLink address={ZAP} />
            </p>
          </section>

          {drift !== 0 && Math.abs(drift) > 0.02 && (
            <section className="border-l-[3px] border-tang pl-5">
              <h2 className="text-[16px] font-bold">Pool price versus oracle</h2>
              <p className="mt-1.5 text-[14.5px] leading-relaxed text-mute">
                Mezo Pools pays {fmtNum(Math.abs(drift) * 100, 1)}% {drift > 0 ? "more" : "less"} for BTC than Mezo&apos;s oracle price of{" "}
                {fmtUsd(oraclePrice)}. Testnet pools aren&apos;t arbitraged, so this gap is normal here. MezoLend always values collateral at the
                oracle price.
              </p>
            </section>
          )}

          <section>
            <h2 className="text-[19px] font-bold tracking-[-0.015em]">Your wallet</h2>
            {!mounted || !account ? (
              <p className="mt-3 text-[15px] text-mute">Connect a wallet to see your balances.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line border-y border-line">
                {[
                  { s: "BTC", v: btcBal.data?.value },
                  { s: "MEZO", v: mezoBal.data },
                  { s: "MUSD", v: user?.musdBalance },
                ].map((b) => (
                  <li key={b.s} className="flex items-center justify-between py-3 text-[15px]">
                    <span className="flex items-center gap-2.5 font-semibold">
                      <TokenDot symbol={b.s} /> {b.s}
                    </span>
                    <span className="t-num font-medium">{b.v === undefined ? "…" : fmtAmount(b.v, 18, { max: b.s === "BTC" ? 6 : 2 })}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-[14px] text-mute">
              Out of BTC?{" "}
              <a href={FAUCET} target="_blank" rel="noreferrer" className="font-semibold text-tang-deep underline decoration-tang-line underline-offset-4">
                Claim some from the Mezo faucet
              </a>
              . Already have MUSD?{" "}
              <Link href="/lend" className="font-semibold text-tang-deep underline decoration-tang-line underline-offset-4">
                Lend it
              </Link>
              .
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Choice({
  checked,
  onSelect,
  title,
  body,
  disabled,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  body: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-[10px] border-[1.5px] px-4 py-3 transition-colors ${
        checked ? "border-ink bg-tang-soft" : "border-line-2 hover:border-ink"
      } ${disabled ? "pointer-events-none opacity-45" : ""}`}
    >
      <input type="radio" name="then" checked={checked} onChange={onSelect} disabled={disabled} className="mt-1 accent-[#2a1c10]" />
      <span>
        <span className="block text-[14.5px] font-semibold">{title}</span>
        <span className="block text-[13.5px] text-mute">{body}</span>
      </span>
    </label>
  );
}
