import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const key = process.env.READS_TEST_KEY ?? generatePrivateKey();
const account = privateKeyToAccount(key);
const address = account.address.toLowerCase();
const ts = Date.now();
const sig = await account.signMessage({ message: `pickler-reads:${address}:${ts}` });
const headers = `-H "x-pickler-address: ${address}" -H "x-pickler-ts: ${ts}" -H "x-pickler-sig: ${sig}"`;
console.log(process.argv.includes("--headers") ? headers : JSON.stringify({ key, address, ts, sig, headers }, null, 2));
