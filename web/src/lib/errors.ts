import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

const friendly: Record<string, string> = {
  InsufficientCollateral: "That would push your debt past the borrowing limit. Add collateral or use a smaller amount.",
  InsufficientLiquidity: "The pool doesn't have that much idle MUSD right now. Try a smaller amount.",
  BelowMinBorrow: "Loans start at 10 MUSD. Borrow at least that much.",
  BorrowCapExceeded: "This market has reached its borrowing cap.",
  SupplyCapExceeded: "This deposit would exceed the market's supply cap.",
  NoDebt: "There's no debt to repay on this account.",
  ZeroAmount: "Enter an amount greater than zero.",
  NotLiquidatable: "This position is healthy again, so it can't be liquidated.",
  NoCollateral: "This account has no collateral of that type left to seize.",
  SlippageExceeded: "The price moved and you'd receive less collateral than expected. Refresh and try again.",
  AssetNotAccepted: "This collateral type isn't accepting deposits right now.",
  InvalidValue: "The BTC sent doesn't match the amount entered.",
  EnforcedPause: "This action is paused by the protocol guardian. Repaying and adding collateral still work.",
  PriceUnavailable: "The BTC price feed is stale, so borrowing and withdrawals are on hold. Repaying still works.",
  ERC4626ExceededMaxWithdraw: "That's more than you can withdraw right now — part of the pool is lent out.",
  ERC4626ExceededMaxRedeem: "That's more than you can withdraw right now — part of the pool is lent out.",
  ERC4626ExceededMaxDeposit: "Deposits are paused or the supply cap is reached.",
  ERC20InsufficientBalance: "Your wallet doesn't hold enough MUSD for this.",
  ERC20InsufficientAllowance: "MUSD approval is too low. Approve again and retry.",
  NativeTransferFailed: "Sending BTC to the receiving address failed.",
};

export function explainError(err: unknown): string {
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) return "You rejected the request in your wallet.";
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = revert?.data?.errorName;
    if (name && friendly[name]) return friendly[name];
    if (name) return `The contract rejected this: ${name}.`;
    const msg = err.shortMessage || err.message;
    if (/user (rejected|denied)/i.test(msg)) return "You rejected the request in your wallet.";
    if (/insufficient funds/i.test(msg)) return "Your wallet doesn't have enough BTC to cover this and the network fee.";
    if (/chain/i.test(msg) && /mismatch|switch/i.test(msg)) return "Switch your wallet to Mezo Testnet and try again.";
    return msg.replace(/^Error: /, "");
  }
  if (err instanceof Error) {
    if (/user (rejected|denied)/i.test(err.message)) return "You rejected the request in your wallet.";
    return err.message;
  }
  return "Something went wrong. Try again.";
}
