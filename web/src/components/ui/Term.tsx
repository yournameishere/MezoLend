"use client";

import { useId, useState, type ReactNode } from "react";
import { glossary, type GlossaryKey } from "@/lib/glossary";

/** Inline glossary term: dotted underline, explanation on hover / focus / tap. */
export function Term({ k, children, align = "left" }: { k: GlossaryKey; children?: ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const g = glossary[k];
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        className="cursor-help text-left underline decoration-faint decoration-dotted underline-offset-[5px] hover:decoration-mute"
      >
        {children ?? g.term}
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`absolute top-full z-50 mt-2 w-72 rounded-[10px] border border-line bg-card px-3.5 py-3 text-[13px] leading-relaxed font-normal text-ink shadow-[0_18px_40px_-12px_rgba(120,72,30,.16)] ${align === "right" ? "right-0" : "left-0"}`}
        >
          <span className="mb-1 block font-semibold">{g.term}</span>
          <span className="text-mute">{g.text}</span>
        </span>
      )}
    </span>
  );
}
