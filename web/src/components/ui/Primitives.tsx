"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { animate, useReducedMotion } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import { EXPLORER } from "@/config/contracts";
import { shortAddr } from "@/lib/format";
import { Badge } from "./Card";

/** Tweened number: eases toward new on-chain values instead of snapping. */
export function Num({ value, format, className = "" }: { value: number; format: (n: number) => string; className?: string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    if (reduce || !Number.isFinite(value) || !Number.isFinite(prev.current)) {
      prev.current = value;
      const id = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(id);
    }
    const controls = animate(prev.current, value, {
      duration: 0.8,
      ease: [0.2, 0.7, 0.1, 1],
      onUpdate: (v) => setShown(v),
    });
    prev.current = value;
    return () => controls.stop();
  }, [value, reduce]);
  return <span className={`t-num ${className}`}>{format(shown)}</span>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`inline-block animate-pulse rounded-md bg-tang-soft ${className}`} aria-hidden />;
}

export function ExplorerLink({
  hash,
  address,
  children,
  className = "",
}: {
  hash?: string;
  address?: string;
  children?: ReactNode;
  className?: string;
}) {
  const href = hash ? `${EXPLORER}/tx/${hash}` : `${EXPLORER}/address/${address}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`group inline-flex items-center gap-0.5 text-[12.5px] font-medium text-tang-deep underline decoration-tang-line underline-offset-2 transition-colors hover:decoration-tang-deep ${className}`}
    >
      {children ?? shortAddr(hash ?? address, hash ? 6 : 4)}
      <ArrowUpRight size={12} strokeWidth={2} className="opacity-50 transition-opacity group-hover:opacity-100" aria-hidden />
    </a>
  );
}

/** Segmented control (small toggles) — pill track with a white active chip. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  tone = "neutral",
  size = "md",
  label,
}: {
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  tone?: "neutral" | "supply" | "borrow";
  size?: "sm" | "md";
  label?: string;
}) {
  const active =
    tone === "supply"
      ? "bg-paper text-ink shadow-[0_1px_2px_rgba(23,19,15,.12)] ring-1 ring-tang-line"
      : tone === "borrow"
        ? "bg-ink text-paper"
        : "bg-paper text-ink shadow-[0_1px_2px_rgba(23,19,15,.12)]";
  return (
    <div role="tablist" aria-label={label} className="inline-flex rounded-[10px] bg-[#f3efea] p-[3px]">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="tab"
          type="button"
          aria-selected={o.value === value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={`rounded-[7px] font-semibold transition-all disabled:opacity-40 ${size === "sm" ? "px-2.5 py-1 text-[12.5px]" : "px-3.5 py-1.5 text-[13.5px]"} ${o.value === value ? active : "text-mute hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Label/value pair used inside panels. */
export function Row({ label, children, tone }: { label: ReactNode; children: ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-[7px] text-[13.5px]">
      <span className="text-mute">{label}</span>
      <span className={`t-num text-right font-medium ${tone ?? "text-ink"}`}>{children}</span>
    </div>
  );
}

export function Delta({ from, to }: { from: ReactNode; to?: ReactNode }) {
  if (to === undefined || from === to) return <>{from}</>;
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-faint">{from}</span>
      <svg width="10" height="8" viewBox="0 0 10 8" aria-hidden className="text-faint">
        <path d="M0 4h8M5 1l3 3-3 3" stroke="currentColor" fill="none" strokeWidth="1.3" />
      </svg>
      <span>{to}</span>
    </span>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "supply" | "borrow" | "danger" }) {
  const map = { neutral: "neutral", supply: "orange", borrow: "ink", danger: "danger" } as const;
  return <Badge tone={map[tone]}>{children}</Badge>;
}

/** Relative time that only renders in the browser (server and client clocks differ), refreshing every 10s. */
export function TimeAgo({ ts, prefix = "" }: { ts: number; prefix?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = requestAnimationFrame(tick);
    const id = setInterval(tick, 10_000);
    return () => {
      cancelAnimationFrame(first);
      clearInterval(id);
    };
  }, []);
  if (now === null || !ts) return null;
  const s = Math.max(0, Math.floor(now / 1000 - ts));
  const text = s < 10 ? "just now" : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
  return (
    <span suppressHydrationWarning>
      {prefix}
      {text}
    </span>
  );
}
