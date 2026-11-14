import type { Metadata } from "next";
import { BorrowView } from "@/components/borrow/BorrowView";

export const metadata: Metadata = { title: "Borrow MUSD" };

export default function BorrowPage() {
  return <BorrowView />;
}
