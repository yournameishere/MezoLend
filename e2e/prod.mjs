// End-to-end test of the LIVE site with a real Mezo Testnet wallet.
//
//   cd e2e && npm install && node prod.mjs [baseUrl]
//
// Chrome loads the production site with an injected EIP-1193 wallet (announced via EIP-6963). Every wallet
// request is forwarded to Node through page.exposeFunction and signed there with DEMO_E2E_KEY from
// ../contracts/.env (testnet only). The script clicks through every user action in the UI, waits for the
// app to report each transaction as confirmed, then checks each hash on the Mezo explorer API.
// Results go to ../deployments/e2e-prod-log.json and screenshots to ./screens/.
//
// Liquidations need an unhealthy loan. BTC's price can't be moved on testnet, so the script opens a
// near-max loan from a second demo wallet and the admin briefly tightens the Edge market's BTC risk
// parameters (a normal governance lever), restoring them right after the UI liquidation.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  erc20Abi,
  formatEther,
  http,
  maxUint256,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const BASE = process.argv[2] || "https://mezolend.vercel.app";
const EXPLORER = "https://explorer.test.mezo.org";
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(resolve(here, "screens"), { recursive: true });

const env = Object.fromEntries(
  readFileSync(resolve(root, "contracts/.env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const pk = (k) => (k.startsWith("0x") ? k : `0x${k}`);
const d = JSON.parse(readFileSync(resolve(root, "deployments/mezo-testnet.json"), "utf8"));
const abi = (n) => JSON.parse(readFileSync(resolve(root, `contracts/out/${n}.sol/${n}.json`), "utf8")).abi;

const chain = defineChain({
  id: 31611,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.test.mezo.org"] } },
});
const transport = http("https://rpc.test.mezo.org", { retryCount: 5, timeout: 60_000 });
const pub = createPublicClient({ chain, transport });
const user = privateKeyToAccount(pk(env.DEMO_E2E_KEY));
const deployer = privateKeyToAccount(pk(env.DEPLOYER_PRIVATE_KEY));
const victim = privateKeyToAccount(pk(env.DEMO_DEV_KEY));
const walletOf = (account) => createWalletClient({ chain, transport, account });

const log = { site: BASE, wallet: user.address, startedAt: new Date().toISOString(), steps: [], setup: [] };
const save = () => writeFileSync(resolve(root, "deployments/e2e-prod-log.json"), JSON.stringify(log, null, 2) + "\n");
let current = "setup";
let authorized = false; // like a fresh MetaMask: no accounts exposed until the user approves the connection
const sent = []; // { step, hash }

// ───────────────────────── wallet bridge (runs in Node) ─────────────────────────

function toBigIntFields(types, primaryType, message) {
  const out = { ...message };
  for (const f of types[primaryType] ?? []) {
    if (/^u?int\d*$/.test(f.type) && out[f.name] !== undefined) out[f.name] = BigInt(out[f.name]);
  }
  return out;
}

async function handle(method, params) {
  switch (method) {
    case "eth_requestAccounts":
      authorized = true;
      return [user.address];
    case "eth_accounts":
      return authorized ? [user.address] : [];
    case "eth_chainId":
      return "0x7b7b";
    case "net_version":
      return "31611";
    case "wallet_switchEthereumChain":
    case "wallet_addEthereumChain":
      return null;
    case "wallet_watchAsset":
      return true;
    case "wallet_requestPermissions":
    case "wallet_getPermissions":
      return [{ parentCapability: "eth_accounts" }];
    case "wallet_getCapabilities":
      return {};
    case "eth_signTypedData_v4": {
      const data = typeof params[1] === "string" ? JSON.parse(params[1]) : params[1];
      const types = { ...data.types };
      delete types.EIP712Domain;
      const sig = await user.signTypedData({
        domain: data.domain,
        types,
        primaryType: data.primaryType,
        message: toBigIntFields(types, data.primaryType, data.message),
      });
      console.log(`    ✍ signed ${data.primaryType} for ${data.domain?.name}`);
      return sig;
    }
    case "personal_sign":
      return await user.signMessage({ message: { raw: params[0] } });
    case "eth_sendTransaction": {
      const tx = params[0];
      const hash = await walletOf(user).sendTransaction({
        to: tx.to,
        data: tx.data,
        value: tx.value ? BigInt(tx.value) : 0n,
        gas: tx.gas ? BigInt(tx.gas) : undefined,
      });
      sent.push({ step: current, hash });
      console.log(`    → tx ${hash}`);
      return hash;
    }
    default:
      return await pub.request({ method, params });
  }
}

const injected = () => {
  const listeners = {};
  const provider = {
    isMezoLendE2E: true,
    request: async ({ method, params }) => {
      const out = JSON.parse(await window.__e2eWallet(method, JSON.stringify(params ?? [])));
      if (out.error) {
        const err = new Error(out.error.message);
        err.code = out.error.code;
        throw err;
      }
      return out.result;
    },
    on: (e, f) => {
      (listeners[e] ||= []).push(f);
    },
    removeListener: (e, f) => {
      listeners[e] = (listeners[e] || []).filter((x) => x !== f);
    },
  };
  window.ethereum = provider;
  const info = {
    uuid: "6f5e2b1c-0e2e-4d6b-9a1f-6d3e2e2e0001",
    name: "MezoLend E2E Wallet",
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28'%3E%3Crect width='28' height='28' rx='7' fill='%23F7931A'/%3E%3C/svg%3E",
    rdns: "app.mezolend.e2e",
  };
  const announce = () =>
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
};

// ───────────────────────── helpers ─────────────────────────

async function chainTx(label, who, req) {
  const w = walletOf(who);
  const hash = req.to && !req.abi ? await w.sendTransaction({ to: req.to, value: req.value, gas: 60_000n }) : await (async () => {
    const est = await pub.estimateContractGas({ ...req, account: who });
    return w.writeContract({ ...req, gas: (est * 3n) / 2n + 50_000n });
  })();
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  log.setup.push({ label, from: who.address, hash, status: r.status, explorer: `${EXPLORER}/tx/${hash}` });
  save();
  console.log(`  ${r.status === "success" ? "✓" : "✗"} setup: ${label}`);
  if (r.status !== "success") throw new Error(`setup failed: ${label}`);
}

/** Waits until the app's step tracker shows every step confirmed (or an error). */
async function waitForSteps(page, timeout = 240_000) {
  const ol = page.locator('ol[aria-live="polite"]').last();
  await ol.waitFor({ timeout: 30_000 });
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const items = await ol.locator("li").allInnerTexts();
    if (items.some((t) => /Stopped/.test(t))) {
      const err = await page.locator('[role="alert"], p.text-danger').allInnerTexts();
      throw new Error(`step stopped: ${items.join(" | ")} :: ${err.join(" | ")}`);
    }
    if (items.length && items.every((t) => /Confirmed|Not needed/.test(t))) return items;
    await page.waitForTimeout(1_000);
  }
  throw new Error("timed out waiting for confirmation");
}

const ONLY = (process.env.ONLY || "").toLowerCase().split(",").filter(Boolean);
async function step(name, page, fn) {
  if (ONLY.length && !/^connect/i.test(name) && !ONLY.some((o) => name.toLowerCase().includes(o))) return;
  current = name;
  const before = sent.length;
  const t0 = Date.now();
  console.log(`\n▶ ${name}`);
  try {
    await fn();
    const hashes = sent.slice(before).map((s) => s.hash);
    const checks = [];
    for (const h of hashes) {
      const r = await pub.waitForTransactionReceipt({ hash: h, timeout: 180_000 });
      // independent confirmation from the explorer
      let explorerStatus = "unknown";
      for (let i = 0; i < 10; i++) {
        try {
          const j = await (await fetch(`https://api.explorer.test.mezo.org/api/v2/transactions/${h}`)).json();
          if (j.status) {
            explorerStatus = j.status;
            break;
          }
        } catch {
          /* retry */
        }
        await new Promise((res) => setTimeout(res, 2_000));
      }
      checks.push({ hash: h, receipt: r.status, explorer: explorerStatus, block: Number(r.blockNumber), gasUsed: Number(r.gasUsed), url: `${EXPLORER}/tx/${h}` });
    }
    const ok = checks.every((c) => c.receipt === "success" && c.explorer === "ok");
    log.steps.push({ name, ok, seconds: Math.round((Date.now() - t0) / 1000), transactions: checks });
    console.log(`  ${ok ? "✓" : "✗"} ${name} (${checks.length} tx)`);
    await page.screenshot({ path: resolve(here, `screens/${String(log.steps.length).padStart(2, "0")}-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40)}.png`), fullPage: false });
  } catch (e) {
    log.steps.push({ name, ok: false, error: String(e.message || e).slice(0, 500) });
    console.log(`  ✗ ${name}: ${e.message}`);
    await page.screenshot({ path: resolve(here, `screens/FAIL-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40)}.png`), fullPage: true });
  }
  save();
}

async function pickMarket(page, name) {
  await page.getByRole("radio", { name: new RegExp(`${name} market`) }).click();
  await page.waitForTimeout(800);
}

async function fill(page, label, value) {
  const input = page.getByLabel(label, { exact: true });
  await input.fill("");
  await input.fill(value);
  await page.waitForTimeout(1_200);
}

const panelButton = (page, re) => page.getByRole("button", { name: re }).last();

// ───────────────────────── run ─────────────────────────

async function main() {
  console.log(`MezoLend production E2E against ${BASE}\nwallet ${user.address}`);
  const LM = abi("LiquidationManager");
  const CM = abi("CollateralManager");
  const BM = abi("BorrowManager");

  // Setup: fund the test wallet with faucet-sized BTC, and buy a little MEZO through Mezo Pools so the
  // MEZO permit path can be exercised in the UI.
  const bal = await pub.getBalance({ address: user.address });
  if (bal < parseEther("0.008")) await chainTx("fund test wallet with 0.0095 BTC", deployer, { to: user.address, value: parseEther("0.0095") });
  const musdBal = await pub.readContract({ address: d.musd, abi: erc20Abi, functionName: "balanceOf", args: [user.address] });
  if (musdBal < parseEther("5")) await chainTx("send 6 MUSD to test wallet", deployer, { address: d.musd, abi: erc20Abi, functionName: "transfer", args: [user.address, parseEther("6")] });
  const mezoBal = await pub.readContract({ address: d.mezo, abi: erc20Abi, functionName: "balanceOf", args: [user.address] });
  if (mezoBal < parseEther("4")) {
    const routerAbi = [
      {
        type: "function",
        name: "swapExactTokensForTokens",
        stateMutability: "nonpayable",
        inputs: [
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMin", type: "uint256" },
          { name: "routes", type: "tuple[]", components: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "stable", type: "bool" }, { name: "factory", type: "address" }] },
          { name: "to", type: "address" },
          { name: "deadline", type: "uint256" },
        ],
        outputs: [{ type: "uint256[]" }],
      },
    ];
    await chainTx("approve 5 MUSD to Mezo Pools router", user, { address: d.musd, abi: erc20Abi, functionName: "approve", args: [d.poolsRouter, parseEther("5")] });
    await chainTx("buy MEZO with 5 MUSD on Mezo Pools", user, {
      address: d.poolsRouter,
      abi: routerAbi,
      functionName: "swapExactTokensForTokens",
      args: [parseEther("5"), 0n, [{ from: d.musd, to: d.mezo, stable: false, factory: d.poolsFactory }], user.address, BigInt(Math.floor(Date.now() / 1000) + 600)],
    });
  }

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  await page.exposeFunction("__e2eWallet", async (method, paramsJson) => {
    try {
      return JSON.stringify({ result: await handle(method, JSON.parse(paramsJson)) });
    } catch (e) {
      console.log(`    wallet error on ${method}: ${e.shortMessage || e.message}`);
      return JSON.stringify({ error: { code: e.code ?? -32603, message: e.shortMessage || e.message } });
    }
  });
  await page.addInitScript(injected);
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 300)));
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 300)}`));

  await step("connect wallet", page, async () => {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Connect wallet/ }).first().click({ timeout: 30_000 });
    await page.getByRole("button", { name: /MezoLend E2E Wallet/ }).click();
    await page.getByText(user.address.slice(0, 6), { exact: false }).first().waitFor({ timeout: 20_000 });
  });

  await step("Get MUSD: swap 0.0015 BTC for MUSD on Mezo Pools", page, async () => {
    await page.goto(`${BASE}/swap`, { waitUntil: "networkidle" });
    await fill(page, "BTC to swap", "0.0015");
    await page.getByLabel(/Keep the MUSD in my wallet/).check();
    await panelButton(page, /^Swap for MUSD$/).click();
    await waitForSteps(page);
  });

  await step("Get MUSD: swap 4 MEZO for MUSD with a MEZO permit", page, async () => {
    await page.goto(`${BASE}/swap`, { waitUntil: "networkidle" });
    await page.getByRole("tab", { name: "MEZO" }).click();
    await fill(page, "MEZO to swap", "4");
    await panelButton(page, /^Swap for MUSD$/).click();
    await waitForSteps(page);
  });

  await step("Lend: lend 50 MUSD in Core with an MUSD permit", page, async () => {
    await page.goto(`${BASE}/lend`, { waitUntil: "networkidle" });
    await pickMarket(page, "Core");
    await fill(page, "Amount to lend", "50");
    await panelButton(page, /^Lend 50 MUSD$/).click();
    await waitForSteps(page);
  });

  await step("Lend: withdraw 10 MUSD from Core", page, async () => {
    await page.getByRole("tab", { name: "Withdraw" }).click();
    await fill(page, "Amount to withdraw", "10");
    await panelButton(page, /^Withdraw 10 MUSD$/).click();
    await waitForSteps(page);
  });

  await step("Get MUSD: swap 0.0005 BTC and lend it in Edge in one transaction", page, async () => {
    await page.goto(`${BASE}/swap`, { waitUntil: "networkidle" });
    await fill(page, "BTC to swap", "0.0005");
    await page.getByLabel(/Lend it right away/).check();
    await page.getByRole("tab", { name: "Edge" }).click();
    await panelButton(page, /^Swap and lend in Edge$/).click();
    await waitForSteps(page);
  });

  await step("Borrow: post 0.003 BTC and borrow 60 MUSD in Core", page, async () => {
    await page.goto(`${BASE}/borrow`, { waitUntil: "networkidle" });
    await pickMarket(page, "Core");
    await fill(page, "Add BTC collateral", "0.003");
    await fill(page, "Borrow", "60");
    await panelButton(page, /Deposit 0.003 BTC and borrow 60 MUSD|Borrow 60 MUSD/).click();
    await waitForSteps(page);
  });

  await step("Borrow: repay 20 MUSD with an MUSD permit", page, async () => {
    await page.getByRole("tab", { name: "Repay" }).click();
    await fill(page, "Amount to repay", "20");
    await panelButton(page, /^Repay 20 MUSD$/).click();
    await waitForSteps(page);
  });

  await step("Collateral: add 0.0005 BTC", page, async () => {
    await page.getByRole("tab", { name: "Collateral" }).click();
    await fill(page, "BTC to add", "0.0005");
    await panelButton(page, /^Deposit 0.0005 BTC$/).click();
    await waitForSteps(page);
  });

  await step("Collateral: withdraw 0.0003 BTC", page, async () => {
    await page.getByRole("tab", { name: "Withdraw" }).click();
    await fill(page, "BTC to withdraw", "0.0003");
    await panelButton(page, /^Withdraw 0.0003 BTC$/).click();
    await waitForSteps(page);
  });

  await step("Get MUSD: repay the Core loan with 0.0002 BTC through Mezo Pools", page, async () => {
    await page.goto(`${BASE}/swap`, { waitUntil: "networkidle" });
    await fill(page, "BTC to swap", "0.0002");
    await page.getByLabel(/Pay down my loan/).check();
    await page.getByRole("tab", { name: "Core" }).click();
    await panelButton(page, /^Swap and repay my loan$/).click();
    await waitForSteps(page);
  });

  // Liquidation: a near-max Edge loan from the victim wallet, then a temporary risk-parameter change.
  const wantLiquidation = !ONLY.length || ONLY.some((o) => "liquidate".includes(o) || o.includes("liquid"));
  if (wantLiquidation) {
  const vDebt = await pub.readContract({ address: d.edge.pool, abi: abi("LendingPool"), functionName: "borrowBalanceCurrent", args: [victim.address] });
  if (vDebt === 0n) {
    const price = await pub.readContract({ address: d.oracle, abi: abi("PriceOracle"), functionName: "getPrice", args: [d.btc] });
    const coll = parseEther("0.0012");
    const borrow = ((((coll * price) / 10n ** 18n) * 78n * 985n) / 100_000n) * 10_000n / 10_025n;
    await chainTx(`victim: post 0.0012 BTC, borrow ${formatEther(borrow).slice(0, 6)} MUSD in Edge`, victim, {
      address: d.edge.borrowManager, abi: BM, functionName: "depositAndBorrow", args: [d.btc, coll, borrow], value: coll,
    });
  }
  await chainTx("admin: tighten Edge BTC params (LTV 70% / threshold 75%)", deployer, {
    address: d.edge.collateralManager, abi: CM, functionName: "configureAsset",
    args: [d.btc, true, false, parseEther("0.70"), parseEther("0.75"), parseEther("0.075"), parseEther("100")],
  });
  try {
    await step("Liquidate: repay an unhealthy Edge loan with an MUSD permit", page, async () => {
      await page.goto(`${BASE}/liquidations`, { waitUntil: "networkidle" });
      await page.getByRole("tab", { name: "Edge market" }).click();
      const row = page.locator("tr", { hasText: victim.address.slice(0, 6) });
      await row.getByRole("button", { name: "Liquidate" }).click({ timeout: 30_000 });
      await page.waitForTimeout(3_000);
      await panelButton(page, /^Liquidate for/).click();
      await waitForSteps(page);
    });
  } finally {
    await chainTx("admin: restore Edge BTC params (LTV 78% / threshold 85%)", deployer, {
      address: d.edge.collateralManager, abi: CM, functionName: "configureAsset",
      args: [d.btc, true, false, parseEther("0.78"), parseEther("0.85"), parseEther("0.075"), parseEther("100")],
    });
  }
  }

  await step("Close: repay the Core loan in full and withdraw all BTC (permit)", page, async () => {
    await page.goto(`${BASE}/borrow`, { waitUntil: "networkidle" });
    await pickMarket(page, "Core");
    await page.getByRole("tab", { name: "Close" }).click();
    await panelButton(page, /^Close position$/).click();
    await waitForSteps(page);
  });

  await step("Dashboard: history lists the actions", page, async () => {
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    await page.getByText("Swapped for MUSD").first().waitFor({ timeout: 60_000 });
    await page.getByText("Repaid").first().waitFor({ timeout: 30_000 });
    await page.getByText("Liquidated a loan").first().waitFor({ timeout: 30_000 });
  });

  // Responsive pass with the connected wallet.
  const sizes = [
    { name: "phone-360", width: 360, height: 780 },
    { name: "phone-414", width: 414, height: 896 },
    { name: "tablet-768", width: 768, height: 1024 },
  ];
  log.responsive = [];
  for (const s of sizes) {
    await page.setViewportSize({ width: s.width, height: s.height });
    for (const r of ["/", "/dashboard", "/lend", "/borrow", "/swap", "/markets", "/liquidations", "/analytics", "/docs"]) {
      await page.goto(`${BASE}${r}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1_200);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      log.responsive.push({ size: s.name, route: r, horizontalOverflowPx: overflow });
      if (r === "/" || r === "/borrow" || r === "/dashboard") {
        await page.screenshot({ path: resolve(here, `screens/${s.name}${r === "/" ? "-home" : r.replace("/", "-")}.png`), fullPage: true });
      }
    }
  }
  log.consoleErrors = consoleErrors;
  log.finishedAt = new Date().toISOString();
  const passed = log.steps.filter((x) => x.ok).length;
  log.summary = `${passed}/${log.steps.length} UI steps passed, ${log.steps.reduce((a, x) => a + (x.transactions?.length ?? 0), 0)} transactions confirmed on the explorer`;
  save();
  console.log(`\n${log.summary}`);
  const bad = log.responsive.filter((x) => x.horizontalOverflowPx > 0);
  console.log(bad.length ? `horizontal overflow: ${JSON.stringify(bad)}` : "no horizontal overflow at 360 / 414 / 768");
  console.log(`console errors: ${consoleErrors.length}`);
  await browser.close();
  if (passed !== log.steps.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  save();
  process.exit(1);
});
