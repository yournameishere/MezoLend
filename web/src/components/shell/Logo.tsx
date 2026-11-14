/** Mark: the loan meter in miniature. Bitcoin-orange tile, a bar of collateral value, debt filled in, one limit mark. */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden>
      <rect width="28" height="28" rx="7" fill="#F7931A" />
      <rect x="5" y="11.5" width="18" height="5" rx="1.2" fill="#FFF0E0" />
      <rect x="5" y="11.5" width="10" height="5" rx="1.2" fill="#2A1C10" />
      <rect x="18.2" y="8" width="1.8" height="12" rx="0.9" fill="#2A1C10" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <LogoMark />
      <span className="text-[18px] font-extrabold tracking-[-0.035em] text-ink">MezoLend</span>
    </span>
  );
}
