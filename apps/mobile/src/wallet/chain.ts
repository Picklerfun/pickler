import {
  type Address,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  type Hex,
  http,
} from "viem";
import { AUSD_ADDRESS, AUSD_FAUCET_ADDRESS, CHAIN, ERC20_ABI, FAUCET_ABI } from "../config/chain";
import type { Wallet } from "./wallet";

export const publicClient = createPublicClient({ chain: CHAIN, transport: http() });

export async function readBalances(address: Address): Promise<{ ausd: bigint; mon: bigint }> {
  const [ausd, mon] = await Promise.all([
    publicClient.readContract({
      address: AUSD_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [address],
    }),
    publicClient.getBalance({ address }),
  ]);
  return { ausd, mon };
}

export function faucetCalldata(recipient: Address): Hex {
  return encodeFunctionData({ abi: FAUCET_ABI, functionName: "requestFunds", args: [recipient] });
}

export function faucetTxRequest(recipient: Address): { to: Address; data: Hex; value: bigint } {
  return { to: AUSD_FAUCET_ADDRESS, data: faucetCalldata(recipient), value: 0n };
}

/** Firma con la sesión de mera (sin prompt de passkey) y envía. Devuelve el hash. */
export async function requestAusdFromFaucet(wallet: Wallet): Promise<Hex> {
  const walletClient = createWalletClient({ account: wallet.account, chain: CHAIN, transport: http() });
  const tx = faucetTxRequest(wallet.address);
  return walletClient.sendTransaction({ ...tx, account: wallet.account, chain: CHAIN });
}

export async function waitForReceipt(hash: Hex): Promise<"success" | "reverted"> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return receipt.status;
}
