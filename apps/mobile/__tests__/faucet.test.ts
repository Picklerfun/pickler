import { encodeFunctionData } from "viem";
import { AUSD_FAUCET_ADDRESS, FAUCET_ABI } from "../src/config/chain";
import { faucetCalldata, faucetTxRequest } from "../src/wallet/chain";

const recipient = "0x3333333333333333333333333333333333333333" as const;

test("faucet calldata is requestFunds(recipient)", () => {
  expect(faucetCalldata(recipient)).toBe(
    encodeFunctionData({ abi: FAUCET_ABI, functionName: "requestFunds", args: [recipient] }),
  );
  // selector de requestFunds(address), calculado con viem y verificado por
  // eth_call contra el faucet en testnet el 2026-09-15 (no revierte).
  expect(faucetCalldata(recipient).slice(0, 10)).toBe("0x544c7cf9");
});

test("faucet tx targets the faucet with zero value", () => {
  const tx = faucetTxRequest(recipient);
  expect(tx.to).toBe(AUSD_FAUCET_ADDRESS);
  expect(tx.value).toBe(0n);
  expect(tx.data).toBe(faucetCalldata(recipient));
});
