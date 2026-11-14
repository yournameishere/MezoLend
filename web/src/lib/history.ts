import { decodeEventLog, encodeEventTopics, pad, type Abi, type Address, type Hex } from "viem";
import {
  EXPLORER_API,
  START_BLOCK,
  ZAP,
  collateralManagerAbi,
  lendingPoolAbi,
  liquidationManagerAbi,
  mezoLendZapAbi,
} from "@/config/contracts";

type RawLog = {
  address: string;
  topics: (Hex | null)[];
  data: Hex;
  blockNumber: Hex;
  timeStamp: Hex;
  transactionHash: Hex;
  logIndex: Hex;
};

async function fetchLogs(params: Record<string, string>): Promise<RawLog[]> {
  const qs = new URLSearchParams({
    module: "logs",
    action: "getLogs",
    fromBlock: String(START_BLOCK),
    toBlock: "latest",
    ...params,
  });
  const res = await fetch(`${EXPLORER_API}?${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Explorer API ${res.status}`);
  const j = await res.json();
  if (j.status === "0" && /no (records|logs)/i.test(j.message ?? "")) return [];
  if (!Array.isArray(j.result)) return [];
  return (j.result as RawLog[]).filter((l) => l && l.topics);
}

export type Activity = {
  id: string;
  kind:
    | "supply"
    | "withdraw"
    | "borrow"
    | "repay"
    | "collateral-in"
    | "collateral-out"
    | "liquidated"
    | "liquidator"
    | "shares-out"
    | "swap";
  marketId: number;
  marketName: string;
  amount: bigint;
  asset: "MUSD" | "BTC" | "MEZO";
  extra?: string;
  hash: Hex;
  block: number;
  ts: number;
};

type MarketRef = {
  id: number;
  name: string;
  pool: Address;
  collateralManager: Address;
  liquidationManager: Address;
};

type Decoded = { eventName: string; args: Record<string, unknown> };

function decode(abi: Abi, log: RawLog): Decoded | undefined {
  try {
    return decodeEventLog({
      abi,
      data: log.data,
      topics: log.topics.filter(Boolean) as [Hex, ...Hex[]],
    }) as unknown as Decoded;
  } catch {
    return undefined;
  }
}

/** Every on-chain action of `user` across all markets, newest first. Sourced from contract event logs. */
export async function loadActivity(user: Address, markets: MarketRef[]): Promise<Activity[]> {
  const topic = pad(user.toLowerCase() as Hex, { size: 32 });
  const jobs: Promise<Activity[]>[] = [];

  for (const m of markets) {
    const base = { marketId: m.id, marketName: m.name };
    jobs.push(
      fetchLogs({ address: m.pool, topic1: topic }).then((logs) =>
        logs.flatMap((l): Activity[] => {
          const ev = decode(lendingPoolAbi as Abi, l);
          if (!ev) return [];
          const a = ev.args as Record<string, unknown>;
          const common = {
            ...base,
            id: `${l.transactionHash}-${l.logIndex}`,
            hash: l.transactionHash,
            block: Number(l.blockNumber),
            ts: Number(l.timeStamp),
          };
          switch (ev.eventName) {
            case "Deposit":
              return [{ ...common, kind: "supply", amount: a.assets as bigint, asset: "MUSD" }];
            case "Withdraw":
              return [{ ...common, kind: "withdraw", amount: a.assets as bigint, asset: "MUSD" }];
            case "Borrow":
              return [
                {
                  ...common,
                  kind: "borrow",
                  amount: a.amount as bigint,
                  asset: "MUSD",
                  extra: (a.fee as bigint) > 0n ? `fee:${(a.fee as bigint).toString()}` : undefined,
                },
              ];
            case "Repay":
              return [{ ...common, kind: "repay", amount: a.amount as bigint, asset: "MUSD" }];
            case "Transfer":
              if ((a.to as string) === "0x0000000000000000000000000000000000000000") return [];
              return [{ ...common, kind: "shares-out", amount: a.value as bigint, asset: "MUSD", extra: a.to as string }];
            default:
              return [];
          }
        }),
      ),
    );
    jobs.push(
      fetchLogs({ address: m.collateralManager, topic1: topic }).then((logs) =>
        logs.flatMap((l): Activity[] => {
          const ev = decode(collateralManagerAbi as Abi, l);
          if (!ev) return [];
          const a = ev.args as Record<string, unknown>;
          const common = {
            ...base,
            id: `${l.transactionHash}-${l.logIndex}`,
            hash: l.transactionHash,
            block: Number(l.blockNumber),
            ts: Number(l.timeStamp),
            asset: "BTC" as const,
          };
          if (ev.eventName === "CollateralDeposited") return [{ ...common, kind: "collateral-in", amount: a.amount as bigint }];
          if (ev.eventName === "CollateralWithdrawn") return [{ ...common, kind: "collateral-out", amount: a.amount as bigint }];
          return []; // seizures are represented by the Liquidation event
        }),
      ),
    );
    for (const [topicKey, kind] of [
      ["topic1", "liquidated"],
      ["topic2", "liquidator"],
    ] as const) {
      jobs.push(
        fetchLogs({ address: m.liquidationManager, [topicKey]: topic }).then((logs) =>
          logs.flatMap((l): Activity[] => {
            const ev = decode(liquidationManagerAbi as Abi, l);
            if (!ev || ev.eventName !== "Liquidation") return [];
            const a = ev.args as Record<string, unknown>;
            return [
              {
                ...base,
                id: `${l.transactionHash}-${l.logIndex}-${kind}`,
                kind,
                amount: a.repaid as bigint,
                asset: "MUSD",
                extra: `seized:${(a.seizedToLiquidator as bigint).toString()}`,
                hash: l.transactionHash,
                block: Number(l.blockNumber),
                ts: Number(l.timeStamp),
              },
            ];
          }),
        ),
      );
    }
  }

  // Supplies made through the Mezo Pools zap: the zap is the ERC-4626 sender, the user is the owner (topic2).
  for (const m of markets) {
    jobs.push(
      fetchLogs({ address: m.pool, topic2: topic }).then((logs) =>
        logs.flatMap((l): Activity[] => {
          const ev = decode(lendingPoolAbi as Abi, l);
          if (!ev || ev.eventName !== "Deposit") return [];
          return [
            {
              marketId: m.id,
              marketName: m.name,
              id: `${l.transactionHash}-${l.logIndex}`,
              kind: "supply",
              amount: (ev.args as Record<string, bigint>).assets,
              asset: "MUSD",
              hash: l.transactionHash,
              block: Number(l.blockNumber),
              ts: Number(l.timeStamp),
            },
          ];
        }),
      ),
    );
  }
  // Swaps into MUSD through Mezo Pools (zap events are indexed by the user)
  jobs.push(
    fetchLogs({ address: ZAP, topic1: topic }).then((logs) =>
      logs.flatMap((l): Activity[] => {
        const ev = decode(mezoLendZapAbi as Abi, l);
        if (!ev) return [];
        const a = ev.args as Record<string, unknown>;
        const tokenIn = String(a.tokenIn).toLowerCase().endsWith("0001") ? "MEZO" : "BTC";
        const out = (a.musdOut ?? a.musdIn) as bigint;
        return [
          {
            marketId: -1,
            marketName: "Mezo Pools",
            id: `${l.transactionHash}-${l.logIndex}-swap`,
            kind: "swap",
            amount: a.amountIn as bigint,
            asset: tokenIn,
            extra: `musd:${out.toString()}`,
            hash: l.transactionHash,
            block: Number(l.blockNumber),
            ts: Number(l.timeStamp),
          },
        ];
      }),
    ),
  );

  const all = (await Promise.all(jobs)).flat();
  const seen = new Set<string>();
  return all
    .filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)))
    .sort((a, b) => b.block - a.block || b.id.localeCompare(a.id));
}

// ───────────────────────── Pool snapshots (rates & utilization over time) ─────────────────────────

const [snapshotTopic] = encodeEventTopics({ abi: lendingPoolAbi, eventName: "PoolSnapshot" });

export type Snapshot = {
  ts: number;
  block: number;
  totalAssets: number;
  totalBorrows: number;
  utilization: number;
  borrowApr: number;
  supplyApr: number;
};

export async function loadSnapshots(pool: Address): Promise<Snapshot[]> {
  const logs = await fetchLogs({ address: pool, topic0: snapshotTopic });
  return logs
    .map((l) => {
      const ev = decode(lendingPoolAbi as Abi, l);
      if (!ev || ev.eventName !== "PoolSnapshot") return undefined;
      const a = ev.args as Record<string, bigint>;
      const n = (x: bigint) => Number(x) / 1e18;
      return {
        ts: Number(l.timeStamp),
        block: Number(l.blockNumber),
        totalAssets: n(a.totalAssets),
        totalBorrows: n(a.totalBorrows),
        utilization: n(a.utilization),
        borrowApr: n(a.borrowRatePerYear),
        supplyApr: n(a.supplyRatePerYear),
      };
    })
    .filter((x): x is Snapshot => !!x)
    .sort((a, b) => a.block - b.block);
}

// ───────────────────────── Protocol-wide liquidation feed ─────────────────────────

const [liquidationTopic] = encodeEventTopics({ abi: liquidationManagerAbi, eventName: "Liquidation" });

export type LiquidationEvent = {
  marketId: number;
  marketName: string;
  borrower: Address;
  liquidator: Address;
  repaid: bigint;
  seized: bigint;
  protocolCut: bigint;
  healthFactorBefore: bigint;
  badDebt: bigint;
  hash: Hex;
  ts: number;
  block: number;
};

export async function loadLiquidations(markets: MarketRef[]): Promise<LiquidationEvent[]> {
  const res = await Promise.all(
    markets.map((m) =>
      fetchLogs({ address: m.liquidationManager, topic0: liquidationTopic }).then((logs) =>
        logs.flatMap((l) => {
          const ev = decode(liquidationManagerAbi as Abi, l);
          if (!ev || ev.eventName !== "Liquidation") return [];
          const a = ev.args as Record<string, unknown>;
          return [
            {
              marketId: m.id,
              marketName: m.name,
              borrower: a.borrower as Address,
              liquidator: a.liquidator as Address,
              repaid: a.repaid as bigint,
              seized: a.seizedToLiquidator as bigint,
              protocolCut: a.protocolCut as bigint,
              healthFactorBefore: a.healthFactorBefore as bigint,
              badDebt: a.badDebt as bigint,
              hash: l.transactionHash,
              ts: Number(l.timeStamp),
              block: Number(l.blockNumber),
            },
          ];
        }),
      ),
    ),
  );
  return res.flat().sort((a, b) => b.block - a.block);
}

// ───────────────────────── Protocol-wide recent activity (landing page) ─────────────────────────

export type PublicActivity = {
  id: string;
  kind: "supply" | "withdraw" | "borrow" | "repay" | "liquidation";
  marketName: string;
  account: Address;
  amount: bigint;
  hash: Hex;
  block: number;
  ts: number;
};

/** The latest lending actions by anyone, across all markets, from contract events. */
export async function loadRecentActivity(markets: MarketRef[], limit = 8): Promise<PublicActivity[]> {
  const jobs = markets.flatMap((m) => [
    fetchLogs({ address: m.pool }).then((logs) =>
      logs.flatMap((l): PublicActivity[] => {
        const ev = decode(lendingPoolAbi as Abi, l);
        if (!ev) return [];
        const a = ev.args as Record<string, unknown>;
        const base = {
          id: `${l.transactionHash}-${l.logIndex}`,
          marketName: m.name,
          hash: l.transactionHash,
          block: Number(l.blockNumber),
          ts: Number(l.timeStamp),
        };
        switch (ev.eventName) {
          case "Deposit":
            return [{ ...base, kind: "supply", account: a.owner as Address, amount: a.assets as bigint }];
          case "Withdraw":
            return [{ ...base, kind: "withdraw", account: a.owner as Address, amount: a.assets as bigint }];
          case "Borrow":
            return [{ ...base, kind: "borrow", account: a.borrower as Address, amount: a.amount as bigint }];
          case "Repay":
            return [{ ...base, kind: "repay", account: a.borrower as Address, amount: a.amount as bigint }];
          default:
            return [];
        }
      }),
    ),
    fetchLogs({ address: m.liquidationManager, topic0: liquidationTopic }).then((logs) =>
      logs.flatMap((l): PublicActivity[] => {
        const ev = decode(liquidationManagerAbi as Abi, l);
        if (!ev || ev.eventName !== "Liquidation") return [];
        const a = ev.args as Record<string, unknown>;
        return [
          {
            id: `${l.transactionHash}-${l.logIndex}`,
            kind: "liquidation",
            marketName: m.name,
            account: a.borrower as Address,
            amount: a.repaid as bigint,
            hash: l.transactionHash,
            block: Number(l.blockNumber),
            ts: Number(l.timeStamp),
          },
        ];
      }),
    ),
  ]);
  const all = (await Promise.all(jobs)).flat();
  // A liquidation also emits Repay; show it once, as the liquidation.
  const liqTx = new Set(all.filter((x) => x.kind === "liquidation").map((x) => x.hash));
  return all
    .filter((x) => !(x.kind === "repay" && liqTx.has(x.hash)))
    .sort((a, b) => b.block - a.block || b.id.localeCompare(a.id))
    .slice(0, limit);
}
