"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useBalance, useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain, useWatchAsset } from "wagmi";
import { ChevronDown, Copy, Droplets, LayoutDashboard, LogOut, Plus, Wallet as WalletIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TokenDot } from "@/components/ui/AmountInput";
import { ExplorerLink } from "@/components/ui/Primitives";
import { FAUCET, MUSD } from "@/config/contracts";
import { explainError } from "@/lib/errors";
import { fmtAmount, shortAddr } from "@/lib/format";
import { chain } from "@/lib/wagmi";
import { useUserOverview } from "@/hooks/useProtocol";

/** Avoid hydration mismatch: wallet state only exists in the browser. */
const noopSubscribe = () => () => {};
export function useMounted() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/** Deterministic two-tone avatar from an address. */
export function Avatar({ address, size = 22 }: { address: string; size?: number }) {
  const h = parseInt(address.slice(2, 8), 16);
  const a = 18 + (h % 24); // warm hue band
  const b = (h >> 8) % 360;
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(from ${h % 360}deg, hsl(${a} 95% 62%), hsl(${b} 35% 22%), hsl(${a} 95% 62%))`,
      }}
    />
  );
}

export function ConnectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const connectors = useConnectors();
  const { connectAsync, isPending, variables } = useConnect();
  const [err, setErr] = useState<string>();

  const list = useMemo(() => {
    const discovered = connectors.filter((c) => c.id !== "injected");
    return discovered.length ? discovered : connectors;
  }, [connectors]);

  const mounted = useMounted();
  const hasProvider = !mounted || list.length > 1 || !!(window as { ethereum?: unknown }).ethereum;

  return (
    <Dialog open={open} onClose={onClose} title="Connect a wallet">
      <p className="mb-4 text-[13.5px] text-mute">MezoLend runs on Mezo Testnet. Any EVM wallet works, and we add the network for you.</p>
      {hasProvider ? (
        <ul className="space-y-2">
          {list.map((c) => {
            const pending = isPending && (variables?.connector as { uid?: string } | undefined)?.uid === c.uid;
            return (
              <li key={c.uid}>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={async () => {
                    setErr(undefined);
                    try {
                      await connectAsync({ connector: c, chainId: chain.id });
                      onClose();
                    } catch (e) {
                      setErr(explainError(e));
                    }
                  }}
                  className="flex w-full items-center gap-3 rounded-[10px] border border-line bg-paper px-4 py-3 text-left transition-colors hover:border-line-2 hover:bg-wash disabled:opacity-60"
                >
                  {c.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.icon} alt="" className="h-7 w-7 rounded-md" />
                  ) : (
                    <span className="grid h-7 w-7 place-items-center rounded-md bg-wash text-mute">
                      <WalletIcon size={16} />
                    </span>
                  )}
                  <span className="font-semibold">{c.id === "injected" ? "Browser wallet" : c.name}</span>
                  {pending && <span className="ml-auto text-[12.5px] text-mute">Check your wallet</span>}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-[10px] border border-line bg-wash p-4 text-[13.5px] leading-relaxed text-mute">
          No browser wallet found. Install{" "}
          <a className="font-medium text-tang-deep underline" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
            MetaMask
          </a>{" "}
          or{" "}
          <a className="font-medium text-tang-deep underline" href="https://rabby.io" target="_blank" rel="noreferrer">
            Rabby
          </a>
          , then reload this page.
        </div>
      )}
      {err && <p className="mt-3 text-[13px] text-danger">{err}</p>}
      <p className="mt-5 text-[12.5px] text-faint">
        Need testnet BTC for gas and collateral? Get some from the{" "}
        <a href={FAUCET} target="_blank" rel="noreferrer" className="text-mute underline">
          Mezo faucet
        </a>
        .
      </p>
    </Dialog>
  );
}

export function WalletButton() {
  const mounted = useMounted();
  const { address, isConnected, chainId } = useConnection();
  const { disconnect } = useDisconnect();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const { watchAssetAsync } = useWatchAsset();
  const { data: bal } = useBalance({ address, chainId: chain.id, query: { enabled: !!address, refetchInterval: 10_000 } });
  const { user } = useUserOverview();
  const [connectOpen, setConnectOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!mounted) return <div className="h-10 w-[136px]" />;

  if (!isConnected || !address) {
    return (
      <>
        <Button variant="solid" onClick={() => setConnectOpen(true)}>
          <WalletIcon size={16} aria-hidden />
          <span className="hidden sm:inline">Connect wallet</span>
          <span className="sm:hidden">Connect</span>
        </Button>
        <ConnectDialog open={connectOpen} onClose={() => setConnectOpen(false)} />
      </>
    );
  }

  if (chainId !== chain.id) {
    return (
      <Button variant="danger" loading={switching} onClick={() => switchChainAsync({ chainId: chain.id }).catch(() => {})}>
        Switch to Mezo Testnet
      </Button>
    );
  }

  const item = "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13.5px] text-ink hover:bg-wash";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMenu((m) => !m)}
        aria-expanded={menu}
        aria-haspopup="menu"
        className="flex h-10 items-center gap-2 rounded-[var(--radius-ctl)] border border-line bg-paper pr-2.5 pl-2 text-[13.5px] font-semibold transition-colors hover:border-line-2"
      >
        <Avatar address={address} />
        <span className="font-mono text-[13px] whitespace-nowrap">{shortAddr(address)}</span>
        <ChevronDown size={14} className="text-faint" aria-hidden />
      </button>
      {menu && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" aria-label="Close menu" onClick={() => setMenu(false)} />
          <div role="menu" className="absolute right-0 z-50 mt-2 w-72 rounded-[12px] border border-line bg-card p-2 shadow-[var(--shadow-pop)]">
            <div className="flex items-center gap-3 px-2.5 pt-2 pb-3">
              <Avatar address={address} size={32} />
              <div className="min-w-0">
                <p className="text-[12px] text-mute">Connected to Mezo Testnet</p>
                <ExplorerLink address={address} className="text-[13px] text-ink">
                  {shortAddr(address, 6)}
                </ExplorerLink>
              </div>
            </div>
            <div className="mx-1 mb-2 space-y-1.5 rounded-[10px] bg-wash p-3 text-[13.5px]">
              <p className="t-num flex items-center justify-between">
                <span className="flex items-center gap-2 text-mute">
                  <TokenDot symbol="BTC" size={16} /> BTC
                </span>
                {fmtAmount(bal?.value ?? 0n)}
              </p>
              <p className="t-num flex items-center justify-between">
                <span className="flex items-center gap-2 text-mute">
                  <TokenDot symbol="MUSD" size={16} /> MUSD
                </span>
                {fmtAmount(user?.musdBalance ?? 0n)}
              </p>
            </div>
            <div className="grid gap-0.5">
              <Link href="/dashboard" className={item} onClick={() => setMenu(false)}>
                <LayoutDashboard size={15} className="text-mute" /> Dashboard
              </Link>
              <button
                className={item}
                onClick={() => {
                  navigator.clipboard?.writeText(address).catch(() => {});
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                <Copy size={15} className="text-mute" /> {copied ? "Copied" : "Copy address"}
              </button>
              <button
                className={item}
                onClick={() =>
                  watchAssetAsync({ type: "ERC20", options: { address: MUSD, symbol: "MUSD", decimals: 18 } })
                    .catch(() => {})
                    .finally(() => setMenu(false))
                }
              >
                <Plus size={15} className="text-mute" /> Add MUSD to wallet
              </button>
              <a href={FAUCET} target="_blank" rel="noreferrer" className={item}>
                <Droplets size={15} className="text-mute" /> Get testnet BTC
              </a>
              <div className="my-1 h-px bg-line" />
              <button
                className={`${item} text-danger`}
                onClick={() => {
                  disconnect();
                  setMenu(false);
                }}
              >
                <LogOut size={15} /> Disconnect
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Inline prompt used inside panels when no wallet is connected. */
export function ConnectPrompt({ label = "Connect wallet", tone = "solid" }: { label?: string; tone?: "solid" | "supply" | "borrow" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={tone} size="lg" className="w-full" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <ConnectDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
