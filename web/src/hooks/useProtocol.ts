"use client";

import { useContext } from "react";
import { useConnection, useReadContract } from "wagmi";
import { MarketsSeed } from "@/lib/seed";
import type { Address } from "viem";
import { LENS, mezoLendLensAbi } from "@/config/contracts";
import { useSettings, setSettings } from "@/lib/store";
import { chain } from "@/lib/wagmi";

export function useMarkets() {
  const seed = useContext(MarketsSeed);
  const q = useReadContract({
    address: LENS,
    abi: mezoLendLensAbi,
    functionName: "getMarkets",
    chainId: chain.id,
    query: {
      refetchInterval: 8_000,
      staleTime: 4_000,
      initialData: seed.data,
      initialDataUpdatedAt: seed.at,
    },
  });
  return { ...q, markets: q.data };
}

export type MarketInfo = NonNullable<ReturnType<typeof useMarkets>["markets"]>[number];
export type CollateralInfo = MarketInfo["collaterals"][number];

export function useUserOverview(account?: Address) {
  const conn = useConnection();
  const who = account ?? conn.address;
  const q = useReadContract({
    address: LENS,
    abi: mezoLendLensAbi,
    functionName: "getUserOverview",
    args: who ? [who] : undefined,
    chainId: chain.id,
    query: { enabled: !!who, refetchInterval: 8_000, staleTime: 3_000 },
  });
  return { ...q, user: q.data, account: who };
}

export type UserOverview = NonNullable<ReturnType<typeof useUserOverview>["user"]>;
export type UserMarket = UserOverview["markets"][number];

export function useAccounts(marketId: number) {
  return useReadContract({
    address: LENS,
    abi: mezoLendLensAbi,
    functionName: "getAccounts",
    args: [BigInt(marketId), 0n, 500n],
    chainId: chain.id,
    query: { refetchInterval: 10_000 },
  });
}

/** Currently selected market (persisted). */
export function useSelectedMarket() {
  const { marketId } = useSettings();
  const { markets, isLoading, error, refetch } = useMarkets();
  const market = markets?.[marketId] ?? markets?.[0];
  return {
    marketId: market ? Number(market.id) : marketId,
    market,
    markets,
    isLoading,
    error,
    refetch,
    select: (id: number) => setSettings({ marketId: id }),
  };
}

/** BTC collateral info (first listed asset) for a market. */
export function btcOf(m?: MarketInfo) {
  return m?.collaterals[0];
}
