"use client";

import { useState } from "react";
import { useConnection } from "wagmi";
import { clearNotices, markAllRead, setSettings, useNotices, useSettings } from "@/lib/store";
import { timeAgo } from "@/lib/format";
import { ExplorerLink } from "@/components/ui/Primitives";
import { Bell } from "lucide-react";

const dot = { success: "bg-tang", error: "bg-danger", warning: "bg-warn", info: "bg-mute" } as const;

export function NoticeBell() {
  const { address } = useConnection();
  const notices = useNotices(address);
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"feed" | "settings">("feed");
  const unread = notices.filter((n) => !n.read).length;

  const askBrowser = async () => {
    if (!("Notification" in window)) return;
    const p = await Notification.requestPermission();
    setSettings({ browserAlerts: p === "granted" });
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          if (!open && address) setTimeout(() => markAllRead(address.toLowerCase()), 1500);
        }}
        className="relative grid h-10 w-10 place-items-center rounded-[var(--radius-ctl)] border border-line bg-paper text-mute transition-colors hover:border-line-2 hover:text-ink"
      >
        <Bell size={17} aria-hidden />
        {unread > 0 && (
          <span className="t-num absolute -top-1 -right-1 grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-paper bg-tang px-1 text-[10px] font-bold text-ink">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" aria-label="Close notifications" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-[12px] border border-line bg-card shadow-[var(--shadow-pop)]">
            <div className="flex items-center gap-1 border-b border-line px-2 py-2">
              {(["feed", "settings"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded-md px-3 py-1.5 text-[13px] font-semibold ${tab === t ? "bg-tang-soft text-ink" : "text-mute hover:text-ink"}`}
                >
                  {t === "feed" ? "Notifications" : "Alert settings"}
                </button>
              ))}
              {tab === "feed" && notices.length > 0 && (
                <button className="ml-auto px-2 text-[12px] text-faint hover:text-ink" onClick={() => address && clearNotices(address.toLowerCase())}>
                  Clear
                </button>
              )}
            </div>
            {tab === "feed" ? (
              <ul className="max-h-[420px] overflow-y-auto">
                {!address && <li className="px-4 py-8 text-center text-[13px] text-mute">Connect a wallet to see alerts about your positions.</li>}
                {address && notices.length === 0 && (
                  <li className="px-4 py-8 text-center text-[13px] text-mute">
                    Nothing yet. You&apos;ll see confirmations here, plus a warning if a loan gets close to liquidation.
                  </li>
                )}
                {notices.map((n) => (
                  <li key={n.id} className="flex gap-3 border-b border-line/60 px-4 py-3 last:border-0">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot[n.tone]}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-semibold">{n.title}</p>
                      {n.body && <p className="mt-0.5 text-[12.5px] leading-snug text-mute">{n.body}</p>}
                      <p className="mt-1 flex gap-3 text-[11.5px] text-faint">
                        {timeAgo(n.ts / 1000)}
                        {n.hash && <ExplorerLink hash={n.hash} className="text-[11.5px]">transaction</ExplorerLink>}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="space-y-4 p-4 text-[13px]">
                <p className="text-mute">MezoLend checks your positions every few seconds while this tab is open.</p>
                <Threshold
                  label="Warn me when health factor falls below"
                  value={settings.warnHF}
                  min={1.1}
                  max={3}
                  step={0.05}
                  onChange={(v) => setSettings({ warnHF: Math.max(v, settings.criticalHF + 0.05) })}
                />
                <Threshold
                  label="Urgent alert below"
                  value={settings.criticalHF}
                  min={1.01}
                  max={2}
                  step={0.01}
                  onChange={(v) => setSettings({ criticalHF: Math.min(v, settings.warnHF - 0.05) })}
                />
                <Threshold
                  label="Tell me when a pool I supply to passes utilization"
                  value={settings.utilizationAlert * 100}
                  min={50}
                  max={99}
                  step={1}
                  suffix="%"
                  onChange={(v) => setSettings({ utilizationAlert: v / 100 })}
                />
                <label className="flex items-center justify-between gap-3">
                  <span>Browser notifications when this tab is in the background</span>
                  <input
                    type="checkbox"
                    checked={settings.browserAlerts}
                    onChange={(e) => (e.target.checked ? askBrowser() : setSettings({ browserAlerts: false }))}
                    className="h-4 w-4 accent-[#f7931a]"
                  />
                </label>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Threshold({
  label,
  value,
  min,
  max,
  step,
  suffix = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex justify-between gap-3">
        <span>{label}</span>
        <span className="t-num font-semibold text-ink">
          {suffix ? value.toFixed(0) : value.toFixed(2)}
          {suffix}
        </span>
      </span>
      <input type="range" className="thermal mt-1 w-full" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
