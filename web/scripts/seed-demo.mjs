// Post-deploy configuration + scripted end-to-end run on Mezo Testnet.
//
//   node scripts/seed-demo.mjs            (from web/, after `forge script` wrote ../deployments/mezo-testnet.json)
//
// 1. Registers the BTC/USD feed (Skip primary, Pyth fallback). Mezo's Skip oracle is a chain precompile that
//    forge cannot simulate, so this runs here, on-chain.
// 2. Funds four demo wallets from the deployer and drives every money path through the real contracts:
//    Mezo Pools zap (BTC -> MUSD, BTC -> supply, BTC -> repay), permit supply/repay/liquidate, borrow,
//    partial withdraw, a liquidation and a full close.
// 3. Writes every transaction to ../deployments/seed-log.json (re-runs skip finished steps).
//
// Keys come from ../contracts/.env (gitignored): DEPLOYER_PRIVATE_KEY, DEMO_{ADA,BEN,CLEO,DEV}_KEY.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
  maxUint256,
  parseEther,
  parseSignature,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const DEP_PATH = resolve(root, "deployments/mezo-testnet.json");
const LOG_PATH = resolve(root, "deployments/seed-log.json");
const EXPLORER = "https://explorer.test.mezo.org";

const env = Object.fromEntries(
  readFileSync(resolve(root, "contracts/.env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const abi = (n) => JSON.parse(readFileSync(resolve(root, `contracts/out/${n}.sol/${n}.json`), "utf8")).abi;
const A = {
  pool: abi("LendingPool"),
  bm: abi("BorrowManager"),
  cm: abi("CollateralManager"),
  lm: abi("LiquidationManager"),
  oracle: abi("PriceOracle"),
  zap: abi("MezoLendZap"),
};
const erc20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "nonces", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
];

const d = JSON.parse(readFileSync(DEP_PATH, "utf8"));
const chain = defineChain({
  id: 31611,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.test.mezo.org"] } },
});
const transport = http("https://rpc.test.mezo.org", { retryCount: 5, timeout: 60_000 });
const pub = createPublicClient({ chain, transport });
const pk = (k) => (k.startsWith("0x") ? k : `0x${k}`);
const W = {
  deployer: privateKeyToAccount(pk(env.DEPLOYER_PRIVATE_KEY)),
  ada: privateKeyToAccount(pk(env.DEMO_ADA_KEY)),
  ben: privateKeyToAccount(pk(env.DEMO_BEN_KEY)),
  cleo: privateKeyToAccount(pk(env.DEMO_CLEO_KEY)),
  dev: privateKeyToAccount(pk(env.DEMO_DEV_KEY)),
};
const wallet = (name) => createWalletClient({ chain, transport, account: W[name] });

const log = existsSync(LOG_PATH)
  ? JSON.parse(readFileSync(LOG_PATH, "utf8"))
  : { network: "mezo-testnet", chainId: 31611, wallets: {}, steps: [] };
for (const [n, acc] of Object.entries(W)) log.wallets[n] = acc.address;
const save = () => writeFileSync(LOG_PATH, JSON.stringify(log, null, 2) + "\n");
const done = (name) => log.steps.some((s) => s.name === name && s.status === "success");

const SKIP_BTC_USD = "0x7b7c000000000000000000000000000000000015";
const PYTH_BTC_USD = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
const NO_PERMIT = { value: 0n, deadline: 0n, v: 0, r: `0x${"0".repeat(64)}`, s: `0x${"0".repeat(64)}` };
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 1200);

/** Sends one transaction, waits for the receipt and records it. RPC gas estimates can be low on Mezo: pad 50%. */
async function send(name, who, { address, abi: cAbi, functionName, args = [], value = 0n, to, note }) {
  if (done(name)) {
    console.log(`  · ${name} (already done)`);
    return null;
  }
  const w = wallet(who);
  let hash;
  if (to) {
    hash = await w.sendTransaction({ to, value, gas: 50_000n });
  } else {
    const est = await pub.estimateContractGas({ address, abi: cAbi, functionName, args, value, account: W[who] });
    hash = await w.writeContract({ address, abi: cAbi, functionName, args, value, gas: (est * 3n) / 2n + 50_000n });
  }
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  const entry = {
    name,
    actor: who,
    from: W[who].address,
    to: to ?? address,
    call: to ? "transfer BTC" : functionName,
    value: value ? formatEther(value) : undefined,
    note,
    hash,
    block: Number(r.blockNumber),
    gasUsed: Number(r.gasUsed),
    status: r.status,
    explorer: `${EXPLORER}/tx/${hash}`,
  };
  log.steps.push(entry);
  save();
  console.log(`  ${r.status === "success" ? "✓" : "✗"} ${name}  ${entry.explorer}`);
  if (r.status !== "success") throw new Error(`${name} reverted`);
  return r;
}

/** EIP-2612 signature for MUSD (domain "Mezo USD", version "1"). */
async function musdPermit(who, spender, value) {
  const owner = W[who].address;
  const nonce = await pub.readContract({ address: d.musd, abi: erc20, functionName: "nonces", args: [owner] });
  const dl = deadline();
  const sig = await W[who].signTypedData({
    domain: { name: "Mezo USD", version: "1", chainId: 31611, verifyingContract: d.musd },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message: { owner, spender, value, nonce, deadline: dl },
  });
  const { r, s, yParity } = parseSignature(sig);
  return { value, deadline: dl, v: yParity + 27, r, s };
}

const musdOf = (who) => pub.readContract({ address: d.musd, abi: erc20, functionName: "balanceOf", args: [W[who].address] });
const quote = (amount) => pub.readContract({ address: d.zap, abi: A.zap, functionName: "quote", args: [d.btc, amount] });
const minOut = (q) => (q * 98n) / 100n; // 2% slippage

async function main() {
  console.log("MezoLend seed — registry", d.registry);
  log.deployment = { registry: d.registry, zap: d.zap, startBlock: d.startBlock };

  // 1 ── oracle feed
  await send("oracle: register BTC/USD feed (Skip primary, Pyth fallback)", "deployer", {
    address: d.oracle,
    abi: A.oracle,
    functionName: "setFeed",
    args: [d.btc, SKIP_BTC_USD, 1800, PYTH_BTC_USD, 3600, parseEther("1000"), parseEther("10000000")],
  });
  const price = await pub.readContract({ address: d.oracle, abi: A.oracle, functionName: "getPrice", args: [d.btc] });
  console.log("  BTC/USD", formatEther(price));

  // 2 ── fund demo wallets with faucet-style BTC
  const funding = { ada: "0.0086", ben: "0.0056", cleo: "0.0063", dev: "0.0032" };
  for (const [who, amt] of Object.entries(funding)) {
    await send(`fund ${who} with ${amt} BTC`, "deployer", { to: W[who].address, value: parseEther(amt) });
  }

  // 3 ── lenders
  const adaIn = parseEther("0.008");
  await send("ada: BTC -> MUSD -> Core supply in one tx (zap.swapAndSupply)", "ada", {
    address: d.zap, abi: A.zap, functionName: "swapAndSupply", value: adaIn,
    args: [d.btc, adaIn, minOut(await quote(adaIn)), d.core.pool, W.ada.address, deadline(), NO_PERMIT],
  });
  const benIn = parseEther("0.005");
  await send("ben: swap BTC for MUSD through Mezo Pools (zap.swapToMusd)", "ben", {
    address: d.zap, abi: A.zap, functionName: "swapToMusd", value: benIn,
    args: [d.btc, benIn, minOut(await quote(benIn)), W.ben.address, deadline(), NO_PERMIT],
  });
  if (!done("ben: supply 250 MUSD to Edge with a permit signature (depositWithPermit)")) {
    const amt = parseEther("250");
    await send("ben: supply 250 MUSD to Edge with a permit signature (depositWithPermit)", "ben", {
      address: d.edge.pool, abi: A.pool, functionName: "depositWithPermit",
      args: [amt, W.ben.address, await musdPermit("ben", d.edge.pool, amt)],
    });
  }
  const depIn = parseEther("0.004");
  await send("deployer: BTC -> MUSD -> Edge supply (zap.swapAndSupply)", "deployer", {
    address: d.zap, abi: A.zap, functionName: "swapAndSupply", value: depIn,
    args: [d.btc, depIn, minOut(await quote(depIn)), d.edge.pool, W.deployer.address, deadline(), NO_PERMIT],
  });

  // 4 ── borrowers
  const cleoBtc = parseEther("0.004");
  await send("cleo: post 0.004 BTC and borrow 100 MUSD in Core (depositAndBorrow)", "cleo", {
    address: d.core.borrowManager, abi: A.bm, functionName: "depositAndBorrow", value: cleoBtc,
    args: [d.btc, cleoBtc, parseEther("100")],
  });
  const devBtc = parseEther("0.003");
  // borrow ~98.5% of the Edge limit: 0.003 BTC x price x 78% LTV, net of the 0.25% origination fee
  const devBorrow = (((devBtc * price) / 10n ** 18n) * 78n * 985n) / (100n * 1000n) * 10_000n / 10_025n;
  await send(`dev: post 0.003 BTC and borrow ${Number(formatEther(devBorrow)).toFixed(2)} MUSD in Edge (near max LTV)`, "dev", {
    address: d.edge.borrowManager, abi: A.bm, functionName: "depositAndBorrow", value: devBtc,
    args: [d.btc, devBtc, devBorrow],
  });
  const cleoEdge = parseEther("0.0015");
  await send("cleo: post 0.0015 BTC and borrow 40 MUSD in Edge", "cleo", {
    address: d.edge.borrowManager, abi: A.bm, functionName: "depositAndBorrow", value: cleoEdge,
    args: [d.btc, cleoEdge, parseEther("40")],
  });
  const depBtc = parseEther("0.006");
  await send("deployer: post 0.006 BTC and borrow 180 MUSD in Core", "deployer", {
    address: d.core.borrowManager, abi: A.bm, functionName: "depositAndBorrow", value: depBtc,
    args: [d.btc, depBtc, parseEther("180")],
  });

  // 5 ── repayments and withdrawals
  if (!done("cleo: repay 40 MUSD in Core with a permit signature (repayWithPermit)")) {
    const amt = parseEther("40");
    await send("cleo: repay 40 MUSD in Core with a permit signature (repayWithPermit)", "cleo", {
      address: d.core.pool, abi: A.pool, functionName: "repayWithPermit",
      args: [W.cleo.address, amt, await musdPermit("cleo", d.core.pool, amt)],
    });
  }
  const cleoRepayBtc = parseEther("0.0005");
  await send("cleo: repay Core loan with BTC through Mezo Pools (zap.swapAndRepay)", "cleo", {
    address: d.zap, abi: A.zap, functionName: "swapAndRepay", value: cleoRepayBtc,
    args: [d.btc, cleoRepayBtc, minOut(await quote(cleoRepayBtc)), d.core.pool, W.cleo.address, deadline(), NO_PERMIT],
  });
  await send("ada: withdraw 50 MUSD from Core", "ada", {
    address: d.core.pool, abi: A.pool, functionName: "withdraw",
    args: [parseEther("50"), W.ada.address, W.ada.address],
  });

  // 6 ── liquidation. The BTC price can't be moved on testnet, so governance tightens Edge's BTC risk
  //      parameters (a normal risk lever), dev's near-max loan falls below health 1.0, ben liquidates it
  //      with a permit, and the parameters are restored straight after.
  const liqName = "ben: liquidate dev in Edge with a permit signature (liquidateWithPermit)";
  if (!done(liqName)) {
    await send("admin: tighten Edge BTC params to LTV 70% / threshold 75% (risk-parameter change)", "deployer", {
      address: d.edge.collateralManager, abi: A.cm, functionName: "configureAsset",
      args: [d.btc, true, false, parseEther("0.70"), parseEther("0.75"), parseEther("0.075"), parseEther("100")],
    });
    try {
      const p = await pub.readContract({
        address: d.edge.liquidationManager, abi: A.lm, functionName: "previewLiquidation",
        args: [W.dev.address, d.btc, 0n],
      });
      console.log(`  dev health ${formatEther(p.healthFactor)} · max repay ${formatEther(p.maxRepay)} MUSD`);
      const permit = await musdPermit("ben", d.edge.pool, (p.maxRepay * 101n) / 100n);
      await send(liqName, "ben", {
        address: d.edge.liquidationManager, abi: A.lm, functionName: "liquidateWithPermit",
        args: [W.dev.address, d.btc, maxUint256, (p.seizeToLiquidator * 99n) / 100n, permit],
      });
    } finally {
      await send("admin: restore Edge BTC params to LTV 78% / threshold 85%", "deployer", {
        address: d.edge.collateralManager, abi: A.cm, functionName: "configureAsset",
        args: [d.btc, true, false, parseEther("0.78"), parseEther("0.85"), parseEther("0.075"), parseEther("100")],
      });
    }
  }

  // 7 ── dev closes what is left: repay everything and take the remaining BTC back in one permit transaction
  if (!done("dev: repay in full and withdraw all BTC (repayAndWithdrawWithPermit)")) {
    const debt = await pub.readContract({ address: d.edge.pool, abi: A.pool, functionName: "borrowBalanceCurrent", args: [W.dev.address] });
    const bal = await musdOf("dev");
    console.log(`  dev debt ${formatEther(debt)} MUSD, wallet ${formatEther(bal)} MUSD`);
    const value = (debt * 1001n) / 1000n + parseEther("0.01");
    await send("dev: repay in full and withdraw all BTC (repayAndWithdrawWithPermit)", "dev", {
      address: d.edge.borrowManager, abi: A.bm, functionName: "repayAndWithdrawWithPermit",
      args: [maxUint256, d.btc, maxUint256, await musdPermit("dev", d.edge.pool, value < bal ? value : bal)],
    });
  }

  log.finishedAt = new Date().toISOString();
  save();
  console.log(`done: ${log.steps.length} transactions logged to deployments/seed-log.json`);
}

main().catch((e) => {
  console.error(e.shortMessage || e.message || e);
  process.exit(1);
});
