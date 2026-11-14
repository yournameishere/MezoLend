"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Native <dialog> modal: focus trap, Esc to close, backdrop click to close. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  width = "max-w-md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={`m-auto w-[calc(100%-32px)] ${width} rounded-[var(--radius-panel)] border border-line bg-card p-0 text-ink shadow-[var(--shadow-pop)] backdrop:bg-ink/30 backdrop:backdrop-blur-[3px] open:animate-rise`}
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid h-8 w-8 place-items-center rounded-md text-mute hover:bg-line hover:text-ink"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
      </div>
      <div className="px-5 py-5">{children}</div>
    </dialog>
  );
}
