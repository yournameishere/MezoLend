import type { Metadata } from "next";
import { Suspense } from "react";
import { BorrowView } from "@/components/borrow/BorrowView";

export const metadata: Metadata = {
  title: "Borrow MUSD",
  description: "Post BTC as collateral and borrow MUSD without selling it. Repay and close with one MUSD permit transaction.",
};

export default function BorrowPage() {
  return (
    <Suspense>
      <BorrowView />
    </Suspense>
  );
}
