import { formatUnits } from "viem";

export const WAD = 10n ** 18n;
export const MAX_UINT = 2n ** 256n - 1n;

/** bigint (18 decimals by default) → JS number. Precision is fine for display. */
export function toNum(x: bigint | undefined | null, decimals = 18): number {
  if (x === undefined || x === null) return 0;
  return Number(formatUnits(x, decimals));
}

const nf = (min: number, max: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: min, maximumFractionDigits: max });

export function fmtNum(n: number, max = 2, min = 0): string {
  if (!Number.isFinite(n)) return "∞";
  return nf(min, max).format(n);
}

/** Token amount with adaptive precision: big numbers get fewer decimals, dust gets more. */
export function fmtAmount(x: bigint | undefined, decimals = 18, opts?: { max?: number; min?: number }): string {
  const n = toNum(x ?? 0n, decimals);
  if (n === 0) return "0";
  const abs = Math.abs(n);
  let max = opts?.max;
  if (max === undefined) max = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.0001 ? 6 : 8;
  if (abs > 0 && abs < 10 ** -max) return `<${(10 ** -max).toFixed(max)}`;
  return fmtNum(n, max, opts?.min ?? 0);
}

export function fmtUsd(n: number, compact = false): string {
  if (!Number.isFinite(n)) return "—";
  if (compact && Math.abs(n) >= 10_000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(n);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(n) < 1 && n !== 0 ? 4 : 2,
  }).format(n);
}

/** WAD fraction (1e18 = 100%) → "12.34%" */
export function fmtPct(x: bigint | number | undefined, digits = 2): string {
  if (x === undefined) return "—";
  const n = typeof x === "bigint" ? toNum(x) : x;
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmtHF(hf: bigint | undefined): string {
  if (hf === undefined) return "—";
  if (hf >= MAX_UINT / 2n) return "∞";
  const n = toNum(hf);
  if (n > 100) return ">100";
  return n.toFixed(2);
}

export function shortAddr(a?: string, n = 4): string {
  if (!a) return "";
  return `${a.slice(0, 2 + n)}…${a.slice(-n)}`;
}

export function timeAgo(tsSeconds: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - tsSeconds));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function fmtDate(tsSeconds: number): string {
  return new Date(tsSeconds * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Parse a user-typed decimal string into bigint units. Returns undefined for invalid input. */
export function parseAmount(s: string, decimals = 18): bigint | undefined {
  const t = s.trim().replace(/,/g, "");
  if (!t || !/^\d*\.?\d*$/.test(t) || t === ".") return undefined;
  const [i, f = ""] = t.split(".");
  if (f.length > decimals) return undefined;
  return BigInt(i || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}

/** bigint → plain decimal string suitable for an input field. */
export function toInput(x: bigint, decimals = 18, maxFrac = 8): string {
  const s = formatUnits(x, decimals);
  if (!s.includes(".")) return s;
  const [i, f] = s.split(".");
  const trimmed = f.slice(0, maxFrac).replace(/0+$/, "");
  return trimmed ? `${i}.${trimmed}` : i;
}
