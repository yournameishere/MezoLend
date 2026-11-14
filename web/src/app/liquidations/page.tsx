import type { Metadata } from "next";
import { LiquidationsView } from "@/components/liquidate/LiquidationsView";

export const metadata: Metadata = { title: "Liquidations" };

export default function LiquidationsPage() {
  return <LiquidationsView />;
}
