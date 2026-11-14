"use client";

import type { Hash } from "viem";
import { Check, X } from "lucide-react";
import type { StepState } from "@/hooks/useTx";
import { ExplorerLink } from "./Primitives";

const copy: Record<StepState, string> = {
  idle: "Waiting",
  skipped: "Not needed",
  permit: "Sign the permit in your wallet",
  signing: "Confirm in your wallet",
  pending: "Confirming on Mezo",
  done: "Confirmed",
  error: "Stopped",
};

/** Live progress of a transaction flow, with an explorer link for every transaction sent. */
export function Steps({
  steps,
  states,
  hashes,
}: {
  steps: { key: string; label: string }[];
  states: Record<string, StepState>;
  hashes: Record<string, Hash>;
  tone?: "supply" | "borrow";
}) {
  if (!Object.keys(states).length) return null;
  return (
    <ol className="mt-4 divide-y divide-line border-y border-line" aria-live="polite">
      {steps.map((s) => {
        const st = states[s.key] ?? "idle";
        const live = st === "signing" || st === "pending" || st === "permit";
        return (
          <li key={s.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-[13.5px]">
            <span
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                st === "done"
                  ? "bg-safe text-paper"
                  : st === "error"
                    ? "bg-danger text-paper"
                    : live
                      ? "border-2 border-tang border-r-transparent motion-safe:animate-spin"
                      : "border border-line-2"
              }`}
              aria-hidden
            >
              {st === "done" ? <Check size={12} strokeWidth={3} /> : st === "error" ? <X size={12} strokeWidth={3} /> : null}
            </span>
            <span className={`min-w-0 font-medium ${st === "skipped" ? "text-faint line-through" : "text-ink"}`}>{s.label}</span>
            <span className={`ml-auto flex items-center gap-2 ${st === "error" ? "text-danger" : "text-mute"}`}>
              {copy[st]}
              {hashes[s.key] && <ExplorerLink hash={hashes[s.key]}>View transaction</ExplorerLink>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
