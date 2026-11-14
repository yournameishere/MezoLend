"use client";

import { useCallback, useState } from "react";
import { useConnection, usePublicClient, useSignTypedData, useSwitchChain, useWriteContract } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { erc20Abi, parseSignature, type Abi, type Address, type Hash, type Hex } from "viem";
import { errorsAbi } from "@/config/contracts";
import { explainError, isUserRejection } from "@/lib/errors";
import { pushNotice, toast } from "@/lib/store";
import { chain } from "@/lib/wagmi";

/** EIP-2612 permit as the contracts take it (PermitLib.Permit). deadline 0 = no permit, use the allowance. */
export type PermitArg = { value: bigint; deadline: bigint; v: number; r: Hex; s: Hex };
export const NO_PERMIT: PermitArg = { value: 0n, deadline: 0n, v: 0, r: `0x${"0".repeat(64)}`, s: `0x${"0".repeat(64)}` };

/** Permit domains of the Mezo tokens MezoLend pulls (read from each token's eip712Domain / DOMAIN_SEPARATOR). */
export const PERMIT_DOMAINS: Record<string, { name: string; version: string }> = {
  "0x118917a40faf1cd7a13db0ef56c86de7973ac503": { name: "Mezo USD", version: "1" },
  "0x7b7c000000000000000000000000000000000001": { name: "MEZO", version: "1" },
  "0x7b7c000000000000000000000000000000000000": { name: "BTC", version: "1" },
};

const noncesAbi = [
  { type: "function", name: "nonces", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export type TxStep = {
  key: string;
  label: string;
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  /**
   * Pull tokens with a signature instead of a separate approve: the wallet signs an EIP-2612 permit for
   * `value` to `spender`, and `buildArgs` puts it into the call. Skipped when the allowance already covers it;
   * falls back to approve + call if the wallet can't sign typed data.
   */
  permit?: { token: Address; spender: Address; value: bigint; buildArgs: (p: PermitArg) => readonly unknown[] };
  /** Mezo's RPC sometimes under-estimates gas: never send less than this. */
  gasFloor?: bigint;
  /** Shown in toasts + notification centre once confirmed. */
  done: { title: string; body?: string };
  /** Skip this step at run time (e.g. allowance already sufficient). */
  skip?: () => Promise<boolean> | boolean;
};

export type StepState = "idle" | "skipped" | "permit" | "signing" | "pending" | "done" | "error";

export function useTx() {
  const { address, chainId } = useConnection();
  const publicClient = usePublicClient({ chainId: chain.id });
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const qc = useQueryClient();

  const [states, setStates] = useState<Record<string, StepState>>({});
  const [hashes, setHashes] = useState<Record<string, Hash>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<{ key: string; label: string }[]>([]);

  const reset = useCallback(() => {
    setStates({});
    setHashes({});
    setError(undefined);
    setSteps([]);
  }, []);

  const run = useCallback(
    async (steps: TxStep[]): Promise<boolean> => {
      if (!address || !publicClient) {
        setError("Connect a wallet first.");
        return false;
      }
      setBusy(true);
      setError(undefined);
      setSteps(steps.map((s) => ({ key: s.key, label: s.label })));
      setStates(Object.fromEntries(steps.map((s) => [s.key, "idle" as StepState])));
      setHashes({});

      const send = async (step: TxStep, args: readonly unknown[], key: string) => {
        const abi = [...step.abi, ...errorsAbi] as Abi;
        const call = { account: address, address: step.address, abi, functionName: step.functionName, args, value: step.value };
        setStates((s) => ({ ...s, [key]: "signing" }));
        // Simulate first so reverts surface as readable errors before the wallet opens.
        await publicClient.simulateContract(call);
        const est = await publicClient.estimateContractGas(call);
        const padded = (est * 3n) / 2n + 30_000n;
        const gas = step.gasFloor && step.gasFloor > padded ? step.gasFloor : padded;
        const hash = await writeContractAsync({ ...call, gas, chainId: chain.id } as Parameters<typeof writeContractAsync>[0]);
        setHashes((h) => ({ ...h, [key]: hash }));
        setStates((s) => ({ ...s, [key]: "pending" }));
        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000, pollingInterval: 1_500 });
        if (receipt.status !== "success") throw new Error(`${step.label} failed on-chain. Nothing was moved.`);
        return hash;
      };

      try {
        if (chainId !== chain.id) await switchChainAsync({ chainId: chain.id });
        for (const step of steps) {
          if (step.skip && (await step.skip())) {
            setStates((s) => ({ ...s, [step.key]: "skipped" }));
            continue;
          }
          let args = step.args ?? [];
          if (step.permit) {
            const { token, spender, value, buildArgs } = step.permit;
            const allowance = await publicClient.readContract({
              address: token,
              abi: erc20Abi,
              functionName: "allowance",
              args: [address, spender],
            });
            args = buildArgs(NO_PERMIT);
            if (allowance < value) {
              setStates((s) => ({ ...s, [step.key]: "permit" }));
              try {
                const nonce = await publicClient.readContract({ address: token, abi: noncesAbi, functionName: "nonces", args: [address] });
                const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
                const domain = PERMIT_DOMAINS[token.toLowerCase()];
                const sig = await signTypedDataAsync({
                  domain: { ...domain, chainId: chain.id, verifyingContract: token },
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
                  message: { owner: address, spender, value, nonce, deadline },
                });
                const { r, s, yParity } = parseSignature(sig);
                args = buildArgs({ value, deadline, v: (yParity ?? 0) + 27, r, s });
              } catch (e) {
                if (isUserRejection(e)) throw e;
                // Wallet can't sign typed data: classic approve, then the same call without a permit.
                await send(
                  {
                    ...step,
                    label: "Approve",
                    address: token,
                    abi: erc20Abi as Abi,
                    functionName: "approve",
                    value: undefined,
                    gasFloor: 80_000n,
                  },
                  [spender, value],
                  step.key,
                );
              }
            }
          }
          const hash = await send(step, args, step.key);
          setStates((s) => ({ ...s, [step.key]: "done" }));
          toast({ tone: "success", title: step.done.title, body: step.done.body, hash });
          pushNotice({
            account: address.toLowerCase(),
            kind: "tx",
            tone: "success",
            title: step.done.title,
            body: step.done.body,
            hash,
          });
          void qc.invalidateQueries();
        }
        return true;
      } catch (e) {
        const msg = explainError(e);
        setError(msg);
        setStates((s) => {
          const next = { ...s };
          for (const k of Object.keys(next)) {
            if (next[k] === "signing" || next[k] === "pending" || next[k] === "permit") next[k] = "error";
          }
          return next;
        });
        toast({ tone: "error", title: "Transaction not completed", body: msg }, 8000);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [address, chainId, publicClient, qc, signTypedDataAsync, switchChainAsync, writeContractAsync],
  );

  return { run, states, hashes, error, busy, reset, steps };
}
