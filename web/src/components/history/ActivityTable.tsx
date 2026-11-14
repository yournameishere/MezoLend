"use client";

import { useState } from "react";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Gavel, Lock, Unlock } from "lucide-react";
import type { Activity } from "@/lib/history";
import { ExplorerLink, Segmented, Skeleton } from "@/components/ui/Primitives";
import { EmptyState, Table, Td, Th } from "@/components/ui/Card";
import { fmtAmount, fmtDate, timeAgo } from "@/lib/format";

const kindCopy: Record<Activity["kind"], { label: string; group: "lend" | "borrow" | "collateral" | "liquidation"; icon: typeof ArrowUpRight; tone: string }> = {
  supply: { label: "Supplied", group: "lend", icon: ArrowUpRight, tone: "bg-tang-soft text-tang-deep" },
  withdraw: { label: "Withdrew", group: "lend", icon: ArrowDownLeft, tone: "bg-tang-soft text-tang-deep" },
  "shares-out": { label: "Sent pool shares", group: "lend", icon: ArrowUpRight, tone: "bg-wash text-mute" },
  borrow: { label: "Borrowed", group: "borrow", icon: ArrowDownLeft, tone: "bg-[#f3ebe3] text-ink" },
  repay: { label: "Repaid", group: "borrow", icon: ArrowUpRight, tone: "bg-[#f3ebe3] text-ink" },
  "collateral-in": { label: "Deposited collateral", group: "collateral", icon: Lock, tone: "bg-wash text-mute" },
  "collateral-out": { label: "Withdrew collateral", group: "collateral", icon: Unlock, tone: "bg-wash text-mute" },
  liquidated: { label: "Loan liquidated", group: "liquidation", icon: Gavel, tone: "bg-danger-soft text-danger" },
  liquidator: { label: "Liquidated a loan", group: "liquidation", icon: Gavel, tone: "bg-safe-soft text-safe" },
  swap: { label: "Swapped for MUSD", group: "lend", icon: ArrowLeftRight, tone: "bg-tang-soft text-tang-deep" },
};

type Filter = "all" | "lend" | "borrow" | "collateral" | "liquidation";

export function ActivityTable({ items, loading, error }: { items?: Activity[]; loading?: boolean; error?: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");
  const list = (items ?? []).filter((a) => filter === "all" || kindCopy[a.kind].group === filter);

  return (
    <div>
      <div className="px-5 pb-4">
        <Segmented
          size="sm"
          label="Filter activity"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "lend", label: "Lending" },
            { value: "borrow", label: "Borrowing" },
            { value: "collateral", label: "Collateral" },
            { value: "liquidation", label: "Liquidations" },
          ]}
        />
      </div>
      <Table minWidth={640}>
        <thead>
          <tr>
            <Th>Action</Th>
            <Th>Market</Th>
            <Th align="right">Amount</Th>
            <Th>When</Th>
            <Th align="right">Transaction</Th>
          </tr>
        </thead>
        <tbody>
          {loading &&
            [0, 1, 2].map((i) => (
              <tr key={i}>
                <td colSpan={5} className="border-b border-line px-5 py-3.5">
                  <Skeleton className="h-5 w-full" />
                </td>
              </tr>
            ))}
          {!loading && error && (
            <tr>
              <td colSpan={5}>
                <EmptyState title="History is temporarily unavailable">The explorer API didn&apos;t respond. Your history is safe on-chain and will reload shortly.</EmptyState>
              </td>
            </tr>
          )}
          {!loading && !error && list.length === 0 && (
            <tr>
              <td colSpan={5}>
                <EmptyState title={filter === "all" ? "No activity yet" : "Nothing in this category yet"}>
                  {filter === "all" ? "Supply or borrow to get started. Every action will appear here with a link to the explorer." : undefined}
                </EmptyState>
              </td>
            </tr>
          )}
          {list.map((a) => {
            const c = kindCopy[a.kind];
            const Icon = c.icon;
            const seized = a.extra?.startsWith("seized:") ? BigInt(a.extra.slice(7)) : undefined;
            const fee = a.extra?.startsWith("fee:") ? BigInt(a.extra.slice(4)) : undefined;
            return (
              <tr key={a.id} className="transition-colors hover:bg-[#fffaf5]">
                <Td>
                  <span className="flex items-center gap-3">
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${c.tone}`}>
                      <Icon size={15} aria-hidden />
                    </span>
                    <span>
                      <span className="block font-medium">{c.label}</span>
                      {seized !== undefined && (
                        <span className="block text-[12px] text-mute">
                          {a.kind === "liquidated" ? "Lost" : "Received"} {fmtAmount(seized)} BTC
                        </span>
                      )}
                      {a.extra?.startsWith("musd:") && (
                        <span className="block text-[12px] text-mute">Got {fmtAmount(BigInt(a.extra.slice(5)), 18, { max: 2 })} MUSD on Mezo Pools</span>
                      )}
                      {fee !== undefined && <span className="block text-[12px] text-mute">incl. {fmtAmount(fee, 18, { max: 4 })} MUSD fee</span>}
                    </span>
                  </span>
                </Td>
                <Td className="text-mute">{a.marketName}</Td>
                <Td align="right">
                  <span className="t-num font-medium">
                    {fmtAmount(a.amount, 18, { max: a.asset === "BTC" ? 8 : 4 })} {a.asset}
                  </span>
                </Td>
                <Td className="text-mute">
                  <span title={fmtDate(a.ts)}>{timeAgo(a.ts)}</span>
                </Td>
                <Td align="right">
                  <ExplorerLink hash={a.hash} />
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
