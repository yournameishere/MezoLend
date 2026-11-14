import type { Metadata } from "next";
import { SwapView } from "@/components/swap/SwapView";

export const metadata: Metadata = {
  title: "Get MUSD",
  description: "Swap BTC or MEZO for MUSD on Mezo Pools, and lend it or repay a loan in the same transaction.",
};

export default function SwapPage() {
  return <SwapView />;
}
