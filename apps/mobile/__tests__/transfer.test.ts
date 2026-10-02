import { encodeFunctionData } from "viem";
import { AUSD_ADDRESS, ERC20_ABI } from "../src/config/chain";
import { transferCalldata, transferTxRequest } from "../src/wallet/chain";

const to = "0x51289183f21d0cfb0d698ca13c332c438749eb09" as const;

test("transfer calldata is transfer(to, amount) with the ERC-20 selector", () => {
  const data = transferCalldata(to, 5_000_000n);
  expect(data).toBe(encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [to, 5_000_000n] }));
  // selector de transfer(address,uint256); coincide con methodId de una tx real en MonadScan (0x7ef471…2ef1).
  expect(data.slice(0, 10)).toBe("0xa9059cbb");
});

test("transfer tx targets the AUSD contract with zero native value", () => {
  const tx = transferTxRequest(to, 1n);
  expect(tx.to).toBe(AUSD_ADDRESS);
  expect(tx.value).toBe(0n);
  expect(tx.data).toBe(transferCalldata(to, 1n));
});
