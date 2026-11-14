/** Mark: a vessel half-full of MUSD liquidity over a bed of BTC collateral. */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden>
      <path d="M5 4v15a5 5 0 0 0 5 5h8a5 5 0 0 0 5-5V4" fill="none" stroke="#1F1A15" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M7 13.5c2.2-1.4 4.4-1.4 6.6 0s4.4 1.4 6.6 0V19a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3v-5.5Z" fill="#FF9A3C" />
      <circle cx="11" cy="18.4" r="1.4" fill="#1F1A15" />
      <circle cx="15" cy="19.2" r="1.1" fill="#1F1A15" />
      <circle cx="18" cy="18" r="0.9" fill="#B4520A" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="t-wide text-[17px] font-extrabold tracking-[-0.03em]">
        Mezo<span className="font-medium text-tang-deep">Lend</span>
      </span>
    </span>
  );
}
