"use client";

import { useId } from "react";
import { fmtAmount, fmtUsd, parseAmount, toInput, toNum } from "@/lib/format";

type Props = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  symbol: "MUSD" | "BTC";
  decimals?: number;
  /** Max the user can enter (for the Max button + over-limit hint). */
  max?: bigint;
  maxLabel?: string;
  /** USD per whole token (float), for the value hint. */
  usdPrice?: number;
  tone?: "supply" | "borrow";
  error?: string;
  disabled?: boolean;
};

export function AmountInput({
  label,
  value,
  onChange,
  symbol,
  decimals = 18,
  max,
  maxLabel = "Available",
  usdPrice,
  tone = "supply",
  error,
  disabled,
}: Props) {
  const id = useId();
  const parsed = parseAmount(value, decimals);
  const over = parsed !== undefined && max !== undefined && parsed > max;
  const usd = parsed !== undefined && usdPrice ? toNum(parsed, decimals) * usdPrice : undefined;
  const ring = tone === "supply" ? "focus-within:border-tang" : "focus-within:border-char/70";

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3 text-[13px]">
        <label htmlFor={id} className="text-mute">
          {label}
        </label>
        {max !== undefined && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(toInput(max, decimals, decimals === 18 ? 8 : decimals))}
            className="t-num text-faint transition-colors hover:text-ink disabled:pointer-events-none"
          >
            {maxLabel} {fmtAmount(max, decimals)} <span className="text-mute underline underline-offset-2">Max</span>
          </button>
        )}
      </div>
      <div
        className={`flex items-center gap-3 rounded-[12px] border bg-wash px-4 py-3 transition-colors focus-within:bg-paper focus-within:shadow-[0_0_0_3px_rgba(255,154,60,.16)] ${over || error ? "border-danger/60" : "border-line"} ${ring}`}
      >
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder="0"
          disabled={disabled}
          value={value}
          onChange={(e) => {
            const v = e.target.value.replace(",", ".");
            if (v === "" || /^\d*\.?\d*$/.test(v)) onChange(v);
          }}
          className="t-num min-w-0 flex-1 bg-transparent text-[28px] font-semibold tracking-[-0.02em] text-ink outline-none placeholder:text-faint disabled:opacity-50"
          aria-invalid={over || !!error}
        />
        <span className="flex shrink-0 items-center gap-2 text-sm font-semibold text-ink">
          <TokenDot symbol={symbol} />
          {symbol}
        </span>
      </div>
      <div className="mt-1.5 flex min-h-5 justify-between text-[12.5px]">
        <span className={over || error ? "text-danger" : "text-faint"}>
          {error ?? (over ? `That's more than the ${maxLabel.toLowerCase()} amount.` : usd !== undefined ? `≈ ${fmtUsd(usd)}` : "")}
        </span>
      </div>
    </div>
  );
}

export function TokenDot({ symbol, size = 18 }: { symbol: "MUSD" | "BTC" | string; size?: number }) {
  if (symbol === "BTC") {
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
        <circle cx="10" cy="10" r="10" fill="#FF9A3C" />
        <path
          d="M7.2 5.6h3.6c1.5 0 2.5.8 2.5 2 0 .8-.4 1.4-1.1 1.7.9.3 1.5 1 1.5 2 0 1.4-1.1 2.3-2.8 2.3H7.2V5.6Zm1.7 1.5v1.9h1.7c.6 0 1-.4 1-.95s-.4-.95-1-.95H8.9Zm0 3.3v2.1h2c.7 0 1.1-.4 1.1-1.05 0-.65-.4-1.05-1.1-1.05h-2ZM9.3 4.5h1.1v1.4H9.3zM9.3 13.8h1.1v1.5H9.3z"
          fill="#FFFFFF"
        />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
      <circle cx="10" cy="10" r="10" fill="#1F1A15" />
      <path d="M5.5 13.8V6.2h1.7l2.8 4 2.8-4h1.7v7.6h-1.7V9.1L10 12.6 7.2 9.1v4.7H5.5Z" fill="#FFFFFF" />
    </svg>
  );
}
