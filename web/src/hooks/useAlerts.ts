"use client";

import { useEffect } from "react";
import { useMarkets, useUserOverview } from "./useProtocol";
import { pushNotice, rememberAlert, toast, useSettings } from "@/lib/store";
import { fmtPct, toNum } from "@/lib/format";

/**
 * Watches the connected account's positions on every refresh and raises alerts when:
 *  - a loan's health factor crosses the user's warning / critical thresholds
 *  - a position becomes liquidatable
 *  - utilization of a pool the user supplies to passes the configured level (withdrawals may be limited)
 * Alerts fire once per level change (remembered across reloads).
 */
export function useAlerts() {
  const { user, account } = useUserOverview();
  const { markets } = useMarkets();
  const settings = useSettings();

  useEffect(() => {
    if (!user || !markets || !account) return;
    const acct = account.toLowerCase();
    for (const um of user.markets) {
      const m = markets[Number(um.id)];
      if (!m) continue;

      if (um.debt > 0n && um.dataOk) {
        const hf = toNum(um.healthFactor);
        const level = hf < 1 ? "liquidatable" : hf < settings.criticalHF ? "critical" : hf < settings.warnHF ? "warn" : "ok";
        if (rememberAlert(`${acct}:${m.id}:hf`, level) && level !== "ok") {
          const title =
            level === "liquidatable"
              ? `${m.name} loan can be liquidated`
              : level === "critical"
                ? `${m.name} loan is close to liquidation`
                : `${m.name} collateral ratio has dropped`;
          const body =
            level === "liquidatable"
              ? `Health factor ${hf.toFixed(2)}. Repay or add BTC now to stop further liquidation.`
              : `Health factor ${hf.toFixed(2)}. Consider adding collateral or repaying part of the loan.`;
          const tone = level === "warn" ? "warning" : "error";
          pushNotice({ account: acct, kind: "alert", tone, title, body });
          toast({ tone, title, body }, 10_000);
        }
      } else {
        rememberAlert(`${acct}:${m.id}:hf`, "none");
      }

      if (um.shares > 0n) {
        const u = toNum(m.utilization);
        const level = u >= settings.utilizationAlert ? "high" : "ok";
        if (rememberAlert(`${acct}:${m.id}:util`, level) && level === "high") {
          pushNotice({
            account: acct,
            kind: "alert",
            tone: "warning",
            title: `${m.name} pool utilization is ${fmtPct(m.utilization, 1)}`,
            body: "Most of the pool is lent out, so withdrawals may be limited until borrowers repay. Rates rise to attract repayment.",
          });
        }
      }
    }
  }, [user, markets, account, settings.warnHF, settings.criticalHF, settings.utilizationAlert]);
}
