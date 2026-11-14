import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

/** Contract custom errors → what happened and what to do, in plain words. */
const friendly: Record<string, string> = {
  InsufficientCollateral: "That would push your debt past the borrowing limit. Add collateral or use a smaller amount.",
  InsufficientLiquidity: "The pool doesn't have that much idle MUSD right now. Try a smaller amount.",
  BelowMinBorrow: "Loans start at 10 MUSD. Borrow at least that much.",
  BorrowCapExceeded: "This market has reached its borrowing cap.",
  SupplyCapExceeded: "This deposit would exceed the market's supply cap.",
  NoDebt: "There's no debt to repay on this account.",
  ZeroAmount: "Enter an amount greater than zero.",
  NotLiquidatable: "This loan is healthy again, so it can't be liquidated.",
  NoCollateral: "This account has no collateral of that type left to seize.",
  SlippageExceeded: "The price moved and you'd receive less BTC than expected. Refresh and try again.",
  AssetNotAccepted: "This collateral type isn't accepting deposits right now.",
  InvalidValue: "The BTC sent doesn't match the amount entered.",
  EnforcedPause: "This action is paused by the protocol guardian. Repaying and adding collateral still work.",
  PriceUnavailable: "The BTC price feed is stale, so borrowing and withdrawals are on hold. Repaying still works.",
  ERC4626ExceededMaxWithdraw: "That's more than you can withdraw right now. Part of the pool is lent out.",
  ERC4626ExceededMaxRedeem: "That's more than you can withdraw right now. Part of the pool is lent out.",
  ERC4626ExceededMaxDeposit: "Deposits are paused or the supply cap is reached.",
  ERC20InsufficientBalance: "Your wallet doesn't hold enough of that token.",
  ERC20InsufficientAllowance: "The permit signature didn't go through, so the contract can't pull your tokens. Try again.",
  ERC2612ExpiredSignature: "The permit signature expired. Try again.",
  ERC2612InvalidSigner: "The permit signature doesn't match your wallet. Try again.",
  NativeTransferFailed: "Sending BTC to the receiving address failed.",
  UnsupportedToken: "Only BTC and MEZO can be swapped here.",
  UnknownMarket: "That market isn't listed or is inactive.",
  InsufficientOutput: "The swap would return less MUSD than your minimum. Refresh the quote or allow more slippage.",
  ReentrancyGuardReentrantCall: "The transaction tried to re-enter the contract and was stopped.",
};

/** Plain-string reverts from the Mezo Pools router. */
const routerReverts: [RegExp, string][] = [
  [/INSUFFICIENT_OUTPUT_AMOUNT|InsufficientOutputAmount/i, "The pool price moved past your slippage limit. Refresh the quote and try again."],
  [/EXPIRED|Expired/, "The swap deadline passed before it was mined. Try again."],
  [/INSUFFICIENT_LIQUIDITY|InsufficientLiquidity/i, "The Mezo pool doesn't have enough liquidity for that size. Try a smaller amount."],
];

export function isUserRejection(err: unknown): boolean {
  if (err instanceof BaseError && err.walk((e) => e instanceof UserRejectedRequestError)) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /user (rejected|denied)|rejected the request|denied transaction/i.test(msg);
}

export function explainError(err: unknown): string {
  if (isUserRejection(err)) return "You cancelled the request in your wallet. Nothing was sent.";
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = revert?.data?.errorName;
    if (name && friendly[name]) return friendly[name];
    const reason = revert?.reason ?? "";
    for (const [re, text] of routerReverts) if (re.test(reason)) return text;
    if (name) return `The contract rejected this (${name}).`;
    const msg = err.shortMessage || err.message;
    for (const [re, text] of routerReverts) if (re.test(msg)) return text;
    if (/insufficient funds/i.test(msg)) return "Your wallet doesn't have enough BTC to cover this and the network fee.";
    if (/chain/i.test(msg) && /mismatch|switch/i.test(msg)) return "Switch your wallet to Mezo Testnet and try again.";
    if (/timed? ?out|took too long/i.test(msg)) return "Mezo's RPC didn't answer in time. Check the explorer before retrying.";
    return msg.replace(/^Error: /, "");
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong. Try again.";
}
