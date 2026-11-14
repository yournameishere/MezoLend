import type { Metadata } from "next";
import { SupplyView } from "@/components/lend/SupplyView";

export const metadata: Metadata = {
  title: "Lend MUSD",
  description: "Lend MUSD to borrowers who post BTC and earn the interest they pay. One transaction with an MUSD permit.",
};

export default function LendPage() {
  return <SupplyView />;
}
