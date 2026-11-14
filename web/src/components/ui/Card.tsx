import type { ReactNode } from "react";

/** The single surface used across the app: white, hairline border, faint shadow. */
export function Card({
  children,
  className = "",
  as: Tag = "section",
  accent,
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article" | "aside";
  accent?: "supply" | "borrow";
}) {
  const bar = accent === "supply" ? "before:bg-tang" : accent === "borrow" ? "before:bg-ink" : "before:hidden";
  return (
    <Tag
      className={`relative overflow-hidden rounded-[var(--radius-panel)] border border-line bg-card shadow-[var(--shadow-card)] before:absolute before:inset-x-0 before:top-0 before:h-[3px] ${bar} ${className}`}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className = "",
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-5 ${className}`}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-mute">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`px-5 pt-4 pb-5 ${className}`}>{children}</div>;
}

/** A row of metrics separated by hairlines; collapses to a 2-column grid on small screens. */
export function StatGrid({ children, cols = 4, className = "" }: { children: ReactNode; cols?: 2 | 3 | 4 | 5 | 6; className?: string }) {
  const c = { 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5", 6: "lg:grid-cols-6" }[cols];
  return (
    <div className={`grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-panel)] border border-line bg-line ${c} ${className}`}>
      {children}
    </div>
  );
}

export function StatCell({ label, children, sub, className = "" }: { label: ReactNode; children: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={`bg-card px-5 py-4 ${className}`}>
      <div className="text-[12.5px] text-mute">{label}</div>
      <div className="t-num mt-1.5 text-[22px] font-semibold tracking-[-0.02em]">{children}</div>
      {sub && <div className="t-num mt-0.5 text-[12.5px] text-faint">{sub}</div>}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "orange" | "safe" | "warn" | "danger" | "ink" }) {
  const t = {
    neutral: "bg-wash text-mute border-line",
    orange: "bg-tang-soft text-tang-deep border-tang-line",
    safe: "bg-safe-soft text-safe border-[#cfe9db]",
    warn: "bg-warn-soft text-warn border-[#f6dfb3]",
    danger: "bg-danger-soft text-danger border-[#f6cfd1]",
    ink: "bg-ink text-paper border-ink",
  }[tone];
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12px] font-medium whitespace-nowrap ${t}`}>{children}</span>;
}

/** Table shell: header row on a wash background, hairline rows. */
export function Table({ children, minWidth = 640 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[14px]" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, align = "left", className = "" }: { children?: ReactNode; align?: "left" | "right"; className?: string }) {
  return (
    <th className={`border-y border-line bg-wash px-5 py-2.5 text-[12.5px] font-medium text-mute first:border-l-0 ${align === "right" ? "text-right" : ""} ${className}`}>
      {children}
    </th>
  );
}

export function Td({ children, align = "left", className = "" }: { children?: ReactNode; align?: "left" | "right"; className?: string }) {
  return <td className={`border-b border-line px-5 py-3.5 align-middle ${align === "right" ? "text-right" : ""} ${className}`}>{children}</td>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <p className="text-[14px] font-semibold">{title}</p>
      {children && <p className="mt-1 max-w-sm text-[13.5px] text-mute">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
