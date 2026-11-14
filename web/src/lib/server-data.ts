import { createPublicClient, http } from "viem";
import { mezoTestnet } from "viem/chains";
import { LENS, mezoLendLensAbi } from "@/config/contracts";

/**
 * Server-side snapshot of every market, read straight from the lens contract.
 * Seeds the client cache so pages render with live numbers instead of skeletons; the client then keeps polling.
 */
export async function fetchMarketsSnapshot() {
  try {
    const client = createPublicClient({
      chain: mezoTestnet,
      transport: http(process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.test.mezo.org", {
        timeout: 8_000,
        retryCount: 1,
        fetchOptions: { next: { revalidate: 30 } } as RequestInit,
      }),
    });
    const markets = await client.readContract({ address: LENS, abi: mezoLendLensAbi, functionName: "getMarkets" });
    return { markets, at: Date.now() };
  } catch {
    return { markets: undefined, at: 0 };
  }
}

export type MarketsSnapshot = Awaited<ReturnType<typeof fetchMarketsSnapshot>>["markets"];
