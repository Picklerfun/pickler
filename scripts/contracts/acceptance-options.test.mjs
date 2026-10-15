import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = fileURLToPath(new URL(".", import.meta.url));
import { parseAcceptanceOptions } from "./acceptance-options.mjs";
const root = path.resolve(__dirname, "../..");
const privateArgs = ["--key-file", "/tmp/private.env", "--output", "/tmp/private-acceptance"];

test("no arguments and help perform no filesystem or network acceptance", () => {
  assert.deepEqual(parseAcceptanceOptions([], root), { mode: "help" });
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, "uniswap-testnet-acceptance.mjs")],
    { encoding: "utf8", env: { PATH: process.env.PATH } },
  );
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--preflight/);
  assert.equal(result.stderr, "");
});

test("refuses ambiguous modes, remote forks, arbitrary endpoints and checkout secrets", () => {
  for (const args of [
    ["--broadcast"],
    ["--broadcast-testnet", "--preflight", ...privateArgs],
    ["--preflight", ...privateArgs, "--rpc", "https://rpc.ankr.com/monad_testnet"],
    ["--broadcast-testnet", ...privateArgs, "--rpc", "https://mainnet.example"],
    ["--preflight", ...privateArgs, "--rpc", "http://secret@localhost:8555"],
    ["--broadcast-testnet", "--key-file", "/tmp/private.env", "--output", root],
    ["--broadcast-testnet", ...privateArgs, "--unknown", "value"],
  ]) {
    assert.throws(() => parseAcceptanceOptions(args, root));
  }
});

test("explicit fork and fixed testnet broadcast are distinct", () => {
  assert.equal(
    parseAcceptanceOptions(["--preflight", ...privateArgs, "--rpc", "http://127.0.0.1:8555"], root)
      .broadcast,
    false,
  );
  const options = parseAcceptanceOptions(["--broadcast-testnet", ...privateArgs], root);
  assert.equal(options.rpc, "https://testnet-rpc.monad.xyz");
  assert.equal(options.broadcast, true);
});
