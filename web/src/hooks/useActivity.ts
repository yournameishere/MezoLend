"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { loadActivity, loadLiquidations, loadSnapshots } from "@/lib/history";
import { useMarkets } from "./useProtocol";

function refs(markets: ReturnType<typeof useMarkets>["markets"]) {
  return (markets ?? []).map((m) => ({
    id: Number(m.id),
    name: m.name,
    pool: m.pool,
    collateralManager: m.collateralManager,
    liquidationManager: m.liquidationManager,
  }));
}

export function useActivity(user?: Address) {
  const { markets } = useMarkets();
  return useQuery({
    queryKey: ["activity", user, markets?.length],
    queryFn: () => loadActivity(user!, refs(markets)),
    enabled: !!user && !!markets?.length,
    refetchInterval: 15_000,
  });
}

export function useSnapshots(pool?: Address) {
  return useQuery({
    queryKey: ["snapshots", pool],
    queryFn: () => loadSnapshots(pool!),
    enabled: !!pool,
    refetchInterval: 30_000,
  });
}

export function useLiquidationFeed() {
  const { markets } = useMarkets();
  return useQuery({
    queryKey: ["liquidations", markets?.length],
    queryFn: () => loadLiquidations(refs(markets)),
    enabled: !!markets?.length,
    refetchInterval: 20_000,
  });
}
