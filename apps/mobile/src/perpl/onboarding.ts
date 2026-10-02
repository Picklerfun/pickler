import {
  type Address, BaseError, ContractFunctionRevertedError, createWalletClient, encodeFunctionData, type Hex, http,
} from "viem";
import { AUSD_ADDRESS, CHAIN, ERC20_ABI } from "../config/chain";
import { publicClient } from "../wallet/chain";
import type { Wallet } from "../wallet/wallet";
import { EXCHANGE_ABI, EXCHANGE_ADDRESS, PRIORITY_FEE_WEI } from "./config";

export type Reader = { readContract: typeof publicClient.readContract };

/** getAccountByAddr revierte (sin selector de error conocido) cuando la wallet no tiene cuenta. */
export function isNoAccountRevert(error: unknown): boolean {
  return error instanceof BaseError && error.walk((e) => e instanceof ContractFunctionRevertedError) !== null;
}

export async function readAccountId(address: Address, client: Reader = publicClient): Promise<bigint> {
  try {
    return await client.readContract({ address: EXCHANGE_ADDRESS, abi: EXCHANGE_ABI, functionName: "getAccountByAddr", args: [address] });
  } catch (e) {
    if (isNoAccountRevert(e)) return 0n;
    throw e;
  }
}

export function readAllowance(address: Address, client: Reader = publicClient): Promise<bigint> {
  return client.readContract({ address: AUSD_ADDRESS, abi: ERC20_ABI, functionName: "allowance", args: [address, EXCHANGE_ADDRESS] });
}

export const approveCalldata = (amount: bigint): Hex => encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [EXCHANGE_ADDRESS, amount] });
export const createAccountCalldata = (amount: bigint): Hex => encodeFunctionData({ abi: EXCHANGE_ABI, functionName: "createAccount", args: [amount] });
export const allowForwardingCalldata = (): Hex => encodeFunctionData({ abi: EXCHANGE_ABI, functionName: "allowOrderForwarding", args: [true] });
export const depositCalldata = (amount: bigint): Hex => encodeFunctionData({ abi: EXCHANGE_ABI, functionName: "depositCollateral", args: [amount] });
export const withdrawCalldata = (amount: bigint): Hex => encodeFunctionData({ abi: EXCHANGE_ABI, functionName: "withdrawCollateral", args: [amount] });

/** Firma con la sesión de Mera y envía con priority fee explícita (reemplaza una tx descartada). */
async function send(wallet: Wallet, to: Address, data: Hex): Promise<Hex> {
  const walletClient = createWalletClient({ account: wallet.account, chain: CHAIN, transport: http() });
  return walletClient.sendTransaction({
    account: wallet.account,
    chain: CHAIN,
    to,
    data,
    value: 0n,
    maxPriorityFeePerGas: PRIORITY_FEE_WEI,
  });
}

export const approveExchange = (wallet: Wallet, amount: bigint): Promise<Hex> => send(wallet, AUSD_ADDRESS, approveCalldata(amount));
export const createExchangeAccount = (wallet: Wallet, amount: bigint): Promise<Hex> => send(wallet, EXCHANGE_ADDRESS, createAccountCalldata(amount));
export const enableForwarding = (wallet: Wallet): Promise<Hex> => send(wallet, EXCHANGE_ADDRESS, allowForwardingCalldata());
export const depositCollateral = (wallet: Wallet, amount: bigint): Promise<Hex> => send(wallet, EXCHANGE_ADDRESS, depositCalldata(amount));
export const withdrawCollateral = (wallet: Wallet, amount: bigint): Promise<Hex> => send(wallet, EXCHANGE_ADDRESS, withdrawCalldata(amount));
