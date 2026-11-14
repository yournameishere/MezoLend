// MezoLend liquidation keeper.
// Scans every market via the on-chain lens, previews each liquidatable loan and (unless DRY_RUN) liquidates it.
//
//   KEEPER_PRIVATE_KEY=0x... node scripts/keeper.mjs           # liquidate for real
//   DRY_RUN=1 node scripts/keeper.mjs                           # just report
//   INTERVAL=20 MIN_PROFIT_USD=0.10 RPC_URL=https://... node scripts/keeper.mjs
//
// The keeper repays with MUSD it already holds and receives BTC at the market's liquidation bonus.
import { createPublicClient, createWalletClient, erc20Abi, formatUnits, http, maxUint256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mezoTestnet } from "viem/chains";
import { deployment } from "../src/config/deployment.ts";
import { liquidationManagerAbi, mezoLendLensAbi } from "../src/config/abis.ts";

const RPC = process.env.RPC_URL || "https://rpc.test.mezo.org";
const DRY = !!process.env.DRY_RUN || !process.env.KEEPER_PRIVATE_KEY;
const INTERVAL = Number(process.env.INTERVAL || 30) * 1000;
const MIN_PROFIT = Number(process.env.MIN_PROFIT_USD || 0);
const ONCE = !!process.env.ONCE;
const WAD = 10n ** 18n;

const transport = http(RPC, { retryCount: 3 });
const pub = createPublicClient({ chain: mezoTestnet, transport });
const account = process.env.KEEPER_PRIVATE_KEY ? privateKeyToAccount(process.env.KEEPER_PRIVATE_KEY) : undefined;
const wallet = account ? createWalletClient({ account, chain: mezoTestnet, transport }) : undefined;

const fmt = (x, d = 4) => Number(formatUnits(x, 18)).toFixed(d);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function tick() {
  const markets = await pub.readContract({ address: deployment.lens, abi: mezoLendLensAbi, functionName: "getMarkets" });
  for (const m of markets) {
    if (m.liquidationPaused) continue;
    const btc = m.collaterals[0];
    const [positions] = await pub.readContract({
      address: deployment.lens,
      abi: mezoLendLensAbi,
      functionName: "getAccounts",
      args: [m.id, 0n, 500n],
    });
    const targets = positions.filter((p) => p.dataOk && p.debt > 0n && p.healthFactor < WAD);
    log(`${m.name}: ${positions.length} accounts, ${targets.length} liquidatable`);

    for (const t of targets) {
      const preview = await pub.readContract({
        address: m.liquidationManager,
        abi: liquidationManagerAbi,
        functionName: "previewLiquidation",
        args: [t.account, btc.asset, 0n],
      });
      let repay = preview.repayAmount;
      if (account) {
        const bal = await pub.readContract({ address: deployment.musd, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
        if (bal < repay) repay = bal;
      }
      const profitUsd = Number(formatUnits(preview.bonusValue, 18)) * (repay > 0n ? Number(repay) / Number(preview.repayAmount || 1n) : 0);
      log(`  ${t.account} HF ${fmt(t.healthFactor, 3)} debt ${fmt(t.debt)} → repay ${fmt(repay)} MUSD, seize ~${fmt(preview.seizeToLiquidator, 8)} BTC, profit ~$${profitUsd.toFixed(3)}`);
      if (DRY || repay === 0n || profitUsd < MIN_PROFIT) continue;

      const allowance = await pub.readContract({ address: deployment.musd, abi: erc20Abi, functionName: "allowance", args: [account.address, m.pool] });
      if (allowance < repay) {
        const h = await wallet.writeContract({ address: deployment.musd, abi: erc20Abi, functionName: "approve", args: [m.pool, maxUint256] });
        await pub.waitForTransactionReceipt({ hash: h });
      }
      // re-preview for the actual amount and keep a 0.5% slippage guard on seized collateral
      const exact = await pub.readContract({
        address: m.liquidationManager,
        abi: liquidationManagerAbi,
        functionName: "previewLiquidation",
        args: [t.account, btc.asset, repay],
      });
      try {
        const { request } = await pub.simulateContract({
          account,
          address: m.liquidationManager,
          abi: liquidationManagerAbi,
          functionName: "liquidate",
          args: [t.account, btc.asset, exact.repayAmount, (exact.seizeToLiquidator * 995n) / 1000n],
        });
        const hash = await wallet.writeContract(request);
        const r = await pub.waitForTransactionReceipt({ hash });
        log(`  liquidated ${t.account}: ${r.status} ${hash}`);
      } catch (e) {
        log(`  skipped ${t.account}: ${e.shortMessage || e.message}`);
      }
    }
  }
}

log(`MezoLend keeper on ${RPC} ${DRY ? "(dry run)" : `as ${account.address}`}`);
for (;;) {
  try {
    await tick();
  } catch (e) {
    log("tick failed:", e.shortMessage || e.message);
  }
  if (ONCE) break;
  await new Promise((r) => setTimeout(r, INTERVAL));
}
