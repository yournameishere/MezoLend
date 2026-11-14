"use client";

import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "supply" | "borrow" | "danger" | "quiet" | "outline" | "solid";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  supply: "bg-tang text-ink hover:bg-tang-hover active:bg-[#e8850f]",
  borrow: "bg-ink text-paper hover:bg-[#3d2a1a] active:bg-black",
  solid: "bg-ink text-paper hover:bg-[#3d2a1a] active:bg-black",
  danger: "bg-danger text-paper hover:bg-[#a82e25]",
  quiet: "bg-transparent text-mute hover:text-ink hover:bg-wash",
  outline: "bg-paper text-ink border border-line-2 hover:border-ink",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-10 px-4 text-[14px] gap-2",
  lg: "h-12 px-6 text-[15px] gap-2",
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

/** A link styled as a button (keeps valid HTML: no <button> inside <a>). */
export function ButtonLink({
  href,
  variant = "outline",
  size = "md",
  className = "",
  children,
  external,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: React.ReactNode;
  external?: boolean;
}) {
  const cls = `inline-flex shrink-0 items-center justify-center rounded-[var(--radius-ctl)] font-semibold whitespace-nowrap transition-colors duration-150 ${variants[variant]} ${sizes[size]} ${className}`;
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}
