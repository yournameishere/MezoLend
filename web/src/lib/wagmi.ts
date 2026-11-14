import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { mezoTestnet } from "viem/chains";
import { RPC_URL } from "@/config/contracts";

export const chain = mezoTestnet;

export const wagmiConfig = createConfig({
  chains: [mezoTestnet],
  // Generic injected connector + every wallet announced via EIP-6963 (MetaMask, Rabby, OKX, …)
  connectors: [injected({ shimDisconnect: true })],
  multiInjectedProviderDiscovery: true,
  transports: {
    [mezoTestnet.id]: http(RPC_URL, { retryCount: 3, timeout: 20_000 }),
  },
  pollingInterval: 4_000,
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
