import type { Abi, Address } from "viem";
import { deployment } from "./deployment";
import {
  borrowManagerAbi,
  collateralManagerAbi,
  interestRateModelAbi,
  lendingPoolAbi,
  liquidationManagerAbi,
  marketRegistryAbi,
  mezoLendLensAbi,
  mezoLendZapAbi,
  priceOracleAbi,
} from "./abis";

export const CHAIN_ID = 31611;
/** Dev-only: localStorage "mezolend.rpcOverride" points the app at a local fork (used for liquidation E2E tests). */
function devOverride(): string | undefined {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return undefined;
  try {
    return window.localStorage.getItem("mezolend.rpcOverride") || undefined;
  } catch {
    return undefined;
  }
}
export const RPC_URL = devOverride() || process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.test.mezo.org";
export const EXPLORER = "https://explorer.test.mezo.org";
export const EXPLORER_API = "https://api.explorer.test.mezo.org/api";
export const FAUCET = "https://faucet.test.mezo.org";
export const MEZO_BORROW = "https://mezo.org/feature/borrow";

export const BTC = deployment.btc as Address;
export const MUSD = deployment.musd as Address;
export const LENS = deployment.lens as Address;
export const REGISTRY = deployment.registry as Address;
export const ORACLE = deployment.oracle as Address;
export const START_BLOCK = deployment.startBlock;
export const OPERATOR = deployment.deployer as Address;
export const ZAP = deployment.zap as Address;
export const MEZO = deployment.mezo as Address;
export const POOLS_ROUTER = deployment.poolsRouter as Address;
export const POOLS_FACTORY = deployment.poolsFactory as Address;
export const MEZO_POOLS_APP = "https://mezo.org/feature/pools";

/** Native BTC kept back for gas when a user deposits "max" collateral. */
export const GAS_RESERVE = 20_000_000_000_000n; // 0.00002 BTC

export const SKIP_FEED = "0x7b7c000000000000000000000000000000000015" as Address;

/** Every custom error from every contract — lets viem decode reverts that bubble through nested calls. */
const allAbis = [
  lendingPoolAbi,
  borrowManagerAbi,
  collateralManagerAbi,
  liquidationManagerAbi,
  priceOracleAbi,
  interestRateModelAbi,
  marketRegistryAbi,
  mezoLendLensAbi,
  mezoLendZapAbi,
] as const;

const seen = new Set<string>();
export const errorsAbi = allAbis
  .flatMap((a) => (a as Abi).filter((x) => x.type === "error"))
  .filter((e) => {
    const key = JSON.stringify(e);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }) as Abi;

export const contractLinks = [
  { label: "Market registry", address: deployment.registry },
  { label: "Price oracle (Skip + Pyth)", address: deployment.oracle },
  { label: "Lens (read aggregator)", address: deployment.lens },
  { label: "Core · lending pool", address: deployment.core.pool },
  { label: "Core · borrow manager", address: deployment.core.borrowManager },
  { label: "Core · collateral manager", address: deployment.core.collateralManager },
  { label: "Core · liquidation manager", address: deployment.core.liquidationManager },
  { label: "Core · rate model", address: deployment.core.interestRateModel },
  { label: "Edge · lending pool", address: deployment.edge.pool },
  { label: "Edge · borrow manager", address: deployment.edge.borrowManager },
  { label: "Edge · collateral manager", address: deployment.edge.collateralManager },
  { label: "Edge · liquidation manager", address: deployment.edge.liquidationManager },
  { label: "Edge · rate model", address: deployment.edge.interestRateModel },
  { label: "Swap & supply zap (Mezo Pools)", address: deployment.zap },
  { label: "MUSD token", address: deployment.musd },
] as const;

export {
  borrowManagerAbi,
  collateralManagerAbi,
  interestRateModelAbi,
  lendingPoolAbi,
  liquidationManagerAbi,
  marketRegistryAbi,
  mezoLendLensAbi,
  mezoLendZapAbi,
  priceOracleAbi,
};
