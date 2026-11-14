"use client";

import { AnimatePresence, motion } from "motion/react";
import { dismissToast, useToasts } from "@/lib/store";
import { ExplorerLink } from "./Primitives";

const bar = { success: "bg-tang", error: "bg-danger", warning: "bg-warn", info: "bg-mute" } as const;

export function Toasts() {
  const items = useToasts();
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[70] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2" aria-live="polite">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            className="pointer-events-auto relative overflow-hidden rounded-[12px] border border-line bg-card/95 py-3 pr-9 pl-4 shadow-[0_20px_40px_-14px_rgba(120,72,30,.16)] backdrop-blur"
          >
            <span className={`absolute inset-y-0 left-0 w-[3px] ${bar[t.tone]}`} aria-hidden />
            <p className="text-[13.5px] font-semibold">{t.title}</p>
            {t.body && <p className="mt-0.5 text-[13px] leading-snug text-mute">{t.body}</p>}
            {t.hash && (
              <p className="mt-1">
                <ExplorerLink hash={t.hash}>View on explorer</ExplorerLink>
              </p>
            )}
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss"
              className="absolute top-2.5 right-2.5 grid h-6 w-6 place-items-center rounded text-faint hover:text-ink"
            >
              <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden>
                <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
