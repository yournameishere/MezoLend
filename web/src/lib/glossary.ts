export const glossary = {
  utilization: {
    term: "Utilization",
    text: "The share of the pool's MUSD that's currently lent out. Higher utilization means higher rates for both sides and less idle MUSD for instant withdrawals.",
  },
  supplyApy: {
    term: "Supply APY",
    text: "What lenders earn per year, compounded. It comes from borrower interest after the protocol's reserve share. It moves with utilization and isn't guaranteed.",
  },
  borrowApy: {
    term: "Borrow APY",
    text: "What borrowers pay per year, compounded every second. It rises as the pool gets more utilized.",
  },
  ltv: {
    term: "Max LTV",
    text: "Loan-to-value limit. With a 70% max LTV, $1,000 of BTC lets you borrow up to $700 of MUSD.",
  },
  liquidationThreshold: {
    term: "Liquidation threshold",
    text: "If your debt grows past this share of your collateral's value, the loan can be liquidated. It sits above the max LTV to leave a safety buffer.",
  },
  healthFactor: {
    term: "Health factor",
    text: "Collateral value × liquidation threshold ÷ debt. Above 1.0 the loan is safe; below 1.0 anyone can liquidate part of it. The higher, the safer.",
  },
  collateralRatio: {
    term: "Collateral ratio",
    text: "Collateral value ÷ debt. $2,000 of BTC against 1,000 MUSD is a 200% collateral ratio.",
  },
  liquidationPrice: {
    term: "Liquidation price",
    text: "The BTC price at which your health factor reaches 1.0 and the loan becomes liquidatable, assuming nothing else changes.",
  },
  liquidationBonus: {
    term: "Liquidation bonus",
    text: "The discount liquidators get on the BTC they receive for repaying a risky loan. It's the borrower's penalty for letting the loan get too risky.",
  },
  originationFee: {
    term: "Origination fee",
    text: "A one-time fee added to your debt when you borrow. It goes to protocol reserves.",
  },
  reserveFactor: {
    term: "Reserve factor",
    text: "The share of borrower interest kept by the protocol as reserves. Reserves absorb bad debt before lenders do.",
  },
  closeFactor: {
    term: "Close factor",
    text: "The most of a loan that can be repaid in one liquidation. Deeply underwater or small loans can be closed in full.",
  },
  availableLiquidity: {
    term: "Available liquidity",
    text: "Idle MUSD in the pool right now. It caps how much can be borrowed or withdrawn this instant.",
  },
  shares: {
    term: "Pool shares",
    text: "When you supply, you receive pool shares (mlMUSD). Each share is worth more MUSD over time as interest flows in.",
  },
  oracle: {
    term: "Price oracle",
    text: "BTC/USD comes from Mezo's Skip oracle, updated every block. If it goes stale, Pyth is used as a fallback; if both fail, borrowing and withdrawals pause.",
  },
} as const;

export type GlossaryKey = keyof typeof glossary;
