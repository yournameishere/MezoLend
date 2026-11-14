"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "supply" | "borrow" | "danger" | "quiet" | "outline" | "solid";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  supply: "bg-tang text-ink hover:bg-[#ffa957] active:bg-[#f58f30] shadow-[inset_0_-1px_0_rgba(184,83,10,.28)]",
  borrow: "bg-ink text-paper hover:bg-[#2e2620] active:bg-black",
  solid: "bg-ink text-paper hover:bg-[#2e2620] active:bg-black",
  danger: "bg-danger text-paper hover:bg-[#bd2f36]",
  quiet: "bg-transparent text-mute hover:text-ink hover:bg-wash",
  outline: "bg-paper text-ink border border-line-2 hover:bg-wash hover:border-[#cfc4b8]",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-10 px-4 text-[14px] gap-2",
  lg: "h-11 px-5 text-[14.5px] gap-2",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "outline", size = "md", loading, className = "", children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`relative inline-flex shrink-0 items-center justify-center rounded-[var(--radius-ctl)] font-semibold whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]} ${sizes[size]} ${className}`}
      {...rest}
    >
      {loading && <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />}
      {children}
    </button>
  );
});
