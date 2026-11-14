"use client";

import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { wagmiConfig } from "@/lib/wagmi";
import { useAlerts } from "@/hooks/useAlerts";
import { Toasts } from "@/components/ui/Toasts";
import type { MarketsSnapshot } from "@/lib/server-data";
import { MarketsSeed } from "@/lib/seed";


function AlertWatcher() {
  useAlerts();
  return null;
}

export function Providers({ children, seed, seedAt }: { children: ReactNode; seed?: MarketsSnapshot; seedAt?: number }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 2, refetchOnWindowFocus: true, structuralSharing: true },
        },
      }),
  );
  return (
    <MarketsSeed.Provider value={{ data: seed, at: seedAt ?? 0 }}>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={qc}>
          <MotionConfig reducedMotion="user">
            <AlertWatcher />
            {children}
            <Toasts />
          </MotionConfig>
        </QueryClientProvider>
      </WagmiProvider>
    </MarketsSeed.Provider>
  );
}
