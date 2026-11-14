import { MAX_UINT, WAD, toNum } from "./format";

/** Interest accrues per second and compounds on every interaction — effectively continuous. */
export function aprToApy(aprWad: bigint | number): number {
  const apr = typeof aprWad === "bigint" ? toNum(aprWad) : aprWad;
  return Math.expm1(apr);
}

export const mulDiv = (a: bigint, b: bigint, d: bigint) => (d === 0n ? 0n : (a * b) / d);
export const mulDivUp = (a: bigint, b: bigint, d: bigint) => (d === 0n ? 0n : (a * b + d - 1n) / d);

export type RateParams = {
  baseRatePerYear: bigint;
  slope1PerYear: bigint;
  slope2PerYear: bigint;
  kink: bigint;
  reserveFactor: bigint;
};

/** Mirrors InterestRateModel.getBorrowRateAtUtilization (APR, as a float). */
export function borrowAprAt(u: number, p: RateParams): number {
  const base = toNum(p.baseRatePerYear);
  const s1 = toNum(p.slope1PerYear);
  const s2 = toNum(p.slope2PerYear);
  const k = toNum(p.kink);
  const x = Math.min(Math.max(u, 0), 1);
  if (x <= k) return base + (s1 * x) / k;
  return base + s1 + (s2 * (x - k)) / (1 - k);
}

export function supplyAprAt(u: number, p: RateParams): number {
  return borrowAprAt(u, p) * u * (1 - toNum(p.reserveFactor));
}

export type Position = {
  /** USD value of all collateral (WAD) */
  collateralValue: bigint;
  borrowCapacity: bigint;
  liquidationCapacity: bigint;
  debt: bigint;
};

export type CollateralParams = {
  price: bigint; // USD per whole token, WAD
  decimals: number;
  ltv: bigint;
  liquidationThreshold: bigint;
};

export function healthFactor(liqCap: bigint, debt: bigint): bigint {
  if (debt === 0n) return MAX_UINT;
  return mulDiv(liqCap, WAD, debt);
}

/** Simulate changing collateral (+/-) of one asset and borrowing (+) / repaying (-) MUSD. */
export function simulate(
  pos: Position,
  c: CollateralParams,
  opts: { collateralDelta?: bigint; borrow?: bigint; repay?: bigint; originationFee?: bigint },
) {
  const unit = 10n ** BigInt(c.decimals);
  const delta = opts.collateralDelta ?? 0n;
  const abs = delta < 0n ? -delta : delta;
  const valueDelta = mulDiv(abs, c.price, unit);
  const sign = delta < 0n ? -1n : 1n;
  const collateralValue = pos.collateralValue + sign * valueDelta;
  const borrowCapacity = pos.borrowCapacity + sign * mulDiv(valueDelta, c.ltv, WAD);
  const liquidationCapacity = pos.liquidationCapacity + sign * mulDiv(valueDelta, c.liquidationThreshold, WAD);
  const fee = opts.borrow ? mulDivUp(opts.borrow, opts.originationFee ?? 0n, WAD) : 0n;
  let debt = pos.debt + (opts.borrow ?? 0n) + fee;
  if (opts.repay) debt = debt > opts.repay ? debt - opts.repay : 0n;
  return {
    collateralValue: collateralValue < 0n ? 0n : collateralValue,
    borrowCapacity: borrowCapacity < 0n ? 0n : borrowCapacity,
    liquidationCapacity: liquidationCapacity < 0n ? 0n : liquidationCapacity,
    debt,
    fee,
    healthFactor: healthFactor(liquidationCapacity < 0n ? 0n : liquidationCapacity, debt),
    withinLimit: debt <= (borrowCapacity < 0n ? 0n : borrowCapacity),
  };
}

/** Max MUSD borrowable given capacity, current debt, fee and pool cash. */
export function maxBorrow(borrowCapacity: bigint, debt: bigint, originationFee: bigint, cash: bigint): bigint {
  if (borrowCapacity <= debt) return 0n;
  const room = mulDiv(borrowCapacity - debt, WAD, WAD + originationFee);
  // stay a hair under the limit so rounding can't push the tx over
  const safe = room > 1000n ? room - room / 1_000_000n - 1n : 0n;
  return safe < cash ? safe : cash;
}

/** Liquidation price for a position collateralised by one asset (plus `otherLiqCap` from other assets). */
export function liquidationPrice(debt: bigint, amount: bigint, c: CollateralParams, otherLiqCap = 0n): bigint {
  if (debt === 0n || amount === 0n || debt <= otherLiqCap) return 0n;
  const unit = 10n ** BigInt(c.decimals);
  return mulDiv(mulDiv(debt - otherLiqCap, unit, amount), WAD, c.liquidationThreshold);
}

/** Thermal scale: 1.0 (liquidation) → hot, 2.5+ → cool. Returns 0 (cool) .. 1 (hot). */
export function heat(hf: bigint | number): number {
  const n = typeof hf === "bigint" ? (hf >= MAX_UINT / 2n ? 99 : toNum(hf)) : hf;
  if (!Number.isFinite(n) || n >= 2.5) return 0;
  if (n <= 1) return 1;
  return 1 - (n - 1) / 1.5;
}

export type RiskBand = "none" | "safe" | "watch" | "hot" | "liquidatable";

export function riskBand(hf: bigint | undefined, debt: bigint | undefined): RiskBand {
  if (!debt || debt === 0n || hf === undefined) return "none";
  const n = toNum(hf);
  if (n < 1) return "liquidatable";
  if (n < 1.2) return "hot";
  if (n < 1.6) return "watch";
  return "safe";
}

export const riskCopy: Record<RiskBand, { label: string; tone: string }> = {
  none: { label: "No loan", tone: "text-mute" },
  safe: { label: "Comfortable", tone: "text-safe" },
  watch: { label: "Keep an eye on it", tone: "text-warn" },
  hot: { label: "Close to liquidation", tone: "text-danger" },
  liquidatable: { label: "Can be liquidated now", tone: "text-danger" },
};

/** Interpolated health colour for a heat value 0..1 (green → amber → orange → red). */
export function heatColor(h: number): string {
  const stops: [number, [number, number, number]][] = [
    [0, [35, 136, 91]],
    [0.45, [150, 160, 40]],
    [0.7, [214, 118, 10]],
    [1, [215, 56, 63]],
  ];
  const x = Math.min(Math.max(h, 0), 1);
  for (let i = 1; i < stops.length; i++) {
    const [p1, c1] = stops[i];
    const [p0, c0] = stops[i - 1];
    if (x <= p1) {
      const t = (x - p0) / (p1 - p0);
      const c = c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
      return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    }
  }
  return "rgb(215, 56, 63)";
}
