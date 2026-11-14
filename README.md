# MezoLend

**Live app: https://mezolend.vercel.app**

A two-sided MUSD lending market on [Mezo](https://mezo.org). Lenders supply MUSD and earn interest paid by borrowers; borrowers post BTC as collateral and borrow MUSD without selling it. Balances, rates, health checks and liquidations all live in smart contracts on Mezo Testnet — the web app reads everything on-chain.

- **Contracts:** Solidity 0.8.28 + Foundry, OpenZeppelin 5.6 — 49 tests (unit, fuzz, invariant)
- **App:** Next.js 16, React 19, wagmi 3, viem 2, Tailwind 4, Motion, Lucide. Pages: Home, Dashboard, Supply, Borrow, Markets (+ detail), Liquidations, Analytics, Docs. Market data is rendered on the server (refreshed every 30s) and then polled live in the browser.
- **Network:** Mezo Testnet (chain id 31611), all contracts verified on [the explorer](https://explorer.test.mezo.org)

## How it works

| Lenders | Borrowers |
| --- | --- |
| Supply MUSD into a market's pool (ERC-4626 vault) and receive pool shares (`mlMUSD`) | Deposit BTC into the market's collateral manager |
| Share value grows as borrowers pay interest | Borrow MUSD up to the market's max LTV (one-time origination fee) |
| Withdraw any time, up to the pool's idle liquidity | Repay any time; withdraw BTC while staying within the limit |
| Bad debt hits reserves first, then lenders | Below health factor 1.0 the loan can be partly liquidated at a discount |

Two isolated markets are live:

| Market | Max LTV | Liq. threshold | Liq. bonus | Rate curve | Reserve factor | Origination fee |
| --- | --- | --- | --- | --- | --- | --- |
| **Core** | 70% | 80% | 5% | 1% base, +6% to 80% kink, +80% above | 10% | 0.10% |
| **Edge** | 78% | 85% | 7.5% | 2% base, +10% to 85% kink, +120% above | 15% | 0.25% |

## Architecture

```
MarketRegistry ─── lists markets ───────────────────────────────┐
PriceOracle    ─── BTC/USD: Skip (primary) → Pyth (fallback)     │
                   staleness, bounds, confidence checks          │
                                                                 ▼
per market:  LendingPool ◄── borrow/repay ── BorrowManager ──► CollateralManager
             (ERC-4626 + debt ledger,         (LTV + health    (BTC custody,
              borrow index, reserves,          checks, account  risk params)
              bad-debt write-off)              registry)              ▲
                   ▲                                                  │
                   └────────── repayFrom ── LiquidationManager ─ seize┘
                                            (close factor, bonus, protocol share)
             InterestRateModel (kinked utilization curve)

MezoLendLens ─── read-only aggregator: full market + account state in one eth_call
```

| Contract | Role |
| --- | --- |
| `LendingPool` | ERC-4626 MUSD vault for lenders and Compound-style debt ledger for borrowers; per-second interest, reserve factor, origination fee, supply/borrow caps, bad-debt write-off (reserves first). |
| `CollateralManager` | Holds native BTC (and any listed ERC-20) per user; per-asset LTV, liquidation threshold, bonus and cap with `LT × (1 + bonus) < 1` enforced. |
| `BorrowManager` | User entry point for borrowing: deposit, borrow, deposit-and-borrow, repay-and-withdraw; enforces the LTV limit; tracks open accounts on-chain. |
| `LiquidationManager` | Permissionless liquidations below HF 1.0 with a 50% close factor (full below HF 0.95 or for debts ≤ 100 MUSD), slippage guard, protocol share of the bonus. |
| `InterestRateModel` | Kinked utilization curve; supply rate = borrow rate × utilization × (1 − reserve factor). |
| `PriceOracle` | Mezo Skip BTC/USD aggregator as primary, Pyth as fallback; reverts (pausing borrows, withdrawals, liquidations) if neither is fresh and in bounds. |
| `MarketRegistry`, `MezoLendLens` | Market directory and the read aggregator that powers the UI. |

Safety: reentrancy guards everywhere, checks-effects-interactions, internal cash accounting (no donation share-price manipulation), role-based admin, pause switches that never block repaying or adding collateral.

## Deployed addresses (Mezo Testnet)

| | Address |
| --- | --- |
| Market registry | `0x405944E6E8B94643b246a932bfE378F5F0D2E003` |
| Price oracle | `0x98730Ca4f3f1940060ac1673d807B9f5E9F28FB8` |
| Lens | `0xe69b35f49ed939072020c58CcA965f3aaD43E703` |
| Core · pool / borrow / collateral / liquidation / rates | `0xA698b111…C6FE` / `0xc1d035D2…f1d3` / `0x219e63bB…4e0E` / `0x2eF8338A…1500` / `0x0D692f71…6C1C` |
| Edge · pool / borrow / collateral / liquidation / rates | `0x034b9E3F…c309` / `0x2747A22c…9edB` / `0x70c3D9C9…1935` / `0xF7114B6f…5Af1` / `0x8D7fe72d…d85c` |
| MUSD (Mezo testnet) | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` |

Full addresses: [`contracts/deployments/mezo-testnet.json`](contracts/deployments/mezo-testnet.json).

## Repository layout

```
contracts/   Foundry project — src/, test/, script/Deploy.s.sol, script/configure.sh, deployments/
web/         Next.js app — src/app (routes), src/components, src/hooks, src/lib, scripts/
project.md   Product spec
```

## Running locally

```bash
# contracts
cd contracts
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts@v5.6.1 --no-git
forge test

# web
cd web
npm install
npm run dev            # http://localhost:3000

# deploy (from web/, never from the repo root: contracts/.env holds keys)
vercel deploy --prod
```

The app works out of the box against the deployed testnet contracts. To use your own deployment, redeploy (below) and run `npm run sync` to copy ABIs and addresses into `web/src/config`.

## Deploying the contracts

Mezo's Skip oracle is a chain precompile whose stub bytecode can't run in Foundry's local EVM, so deployment is two steps: the forge script deploys and wires every contract, then `configure.sh` performs the oracle-dependent calls on-chain.

```bash
cd contracts
PRIVATE_KEY=0x... forge script script/Deploy.s.sol --rpc-url mezo_testnet --broadcast --slow \
  --verify --verifier blockscout --verifier-url https://api.explorer.test.mezo.org/api/
PRIVATE_KEY=0x... SEED=true CO_ADMIN=0xYourAddress bash script/configure.sh
```

## Liquidation keeper

```bash
cd web
DRY_RUN=1 npm run keeper                       # report liquidatable loans
KEEPER_PRIVATE_KEY=0x... npm run keeper        # liquidate them (needs MUSD)
```

## Testing

- `forge test` — 45 unit/fuzz tests + 4 invariants (cash and collateral accounting always match balances, assets cover reserves, share price never falls without bad debt).
- The supply, withdraw, borrow, repay, collateral and close flows were exercised end to end through the UI on Mezo Testnet. Liquidation was exercised end to end through the UI against the deployed contracts on an anvil fork of testnet with the oracle precompile replaced by a controllable feed.

## Getting testnet assets

1. Testnet BTC: [faucet.test.mezo.org](https://faucet.test.mezo.org)
2. MUSD: borrow it in MezoLend against BTC, or mint it on [Mezo Borrow](https://mezo.org/feature/borrow) (testnet)

## Risks

Testnet deployment, not audited. Lenders face liquidity and bad-debt risk; borrowers face liquidation risk if BTC falls. See the in-app [Docs page](https://mezolend.vercel.app/docs#risks) for details.
