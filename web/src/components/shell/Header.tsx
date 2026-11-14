"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useBlockNumber } from "wagmi";
import { Menu, X } from "lucide-react";
import { Wordmark } from "./Logo";
import { WalletButton, useMounted } from "./Wallet";
import { NoticeBell } from "./Notices";
import { chain } from "@/lib/wagmi";

const nav = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/lend", label: "Lend" },
  { href: "/borrow", label: "Borrow" },
  { href: "/swap", label: "Get MUSD" },
  { href: "/markets", label: "Markets" },
  { href: "/liquidations", label: "Liquidate" },
  { href: "/docs", label: "Docs" },
];

function NetworkPill() {
  const mounted = useMounted();
  const { data } = useBlockNumber({ chainId: chain.id, watch: true });
  return (
    <span
      className="hidden h-8 items-center gap-2 rounded-full border border-line bg-paper px-3 text-[12.5px] whitespace-nowrap text-mute xl:inline-flex"
      title="Latest Mezo Testnet block"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-safe opacity-40" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-safe" />
      </span>
      Mezo Testnet
      {mounted && data ? <span className="t-num text-faint">#{data.toLocaleString("en-US")}</span> : null}
    </span>
  );
}

export function Header() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => path === href || path.startsWith(`${href}/`);
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-paper">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-3 px-4 sm:gap-5 sm:px-6">
        <Link href="/" className="shrink-0" aria-label="MezoLend home">
          <Wordmark />
        </Link>
        <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Main">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={isActive(n.href) ? "page" : undefined}
              className={`relative px-3 py-2 text-[14px] font-semibold transition-colors ${isActive(n.href) ? "text-ink after:absolute after:inset-x-3 after:-bottom-[13px] after:h-[3px] after:rounded-t-sm after:bg-tang" : "text-mute hover:text-ink"}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
          <NetworkPill />
          <NoticeBell />
          <WalletButton />
          <button
            type="button"
            className="grid h-10 w-10 place-items-center rounded-[var(--radius-ctl)] border border-line text-mute lg:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>
      {open && (
        <nav className="border-t border-line bg-paper px-4 py-3 lg:hidden" aria-label="Mobile">
          <ul className="grid grid-cols-2 gap-1">
            {nav.map((n) => (
              <li key={n.href}>
                <Link
                  href={n.href}
                  onClick={() => setOpen(false)}
                  className={`block rounded-[var(--radius-ctl)] px-3 py-2.5 text-[15px] font-semibold ${isActive(n.href) ? "bg-tang-soft text-ink" : "text-mute"}`}
                >
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
