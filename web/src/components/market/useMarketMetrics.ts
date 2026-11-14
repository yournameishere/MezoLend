import type { MarketInfo } from "@/hooks/useProtocol";
import { toNum } from "@/lib/format";
import { aprToApy, type RateParams } from "@/lib/math";

export function metrics(m: MarketInfo) {
  const btc = m.collaterals[0];
  const price = btc?.priceOk ? toNum(btc.price) : 0;
  return {
    supplied: toNum(m.totalAssets),
    borrowed: toNum(m.totalBorrows),
    idle: toNum(m.totalCash),
    reserves: toNum(m.totalReserves),
    utilization: toNum(m.utilization),
    borrowApy: aprToApy(m.borrowRatePerYear),
    supplyApy: aprToApy(m.supplyRatePerYear),
    ltv: btc ? toNum(btc.ltv) : 0,
    lt: btc ? toNum(btc.liquidationThreshold) : 0,
    bonus: btc ? toNum(btc.liquidationBonus) : 0,
    btcPrice: price,
    btcPriceOk: !!btc?.priceOk,
    btcUpdatedAt: btc ? Number(btc.priceUpdatedAt) : 0,
    btcSource: btc ? Number(btc.priceSource) : 0,
    collateralBtc: btc ? toNum(btc.totalDeposited) : 0,
    collateralUsd: btc ? toNum(btc.totalDeposited) * price : 0,
    accounts: Number(m.accountCount),
    originationFee: toNum(m.originationFee),
    reserveFactor: toNum(m.reserveFactor),
  };
}

export function rateParams(m: MarketInfo): RateParams {
  return {
    baseRatePerYear: m.baseRatePerYear,
    slope1PerYear: m.slope1PerYear,
    slope2PerYear: m.slope2PerYear,
    kink: m.kink,
    reserveFactor: m.reserveFactor,
  };
}

export const marketColor = (id: number) => (id === 0 ? "#ff9a3c" : "#1f1a15");
