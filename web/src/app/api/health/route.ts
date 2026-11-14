import { createPublicClient, http } from "viem";
import { mezoTestnet } from "viem/chains";
import { BTC, LENS, ORACLE, REGISTRY, ZAP, mezoLendLensAbi, priceOracleAbi } from "@/config/contracts";

export const dynamic = "force-dynamic";

/**
 * Liveness + chain health for monitoring: can we reach Mezo, is the BTC price fresh,
 * and do the markets load through the lens. 200 when everything is usable, 503 otherwise.
 */
export async function GET() {
  const started = Date.now();
  const client = createPublicClient({
    chain: mezoTestnet,
    transport: http(process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.test.mezo.org", { timeout: 6_000, retryCount: 1 }),
  });
  const checks: Record<string, unknown> = {};
  let ok = true;
  try {
    const [block, price, markets] = await Promise.all([
      client.getBlockNumber(),
      client.readContract({ address: ORACLE, abi: priceOracleAbi, functionName: "tryGetPrice", args: [BTC] }),
      client.readContract({ address: LENS, abi: mezoLendLensAbi, functionName: "getMarkets" }),
    ]);
    const [priceOk, priceWad, updatedAt, source] = price;
    checks.chain = { ok: true, chainId: mezoTestnet.id, block: Number(block) };
    checks.oracle = {
      ok: priceOk,
      btcUsd: Number(priceWad) / 1e18,
      updatedAt: Number(updatedAt),
      source: source === 1 ? "skip" : source === 2 ? "pyth" : "none",
    };
    checks.markets = markets.map((m) => ({
      name: m.name,
      active: m.active,
      totalSupplied: Number(m.totalAssets) / 1e18,
      totalBorrowed: Number(m.totalBorrows) / 1e18,
      paused: m.poolPaused || m.borrowPaused || m.liquidationPaused,
    }));
    ok = priceOk && markets.length > 0;
  } catch (e) {
    ok = false;
    checks.error = e instanceof Error ? e.message.split("\n")[0] : "unknown error";
  }
  return Response.json(
    {
      status: ok ? "ok" : "degraded",
      service: "mezolend-web",
      contracts: { registry: REGISTRY, lens: LENS, oracle: ORACLE, zap: ZAP },
      ...checks,
      latencyMs: Date.now() - started,
      time: new Date().toISOString(),
    },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
