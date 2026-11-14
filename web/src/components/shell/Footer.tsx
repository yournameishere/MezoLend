import Link from "next/link";
import { Wordmark } from "./Logo";
import { EXPLORER, FAUCET, REGISTRY } from "@/config/contracts";

export function Footer() {
  return (
    <footer className="mt-16 border-t-[3px] border-ink bg-paper">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div>
          <Wordmark />
          <p className="mt-4 max-w-sm text-[14px] leading-relaxed text-mute">
            A lending market for MUSD on Mezo. Lenders earn what borrowers pay, borrowers keep their bitcoin, and every balance, rate
            and liquidation is handled by verified smart contracts.
          </p>
          <p className="mt-4 max-w-sm text-[12.5px] leading-relaxed text-faint">
            Running on Mezo Testnet, where assets have no value. The contracts are tested and internally reviewed, not externally
            audited. Lending and borrowing carry smart-contract, liquidity and liquidation risk.
          </p>
        </div>
        <FooterCol
          title="App"
          links={[
            { href: "/dashboard", label: "Dashboard" },
            { href: "/lend", label: "Lend MUSD" },
            { href: "/borrow", label: "Borrow MUSD" },
            { href: "/swap", label: "Get MUSD" },
            { href: "/liquidations", label: "Liquidate loans" },
          ]}
        />
        <FooterCol
          title="Learn"
          links={[
            { href: "/docs", label: "Documentation" },
            { href: "/markets", label: "Markets and parameters" },
            { href: "/analytics", label: "Analytics" },
            { href: "/docs#risks", label: "Risks" },
            { href: "/docs#security", label: "Security review" },
          ]}
        />
        <FooterCol
          title="Verify"
          links={[
            { href: `${EXPLORER}/address/${REGISTRY}`, label: "Market registry", external: true },
            { href: "/docs#contracts", label: "All contracts" },
            { href: FAUCET, label: "Testnet faucet", external: true },
            { href: "https://github.com/yournameishere/MezoLend", label: "Source code", external: true },
            { href: "https://mezo.org/docs/developers/musd/", label: "MUSD docs", external: true },
          ]}
        />
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-wrap justify-between gap-3 px-4 py-5 text-[13px] text-mute sm:px-6">
          <span>MezoLend on Mezo Testnet (chain 31611)</span>
          <span>Built on MUSD, Mezo&apos;s bitcoin-backed dollar</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { href: string; label: string; external?: boolean }[] }) {
  return (
    <div>
      <p className="text-[13px] font-semibold text-ink">{title}</p>
      <ul className="mt-3 space-y-2.5 text-[14px]">
        {links.map((l) => (
          <li key={l.label}>
            {l.external ? (
              <a href={l.href} target="_blank" rel="noreferrer" className="text-mute transition-colors hover:text-ink">
                {l.label}
              </a>
            ) : (
              <Link href={l.href} className="text-mute transition-colors hover:text-ink">
                {l.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
