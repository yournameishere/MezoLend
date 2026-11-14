import type { Metadata } from "next";
import { SupplyView } from "@/components/lend/SupplyView";

export const metadata: Metadata = { title: "Supply MUSD" };

export default function SupplyPage() {
  return <SupplyView />;
}
