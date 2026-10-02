import { BaseError, ContractFunctionExecutionError, ContractFunctionRevertedError, encodeFunctionData, type Address } from "viem";
import { EXCHANGE_ABI, EXCHANGE_ADDRESS } from "../src/perpl/config";
import { ERC20_ABI, AUSD_ADDRESS } from "../src/config/chain";
import {
  allowForwardingCalldata, approveCalldata, createAccountCalldata, depositCalldata, isNoAccountRevert,
  readAccountId, readAllowance, withdrawCalldata,
} from "../src/perpl/onboarding";

const ME: Address = "0x29458C602E3DB4fC3b54EC2bbEE26Dbe64C7779f";

test("calldata carries the verified selectors and arguments", () => {
  expect(approveCalldata(100_000_000n)).toBe(encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [EXCHANGE_ADDRESS, 100_000_000n] }));
  expect(createAccountCalldata(100_000_000n).slice(0, 10)).toBe("0xcab13915");
  expect(createAccountCalldata(100_000_000n)).toContain("5f5e100"); // 100e6 en hex
  expect(allowForwardingCalldata()).toBe("0x7962f9100000000000000000000000000000000000000000000000000000000000000001");
  expect(depositCalldata(10_000_000n).slice(0, 10)).toBe("0xbad4a01f");
  expect(withdrawCalldata(5_000_000n).slice(0, 10)).toBe("0x6112fe2e");
});

function revert(): Error {
  // Forma con la que viem envuelve `execution reverted` con data 0x03a0e277…
  const cause = new ContractFunctionRevertedError({ abi: EXCHANGE_ABI, functionName: "getAccountByAddr", data: "0x03a0e277000000000000000000000000e3719a93b75cee42c5a8f3dce45e5b4b327851c1" });
  return new ContractFunctionExecutionError(cause, { abi: EXCHANGE_ABI, functionName: "getAccountByAddr", args: [ME], contractAddress: EXCHANGE_ADDRESS });
}

test("readAccountId returns the id and turns the no-account revert into 0n", async () => {
  const withAccount = { readContract: jest.fn(async () => 619n) };
  await expect(readAccountId(ME, withAccount as never)).resolves.toBe(619n);
  expect(withAccount.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: EXCHANGE_ADDRESS, functionName: "getAccountByAddr", args: [ME] }));
  const without = { readContract: jest.fn(async () => { throw revert(); }) };
  await expect(readAccountId(ME, without as never)).resolves.toBe(0n);
});

test("readAccountId rethrows network errors instead of hiding them as 0n", async () => {
  const down = { readContract: jest.fn(async () => { throw new BaseError("HTTP request failed"); }) };
  await expect(readAccountId(ME, down as never)).rejects.toThrow("HTTP request failed");
  expect(isNoAccountRevert(new Error("boom"))).toBe(false);
  expect(isNoAccountRevert(revert())).toBe(true);
});

test("readAllowance asks the AUSD contract for owner → exchange", async () => {
  const client = { readContract: jest.fn(async () => 5n) };
  await expect(readAllowance(ME, client as never)).resolves.toBe(5n);
  expect(client.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: AUSD_ADDRESS, functionName: "allowance", args: [ME, EXCHANGE_ADDRESS] }));
});
