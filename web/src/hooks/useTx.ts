"use client";

import { useCallback, useState } from "react";
import { useConnection, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import type { Abi, Address, Hash } from "viem";
import { errorsAbi } from "@/config/contracts";
import { explainError } from "@/lib/errors";
import { pushNotice, toast } from "@/lib/store";
import { chain } from "@/lib/wagmi";

export type TxStep = {
  key: string;
  label: string;
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  /** Shown in toasts + notification centre once confirmed. */
  done: { title: string; body?: string };
  /** Skip this step at run time (e.g. allowance already sufficient). */
  skip?: () => Promise<boolean> | boolean;
};

export type StepState = "idle" | "skipped" | "signing" | "pending" | "done" | "error";

export function useTx() {
  const { address, chainId } = useConnection();
  const publicClient = usePublicClient({ chainId: chain.id });
  const { writeContractAsync } = useWriteContract();
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
      try {
        if (chainId !== chain.id) await switchChainAsync({ chainId: chain.id });
        for (const step of steps) {
          if (step.skip && (await step.skip())) {
            setStates((s) => ({ ...s, [step.key]: "skipped" }));
            continue;
          }
          setStates((s) => ({ ...s, [step.key]: "signing" }));
          const abi = [...step.abi, ...errorsAbi] as Abi;
          // Simulate first so reverts surface as readable errors before the wallet opens.
          await publicClient.simulateContract({
            account: address,
            address: step.address,
            abi,
            functionName: step.functionName,
            args: step.args ?? [],
            value: step.value,
          });
          // Mezo gas estimation benefits from headroom.
          const est = await publicClient.estimateContractGas({
            account: address,
            address: step.address,
            abi,
            functionName: step.functionName,
            args: step.args ?? [],
            value: step.value,
          });
          const hash = await writeContractAsync({
            address: step.address,
            abi,
            functionName: step.functionName,
            args: step.args ?? [],
            value: step.value,
            gas: (est * 13n) / 10n + 20_000n,
            chainId: chain.id,
          } as Parameters<typeof writeContractAsync>[0]);
          setHashes((h) => ({ ...h, [step.key]: hash }));
          setStates((s) => ({ ...s, [step.key]: "pending" }));
          const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000, pollingInterval: 1_500 });
          if (receipt.status !== "success") throw new Error(`${step.label} reverted on-chain.`);
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
          for (const k of Object.keys(next)) if (next[k] === "signing" || next[k] === "pending") next[k] = "error";
          return next;
        });
        toast({ tone: "error", title: "Transaction not completed", body: msg }, 8000);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [address, chainId, publicClient, qc, switchChainAsync, writeContractAsync],
  );

  return { run, states, hashes, error, busy, reset, steps };
}
