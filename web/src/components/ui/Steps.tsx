"use client";

import type { Hash } from "viem";
import type { StepState } from "@/hooks/useTx";
import { ExplorerLink } from "./Primitives";

const copy: Record<StepState, string> = {
  idle: "Waiting",
  skipped: "Not needed",
  signing: "Confirm in wallet",
  pending: "Confirming on Mezo",
  done: "Done",
  error: "Stopped",
};

/** Ordered transaction steps (approve → action). Only rendered once a flow starts. */
export function Steps({
  steps,
  states,
  hashes,
  tone = "supply",
}: {
  steps: { key: string; label: string }[];
  states: Record<string, StepState>;
  hashes: Record<string, Hash>;
  tone?: "supply" | "borrow";
}) {
  if (!Object.keys(states).length) return null;
  const accent = tone === "supply" ? "bg-tang" : "bg-char";
  return (
    <ol className="mt-4 space-y-2 rounded-[12px] border border-line bg-wash p-3" aria-live="polite">
      {steps.map((s, i) => {
        const st = states[s.key] ?? "idle";
        return (
          <li key={s.key} className="flex items-center gap-3 text-[13px]">
            <span
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                st === "done"
                  ? `${accent} text-paper`
                  : st === "error"
                    ? "bg-danger text-paper"
                    : st === "signing" || st === "pending"
                      ? "border border-ink text-ink"
                      : "border border-line text-faint"
              }`}
            >
              {st === "done" ? "✓" : st === "error" ? "!" : i + 1}
            </span>
            <span className={st === "skipped" ? "text-faint line-through" : "text-ink"}>{s.label}</span>
            <span className="ml-auto flex items-center gap-2 text-mute">
              {(st === "signing" || st === "pending") && (
                <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-ink" aria-hidden />
              )}
              {copy[st]}
              {hashes[s.key] && <ExplorerLink hash={hashes[s.key]}>tx</ExplorerLink>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
